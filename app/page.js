"use client"

// 整合者：URL search params 驅動主狀態，依 mode 渲染對應 view。
// 預設 mode=overview、month=最新月（從 useMeta 取）。search 存在時覆寫成 TransactionTable。
// useSearchParams（Next 15）需 Suspense 邊界 → 外層包一個；每個 view 再各包 ErrorBoundary + Suspense。
// 所有 view 元件皆自行用 useSearchParams 讀參數，整合者不傳 props。

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import AppSidebar from "@/components/AppSidebar"
import ScopeBar from "@/components/ScopeBar"
import ErrorBoundary from "@/components/ErrorBoundary"
import Overview from "@/components/Overview"
import TransactionTable from "@/components/TransactionTable"
import TrendView from "@/components/TrendView"
import ReviewQueue from "@/components/ReviewQueue"
import CorrectionsLog from "@/components/CorrectionsLog"
import RulesManager from "@/components/RulesManager"
import SearchInput from "@/components/SearchInput"
import { useMeta } from "@/lib/hooks"
import { Skeleton } from "@/components/ui/skeleton"

const VALID_MODES = ["overview", "transactions", "trend", "review", "corrections", "rules"]

// 從 useMeta 結果取最新月份（months.transaction 已按月份由小到大排序）。
function latestMonth(meta) {
  if (!meta) return ""
  const list = meta?.months?.transaction
  if (!Array.isArray(list) || list.length === 0) return ""
  return list[list.length - 1]?.month || ""
}

function PageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: meta } = useMeta()

  const mode = searchParams.get("mode") || "overview"
  const month = searchParams.get("month") || ""
  const search = searchParams.get("search") || ""

  // 預設 month：URL 無 month 時用 useMeta 最新月補上（replace 不進 history）。
  useEffect(() => {
    if (month) return
    if (!meta) return
    const lm = latestMonth(meta)
    if (!lm) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("month", lm)
    router.replace(`/?${params.toString()}`, { scroll: false })
  }, [month, meta, searchParams, router])

  // 是否可渲染子 view：
  //   URL 有 month → ready
  //   URL 無 month 且 meta 已載入但無可補月份 → ready（讓元件顯示空狀態，避免永遠卡骨架）
  //   URL 無 month 且 meta 尚未到 → 等補月
  const lm = latestMonth(meta)
  const isReady = mode === "rules" || mode === "corrections" || month !== "" || (meta && !lm) ? true : false

  // search 存在時一律走 TransactionTable（搜尋結果）；否則依 mode，非法 mode fallback overview。
  const effectiveMode =
    search && search.trim() !== ""
      ? "transactions"
      : VALID_MODES.includes(mode)
        ? mode
        : "overview"

  function renderView() {
    switch (effectiveMode) {
      case "transactions":
        return <TransactionTable />
      case "trend":
        return <TrendView />
      case "review":
        return <ReviewQueue />
      case "corrections":
        return <CorrectionsLog />
      case "rules":
        return <RulesManager />
      case "overview":
      default:
        return <Overview />
    }
  }

  return (
    <AppSidebar>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <ScopeBar />
        <SearchInput />
      </header>
      <main className="p-4">
        {!isReady ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-[28rem] w-full" />
          </div>
        ) : (
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="space-y-3">
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-[28rem] w-full" />
                </div>
              }
            >
              {renderView()}
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
    </AppSidebar>
  )
}

export default function HomePage() {
  // 最外層 Suspense：滿足 Next 15 useSearchParams 邊界要求（AppSidebar/ScopeBar/各 view 皆讀 searchParams）。
  return (
    <Suspense
      fallback={
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[28rem] w-full" />
        </div>
      }
    >
      <PageContent />
    </Suspense>
  )
}
