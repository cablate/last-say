"use client"

// TransactionTable — 交易列表（行內編輯 + 批次修正）
//
// 資料：useTransactions(queryParams) 與 useMeta()（皆來自 lib/hooks.js）。
// 主狀態（month/mode/view/scope/category/search/sort/direction/page）由 URL search params 驅動；
// client state（selectedTxnId 展開單筆、batchIds 批次選取）用 useState。
//
// 注意：useSearchParams 在 Next 15 需要 <Suspense> 邊界，由整合者（app/page.js）包裹本元件。
//
// API 契約：
//   - useTransactions 回傳 { data: { total, limit, offset, rows }, loading, error, refetch }
//   - useMeta 回傳 { data: { filters: { categories: [{value,rows}], ... } }, ... }
//   - usePatchTxn() 回 mutate(id, body)（PATCH /api/transactions/{id}，內建 toast）
//   - useBatchCorrect() 回 mutate(payload)（POST /api/transactions/batch；payload 需為 { corrections: [...] }）

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronsUpDownIcon,
  ListChecks,
  Loader2Icon,
  RotateCwIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { formatTWD, formatDate } from "@/lib/format"
import { OWNER_OPTIONS, NECESSITY_OPTIONS, EDITABLE_FIELDS, EDITABLE_LABELS } from "@/lib/constants"
import { useMeta, useTransactions, usePatchTxn, useBatchCorrect, useReviewTxns } from "@/lib/hooks"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

// 一頁筆數。server 端 getTransactions 會將 limit 上限夾在 2000，25 遠低於上限。
const PAGE_SIZE = 25

// URL sort 參數 → 人類欄位標籤。sort 值域對齊 ALLOWED_SORT（lib/queries.js）。
const SORT_COLUMNS = [
  { key: "date", label: "日期", align: "left" },
  { key: "name", label: "名稱", align: "left", sortable: false },
  { key: "amount", label: "金額", align: "right" },
  { key: "outflow", label: "支出", align: "right" },
  { key: "owner", label: "歸屬", align: "left" },
  { key: "category", label: "分類", align: "left" },
  { key: "necessity", label: "必要性", align: "left" },
]

// 將 URL search params 更新推送進 router（值為 null/空字串時移除該 key）。
function useUrlPush() {
  const router = useRouter()
  const sp = useSearchParams()
  return useCallback(
    (updates) => {
      const next = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || v === "") next.delete(k)
        else next.set(k, String(v))
      }
      router.push(`?${next.toString()}`, { scroll: false })
    },
    [router, sp],
  )
}

// 計算分頁頁碼窗格（含首末頁與省略符）。
function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const out = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) out.push("…")
  for (let i = start; i <= end; i++) out.push(i)
  if (end < total - 1) out.push("…")
  out.push(total)
  return out
}

