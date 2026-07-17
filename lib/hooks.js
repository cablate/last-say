"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { fetchJson, patchJson, postJson, deleteJson } from "./api-client"

export const DATA_CHANGED_EVENT = "last-say:data-changed"

function notifyDataChanged(detail = {}) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail }))
}

function ruleMutationMessage(prefix, result) {
  const impact = result?.impact
  const changedRows = Number(impact?.reclassified_rows ?? 0)
    + Number(impact?.pending_rows ?? 0)
    + Number(impact?.preserved_reviewed_rows ?? 0)
  if (!impact || changedRows === 0) return prefix
  return `${prefix}：重新分類 ${impact.reclassified_rows ?? 0} 筆、送回待審 ${impact.pending_rows ?? 0} 筆、保留已確認 ${impact.preserved_reviewed_rows ?? 0} 筆`
}

export function useDataChangeRefetch(refetch) {
  useEffect(() => {
    if (typeof window === "undefined") return undefined
    const handleChange = () => refetch()
    window.addEventListener(DATA_CHANGED_EVENT, handleChange)
    return () => window.removeEventListener(DATA_CHANGED_EVENT, handleChange)
  }, [refetch])
}

// useApi(fetcher, deps)
// 通用資料 hook：fetcher 接 AbortSignal 並回傳 Promise。
// 用 useEffect + useState + AbortController；cleanup abort 舊請求。
// 回傳 { data, loading, error, refetch }；refetch 透過內部 tick 重新觸發 effect。
export function useApi(fetcher, deps) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)

  // 永遠取最新 fetcher，避免 stale closure 與把 fetcher 放進 deps 造成的重複觸發。
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(null)
    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return
        setData(result)
      })
      .catch((err) => {
        if (!active) return
        // AbortController 觸發的 abort 不視為錯誤
        if (err && err.name === "AbortError") return
        setError(err)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
    // deps 由呼叫端決定；tick 驅動 refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const refetch = useCallback(() => setTick((t) => t + 1), [])
  return { data, loading, error, refetch }
}

// 把 params（查詢字串）接到 path 後；空值不加 '?'。
const withQuery = (path, params) =>
  params ? `${path}?${params}` : path

// ---- 衍生 hook：params 為呼叫端用 useSearchParams 組好的查詢字串（含 month view scope 等） ----

export function useMeta() {
  return useApi((signal) => fetchJson("/api/meta", { signal }), [])
}

export function useSummary(params) {
  return useApi(
    (signal) => fetchJson(withQuery("/api/summary", params), { signal }),
    [params],
  )
}

export function useTransactions(params) {
  return useApi(
    (signal) => fetchJson(withQuery("/api/transactions", params), { signal }),
    [params],
  )
}

export function useBreakdown(params) {
  return useApi(
    (signal) => fetchJson(withQuery("/api/breakdown", params), { signal }),
    [params],
  )
}

export function useTrend(params) {
  return useApi(
    (signal) => fetchJson(withQuery("/api/trend", params), { signal }),
    [params],
  )
}

export function useIncomeStatement(params) {
  return useApi(
    (signal) => fetchJson(withQuery("/api/reports/income-statement", params), { signal }),
    [params],
  )
}

export function useBalanceSheet(params) {
  return useApi(
    (signal) => fetchJson(withQuery("/api/reports/balance-sheet", params), { signal }),
    [params],
  )
}

export function useCashFlow(params) {
  return useApi(
    (signal) => fetchJson(withQuery("/api/reports/cash-flow", params), { signal }),
    [params],
  )
}

export function useMonthlyFinancialPulse(params, enabled = true) {
  return useApi(
    (signal) => enabled
      ? fetchJson(withQuery("/api/finance/control/monthly-pulse", params), { signal })
      : Promise.resolve(null),
    [params, enabled],
  )
}

export function useBalanceHistory() {
  return useApi((signal) => fetchJson("/api/balance-history", { signal }), [])
}

export function useCorrections(params) {
  return useApi(
    (signal) => fetchJson(withQuery("/api/corrections", params), { signal }),
    [params],
  )
}

// ---- mutation：成功 toast success、失敗 toast error，回傳 server 結果 ----

// usePatchTxn() 回 mutate(id, body)：PATCH /api/transactions/{id} 帶 body。
export function usePatchTxn() {
  return useCallback(async (id, body) => {
    try {
      const result = await patchJson(`/api/transactions/${id}`, body)
      notifyDataChanged({ type: "transaction" })
      toast.success("已更新")
      return result
    } catch (err) {
      toast.error(err?.message || "更新失敗")
      throw err
    }
  }, [])
}

// useBatchCorrect() 回 mutate(corrections)：POST /api/transactions/batch 帶 corrections。
export function useBatchCorrect() {
  return useCallback(async (corrections) => {
    try {
      const result = await postJson("/api/transactions/batch", corrections)
      notifyDataChanged({ type: "transaction" })
      // batchCorrection 回 {updated, errors, details}；部分失敗不算成功，避免 silent failure。
      if (result?.errors > 0) {
        toast.error(`批次修正部分失敗：${result.updated ?? 0} 成功、${result.errors} 失敗`)
      } else {
        toast.success(`批次修正完成（${result?.updated ?? 0} 筆）`)
      }
      return result
    } catch (err) {
      toast.error(err?.message || "批次修正失敗")
      throw err
    }
  }, [])
}

// ---- 分類規則（P4#15）----

// useRules(params) 載入規則清單。params：enabled / maxConfidence / origin / q。
export function useRules(params) {
  return useApi(
    (signal) => fetchJson(withQuery("/api/rules", params), { signal }),
    [params],
  )
}

export function useCreateRule() {
  return useCallback(async (body) => {
    try {
      const result = await postJson("/api/rules", body)
      notifyDataChanged({ type: "rule" })
      toast.success("規則已新增")
      return result
    } catch (err) {
      toast.error(err?.message || "新增規則失敗")
      throw err
    }
  }, [])
}

export function useUpdateRule() {
  return useCallback(async (id, body) => {
    try {
      const result = await patchJson(`/api/rules/${id}`, body)
      notifyDataChanged({ type: "rule-history" })
      toast.success(ruleMutationMessage("規則已更新", result))
      return result
    } catch (err) {
      toast.error(err?.message || "更新規則失敗")
      throw err
    }
  }, [])
}

export function useDeleteRule() {
  return useCallback(async (id) => {
    try {
      const result = await deleteJson(`/api/rules/${id}`)
      notifyDataChanged({ type: "rule-history" })
      toast.success(ruleMutationMessage("規則已刪除", result))
      return result
    } catch (err) {
      toast.error(err?.message || "刪除規則失敗")
      throw err
    }
  }, [])
}

export function useReclassifyRuleHistory() {
  return useCallback(async (id) => {
    try {
      const result = await postJson(`/api/rules/${id}/reclassify`)
      notifyDataChanged({ type: "rule-history" })
      toast.success(ruleMutationMessage("歷史交易已重新校正", result))
      return result
    } catch (err) {
      toast.error(err?.message || "重新校正失敗")
      throw err
    }
  }, [])
}

// useReviewTxns() 回 mutate(ids)：POST /api/transactions/review 批次標已審。
export function useReviewTxns() {
  return useCallback(async (items) => {
    try {
      const strictItems = Array.isArray(items) && items.every((item) => item && typeof item === "object")
      const result = await postJson("/api/transactions/review", strictItems ? { items } : { ids: items })
      notifyDataChanged({ type: "transaction-review" })
      toast.success(`已標記 ${result.reviewed} 筆為已審`)
      return result
    } catch (err) {
      toast.error(err?.message || "標記失敗")
      throw err
    }
  }, [])
}

// （已移除 useBootstrapRules：工具只提供唯讀 learning context，規則仍由外部 AI 依 Skill 契約建立。）
