---
schema_version: behavior-contract/v1
id: finance.liability-commitment.storage
title: 負債、分期與未來承諾
status: active
owner_surface: api
change_context:
  type: feature
  reason: 保存信用卡、貸款與一般現金承諾的正式義務，不重複支出事實。
  non_goals:
    - 不猜測未知利率的未來還款。
    - 不用一張 liability mega-table 合併不同生命週期。
---

# 負債與承諾儲存契約

## Behavior Boundary

Credit Card context 擁有 statements/payment matches/installment plans；Liability context 擁有 loan profile/schedule/allocation；Commitment context 只擁有一般 recurring/fixed commitments，read model 可彙整但不得複製 typed obligations。

## Consumers And Entrypoints

- `/api/finance/credit-cards/*`、`/api/finance/liabilities/*`、`/api/finance/commitments/*`。
- debt-obligations、cash-flow、liquidity-forecast readiness/read models。
- Card、loan、commitment typed tables與 match tables。

## Inputs And State

- Card statement 有 period/close/due、balance/minimum/full due、currency、official/source/review；items 只 link transaction，不複製 merchant amount。
- Installment plan 有 principal、count、dates、APR/fees、authority/version；entry 有 principal/interest/fee/total/status，components 必須相等。
- Loan profile 有 principal/currency/rate type/APR as-of/term；schedule 只能來自 official/human-confirmed evidence。
- Commitment amount 僅 fixed/range/unknown；cadence 僅具名 enum與 dates，不接受公式字串、任意 RRULE/code。

## Outputs And Side Effects

- Merchant expense 僅在原交易認列一次；installment entries 表示未來清償結構。
- Card payment是 liability settlement/cash movement，不是第二筆 P&L expense。
- Loan allocation principal+interest+fee 必須等於 matched cash amount，否則 unreconciled。
- Official schedule 可 supersede provisional future entries，但 settled history 不被 template/schedule edit 改寫。

## UI States

後續 UI 顯示 no-profile、provisional、official、schedule-mismatch、due-soon、payment-unmatched、complete 與 unsupported lifecycle；不得把 provisional estimate 標成官方義務。

## Invariants

- Card statement item、installment entry、cash commitment 不複製既有交易的 merchant expense。
- Current loan principal 由 principal balance snapshot或 reconciled schedule read model 擁有，不放第二份 current balance 在 profile。
- Variable-rate 未提供官方 schedule/repricing rule 時只保存已報告事實，future readiness partial。
- Revolving、balloon、interest-only 等未具 typed contract 的生命週期 fail closed/另立 context。

## Acceptance Examples

1. Given NT$12,000 merchant charge 分 12 期，then P&L 只有一筆 NT$12,000 expense，另有 12 筆 obligation entries，不產生 12 筆 merchant expense。
2. Given loan cash payment NT$20,000 但 allocation sum NT$19,500，then status `unreconciled`。
3. Given variable loan 只有目前 APR，when 要求未來 schedule，then 回 partial gap，不由 AI 猜 authoritative payment。

## Test Mapping

```yaml
test_mapping:
  integration:
    - test/credit-card-storage.test.js
    - test/credit-card-installments.test.js
    - test/liability-storage.test.js
    - test/commitments.test.js
```

## Evidence

- Fixtures：`test/fixtures/financial-data/canonical/credit-cards.json`、`liabilities.json`、`commitments.json`。

## Intentional Changes

- 將 statement、installment、loan、general commitment 分成 typed owners，禁止通用義務資料表。
