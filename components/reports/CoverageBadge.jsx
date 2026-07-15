"use client"

import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"

const STATUS_CONFIG = {
  complete: { label: "完整", className: "border-transparent bg-success/15 text-success", icon: CheckCircle2 },
  partial: { label: "部分完成", className: "border-transparent bg-warning/15 text-warning", icon: AlertTriangle },
  unmapped: { label: "待分類", className: "border-transparent bg-info/15 text-info", icon: Info },
  unreconciled: { label: "未對平", variant: "destructive", icon: XCircle },
  empty: { label: "無資料", variant: "secondary", icon: CircleDashed },
}

export default function CoverageBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.partial
  const Icon = config.icon
  return (
    <Badge variant={config.variant || "outline"} className={config.className}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {config.label}
    </Badge>
  )
}
