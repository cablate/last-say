---
schema_version: behavior-contract/v1
id: finance.control.financial-alert
title: Financial Alert Evidence And Lifecycle Contract
status: draft
owner_surface: control-domain
owner_approval_required: true
last_validated_against_repository: 2026-07-15
change_context:
  type: feature
  reason: 先定義可追溯、可去重且不把缺資料誤報為安全的警示語意，供 Phase 4 實作。
  non_goals:
    - Phase 0 不新增通知、alert tables 或正式 UI。
    - 不由系統替使用者採取轉帳、借貸或投資行動。
    - 不硬編通用財務健康門檻。
---

# Financial Alert Contract

## Behavior Boundary

Alert 是 forecast/readiness/policy output 的 decision evidence，不是 source fact。它擁有 stable cause fingerprint、severity、effective window、evidence links、recommended human action與 acknowledgement lifecycle。

## Consumers And Entrypoints

- Future alert evaluator、persistent inbox、Control Center、operator analysis context。
- Cash forecast、forecast coverage、spending guardrail and freshness outputs。

## Inputs And State

- Candidate includes rule version、entity、kind、cause key、observed/effective dates、metric values、coverage、source watermark。
- Minimum kinds：reserve breach、cash shortfall、stale/missing data、commitment overdue、pace threshold；severity policy remains explicit/versioned。

## Outputs And Side Effects

- Future implementation creates/dedupes alert event and append-only change log；ack/snooze/resolved never erases original evidence。
- Same cause fingerprint within cooldown updates existing event rather than alert storm。

## UI States

UI must distinguish risk alert from data-quality alert, show why/when/amount range/source freshness, and retain human choice. Snooze cannot hide a higher-severity new cause。

## Invariants

- Partial/empty coverage cannot emit “safe” status；it may emit data freshness/blocker alert。
- Guardrail remaining amount cannot mask an earlier reserve breach。
- Every alert can be recomputed/explained from rule version + watermarks。
- AI suggestions remain recommendations; no autonomous money movement。

## Acceptance Examples

1. Same reserve breach recomputed five times within cooldown creates one active alert with updated evidence。
2. Stale card data yields a data-quality alert and unavailable/range safe-to-spend, not a green status。
3. Pace reaches 80% while forecast already breaches reserve; breach is presented first and pace does not claim remaining spend is safe。

## Test Mapping

```yaml
test_mapping:
  fixture: test/fixtures/financial-control/post-style-pressure.json
  future:
    - test/financial-alert-policy.test.js
    - test/financial-alert-lifecycle.test.js
```

## Evidence

- Acceptance A3/A9 and Phase 4 in `docs/plans/master-financial-control-plan.md`。
- Existing append-only evidence：`data_change_log` and related foundation contracts。

## Open Questions

- Needs owner decision：severity thresholds、cooldown duration、default notification channel、ack/snooze policy。

## Update Trigger

Alert kind／fingerprint／lifecycle、severity／cooldown policy、notification boundary、forecast evidence或persistence責任改變時更新。
