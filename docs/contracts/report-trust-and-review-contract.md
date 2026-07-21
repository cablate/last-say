---
schema_version: behavior-contract/v1
id: reports.trust-and-review
title: 報表可信度與審核完成條件
status: active
owner_surface: dashboard
change_context:
  type: bugfix
  reason: 避免文字或一般報表規則在缺少專屬證據時建立排除，並統一報表與待審頁的完成條件。
  non_goals:
    - 實作資產負債表或現金流量表資料模型
    - 修改既有交易事實或分類資料
---

# 報表可信度與審核完成條件

## Behavior Boundary

涵蓋管理損益表的報表科目判斷、coverage、桌機表格與手機摘要。交易匯入、商家分類規則及其他兩張財務表不在本次範圍。

## Consumers And Entrypoints

- `GET /api/reports/income-statement`
- `/reports?month=YYYY-MM`
- `lib/reporting/report-lines.js`
- `lib/queries/reports/income-statement.js`
- `report_mapping_rules`、`transaction_report_mappings`

## Inputs And State

- 交易方向、`flow_type`、分類、信心度與 `reviewed`。
- 已人工確認的逐筆報表映射可覆蓋其他判斷。
- 已確認的轉帳、卡費、貸款拆分與投資現金配對可建立確定性排除。
- 交易名稱、方向、`flow_type`、分類與一般報表規則都只能提示可能需排除，不能單獨建立排除。

## Outputs And Side Effects

- 查詢只讀，不修改交易或規則。
- coverage 的「尚未審核」只計入待審頁會列出的交易。
- 手機版用分組摘要呈現；桌機版保留完整五欄表格。

## UI States

- 載入：保留穩定高度的內容形狀骨架。
- 完成：桌機顯示表格；手機顯示科目、金額、筆數、來源與查看操作。
- 空值：各區段明確顯示沒有科目。
- 錯誤：沿用報表頁的行內錯誤訊息。

## Invariants

- 同一筆信用卡消費只計入損益一次，信用卡繳款不列支出。
- 一般規則不能建立或覆蓋確定性排除；已人工確認的逐筆映射仍是最高優先。
- AI 逐筆排除提案未經人工確認前，只能成為待處理項目。
- 報表 coverage 與 `/transactions?view=needs-review` 使用同一低信心判定。
- 金額以 cents 計算，展示層才格式化。

## Acceptance Examples

1. 已有一般規則把「本行自動扣繳」指向排除項目，但沒有已確認的卡費配對時，該交易進入待處理，不先排除；建立已確認配對後才列入「信用卡繳款」排除。
2. 信心 0.72、尚未人工確認的 AI 交易不阻擋報表完整；信心 0.35 且未確認的交易會阻擋。
3. 390px 寬度下不顯示被壓縮的五欄表，所有科目與查看操作仍可使用。

## Test Mapping

- Unit: `test/reporting-income-statement.test.js`
- Regression: `npm test`
- Build: `FINANCE_DB_PATH=data/dev-verify-build.sqlite npm run build`
- Browser: 3127 的 2026/06 損益表桌機與 390px 手機畫面。

## Intentional Changes

- `unreviewed_transaction_count` 從所有 `reviewed=0` 改為真正需要人工審核的低信心／pending 交易數。
- 確定性排除提前到一般報表規則之前；一般規則本身不得建立排除。
- AI 寫入的逐筆排除必須經人工確認，才能進入排除小計。

## Open Questions

- 未來若要允許人類逐筆把確定性排除改列損益，仍由 `transaction_report_mappings` 明確承擔，不放寬一般規則。
