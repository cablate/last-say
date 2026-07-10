"use client"

import { useState } from "react"
import { ArrowRight, ChevronDown, ChevronRight, FileText, ReceiptText } from "lucide-react"

import { formatTWD } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function signedTWD(amount) {
  const n = Number(amount) || 0
  if (n === 0) return formatTWD(0)
  return `${n > 0 ? "+" : "-"}${formatTWD(Math.abs(n))}`
}

function mappingSourceLabel(source) {
  const labels = {
    built_in: "內建判斷",
    report_rule: "報表規則",
    human: "人工指定",
    explicit: "明細指定",
    ai: "AI 建議",
  }
  return labels[source] || source || "未標示"
}

function basisLabel(basis) {
  const labels = {
    card_accrual_management: "管理用信用卡權責制",
    cash: "現金制",
    accrual: "權責制",
  }
  return labels[basis] || basis || "未指定"
}

function entityLabel(entity) {
  const labels = {
    personal: "個人",
    household: "家庭",
    business: "事業",
  }
  return labels[entity] || entity || "未指定"
}

function currencyLabel(currency) {
  const labels = {
    TWD: "新台幣（TWD）",
  }
  return labels[currency] || currency || "未指定"
}

function LineButton({ line, onLineClick }) {
  const ids = line.transaction_ids || []
  const disabled = ids.length === 0
  // report query 截斷 transaction_ids 至 200 筆；超過時僅帶前 200 筆到明細頁。
  const truncated = line.transaction_count > ids.length
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onLineClick(line)}
        disabled={disabled}
        aria-label={`開啟「${line.label}」相關交易`}
      >
        查看
        <ArrowRight data-icon="inline-end" />
      </Button>
      {truncated ? (
        <span className="text-xs text-muted-foreground">前 {ids.length} 筆</span>
      ) : null}
    </span>
  )
}

function SectionHeaderRow({ title, open, onToggle, total }) {
  return (
    <TableRow className="bg-muted/60 hover:bg-muted/60">
      <TableCell colSpan={5} className="p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          <span>{title}</span>
          {!open && typeof total === "number" ? (
            <span className="ml-auto font-mono text-sm font-normal tabular-nums text-muted-foreground">
              {formatTWD(total)}
            </span>
          ) : null}
        </button>
      </TableCell>
    </TableRow>
  )
}

function EmptySectionRow({ label }) {
  return (
    <TableRow>
      <TableCell className="pl-6 text-muted-foreground" colSpan={5}>
        {label}
      </TableCell>
    </TableRow>
  )
}

function LineRow({ line, onLineClick }) {
  return (
    <TableRow>
      <TableCell className="w-[38%] whitespace-normal pl-6">
        <span className="font-medium">{line.label}</span>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatTWD(line.amount_cents)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {line.transaction_count}
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">
        {(line.mapping_sources || []).map(mappingSourceLabel).join("、")}
      </TableCell>
      <TableCell className="text-right">
        <LineButton line={line} onLineClick={onLineClick} />
      </TableCell>
    </TableRow>
  )
}

function SubtotalRow({ label, amount }) {
  return (
    <TableRow className="bg-muted/25 font-medium">
      <TableCell>{label}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatTWD(amount)}
      </TableCell>
      <TableCell />
      <TableCell />
      <TableCell />
    </TableRow>
  )
}

function NetRow({ amount }) {
  const toneClass = amount >= 0 ? "text-success" : "text-destructive"
  return (
    <TableRow className="border-y-2 bg-background text-base font-semibold">
      <TableCell>本期淨損益</TableCell>
      <TableCell className={`text-right font-mono tabular-nums ${toneClass}`}>
        {signedTWD(amount)}
      </TableCell>
      <TableCell />
      <TableCell />
      <TableCell />
    </TableRow>
  )
}

function StatementRows({
  title,
  lines,
  emptyLabel,
  subtotalLabel,
  total,
  onLineClick,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <>
      <SectionHeaderRow
        title={title}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        total={total}
      />
      {open ? (
        <>
          {lines.length === 0 ? (
            <EmptySectionRow label={emptyLabel} />
          ) : (
            lines.map((line) => (
              <LineRow key={line.line} line={line} onLineClick={onLineClick} />
            ))
          )}
          <SubtotalRow label={subtotalLabel} amount={total} />
        </>
      ) : null}
    </>
  )
}

