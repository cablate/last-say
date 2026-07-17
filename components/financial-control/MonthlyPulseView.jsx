"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useSearchParams } from "next/navigation"
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Landmark,
  RefreshCw,
  Scale,
  WalletCards,
} from "lucide-react"

import { useDataChangeRefetch, useMonthlyFinancialPulse } from "@/lib/hooks"
import CoverageBadge from "@/components/reports/CoverageBadge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

function formatMinor(value, currency = "TWD", { signed = false, absolute = false } = {}) {
  if (value === null || value === undefined) return "未知"
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "未知"
  const digits = new Intl.NumberFormat("en", { style: "currency", currency })
    .resolvedOptions().maximumFractionDigits
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format((absolute ? Math.abs(numeric) : numeric) / (10 ** digits))
}

function PulseSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4" aria-label="正在載入月度財務脈搏">
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-36 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}

function MetricCard({ title, description, value, icon: Icon, tone = "default" }) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-success",
    negative: "text-destructive",
  }[tone]
  return (
    <Card role="article" aria-label={title}>
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-3">
          <CardDescription>{title}</CardDescription>
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <CardTitle className={`font-mono text-2xl tabular-nums ${toneClass}`}>{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  )
}

function MovementRow({ label, value, currency, note }) {
  const numeric = value === null ? null : Number(value)
  const Icon = numeric !== null && numeric > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <div className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{note}</p>
        </div>
      </div>
      <span className="font-mono text-sm font-semibold tabular-nums">
        {formatMinor(value, currency, { signed: true })}
      </span>
    </div>
  )
}

