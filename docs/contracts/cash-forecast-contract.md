---
schema_version: behavior-contract/v1
id: finance.control.cash-forecast
title: Deterministic Cash Forecast Contract
status: active
owner_surface: control-domain
owner_approval_required: true
last_validated_against_repository: 2026-07-17
change_context:
  type: feature
  reason: 定義可重現、可追溯且對缺資料誠實的 90 天現金時間軸、最低現金與 reserve headroom。
  non_goals:
    - 不先硬編 reserve floor 或安全收入比例。
    - 不把不確定收入當 dependable inflow。
    - 不在 Phase 0 持久化 daily projection。
---

# Deterministic Cash Forecast Contract

## Behavior Boundary

Forecast 以 Trusted Financial Position opening liquid cash、projected occurrences 與 explicit policy 生成 daily timeline。FC-3 v0 已提供 query-time DB adapter、API 與 Control consumer；policy 未設定時只回傳 raw known-obligations path，`safe_to_spend` 保持 unavailable。

## Consumers And Entrypoints

- `lib/finance/control/project-cash-timeline.js` pure function。
- `lib/queries/finance/control/forecast.js`、`/api/finance/control/forecast`與`components/financial-control/CashTimeline.jsx`。
- Future forecast analysis context、Control Center、alerts and scenarios。
- `financial-position-contract.md` 與 `commitment-and-liability-contract.md`。

## Inputs And State

- Required：as-of date、horizon days、currency、opening liquid cash minor、reserve floor minor、coverage input、events。
- Event required：unique key、date、kind、cash effect minor、reliability、source fact keys；outside horizon is excluded with reason。
- Dependable inflow is policy-confirmed; uncertain inflow remains visible but excluded from conservative balance。

## Outputs And Side Effects

- Daily rows：date、opening、included event keys/net cash change、closing projected cash、reserve floor、headroom。
- Summary：minimum projected cash/date、first reserve breach date、runway days、included/excluded events、coverage。
- Pure function has no DB/time/network side effects; same normalized inputs yield same output。

## UI States

Coverage empty → no safe-to-spend；partial/unreconciled → timeline plus gaps/range, no safety green state；complete → policy-dependent metrics may display。

## Invariants

- Integer minor units only；no float arithmetic。
- Opening balance occurs once；event key occurs at most once。
- Card charge with cash effect 0 does not reduce cash twice；linked card payment does。
- Loan principal/interest split does not change total cash effect。
- Unknown amounts are blockers, never coerced to 0。

## Acceptance Examples

1. Synthetic post-style fixture returns expected 90-day minimum cash and first breach date exactly。
2. Removing uncertain freelance income does not change conservative balance because it was excluded already。
3. Duplicating a card payment event key throws validation error rather than double counting。

## Test Mapping

```yaml
test_mapping:
  unit:
    - test/control-cash-timeline.test.js
  fixture:
    - test/fixtures/financial-control/post-style-pressure.json
```

## Evidence

- Metric formulas in `docs/plans/master-financial-control-plan.md#5-指標定義`。
- Foundation money contract：`docs/contracts/financial-data-core-contract.md`。

## Intentional Changes

- FC-3 v0 introduces a read-only runtime raw forecast; it does not persist daily projections or expose policy/safety conclusions。

## Open Questions

- Needs owner decision：reserve policy, dependable-income policy, uncertainty buffer and account inclusion scope。

## Update Trigger

Forecast input／event contract、horizon、coverage、owner financial policy、pure projector或runtime adapter責任改變時更新。
