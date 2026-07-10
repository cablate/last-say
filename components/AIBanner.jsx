"use client"

// AIBanner — 永久置頂的「待你確認」提示：顯示 AI 沒把握（低信心/null/pending/哨兵）且未審的筆數，
// 一鍵帶到 /transactions 依信心度升序（最沒把握的排最前）。沒有待審時不顯示。
// 數據源：目前 URL 月份的 /api/summary classification.needsReview；交易審查 mutation
// 會發出 data-changed 事件觸發重抓，避免顯示全庫或過期數量。
import { useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Sparkles, ArrowRight } from "lucide-react"
import { useDataChangeRefetch, useSummary } from "@/lib/hooks"
import { Button } from "@/components/ui/button"

export default function AIBanner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedMonth = searchParams.get("month") || "all"
  const scopeQuery = useMemo(() => {
    const params = new URLSearchParams()
    params.set("month", selectedMonth)
    return params.toString()
  }, [selectedMonth])
  const { data: summary, refetch } = useSummary(scopeQuery)
  useDataChangeRefetch(refetch)
  const total = Number(summary?.classification?.needsReview) || 0
  if (total === 0) return null

  const scopeLabel = selectedMonth && selectedMonth !== "all"
    ? `${selectedMonth.replace("-", "/")} 全月`
    : "全部期間"

  function goToReview() {
    const next = new URLSearchParams()
    const month = searchParams.get("month")
    const scope = searchParams.get("scope")
    if (month) next.set("month", month)
    if (scope && scope !== "all") next.set("scope", scope)
    // 帶到「待審」篩選 + 低信心優先（最沒把握的排最前）。
    next.set("view", "needs-review")
    next.set("sort", "confidence")
    next.set("direction", "asc")
    router.push(`/transactions?${next.toString()}`, { scroll: false })
  }

  return (
    <div className="flex items-center gap-2 border-b bg-warning/5 px-4 py-2 text-sm">
      <Sparkles className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="text-muted-foreground">
        {scopeLabel} AI 待審 <strong className="text-foreground">{total}</strong> 筆（AI 較沒把握，建議優先看）
      </span>
      <Button
        type="button"
        size="sm"
        variant="link"
        className="ml-auto h-auto p-0"
        onClick={goToReview}
      >
        前往審查
        <ArrowRight className="size-3" />
      </Button>
    </div>
  )
}
