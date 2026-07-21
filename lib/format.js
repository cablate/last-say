// 金額邏輯集中於 formatTWD，未來 currency migration 改此檔即可。
//
// DB 自 2026-06-28 cents migration 起，transactions.amount / inflow / outflow / balance
// 一律存「cents 整數（元 × 100）」。formatTWD 收到的是 cents，顯示時除 100 還原為元。
// 例：1649300 cents → NT$16,493。

const TWDFormatter = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

// formatTWD(amountInCents) 回 NT$ 格式（NT$1,234）。input 為 cents；非數字視為 0。
export function formatTWD(amountInCents) {
  const n = Number(amountInCents)
  const safeCents = Number.isFinite(n) ? n : 0
  const yuan = Math.round(safeCents) / 100
  return `NT$${TWDFormatter.format(yuan)}`
}

// Format canonical minor units with an unambiguous base-currency label.
// Intl renders TWD as "$" in zh-TW, which is ambiguous beside USD.
export function formatCurrencyMinor(amountInMinor, currency = "TWD", {
  signed = false,
  absolute = false,
  missing = "—",
} = {}) {
  if (amountInMinor === null || amountInMinor === undefined) return missing
  const amount = Number(amountInMinor)
  if (!Number.isFinite(amount)) return missing
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits
  const formatted = new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format((absolute ? Math.abs(amount) : amount) / (10 ** digits))
  return currency === "TWD" ? formatted.replace("$", "NT$") : formatted
}

// formatDate(iso) 將 ISO 日期（YYYY-MM-DD 或完整 ISO）格式化為 YYYY/MM/DD。
// 無法解析時原樣回傳，避免把髒資料變成空白。
export function formatDate(iso) {
  if (!iso) return ""
  const s = String(iso)
  // 快速路徑：純日期字串直接換分隔符，避開 timezone 偏移問題
  const dateOnly = s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)
  if (dateOnly) {
    return `${s.slice(0, 4)}/${s.slice(5, 7)}/${s.slice(8, 10)}`
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}/${m}/${day}`
}

// formatMonth("2024-01") 回 "2024/01"。無法解析時原樣回傳。
export function formatMonth(month) {
  if (!month) return ""
  const s = String(month)
  const parts = s.split("-")
  if (parts.length < 2) return s
  const [y, m] = parts
  if (!y || !m) return s
  return `${y}/${String(m).padStart(2, "0")}`
}