function CoverageNotice({ coverage }) {
  if (!coverage || coverage.status === "complete") return null
  const blockers = coverage.blockers || []
  const destructive = coverage.status === "unreconciled"
  return (
    <Alert variant={destructive ? "destructive" : "default"} className={destructive ? "" : "border-warning/30 bg-warning/10 text-warning"}>
      <AlertTitle>{destructive ? "現金流尚未對平" : "資料仍不完整，但已知數字可以先看"}</AlertTitle>
      <AlertDescription>
        缺少或待確認的部分不會被猜成零。
        {blockers.length ? (
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {blockers.map((item, index) => (
              <li key={`${item.source || "pulse"}:${item.kind || index}:${item.resource_key || index}`}>
                {item.label || item.kind}
              </li>
            ))}
          </ul>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

export default function MonthlyPulseView() {
  const searchParams = useSearchParams()
  const month = searchParams.get("month") || ""
  const validMonth = MONTH.test(month)
  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (validMonth) params.set("month", month)
    params.set("entity_id", searchParams.get("entity_id") || "personal")
    params.set("currency", searchParams.get("currency") || "TWD")
    params.set("basis", "card_accrual_management")
    return params.toString()
  }, [month, searchParams, validMonth])
  const request = useMonthlyFinancialPulse(query, validMonth)
  useDataChangeRefetch(request.refetch)

  if (!validMonth) {
    return (
      <Empty className="mx-auto min-h-80 max-w-4xl border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><CircleDollarSign /></EmptyMedia>
          <EmptyTitle>請先選擇一個有資料的月份</EmptyTitle>
          <EmptyDescription>月度財務脈搏不支援「全部期間」，因為不同月份的現金與損益不能混成同一個月結。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  if (request.loading && !request.data) return <PulseSkeleton />
  if (request.error) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-4xl">
        <AlertTitle>月度財務脈搏載入失敗</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{request.error?.message || "無法取得目前資料。"}</span>
          <Button type="button" variant="outline" size="sm" onClick={request.refetch}>
            <RefreshCw aria-hidden="true" />重新整理
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const pulse = request.data
  if (!pulse || pulse.coverage?.status === "empty") {
    return (
      <Empty className="mx-auto min-h-80 max-w-4xl border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><CircleDollarSign /></EmptyMedia>
          <EmptyTitle>這個月份還沒有足夠資料</EmptyTitle>
          <EmptyDescription>請先匯入交易，並補齊納入分析之現金帳戶的期初與期末餘額。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const currency = pulse.scope.currency
  const pl = pulse.facts.management_pl
  const cash = pulse.facts.cash_flow
  const movement = pulse.facts.typed_cash_movements
  const net = Number(pl.net_result_minor)
  const cashChange = Number(cash.net_cash_change_minor)
  const candidates = pulse.candidates || []

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{pulse.scope.period_start} 至 {pulse.scope.period_end}</p>
          <h2 className="text-2xl font-semibold tracking-tight">月度財務脈搏</h2>
          <p className="mt-1 text-sm text-muted-foreground">每次開啟都依目前資料重新計算，不需要再交給AI重算。</p>
        </div>
        <CoverageBadge status={pulse.coverage.status} />
      </div>

      <CoverageNotice coverage={pulse.coverage} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="管理淨收支"
          description="收入減管理費用；卡費繳款與貸款本金不會重複算費用。"
          value={formatMinor(pl.net_result_minor, currency, { signed: true })}
          icon={Scale}
          tone={Number.isFinite(net) && net >= 0 ? "positive" : "negative"}
        />
        <MetricCard
          title="現金淨變動"
          description="銀行與現金帳戶本月實際流入減流出。"
          value={formatMinor(cash.net_cash_change_minor, currency, { signed: true })}
          icon={WalletCards}
          tone={Number.isFinite(cashChange) && cashChange >= 0 ? "positive" : "negative"}
        />
        <MetricCard
          title="期末現金"
          description="依期間結束日前最新可用餘額快照；缺資料時顯示未知。"
          value={formatMinor(cash.ending_cash_minor, currency)}
          icon={Landmark}
        />
        <MetricCard
          title="已確認義務清償"
          description="卡費、貸款本金與利息／費用的現金清償，不等於本月費用。"
          value={formatMinor(pulse.derived.confirmed_obligation_settlement_cash_minor, currency, { absolute: true })}
          icon={CircleDollarSign}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>現金與管理淨收支為什麼不同</CardTitle>
          <CardDescription>
            差額為 {formatMinor(pulse.derived.economic_to_cash_gap_minor, currency, { signed: true })}。下列項目是差異拆解，不會再加進收入或費用一次。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MovementRow label="信用卡清償" value={movement.confirmed_card_settlement_cash_minor} currency={currency} note="消費已在刷卡時進入管理費用，繳款只改變現金與卡片負債。" />
          <MovementRow label="貸款本金" value={movement.confirmed_loan_principal_cash_minor} currency={currency} note="本金降低負債，不是本月費用。" />
          <MovementRow label="貸款利息與費用" value={movement.confirmed_loan_interest_fee_cash_minor} currency={currency} note="現金流出且會依typed allocation進入管理費用。" />
          <MovementRow label="投資現金" value={movement.confirmed_investment_cash_minor} currency={currency} note="買入為負、賣出為正；投資現值與損益由投資owner另行處理。" />
          <MovementRow label="報銷回收" value={movement.confirmed_reimbursement_cash_minor} currency={currency} note="只列已確認且完整對上的回收；proposal不會先扣除。" />
        </CardContent>
      </Card>

      {candidates.length ? (
        <Alert className="border-warning/30 bg-warning/10 text-warning">
          <AlertTitle>有 {candidates.length} 筆報銷proposal尚未計入</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>確認或拒絕後，下一次查詢會直接重算回收金額與coverage。</span>
            <Button asChild variant="outline" size="sm"><Link href="/confirmations">前往資料確認</Link></Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href={`/reports?month=${month}&statement=income`}>查看損益表</Link></Button>
        <Button asChild variant="outline"><Link href={`/reports?month=${month}&statement=cash`}>查看現金流量表</Link></Button>
      </div>
    </div>
  )
}
