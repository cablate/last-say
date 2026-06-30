"use client"

import { useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Inbox,
  Lightbulb,
  ListChecks,
  RefreshCw,
} from "lucide-react"

import { useReviewQueue, useReviewTxns, usePatchTxn, useBatchCorrect } from "@/lib/hooks"
import { formatDate, formatTWD } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertAction,
} from "@/components/ui/alert"

// 與 lib/queries.js getReviewQueue 的 SQL 一致的「待確認」判定值。
const UNCERTAIN_OWNER = "待確認"
const UNCERTAIN_CATEGORY = "待確認"
const UNCERTAIN_NECESSITY = "需確認"

// 找出某筆 sample 哪些欄位落到「待確認」狀態，用來顯示原因 Badge。
function getReasons(sample) {
  const reasons = []
  if (sample?.owner_primary === UNCERTAIN_OWNER) {
    reasons.push({ key: "owner", label: "歸屬待確認" })
  }
  if (sample?.category_primary === UNCERTAIN_CATEGORY) {
    reasons.push({ key: "category", label: "分類待確認" })
  }
  if (sample?.necessity === UNCERTAIN_NECESSITY) {
    reasons.push({ key: "necessity", label: "必要性需確認" })
  }
  return reasons
}

// 兩張大數字卡的骨架，載入時復用。
function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-2 h-9 w-16" />
        <Skeleton className="mt-1 h-3 w-32" />
      </CardHeader>
    </Card>
  )
}

function SampleRowSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-5 w-28 rounded-full" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-4 rounded" />
      </div>
    </div>
  )
}