// ---- 分類來源 Badge：以 classification_source 為事實來源（rule/ai/human/pending），
// correction_count 退為 tooltip 補充。取代舊 ConfidenceBadge（用 correction_count 推導，
// 規則系統上線後會把「規則套用」誤標成「AI 分類」）。
function SourceBadge({ row }) {
  const src = row.classification_source
  const corrected = (row.correction_count ?? 0) > 0
  if (src === "rule") {
    return (
      <Badge variant="outline" className="border-info/40 bg-info/10 text-info" title={`規則自動套用${row.rule_id ? `（規則 #${row.rule_id}）` : ""}`}>
        <ListChecks /> 規則
      </Badge>
    )
  }
  if (src === "human" || corrected) {
    return (
      <Badge variant="outline" className="border-success/40 bg-success/10 text-success" title={`已人工修正 ${row.correction_count ?? 0} 次`}>
        <CheckIcon /> 已修正
      </Badge>
    )
  }
  if (src === "pending") {
    return <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning" title="規則未覆蓋且 AI 未分類，待分析">待分析</Badge>
  }
  const uncertain =
    row.owner_primary === "待確認" ||
    row.category_primary === "待確認" ||
    row.necessity === "需確認"
  if (uncertain) {
    return <Badge variant="outline" className="border-danger/40 bg-danger/10 text-danger" title="AI 初分有欄位待確認">需確認</Badge>
  }
  return <Badge variant="outline" className="text-muted-foreground" title="AI 初分類，尚未人工覆核">AI 分類</Badge>
}

// ---- 金額欄：支出（outflow）優先，用語意色 text-destructive；收入用前景色；移轉用柔和色 ----
function AmountCell({ row }) {
  let text, className, sign
  if (Number(row.outflow) > 0) {
    text = formatTWD(row.outflow)
    className = "text-destructive"
    sign = "−"
  } else if (Number(row.inflow) > 0) {
    text = formatTWD(row.inflow)
    className = "text-success"
    sign = "+"
  } else {
    text = formatTWD(row.amount)
    className = "text-muted-foreground"
    sign = ""
  }
  return (
    <span className={cn("tabular-nums font-medium", className)}>
      {sign}
      {text}
    </span>
  )
}

// ---- 欄首排序按鈕：更新 URL sort/direction，切換欄位時預設 desc 並重設回第 1 頁 ----
function SortButton({ column, currentSort, currentDir, onSort }) {
  const active = currentSort === column.key
  const ariaLabel = active
    ? `以${column.label}排序中，目前${currentDir === "asc" ? "升序" : "降序"}，點擊切換方向`
    : `以${column.label}排序`
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={ariaLabel}
      aria-sort={active ? (currentDir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "h-7 gap-1 px-1.5 text-xs font-medium",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        column.align === "right" && "ml-auto",
      )}
      onClick={() => onSort(column.key)}
    >
      <span>{column.label}</span>
      {active ? (
        currentDir === "asc" ? (
          <ChevronUpIcon className="size-3.5" />
        ) : (
          <ChevronDownIcon className="size-3.5" />
        )
      ) : (
        <ChevronsUpDownIcon className="size-3.5 opacity-50" />
      )}
    </Button>
  )
}

