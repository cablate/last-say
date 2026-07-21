"use client"

// CorrectionsLog — 修正紀錄（純 log 清單）。
// 使用者在交易明細（TransactionTable）每次調整分類，自動寫一筆 correction_log。
// 這裡如實列出每一筆 log（時間 / 交易 / 欄位 舊→新），不做摘要、不聚合、不做「規則候選」。
// correction_log 是 append-only 的客觀記錄；AI 第二環若要規則候選，自行讀 /api/corrections 的 summary（API 仍提供）。

import { useState } from "react"
import { History, AlertTriangle, RefreshCw, ArrowRight, Bot, CheckCircle2 } from "lucide-react"
import { useCorrections } from "@/lib/hooks"
import { EDITABLE_LABELS as FIELD_LABEL } from "@/lib/constants"
import { formatDate, formatTWD } from "@/lib/format"
import ErrorBoundary from "@/components/ErrorBoundary"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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

function displayValue(v) {
  if (v === null || v === undefined || v === "") return "（空）"
  const s = String(v)
  if (s.includes("�")) return "（編碼異常）"
  return s
}

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

const PAGE_SIZE = 20

// 一筆 log = 一行：時間 / 交易名 / 金額 / 欄位 舊→新
function LogRow({ r }) {
  const amount =
    Number(r.transaction_outflow) > 0
      ? `-${formatTWD(r.transaction_outflow)}`
      : Number(r.transaction_amount) !== 0
        ? formatTWD(r.transaction_amount)
        : ""
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm">
      <time className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.corrected_at)}</time>
      <span className="min-w-0 max-w-[16rem] truncate font-medium" title={r.transaction_name || `#${r.transaction_id}`}>
        {r.transaction_name || `#${r.transaction_id}`}
      </span>
      {amount && <span className="tabular-nums text-muted-foreground">{amount}</span>}
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">{fieldLabel(r.field_name)}</span>
        <span className="text-muted-foreground/60 line-through">{displayValue(r.old_value)}</span>
        <span className="text-muted-foreground/40">→</span>
        <Badge variant="secondary" className="font-normal">{displayValue(r.new_value)}</Badge>
      </span>
    </li>
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
            <RefreshCw className="mr-2 h-4 w-4" /> 重試
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

function FeedbackLoopCard({ feedback, loading }) {
  if (loading && !feedback) {
    return <Skeleton className="h-28 w-full rounded-xl" />
  }
  const corrections = Number(feedback?.corrections ?? 0)
  const rules = Number(feedback?.humanCorrectionRules ?? 0)
  const autoApplied = Number(feedback?.autoApplied ?? 0)
  return (
    <Card>
      <CardHeader>
        <CardDescription>修正回饋閉環</CardDescription>
        <CardTitle className="text-xl">你的修正正在累積成規則</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">你的修正</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
              {corrections}
            </p>
            <p className="text-xs text-muted-foreground">筆修正紀錄</p>
          </div>
          <ArrowRight className="hidden h-4 w-4 text-muted-foreground md:block" aria-hidden="true" />
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bot className="h-3.5 w-3.5" aria-hidden="true" />
              人工分類規則
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
              {rules}
            </p>
            <p className="text-xs text-muted-foreground">條規則</p>
          </div>
          <ArrowRight className="hidden h-4 w-4 text-muted-foreground md:block" aria-hidden="true" />
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              自動處理
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
              {autoApplied}
            </p>
            <p className="text-xs text-muted-foreground">次自動套用</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function CorrectionsLog() {
  // 純 log：拉全部 correction 逐筆列。不做 matchKey 下鑽（那是 summary 的事，已移除）。
  const { data, loading, error, refetch } = useCorrections("limit=1000")
  const [page, setPage] = useState(1)

  const rows = data?.rows || []
  const total = data?.total ?? rows.length
  const feedbackLoop = data?.feedbackLoop ?? null
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const isEmpty = !loading && !error && rows.length === 0

  return (
    <ErrorBoundary>
      <section className="space-y-4">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">修正紀錄</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            你在交易明細做過的每一次調整，逐筆 log（時間 / 交易 / 欄位 舊→新）。
          </p>
        </header>

        <FeedbackLoopCard feedback={feedbackLoop} loading={loading} />

        {error ? (
          <ErrorState message={error?.message} onRetry={refetch} />
        ) : loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isEmpty ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History className="h-4 w-4" />
              </EmptyMedia>
              <EmptyTitle>尚無修正紀錄</EmptyTitle>
              <EmptyDescription>
                當你在交易明細調整分類、歸屬或必要性，這裡會逐筆累積每一次變更。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">共 {total} 筆</div>
            <ul className="space-y-2">
              {pageRows.map((r) => (
                <LogRow key={r.id} r={r} />
              ))}
            </ul>
            {totalPages > 1 && (
              <Pagination className="mx-0 justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      text="上一頁"
                      aria-disabled={safePage === 1}
                      className={safePage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      onClick={(e) => {
                        e.preventDefault()
                        if (safePage > 1) setPage(safePage - 1)
                      }}
                    />
                  </PaginationItem>
                  {pageRange(safePage, totalPages).map((p, i) =>
                    p === null ? (
                      <PaginationItem key={`e-${i}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={p}>
                        <PaginationLink
                          isActive={p === safePage}
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.preventDefault()
                            setPage(p)
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
                      aria-disabled={safePage === totalPages}
                      className={safePage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      onClick={(e) => {
                        e.preventDefault()
                        if (safePage < totalPages) setPage(safePage + 1)
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </section>
    </ErrorBoundary>
  )
}
