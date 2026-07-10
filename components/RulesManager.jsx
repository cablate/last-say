"use client"

// RulesManager — 分類規則管理介面（P4#15）
// 規則由 AI 產出（第一環分析、第二環讀 correction_log 整理），本工具匯入時機械式套用。
// 這裡供「人類」檢視全部規則、查看低信心規則優先調整、啟停 / 編輯 / 刪除 / 新增。
// 對應 GET/POST/PATCH/DELETE /api/rules。

import { useEffect, useMemo, useState } from "react"
import {
  ListChecks, AlertTriangle, RefreshCw, Plus, Pencil, Trash2, Search, Sparkles,
} from "lucide-react"
import {
  useRules, useCreateRule, useUpdateRule, useDeleteRule, useReclassifyRuleHistory,
} from "@/lib/hooks"
import { confidenceTier, LOW_CONFIDENCE_THRESHOLD, STANDARD_CATEGORIES } from "@/lib/constants"
import { cn } from "@/lib/utils"
import ErrorBoundary from "@/components/ErrorBoundary"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription,
} from "@/components/ui/empty"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const DIRECTION_LABEL = { in: "轉入", out: "轉出" }
const ORIGIN_LABEL = { ai_analysis: "AI 分析", human_correction: "人工校正", bootstrap: "冷啟動" }

// 信心度 Badge：規則的信心分數（0~1），紅綠燈語意（高綠/中琥珀/低紅）。
// 色彩與門檻集中於 lib/constants.js（confidenceTier），與「低信心」篩選共用同一組定義。
function Confidence({ value }) {
  const tier = confidenceTier(value ?? -1)
  return (
    <Badge
      variant="outline"
      className={cn("tabular-nums font-normal", tier.className)}
      title={`信心度 ${value != null ? value.toFixed(2) : "—"}（${tier.label}）`}
    >
      {value != null ? value.toFixed(2) : "—"}
    </Badge>
  )
}

// 套用準確率（客觀指標，補 AI 主觀信心度）：套用次數 / 覆寫次數 → 準確率%。
// 低於 60% 顯示紅色警示，提示該規則 AI 可能高估、需檢視或拆規則。
function Accuracy({ rule, className }) {
  const applied = rule.applied_count ?? 0
  const overridden = rule.overridden_count ?? 0
  if (applied === 0) {
    return <span className={cn("text-muted-foreground", className)} title={`建議樣本 ${rule.sample_count}（尚未實際套用）`}>—</span>
  }
  const acc = Math.round(((applied - overridden) / applied) * 100)
  const low = acc < 60
  return (
    <span
      className={cn(low ? "font-medium text-danger" : "text-muted-foreground", className)}
      title={`套用 ${applied} 次、被覆寫 ${overridden} 次（建議樣本 ${rule.sample_count}）`}
    >
      {applied}次 · {acc}%
    </span>
  )
}

function ResultBadges({ rule }) {
  const vals = [rule.category_value].filter(Boolean)
  if (vals.length === 0) return <span className="text-xs text-muted-foreground">（無結果）</span>
  return (
    <div className="flex flex-wrap gap-1">
      {vals.map((v) => (
        <Badge key={v} variant="outline" className="font-normal">{v}</Badge>
      ))}
    </div>
  )
}

function ConditionText({ rule }) {
  const parts = []
  // 顯示代表交易名（原始，可能因銀行帳單而截斷）為主；技術 match_key 收到 tooltip。
  const nameToShow = rule.sample_name || rule.match_key
  if (nameToShow) parts.push(nameToShow)
  if (rule.source_type) parts.push(rule.source_type)
  if (rule.direction) parts.push(DIRECTION_LABEL[rule.direction])
  const showKeyTip = rule.match_key && rule.match_key !== nameToShow
  return <span className={parts.length ? "" : "text-xs text-muted-foreground"} title={showKeyTip ? `比對鍵：${rule.match_key}` : undefined}>
    {parts.length ? parts.join(" · ") : "（無條件）"}
  </span>
}

