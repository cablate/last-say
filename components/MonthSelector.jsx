"use client"

import { useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CalendarDays } from "lucide-react"

import { formatMonth } from "@/lib/format"
import { useMeta } from "@/lib/hooks"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

const MONTH_SELECTOR_ROUTES = new Set(["/", "/control", "/transactions", "/reports"])
const ALL_MONTHS = "all"

function latestMonth(meta) {
  const list = meta?.months?.transaction
  if (!Array.isArray(list) || list.length === 0) return ""
  return list[list.length - 1]?.month || ""
}

export function shouldShowMonthSelector(pathname) {
  return MONTH_SELECTOR_ROUTES.has(pathname)
}

export default function MonthSelector() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { data: meta, loading } = useMeta()

  const months = useMemo(() => {
    const list = meta?.months?.transaction
    return Array.isArray(list) ? list : []
  }, [meta])

  if (!shouldShowMonthSelector(pathname)) return null

  if (loading && months.length === 0) {
    return (
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <Label className="sr-only">月份</Label>
        <Skeleton className="h-11 w-full min-w-40 sm:w-40" />
      </div>
    )
  }

  const requestedMonth = searchParams.get("month") || ""
  const allowAllMonths = pathname !== "/control" && pathname !== "/"
  const monthValues = new Set(months.map((item) => item.month))
  const selectedMonth = requestedMonth === ALL_MONTHS && allowAllMonths
    ? ALL_MONTHS
    : monthValues.has(requestedMonth)
    ? requestedMonth
    : latestMonth(meta)

  function handleMonthChange(nextMonth) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("month", nextMonth)
    params.delete("page")
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <Label htmlFor="app-month-selector" className="sr-only">
        月份
      </Label>
      <Select
        value={selectedMonth}
        onValueChange={handleMonthChange}
        disabled={months.length === 0}
      >
        <SelectTrigger
          id="app-month-selector"
          aria-label="選擇月份"
          className="w-full min-w-40 data-[size=default]:h-11 sm:w-40"
        >
          <CalendarDays className="text-muted-foreground" aria-hidden="true" />
          <SelectValue placeholder="選擇月份">
            {selectedMonth === ALL_MONTHS ? "全部期間" : formatMonth(selectedMonth)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>期間</SelectLabel>
            {allowAllMonths ? <SelectItem value={ALL_MONTHS}>全部期間</SelectItem> : null}
            {months
              .slice()
              .reverse()
              .map((item) => {
                const count = Number(item.visible_rows ?? item.rows ?? 0)
                const label = `${formatMonth(item.month)}（${Number(
                  count,
                ).toLocaleString("zh-TW")} 筆）`
                return (
                  <SelectItem key={item.month} value={item.month}>
                    {label}
                  </SelectItem>
                )
              })}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
