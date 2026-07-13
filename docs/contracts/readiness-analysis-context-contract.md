---
schema_version: behavior-contract/v1
id: finance.readiness-analysis-context
title: 資料缺口與具名分析資料集
status: active
owner_surface: api
change_context:
  type: feature
  reason: 讓程式先判斷資料是否足以回答問題，再讓 AI 解釋與分析。
  non_goals:
    - 不讓 AI 以聊天記憶宣告資料完整。
    - 不接受 SQL、column expression 或任意 table/dataset name。
---

# Readiness 與 Analysis Context 契約

## Behavior Boundary

擁有 capabilities、inventory、goal-scoped readiness requirement graph 與 named analysis-context datasets。它不擁有 typed canonical facts，也不重做會計報表。

## Consumers And Entrypoints

- `GET /api/finance/capabilities`。
- `GET /api/finance/inventory?entity=&asOf=`。
- `GET /api/finance/readiness?goal=&entity=&asOf=`。
- `POST /api/finance/analysis-context`。
- External AI operator、Human Data Center、Accounting Reports、Financial Control。

## Inputs And State

- Readiness key：goal + entity + explicit/global scope + as-of + policy version。
- Initial goals：spending_history、cash_position、net_worth、debt_obligations、investment_value、cash_flow_statement、liquidity_forecast_90d、tax_or_derivatives。
- Status：empty、partial、stale、conflicted、unreconciled、complete、unsupported。
- Named datasets、filters、grouping、date ranges、limits 全由 registry allowlist。

## Outputs And Side Effects

- Inventory 預設回 entities/accounts/latest snapshots/liabilities/commitments/holdings/scope attestations/source expectations/source coverage/review counts/freshness，不回全庫明細。
- Readiness 回 requirements、satisfied、gaps、conflicts、freshness、impact、effort hint、deterministic priority 與 next actions。
- Analysis context 只回請求的 named datasets與 provenance/watermarks；不得改資料。
- 明確封閉 scope 可回 scoped result；全域「全部/總資產/所有負債」沒有有效 attestation 時不可 complete。

## UI States

Data Center/analysis UI 顯示 loading、empty、partial、stale、conflicted、unreconciled、complete、unsupported、error；status 旁顯示 as-of、scope、policy 與最優先 next action。

## Invariants

- Row count/table existence/build success 都不能證明完整。
- User-confirmed source expectation 缺期可成 hard blocker；AI candidate expectation 僅提示。
- 新 resource、attestation expiry 或 conflict 使受影響 goal cache 失效。
- AI 可重排溝通順序，不可改程式判定的 blocker/status。
- Tax/derivatives 未有 context 時回 unsupported，不假裝 partial。

## Acceptance Examples

1. Given 有一個最新銀行餘額但沒有 cash scope attestation，when 查 `cash_position` global，then status partial且第一 gap 是確認帳戶宇宙。
2. Given 使用者明確只問 account A，when account A facts current，then 可回 complete scoped result，但標示不是 all-cash total。
3. Given user-confirmed monthly expectation 缺少六月來源且已過 grace，then 相關 goal 有 hard blocker。
4. Given AI 要求 dataset `sqlite_query`，then 回 `UNKNOWN_SCHEMA`/validation error且不執行 SQL。

## Test Mapping

```yaml
test_mapping:
  unit:
    - test/financial-readiness.test.js
    - test/analysis-context.test.js
  integration:
    - test/financial-scope.test.js
```

## Evidence

- Fixtures：`test/fixtures/financial-data/readiness/`。

## Intentional Changes

- 將完整度判斷從 AI prompt 移到可測試的 runtime requirement graph。
