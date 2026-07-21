import assert from "node:assert/strict"
import test from "node:test"

import {
  displayAccountLabel,
  displayInstitution,
  displayInstrumentName,
  displayInstrumentSymbol,
  displayPositionMeta,
} from "../lib/finance/presentation-labels.js"
import { defaultAsOfDateForMonth } from "../lib/finance/reports/presentation.js"

test("current and future report months never default beyond today", () => {
  assert.equal(defaultAsOfDateForMonth("2026-07", "2026-07-21"), "2026-07-21")
  assert.equal(defaultAsOfDateForMonth("2026-06", "2026-07-21"), "2026-06-30")
  assert.equal(defaultAsOfDateForMonth("2026-08", "2026-07-21"), "2026-07-21")
  assert.equal(defaultAsOfDateForMonth("not-a-month", "2026-07-21"), null)
})

test("derived net worth uses a plain-language identity", () => {
  const line = { line: "derived_net_worth", label: "Derived net worth", role: "equity" }
  assert.equal(displayAccountLabel(line), "淨資產（資產扣除負債）")
  assert.equal(displayPositionMeta(line), "資產合計 − 負債合計")
})

test("presentation labels use governed Chinese names and generic fallbacks", () => {
  assert.equal(displayAccountLabel({ display_name: "範例帳戶", account_kind: "bank" }), "範例帳戶")
  assert.equal(displayAccountLabel({ display_name: "Example Bank Account", account_kind: "bank" }), "銀行存款（未命名）")
  assert.equal(displayInstitution("範例金融機構"), "範例金融機構")
  assert.equal(displayInstitution("Example Institution"), "其他機構")
  assert.equal(displayInstrumentName("範例投資工具"), "範例投資工具")
  assert.equal(displayInstrumentName("Example Instrument"), "其他投資工具")
  assert.equal(displayInstrumentSymbol("EXAMPLE-US-AGG"), "總額快照")
})
