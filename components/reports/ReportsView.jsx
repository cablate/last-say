"use client"

import { useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { FileText, Landmark, ReceiptText, WalletCards } from "lucide-react"

import { formatMonth } from "@/lib/format"
import { useIncomeStatement } from "@/lib/hooks"
import CoverageBadge from "@/components/reports/CoverageBadge"
import CoveragePanel from "@/components/reports/CoveragePanel"
import IncomeStatement from "@/components/reports/IncomeStatement"
import ReportSummary from "@/components/reports/ReportSummary"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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

function statusBadge(status) {
  const tone = {
    "部分可用": "border-warning/30 bg-warning/10 text-warning",
    "待補資料": "border-muted-foreground/20 bg-muted text-muted-foreground",
    "待建規則": "border-warning/30 bg-warning/10 text-warning",
  }
  return (
    <Badge variant="outline" className={tone[status] || ""}>
      {status}
    </Badge>
  )
}

function BalanceSheetPreview() {
  const rows = [
    {
      group: "資產",
      item: "現金與銀行帳戶",
      status: "部分可用",
      currentBasis: "交易資料含部分帳戶餘額欄位",
      gap: "仍需要每個帳戶的期末餘額快照、帳戶角色與幣別。",
    },
    {
      group: "負債",
      item: "信用卡應付與貸款",
      status: "待補資料",
      currentBasis: "目前能看到信用卡消費與繳款流水",
      gap: "需要信用卡帳單應付餘額、貸款本金餘額與結帳日。",
    },
    {
      group: "淨值",
      item: "資產減負債",
      status: "待補資料",
      currentBasis: "尚未有完整資產與負債同日快照",
      gap: "等資產與負債都能在同一截止日估值後才輸出淨值。",
    },
  ]

  return (
    <StatementReadinessTable
      icon={Landmark}
      title="資產負債表"
      description="這裡會放截止日的資產、負債與淨值。現在先明確列出缺口，避免把流水帳誤當資產負債表。"
      caption="資產負債表目前的資料可用性與缺口。"
      rows={rows}
    />
  )
}

function CashFlowPreview({ report }) {
  const transactionLabel = report?.transaction_count
    ? `${report.transaction_count} 筆交易`
    : "尚未取得交易筆數"
  const rows = [
    {
      group: "營業活動",
      item: "日常收入與支出",
      status: "部分可用",
      currentBasis: transactionLabel,
      gap: "需要先完成審核，並排除內部轉帳與信用卡繳款後才能穩定輸出。",
    },
    {
      group: "投資活動",
      item: "投資買入、賣出與資產移轉",
      status: "待建規則",
      currentBasis: "部分交易可由報表科目辨識",
      gap: "需要投資帳戶與資產移轉規則，避免把買入誤認成一般支出。",
    },
    {
      group: "融資活動",
      item: "貸款本金、業主投入與提領",
      status: "待補資料",
      currentBasis: "目前只有交易流水",
      gap: "需要本金、利息、業主往來的明確報表科目與帳戶角色。",
    },
  ]

  return (
    <StatementReadinessTable
      icon={WalletCards}
      title="現金流量表"
      description="這裡會把現金流拆成營業、投資、融資活動。現在先顯示哪些資料已可用、哪些規則還缺。"
      caption="現金流量表目前的資料可用性與缺口。"
      rows={rows}
    />
  )
}

function StatementReadinessTable({ icon: Icon, title, description, caption, rows }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{description}</CardDescription>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableCaption>{caption}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">區段</TableHead>
                <TableHead scope="col">科目</TableHead>
                <TableHead scope="col">狀態</TableHead>
                <TableHead scope="col">現有依據</TableHead>
                <TableHead scope="col">還缺什麼</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.group}:${row.item}`}>
                  <TableCell className="whitespace-nowrap font-medium">{row.group}</TableCell>
                  <TableCell className="min-w-36">{row.item}</TableCell>
                  <TableCell className="whitespace-nowrap">{statusBadge(row.status)}</TableCell>
                  <TableCell className="min-w-48 text-muted-foreground">
                    {row.currentBasis}
                  </TableCell>
                  <TableCell className="min-w-64">{row.gap}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ul className="divide-y md:hidden">
          {rows.map((row) => (
            <li key={`${row.group}:${row.item}`} className="space-y-2 py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{row.group}</p>
                  <p className="font-medium">{row.item}</p>
                </div>
                {statusBadge(row.status)}
              </div>
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">現有依據</dt>
                  <dd>{row.currentBasis}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">還缺什麼</dt>
                  <dd>{row.gap}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
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
          <BalanceSheetPreview />
        </TabsContent>

        <TabsContent value="cash" className="space-y-4">
          <CashFlowPreview report={data} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
