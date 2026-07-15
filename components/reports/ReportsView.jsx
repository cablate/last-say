"use client"

import { useMemo } from "react"
import { FileText, Landmark, ReceiptText, WalletCards } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"

import { formatMonth } from "@/lib/format"
import { useBalanceSheet, useCashFlow, useIncomeStatement } from "@/lib/hooks"
import BalanceSheet from "@/components/reports/BalanceSheet"
import CashFlowStatement from "@/components/reports/CashFlowStatement"
import CoverageBadge from "@/components/reports/CoverageBadge"
import CoveragePanel from "@/components/reports/CoveragePanel"
import IncomeStatement from "@/components/reports/IncomeStatement"
import ReportSummary from "@/components/reports/ReportSummary"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const STATEMENTS = new Set(["income", "balance", "cash"])
const DEFAULT_BASIS = "card_accrual_management"

function activeStatement(searchParams) {
  const value = searchParams.get("statement") || "income"
  return STATEMENTS.has(value) ? value : "income"
}

function monthEnd(month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return null
  const [year, monthNumber] = month.split("-").map(Number)
  if (monthNumber < 1 || monthNumber > 12) return null
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10)
}

function scopedParams(searchParams, report) {
  const params = new URLSearchParams()
  const entity = searchParams.get("entity_id")
  const currency = searchParams.get("currency")
  if (entity) params.set("entity_id", entity)
  if (currency) params.set("currency", currency)

  if (report === "income") {
    const month = searchParams.get("month")
    if (month) params.set("month", month)
    params.set("basis", DEFAULT_BASIS)
  }
  if (report === "cash") {
    const month = searchParams.get("month")
    const periodStart = searchParams.get("period_start")
    const periodEnd = searchParams.get("period_end")
    if (month) params.set("month", month)
    else if (periodStart && periodEnd) {
      params.set("period_start", periodStart)
      params.set("period_end", periodEnd)
    }
  }
  if (report === "balance") {
    const asOfDate = searchParams.get("as_of_date") || monthEnd(searchParams.get("month"))
    if (asOfDate) params.set("as_of_date", asOfDate)
  }
  return params.toString()
}

function periodLabel(report) {
  if (!report) return "尚未取得報表期間"
  if (report.as_of_date && report.report === "balance_sheet") return `截至 ${report.as_of_date}`
  if (report.month && report.month !== "all") return formatMonth(report.month)
  if (report.period_start && report.period_end) return `${report.period_start} 至 ${report.period_end}`
  return "全部可用期間"
}

function ReportsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="正在載入財務報表">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl sm:w-96" />
      <Skeleton className="h-[32rem] w-full rounded-xl" />
    </div>
  )
}

function EmptyReport({ statement }) {
  const config = {
    income: {
      icon: ReceiptText,
      title: "這個期間沒有可列入損益表的交易",
      description: "請先確認交易期間、帳戶範圍與匯入資料。",
    },
    balance: {
      icon: Landmark,
      title: "目前沒有可列入資產負債表的快照",
      description: "請先為納入分析的帳戶提供餘額、負債或投資估值快照。",
    },
    cash: {
      icon: WalletCards,
      title: "這個期間沒有可列入現金流量表的活動",
      description: "請先確認現金帳戶、交易期間與期初／期末餘額快照。",
    },
  }[statement]
  const Icon = config.icon
  return (
    <Empty className="min-h-72 border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon /></EmptyMedia>
        <EmptyTitle>{config.title}</EmptyTitle>
        <EmptyDescription>{config.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export default function ReportsView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const statement = activeStatement(searchParams)
  const incomeParams = useMemo(() => scopedParams(searchParams, "income"), [searchParams])
  const balanceParams = useMemo(() => scopedParams(searchParams, "balance"), [searchParams])
  const cashParams = useMemo(() => scopedParams(searchParams, "cash"), [searchParams])
  const income = useIncomeStatement(incomeParams)
  const balance = useBalanceSheet(balanceParams)
  const cash = useCashFlow(cashParams)
  const requests = { income, balance, cash }
  const active = requests[statement]
  const report = active.data

  function setStatement(value) {
    const next = new URLSearchParams(searchParams.toString())
    if (value === "income") next.delete("statement")
    else next.set("statement", value)
    const query = next.toString()
    router.replace(query ? `/reports?${query}` : "/reports", { scroll: false })
  }

  function openLine(line) {
    const ids = (line.transaction_ids || []).join(",")
    if (!ids) return
    const next = new URLSearchParams()
    next.set("ids", ids)
    router.push(`/transactions?${next.toString()}`)
  }

  if (active.loading && !report) return <ReportsSkeleton />
  if (active.error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>報表載入失敗</AlertTitle>
        <AlertDescription>{active.error?.message || "無法取得報表資料。"}</AlertDescription>
      </Alert>
    )
  }

  const status = report?.coverage?.status || "empty"

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{periodLabel(report)}</p>
          <h2 className="text-2xl font-semibold tracking-tight">財務報表</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <CoverageBadge status={status} />
        </div>
      </div>

      <CoveragePanel coverage={report?.coverage} />
      {statement === "income" && status !== "empty" ? <ReportSummary report={report} /> : null}

      <Tabs value={statement} onValueChange={setStatement} className="gap-4">
        <TabsList className="grid h-auto w-full grid-cols-3 sm:w-fit">
          <TabsTrigger value="income"><ReceiptText data-icon="inline-start" />損益表</TabsTrigger>
          <TabsTrigger value="balance"><Landmark data-icon="inline-start" />資產負債表</TabsTrigger>
          <TabsTrigger value="cash"><WalletCards data-icon="inline-start" />現金流量表</TabsTrigger>
        </TabsList>

        <TabsContent value="income" className="space-y-4">
          {statement === "income" && status === "empty"
            ? <EmptyReport statement="income" />
            : (income.data ? <IncomeStatement report={income.data} onLineClick={openLine} /> : null)}
        </TabsContent>
        <TabsContent value="balance" className="space-y-4">
          {statement === "balance" && status === "empty"
            ? <EmptyReport statement="balance" />
            : (balance.data ? <BalanceSheet report={balance.data} /> : null)}
        </TabsContent>
        <TabsContent value="cash" className="space-y-4">
          {statement === "cash" && status === "empty"
            ? <EmptyReport statement="cash" />
            : (cash.data ? <CashFlowStatement report={cash.data} onLineClick={openLine} /> : null)}
        </TabsContent>
      </Tabs>
    </div>
  )
}
