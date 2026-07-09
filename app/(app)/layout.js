"use client"

// 共享 shell（route group (app)）：側欄 + header(ScopeBar/SearchInput) + AIBanner + main。
// 多 route 架構——各 view 是獨立 page（/、/transactions、/trend、/corrections、/rules），
// 不再靠 ?mode= 驅動，從根本消除跨 view 的 URL param 互相污染。
// 補月：任何 route 下 URL 無 month 時，用 useMeta 最新月補上（replace 不進 history，維持當前 route）。

import { Suspense, useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import AppSidebar from "@/components/AppSidebar"
import SearchInput from "@/components/SearchInput"
import MonthSelector, { shouldShowMonthSelector } from "@/components/MonthSelector"
import AIBanner from "@/components/AIBanner"
import ErrorBoundary from "@/components/ErrorBoundary"
import { useMeta } from "@/lib/hooks"
import { Skeleton } from "@/components/ui/skeleton"

const SECTION_TITLES = {
  "/": "總覽",
  "/transactions": "交易明細",
  "/reports": "報表",
  "/trend": "歷月走勢",
  "/corrections": "修正紀錄",
  "/rules": "分類規則",
}

// 從 useMeta 取最新月份（months.transaction 已由小到大排序）。
function latestMonth(meta) {
  if (!meta) return ""
  const list = meta?.months?.transaction
  if (!Array.isArray(list) || list.length === 0) return ""
  return list[list.length - 1]?.month || ""
}

function ShellContent({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { data: meta } = useMeta()

  const month = searchParams.get("month") || ""
  const monthRoute = shouldShowMonthSelector(pathname)

  // 期間預設：總覽看全部期間；交易明細預設最新月份；規則、修正紀錄、走勢不被月份鎖住。
  useEffect(() => {
    if (!monthRoute) return
    if (month) return
    if (!meta) return
    if (pathname === "/") {
      const params = new URLSearchParams(searchParams.toString())
      params.set("month", "all")
      router.replace(`?${params.toString()}`, { scroll: false })
      return
    }
    const lm = latestMonth(meta)
    if (!lm) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("month", lm)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [monthRoute, month, meta, searchParams, router])

  const lm = latestMonth(meta)
  const isReady = !monthRoute || month !== "" || (meta && !lm)
  const sectionTitle = SECTION_TITLES[pathname] || "Finance Viewer"

  return (
    <AppSidebar>
      <header className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Finance Viewer</p>
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {sectionTitle}
          </h1>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
          <MonthSelector />
          <SearchInput />
        </div>
      </header>
      <AIBanner />
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
              {children}
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
    </AppSidebar>
  )
}

export default function AppLayout({ children }) {
  // 最外層 Suspense：滿足 Next 15 useSearchParams 邊界要求（ScopeBar/SearchInput/各 view 皆讀 searchParams）。
  return (
    <Suspense
      fallback={
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[28rem] w-full" />
        </div>
      }
    >
      <ShellContent>{children}</ShellContent>
    </Suspense>
  )
}
