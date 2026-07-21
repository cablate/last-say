"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import {
  ArrowDownRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Landmark,
  ListChecks,
  RefreshCw,
  TriangleAlert,
} from "lucide-react"

import {
  dashboardStatus,
  dashboardTasks,
  investmentShareOfNetWorthBps,
  liabilityShareBps,
  monthlyObligationSummary,
} from "@/lib/finance/control/dashboard-presentation"
import { formatCurrencyMinor, formatTWD } from "@/lib/format"
import { displayInstrumentName, displayLiabilityKind } from "@/lib/finance/presentation-labels"
import {
  useDataChangeRefetch,
  useFinancialDashboardHistory,
  useFinancialHealth,
  useMonthlyFinancialPulse,
  useSpendingStructure,
} from "@/lib/hooks"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

function localDate() {
  return new Date().toLocaleDateString("en-CA")
}

function monthEnd(month) {
  if (!MONTH.test(month)) return null
  const [year, monthNumber] = month.split("-").map(Number)
  return new Date(year, monthNumber, 0).toLocaleDateString("en-CA")
}

function asOfDateForMonth(month) {
  const end = monthEnd(month)
  if (!end) return localDate()
  return end > localDate() ? localDate() : end
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function money(value, currency = "TWD", { signed = false } = {}) {
  const numeric = finite(value)
  if (numeric === null) return "尚無法計算"
  if (currency !== "TWD") {
    return formatCurrencyMinor(numeric, currency, { signed, missing: "尚無法計算" })
  }
  const sign = signed && numeric !== 0 ? (numeric > 0 ? "+" : "−") : ""
  return `${sign}${formatTWD(Math.abs(numeric))}`
}

function percentFromBps(value) {
  const numeric = finite(value)
  if (numeric === null) return "尚無法計算"
  return `${Math.max(0, numeric / 100).toFixed(1)}%`
}

function apr(value) {
  const numeric = finite(value)
  if (numeric === null) return "未提供"
  return `${(numeric * 100).toLocaleString("zh-TW", { maximumFractionDigits: 3 })}%`
}

function shortDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value || ""
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`
}

function shortMonth(value) {
  if (!MONTH.test(value || "")) return value || ""
  return `${Number(value.slice(0, 4))}/${Number(value.slice(5, 7))}`
}

function scopedHref(href, month) {
  const [pathname, query = ""] = href.split("?")
  const params = new URLSearchParams(query)
  if (month && ["/transactions", "/reports", "/control"].includes(pathname)) {
    params.set("month", month)
  }
  const nextQuery = params.toString()
  return nextQuery ? `${pathname}?${nextQuery}` : pathname
}

function exposureHref(searchParams, instrumentKey, factor = "2") {
  const params = new URLSearchParams(searchParams.toString())
  params.set("taiwan_instrument_keys", instrumentKey)
  params.set("taiwan_leverage_factor", factor)
  return `/control?${params.toString()}`
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5" aria-label="正在載入財務儀表板">
      <Skeleton className="h-20 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="h-[25rem] rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  )
}

function Metric({ label, value, hint, tone = "default" }) {
  const toneClass = tone === "danger"
    ? "text-destructive"
    : tone === "positive"
      ? "text-primary"
      : "text-foreground"
  return (
    <article className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p>
    </article>
  )
}

function Panel({ title, eyebrow, children, action, className = "" }) {
  return (
    <section className={`min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm ${className}`}>
      <header className="flex min-h-16 items-center justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0">
          {eyebrow ? <p className="text-xs font-medium text-muted-foreground">{eyebrow}</p> : null}
          <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

function ValueCell({ label, value, tone = "default", note }) {
  const toneClass = tone === "danger" ? "text-destructive" : tone === "positive" ? "text-primary" : "text-foreground"
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p> : null}
    </div>
  )
}

const TASK_ICONS = {
  reimbursements: ListChecks,
  "debt-schedule": ClipboardList,
  "investment-exposure": TriangleAlert,
  "transaction-review": ListChecks,
  "balance-boundary": Landmark,
}

function TaskList({ tasks, month }) {
  if (tasks.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-primary/5 px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="size-4" aria-hidden="true" /></span>
        <div><p className="font-medium">目前沒有優先資料待辦</p><p className="text-sm text-muted-foreground">資料更新後會自動重新檢查。</p></div>
      </div>
    )
  }

  return (
    <ul className="grid gap-3 lg:grid-cols-3" role="list">
      {tasks.map((task) => {
        const Icon = TASK_ICONS[task.key] || ListChecks
        return (
          <li key={task.key}>
            <Link
              href={scopedHref(task.href, month)}
              className="group flex h-full min-w-0 items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"><Icon className="size-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block font-medium">{task.title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{task.description}</span></span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function debtRows(debt = {}) {
  const lines = new Map((debt.liability_lines || []).map((line) => [line.account_key, line]))
  const loans = (debt.liability_profiles || []).map((profile) => ({
    key: profile.liability_key,
    kind: "loan",
    name: profile.display_name || displayLiabilityKind(profile.liability_kind),
    balanceMinor: profile.current_balance_minor,
    snapshotDate: lines.get(profile.account_key)?.snapshot_date || null,
    apr: profile.apr_decimal,
    nextPaymentMinor: profile.next_scheduled_payment?.amount_minor ?? null,
    nextPaymentDate: profile.next_scheduled_payment?.due_date ?? null,
    remainingEntries: profile.schedule_entry_count > 0 ? profile.remaining_schedule_entry_count : null,
  }))
  const cards = (debt.credit_cards || []).map((card) => ({
    key: card.profile_key,
    kind: "card",
    name: card.display_name || "信用卡",
    balanceMinor: lines.get(card.account_key)?.balance_minor ?? null,
    snapshotDate: lines.get(card.account_key)?.snapshot_date || null,
    apr: null,
    nextPaymentMinor: finite(card.unpaid_due_minor) > 0 ? card.unpaid_due_minor : null,
    nextPaymentDate: finite(card.unpaid_due_minor) > 0 ? card.statement?.due_date : null,
    remainingEntries: null,
    lastStatementSettled: card.unpaid_due_minor === "0",
  }))
  return [...loans, ...cards]
}

function DebtList({ debt, currency }) {
  const rows = debtRows(debt)
  if (!rows.length) return <p className="text-sm text-muted-foreground">尚未建立負債資料。</p>
  return (
    <div>
      <div className="hidden grid-cols-[minmax(10rem,1.4fr)_1fr_.65fr_1fr_.8fr] gap-4 border-b pb-2 text-xs font-medium text-muted-foreground sm:grid">
        <span>項目</span><span>目前餘額</span><span>年利率</span><span>下一筆月付</span><span>剩餘排程</span>
      </div>
      <ul className="divide-y" role="list">
        {rows.map((row) => (
          <li key={row.key} className="grid gap-3 py-4 first:pt-3 last:pb-0 sm:grid-cols-[minmax(10rem,1.4fr)_1fr_.65fr_1fr_.8fr] sm:items-center sm:gap-4">
            <div className="min-w-0"><p className="font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.kind === "card" ? "信用卡" : "貸款"}{row.snapshotDate ? ` · 餘額 ${shortDate(row.snapshotDate)}` : ""}</p></div>
            <div><span className="text-xs text-muted-foreground sm:hidden">目前餘額　</span><span className="font-medium tabular-nums">{money(row.balanceMinor, currency)}</span></div>
            <div><span className="text-xs text-muted-foreground sm:hidden">年利率　</span><span className="tabular-nums">{row.kind === "card" ? "不適用" : apr(row.apr)}</span></div>
            <div><span className="text-xs text-muted-foreground sm:hidden">下一筆月付　</span><span className={row.nextPaymentMinor === null ? "text-warning" : "font-medium tabular-nums"}>{row.nextPaymentMinor === null ? (row.lastStatementSettled ? "上期已繳清" : "尚未建檔") : money(row.nextPaymentMinor, currency)}</span>{row.nextPaymentDate ? <p className="text-xs text-muted-foreground">{shortDate(row.nextPaymentDate)} 到期</p> : null}</div>
            <div><span className="text-xs text-muted-foreground sm:hidden">剩餘排程　</span><span className={row.remainingEntries === null ? "text-warning" : "tabular-nums"}>{row.kind === "card" ? "帳單制" : row.remainingEntries === null ? "尚未建檔" : `${row.remainingEntries} 筆`}</span></div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function FinancialDashboard() {
  const searchParams = useSearchParams()
  const month = searchParams.get("month") || ""
  const validMonth = MONTH.test(month)
  const entityId = searchParams.get("entity_id") || "personal"
  const currency = searchParams.get("currency") || "TWD"
  const exposureInstrumentKeys = searchParams.get("taiwan_instrument_keys") || ""
  const exposureLeverageFactor = searchParams.get("taiwan_leverage_factor") || ""

  const monthlyQuery = useMemo(() => {
    const params = new URLSearchParams({ month, entity_id: entityId, currency, basis: "card_accrual_management" })
    return params.toString()
  }, [currency, entityId, month])
  const healthQuery = useMemo(() => {
    const params = new URLSearchParams({ as_of_date: asOfDateForMonth(month), entity_id: entityId, currency })
    if (exposureInstrumentKeys && exposureLeverageFactor) {
      params.set("taiwan_instrument_keys", exposureInstrumentKeys)
      params.set("taiwan_leverage_factor", exposureLeverageFactor)
    }
    return params.toString()
  }, [currency, entityId, exposureInstrumentKeys, exposureLeverageFactor, month])

  const pulseRequest = useMonthlyFinancialPulse(monthlyQuery, validMonth)
  const healthRequest = useFinancialHealth(healthQuery, validMonth)
  const spendingRequest = useSpendingStructure(monthlyQuery, validMonth)
  const historyRequest = useFinancialDashboardHistory(monthlyQuery, validMonth)
  useDataChangeRefetch(pulseRequest.refetch)
  useDataChangeRefetch(healthRequest.refetch)
  useDataChangeRefetch(spendingRequest.refetch)
  useDataChangeRefetch(historyRequest.refetch)

  if (!validMonth) {
    return (
      <div className="mx-auto flex min-h-72 w-full max-w-[1180px] flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center">
        <CircleDollarSign className="size-8 text-primary" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold">請先選擇一個月份</h2>
        <p className="mt-1 text-sm text-muted-foreground">儀表板會依該月交易與目前可用餘額重新計算。</p>
      </div>
    )
  }

  const hasAnyData = pulseRequest.data || healthRequest.data || spendingRequest.data || historyRequest.data
  if (!hasAnyData && (pulseRequest.loading || healthRequest.loading || spendingRequest.loading || historyRequest.loading)) return <DashboardSkeleton />

  const pulse = pulseRequest.data
  const health = healthRequest.data
  const spending = spendingRequest.data
  const history = historyRequest.data
  const position = health?.facts?.position || {}
  const liquidity = health?.facts?.liquidity || {}
  const debt = health?.facts?.debt || {}
  const investments = health?.facts?.investments || {}
  const management = pulse?.facts?.management_pl || {}
  const cashFlow = pulse?.facts?.cash_flow || {}
  const averages = history?.derived || {}
  const status = dashboardStatus({ health, pulse })
  const tasks = dashboardTasks({ health, pulse, spending })
  const obligations = monthlyObligationSummary({ spending, health, currency })
  const liabilityBps = liabilityShareBps(health)
  const investmentBps = investmentShareOfNetWorthBps(health)
  const largestPosition = investments.largest_positions?.[0]
  const positionLabel = largestPosition?.symbol?.endsWith("-AGG")
    ? "台股持倉（總額快照）"
    : largestPosition?.symbol || (largestPosition?.instrument_name ? displayInstrumentName(largestPosition.instrument_name) : "尚無持倉明細")
  const exposureAvailable = finite(investments.factor_exposure_minor) !== null
  const selectedLargestPosition = investments.selected_instrument_keys?.includes(largestPosition?.instrument_key)
  const exposureAssumptionLabel = exposureInstrumentKeys && exposureLeverageFactor
    ? `${selectedLargestPosition ? largestPosition.symbol : "指定標的"}市值 × ${exposureLeverageFactor}（此頁情境）`
    : null
  const canApplyKnownLeverage = !exposureAvailable && largestPosition?.symbol === "00675L" && largestPosition?.instrument_key
  const asOfDate = asOfDateForMonth(month)
  const partialMonth = monthEnd(month) > asOfDate
  const historyMonths = history?.facts?.months || []
  const historyRange = historyMonths.length ? `${shortMonth(historyMonths[0].month)}–${shortMonth(historyMonths.at(-1).month)}` : "尚無期間"
  const historyPartialCount = history?.coverage?.warnings?.find((item) => item.kind === "historical_months_partial")?.count || 0
  const requestErrors = [pulseRequest.error, healthRequest.error, spendingRequest.error, historyRequest.error].filter(Boolean)

  const statusClasses = status.tone === "danger"
    ? "border-destructive/30 bg-destructive/5"
    : status.tone === "unknown"
      ? "border-warning/30 bg-warning/5"
      : "border-primary/30 bg-primary/5"
  const statusIconClass = status.tone === "danger" ? "bg-destructive" : status.tone === "unknown" ? "bg-warning" : "bg-primary"

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5" id="financial-dashboard-content">
      {requestErrors.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>部分資料暫時讀取失敗，畫面只顯示目前取得的內容。</span>
          <Button type="button" variant="outline" size="sm" onClick={() => { pulseRequest.refetch(); healthRequest.refetch(); spendingRequest.refetch(); historyRequest.refetch() }}>
            <RefreshCw aria-hidden="true" />重新整理
          </Button>
        </div>
      ) : null}

      <section className={`flex items-start gap-4 rounded-xl border px-5 py-4 ${statusClasses}`} aria-labelledby="dashboard-status-title">
        <span className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full text-white ${statusIconClass}`}>
          {status.tone === "positive" ? <Check className="size-5" aria-hidden="true" /> : <TriangleAlert className="size-5" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{month}{partialMonth ? ` · 截至 ${shortDate(asOfDate)}` : " · 完整月份"}</p>
          <h2 id="dashboard-status-title" className="mt-0.5 text-base font-semibold sm:text-lg">{status.title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{status.detail}</p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="主要財務數字">
        <Metric label="淨資產" value={money(position.net_worth_minor, currency)} hint={`總資產 ${money(position.total_assets_minor, currency)} 扣除負債`} tone={finite(position.net_worth_minor) >= 0 ? "positive" : "danger"} />
        <Metric label="現金與活存" value={money(liquidity.cash_minor, currency)} hint={`截至 ${shortDate(position.as_of_date || asOfDate)} 的可用餘額快照`} tone="positive" />
        <Metric label="確認負債" value={money(position.total_liabilities_minor, currency)} hint={`約占總資產 ${percentFromBps(liabilityBps)}`} tone="danger" />
        <Metric label="投資總市值" value={money(investments.balance_sheet_investment_value_minor, currency)} hint={`約占淨資產 ${percentFromBps(investmentBps)}`} />
      </section>

      <Panel
        title="每月收支能力"
        eyebrow={partialMonth ? `${month} 尚未結束，只看截至 ${shortDate(asOfDate)}` : `${month} 完整月份`}
        action={<Button asChild variant="ghost" size="sm"><Link href={scopedHref("/reports?statement=income", month)}>收支明細<ChevronRight aria-hidden="true" /></Link></Button>}
      >
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-0">
          <section className="min-w-0 lg:border-r lg:pr-6" aria-labelledby="current-month-heading">
            <div className="flex items-center justify-between gap-3"><h3 id="current-month-heading" className="font-semibold">本月已確認</h3><span className="text-xs text-muted-foreground">{partialMonth ? `截至 ${shortDate(asOfDate)}` : "整月"}</span></div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
              <ValueCell label="收入" value={money(management.confirmed_revenue_minor, currency)} tone="positive" />
              <ValueCell label="支出" value={money(management.confirmed_expense_minor, currency)} tone="danger" />
              <ValueCell label="收入 − 支出" value={money(management.net_result_minor, currency, { signed: true })} tone={finite(management.net_result_minor) >= 0 ? "positive" : "danger"} />
              <ValueCell label="帳戶現金增減" value={money(cashFlow.net_cash_change_minor, currency, { signed: true })} note="包含投資、借還款與轉帳配對後的現金變化" />
            </div>
          </section>

          <section className="min-w-0 border-t pt-6 lg:border-t-0 lg:pl-6 lg:pt-0" aria-labelledby="history-average-heading">
            <div className="flex items-center justify-between gap-3"><h3 id="history-average-heading" className="font-semibold">近 6 個完整月平均</h3><span className="text-xs text-muted-foreground">{historyRange}</span></div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
              <ValueCell label="已確認收入" value={money(averages.average_confirmed_revenue_minor, currency)} tone="positive" />
              <ValueCell label="已確認支出" value={money(averages.average_confirmed_expense_minor, currency)} tone="danger" />
              <ValueCell label="平均結餘" value={money(averages.average_net_result_minor, currency, { signed: true })} tone={finite(averages.average_net_result_minor) >= 0 ? "positive" : "danger"} />
              <ValueCell label="平均現金增減" value={money(averages.average_net_cash_change_minor, currency, { signed: true })} />
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">{historyPartialCount ? `${historyPartialCount} 個月份仍有資料缺口；這是已確認紀錄平均，不代表穩定收入或最低必要支出。` : "六個月份資料完整；平均仍不等於未來保證值。"}</p>
          </section>
        </div>

        <section className="mt-6 rounded-lg border bg-muted/30 p-4" aria-labelledby="monthly-floor-heading">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><h3 id="monthly-floor-heading" className="font-semibold">每月支出底線</h3><p className="text-xs text-muted-foreground">已知與未知分開，不用平均消費冒充必付金額</p></div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <ValueCell label="已建檔固定生活義務" value={money(obligations.fixed_commitment_minor, currency)} note="目前包含房租、家庭支援等已確認固定義務" />
            <ValueCell label="貸款／卡款月付" value={obligations.debt_service_status === "known" ? money(obligations.known_debt_service_minor, currency) : "尚未建檔完整"} note="貸款還款排程不完整時不猜金額" />
            <ValueCell label="完整每月生存線" value="尚無法計算" note="還缺必要生活費定義與完整債務月付" />
          </div>
        </section>
      </Panel>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)]">
        <Panel title="負債狀況" eyebrow={`確認負債 ${money(position.total_liabilities_minor, currency)}`} action={<Button asChild variant="ghost" size="sm"><Link href="/data?tab=obligations">管理負債<ChevronRight aria-hidden="true" /></Link></Button>}>
          <DebtList debt={debt} currency={currency} />
          {debt.liability_profiles?.some((profile) => profile.schedule_entry_count === 0) ? (
            <div className="mt-5 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-warning"><TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>貸款餘額與利率已能核對，但月付與剩餘期數尚未進入排程；因此目前不能計算完整每月壓力。</p></div>
          ) : null}
        </Panel>

        <Panel title="投資曝險" eyebrow={`主要部位：${positionLabel}`} action={<Button asChild variant="ghost" size="sm"><Link href="/data?tab=investments">管理投資<ChevronRight aria-hidden="true" /></Link></Button>}>
          <div className="grid grid-cols-2 gap-5">
            <ValueCell label="投資市值" value={money(investments.balance_sheet_investment_value_minor, currency)} />
            <ValueCell label="占淨資產" value={percentFromBps(investmentBps)} />
            <ValueCell label="槓桿情境曝險" value={exposureAvailable ? money(investments.factor_exposure_minor, currency) : "尚未套用情境"} note={exposureAssumptionLabel || "不從名稱偷猜槓桿倍率"} />
          </div>
          {canApplyKnownLeverage ? <div className="mt-4"><Button asChild variant="outline" size="sm"><Link href={exposureHref(searchParams, largestPosition.instrument_key)}>套用已確認的 2 倍情境</Link></Button></div> : null}
          <div className="mt-5 border-t pt-4">
            <h3 className="text-sm font-medium">標的下跌時，淨資產可能減少</h3>
            <div className="mt-2 divide-y rounded-lg border px-3">
              {(health?.derived?.stress_tests || []).slice(0, 2).map((scenario) => {
                const decline = Math.abs(Number(scenario.underlying_change_decimal || 0) * 100)
                return <div key={scenario.scenario} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="flex items-center gap-2 text-muted-foreground"><ArrowDownRight className="size-4" aria-hidden="true" />下跌 {decline}%</span><span className="font-medium tabular-nums text-destructive">{scenario.stress_loss_minor === null ? "尚無法計算" : `−${money(scenario.stress_loss_minor, currency)}`}</span></div>
              })}
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="資料待辦" eyebrow="只列出會影響判讀的前三項">
        <TaskList tasks={tasks} month={month} />
      </Panel>
    </div>
  )
}
