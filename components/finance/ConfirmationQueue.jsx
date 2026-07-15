"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

const WORKBENCH_CONTRACT = "finance.review-workbench/v1"
const DEFAULT_RESOLUTION_NOTE = "已檢視工作台提供的證據、缺漏資訊與影響，依目前資料做成決議。"
const REFRESH_REQUIRED_CODES = new Set([
  "HUMAN_CONFIRMATION_REQUIRED",
  "NOT_FOUND",
  "REVIEW_REQUIRED",
  "SOURCE_REQUIRED",
  "VERSION_CONFLICT",
])

const SECTION_CONFIG = [
  { key: "human_confirmations", label: "人工權限確認", description: "需要目前瀏覽器工作階段授權的動作。" },
  { key: "actionable_reviews", label: "可處理決議", description: "透過各資料的 typed owner 確認或拒絕。" },
  { key: "owner_unresolved", label: "用途未確認", description: "保留可見，不在這裡猜測分類。" },
  { key: "conflicts", label: "來源衝突", description: "只能從伺服器提供的既有證據中選擇。" },
]

const TYPED_ENDPOINTS = {
  transfer_match: (key) => `/api/finance/reconciliation/transfers/${encodeURIComponent(key)}`,
  reimbursement_match: (key) => `/api/finance/reimbursements/${encodeURIComponent(key)}`,
  commitment: (key) => `/api/finance/commitments/${encodeURIComponent(key)}`,
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasFields(value) {
  return isObject(value) && Object.keys(value).length > 0
}

function itemActions(item) {
  return Array.isArray(item.actions) ? item.actions : []
}

function fieldLabel(value) {
  return String(value).replaceAll("_", " ")
}

async function requestJson(url, options, fallbackMessage) {
  const response = await fetch(url, options)
  let data = null
  try {
    data = await response.json()
  } catch {
    // The status and fallback still provide a safe, actionable error.
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || fallbackMessage)
    error.code = data?.error?.code
    error.status = response.status
    error.retryable = Boolean(data?.error?.retryable)
    throw error
  }
  return data || {}
}

function validatesWorkbench(data) {
  return data?.contract === WORKBENCH_CONTRACT
    && isObject(data.counts)
    && isObject(data.sections)
    && SECTION_CONFIG.every(({ key }) => Array.isArray(data.sections[key]))
}

function requiresFullRefresh(error) {
  return error?.status === 404
    || error?.status === 409
    || REFRESH_REQUIRED_CODES.has(error?.code)
}

function actionFor(item, kind) {
  return itemActions(item).find((action) => action.kind === kind)
}

function actionLabel(item, kind) {
  return actionFor(item, kind)?.label || (kind === "confirm" ? "確認" : "拒絕")
}