function MobileStatementSection({
  title,
  lines,
  emptyLabel,
  subtotalLabel,
  total,
  onLineClick,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-t first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-2 py-3 text-left font-semibold active:scale-[0.99]"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
        <span>{title}</span>
        <span className="ml-auto font-mono tabular-nums">{formatTWD(total)}</span>
      </button>
      {open ? (
        <div className="pb-3">
          {lines.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            <ul className="divide-y">
              {lines.map((line) => (
                <li key={line.line} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{line.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.transaction_count} 筆 · {(line.mapping_sources || []).map(mappingSourceLabel).join("、")}
                    </p>
                  </div>
                  <p className="font-mono font-medium tabular-nums">{formatTWD(line.amount_cents)}</p>
                  <div className="col-span-2 -ml-3">
                    <LineButton line={line} onLineClick={onLineClick} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t pt-3 text-sm font-medium">
            <span>{subtotalLabel}</span>
            <span className="font-mono tabular-nums">{formatTWD(total)}</span>
          </div>
        </div>
      ) : null}
    </section>
  )
}

const REVIEW_PREVIEW_COUNT = 5

function ReviewItemsTable({ items }) {
  const [expanded, setExpanded] = useState(false)
  if (!items?.length) return null

  const totalCount = items.length
  const showToggle = totalCount > REVIEW_PREVIEW_COUNT
  const visibleItems = expanded || !showToggle
    ? items
    : items.slice(0, REVIEW_PREVIEW_COUNT)

  return (
    <Card>
      <CardHeader>
        <CardDescription>報表完整性阻擋項目</CardDescription>
        <CardTitle>需要指定報表科目的交易</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableCaption>最多顯示前 25 筆需要補報表科目的交易。</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">日期</TableHead>
                <TableHead scope="col">交易</TableHead>
                <TableHead scope="col">分類</TableHead>
                <TableHead scope="col" className="text-right">金額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {item.transaction_date}
                  </TableCell>
                  <TableCell className="min-w-48 font-medium">{item.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.category_primary || "未分類"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatTWD(item.outflow_cents || item.inflow_cents || item.amount_cents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {showToggle ? (
          <div className="mt-3 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded
                ? `只顯示前 ${REVIEW_PREVIEW_COUNT} 筆`
                : `顯示全部 ${totalCount} 筆`}
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  expanded && "rotate-180",
                )}
                aria-hidden="true"
              />
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function IncomeStatement({ report, onLineClick }) {
  const netIncome = Number(report.net_income_cents) || 0

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardDescription>
            {basisLabel(report.basis)} · {entityLabel(report.entity_id)} · {currencyLabel(report.currency)}
          </CardDescription>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            損益表
          </CardTitle>
          <CardAction>
            <Badge variant="outline">
              <ReceiptText className="h-3 w-3" aria-hidden="true" />
              {report.transaction_count} 筆
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableCaption>
                損益表以報表科目彙總收入、支出與不列入損益項目；點「查看」可回到交易明細。
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">科目</TableHead>
                  <TableHead scope="col" className="text-right">金額</TableHead>
                  <TableHead scope="col" className="text-right">筆數</TableHead>
                  <TableHead scope="col" className="text-right">判斷來源</TableHead>
                  <TableHead scope="col" className="text-right">交易</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <StatementRows
                  title="收入"
                  lines={report.revenue || []}
                  emptyLabel="這個範圍沒有收入科目。"
                  subtotalLabel="收入小計"
                  total={report.total_revenue_cents}
                  onLineClick={onLineClick}
                />
                <StatementRows
                  title="支出"
                  lines={report.expenses || []}
                  emptyLabel="這個範圍沒有支出科目。"
                  subtotalLabel="支出小計"
                  total={report.total_expense_cents}
                  onLineClick={onLineClick}
                />
                <NetRow amount={netIncome} />
                <StatementRows
                  title="不列入損益"
                  lines={report.excluded || []}
                  emptyLabel="這個範圍沒有需排除的轉帳、繳款、本金或資產移轉。"
                  subtotalLabel="不列入損益小計"
                  total={report.excluded_total_cents}
                  onLineClick={onLineClick}
                  defaultOpen={false}
                />
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden">
            <MobileStatementSection
              title="收入"
              lines={report.revenue || []}
              emptyLabel="這個範圍沒有收入科目。"
              subtotalLabel="收入小計"
              total={report.total_revenue_cents}
              onLineClick={onLineClick}
            />
            <MobileStatementSection
              title="支出"
              lines={report.expenses || []}
              emptyLabel="這個範圍沒有支出科目。"
              subtotalLabel="支出小計"
              total={report.total_expense_cents}
              onLineClick={onLineClick}
            />
            <div className="flex items-center justify-between border-y-2 py-3 font-semibold">
              <span>本期淨損益</span>
              <span className={cn(
                "font-mono tabular-nums",
                netIncome >= 0 ? "text-success" : "text-destructive",
              )}>
                {signedTWD(netIncome)}
              </span>
            </div>
            <MobileStatementSection
              title="不列入損益"
              lines={report.excluded || []}
              emptyLabel="這個範圍沒有需排除的轉帳、繳款、本金或資產移轉。"
              subtotalLabel="不列入損益小計"
              total={report.excluded_total_cents}
              onLineClick={onLineClick}
              defaultOpen={false}
            />
          </div>
        </CardContent>
      </Card>

      <ReviewItemsTable items={report.review_items} />
    </div>
  )
}
