"use client"

import { ArrowRight, WalletCards } from "lucide-react"

import { Button } from "@/components/ui/button"
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
  if (amountMinor === null || amountMinor === undefined) return "尚無可靠數值"
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
    signDisplay: "exceptZero",
  }).format(safeAmount / (10 ** digits))
}

function Metric({ label, value, tone = "default" }) {
  const toneClass = {
    default: "text-foreground",
    positive: "text-success",
    negative: "text-destructive",
    warning: "text-warning",
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

function FlowSection({ title, lines, total, currency, onLineClick, emptyLabel }) {
  return (
    <>
      <TableRow className="bg-muted/60 hover:bg-muted/60">
        <TableCell className="font-semibold">{title}</TableCell>
        <TableCell className="text-right font-mono font-semibold tabular-nums">
          {formatMoney(total, currency)}
        </TableCell>
        <TableCell />
      </TableRow>
      {lines.length === 0 ? (
        <TableRow>
          <TableCell colSpan={3} className="text-muted-foreground">{emptyLabel}</TableCell>
        </TableRow>
      ) : lines.map((line) => {
        const canOpen = (line.transaction_ids || []).length > 0
        return (
          <TableRow key={line.line}>
            <TableCell>
              <p className="font-medium">{line.label}</p>
              <p className="text-xs text-muted-foreground">{line.transaction_count ?? line.transaction_ids?.length ?? 0} 筆</p>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatMoney(line.amount_cents, currency)}
            </TableCell>
            <TableCell className="text-right">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canOpen}
                onClick={() => onLineClick(line)}
                aria-label={`查看「${line.label}」交易`}
              >
                明細 <ArrowRight data-icon="inline-end" />
              </Button>
            </TableCell>
          </TableRow>
        )
      })}
    </>
  )
}

export default function CashFlowStatement({ report, onLineClick }) {
  const currency = report.currency || "TWD"
  const net = Number(report.net_cash_flow_cents) || 0
  const delta = report.reconciliation_delta_cents
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="期初現金" value={formatMoney(report.beginning_cash_cents, currency)} />
        <Metric label="本期淨現金流" value={formatMoney(net, currency)} tone={net >= 0 ? "positive" : "negative"} />
        <Metric label="期末現金" value={formatMoney(report.ending_cash_cents, currency)} />
        <Metric
          label="對帳差額"
          value={formatMoney(delta, currency)}
          tone={delta === 0 ? "positive" : "warning"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardDescription>
            {report.period_start} 至 {report.period_end}；期初／期末快照不完整時仍顯示已知流量，但不宣稱已對帳。
          </CardDescription>
          <CardTitle className="flex items-center gap-2">
            <WalletCards className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            現金流量表
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">項目</TableHead>
                  <TableHead scope="col" className="text-right">金額</TableHead>
                  <TableHead scope="col" className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <FlowSection title="營業活動" lines={report.operating || []} total={report.operating_cash_flow_cents} currency={currency} onLineClick={onLineClick} emptyLabel="本期沒有已分類的營業現金流。" />
                <FlowSection title="投資活動" lines={report.investing || []} total={report.investing_cash_flow_cents} currency={currency} onLineClick={onLineClick} emptyLabel="本期沒有已分類的投資現金流。" />
                <FlowSection title="籌資活動" lines={report.financing || []} total={report.financing_cash_flow_cents} currency={currency} onLineClick={onLineClick} emptyLabel="本期沒有已分類的籌資現金流。" />
                <FlowSection title="待釐清流量" lines={report.unresolved || []} total={report.unresolved_cash_flow_cents} currency={currency} onLineClick={onLineClick} emptyLabel="沒有待釐清的現金流。" />
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            已消除 {report.internal_transfers_eliminated?.length || 0} 組已確認的本人帳戶轉帳，共 {formatMoney(report.internal_transfers_eliminated_cents, currency)}。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
