"use client"

// CorrectionsLog — 修正累積（學習資產）
// 對應 endpoint GET /api/corrections，回傳 { rows, summary, total }。
// audit 修正點：過去前端只在 transaction row 顯示 correction_count 數字，
// 這個元件把 endpoint 已提供的 summary（欄位×舊值×新值×次數）與完整明細 rows 補上，
// 讓累積修正從「一個數字」升級成可檢視的學習資產。

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { History, AlertTriangle, RefreshCw, X } from "lucide-react"
import { useCorrections } from "@/lib/hooks"
import { EDITABLE_LABELS as FIELD_LABEL } from "@/lib/constants"
import { formatDate } from "@/lib/format"
import ErrorBoundary from "@/components/ErrorBoundary"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

function fieldLabel(name) {
  return FIELD_LABEL[name] || name
}

const PAGE_SIZE = 10

// 簡單分頁範圍：≤7 頁全顯示；超過用 ellipsis 折疊
function pageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set([1, total, current, current - 1, current + 1])
  const sorted = [...set].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push(null)
    out.push(sorted[i])
  }
  return out
}

function displayValue(v) {
  if (v === null || v === undefined || v === "") return "（空）"
  const s = String(v)
  // 防呆：值含 U+FFFD（替換字元，通常是 curl/PowerShell CP950 雙重編碼殘留）時，
  // 顯示占位而非把亂碼噴進表格。寫入路徑（fetch+request.json）不會腐蝕 UTF-8，
  // 僅防手動 curl/PowerShell 呼叫造成的髒資料。
  if (s.includes("�")) return "（編碼異常）"
  return s
}

