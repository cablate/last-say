"use client"

// 日常導覽只保留使用者要完成的財務工作；分類、確認與修正工具移到資料管理流程。
// 行動版沿用 shadcn Sidebar 的 Sheet 行為，交易與資料編輯元件本身不在此變更。

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  Database,
  LayoutDashboard,
  Landmark,
  PieChart,
  ReceiptText,
  TrendingUp,
  WalletCards,
} from "lucide-react"

const PRIMARY_NAV = [
  { key: "dashboard", href: "/control", label: "總覽", icon: LayoutDashboard },
  { key: "income", href: "/reports", query: { statement: "income" }, label: "收支", icon: WalletCards },
  { key: "balance", href: "/reports", query: { statement: "balance" }, label: "資產與負債", icon: Landmark },
  { key: "investments", href: "/data", query: { tab: "investments" }, label: "投資", icon: TrendingUp },
  { key: "transactions", href: "/transactions", label: "交易", icon: ReceiptText },
]

export default function AppSidebar({ children }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const month = searchParams.get("month") || ""
  const scope = searchParams.get("scope") || "all"

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

  function isActive(key) {
    if (key === "dashboard") return pathname === "/" || pathname === "/control"
    if (key === "income") return pathname === "/reports" && searchParams.get("statement") !== "balance"
    if (key === "balance") return pathname === "/reports" && searchParams.get("statement") === "balance"
    if (key === "investments") return pathname === "/data" && searchParams.get("tab") === "investments"
    if (key === "transactions") return pathname === "/transactions"
    return false
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center gap-3 px-3 py-5">
            <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PieChart className="size-5" aria-hidden="true" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Last Say</span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="px-2">
            <SidebarMenu className="gap-1">
              {PRIMARY_NAV.map(({ key, href, query, label, icon: Icon }) => {
                return (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton asChild isActive={isActive(key)} tooltip={label} size="lg" className="px-3 text-[15px]">
                      <Link href={withScope(href, query)}>
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

        <SidebarFooter className="border-t">
          <SidebarGroup className="px-2 py-3">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/data" && searchParams.get("tab") !== "investments"} tooltip="資料管理" size="lg" className="px-3 text-[15px] text-muted-foreground">
                  <Link href="/data">
                    <Database aria-hidden="true" />
                    <span>資料管理</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        {/* 行動頂部列：漢堡鈕開啟側欄 Sheet；桌面隱藏 */}
        <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
          <SidebarTrigger className="size-11" />
          <span className="text-sm font-medium">Last Say</span>
        </div>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