export default function ReviewQueue() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data, loading, error, refetch } = useReviewQueue()
  // 注意：所有 hook 必須在任何 early return（loading/error/allClear）之前呼叫，
  // 否則違反 Rules of Hooks（hook 順序不能依條件改變）。
  const reviewTxns = useReviewTxns()
  const patchTxn = usePatchTxn()
  const batchCorrect = useBatchCorrect()
  const ruleApplied = Array.isArray(data?.rule_applied) ? data.rule_applied : []
  const handleApproveAll = useCallback(async () => {
    if (ruleApplied.length === 0) return
    await reviewTxns(ruleApplied.map((r) => r.id))
    refetch()
  }, [ruleApplied, reviewTxns, refetch])
  // 採納單筆歷史建議（一鍵 PATCH，省逐 select）
  const handleAccept = useCallback(async (sample) => {
    if (!sample.suggestion) return
    const s = sample.suggestion
    const body = {}
    if (s.owner_value) body.owner_primary = s.owner_value
    if (s.category_value) body.category_primary = s.category_value
    if (s.necessity_value) body.necessity = s.necessity_value
    await patchTxn(sample.id, body)
    refetch()
  }, [patchTxn, refetch])
  // 批次採納所有有建議的樣本
  const handleAcceptAll = useCallback(async () => {
    const all = Array.isArray(data?.samples) ? data.samples : []
    const targets = all.filter((s) => s.suggestion)
    if (targets.length === 0) return
    const corrections = targets.map((s) => {
      const c = { id: s.id }
      if (s.suggestion.owner_value) c.owner_primary = s.suggestion.owner_value
      if (s.suggestion.category_value) c.category_primary = s.suggestion.category_value
      if (s.suggestion.necessity_value) c.necessity = s.suggestion.necessity_value
      return c
    })
    await batchCorrect({ corrections })
    refetch()
  }, [data, batchCorrect, refetch])

  // 下鑽到 transactions mode 並以 view=review 篩選 review 佇列。
  // 保留現有 month / scope 作為脈絡，清掉其餘篩選以免看不到 review 項。
  const buildDrillUrl = useCallback(() => {
    const next = new URLSearchParams()
    const month = searchParams.get("month")
    const scope = searchParams.get("scope")
    if (month) next.set("month", month)
    if (scope && scope !== "all") next.set("scope", scope)
    next.set("mode", "transactions")
    next.set("view", "review")
    const qs = next.toString()
    return qs ? `/?${qs}` : "/"
  }, [searchParams])

  const handleDrill = useCallback(() => {
    router.push(buildDrillUrl())
  }, [router, buildDrillUrl])

  // ---- loading ----
  if (loading) {
    return (
      <section className="flex flex-col gap-6" aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SampleRowSkeleton key={i} />
          ))}
        </div>
      </section>
    )
  }

  // ---- error ----
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>無法載入待審核清單</AlertTitle>
        <AlertDescription>
          {error?.message || "請稍後再試，或點重試重新取得資料。"}
        </AlertDescription>
        <AlertAction>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => refetch()}
          >
            <RefreshCw />
            重試
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  const uncertainCount = Number(data?.uncertain_count) || 0
  const unreviewedCount = Number(data?.unreviewed_count) || 0
  const samples = Array.isArray(data?.samples) ? data.samples : []
  const ruleAppliedCount = Number(data?.rule_applied_count) || 0
  const allClear = uncertainCount === 0 && unreviewedCount === 0 && ruleAppliedCount === 0

  // ---- empty ----
  if (allClear) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckCircle2 />
          </EmptyMedia>
          <EmptyTitle>沒有待審核項目</EmptyTitle>
          <EmptyDescription>
            目前沒有待確認欄位，也沒有未審核的交易。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      {/* 兩張大數字卡：補前端過去未消費 /api/review-queue 的 UI 落差 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <AlertCircle className="size-3.5" aria-hidden="true" />
              待確認欄位
            </CardDescription>
            <CardTitle className="text-4xl font-semibold tabular-nums">
              {uncertainCount.toLocaleString()}
            </CardTitle>
            <CardDescription>
              歸屬、分類或必要性標記為待確認的交易筆數
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <Inbox className="size-3.5" aria-hidden="true" />
              尚未審核
            </CardDescription>
            <CardTitle className="text-4xl font-semibold tabular-nums">
              {unreviewedCount.toLocaleString()}
            </CardTitle>
            <CardDescription>
              待分析或規則套用未確認的交易筆數
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {/* samples 列表 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ListChecks className="size-4" aria-hidden="true" />
            待確認交易樣本
            <span className="text-muted-foreground">
              （最多 {samples.length} 筆）
            </span>
          </h3>
          <div className="flex items-center gap-3">
            {samples.some((s) => s.suggestion) && (
              <Button type="button" size="sm" variant="outline" onClick={handleAcceptAll}>
                <Lightbulb /> 全部採納建議
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="link"
              className="h-auto p-0"
              onClick={handleDrill}
            >
              前往審核
              <ArrowRight />
            </Button>
          </div>
        </div>

        {samples.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckCircle2 />
              </EmptyMedia>
              <EmptyTitle>目前沒有待確認樣本</EmptyTitle>
              <EmptyDescription>
                雖有未審核交易，但暫無欄位被標記為待確認。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {samples.map((sample) => {
              const reasons = getReasons(sample)
              return (
                <li key={sample.id}>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className={cn(
                      "h-auto w-full justify-between gap-3 py-3 text-left",
                    )}
                    onClick={handleDrill}
                    aria-label={`審核交易：${sample.name}（${formatDate(
                      sample.transaction_date,
                    )}）`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarDays className="size-3" aria-hidden="true" />
                        {formatDate(sample.transaction_date)}
                      </span>
                      <span className="w-full truncate font-medium text-foreground">
                        {sample.name}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {reasons.length > 0 ? (
                          reasons.map((r) => (
                            <Badge key={r.key} variant="secondary">
                              {r.label}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline">未審核</Badge>
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-medium tabular-nums text-foreground">
                        {formatTWD(sample.amount)}
                      </span>
                      <ArrowRight
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </span>
                  </Button>
                  {sample.suggestion && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-xs">
                      <Lightbulb className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                      <span className="text-muted-foreground">建議：</span>
                      {sample.suggestion.owner_value && <Badge variant="outline" className="font-normal">{sample.suggestion.owner_value}</Badge>}
                      {sample.suggestion.category_value && <Badge variant="outline" className="font-normal">{sample.suggestion.category_value}</Badge>}
                      {sample.suggestion.necessity_value && <Badge variant="outline" className="font-normal">{sample.suggestion.necessity_value}</Badge>}
                      <span className="text-muted-foreground">（{sample.suggestion.sample_count} 筆同名歷史）</span>
                      <Button type="button" size="sm" variant="outline" className="ml-auto h-7 px-2" onClick={() => handleAccept(sample)}>採納</Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* 規則自動套用（待確認）：人類認可 = 正向回饋（區分「看過」與「沒看過」） */}
      {ruleAppliedCount > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <ListChecks className="size-4" aria-hidden="true" />
              規則自動套用
              <span className="text-muted-foreground">（待你確認 {ruleAppliedCount} 筆）</span>
            </h3>
            <Button type="button" size="sm" onClick={handleApproveAll}>
              全部認可
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            這些交易已由規則自動分類。確認無誤請按「全部認可」（標記為已審，作為規則的正向回饋）。
          </p>
          <ul className="flex flex-col gap-2">
            {ruleApplied.map((sample) => (
              <li key={sample.id} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{sample.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="secondary" className="font-normal">{sample.category_primary}</Badge>
                      <Badge variant="outline" className="font-normal">{sample.owner_primary}</Badge>
                      <Badge variant="outline" className="font-normal">{sample.necessity}</Badge>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-muted-foreground">
                    <div className="text-xs">{formatDate(sample.transaction_date)}</div>
                    <div className="tabular-nums">{formatTWD(sample.amount)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
