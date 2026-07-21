"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, BriefcaseBusiness, RefreshCw, WalletCards } from "lucide-react"

import { formatCurrencyMinor } from "@/lib/format"
import { displayCadence, displayCommitmentKind, displayStatus } from "@/lib/finance/presentation-labels"
import { useDataChangeRefetch, useSpendingStructure } from "@/lib/hooks"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

function money(value, currency = "TWD") {
  return formatCurrencyMinor(value, currency, { missing: "尚無可靠數值" })
}

function StructureSkeleton() {
  return <div className="mx-auto flex max-w-7xl flex-col gap-3" aria-label="正在載入支出結構"><Skeleton className="h-16 rounded-xl" /><div className="grid gap-3 sm:grid-cols-3"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /></div><Skeleton className="h-64 rounded-xl" /></div>
}

export default function SpendingStructureView() {
  const searchParams = useSearchParams()
  const month = searchParams.get("month") || ""
  const validMonth = MONTH.test(month)
  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (validMonth) params.set("month", month)
    params.set("entity_id", searchParams.get("entity_id") || "personal")
    params.set("currency", searchParams.get("currency") || "TWD")
    params.set("basis", "card_accrual_management")
    return params.toString()
  }, [month, searchParams, validMonth])
  const request = useSpendingStructure(query, validMonth)
  useDataChangeRefetch(request.refetch)

  if (!validMonth) return null
  if (request.loading && !request.data) return <StructureSkeleton />
  if (request.error) {
    return <Alert variant="destructive" className="mx-auto max-w-7xl"><AlertTriangle aria-hidden="true" /><AlertTitle>支出結構載入失敗</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{request.error.message || "無法讀取目前資料"}</span><Button type="button" variant="outline" size="sm" onClick={request.refetch}><RefreshCw aria-hidden="true" />重新整理</Button></AlertDescription></Alert>
  }

  const data = request.data
  if (!data) return null
  const currency = data.scope.currency
  const facts = data.facts
  const derived = data.derived
  return <section className="mx-auto flex max-w-7xl flex-col gap-4" aria-labelledby="spending-structure-title">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm text-muted-foreground">{data.scope.period_start} 至 {data.scope.period_end}</p><h2 id="spending-structure-title" className="text-2xl font-semibold tracking-tight">支出結構與報銷</h2><p className="mt-1 text-sm text-muted-foreground">固定事實、支出分類與報銷回收分開呈現；不把「可能可省」猜成結論。</p></div>
      <span className="rounded-full border px-3 py-1 text-sm">資料狀態：{displayStatus(data.coverage.status)}</span>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Card><CardHeader className="pb-2"><CardDescription>已確認管理支出</CardDescription><CardTitle className="font-mono text-xl">{money(facts.confirmed_expense_minor, currency)}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">沿用同一張管理損益表，排除卡費繳款、貸款本金與投資買入。</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardDescription>已確認報銷回收</CardDescription><CardTitle className="font-mono text-xl text-success">{money(facts.confirmed_reimbursement_recovery_minor, currency)}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">只計入已確認 allocation；proposal 仍獨立列出。</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardDescription>確認回收後淨支出</CardDescription><CardTitle className="font-mono text-xl">{money(derived.net_expense_after_confirmed_recovery_minor, currency)}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">這是觀察值，不等於個人必要支出或可省金額。</CardContent></Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><WalletCards className="size-4" aria-hidden="true" />支出科目</CardTitle><CardDescription>每一列都能透過 transaction keys 回查原始交易。</CardDescription></CardHeader><CardContent>{facts.expense_lines.length ? <div className="divide-y">{facts.expense_lines.map((line) => <div key={line.report_line} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{line.label}</p><p className="text-xs text-muted-foreground">{line.transaction_count} 筆 · {line.classification === "explicit_business_operating" ? "明確業務營運支出" : "一般支出科目"}</p></div><span className="font-mono tabular-nums">{money(line.amount_minor, currency)}</span></div>)}</div> : <p className="text-sm text-muted-foreground">本月沒有已確認支出科目。</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><BriefcaseBusiness className="size-4" aria-hidden="true" />固定義務</CardTitle><CardDescription>只列出你已確認的固定義務。</CardDescription></CardHeader><CardContent>{facts.confirmed_commitments.length ? <div className="space-y-3">{facts.confirmed_commitments.map((item) => <div key={item.commitment_key} className="border-b pb-3 last:border-0 last:pb-0"><p className="font-medium">{displayCommitmentKind(item.commitment_kind)}</p><p className="font-mono text-sm">{item.amount_kind === "fixed" ? money(item.amount_minor, currency) : `${money(item.amount_min_minor, currency)} – ${money(item.amount_max_minor, currency)}`}</p><p className="text-xs text-muted-foreground">{displayCadence(item.cadence)} · 下次 {item.next_due_date || "未設定"}</p></div>)}</div> : <p className="text-sm text-muted-foreground">目前沒有已確認固定義務；候選不會冒充固定支出。</p>}</CardContent></Card>
    </div>
    {data.coverage.warnings?.length ? <Alert className="border-warning/30 bg-warning/10 text-warning"><AlertTriangle className="size-4" aria-hidden="true" /><AlertTitle>分析限制</AlertTitle><AlertDescription><ul className="list-disc space-y-1 pl-5">{data.coverage.warnings.map((item, index) => <li key={`${item.kind}:${index}`}>{item.label}</li>)}</ul></AlertDescription></Alert> : null}
    {facts.proposed_reimbursements.length ? <Alert className="border-warning/30 bg-warning/10 text-warning"><AlertTitle>有 {facts.proposed_reimbursements.length} 筆報銷待確認</AlertTitle><AlertDescription>這些金額尚未從支出扣除，請到資料確認頁處理。</AlertDescription></Alert> : null}
  </section>
}
