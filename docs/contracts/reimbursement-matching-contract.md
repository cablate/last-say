---
schema_version: behavior-contract/v1
id: finance.reimbursement-matching
title: 報銷與補貼配對
status: active
owner_surface: api
change_context:
  type: feature
  reason: 保存一筆報銷或補貼與一至多筆原始支出的可稽核關聯，讓 AI 不必每次重新猜測，也不把補貼冒充營業收入。
  non_goals:
    - 不建立完整應收帳款或費用報銷工作流。
    - 不自動淨額覆蓋原始支出與流入。
    - 不以 transfer_matches、交易備註或 AI 聊天記憶代替 canonical link。
---

# 報銷與補貼配對契約

## Behavior Boundary

本契約擁有 reimbursement cash inflow 與一至多筆 expense transactions 的 typed relationship、allocated amounts、authority、review state與生命週期。原始 transactions 保持 immutable；管理分析可由 confirmed match衍生 gross expense、recovery與net burden，但不得改寫 source facts。

## Consumers And Entrypoints

- Query owner：`lib/queries/finance/reimbursements.js`。
- Routes：`/api/finance/reimbursements`與`/api/finance/reimbursements/[key]`。
- Compound ingestion context：`reimbursement_matches`。
- `lib/queries/finance/reconciliation.js::reconciliationSummary`。
- Analysis-context reimbursement candidates、management P&L／AI analysis、review task UI。
- Schema migration：`lib/db/migrations/0007-reimbursement-matching.js`。

## Inputs And State

- Match header：stable `match_key`、reimbursement transaction、currency、status、authority、confidence、review_state、reason/note、version。
- Match items：expense transaction、positive `allocated_minor`；同一 expense可由不同 reimbursement分次回收，但同一 match不得重複同一 expense。
- Reimbursement transaction 必須是 active inflow；expense transactions 必須是 active outflows，幣別一致，且不能與 reimbursement transaction相同。
- Sum of allocated items must be positive and must not exceed reimbursement inflow。若 reimbursement 超過已分配部分，保留 unmatched remainder；不捏造用途。
- `proposed` 可來自 AI；`confirmed` 需 official/user-confirmed evidence，或符合既定高信心規則且沒有 human/conflict evidence。多候選或跨 entity 必須 review。

## Outputs And Side Effects

- Create／preview 回 header、items、allocated total、reimbursement amount、unallocated remainder、status與 source transaction keys。
- Canonical write 原子建立 header與全部 items，寫 append-only change log；proposal 建立一個 review task。
- Confirmed match 讓報表／AI可以顯示 reimbursement recovery與derived net burden，但原 expense與inflow仍各自存在。
- Rejected／superseded match停止影響 derived analysis，不刪除 transaction或歷史 evidence。
- Reconciliation summary將 reimbursement legs列為獨立 context；不得與 internal transfer、card settlement、loan allocation混為同一類。

## UI States

MP-02R不新增專用 UI。既有 review queue先顯示 proposed match、expense明細、allocated total、remainder、reason與衝突；MP-04再決定整合呈現。Loading／error／stale沿用 review／confirmation patterns。

## Invariants

- Gross expense與reimbursement inflow皆保留且各只出現一次。
- Confirmed reimbursement recovery不列為 salary／business revenue。
- Derived net burden只能來自 source-linked allocated amounts。
- Unallocated remainder與unmatched inflow保持 partial，不自動分攤。
- Internal transfer、refund與reimbursement為不同 lifecycle；不得為了讓報表對上而互換。
- Mutation遵守source authority、expected version、idempotency、atomicity、audit與reversal／supersession邊界。
- Full account numbers、私人明細與真實金額不進tracked fixtures／logs。

## Acceptance Examples

1. Given NT$1,200交通與NT$2,800住宿，when NT$4,000補貼confirmed match兩筆支出，then gross expenses remain NT$4,000、recovery is NT$4,000、derived net burden is NT$0，且補貼不列business revenue。
2. Given NT$5,000定額補貼 only matches NT$4,000 expenses，then allocated recovery is NT$4,000 and unallocated remainder NT$1,000 remains visible/partial。
3. Given one reimbursement has two plausible hotel expenses with conflicting dates，then AI may propose candidates but cannot confirm either by silently splitting。
4. Given a confirmed match is rejected/superseded by later evidence，then source transactions remain unchanged and derived net burden is recomputed without the old match。

## Test Mapping

```yaml
test_mapping:
  migration:
    - test/migration-runner.test.js
  unit_integration:
    - test/reimbursement-matching.test.js
  ingestion:
    - test/compound-ingestion.test.js
    - test/ingestion-reversal.test.js
  reporting_later:
    - test/financial-event-semantics.test.js
    - test/reporting-income-statement.test.js
```

## Evidence

- 2026-07-16 implementation：migration `0007`、query owner、GET／POST／PATCH routes、compound ingestion／additive reversal、review task與reconciliation context已落地。
- Isolated proof：`test/reimbursement-matching.test.js`驗證一對多、remainder、方向／幣別／entity／重複／超額／stale version、review resolution與保留gross facts；compound ingestion與reversal驗證canonical refs及不刪除items。
- Existing `transfer_matches`只表示own-account transfer，且固定from/to兩個legs；用它保存一對多報銷會破壞transfer semantics。

## Intentional Changes

- 新增 additive reimbursement match owner；不backfill、不dual-write、不改既有transaction／transfer schemas。
- Reconciliation inventory增加具名 reimbursement context；舊 consumers在migration後仍可運作。

## Open Questions

- Numerical materiality threshold延後到MP-07 baseline；目前依多候選、跨entity、authority conflict與cross-period impact決定review。
- 若未來要建立正式receivable lifecycle，必須另立contract／migration；不得反向擴張本match owner。
