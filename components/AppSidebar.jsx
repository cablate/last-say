"use client"

// AppSidebar：整體側欄 layout shell。
// 多 route 架構：導覽項是獨立 route（/, /transactions, /trend, /corrections, /rules），
// 用 <Link> + asChild；active 依 usePathname。跨 route 保留 month/scope query（其他 view 專屬 param 不帶）。
// SidebarFooter 用 useBreakdown(dimension=category) 顯示分類，點擊帶 category 到 /transactions。
// 行動：shadcn <Sidebar> 在 isMobile 時自動以 <Sheet> 呈現（含 SheetTitle），並於主內容頂部放 <SidebarTrigger>。

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { useBreakdown } from "@/lib/hooks"
import { formatTWD } from "@/lib/format"
import {
  ChartNoAxesColumnIncreasing,
  History,
  LayoutDashboard,
  ListChecks,
  PieChart,
  ReceiptText,
  TrendingUp,
} from "lucide-react"

const NAV = [
  { href: "/", label: "總覽", icon: LayoutDashboard },
  { href: "/transactions", label: "交易明細", icon: ReceiptText },
  { href: "/reports", label: "報表", icon: ChartNoAxesColumnIncreasing },
  { href: "/trend", label: "走勢", icon: TrendingUp },
  { href: "/corrections", label: "修正紀錄", icon: History },
  { href: "/rules", label: "分類規則", icon: ListChecks },
]

export default function AppSidebar({ children }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const month = searchParams.get("month") || ""
  const scope = searchParams.get("scope") || "all"
  const activeCategory = searchParams.get("category") || ""

  // 跨 route 保留 month / scope（皆具跨頁意義）；其他 view 專屬 param 不帶，避免跨頁污染。
  function withScope(href, extra = {}) {
    const p = new URLSearchParams()
    if (href === "/") p.set("month", "all")
    else if (month) p.set("month", month)
    if (scope && scope !== "all") p.set("scope", scope)
    for (const [k, v] of Object.entries(extra)) {
      if (v == null || v === "") p.delete(k)
      else p.set(k, v)
    }
    const qs = p.toString()
    return qs ? `${href}?${qs}` : href
  }

  // footer 分類列表：保留 month / scope 篩選，dimension=category。
  const footerParams = new URLSearchParams({ dimension: "category" })
  if (month) footerParams.set("month", month)
  if (scope && scope !== "all") footerParams.set("scope", scope)
  const { data: categories, loading } = useBreakdown(footerParams.toString())

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <PieChart className="size-5 text-primary" aria-hidden="true" />
            <span className="text-sm font-semibold">Finance Viewer</span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>導覽</SidebarGroupLabel>
            <SidebarMenu>
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname === href
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={label}>
                      <Link href={withScope(href)}>
                        <Icon aria-hidden="true" />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarGroup>
            <SidebarGroupLabel>分類</SidebarGroupLabel>
            <SidebarMenu>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <SidebarMenuItem key={`sk-${i}`}>
                    <Skeleton className="h-8 w-full" />
                  </SidebarMenuItem>
                ))
              ) : Array.isArray(categories) && categories.length > 0 ? (
                categories.map((c) => (
                  <SidebarMenuItem key={c.label}>
                    <SidebarMenuButton
                      asChild
                      isActive={activeCategory === c.label}
                      tooltip={c.label}
                      className="cursor-pointer"
                    >
                      <Link href={withScope("/transactions", { category: c.label })}>
                        <span className="truncate">{c.label}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {formatTWD(c.spend)}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              ) : (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  無分類資料
                </li>
              )}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        {/* 行動頂部列：漢堡鈕開啟側欄 Sheet；桌面隱藏 */}
        <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
          <SidebarTrigger />
          <span className="text-sm font-medium">Finance Viewer</span>
        </div>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