// ---- 展開列：行內編輯單筆 ----
function TransactionEditPanel({ row, categoryOptions, onSaved, onClose }) {
  const patchTxn = usePatchTxn()
  const [draft, setDraft] = useState({
    owner_primary: row.owner_primary ?? "",
    category_primary: row.category_primary ?? "",
    necessity: row.necessity ?? "",
    memo: row.memo ?? "",
  })
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(0)

  // 成功打勾顯示 1.8s 後復原
  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setSavedAt(0), 1800)
    return () => clearTimeout(t)
  }, [savedAt])

  const set = (key) => (v) => setDraft((d) => ({ ...d, [key]: v }))
  const memoChanged = (e) => setDraft((d) => ({ ...d, memo: e.target.value }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await patchTxn(row.id, draft)
      setSavedAt(Date.now())
      onSaved?.()
    } catch {
      // 失敗 toast 已由 usePatchTxn 處理
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`edit-owner-${row.id}`}>歸屬</Label>
          <Select value={draft.owner_primary} onValueChange={set("owner_primary")}>
            <SelectTrigger id={`edit-owner-${row.id}`} className="w-full">
              <SelectValue placeholder="選擇歸屬" />
            </SelectTrigger>
            <SelectContent>
              {OWNER_OPTIONS.map((o) => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`edit-category-${row.id}`}>分類</Label>
          <Select value={draft.category_primary} onValueChange={set("category_primary")}>
            <SelectTrigger id={`edit-category-${row.id}`} className="w-full">
              <SelectValue placeholder="選擇分類" />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`edit-necessity-${row.id}`}>必要性</Label>
          <Select value={draft.necessity} onValueChange={set("necessity")}>
            <SelectTrigger id={`edit-necessity-${row.id}`} className="w-full">
              <SelectValue placeholder="選擇必要性" />
            </SelectTrigger>
            <SelectContent>
              {NECESSITY_OPTIONS.map((n) => (
                <SelectItem key={n} value={n}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`edit-memo-${row.id}`}>備註</Label>
        <Textarea
          id={`edit-memo-${row.id}`}
          value={draft.memo}
          onChange={memoChanged}
          placeholder="輸入備註"
          rows={2}
        />
      </div>

      {row.judgment_reason ? (
        <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2.5 text-xs">
          <span className="font-medium text-muted-foreground">分類原因</span>
          <p className="whitespace-pre-wrap text-muted-foreground">{row.judgment_reason}</p>
        </div>
      ) : null}

      {row.raw_info ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">原始資訊</summary>
          <p className="mt-1 whitespace-pre-wrap break-all rounded-md bg-muted/40 p-2">
            {row.raw_info}
          </p>
        </details>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <SourceBadge row={row} />
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2Icon className="animate-spin" /> 儲存中
              </>
            ) : savedAt ? (
              <>
                <CheckIcon /> 已儲存
              </>
            ) : (
              "儲存"
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---- 批次動作列 ----
// 批次目標欄位由 EDITABLE_FIELDS + EDITABLE_LABELS 衍生（單一來源，不再手抄）
const BATCH_FIELDS = EDITABLE_FIELDS.map((key) => ({ key, label: EDITABLE_LABELS[key] }))

function BatchBar({ selectedIds, categoryOptions, onDone, onClear }) {
  const batchMutate = useBatchCorrect()
  const [field, setField] = useState("owner_primary")
  const [value, setValue] = useState("")

  // 切換目標欄位時清空值，避免套用錯欄位的舊值
  useEffect(() => {
    setValue("")
  }, [field])

  const valueOptions = useMemo(() => {
    if (field === "owner_primary") return OWNER_OPTIONS
    if (field === "necessity") return NECESSITY_OPTIONS
    if (field === "category_primary") return categoryOptions
    return []
  }, [field, categoryOptions])

  const [applying, setApplying] = useState(false)

  const handleApply = async () => {
    if (!value || selectedIds.length === 0) return
    setApplying(true)
    try {
      const corrections = selectedIds.map((id) => ({ id, [field]: value }))
      await batchMutate({ corrections })
      onDone?.()
    } catch {
      // 失敗 toast 已由 useBatchCorrect 處理
    } finally {
      setApplying(false)
    }
  }

  const currentFieldLabel = BATCH_FIELDS.find((f) => f.key === field)?.label ?? ""

  return (
    <div
      role="region"
      aria-label="批次動作"
      className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border-t bg-background/95 p-3 backdrop-blur"
    >
      <Badge variant="secondary" className="mr-1">已選 {selectedIds.length} 筆</Badge>

      <div className="flex items-center gap-1.5">
        <Label htmlFor="batch-field" className="sr-only">批次目標欄位</Label>
        <Select value={field} onValueChange={setField}>
          <SelectTrigger id="batch-field" className="h-8 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BATCH_FIELDS.map((f) => (
              <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1.5">
        <Label htmlFor="batch-value" className="sr-only">
          批次{currentFieldLabel}值
        </Label>
        {field === "memo" ? (
          <Input
            id="batch-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`設定${currentFieldLabel}值`}
            className="h-8 w-44"
          />
        ) : (
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger id="batch-value" className="h-8 w-44">
              <SelectValue placeholder={`選擇${currentFieldLabel}`} />
            </SelectTrigger>
            <SelectContent>
              {valueOptions.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Button
        type="button"
        size="sm"
        onClick={handleApply}
        disabled={applying || !value || selectedIds.length === 0}
      >
        {applying ? (
          <>
            <Loader2Icon className="animate-spin" /> 套用中
          </>
        ) : (
          "套用"
        )}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="ml-auto"
      >
        <XIcon /> 清除選取
      </Button>
    </div>
  )
}

// ---- 主元件 ----
export default function TransactionTable() {
  const sp = useSearchParams()
  const push = useUrlPush()

  // 從 URL 讀 sort/direction/page
  const sort = sp.get("sort") || "date"
  const direction = sp.get("direction") === "asc" ? "asc" : "desc"
  const page = Math.max(1, Number(sp.get("page")) || 1)
  const offset = (page - 1) * PAGE_SIZE

  // 組裝給 useTransactions 的查詢字串（帶入所有 URL params + limit/offset）
  const queryParams = useMemo(() => {
    const next = new URLSearchParams()
    for (const [k, v] of sp.entries()) {
      if (v) next.set(k, v)
    }
    next.set("limit", String(PAGE_SIZE))
    next.set("offset", String(offset))
    return next.toString()
    // sp.toString() 在 URL 變動時改變；offset 隨 page 變動
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString(), offset])

  const { data, loading, error, refetch } = useTransactions(queryParams)
  const { data: meta } = useMeta()

  // client state
  const [selectedTxnId, setSelectedTxnId] = useState(null)
  const [batchIds, setBatchIds] = useState([])

  // categories 選項（含現有值確保可選），失敗時 fallback 空陣列不擋編輯
  const categoryOptions = useMemo(() => {
    const list = meta?.filters?.categories?.map((c) => c.value) ?? []
    const seen = new Set(list)
    // 補上目前頁面出現但 meta 沒列出的值（例如剛被改過）
    for (const r of data?.rows ?? []) {
      if (r.category_primary && !seen.has(r.category_primary)) {
        list.push(r.category_primary)
        seen.add(r.category_primary)
      }
    }
    return list
  }, [meta, data])

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  // sort 欄首點擊：同欄 toggle 方向；不同欄預設 desc 並回第 1 頁
  const handleSort = useCallback(
    (key) => {
      if (sort === key) {
        push({ sort: key, direction: direction === "asc" ? "desc" : "asc" })
      } else {
        push({ sort: key, direction: "desc", page: null })
      }
    },
    [sort, direction, push],
  )

  // 批次選取
  const allIds = useMemo(() => rows.map((r) => r.id), [rows])
  const allSelected = batchIds.length > 0 && allIds.every((id) => batchIds.includes(id))
  const toggleAll = (checked) => {
    setBatchIds((prev) => {
      const rest = prev.filter((id) => !allIds.includes(id))
      return checked ? [...rest, ...allIds] : rest
    })
  }
  const toggleOne = (id, checked) => {
    setBatchIds((prev) =>
      checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id),
    )
  }
  const clearBatch = () => setBatchIds([])

  // 批次完成後 refetch + 清選取
  const handleBatchDone = useCallback(() => {
    clearBatch()
    refetch()
  }, [refetch])

  // 單筆儲存後 refetch
  const handleSaved = useCallback(() => {
    refetch()
  }, [refetch])

  // 單筆「確認無誤」：標已審（reviewed=1）後 refetch
  const reviewTxns = useReviewTxns()
  const handleConfirm = useCallback(
    async (id) => {
      try {
        await reviewTxns([id])
        refetch()
      } catch {
        // 失敗 toast 已由 useReviewTxns 處理
      }
    },
    [reviewTxns, refetch],
  )

  const gotoPage = useCallback(
    (p) => {
      const safe = Math.min(Math.max(1, p), totalPages)
      push({ page: safe === 1 ? null : safe })
    },
    [push, totalPages],
  )

  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + rows.length, total)

  return (
    <section aria-label="交易列表" className="flex flex-col gap-3">
      {/* 載入：Skeleton 行 */}
      {loading ? (
        <ScrollArea className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCells sort={sort} direction={direction} onSort={handleSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={SORT_COLUMNS.length + 2}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>載入失敗</AlertTitle>
          <AlertDescription className="flex items-center gap-3">
            <span className="flex-1">{error?.message || "無法取得交易資料"}</span>
            <Button type="button" variant="outline" size="sm" onClick={refetch}>
              <RotateCwIcon /> 重試
            </Button>
          </AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckIcon />
            </EmptyMedia>
            <EmptyTitle>沒有符合條件的交易</EmptyTitle>
            <EmptyDescription>
              調整月份、範圍或搜尋條件，或清除篩選重新查看。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {/* 桌面表格（md 以上）；手機改用下方卡片版型 */}
          <div className="hidden md:block">
          <ScrollArea className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(v) => toggleAll(Boolean(v))}
                      aria-label="全選當頁"
                    />
                  </TableHead>
                  <TableHeaderCells sort={sort} direction={direction} onSort={handleSort} />
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const open = selectedTxnId === row.id
                  const checked = batchIds.includes(row.id)
                  return (
                    <Fragment key={row.id}>
                      <TableRow
                        data-state={open ? "open" : undefined}
                        className={cn(open && "border-b-0")}
                      >
                        <TableCell
                          onClick={(e) => e.stopPropagation()}
                          className="align-middle"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => toggleOne(row.id, Boolean(v))}
                            aria-label={`選取 ${row.name}`}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDate(row.transaction_date)}
                        </TableCell>
                        <TableCell className="max-w-64 truncate font-medium" title={row.name}>
                          {row.name}
                        </TableCell>
                        <TableCell className="text-right">
                          <AmountCell row={row} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {Number(row.outflow) > 0 ? formatTWD(row.outflow) : "—"}
                        </TableCell>
                        <TableCell><FieldBadge value={row.owner_primary} /></TableCell>
                        <TableCell><CategoryBadge row={row} /></TableCell>
                        <TableCell><NecessityBadge value={row.necessity} /></TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {row.ai_confidence != null && (
                              <span
                                className={cn("size-2 rounded-full", row.ai_confidence >= 0.8 ? "bg-success" : row.ai_confidence >= 0.5 ? "bg-warning" : "bg-danger")}
                                title={`AI 信心度 ${Math.round(row.ai_confidence * 100)}%`}
                                aria-label={`AI 信心度 ${Math.round(row.ai_confidence * 100)}%`}
                              />
                            )}
                            <SourceBadge row={row} />
                            {!row.reviewed ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                aria-label={`確認 ${row.name} 分類無誤`}
                                onClick={() => handleConfirm(row.id)}
                              >
                                <CheckIcon /> 確認
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant={open ? "secondary" : "ghost"}
                              size="sm"
                              aria-expanded={open}
                              aria-label={open ? `收起 ${row.name} 的編輯` : `展開 ${row.name} 的編輯`}
                              onClick={() => setSelectedTxnId(open ? null : row.id)}
                            >
                              {open ? "收起" : "編輯"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow className="border-b">
                          <TableCell colSpan={SORT_COLUMNS.length + 2} className="bg-muted/20 p-0">
                            <TransactionEditPanel
                              row={row}
                              categoryOptions={categoryOptions}
                              onSaved={handleSaved}
                              onClose={() => setSelectedTxnId(null)}
                            />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </ScrollArea>
          </div>

          {/* 手機卡片（md 以下）：鏡射 RulesManager 的 space-y-2 md:hidden 慣例 */}
          <div className="space-y-2 md:hidden">
            {rows.map((row) => {
              const open = selectedTxnId === row.id
              const checked = batchIds.includes(row.id)
              return (
                <div key={row.id} className="rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleOne(row.id, Boolean(v))}
                      aria-label={`選取 ${row.name}`}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium" title={row.name}>{row.name}</span>
                        <AmountCell row={row} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="whitespace-nowrap">{formatDate(row.transaction_date)}</span>
                        {row.ai_confidence != null && (
                          <span
                            className={cn("size-2 rounded-full", row.ai_confidence >= 0.8 ? "bg-success" : row.ai_confidence >= 0.5 ? "bg-warning" : "bg-danger")}
                            title={`AI 信心度 ${Math.round(row.ai_confidence * 100)}%`}
                          />
                        )}
                        <SourceBadge row={row} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <FieldBadge value={row.owner_primary} />
                        <CategoryBadge row={row} />
                        <NecessityBadge value={row.necessity} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    {!row.reviewed ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`確認 ${row.name} 分類無誤`}
                        onClick={() => handleConfirm(row.id)}
                      >
                        <CheckIcon /> 確認
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant={open ? "secondary" : "ghost"}
                      size="sm"
                      aria-expanded={open}
                      aria-label={open ? `收起 ${row.name} 的編輯` : `展開 ${row.name} 的編輯`}
                      onClick={() => setSelectedTxnId(open ? null : row.id)}
                    >
                      {open ? "收起" : "編輯"}
                    </Button>
                  </div>
                  {open ? (
                    <div className="mt-2 border-t pt-2">
                      <TransactionEditPanel
                        row={row}
                        categoryOptions={categoryOptions}
                        onSaved={handleSaved}
                        onClose={() => setSelectedTxnId(null)}
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          {/* 分頁 + 計數 */}
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              第 {rangeStart}–{rangeEnd} 筆，共 {total} 筆
            </p>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    text="上一頁"
                    href={`?${buildPageQuery(sp, currentPage - 1)}`}
                    aria-disabled={currentPage <= 1}
                    className={cn(currentPage <= 1 && "pointer-events-none opacity-50")}
                    onClick={(e) => {
                      e.preventDefault()
                      gotoPage(currentPage - 1)
                    }}
                  />
                </PaginationItem>

                {pageWindow(currentPage, totalPages).map((p, i) =>
                  p === "…" ? (
                    <PaginationItem key={`ellipsis-${i}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink
                        href={`?${buildPageQuery(sp, p)}`}
                        isActive={p === currentPage}
                        aria-label={`第 ${p} 頁`}
                        aria-current={p === currentPage ? "page" : undefined}
                        onClick={(e) => {
                          e.preventDefault()
                          gotoPage(p)
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
                    href={`?${buildPageQuery(sp, currentPage + 1)}`}
                    aria-disabled={currentPage >= totalPages}
                    className={cn(currentPage >= totalPages && "pointer-events-none opacity-50")}
                    onClick={(e) => {
                      e.preventDefault()
                      gotoPage(currentPage + 1)
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </>
      )}

      {/* 批次動作列（勾選任何列時顯示） */}
      {batchIds.length > 0 ? (
        <BatchBar
          selectedIds={batchIds}
          categoryOptions={categoryOptions}
          onDone={handleBatchDone}
          onClear={clearBatch}
        />
      ) : null}
    </section>
  )
}

// ---- 表頭欄首群（排序按鈕）----
function TableHeaderCells({ sort, direction, onSort }) {
  return (
    <>
      {SORT_COLUMNS.map((col) => (
        <TableHead key={col.key} className={col.align === "right" ? "text-right" : undefined}>
          {col.sortable === false ? (
            <span className="text-xs font-medium text-muted-foreground px-1.5">{col.label}</span>
          ) : (
            <div className={cn("flex", col.align === "right" ? "justify-end" : "justify-start")}>
              <SortButton column={col} currentSort={sort} currentDir={direction} onSort={onSort} />
            </div>
          )}
        </TableHead>
      ))}
      <TableHead className="text-right text-xs font-medium text-muted-foreground">來源 / 操作</TableHead>
    </>
  )
}

// ---- 歸屬 / 分類 Badge ----
function FieldBadge({ value }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>
  return <Badge variant="outline">{value}</Badge>
}

// 分類 Badge：主類別 + 子類別（如「飲食 – 咖啡」）；子類別缺漏時只顯示主類別。
// category_primary 為 NOT NULL；category_sub 為自由文字（可能 null/空字串）。
function CategoryBadge({ row }) {
  const main = row.category_primary
  const sub = row.category_sub
  const value = main && sub ? `${main} – ${sub}` : main
  return <FieldBadge value={value} />
}

// 必要性 Badge：語意色編碼層級（必要=中性 / 可節省·可優化=警示琥珀 / 需確認=紅 / 不列入=灰）
function NecessityBadge({ value }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>
  let cls = "border-border bg-muted/60 text-foreground"
  if (value === "可節省" || value === "可優化") cls = "border-warning/40 bg-warning/10 text-warning"
  else if (value === "需確認") cls = "border-danger/40 bg-danger/10 text-danger"
  else if (value === "不列入") cls = "border-border bg-muted/40 text-muted-foreground"
  return <Badge variant="outline" className={cls}>{value}</Badge>
}

// 給 PaginationLink/Prev/Next 的 href 用：以當前 search params 為底，覆寫 page。
function buildPageQuery(sp, p) {
  const next = new URLSearchParams(sp.toString())
  if (p <= 1) next.delete("page")
  else next.set("page", String(p))
  return next.toString()
}
