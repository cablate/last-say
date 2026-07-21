"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, CalendarClock, RefreshCw } from "lucide-react"

import { formatCurrencyMinor } from "@/lib/format"
import { displayEventKind, displayStatus } from "@/lib/finance/presentation-labels"
import { useDataChangeRefetch, useObligationTimeline } from "@/lib/hooks"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

const DATE = /^\d{4}-\d{2}-\d{2}$/
const STATUS_LABELS = { scheduled: "已排程", partial: "部分已付", settled: "已清償", due: "到期", unreconciled: "未對帳", provisional: "暫定" }

function money(value, currency = "TWD") { return formatCurrencyMinor(value, currency, { missing: "未知金額" }) }

export default function UpcomingCommitments() {
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
  const request = useObligationTimeline(query)
  useDataChangeRefetch(request.refetch)

  if (request.loading && !request.data) return <div className="mx-auto max-w-7xl"><Skeleton className="h-80 rounded-xl" /></div>
  if (request.error) return <Alert variant="destructive" className="mx-auto max-w-7xl"><AlertTitle>義務時間軸載入失敗</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{request.error.message || "無法讀取目前資料"}</span><Button type="button" variant="outline" size="sm" onClick={request.refetch}><RefreshCw aria-hidden="true" />重新整理</Button></AlertDescription></Alert>
  const data = request.data
  if (!data) return null
  const currency = data.scope.currency
  return <section className="mx-auto flex max-w-7xl flex-col gap-4" aria-labelledby="upcoming-obligations-title">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-muted-foreground">截至 {data.scope.as_of_date}，未來 90 天</p><h2 id="upcoming-obligations-title" className="text-2xl font-semibold tracking-tight">接下來要付什麼</h2><p className="mt-1 text-sm text-muted-foreground">只顯示已知或明確揭露不完整的信用卡、貸款與固定義務；這不是可自由花費金額。</p></div><span className="rounded-full border px-3 py-1 text-sm">資料狀態：{displayStatus(data.coverage.status)}</span></div>
    <div className="grid gap-3 sm:grid-cols-3">{data.facts.windows.map((window) => <Card key={window.days}><CardHeader className="pb-2"><CardDescription>未來 {window.days} 天精確金額</CardDescription><CardTitle className="font-mono text-xl">{money(window.known_amount_minor, currency)}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{window.event_count} 筆；範圍 {money(window.range_min_minor, currency)}–{money(window.range_max_minor, currency)}，未知 {window.unknown_amount_count} 筆</CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" aria-hidden="true" />義務清單</CardTitle><CardDescription>付款會單獨列為現金流，不會再次算成消費。</CardDescription></CardHeader><CardContent>{data.facts.events.length ? <div className="divide-y">{data.facts.events.map((event) => <div key={event.event_key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{event.display_name}</p><p className="text-xs text-muted-foreground">{event.due_date} · {displayEventKind(event.kind)} · {STATUS_LABELS[event.status] || displayStatus(event.status)} · {event.reliability === "committed" ? "已確認" : "仍有不確定性"}</p></div><span className="font-mono tabular-nums">{event.amount_minor === null ? (event.amount_min_minor === null ? "未知金額" : `${money(event.amount_min_minor, currency)}–${money(event.amount_max_minor, currency)}`) : money(event.amount_minor, currency)}</span></div>)}</div> : <p className="text-sm text-muted-foreground">未來 90 天沒有可用的義務事件。</p>}</CardContent></Card>
    {data.coverage.blockers?.length || data.coverage.warnings?.length ? <Alert className="border-warning/30 bg-warning/10 text-warning"><AlertTriangle className="size-4" aria-hidden="true" /><AlertTitle>時間軸仍有缺口</AlertTitle><AlertDescription><ul className="list-disc space-y-1 pl-5">{[...(data.coverage.blockers || []), ...(data.coverage.warnings || [])].map((item, index) => <li key={`${item.kind}:${index}`}>{item.label}</li>)}</ul></AlertDescription></Alert> : null}
  </section>
}
