"use client"

// AppSidebar：整體側欄 layout shell。
// 內含 SidebarProvider + Sidebar（導覽 menu + 分類 footer），並包住主內容（children）。
// menu items 切 mode；active 依 URL mode。
// SidebarFooter 用 useBreakdown(dimension=category) 顯示分類，點擊帶 category 切到 transactions。
// 行動：shadcn <Sidebar> 在 isMobile 時自動以 <Sheet> 呈現（含 SheetTitle "Sidebar"），
//   並於主內容頂部放 <SidebarTrigger>（漢堡鈕）開啟側欄，天然解 mobile 關不掉 bug。
//
// 整合者用法：
//   <AppSidebar>
//     <ScopeBar />
//     {mode === 'overview' && <Overview />}
//     ...
//   </AppSidebar>

import { useRouter, useSearchParams } from "next/navigation"
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
  ClipboardCheck,
  History,
  LayoutDashboard,
  ListChecks,
  PieChart,
  ReceiptText,
  TrendingUp,
} from "lucide-react"

const NAV = [
  { mode: "overview", label: "Overview", icon: LayoutDashboard },
  { mode: "transactions", label: "交易明細", icon: ReceiptText },
  { mode: "trend", label: "走勢", icon: TrendingUp },
  { mode: "review", label: "審查佇列", icon: ClipboardCheck },
  { mode: "corrections", label: "修正紀錄", icon: History },
  { mode: "rules", label: "分類規則", icon: ListChecks },
]

export default function AppSidebar({ children }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentMode = searchParams.get("mode") || "overview"
  const month = searchParams.get("month") || ""
  const scope = searchParams.get("scope") || "all"
  const activeCategory = searchParams.get("category") || ""

  // 以當前 searchParams 為基底，套用更新後 push；value 為空/特定清除值時移除該鍵。
  function pushParams(updates) {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "") params.delete(key)
      else params.set(key, value)
    })
    const qs = params.toString()
    router.push(qs ? `/?${qs}` : "/")
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
              {NAV.map(({ mode, label, icon: Icon }) => (
                <SidebarMenuItem key={mode}>
                  <SidebarMenuButton
                    isActive={currentMode === mode}
                    tooltip={label}
                    onClick={() =>
                      // 切 mode 時清除 category，避免跨模式殘留篩選。
                      pushParams({ mode, category: "" })
                    }
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
                      isActive={activeCategory === c.label}
                      tooltip={c.label}
                      className="cursor-pointer"
                      onClick={() =>
                        // 下鑽：帶 category 切到 transactions。
                        pushParams({ mode: "transactions", category: c.label })
                      }
                    >
                      <span className="truncate">{c.label}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {formatTWD(c.spend)}
                      </span>
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