async function performItemAction(item, actionKind, form) {
  if (item.item_kind === "scope_confirmation" && actionKind === "confirm_scope") {
    const session = await requestJson(
      "/api/finance/human-confirmations/browser-session",
      { cache: "no-store", credentials: "same-origin" },
      "無法建立確認工作階段",
    )
    if (!session.browser_nonce) throw new Error("確認工作階段沒有提供 browser nonce")
    return requestJson(
      `/api/finance/human-confirmations/${encodeURIComponent(item.item_key)}/confirm`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browser_nonce: session.browser_nonce }),
      },
      "確認失敗",
    )
  }

  if (item.item_kind === "source_conflict" && actionKind === "select_source") {
    const selectedSourceKey = form.selected_source_key?.trim()
    const resolutionNote = form.resolution_note?.trim()
    if (!selectedSourceKey) throw new Error("請選擇一個伺服器提供的來源")
    if (!resolutionNote) throw new Error("請填寫來源選擇備註")
    const suppliedKeys = new Set(
      (Array.isArray(item.evidence) ? item.evidence : [])
        .map((entry) => entry?.source_key)
        .filter((key) => typeof key === "string" && key),
    )
    if (!suppliedKeys.has(selectedSourceKey)) throw new Error("選擇的來源不在目前證據中，請重新整理")
    return requestJson(
      `/api/finance/source-conflicts/${encodeURIComponent(item.resource.key)}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_source_key: selectedSourceKey, resolution_note: resolutionNote }),
      },
      "來源衝突處理失敗",
    )
  }

  const endpoint = TYPED_ENDPOINTS[item.resource?.type]
  if (!endpoint || !["confirm", "reject"].includes(actionKind)) {
    throw new Error("這個項目沒有安全的 typed action")
  }

  if (item.resource.type === "commitment") {
    const preview = item.after_preview?.[actionKind]
    if (!isObject(preview)) throw new Error("伺服器沒有提供此決議的 after preview")
    return requestJson(
      endpoint(item.resource.key),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preview),
      },
      "固定收支決議失敗",
    )
  }

  const resolutionNote = form.resolution_note?.trim()
  if (!resolutionNote) throw new Error("請填寫決議備註")
  return requestJson(
    endpoint(item.resource.key),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_version: item.resource.version,
        match_status: actionKind === "confirm" ? "confirmed" : "rejected",
        resolution_note: resolutionNote,
      }),
    },
    "決議失敗",
  )
}

// The server owns financial semantics. This renderer only exposes supplied fields;
// it never totals, converts, infers, or replaces unknown values with zero.
function DataValue({ value }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">未提供</span>
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">無</span>
    return (
      <ul role="list" className="space-y-1">
        {value.map((entry, index) => (
          <li key={index} className="break-words">
            <DataValue value={entry} />
          </li>
        ))}
      </ul>
    )
  }
  if (isObject(value)) {
    const entries = Object.entries(value)
    if (!entries.length) return <span className="text-muted-foreground">無</span>
    return (
      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
        {entries.map(([key, entry]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{fieldLabel(key)}</dt>
            <dd className="min-w-0 break-words"><DataValue value={entry} /></dd>
          </div>
        ))}
      </dl>
    )
  }
  return <span className="break-words">{String(value)}</span>
}

function Evidence({ evidence }) {
  const entries = Array.isArray(evidence) ? evidence : []
  return (
    <div className="space-y-1.5">
      <h5 className="text-xs font-medium text-muted-foreground">證據</h5>
      {entries.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {entries.map((entry, index) => (
            <div key={index} className="rounded-sm border bg-muted/20 p-2 text-xs">
              <DataValue value={entry} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">伺服器未提供可顯示的證據。</p>
      )}
    </div>
  )
}

function ItemContext({ item }) {
  const missingEvidence = Array.isArray(item.missing_evidence) ? item.missing_evidence : []
  return (
    <div className="space-y-3">
      <div>
        <h5 className="text-xs font-medium text-muted-foreground">需要決定的原因</h5>
        <p className="mt-1 text-sm leading-5">{item.reason || "伺服器未提供原因。"}</p>
      </div>
      <Evidence evidence={item.evidence} />
      <div>
        <h5 className="text-xs font-medium text-muted-foreground">影響</h5>
        <div className="mt-1 rounded-sm border bg-muted/20 p-2 text-xs">
          <DataValue value={item.impact} />
        </div>
      </div>
      {missingEvidence.length ? (
        <div>
          <h5 className="text-xs font-medium text-warning">缺少的證據</h5>
          <ul role="list" className="mt-1 space-y-1 text-xs text-muted-foreground">
            {missingEvidence.map((entry, index) => <li key={index}>• {entry}</li>)}
          </ul>
        </div>
      ) : null}
      {hasFields(item.before) || hasFields(item.after_preview) || hasFields(item.recovery) ? (
        <details className="text-xs">
          <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            查看目前狀態、伺服器預覽與復原方式
          </summary>
          <div className="mt-2 grid gap-2 rounded-sm border bg-muted/20 p-2 sm:grid-cols-2">
            <div><p className="mb-1 font-medium">resource</p><DataValue value={item.resource} /></div>
            <div><p className="mb-1 font-medium">recovery</p><DataValue value={item.recovery} /></div>
            {hasFields(item.before) ? <div><p className="mb-1 font-medium">before</p><DataValue value={item.before} /></div> : null}
            {hasFields(item.after_preview) ? <div><p className="mb-1 font-medium">after preview</p><DataValue value={item.after_preview} /></div> : null}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function DecisionButtons({ item, actions }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {actions.map((action) => (
        <Button
          key={action.kind}
          type="submit"
          name="decision"
          value={action.kind}
          variant={action.kind === "reject" ? "outline" : "default"}
          size="sm"
          disabled={action.enabled === false}
          aria-label={`${action.label}：${item.title}`}
        >
          {action.label}
        </Button>
      ))}
    </div>
  )
}

function ActionPanel({ item, domId, form, itemState, onFormChange, onResolve }) {
  const disabled = Boolean(itemState.pending || itemState.locked)
  const actions = itemActions(item)

  if (item.item_kind === "owner_unresolved_transaction") {
    const label = actionFor(item, "open_transaction_correction")?.label || "前往未確認交易"
    const transactionHref = Number.isInteger(item.transaction_id)
      ? `/transactions?ids=${item.transaction_id}`
      : "/transactions"
    return (
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href={transactionHref} aria-label={`${label}：${item.title}`}>
            {label}<ExternalLink aria-hidden="true" />
          </Link>
        </Button>
      </div>
    )
  }

  if (item.item_kind === "scope_confirmation") {
    const action = actionFor(item, "confirm_scope")
    if (!action) return null
    return (
      <fieldset disabled={disabled || action.enabled === false} className="flex justify-end">
        <legend className="sr-only">{item.title}</legend>
        <Button
          type="button"
          size="sm"
          onClick={() => onResolve(item, action.kind)}
          aria-label={`${action.label}：${item.title}`}
        >
          <ShieldCheck aria-hidden="true" />{action.label}
        </Button>
      </fieldset>
    )
  }

  if (item.item_kind === "source_conflict") {
    const sourceOptions = (Array.isArray(item.evidence) ? item.evidence : [])
      .filter((entry) => typeof entry?.source_key === "string" && entry.source_key)
    const action = actionFor(item, "select_source")
    if (!action) return null
    return (
      <form
        className="space-y-3 border-t pt-3"
        onSubmit={(event) => {
          event.preventDefault()
          onResolve(item, action.kind)
        }}
      >
        <fieldset disabled={disabled} className="space-y-3">
          <legend className="text-xs font-medium">選擇伺服器提供的來源</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {sourceOptions.map((source, index) => (
              <label key={`${source.source_key}-${index}`} className="flex cursor-pointer gap-2 rounded-sm border p-2 text-xs focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <input
                  type="radio"
                  name={`source-${domId}`}
                  value={source.source_key}
                  checked={form.selected_source_key === source.source_key}
                  onChange={(event) => onFormChange({ selected_source_key: event.target.value })}
                  required
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{source.description || source.source_kind || "來源證據"}</span>
                  <span className="block break-all text-muted-foreground">{source.source_key}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`conflict-note-${domId}`}>來源選擇備註（必填）</Label>
            <Textarea
              id={`conflict-note-${domId}`}
              value={form.resolution_note || ""}
              onChange={(event) => onFormChange({ resolution_note: event.target.value })}
              rows={2}
              maxLength={1000}
              required
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={action.enabled === false || sourceOptions.length === 0}
              aria-label={`${action.label}：${item.title}`}
            >
              {action.label}
            </Button>
          </div>
        </fieldset>
      </form>
    )
  }

  const decisions = actions.filter((action) => ["confirm", "reject"].includes(action.kind))
  if (decisions.length && ["transfer_match", "reimbursement_match"].includes(item.resource?.type)) {
    const resolutionNote = form.resolution_note ?? DEFAULT_RESOLUTION_NOTE
    return (
      <form
        className="space-y-3 border-t pt-3"
        onSubmit={(event) => {
          event.preventDefault()
          const actionKind = event.nativeEvent.submitter?.value
          if (actionKind) onResolve(item, actionKind)
        }}
      >
        <fieldset disabled={disabled} className="space-y-3">
          <legend className="sr-only">{item.title}</legend>
          <div className="grid gap-1.5">
            <Label htmlFor={`resolution-note-${domId}`}>決議備註（必填，可修改）</Label>
            <Textarea
              id={`resolution-note-${domId}`}
              value={resolutionNote}
              onChange={(event) => onFormChange({ resolution_note: event.target.value })}
              rows={2}
              maxLength={1000}
              required
            />
          </div>
          <DecisionButtons item={item} actions={decisions} />
        </fieldset>
      </form>
    )
  }

  if (decisions.length && item.resource?.type === "commitment") {
    return (
      <form
        className="border-t pt-3"
        onSubmit={(event) => {
          event.preventDefault()
          const actionKind = event.nativeEvent.submitter?.value
          if (actionKind) onResolve(item, actionKind)
        }}
      >
        <fieldset disabled={disabled}>
          <legend className="sr-only">{item.title}</legend>
          <DecisionButtons item={item} actions={decisions} />
        </fieldset>
      </form>
    )
  }

  if (!actions.length) return null
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
      {actions.map((action) => (
        <Button key={action.kind} type="button" variant="outline" size="sm" disabled aria-label={`${action.label}：${item.title}`}>
          {action.label}
        </Button>
      ))}
    </div>
  )
}

function WorkbenchItem({ item, domId, form, itemState, onFormChange, onResolve }) {
  const pendingLabel = itemState.locked ? "決議已送出，正在同步工作台" : "處理中"
  return (
    <article
      aria-labelledby={`${domId}-title`}
      aria-busy={itemState.pending || undefined}
      className="space-y-3 rounded-md border bg-card p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={`${domId}-title`} className="text-sm font-semibold">{item.title}</h4>
          <p className="mt-0.5 break-all text-xs text-muted-foreground">
            {item.resource?.type || item.item_kind} · {item.resource?.status || "status 未提供"}
            {item.resource?.version == null ? "" : ` · version ${item.resource.version}`}
          </p>
        </div>
        {item.expires_at ? <p className="text-xs text-muted-foreground">期限：{item.expires_at}</p> : null}
      </div>
      <ItemContext item={item} />
      <ActionPanel
        item={item}
        domId={domId}
        form={form}
        itemState={itemState}
        onFormChange={onFormChange}
        onResolve={onResolve}
      />
      {itemState.pending ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{pendingLabel}
        </p>
      ) : null}
      {itemState.error ? <p role="alert" className="text-xs text-destructive">{itemState.error}</p> : null}
    </article>
  )
}

function WorkbenchSection({ config, items, count, forms, itemStates, onFormChange, onResolve }) {
  if (!items.length) return null
  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{config.label}</h3>
          <p className="text-xs text-muted-foreground">{config.description}</p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{count ?? "—"} 項</span>
      </div>
      <ul role="list" className="space-y-2">
        {items.map((item, index) => {
          const domId = `workbench-${config.key}-${index}`
          return (
            <li key={item.item_key || `${config.key}-${index}`}>
              <WorkbenchItem
                item={item}
                domId={domId}
                form={forms[item.item_key] || {}}
                itemState={itemStates[item.item_key] || {}}
                onFormChange={(patch) => onFormChange(item.item_key, patch)}
                onResolve={onResolve}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function WorkbenchLoading() {
  return (
    <div aria-busy="true" aria-label="正在載入待確認工作台" className="space-y-3">
      <p className="text-sm text-muted-foreground">正在整理待確認項目…</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24 w-full" />)}
      </div>
    </div>
  )
}

function PartialErrors({ errors, refreshing, onRetry }) {
  if (!errors.length) return null
  return (
    <Alert>
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>部分來源暫時無法載入</AlertTitle>
      <AlertDescription className="space-y-2">
        <ul role="list" className="space-y-1">
          {errors.map((error, index) => (
            <li key={`${error.task_key || error.resource_key || "partial"}-${index}`}>
              {error.message || error.kind}
              {error.resource_type || error.resource_key
                ? `（${[error.resource_type, error.resource_key].filter(Boolean).join(" · ")}）`
                : ""}
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={refreshing}>
          <RefreshCw className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden="true" />
          {refreshing ? "重試中" : "重試全部來源"}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export default function ConfirmationQueue() {
  const [workbench, setWorkbench] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [refreshNotice, setRefreshNotice] = useState(null)
  const [forms, setForms] = useState({})
  const [itemStates, setItemStates] = useState({})
  const [announcement, setAnnouncement] = useState("")
  const requestRef = useRef({ id: 0, controller: null })

  const load = useCallback(async ({ background = false, preserveNotice = false } = {}) => {
    requestRef.current.controller?.abort()
    const controller = new AbortController()
    const requestId = requestRef.current.id + 1
    requestRef.current = { id: requestId, controller }

    if (background) setRefreshing(true)
    else {
      setLoading(true)
      setError("")
    }
    if (!preserveNotice) setRefreshNotice(null)

    try {
      const data = await requestJson(
        "/api/finance/review-workbench",
        { cache: "no-store", signal: controller.signal },
        "無法讀取待確認工作台",
      )
      if (!validatesWorkbench(data)) throw new Error("工作台回應不符合 finance.review-workbench/v1")
      if (requestRef.current.id !== requestId) return { ok: false, aborted: true }
      setWorkbench(data)
      return { ok: true }
    } catch (loadError) {
      if (controller.signal.aborted || requestRef.current.id !== requestId) return { ok: false, aborted: true }
      const message = loadError.message || "無法讀取待確認工作台"
      if (background) setRefreshNotice({ tone: "error", message: `無法重新整理工作台：${message}` })
      else setError(message)
      return { ok: false, error: message }
    } finally {
      if (requestRef.current.id === requestId) {
        if (background) setRefreshing(false)
        else setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    load()
    return () => requestRef.current.controller?.abort()
  }, [load])

  function updateForm(itemKey, patch) {
    setForms((current) => ({
      ...current,
      [itemKey]: { ...current[itemKey], ...patch },
    }))
  }

  function updateItemState(itemKey, patch) {
    setItemStates((current) => ({
      ...current,
      [itemKey]: { ...current[itemKey], ...patch },
    }))
  }

  async function resolveItem(item, actionKind) {
    const currentState = itemStates[item.item_key] || {}
    if (currentState.pending || currentState.locked) return
    const label = actionLabel(item, actionKind)
    updateItemState(item.item_key, { pending: true, locked: false, error: "" })
    setAnnouncement(`${item.title}：${label}處理中`)

    try {
      const currentForm = forms[item.item_key] || {}
      const form = ["transfer_match", "reimbursement_match"].includes(item.resource?.type)
        ? { ...currentForm, resolution_note: currentForm.resolution_note ?? DEFAULT_RESOLUTION_NOTE }
        : currentForm
      await performItemAction(item, actionKind, form)
      updateItemState(item.item_key, { locked: true, error: "" })
      setAnnouncement(`${item.title}：${label}已完成，正在重新整理工作台`)
      toast.success(`${label}已完成`)
      const refreshed = await load({ background: true })
      if (!refreshed.ok && !refreshed.aborted) {
        updateItemState(item.item_key, {
          error: `決議已送出，但工作台重新整理失敗：${refreshed.error || "請手動重試"}`,
        })
      }
    } catch (actionError) {
      const message = actionError.message || "決議失敗"
      updateItemState(item.item_key, { locked: false, error: message })
      setAnnouncement(`${item.title}：${message}`)
      toast.error(message)
      if (requiresFullRefresh(actionError)) {
        const refreshed = await load({ background: true, preserveNotice: true })
        setRefreshNotice({
          tone: refreshed.ok ? "warning" : "error",
          message: refreshed.ok
            ? `${message} 工作台已完整重新載入；原先決議未套用。`
            : `${message} 工作台重新載入也失敗：${refreshed.error || "請手動重試"}`,
        })
      }
    } finally {
      updateItemState(item.item_key, { pending: false })
    }
  }

  if (loading) return <WorkbenchLoading />

  if (error || !workbench) {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>工作台載入失敗</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{error || "無法讀取待確認工作台"}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw aria-hidden="true" />重新整理
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const partialErrors = Array.isArray(workbench.partial_errors) ? workbench.partial_errors : []
  const totalAttention = workbench.counts.total_attention

  return (
    <div className="space-y-4">
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-muted/20 p-3">
        <div>
          <p className="text-sm font-medium">需要你決定：<span className="tabular-nums">{totalAttention ?? "—"}</span> 項</p>
          <p className="mt-0.5 text-xs text-muted-foreground">投影時間：{workbench.generated_at || "未提供"}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => load({ background: true })} disabled={refreshing}>
          <RefreshCw className={refreshing ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden="true" />
          {refreshing ? "重新整理中" : "重新整理工作台"}
        </Button>
        <dl className="grid w-full grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {SECTION_CONFIG.map((config) => (
            <div key={config.key} className="flex items-center justify-between gap-2 rounded-sm border bg-background px-2 py-1.5">
              <dt className="text-muted-foreground">{config.label}</dt>
              <dd className="tabular-nums font-medium">{workbench.counts[config.key] ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </div>

      {refreshNotice ? (
        <Alert variant={refreshNotice.tone === "error" ? "destructive" : "default"}>
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{refreshNotice.tone === "error" ? "需要重新整理" : "資料已更新"}</AlertTitle>
          <AlertDescription>{refreshNotice.message}</AlertDescription>
        </Alert>
      ) : null}

      <PartialErrors errors={partialErrors} refreshing={refreshing} onRetry={() => load({ background: true })} />

      {totalAttention === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Check aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>目前沒有需要由你決定的項目</EmptyTitle>
            <EmptyDescription>這只代表工作台目前沒有待處理決議，不代表財務資料已完整。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-5">
          {SECTION_CONFIG.map((config) => (
            <WorkbenchSection
              key={config.key}
              config={config}
              items={workbench.sections[config.key]}
              count={workbench.counts[config.key]}
              forms={forms}
              itemStates={itemStates}
              onFormChange={updateForm}
              onResolve={resolveItem}
            />
          ))}
        </div>
      )}
    </div>
  )
}
