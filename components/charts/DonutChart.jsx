"use client"

// DonutChart：圓餅圖，用 shadcn ChartContainer + Recharts PieChart。
// props：
//   data: [{ label, value, color? }]  color 可選，未提供時依主題 --chart-1..5 循環
//   ariaLabel: 圖表 aria-label
// 無資料時顯示 Empty；附 visually-hidden 資料表供螢幕閱讀器。

import { Cell, Pie, PieChart } from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { formatTWD } from "@/lib/format"

// shadcn 語意圖表色，避免自訂低對比色。
const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

function colorFor(item, i) {
  return item.color || PALETTE[i % PALETTE.length]
}

export default function DonutChart({ data = [], ariaLabel = "分類圓餅圖" }) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>無資料</EmptyTitle>
          <EmptyDescription>目前沒有可顯示的項目</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0)

  // ChartContainer config：tooltip / legend 透過 nameKey 反查 label 與 color。
  const config = Object.fromEntries(
    data.map((d, i) => [
      d.label,
      { label: d.label, color: colorFor(d, i) },
    ]),
  )

  return (
    <div role="figure" aria-label={ariaLabel}>
      <ChartContainer
        config={config}
        className="mx-auto aspect-square min-h-[280px] w-full max-w-[320px]"
      >
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                nameKey="label"
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatTWD(value)}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="85%"
            strokeWidth={2}
            paddingAngle={data.length > 1 ? 2 : 0}
          >
            {data.map((d, i) => (
              <Cell key={d.label ?? i} fill={colorFor(d, i)} />
            ))}
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey="label" />} />
        </PieChart>
      </ChartContainer>

      {/* 螢幕閱讀器可用之資料表 */}
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th scope="col">項目</th>
            <th scope="col">金額</th>
            <th scope="col">占比</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => {
            const v = Number(d.value) || 0
            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0.0"
            return (
              <tr key={d.label}>
                <th scope="row">{d.label}</th>
                <td>{formatTWD(v)}</td>
                <td>{pct}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
