"use client"

import { CheckCircle2, ClipboardList, TrendingDown, TrendingUp } from "lucide-react"

import { formatTWD } from "@/lib/format"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function signedTWD(amountInCents) {
  const n = Number(amountInCents) || 0
  if (n === 0) return formatTWD(0)
  return `${n > 0 ? "+" : "-"}${formatTWD(Math.abs(n))}`
}

// 從 report.expenses 找出佔比最高的支出科目，回傳 { label, percent }。
// percent 為佔總支出的百分比（四捨五入到整數）；無資料回 null。
function topExpense(expenses, totalExpenseCents) {
  const total = Number(totalExpenseCents) || 0
  if (total <= 0 || !expenses?.length) return null
  const top = [...expenses]
    .map((item) => ({ label: item.label, amount: Number(item.amount_cents) || 0 }))
    .sort((a, b) => b.amount - a.amount)[0]
  if (!top || top.amount <= 0) return null
  return { label: top.label, percent: Math.round((top.amount / total) * 100) }
}

// 完成度提示：還有未審/未對應就提示，否則顯示完整。
function completionMessage(report) {
  const coverage = report?.coverage
  const unreviewed = Number(coverage?.unreviewed_transaction_count) || 0
  const unmapped = Number(coverage?.unmapped_transaction_count) || 0

  if (unreviewed > 0 && unmapped > 0) {
    return {
      tone: "warning",
      text: `還有 ${unreviewed} 筆待審、${unmapped} 筆未對應，完成後報表會更完整。`,
    }
  }
  if (unreviewed > 0) {
    return {
      tone: "warning",
      text: `還有 ${unreviewed} 筆交易待審，完成後報表會更完整。`,
    }
  }
  if (unmapped > 0) {
    return {
      tone: "info",
      text: `還有 ${unmapped} 筆交易尚未對應報表科目，完成後報表會更完整。`,
    }
  }
  return { tone: "success", text: "本月資料已完整，可直接作為管理報表使用。" }
}

function MetricCard({ label, value, tone = "default" }) {
  const valueClass = {
    default: "text-foreground",
    success: "text-success",
    destructive: "text-destructive",
  }[tone]
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`font-mono text-lg font-semibold tabular-nums sm:text-xl ${valueClass}`}
      >
        {value}
      </span>
    </div>
  )
}

export default function ReportSummary({ report }) {
  const netIncome = Number(report.net_income_cents) || 0
  const totalRevenue = Number(report.total_revenue_cents) || 0
  const totalExpense = Number(report.total_expense_cents) || 0

  const top = topExpense(report.expenses, report.total_expense_cents)
  const completion = completionMessage(report)

  const incomeIsPositive = netIncome >= 0

  return (
    <Card>
      <CardHeader>
        <CardDescription>這份報表的重點數字與白話解讀</CardDescription>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          報表摘要
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* 淨利大字 + 三指標 */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">本月淨利</span>
            <span
              className={`flex items-center gap-1.5 font-mono text-3xl font-bold tabular-nums sm:text-4xl ${
                incomeIsPositive ? "text-success" : "text-destructive"
              }`}
            >
              {incomeIsPositive ? (
                <TrendingUp className="h-6 w-6" aria-hidden="true" />
              ) : (
                <TrendingDown className="h-6 w-6" aria-hidden="true" />
              )}
              {signedTWD(netIncome)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:flex sm:gap-6">
            <MetricCard label="總收入" value={formatTWD(totalRevenue)} />
            <MetricCard label="總支出" value={formatTWD(totalExpense)} tone="destructive" />
          </div>
        </div>

        {/* 白話洞察 */}
        {top ? (
          <p className="text-sm text-muted-foreground">
            本月支出主要來自
            <span className="font-medium text-foreground"> {top.label} </span>
            ，約佔總支出的
            <span className="font-medium text-foreground"> {top.percent}%</span>
            。
          </p>
        ) : null}

        {/* 完成度提示（含過渡標示，精簡整合） */}
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            completion.tone === "success"
              ? "border-success/30 bg-success/10 text-success"
              : completion.tone === "warning"
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-info/30 bg-info/10 text-info"
          }`}
        >
          {completion.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <ClipboardList className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{completion.text}</span>
        </div>

        {/* 過渡標示：精簡版，原本獨立一段灰字整合進這裡 */}
        <p className="text-xs text-muted-foreground">
          報表科目對應目前由內建規則與 category 推斷產生，接通 AI 後將更精準。
        </p>
      </CardContent>
    </Card>
  )
}