const EMPTY_FORM = {
  match_key: "", source_type: "", direction: "none",
  category_value: "", raw_name: "",
  confidence: "0.5", note: "", enabled: true,
}

function toForm(rule) {
  if (!rule) return { ...EMPTY_FORM }
  return {
    match_key: rule.match_key || "",
    source_type: rule.source_type || "",
    direction: rule.direction || "none",
    category_value: rule.category_value || "",
    raw_name: rule.sample_name || "",
    confidence: rule.confidence != null ? String(rule.confidence) : "0.5",
    note: rule.note || "",
    enabled: rule.enabled !== 0,
  }
}

function normalizedFormSemantics(form) {
  return {
    match_key: form.match_key.trim() || null,
    source_type: form.source_type.trim() || null,
    direction: form.direction === "none" ? null : form.direction,
    category_value: form.category_value.trim() || null,
    enabled: form.enabled ? 1 : 0,
  }
}

function changesClassificationSemantics(rule, form) {
  if (!rule) return false
  const next = normalizedFormSemantics(form)
  return Object.entries(next).some(([field, value]) =>
    String(rule[field] ?? "") !== String(value ?? ""),
  )
}

function RuleImpactCounts({ rule, compact = false }) {
  const linked = Number(rule?.linked_rows) || 0
  const unreviewed = Number(rule?.unreviewed_rows) || 0
  const reviewed = Number(rule?.reviewed_rows) || 0

  if (compact) {
    return (
      <span className={cn("text-xs tabular-nums", linked > 0 ? "font-medium text-foreground" : "text-muted-foreground")}>
        {linked > 0 ? `${linked} 筆連結中` : "無歷史連結"}
      </span>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/30 p-3 text-center text-xs tabular-nums">
      <div><strong className="block text-base text-foreground">{linked}</strong><span className="text-muted-foreground">目前連結</span></div>
      <div><strong className="block text-base text-foreground">{unreviewed}</strong><span className="text-muted-foreground">未確認</span></div>
      <div><strong className="block text-base text-foreground">{reviewed}</strong><span className="text-muted-foreground">已確認</span></div>
    </div>
  )
}

function CategoryPicker({ id, value, onValueChange }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="選擇標準分類" />
      </SelectTrigger>
      <SelectContent>
        {STANDARD_CATEGORIES.map((option) => (
          <SelectItem key={option} value={option}>{option}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RuleDialog({ open, onOpenChange, initial, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setForm(toForm(initial))
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const nonStandardCategory = form.category_value && !STANDARD_CATEGORIES.includes(form.category_value)
  const willReclassifyHistory = Boolean(
    initial && Number(initial.linked_rows) > 0 && changesClassificationSemantics(initial, form),
  )

  async function normalizeRawName() {
    const text = form.raw_name.trim()
    if (!text) return
    const res = await fetch(`/api/rules/normalize?text=${encodeURIComponent(text)}`)
    const data = await res.json()
    set("match_key", data.match_key || "")
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.note.trim()) return
    if (form.category_value && !STANDARD_CATEGORIES.includes(form.category_value)) return
    setSaving(true)
    try {
      const body = {
        match_key: form.match_key.trim() || null,
        source_type: form.source_type.trim() || null,
        direction: form.direction === "none" ? null : form.direction,
        category_value: form.category_value.trim() || null,
        confidence: Number(form.confidence) || 0,
        note: form.note.trim(),
        enabled: form.enabled,
      }
      await onSave(body)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "編輯規則" : "新增規則"}</DialogTitle>
          <DialogDescription>
            至少設定一個比對條件，並選擇要套用的標準分類。附註需說明規則依據。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">比對條件（AND）</Label>
            <div className="grid gap-2">
              <div>
                <Label htmlFor="f-mk" className="text-xs">名稱比對鍵（match_key，正規化後）</Label>
                <Input id="f-mk" value={form.match_key} onChange={(e) => set("match_key", e.target.value)} placeholder="例：google*cloud" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-raw-name" className="text-xs">由原始名稱計算</Label>
                <div className="flex gap-2">
                  <Input id="f-raw-name" value={form.raw_name} onChange={(e) => set("raw_name", e.target.value)} placeholder="貼上原始交易名稱" />
                  <Button type="button" variant="outline" onClick={normalizeRawName} disabled={saving}>計算</Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="f-st" className="text-xs">來源 / 帳戶</Label>
                  <Input id="f-st" value={form.source_type} onChange={(e) => set("source_type", e.target.value)} placeholder="例：示範信用卡" />
                </div>
                <div>
                  <Label className="text-xs">方向</Label>
                  <Select value={form.direction} onValueChange={(v) => set("direction", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不限</SelectItem>
                      <SelectItem value="in">轉入（有人轉給我）</SelectItem>
                      <SelectItem value="out">轉出（我轉出去）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">分類結果（套用值）</Label>
            <div>
              <Label htmlFor="f-cat" className="text-xs">分類</Label>
              {nonStandardCategory ? (
                <Alert className="mb-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>非標準分類</AlertTitle>
                  <AlertDescription>
                    既有值「{form.category_value}」不在標準分類內，儲存前請改選標準值。
                  </AlertDescription>
                </Alert>
              ) : null}
              <CategoryPicker id="f-cat" value={form.category_value} onValueChange={(v) => set("category_value", v)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="f-conf" className="text-xs">信心度（0~1）</Label>
              <Input id="f-conf" type="number" min="0" max="1" step="0.05" value={form.confidence} onChange={(e) => set("confidence", e.target.value)} />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.enabled} onCheckedChange={(v) => set("enabled", v === true)} />
                啟用
              </label>
            </div>
          </div>

          <div>
            <Label htmlFor="f-note" className="text-xs">附註（為什麼這條規則，必填）</Label>
            <Textarea id="f-note" value={form.note} onChange={(e) => set("note", e.target.value)} rows={2} required />
          </div>

          {willReclassifyHistory && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>這次修改會重新校正歷史交易</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>未確認交易會重新比對全部啟用規則；找不到替代規則的交易會送回待審。已確認分類不會被覆寫。</p>
                <RuleImpactCounts rule={initial} />
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
            <Button type="submit" disabled={saving || !form.note.trim() || nonStandardCategory}>
              {saving ? "儲存中…" : willReclassifyHistory ? "儲存並重新校正" : "儲存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>載入規則失敗</AlertTitle>
      <AlertDescription>
        <p className="text-sm">{message || "請稍後再試。"}</p>
        {onRetry && (
          <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" /> 重試
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

export default function RulesManager() {
  const [filter, setFilter] = useState({ lowOnly: false, enabled: "all", q: "" })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [mutatingRuleId, setMutatingRuleId] = useState(null)

  const params = useMemo(() => {
    const sp = new URLSearchParams()
    if (filter.lowOnly) sp.set("maxConfidence", String(LOW_CONFIDENCE_THRESHOLD))
    if (filter.enabled !== "all") sp.set("enabled", filter.enabled)
    if (filter.q.trim()) sp.set("q", filter.q.trim())
    return sp.toString()
  }, [filter])

  const { data, loading, error, refetch } = useRules(params)
  const createRule = useCreateRule()
  const updateRule = useUpdateRule()
  const deleteRule = useDeleteRule()
  const reclassifyRuleHistory = useReclassifyRuleHistory()

  const rules = data?.rules || []
  const lowCount = rules.filter((r) => r.confidence < LOW_CONFIDENCE_THRESHOLD).length

  function openNew() { setEditing(null); setDialogOpen(true) }
  function openEdit(rule) { setEditing(rule); setDialogOpen(true) }

  async function handleSave(body) {
    if (editing) await updateRule(editing.id, body)
    else await createRule(body)
    refetch()
  }

  async function handleToggle(rule) {
    if (rule.enabled === 1) {
      setConfirmation({ action: "disable", rule })
      return
    }
    setMutatingRuleId(rule.id)
    try {
      await updateRule(rule.id, { enabled: true })
      refetch()
    } finally {
      setMutatingRuleId(null)
    }
  }

  async function confirmRuleAction() {
    if (!confirmation) return
    const { action, rule } = confirmation
    setMutatingRuleId(rule.id)
    try {
      if (action === "disable") await updateRule(rule.id, { enabled: false })
      if (action === "delete") await deleteRule(rule.id)
      if (action === "reclassify") await reclassifyRuleHistory(rule.id)
      setConfirmation(null)
      refetch()
    } finally {
      setMutatingRuleId(null)
    }
  }

  const confirmationRule = confirmation?.rule
  const confirmationCopy = confirmation?.action === "disable"
    ? {
        title: "停用規則並重新校正？",
        description: "未確認交易會重新比對其他啟用規則；找不到替代規則的會送回待審。已確認分類會保留並轉成人工權威。",
        label: "停用並重新校正",
        destructive: false,
      }
    : confirmation?.action === "reclassify"
      ? {
          title: "校正舊資料？",
          description: "規則會保持停用。仍連結此規則的舊交易會重新比對其他啟用規則，或送回待審。",
          label: "校正舊資料",
          destructive: false,
        }
      : {
          title: "刪除規則並重新校正？",
          description: "規則會永久移除。未確認交易會改套其他啟用規則或送回待審；已確認分類不會被覆寫。",
          label: "刪除並重新校正",
          destructive: true,
        }

  return (
    <ErrorBoundary>
      <section className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold tracking-tight">分類規則</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              規則由 AI 產出與累積，匯入時自動套用。人類在此檢視、查看低信心規則優先調整。
            </p>
          </div>
          <Button onClick={openNew} size="sm">
            <Plus className="mr-1 h-4 w-4" /> 新增規則
          </Button>
        </header>

        {/* 篩選列 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter.q}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
              placeholder="搜尋比對鍵或附註"
              className="h-9 w-56 pl-8"
            />
          </div>
          <Select value={filter.enabled} onValueChange={(v) => setFilter((f) => ({ ...f, enabled: v }))}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部狀態</SelectItem>
              <SelectItem value="1">僅啟用</SelectItem>
              <SelectItem value="0">僅停用</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={filter.lowOnly ? "default" : "outline"}
            size="sm"
            aria-pressed={filter.lowOnly}
            aria-label="僅顯示低信心規則"
            onClick={() => setFilter((f) => ({ ...f, lowOnly: !f.lowOnly }))}
          >
            <Sparkles className="mr-1 h-4 w-4" /> 低信心（&lt;{LOW_CONFIDENCE_THRESHOLD}）
          </Button>
          {!loading && !error && (
            <span className="ml-auto text-xs text-muted-foreground">
              共 {rules.length} 條{lowCount > 0 && ` · 低信心 ${lowCount} 條`}
            </span>
          )}
        </div>

        {error ? (
          <ErrorState message={error?.message} onRetry={refetch} />
        ) : loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : rules.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><ListChecks className="h-4 w-4" /></EmptyMedia>
              <EmptyTitle>{filter.q || filter.enabled !== "all" || filter.lowOnly ? "沒有符合的規則" : "尚無規則"}</EmptyTitle>
              <EmptyDescription>
                {filter.q || filter.enabled !== "all" || filter.lowOnly
                  ? "調整篩選條件試試。"
                  : "AI 分析帳單並檢索既有經驗後，會透過 API 寫入規則；也可按「新增規則」手動建立。"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {/* Desktop 表格 */}
            <div className="hidden rounded-md border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[28%]">比對條件</TableHead>
                    <TableHead>分類結果</TableHead>
                    <TableHead className="text-right">信心</TableHead>
                    <TableHead className="text-right">套用 / 準確率</TableHead>
                    <TableHead className="text-right">歷史影響</TableHead>
                    <TableHead>來源</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id} data-disabled={rule.enabled === 0} className={rule.enabled === 0 ? "opacity-50" : ""}>
                      <TableCell>
                        <div className="space-y-0.5">
                          <ConditionText rule={rule} />
                          {rule.note && <div className="text-xs text-muted-foreground line-clamp-1">{rule.note}</div>}
                        </div>
                      </TableCell>
                      <TableCell><ResultBadges rule={rule} /></TableCell>
                      <TableCell className="text-right"><Confidence value={rule.confidence} /></TableCell>
                      <TableCell className="text-right"><Accuracy rule={rule} className="tabular-nums text-xs" /></TableCell>
                      <TableCell className="text-right"><RuleImpactCounts rule={rule} compact /></TableCell>
                      <TableCell><Badge variant="secondary" className="font-normal">{ORIGIN_LABEL[rule.origin] || rule.origin}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {rule.enabled === 0 && Number(rule.linked_rows) > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2"
                              onClick={() => setConfirmation({ action: "reclassify", rule })}
                              disabled={mutatingRuleId !== null}
                            >
                              <RefreshCw className="mr-1 h-3.5 w-3.5" />校正舊資料
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => handleToggle(rule)} disabled={mutatingRuleId !== null}>
                            {mutatingRuleId === rule.id ? "處理中…" : rule.enabled === 1 ? "停用" : "啟用"}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(rule)} aria-label="編輯" disabled={mutatingRuleId !== null}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setConfirmation({ action: "delete", rule })} aria-label="刪除" disabled={mutatingRuleId !== null}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile 卡片 */}
            <div className="space-y-2 md:hidden">
              {rules.map((rule) => (
                <div key={rule.id} className={`rounded-md border p-3 ${rule.enabled === 0 ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <ConditionText rule={rule} />
                      <ResultBadges rule={rule} />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Confidence value={rule.confidence} />
                        <Badge variant="secondary" className="font-normal">{ORIGIN_LABEL[rule.origin] || rule.origin}</Badge>
                        <Accuracy rule={rule} className="text-xs" />
                        <RuleImpactCounts rule={rule} compact />
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      {rule.enabled === 0 && Number(rule.linked_rows) > 0 && (
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirmation({ action: "reclassify", rule })} disabled={mutatingRuleId !== null}>
                          <RefreshCw className="mr-1 h-3.5 w-3.5" />校正舊資料
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => handleToggle(rule)} disabled={mutatingRuleId !== null}>
                        {mutatingRuleId === rule.id ? "處理中…" : rule.enabled === 1 ? "停用" : "啟用"}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEdit(rule)} disabled={mutatingRuleId !== null}>編輯</Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive" onClick={() => setConfirmation({ action: "delete", rule })} disabled={mutatingRuleId !== null}>刪除</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <RuleDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} onSave={handleSave} />

        <Dialog open={!!confirmation} onOpenChange={(open) => !open && mutatingRuleId === null && setConfirmation(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{confirmationCopy.title}</DialogTitle>
              <DialogDescription>{confirmationCopy.description}</DialogDescription>
            </DialogHeader>
            {confirmationRule && (
              <div className="space-y-3">
                <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
                <div><span className="text-muted-foreground">比對鍵：</span>{confirmationRule.match_key || "（不限名稱）"}</div>
                {(confirmationRule.source_type || confirmationRule.direction) && (
                  <div className="text-xs text-muted-foreground">
                    {confirmationRule.source_type}{confirmationRule.direction ? ` · ${DIRECTION_LABEL[confirmationRule.direction]}` : ""}
                  </div>
                )}
                <div><span className="text-muted-foreground">分類：</span>{confirmationRule.category_value}</div>
                </div>
                <RuleImpactCounts rule={confirmationRule} />
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmation(null)} disabled={mutatingRuleId !== null}>取消</Button>
              <Button variant={confirmationCopy.destructive ? "destructive" : "default"} onClick={confirmRuleAction} disabled={mutatingRuleId !== null}>
                {mutatingRuleId !== null ? "處理中…" : confirmationCopy.label}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    </ErrorBoundary>
  )
}
