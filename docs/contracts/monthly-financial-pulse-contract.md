---
schema_version: behavior-contract/v1
id: finance.control.monthly-financial-pulse
title: Monthly Financial Pulse Contract
status: active
owner_surface: dashboard
owner_approval_required: false
last_validated_against_repository: 2026-07-17
change_context:
  type: feature
  reason: 將同月份的管理損益、現金流與已確認typed cash owners組成一個可重算摘要，讓使用者不用再請AI臨時計算。
  non_goals:
    - 不新增canonical transaction、account、obligation、investment或report snapshot table。
    - 不計算safe-to-spend、可靠收入、必要支出或未來90日預測。
    - 不把尚未到期的義務與本月已發生費用混成同一總額。
    - 不改動既有三張management report public response。
---

# Monthly Financial Pulse Contract

## Change Context

`FC-A2`是[`deterministic-analysis-read-model-contract.md`](deterministic-analysis-read-model-contract.md)的第一個runtime consumer。它回答「這個月經濟上賺／花多少、現金實際變多少，以及差異由哪些已確認cash movements造成」，但不回答未來是否安全。

## Behavior Boundary

In scope：

- 指定單一月份、entity、currency與`card_accrual_management` basis後，在同一request內重算Monthly Pulse。
- 直接組合既有Management P&L與Cash Flow query，不另寫一套交易分類規則。
- 從Cash Flow的typed-owner details辨識卡費清償、貸款本金、貸款利息／費用、投資現金與報銷回收。
- 保留P&L、cash movement與typed movement為不同欄位；不得跨欄位重複加總成「收入」或「支出」。
- 揭露proposed reimbursement candidate，但不把它扣進confirmed totals。
- 回傳coverage、source watermark與resource-key drillback。

Out of scope：future obligation calendar、position valuation、net-worth bridge、spending essentiality與AI解釋。

## Consumers And Entrypoints

- Browser route：`/control`。
- API：`GET /api/finance/control/monthly-pulse`。
- Query owner：`lib/queries/finance/control/monthly-pulse.js#getMonthlyFinancialPulse`。
- Hook：`lib/hooks.js#useMonthlyFinancialPulse`。
- UI：`components/financial-control/MonthlyPulseView.jsx`。
- Upstream semantic owners：
  - `lib/queries/reports/income-statement.js#getIncomeStatement`
  - `lib/queries/reports/cash-flow.js#getCashFlow`
  - confirmed reimbursement facts in `reimbursement_matches`

## Inputs And State

- `month`：required `YYYY-MM`；`all`不合法，因為這是月度read model。
- `entity_id`：optional，default `personal`並列入`scope.defaulted_fields`。
- `currency`：optional，default `TWD`並列入`scope.defaulted_fields`。
- `basis`：optional，只支援`card_accrual_management`；default時列入`scope.defaulted_fields`。
- State只讀canonical DB與既有report mapping／typed relationships。
- 只有Cash Flow已確認並精確對上的typed owner會進入`confirmed_*_cash_minor`。Unresolved cash仍留在`unresolved_cash_minor`與coverage。

## Outputs And Side Effects

Response遵守`finance.analysis-read-model/v1`，`analysis_id=monthly_financial_pulse`，`formula_version=monthly-financial-pulse/1`。

`facts`至少分成：

- `management_pl`：confirmed revenue、expense、net result與owner-unresolved disclosure。
- `cash_flow`：beginning／ending cash、operating／investing／financing／unresolved與net cash change。
- `typed_cash_movements`：signed confirmed card settlement、loan principal、loan interest／fees、investment cash、reimbursement recovery。

`derived.economic_to_cash_gap_minor = cash_flow.net_cash_change_minor - management_pl.net_result_minor`；`derived.confirmed_obligation_settlement_cash_minor`則加總已確認卡費清償、貸款本金與貸款利息／費用的signed cash movement。任一必要輸入為unknown時對應結果為`null`。

Money一律使用integer decimal string或`null`。Typed cash movement維持現金方向：流出為負、流入為正。API與query沒有DB write、AI／network call、file write、timer或report persistence。

## UI States

- First paint／loading：app shell與月份選擇器保留，內容顯示具`aria-label`的skeleton。
- Ready：四個主要數字分別顯示管理淨收支、現金淨變動、期末現金與已確認義務清償；差異卡另列投資、貸款與報銷movements。
- Partial／unmapped／unreconciled：顯示已知subtotal與coverage blockers，不把unknown格式化為0。
- Empty／invalid month：提示選擇有交易資料的單一月份。
- Error：顯示server錯誤並提供同scope retry。
- Data changed：同一browser session收到`last-say:data-changed`後重新fetch；下一次GET一定重新讀DB。

## Invariants

1. P&L total只來自`getIncomeStatement`，不從bank inflow重算收入。
2. Cash totals只來自`getCashFlow`，不以P&L net假造現金變動。
3. 卡費清償不是第二次費用；貸款本金不是費用；投資買入不是費用；報銷回收不是原始支出的刪除。
4. 同一DB state與request產生semantic-equivalent response；`source_watermark.semantic_hash`不包含operational timestamp。
5. Proposed／unconfirmed relationship只出現在`candidates`、warnings或blockers。
6. 每個confirmed subtotal都能透過`drillback`回到transaction、match或balance snapshot key。
7. UI只顯示與導覽，不重新分類或加總canonical rows。
8. 查詢不讀寫正式DB以外的副本，也不在測試中開啟正式DB。

## Acceptance Examples

1. Given本月薪資、信用卡消費與銀行卡費清償，when查詢Pulse，then消費只進P&L一次，卡費清償只出現在cash／typed settlement。
2. Given已確認貸款allocation，when查詢Pulse，then本金與利息分開揭露；只有利息影響P&L，本金保留為financing cash movement。
3. Given已reconciled investment cash match，when查詢Pulse，then投資買入以負的investment cash顯示，不進管理費用。
4. Givenproposed reimbursement match，when查詢Pulse，thencandidate可見但confirmed reimbursement為0；確認後下一次GET才更新confirmed recovery與watermark。
5. Given缺期初snapshot，when查詢Pulse，then已知P&L與typed movements仍顯示，beginning cash及需要它的值為`null`，coverage為partial。

## Test Mapping

```yaml
test_mapping:
  contract_fixture:
    - test/fixtures/financial-control/monthly-financial-pulse.json
  focused:
    - test/control-monthly-financial-pulse.test.js
  browser:
    - e2e/monthly-financial-pulse.spec.js
  regression:
    - test/reporting-three-view.test.js
    - test/deterministic-analysis-contract.test.js
```

## Evidence

- FC-A1 envelope：`docs/contracts/deterministic-analysis-read-model-contract.md`。
- P&L owner：`lib/queries/reports/income-statement.js`。
- Cash／typed-owner owner：`lib/queries/reports/cash-flow.js#classifyTypedOwner`。
- Work package：`docs/plans/master-financial-control-plan.md#17104-近期work-packages與依賴`。

## Intentional Changes

- 新增第一個`finance.analysis-read-model/v1` runtime endpoint與`/control` summary consumer。
- Browser route使用單月scope；原本`/reports`仍保留全部期間選項與既有response。

## Open Questions

- 未來是否在Control頁加入AI文字解釋，留待有穩定usage evidence後決定；即使加入，也只能解釋本response。
- 未來義務與90日最低現金點由`FC-2／FC-3`擁有，不擴張本formula。

## Update Trigger

調整formula、typed movement定義、scope、coverage、watermark、drillback、API或UI狀態時，必須同步更新fixture與focused／browser tests。
