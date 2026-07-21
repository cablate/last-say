"use client"

// 共享 shell（route group (app)）：側欄 + header(ScopeBar/SearchInput) + AIBanner + main。
// 多 route 架構——各 view 是獨立 page（/、/transactions、/trend、/corrections、/rules），
// 不再靠 ?mode= 驅動，從根本消除跨 view 的 URL param 互相污染。
// 補月：任何 route 下 URL 無 month 時，用 useMeta 最新月補上（replace 不進 history，維持當前 route）。

import { Suspense, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronRight } from "lucide-react"

import AppSidebar from "@/components/AppSidebar"
import SearchInput from "@/components/SearchInput"
import MonthSelector, { shouldShowMonthSelector } from "@/components/MonthSelector"
import AIBanner from "@/components/AIBanner"
import ErrorBoundary from "@/components/ErrorBoundary"
import { useMeta } from "@/lib/hooks"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const SECTION_TITLES = {
  "/": "財務儀表板",
  "/control": "財務儀表板",
  "/transactions": "交易明細",
  "/reports": "財務報表",
  "/trend": "歷月走勢",
  "/corrections": "修正紀錄",
  "/rules": "分類規則",
  "/confirmations": "資料確認",
  "/data": "資料中心",
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

  // 儀表板與其他月份頁面預設最新月份；規則、修正紀錄、走勢不被月份鎖住。
  useEffect(() => {
    if (!monthRoute) return
    if ((pathname === "/" || pathname === "/control") && month === "all") {
      const newest = latestMonth(meta)
      if (!newest) return
      const params = new URLSearchParams(searchParams.toString())
      params.set("month", newest)
      router.replace(`?${params.toString()}`, { scroll: false })
      return
    }
    if (month) return
    if (!meta) return
    const lm = latestMonth(meta)
    if (!lm) return
    const params = new URLSearchParams(searchParams.toString())
    params.set("month", lm)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [monthRoute, month, meta, pathname, searchParams, router])

  const lm = latestMonth(meta)
  const isReady = !monthRoute || month !== "" || (meta && !lm)
  const sectionTitle = SECTION_TITLES[pathname] || "Last Say"
  const isDashboard = pathname === "/" || pathname === "/control"

  return (
    <AppSidebar>
      <header className="shrink-0 px-4 pt-5 sm:px-6 lg:px-8 lg:pt-7">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {sectionTitle}
          </h1>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            <MonthSelector />
            {isDashboard ? (
              <Button asChild variant="outline" className="h-11 justify-between sm:justify-center">
                <Link href="/data">
                  <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                  資料狀態
                  <ChevronRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
            {pathname === "/transactions" ? <SearchInput /> : null}
          </div>
        </div>
      </header>
      {pathname === "/transactions" ? <AIBanner /> : null}
      <div className="min-w-0 px-4 pb-8 sm:px-6 lg:px-8">
        {!isReady ? (
          <div className="mx-auto max-w-[1180px] space-y-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-[28rem] w-full" />
          </div>
        ) : (
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="mx-auto max-w-[1180px] space-y-3">
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-[28rem] w-full" />
                </div>
              }
            >
              {children}
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
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
