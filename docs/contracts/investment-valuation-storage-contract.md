---
schema_version: behavior-contract/v1
id: finance.investment-valuation.storage
title: 投資持倉、行情與估值
status: active
owner_surface: api
change_context:
  type: feature
  reason: 讓 AI 可提供有來源與日期的行情證據，由工具以 deterministic decimal arithmetic 計算現值。
  non_goals:
    - 不支援 options、futures、margin、DeFi、tax lots 或複雜 corporate actions。
    - 不由 server 抓任意 URL，不把 AI 計算結果當 canonical fact。
---

# 投資與估值儲存契約

## Behavior Boundary

擁有 instrument、trade、holding snapshot、market quote、FX quote 與 derived valuation。現金腿由 reconciliation context 對接，不在 trade 複製銀行交易。

## Consumers And Entrypoints

- `/api/finance/investments/{instruments,trades,holdings,quotes}`、`/api/finance/fx-quotes`。
- investment-value/net-worth readiness、inventory 與 named analysis datasets。
- `instruments`、`investment_trades`、`holding_snapshots`、`market_quotes`、`fx_quotes`。

## Inputs And State

- Supported simple types：stock、ETF、mutual fund、bond、cash equivalent、simple crypto、other quoted asset。
- Quantity/unit price/FX 是 canonical decimal string；money 是 minor units。
- Quote 帶 instrument、price、quote currency、as-of/market date、provider/source note、retriever、authority、confidence、quote type。
- Holding 的 source-reported market value 與 tool-derived valuation 分欄。

## Outputs And Side Effects

- `holding_value_minor = round(quantity × price, quote currency exponent)`；base value 再依 as-of FX 與 base currency exponent round。
- Derived value 預設 query-time；若 cache 必須帶 holding/quote/FX watermark，watermark 改變即失效。
- Missing/stale/conflicting quote 或 FX 不產生虛假的 consolidated total，readiness 回明確 gap。
- Instrument alias conflict 阻擋 auto-link；有 facts 的 merge 走 typed human-confirmed merge。

## UI States

後續 UI 顯示 unidentified、missing-quote、stale、missing-FX、conflicted、valued、unsupported；每個估值顯示價格日期、來源、幣別與是否 derived。

## Invariants

- Arithmetic 只經單一 decimal owner，不用 JavaScript `Number` 保存 canonical decimal。
- AI 負責研究/提交 evidence；Last Say 驗證、保存並計算。
- `other` 不得用來掩蓋 Tier 3 複雜商品。
- Quote freshness 是 goal policy，不硬寫成永遠有效的 snapshot 屬性。

## Acceptance Examples

1. Given 10.25 shares × USD 101.23 與 TWD/USD 32.5，then 工具依 policy 計算 USD/TWD minor units，結果可由相同 watermarks 重現。
2. Given USD holding 沒有 as-of 可接受 FX，then net-worth consolidated total 缺該部位且 readiness partial，不套 default FX。
3. Given option payload，then 回 `UNSUPPORTED_CONTEXT` 並要求另立 context。

## Test Mapping

```yaml
test_mapping:
  unit:
    - test/money-decimal.test.js
    - test/investment-valuation.test.js
  integration:
    - test/investment-storage.test.js
    - test/financial-readiness.test.js
```

## Evidence

- ADR：`docs/adr/0002-money-decimal-representation.md`。
- `test/investment-storage.test.js`、`test/investment-valuation.test.js`、`test/manual-investment-entry.test.js`與synthetic builders；repository沒有獨立按investment命名的canonical fixture。

## Intentional Changes

- 確立 evidence-in/tool-calculates 分工；不建立 server-side LLM 或行情抓取器。
