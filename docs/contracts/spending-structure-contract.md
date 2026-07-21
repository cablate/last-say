schema_version: behavior-contract/v1
id: finance.spending-structure.read-model
title: 支出結構與報銷 read model
status: active
last_validated_against_repository: 2026-07-17

# 支出結構與報銷 read model 契約

這份契約定義控制中心與外部 AI 共用的 `FC-A3` query-time 結果。它不是另一套帳，也不保存報表 snapshot。

## Scope

- 輸入必須是單一 `month=YYYY-MM`、`entity_id`、`currency` 與現行管理損益 basis。
- 支出科目直接重用 management P&L 的 report-line owner。
- 固定義務只列 `user_confirmed + confirmed` 的 commitment；provisional candidate 不得冒充固定支出。
- 報銷保留 gross expense、gross recovery、unallocated 與 proposal；confirmed recovery 才能進入 derived net expense。

## Deterministic outputs

- `facts.confirmed_expense_minor`：管理損益已確認費用。
- `facts.expense_lines`：科目金額、筆數、mapping source 與 transaction drillback。
- `facts.confirmed_commitments`：已確認的固定義務。
- `facts.confirmed_reimbursement_recovery_minor`：已確認報銷 allocation。
- `facts.proposed_reimbursements`：待人類確認，永不先扣除。
- `derived.net_expense_after_confirmed_recovery_minor`：`confirmed expense - confirmed recovery`。
- `derived.explicit_business_expense_minor`：只加總明確 `expense:business_operating`，不把交通、住宿或商家名稱猜成工作費。

## AI boundary

AI 可以解釋支出驅動、指出缺口、提出最小確認問題；AI 不得把觀察到的支出直接標成「必要」「可省」「工作可報銷」或「可靠收入」。這些需要 owner policy 或 typed evidence。

## Evidence and replay

回應包含 `coverage`、`source_watermark`、`drillback` 與 `formula_version`。新增、修正或確認 canonical fact 後，重新查詢同一 scope 必須得到新結果；不建立第二套支出帳。

更新觸發：P&L report-line、commitment owner、reimbursement owner、欄位／公式／coverage／drillback 改變時。
