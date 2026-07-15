"use client"

import { Landmark } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function formatMoney(amountMinor, currency = "TWD") {
  const amount = Number(amountMinor)
  const safeAmount = Number.isFinite(amount) ? amount : 0
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
  }).format(safeAmount / (10 ** digits))
}

function Metric({ label, value, tone = "default" }) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-success",
    negative: "text-destructive",
  }[tone]
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate font-mono text-lg font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  )
}

function Evidence({ line }) {
  const keys = [line.resource_key, line.source_key].filter(Boolean)
  return (
    <div className="text-xs text-muted-foreground">
      <p>{line.snapshot_date || "未提供日期"}</p>
      {keys.length > 0 ? (
        <details className="mt-1 max-w-64">
          <summary className="cursor-pointer select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            證據識別碼
          </summary>
          <ul className="mt-1 space-y-1 break-all font-mono">
            {keys.map((key) => <li key={key}>{key}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function PositionSection({ title, lines, currency, emptyLabel }) {
  return (
    <>
      <TableRow className="bg-muted/60 hover:bg-muted/60">
        <TableCell colSpan={4} className="font-semibold">{title}</TableCell>
      </TableRow>
      {lines.length === 0 ? (
        <TableRow>
          <TableCell colSpan={4} className="text-muted-foreground">{emptyLabel}</TableCell>
        </TableRow>
      ) : lines.map((line) => (
        <TableRow key={`${line.role}:${line.resource_key || line.line}`}>
          <TableCell>
            <p className="font-medium">{line.label}</p>
            <p className="text-xs text-muted-foreground">{line.account_kind || line.item_type || line.line}</p>
          </TableCell>
          <TableCell className="text-right font-mono tabular-nums">
            {formatMoney(line.amount_cents, currency)}
          </TableCell>
          <TableCell className="text-right text-xs text-muted-foreground">
            {line.native_currency && line.native_currency !== currency
              ? formatMoney(line.native_amount_cents, line.native_currency)
              : "—"}
          </TableCell>
          <TableCell><Evidence line={line} /></TableCell>
        </TableRow>
      ))}
    </>
  )
}

export default function BalanceSheet({ report }) {
  const netWorth = Number(report.net_worth_cents) || 0
  const currency = report.currency || "TWD"
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="資產合計" value={formatMoney(report.total_assets_cents, currency)} />
        <Metric label="負債合計" value={formatMoney(report.total_liabilities_cents, currency)} tone="negative" />
        <Metric
          label="淨資產"
          value={formatMoney(netWorth, currency)}
          tone={netWorth >= 0 ? "positive" : "negative"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardDescription>
            截至 {report.as_of_date}；金額以 {currency} 顯示，外幣保留原幣金額與換算證據。
          </CardDescription>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            資產負債表
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">項目</TableHead>
                  <TableHead scope="col" className="text-right">換算金額</TableHead>
                  <TableHead scope="col" className="text-right">原幣金額</TableHead>
                  <TableHead scope="col">快照與證據</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <PositionSection title="資產" lines={report.assets || []} currency={currency} emptyLabel="沒有可計入的資產快照。" />
                <PositionSection title="負債" lines={report.liabilities || []} currency={currency} emptyLabel="沒有可計入的負債快照。" />
                <PositionSection title="權益／淨資產" lines={report.equity || []} currency={currency} emptyLabel="沒有可計入的權益資料。" />
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
