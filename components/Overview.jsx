"use client"

import { useCallback, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ListChecks,
  Landmark,
  PiggyBank,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react"

import {
  useBalanceHistory,
  useBreakdown,
  useSummary,
  useTransactions,
} from "@/lib/hooks"
import { formatDate, formatMonth, formatTWD } from "@/lib/format"
import DonutChart from "@/components/charts/DonutChart"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

// 從 URL search params 中挑選與資料篩選相關的 key，丟棄 mode/selectedTxnId 等 UI 狀態。
// 傳給 useSummary / useBreakdown / useTransactions 當查詢字串。
const BASE_KEYS = [
  "month",
  "view",
  "scope",
  "category",
  "search",
  "sort",
  "direction",
]

const PercentFormatter = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
  style: "percent",
})

function pickBaseParams(searchParams) {
  const sp = new URLSearchParams()
  for (const k of BASE_KEYS) {
    const v = searchParams.get(k)
    if (v) sp.set(k, v)
  }
  return sp
}

export default function Overview() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // 以 URL search params 為單一真相來源；切換時 router.push 更新 query。
  const baseParams = useMemo(() => pickBaseParams(searchParams), [searchParams])
  const baseString = baseParams.toString()

  const breakdownParams = useMemo(() => {
    const sp = new URLSearchParams(baseString)
    sp.set("dimension", "category")
    return sp.toString()
  }, [baseString])

  const txParams = useMemo(() => {
    const sp = new URLSearchParams(baseString)
    sp.set("limit", "5")
    sp.set("sort", "date")
    sp.set("direction", "desc")
    return sp.toString()
  }, [baseString])

  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
  } = useSummary(baseString)

  const {
    data: breakdown,
    loading: breakdownLoading,
  } = useBreakdown(breakdownParams)

  const { data: balanceHistory, loading: balanceLoading } = useBalanceHistory()

  const {
    data: txData,
    loading: txLoading,
  } = useTransactions(txParams)

  // 下鑽到 /transactions：以目前 query 為基底，套用 overrides 後導向 transactions route。
  // 保留 month/scope 等篩選；mode 在 route 架構下不存在（過濾掉避免髒 param）。
  const drill = useCallback(
    (overrides = {}) => {
      const sp = new URLSearchParams(searchParams.toString())
      for (const [k, v] of Object.entries(overrides)) {
        if (k === "mode") continue
        if (v === null || v === undefined || v === "") sp.delete(k)
        else sp.set(k, v)
      }
      sp.delete("mode")
      router.push(`/transactions?${sp.toString()}`)
    },
    [router, searchParams],
  )

  const drillCategory = useCallback(
    (label) => drill({ category: label, search: "" }),
    [drill],
  )

  const isAllPeriod = searchParams.get("month") === "all"
  const monthLabel = isAllPeriod
    ? "全部期間"
    : summary?.selectedMonth
      ? formatMonth(summary.selectedMonth)
      : "本月"
  const statusLabel = isAllPeriod ? "整體審查狀態" : "月結狀態"
  const completeLabel = isAllPeriod ? "全部期間已全數確認" : "本月已全數確認"
  const classificationLabel = isAllPeriod ? "全部期間分類" : "本月分類"

  const netCash = Number(summary?.netCashMovement ?? 0)
  const netCashPositive = netCash > 0
  const netCashNegative = netCash < 0
  const classification = summary?.classification ?? {}
  const processedCount = Number(classification.total ?? summary?.rows ?? 0) || 0
  const ruleCount = Number(classification.rule ?? 0) || 0
  const aiCount = Number(classification.ai ?? 0) || 0
  const humanCount = Number(classification.human ?? 0) || 0
  const needsReviewCount = Number(classification.needsReview ?? 0) || 0
  const automationPercent = Math.round(
    (Number(classification.automationRate ?? 0) || 0) * 100,
  )
  const reviewedPercent = Math.round(
    (Number(classification.reviewedRate ?? 0) || 0) * 100,
  )
  const highConfidencePercent = Math.round(
    (Number(classification.highConfidenceRate ?? 0) || 0) * 100,
  )
  const lowConfidencePercent = Math.round(
    (Number(classification.lowConfidenceRate ?? 0) || 0) * 100,
  )
  const closingComplete = processedCount > 0 && needsReviewCount === 0

  // balanceHistory 取最新兩筆做月變動 Badge，讓 useBalanceHistory 有實際用途。
  const latestBalanceEntry =
    balanceHistory && balanceHistory.length > 0
      ? balanceHistory[balanceHistory.length - 1]
      : null
  const prevBalanceEntry =
    balanceHistory && balanceHistory.length > 1
      ? balanceHistory[balanceHistory.length - 2]
      : null
  const balanceDelta =
    latestBalanceEntry && prevBalanceEntry
      ? Number(latestBalanceEntry.balance) - Number(prevBalanceEntry.balance)
      : null

  if (summaryLoading && !summary) return <OverviewSkeleton />

  if (summaryError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>無法載入概觀</AlertTitle>
        <AlertDescription>
          {summaryError?.message || "請稍後再試。"}
        </AlertDescription>
      </Alert>
    )
  }

  // 空狀態引導：summary 已載入且當前篩選下完全無交易 → 顯示引導卡，
  // 不破壞既有渲染（只在最上層攔截，既有分支不受影響）。
  if (!summaryLoading && summary && processedCount === 0) {
    return <OverviewEmpty />
  }

  const txRows = txData?.rows ?? []
  const incomeItems = (breakdown ?? []).filter((b) => Number(b.inflow) > 0)
  const spendItems = (breakdown ?? []).filter((b) => Number(b.spend) > 0)
  const donutData = spendItems
    .slice(0, 8)
    .map((b) => ({ label: b.label, value: Number(b.spend) }))
  const monthlyReport = summary?.monthlyReport ?? null

  return (
    <div className="flex flex-col gap-6">
      {/* 首屏關鍵指標列：淨現金流 / 待審數 / 自動化率。一進來就能掌握狀態，不必下滑。 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KeyMetric
          label={`${monthLabel} 淨現金流`}
          value={formatTWD(netCash)}
          tone={netCashPositive ? "positive" : netCashNegative ? "negative" : "neutral"}
          badge={
            netCashPositive ? (
              <Badge className="border-transparent bg-success/15 text-success">
                <ArrowUpRight className="h-3 w-3" />
                淨流入
              </Badge>
            ) : netCashNegative ? (
              <Badge variant="destructive">
                <ArrowDownRight className="h-3 w-3" />
                淨支出
              </Badge>
            ) : (
              <Badge variant="secondary">平衡</Badge>
            )
          }
          loading={summaryLoading}
        />
        <KeyMetric
          label="待審數"
          value={String(needsReviewCount)}
          tone={needsReviewCount > 0 ? "warning" : "neutral"}
          badge={
            closingComplete ? (
              <Badge variant="secondary">
                <CheckCircle2 className="h-3 w-3" />
                {completeLabel}
              </Badge>
            ) : (
              <Badge variant="outline">待你確認</Badge>
            )
          }
          loading={summaryLoading}
        />
        <KeyMetric
          label="自動化率"
          value={`${automationPercent}%`}
          tone="neutral"
          badge={
            <Badge variant="outline">
              {processedCount} 筆已處理
            </Badge>
          }
          loading={summaryLoading}
        />
      </div>

      {/* AI 分類進度（緊湊版）：保留所有資訊，但不再是佔滿首屏的大卡。 */}
      <Card>
        <CardHeader>
          <CardDescription>{monthLabel} {statusLabel} · AI 已完成初步分類</CardDescription>
          <CardAction>
            <Button
              type="button"
              size="sm"
              variant={needsReviewCount > 0 ? "default" : "outline"}
              onClick={() =>
                drill({
                  view: "needs-review",
                  sort: "confidence",
                  direction: "asc",
                  page: null,
                })
              }
            >
              <ListChecks data-icon="inline-start" />
              前往審查
              <ArrowRight data-icon="inline-end" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span>
              規則自動 <span className="font-medium text-foreground">{automationPercent}%</span>
            </span>
            <span aria-hidden>·</span>
            <span>
              待你審 <span className="font-medium text-foreground">{needsReviewCount}</span>
            </span>
            <span aria-hidden>·</span>
            <span>
              {classificationLabel}已確認{" "}
              <span className="font-medium text-foreground">{reviewedPercent}%</span>
            </span>
            <span aria-hidden>·</span>
            <span>
              高信心 <span className="font-medium text-foreground">{highConfidencePercent}%</span>
            </span>
            <span aria-hidden>·</span>
            <span>
              低信心 <span className="font-medium text-foreground">{lowConfidencePercent}%</span>
            </span>
            <span aria-hidden className="hidden sm:inline">·</span>
            <span className="font-mono tabular-nums">
              規則 {ruleCount} / AI {aiCount} / 人工 {humanCount}
            </span>
          </div>
        </CardContent>
      </Card>

      <MonthlyReportSection
        report={monthlyReport}
        monthLabel={monthLabel}
        needsReviewCount={needsReviewCount}
        onCategoryClick={drillCategory}
        onFixedItemClick={(item) =>
          drill({
            matchKey: item.matchKeySource === "import_match_key" ? item.matchKey : "",
            category: "",
            search: item.matchKeySource === "import_match_key" ? "" : item.sampleName,
            page: null,
          })
        }
      />

      {/* 淨現金流明細：金額已移至首屏指標列，此卡保留流入/流出/筆數的細項。 */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-6 text-sm text-muted-foreground">
          <span>
            流入{" "}
            <span className="font-medium text-success">
              {formatTWD(summary?.inflow)}
            </span>
          </span>
          <span>
            流出{" "}
            <span className="font-medium text-foreground">
              {formatTWD(summary?.outflow)}
            </span>
          </span>
          <span>
            交易筆數{" "}
            <span className="font-medium text-foreground">
              {summary?.rows ?? 0}
            </span>
          </span>
        </CardContent>
      </Card>

      {/* Metric cards：每卡可點下鑽到 transactions mode 帶對應 scope/view */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="實際支出"
          value={formatTWD(summary?.actualSpend)}
          icon={<Receipt className="h-4 w-4" />}
          loading={summaryLoading}
          onClick={() => drill()}
        />
        <MetricCard
          label="支出後結餘"
          value={formatTWD(summary?.moneyLeftAfterSpend)}
          icon={<PiggyBank className="h-4 w-4" />}
          loading={summaryLoading}
          onClick={() => drill()}
        />
        <MetricCard
          label="最新帳戶餘額"
          value={
            summary?.latestBankBalance
              ? formatTWD(summary.latestBankBalance.balance)
              : "—"
          }
          hint={
            summary?.latestBankBalance
              ? `${formatDate(summary.latestBankBalance.date)} · ${summary.latestBankBalance.name}`
              : null
          }
          icon={<Landmark className="h-4 w-4" />}
          loading={summaryLoading}
          onClick={() => drill({ view: "bank" })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 支出分類 DonutChart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>支出分類</CardTitle>
            <CardDescription>依類別分布</CardDescription>
          </CardHeader>
          <CardContent>
            {breakdownLoading && !breakdown ? (
              <Skeleton className="h-[260px] w-full rounded-lg" />
            ) : donutData.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Wallet />
                  </EmptyMedia>
                  <EmptyTitle>{isAllPeriod ? "目前無支出" : "本月無支出"}</EmptyTitle>
                  <EmptyDescription>
                    當前篩選條件下沒有可顯示的支出分類。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="flex flex-col gap-4">
                <DonutChart
                  data={donutData}
                  ariaLabel={`${monthLabel} 支出分類分布`}
                />
                <ul className="flex flex-col gap-1.5 text-sm">
                  {donutData.map((item) => (
                    <li key={item.label}>
                      <button
                        type="button"
                        onClick={() => drillCategory(item.label)}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-muted"
                      >
                        <span className="truncate text-foreground">
                          {item.label}
                        </span>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {formatTWD(item.value)}
                          </span>
                          <ArrowRight className="h-3 w-3" />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 收入來源 */}
        <Card>
          <CardHeader>
            <CardTitle>收入來源</CardTitle>
            <CardDescription>依類別分布</CardDescription>
          </CardHeader>
          <CardContent>
            {breakdownLoading && !breakdown ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded-md" />
                ))}
              </div>
            ) : incomeItems.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <TrendingUp />
                  </EmptyMedia>
                  <EmptyTitle>無收入紀錄</EmptyTitle>
                  <EmptyDescription>
                    {isAllPeriod ? "目前沒有流入項目。" : "本月目前沒有流入項目。"}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {incomeItems.map((item) => (
                  <li key={item.label}>
                    <button
                      type="button"
                      onClick={() => drillCategory(item.label)}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-left hover:bg-muted"
                    >
                      <span className="truncate text-foreground">
                        {item.label}
                      </span>
                      <span className="font-medium text-success">
                        +{formatTWD(item.inflow)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 近期交易 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>近期交易</CardTitle>
            <CardDescription>最新 5 筆</CardDescription>
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => drill()}
              >
                查看全部
                <ArrowRight />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {txLoading && !txData ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-md" />
                ))}
              </div>
            ) : txRows.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Receipt />
                  </EmptyMedia>
                  <EmptyTitle>沒有交易</EmptyTitle>
                  <EmptyDescription>
                    當前篩選條件下沒有交易資料。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {txRows.map((row) => {
                  const inflow = Number(row.inflow) || 0
                  const outflow = Number(row.outflow) || 0
                  const isIncome = inflow > 0
                  return (
                    <li key={row.id} className="first:pt-0 last:pb-0">
                      <button
                        type="button"
                        onClick={() =>
                          drill({
                            category: "",
                            search: row.name,
                          })
                        }
                        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-muted/60"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-foreground">
                            {row.name || "（未命名）"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(row.transaction_date)}
                            {" · "}
                            {row.category_primary || "未分類"}
                          </span>
                        </div>
                        <span
                          className={
                            isIncome
                              ? "text-sm font-medium text-success"
                              : "text-sm font-medium text-foreground"
                          }
                        >
                          {isIncome
                            ? `+${formatTWD(inflow)}`
                            : `-${formatTWD(outflow)}`}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 歷月帳戶餘額（useBalanceHistory） */}
        <Card>
          <CardHeader>
            <CardTitle>歷月帳戶餘額</CardTitle>
            <CardDescription>
              {balanceDelta === null ? (
                "帳戶餘額軌跡"
              ) : balanceDelta >= 0 ? (
                <Badge className="border-transparent bg-success/15 text-success">
                  <ArrowUpRight className="h-3 w-3" />
                  較上月 +{formatTWD(balanceDelta)}
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <ArrowDownRight className="h-3 w-3" />
                  較上月 -{formatTWD(Math.abs(balanceDelta))}
                </Badge>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {balanceLoading && !balanceHistory ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded-md" />
                ))}
              </div>
            ) : !balanceHistory || balanceHistory.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Landmark />
                  </EmptyMedia>
                  <EmptyTitle>尚無餘額資料</EmptyTitle>
                  <EmptyDescription>
                    尚未匯入帳戶對帳紀錄。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {balanceHistory
                  .slice(-4)
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <li
                      key={entry.month}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1"
                    >
                      <span className="text-muted-foreground">
                        {formatMonth(entry.month)}
                      </span>
                      <span className="font-medium text-foreground">
                        {formatTWD(entry.balance)}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function formatSignedTWD(amountInCents) {
  const n = Number(amountInCents) || 0
  if (n === 0) return formatTWD(0)
  return `${n > 0 ? "+" : "-"}${formatTWD(Math.abs(n))}`
}

function formatPercentDelta(value) {
  if (value === null || value === undefined) return "樣本不足"
  const n = Number(value)
  if (!Number.isFinite(n)) return "樣本不足"
  if (n === 0) return "0%"
  return `${n > 0 ? "+" : "-"}${PercentFormatter.format(Math.abs(n))}`
}

function SpendingDeltaBadge({ delta }) {
  const n = Number(delta) || 0
  if (n > 0) {
    return (
      <Badge variant="destructive">
        <ArrowUpRight className="h-3 w-3" />
        比常態多
      </Badge>
    )
  }
  if (n < 0) {
    return (
      <Badge className="border-transparent bg-success/15 text-success">
        <ArrowDownRight className="h-3 w-3" />
        比常態少
      </Badge>
    )
  }
  return <Badge variant="secondary">接近常態</Badge>
}

function MonthlyReportSection({
  report,
  monthLabel,
  needsReviewCount,
  onCategoryClick,
  onFixedItemClick,
}) {
  if (!report) return null
  const isSoftLocked = Number(needsReviewCount) > 0

  const comparison = report.comparison ?? {}
  const previousMonths = comparison.previousMonths ?? []
  const topMovers = report.topMovers ?? []
  const fixedBaseline = report.fixedBaseline ?? {}
  const fixedItems = fixedBaseline.items ?? []
  const baselineMonthLabel =
    fixedBaseline.months?.length > 0
      ? fixedBaseline.months.map(formatMonth).join(" / ")
      : "樣本不足"

  return (
    <section className="flex flex-col gap-3" aria-labelledby="monthly-report-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{monthLabel}</p>
          <h2 id="monthly-report-title" className="text-xl font-semibold tracking-tight">
            你的月報
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          排除收入與信用卡繳款/移轉後的支出觀察
        </p>
      </div>

      {isSoftLocked ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          審完 {needsReviewCount} 筆解鎖完整月報
        </div>
      ) : null}

      <div className={`grid gap-4 lg:grid-cols-2 ${isSoftLocked ? "opacity-60" : ""}`}>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardDescription>本月 vs 常態</CardDescription>
            <CardTitle className="text-3xl">
              {formatSignedTWD(comparison.delta)}
            </CardTitle>
            <CardAction>
              <SpendingDeltaBadge delta={comparison.delta} />
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">本月支出</p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {formatTWD(comparison.currentSpend)}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">前三月平均</p>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                  {formatTWD(comparison.previousAverageSpend)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>差異 {formatSignedTWD(comparison.delta)}</span>
              <span aria-hidden>·</span>
              <span>{formatPercentDelta(comparison.percentDelta)}</span>
              <span aria-hidden>·</span>
              <span>
                常態樣本{" "}
                {previousMonths.length > 0
                  ? previousMonths.map((row) => formatMonth(row.month)).join(" / ")
                  : "不足"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Top movers</CardDescription>
            <CardTitle>分類波動</CardTitle>
          </CardHeader>
          <CardContent>
            {topMovers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                沒有超過門檻的分類變動。
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {topMovers.map((item) => (
                  <li key={item.label}>
                    <button
                      type="button"
                      onClick={() => onCategoryClick(item.label)}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted active:scale-[0.99]"
                      aria-label={`查看 ${item.label} 分類交易`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {item.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          上月 {formatTWD(item.previousSpend)} → 本月{" "}
                          {formatTWD(item.currentSpend)}
                        </span>
                      </span>
                      <Badge
                        variant={Number(item.delta) > 0 ? "destructive" : "secondary"}
                        className="shrink-0"
                      >
                        {formatSignedTWD(item.delta)}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>固定底盤</CardDescription>
            <CardTitle>連續支出</CardTitle>
          </CardHeader>
          <CardContent>
            {fixedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {baselineMonthLabel} 沒有連續 {fixedBaseline.monthsRequired ?? 3} 個月出現的支出。
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {fixedItems.slice(0, 5).map((item) => (
                  <li key={`${item.matchKeySource}:${item.matchKey}`}>
                    <button
                      type="button"
                      onClick={() => onFixedItemClick(item)}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted active:scale-[0.99]"
                      aria-label={`查看 ${item.sampleName || item.matchKey} 固定支出交易`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {item.sampleName || item.matchKey}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          連續 {item.activeMonths} 個月 · 本月 {item.currentRows} 筆
                        </span>
                      </span>
                      <span className="shrink-0 font-mono font-medium tabular-nums text-foreground">
                        {formatTWD(item.currentTotal)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

// 首屏關鍵指標卡：緊湊、強調單一數字，語意色由 tone 帶。
// 與 MetricCard（可點下鑽）不同，這是純展示的狀態指標，不放 onClick。
function KeyMetric({ label, value, tone = "neutral", badge, loading }) {
  const toneClass =
    tone === "positive"
      ? "text-success"
      : tone === "negative"
        ? "text-destructive"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground"
  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5 pt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          {badge}
        </div>
        <p
          className={`font-mono text-2xl font-semibold tabular-nums ${toneClass}`}
        >
          {loading ? <Skeleton className="h-8 w-28" /> : value}
        </p>
      </CardContent>
    </Card>
  )
}

function MetricCard({ label, value, hint, icon, loading, onClick }) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className="cursor-pointer transition-shadow hover:ring-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${label}，點擊查看詳情`}
    >
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl">
          {loading ? <Skeleton className="h-7 w-24" /> : value}
        </CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      ) : null}
    </Card>
  )
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-32 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 w-full rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </div>
  )
}

// 空狀態引導卡：交易數=0 時提示如何產生示範資料或匯入帳單。
// 使用與既有 Empty 一致的視覺語言，維持元件庫一致性。
function OverviewEmpty() {
  return (
    <Card>
      <CardHeader>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>尚無資料</EmptyTitle>
            <EmptyDescription>
              執行 <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">npm run seed:demo</code> 產生示範資料，或請 AI 匯入你的帳單。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CardHeader>
    </Card>
  )
}
