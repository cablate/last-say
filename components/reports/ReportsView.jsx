"use client"

import { useMemo } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { FileText, Landmark, ReceiptText, WalletCards } from "lucide-react"

import { formatMonth } from "@/lib/format"
import { useIncomeStatement } from "@/lib/hooks"
import CoverageBadge from "@/components/reports/CoverageBadge"
import CoveragePanel from "@/components/reports/CoveragePanel"
import IncomeStatement from "@/components/reports/IncomeStatement"
import ReportSummary from "@/components/reports/ReportSummary"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const REPORT_PARAM_KEYS = ["month", "entity_id", "basis", "currency"]
const STATEMENTS = new Set(["income", "balance", "cash"])
const BASIS_OPTIONS = [
  { value: "card_accrual_management", label: "管理用信用卡權責制" },
  { value: "cash", label: "現金制" },
]
const DEFAULT_BASIS = "card_accrual_management"

function reportParams(searchParams) {
  const params = new URLSearchParams()
  for (const key of REPORT_PARAM_KEYS) {
    const value = searchParams.get(key)
    if (value) params.set(key, value)
  }
  return params.toString()
}

function activeStatement(searchParams) {
  const value = searchParams.get("statement") || "income"
  return STATEMENTS.has(value) ? value : "income"
}

function activeBasis(searchParams) {
  const value = searchParams.get("basis") || ""
  return BASIS_OPTIONS.some((option) => option.value === value)
    ? value
    : DEFAULT_BASIS
}

// coverage_percent = (mapped 且 reviewed) / total * 100。
// mapped 且 reviewed 近似為 total - unmapped - unreviewed（兩者為獨立阻擋條件）。
function coveragePercent(report) {
  const total = Number(report?.transaction_count) || 0
  if (total === 0) return null
  const unmapped = Number(report?.unmapped_transaction_count) || 0
  const unreviewed = Number(report?.unreviewed_transaction_count) || 0
  const ready = Math.max(0, total - unmapped - unreviewed)
  return Math.round((ready / total) * 100)
}

function periodLabel(report) {
  if (!report) return "目前範圍"
  if (report.month && report.month !== "all") return formatMonth(report.month)
  if (report.period_start && report.period_end) {
    return `${report.period_start} 至 ${report.period_end}`
  }
  return "全部期間"
}

function ReportsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl sm:w-96" />
      <Skeleton className="h-[32rem] w-full rounded-xl" />
    </div>
  )
}

function StatementUnavailable({ icon: Icon, title, description }) {
  return (
    <Empty className="min-h-72 border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon /></EmptyMedia>
        <EmptyTitle>{title}正式報表尚未實作</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
        <EmptyDescription>
          <Link href="/data">前往財務資料中心檢查帳戶、餘額、負債、持倉與對帳狀態</Link>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export default function ReportsView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const params = useMemo(() => reportParams(searchParams), [searchParams])
  const statement = activeStatement(searchParams)
  const basis = activeBasis(searchParams)
  const { data, loading, error } = useIncomeStatement(params)

  function setStatement(value) {
    const next = new URLSearchParams(searchParams.toString())
    if (value === "income") next.delete("statement")
    else next.set("statement", value)
    const query = next.toString()
    router.replace(query ? `/reports?${query}` : "/reports", { scroll: false })
  }

  function setBasis(value) {
    const next = new URLSearchParams(searchParams.toString())
    if (value === DEFAULT_BASIS) next.delete("basis")
    else next.set("basis", value)
    const query = next.toString()
    router.replace(query ? `/reports?${query}` : "/reports", { scroll: false })
  }

  function openLine(line) {
    const ids = (line.transaction_ids || []).join(",")
    if (!ids) return
    const next = new URLSearchParams(searchParams.toString())
    next.set("ids", ids)
    next.delete("page")
    next.delete("view")
    router.push(`/transactions?${next.toString()}`)
  }

  if (loading && !data) return <ReportsSkeleton />

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>報表載入失敗</AlertTitle>
        <AlertDescription>
          {error?.message || "損益表 API 回傳錯誤。"}
        </AlertDescription>
      </Alert>
    )
  }

  const status = data?.coverage?.status || "empty"
  const activeStatus = statement === "income" ? status : "partial"
  const covPercent = coveragePercent(data)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{periodLabel(data)}</p>
          <h2 className="text-2xl font-semibold tracking-tight">
            財務報表
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={basis} onValueChange={setBasis}>
            <SelectTrigger size="sm" className="w-[180px]" aria-label="選擇報表基礎">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BASIS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <CoverageBadge status={activeStatus} />
            {covPercent !== null ? (
              <span className="text-xs text-muted-foreground">{covPercent}%</span>
            ) : null}
          </div>
        </div>
      </div>

      {statement === "income" ? <CoveragePanel coverage={data?.coverage} /> : null}

      {statement === "income" && status !== "empty" ? (
        <ReportSummary report={data} />
      ) : null}

      <Tabs value={statement} onValueChange={setStatement} className="gap-4">
        <TabsList className="grid h-auto w-full grid-cols-3 sm:w-fit">
          <TabsTrigger value="income">
            <ReceiptText data-icon="inline-start" />
            損益表
          </TabsTrigger>
          <TabsTrigger value="balance">
            <Landmark data-icon="inline-start" />
            資產負債表
          </TabsTrigger>
          <TabsTrigger value="cash">
            <WalletCards data-icon="inline-start" />
            現金流量表
          </TabsTrigger>
        </TabsList>

        <TabsContent value="income" className="space-y-4">
          {status === "empty" ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileText />
                </EmptyMedia>
                <EmptyTitle>這個範圍沒有損益資料</EmptyTitle>
                <EmptyDescription>
                  請改選其他月份，或先匯入並審核交易，再閱讀管理報表。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <IncomeStatement report={data} onLineClick={openLine} />
          )}
        </TabsContent>

        <TabsContent value="balance" className="space-y-4">
          <StatementUnavailable
            icon={Landmark}
            title="資產負債表"
            description="目前已有 typed 財務資料與就緒度檢查，但尚未有正式的同日估值、coverage 與資產＝負債＋權益查詢；這裡不先顯示推測結果。"
          />
        </TabsContent>

        <TabsContent value="cash" className="space-y-4">
          <StatementUnavailable
            icon={WalletCards}
            title="現金流量表"
            description="目前尚未完成營業、投資、融資活動的正式分類與期初期末現金 reconciliation；這裡不以交易筆數或靜態規則暗示報表可用。"
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
