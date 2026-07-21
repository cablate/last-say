"use client"

import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, HeartPulse, RefreshCw } from "lucide-react"

import { formatCurrencyMinor } from "@/lib/format"
import { displayStatus } from "@/lib/finance/presentation-labels"
import { useDataChangeRefetch, useFinancialHealth } from "@/lib/hooks"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

const DATE = /^\d{4}-\d{2}-\d{2}$/

const statusLabels = {
  complete: "完整",
  partial: "部分完成",
  unreconciled: "尚未對帳",
  empty: "沒有資料",
  known: "已知",
  missing: "缺資料",
}

const warningLabels = {
  missing_exposure_mapping: "尚未指定要計算曝險的投資工具。",
  missing_leverage_factor: "已指定投資工具，但尚未指定槓桿倍數。",
  runway_inputs_missing: "尚未提供可靠收入與必要月支出，因此不計算可支撐月數。",
  missing_investment_position_detail: "有投資總值，但缺少部分工具層級持倉明細。",
  missing_liability_balance: "至少一筆負債沒有對應的目前餘額快照。",
  incomplete_debt_service_schedule: "至少一筆負債沒有可用的下一期還款排程。",
  card_statement_due_not_added_to_confirmed_total: "信用卡帳單應繳額另列，尚未併入已確認負債總額。",
}

function money(value, currency) {
  return formatCurrencyMinor(value, currency, { missing: "尚無可靠數值" })
}

function ratio(value) {
  if (value === null || value === undefined) return "尚無可靠數值"
  const numeric = Number(value)
  return Number.isFinite(numeric) ? `${(numeric / 100).toFixed(2)}%` : "尚無可靠數值"
}

function status(value) {
  return statusLabels[value] || displayStatus(value)
}

function HealthSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-3">
      <Skeleton className="h-16 rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
      </div>
    </div>
  )
}

export default function FinancialHealthView() {
  const searchParams = useSearchParams()
  const query = useMemo(() => {
    const params = new URLSearchParams()
    params.set("entity_id", searchParams.get("entity_id") || "personal")
    params.set("currency", searchParams.get("currency") || "TWD")
    const asOfDate = searchParams.get("as_of_date")
    if (DATE.test(asOfDate || "")) params.set("as_of_date", asOfDate)
    return params.toString()
  }, [searchParams])
  const request = useFinancialHealth(query)
  useDataChangeRefetch(request.refetch)

  if (request.loading && !request.data) return <HealthSkeleton />
  if (request.error) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-7xl">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>財務健康檢視載入失敗</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{request.error.message || "無法讀取分析資料"}</span>
          <Button type="button" variant="outline" size="sm" onClick={request.refetch}>
            <RefreshCw aria-hidden="true" />重新整理
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const data = request.data
  if (!data) return null
  const currency = data.scope?.currency || "TWD"
  const position = data.facts?.position || {}
  const liquidity = data.facts?.liquidity || {}
  const investments = data.facts?.investments || {}
  const coverage = data.coverage || {}
  const warnings = [...(coverage.warnings || []), ...(coverage.blockers || [])]
  const stressTests = data.derived?.stress_tests || []

  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-4" aria-labelledby="financial-health-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">截至 {data.scope?.as_of_date || "—"}</p>
          <h2 id="financial-health-title" className="text-2xl font-semibold tracking-tight">財務健康檢視</h2>
          <p className="mt-1 text-sm text-muted-foreground">由目前資料即時重算；這是分析基礎，不會自動替你決定投資。</p>
        </div>
        <span className="rounded-full border px-3 py-1 text-sm">資料狀態：{status(coverage.status)}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>總資產</CardDescription><CardTitle className="font-mono text-xl">{money(position.total_assets_minor, currency)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>確認負債</CardDescription><CardTitle className="font-mono text-xl text-destructive">{money(position.total_liabilities_minor, currency)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>淨資產</CardDescription><CardTitle className="font-mono text-xl text-success">{money(position.net_worth_minor, currency)}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>負債／資產</CardDescription><CardTitle className="font-mono text-xl">{ratio(data.derived?.liability_to_assets_bps)}</CardTitle></CardHeader></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><HeartPulse className="size-4" aria-hidden="true" />流動性與債務</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">現金／活存</span><span className="font-mono">{money(liquidity.cash_minor, currency)}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">現金－確認負債</span><span className="font-mono">{money(liquidity.cash_minus_confirmed_liabilities_minor, currency)}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">已知月還款</span><span className="font-mono">{money(liquidity.known_monthly_debt_service_minor, currency)}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">現金／負債</span><span className="font-mono">{ratio(data.derived?.cash_to_confirmed_liabilities_bps)}</span></div>
            <p className="border-t pt-3 text-xs text-muted-foreground">目前沒有可靠收入與必要月支出，因此不假裝計算 runway。</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>投資與曝險</CardTitle><CardDescription>只有明確提供工具與倍率後才會計算槓桿曝險。</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">投資總值</span><span className="font-mono">{money(investments.balance_sheet_investment_value_minor, currency)}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">已估值持倉</span><span className="font-mono">{money(investments.valued_position_value_minor, currency)}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">目前曝險</span><span className="font-mono">{money(investments.factor_exposure_minor, currency)}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">曝險／淨資產</span><span className="font-mono">{ratio(data.derived?.factor_exposure_to_net_worth_bps)}</span></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>壓力測試</CardTitle><CardDescription>尚未指定工具與倍率時，結果刻意保持未知。</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {stressTests.map((scenario) => (
              <div key={scenario.scenario} className="flex justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                <span className="text-muted-foreground">標的下跌 {Math.abs(Number(scenario.underlying_change_decimal || 0) * 100)}%</span>
                <span className="font-mono">{money(scenario.stress_loss_minor, currency)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {warnings.length > 0 ? (
        <Alert className="border-warning/30 bg-warning/10 text-warning">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>目前不能過度解讀的地方</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5">
              {warnings.map((item, index) => <li key={`${item.kind || "warning"}:${item.resource_key || "unknown"}:${index}`}>{warningLabels[item.kind] || item.label || "仍有資料限制，請先補齊來源。"}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