// 規則候選摘要：以 match_key + 欄位 + 新值聚合（哪個比對鍵被一致校正成什麼）。
// 點列下鑽該比對鍵的明細（URL ?key= → getCorrections matchKey 過濾）。等同 AI 第二環的規則候選清單。
function SummaryTable({ rows, activeKey, onPick }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>比對鍵</TableHead>
          <TableHead>欄位</TableHead>
          <TableHead>校正為</TableHead>
          <TableHead className="text-right">次數</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => {
          const k = `${row.match_key}|${row.field_name}|${row.new_value}|${i}`
          const isActive = activeKey && activeKey === row.match_key
          return (
            <TableRow
              key={k}
              data-active={isActive}
              className={isActive ? "bg-muted/50" : "cursor-pointer hover:bg-muted/40"}
              onClick={() => onPick && onPick(row.match_key)}
              tabIndex={onPick ? 0 : undefined}
              role={onPick ? "button" : undefined}
              aria-pressed={onPick ? isActive : undefined}
              aria-label={onPick ? `下鑽比對鍵 ${row.match_key}` : undefined}
              onKeyDown={
                onPick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onPick(row.match_key)
                      }
                    }
                  : undefined
              }
            >
              <TableCell className="font-medium">{displayValue(row.match_key)}</TableCell>
              <TableCell className="text-muted-foreground">
                {fieldLabel(row.field_name)}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="font-normal">
                  {displayValue(row.new_value)}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.count}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function RowsTable({ rows, page, totalPages, onPageChange }) {
  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>欄位</TableHead>
            <TableHead>舊值</TableHead>
            <TableHead>新值</TableHead>
            <TableHead>時間</TableHead>
            <TableHead>交易</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{fieldLabel(row.field_name)}</TableCell>
              <TableCell className="text-muted-foreground">
                {displayValue(row.old_value)}
              </TableCell>
              <TableCell className="font-medium">{displayValue(row.new_value)}</TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">
                {formatDate(row.corrected_at)}
              </TableCell>
              <TableCell
                className="max-w-[16rem] truncate text-muted-foreground"
                title={row.transaction_name || `#${row.transaction_id}`}
              >
                {row.transaction_name || `#${row.transaction_id}`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {totalPages > 1 && (
        <Pagination className="mx-0 justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                text="上一頁"
                aria-disabled={page === 1}
                className={
                  page === 1
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
                onClick={(e) => {
                  e.preventDefault()
                  if (page > 1) onPageChange(page - 1)
                }}
              />
            </PaginationItem>
            {pageRange(page, totalPages).map((p, i) =>
              p === null ? (
                <PaginationItem key={`ellipsis-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    isActive={p === page}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault()
                      onPageChange(p)
                    }}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                text="下一頁"
                aria-disabled={page === totalPages}
                className={
                  page === totalPages
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
                onClick={(e) => {
                  e.preventDefault()
                  if (page < totalPages) onPageChange(page + 1)
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>載入修正紀錄失敗</AlertTitle>
      <AlertDescription>
        <p className="text-sm">{message || "請稍後再試。"}</p>
        {onRetry && (
          <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重試
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

function TableSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}

export default function CorrectionsLog() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // corrections 是跨月累積的學習資產，不依月份/scope 過濾。
  // 支援 ?key= 下鑽：summary 點擊某比對鍵 → 明細過濾到該鍵（規則候選 → 原始校正明細）。
  const matchKey = searchParams.get("key") || ""
  const paramParts = []
  if (matchKey) paramParts.push(`matchKey=${encodeURIComponent(matchKey)}`)
  paramParts.push("limit=1000")
  const params = paramParts.join("&")

  const { data, loading, error, refetch } = useCorrections(params)

  const [page, setPage] = useState(1)

  const rows = data?.rows || []
  const summary = data?.summary || []

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  const pageRows = rows.slice(start, start + PAGE_SIZE)

  function handlePick(nextKey) {
    const sp = new URLSearchParams(searchParams)
    if (matchKey === nextKey) {
      sp.delete("key")
    } else {
      sp.set("key", nextKey)
    }
    sp.set("mode", "corrections")
    setPage(1)
    router.push(`?${sp.toString()}`, { scroll: false })
  }

  function clearKey() {
    const sp = new URLSearchParams(searchParams)
    sp.delete("key")
    sp.set("mode", "corrections")
    setPage(1)
    router.push(`?${sp.toString()}`, { scroll: false })
  }

  const isEmpty = !loading && !error && rows.length === 0

  return (
    <ErrorBoundary>
      <section className="space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">
              修正累積（學習資產）
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            所有人工修正的歷史。左側是變更的累積摘要，右側是逐筆明細。
            這些紀錄會逐月累積，成為日後判斷同類交易的依據。
          </p>
        </header>

        {error ? (
          <ErrorState message={error?.message} onRetry={refetch} />
        ) : (
          <>
            {/* Summary：補「前端只取 count」的落差 — 把欄位×舊值×新值×次數完整呈現 */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">變更摘要</h3>
              {loading ? (
                <TableSkeleton rows={4} />
              ) : summary.length === 0 ? (
                <p className="text-sm text-muted-foreground">尚無累積資料。</p>
              ) : (
                <div className="rounded-md border">
                  <SummaryTable
                    rows={summary}
                    activeKey={matchKey}
                    onPick={handlePick}
                  />
                </div>
              )}
              {matchKey && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    已套用篩選：比對鍵 = {matchKey}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={clearKey}
                  >
                    <X className="mr-1 h-3 w-3" />
                    清除
                  </Button>
                </div>
              )}
            </div>

            {/* Detail rows */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">修正明細</h3>
                {!loading && rows.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    共 {data?.total ?? rows.length} 筆
                    {data && data.total > rows.length ? `（僅顯示最近 ${rows.length} 筆）` : ""}
                  </span>
                )}
              </div>
              {loading ? (
                <TableSkeleton rows={6} />
              ) : isEmpty ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <History className="h-4 w-4" />
                    </EmptyMedia>
                    <EmptyTitle>尚無修正紀錄</EmptyTitle>
                    <EmptyDescription>
                      當你開始調整交易的分類、歸屬或必要性，這裡會逐筆累積每一次變更，
                      成為後續判斷同類交易的學習資產。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="rounded-md border">
                  <RowsTable
                    rows={pageRows}
                    page={safePage}
                    totalPages={totalPages}
                    onPageChange={setPage}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </ErrorBoundary>
  )
}
