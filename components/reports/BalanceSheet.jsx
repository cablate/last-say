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
import {
  displayAccountLabel,
  displayCurrency,
  displayPositionMeta,
} from "@/lib/finance/presentation-labels"
import { formatCurrencyMinor } from "@/lib/format"

function formatMoney(amountMinor, currency = "TWD") {
  return formatCurrencyMinor(amountMinor, currency, { missing: "尚無可靠數值" })
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
      <p>資料日期：{line.snapshot_date || "未提供"}</p>
      {keys.length > 0 ? (
        <details className="mt-1 max-w-64">
          <summary className="cursor-pointer select-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            查看來源
          </summary>
          <ul className="mt-1 space-y-1 break-all font-mono text-[11px]">
            {keys.map((key) => <li key={key}>{key}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function LineIdentity({ line }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium" title={displayAccountLabel(line, line.account_kind)}>
        {displayAccountLabel(line, line.account_kind)}
      </p>
      <p className="text-xs text-muted-foreground">{displayPositionMeta(line)}</p>
    </div>
  )
}

function NativeAmount({ line, currency }) {
  return line.native_currency && line.native_currency !== currency
    ? <span>{formatMoney(line.native_amount_cents, line.native_currency)}</span>
    : <span className="text-muted-foreground">—</span>
}

function MobilePositionSection({ title, lines, currency, emptyLabel }) {
  return (
    <section className="space-y-2" aria-labelledby={`balance-mobile-${title}`}>
      <h3 id={`balance-mobile-${title}`} className="text-sm font-semibold text-muted-foreground">{title}</h3>
      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {lines.map((line) => (
            <article key={`${line.role}:${line.resource_key || line.line}`} className="rounded-lg border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <LineIdentity line={line} />
                <p className="shrink-0 text-right font-mono font-semibold tabular-nums">
                  {formatMoney(line.amount_cents, currency)}
                </p>
              </div>
              {line.native_currency && line.native_currency !== currency ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  原幣：<NativeAmount line={line} currency={currency} />
                </p>
              ) : null}
              <div className="mt-2 border-t pt-2">
                <Evidence line={line} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
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
            <LineIdentity line={line} />
          </TableCell>
          <TableCell className="text-right font-mono tabular-nums">
            {formatMoney(line.amount_cents, currency)}
          </TableCell>
          <TableCell className="text-right text-xs text-muted-foreground">
            <NativeAmount line={line} currency={currency} />
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
            截至 {report.as_of_date}；金額以 {displayCurrency(currency)} 顯示，外幣保留原幣金額與換算證據。
          </CardDescription>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            資產負債表
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-5 md:hidden">
            <MobilePositionSection title="資產" lines={report.assets || []} currency={currency} emptyLabel="沒有可計入的資產快照。" />
            <MobilePositionSection title="負債" lines={report.liabilities || []} currency={currency} emptyLabel="沒有可計入的負債快照。" />
            <MobilePositionSection title="權益／淨資產" lines={report.equity || []} currency={currency} emptyLabel="沒有可計入的權益資料。" />
          </div>
          <div className="hidden overflow-x-auto md:block">
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
