"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, RefreshCw } from "lucide-react"

import { formatCurrencyMinor } from "@/lib/format"
import { useCashForecast, useDataChangeRefetch } from "@/lib/hooks"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

const DATE = /^\d{4}-\d{2}-\d{2}$/

function money(value, currency = "TWD") { return formatCurrencyMinor(value, currency, { missing: "未知金額" }) }

export default function CashTimeline() {
  const searchParams = useSearchParams()
  const query = useMemo(() => {
    const params = new URLSearchParams()
    const asOfDate = searchParams.get("as_of_date")
    params.set("as_of_date", DATE.test(asOfDate || "") ? asOfDate : new Date().toLocaleDateString("en-CA"))
    params.set("entity_id", searchParams.get("entity_id") || "personal")
    params.set("currency", searchParams.get("currency") || "TWD")
    params.set("horizon_days", "90")
    return params.toString()
  }, [searchParams])
  const request = useCashForecast(query)
  useDataChangeRefetch(request.refetch)

  if (request.loading && !request.data) return <div className="mx-auto max-w-7xl"><Skeleton className="h-96 rounded-xl" /></div>
  if (request.error) return <Alert variant="destructive" className="mx-auto max-w-7xl"><AlertTitle>現金時間軸載入失敗</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{request.error.message || "無法讀取目前資料"}</span><Button type="button" variant="outline" size="sm" onClick={request.refetch}><RefreshCw aria-hidden="true" />重新整理</Button></AlertDescription></Alert>
  const data = request.data
  if (!data) return null
  const currency = data.scope.currency
  const forecast = data.facts.forecast
  const opening = data.facts.opening_liquid_cash
  const daily = forecast?.daily || []
  return <section className="mx-auto flex max-w-7xl flex-col gap-4" aria-labelledby="cash-timeline-title">
    <div><p className="text-sm text-muted-foreground">截至 {data.scope.as_of_date}，未來 90 天</p><h2 id="cash-timeline-title" className="text-2xl font-semibold tracking-tight">現金會怎麼走</h2><p className="mt-1 text-sm text-muted-foreground">只納入目前有可信餘額的流動現金與已知義務；未確認收入不會被算進來。</p></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Card><CardHeader className="pb-2"><CardDescription>可信期初流動現金</CardDescription><CardTitle className="font-mono text-xl">{money(opening.amount_minor, currency)}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{opening.lines.length} 個帳戶；外幣另行揭露</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardDescription>90 日最低預估現金</CardDescription><CardTitle className="font-mono text-xl">{money(data.derived.minimum_projected_cash_minor, currency)}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{data.derived.minimum_projected_cash_date || "期初現金不可用"}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardDescription>政策狀態</CardDescription><CardTitle className="text-xl">未設定安全底線</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">目前不計算可自由花費金額</CardContent></Card>
    </div>
    {daily.length ? <Card><CardHeader><CardTitle>每日預估</CardTitle><CardDescription>日期與事件由 server read model 產生；前端只格式化。</CardDescription></CardHeader><CardContent><div className="max-h-[28rem] overflow-auto"><div className="min-w-[34rem] divide-y text-sm">{daily.map((row) => <div key={row.date} className="grid grid-cols-[7rem_1fr_9rem] items-center gap-3 py-2"><span className="text-muted-foreground">{row.date}</span><span>{row.event_keys.length ? `${row.event_keys.length} 筆義務事件` : "—"}</span><span className="text-right font-mono tabular-nums">{money(row.closing_projected_cash_minor, currency)}</span></div>)}</div></div></CardContent></Card> : <Card><CardContent className="pt-6 text-sm text-muted-foreground">目前沒有可信期初現金，因此先不產生會誤導的每日時間軸。</CardContent></Card>}
    {data.coverage.blockers?.length || data.coverage.warnings?.length ? <Alert className="border-warning/30 bg-warning/10 text-warning"><AlertTriangle className="size-4" aria-hidden="true" /><AlertTitle>預估仍有缺口</AlertTitle><AlertDescription><ul className="list-disc space-y-1 pl-5">{[...(data.coverage.blockers || []), ...(data.coverage.warnings || [])].map((item, index) => <li key={`${item.kind}:${index}`}>{item.label}</li>)}</ul></AlertDescription></Alert> : null}
  </section>
}
