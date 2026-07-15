"use client"

import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

function formatMinor(amountMinor, currency = "TWD") {
  if (amountMinor === null || amountMinor === undefined) return "未知"
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
    signDisplay: "exceptZero",
  }).format(Number(amountMinor) / (10 ** digits))
}

function BlockerList({ blockers }) {
  if (blockers.length === 0) return null
  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm">
      {blockers.map((blocker, index) => (
        <li key={`${blocker.kind}:${blocker.resource_key || blocker.transaction_id || blocker.account_id || index}`}>
          {blocker.label}
        </li>
      ))}
    </ul>
  )
}

export default function CoveragePanel({ coverage }) {
  if (!coverage) return null
  const blockers = coverage.blockers || []

  if (coverage.status === "empty") {
    return (
      <Alert className="border-muted bg-muted/30">
        <CircleDashed className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>目前沒有足夠資料產生這張報表</AlertTitle>
        <AlertDescription>請檢查期間、納入分析的帳戶，以及必要交易或餘額快照。</AlertDescription>
      </Alert>
    )
  }

  if (coverage.status === "complete") {
    return (
      <Alert className="border-success/30 bg-success/10 text-success">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>這張報表在目前範圍內已完整</AlertTitle>
        <AlertDescription className="text-success/90">必要資料、分類與對帳條件均已通過。</AlertDescription>
      </Alert>
    )
  }

  if (coverage.status === "unmapped") {
    return (
      <Alert className="border-info/30 bg-info/10 text-info">
        <Info className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>已有資料，但仍有交易尚未對應報表項目</AlertTitle>
        <AlertDescription className="text-info/90">
          尚有 {coverage.unmapped_transaction_count || 0} 筆交易需要分類；目前數字可以預覽，但不能視為完整報表。
          <BlockerList blockers={blockers} />
        </AlertDescription>
      </Alert>
    )
  }

  if (coverage.status === "unreconciled") {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>報表尚未對平</AlertTitle>
        <AlertDescription>
          目前對帳差額為 {formatMinor(coverage.reconciliation_delta_cents, coverage.currency)}；請先處理差額與下列阻礙。
          <BlockerList blockers={blockers} />
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert className="border-warning/30 bg-warning/10 text-warning">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>這張報表可預覽，但仍不完整</AlertTitle>
      <AlertDescription>
        已知數字仍會顯示；缺少或待確認的資料不會被猜成零。
        <BlockerList blockers={blockers} />
      </AlertDescription>
    </Alert>
  )
}
