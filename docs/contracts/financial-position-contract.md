---
schema_version: behavior-contract/v1
id: finance.control.financial-position
title: Trusted Financial Position Read Model
status: draft
owner_surface: control-read-model
owner_approval_required: true
last_validated_against_repository: 2026-07-15
change_context:
  type: feature
  reason: 為 Financial Control Phase 1 定義同一 as-of、可追溯且誠實揭露 coverage 的資產、負債與流動現金位置。
  non_goals:
    - 不建立平行 account、balance、liability、holding 或 valuation tables。
    - 不在 Phase 0 建立正式 UI 或 migration。
---

# Trusted Financial Position Contract

## Behavior Boundary

Financial Position 是 foundation canonical facts 的 deterministic read model。它按 entity、as-of、base currency 與 account scope 彙整 liquid cash、near-liquid assets、investments、other valued items、liabilities、net position 與 coverage；不擁有 source facts。

## Consumers And Entrypoints

- **Planned／not implemented：** proposed runtime owner是`lib/finance/control/`下的`financial-position.js`與對應analysis context；目前repository中沒有這個module。
- Cash forecast opening position、Control Center、future Balance Sheet query。
- Foundation owners：`account-balance-storage-contract`、`liability-and-commitment-storage-contract`、`investment-valuation-storage-contract`、`readiness-analysis-context-contract`。

## Inputs And State

- Required：entity key、as-of date、base currency、included account scope。
- Every value carries source watermark、fact date、valuation date、currency、authority/review and freshness result。
- Missing FX、stale snapshot、missing scope attestation、unreconciled transfer or obligation are blockers/warnings, not zero values。

## Outputs And Side Effects

- Pure/read-only result with tiers, totals only where computable, blockers, warnings and coverage=`empty|partial|unreconciled|complete`。
- No write side effects in Phase 0/1 read path。

## UI States

Future surfaces must distinguish missing, stale, conflicted, unreconciled and complete. Partial line items may be shown, but net position cannot be labeled complete when a required component is missing。

## Invariants

- Same fact is not duplicated across cash, investment and valued-item tiers。
- Credit-card and loan balances use liability sign semantics consistently。
- Cross-currency totals require an eligible FX watermark; missing FX stays unknown。
- `0` is a known amount, never a replacement for unknown。

## Acceptance Examples

1. Missing one required card balance yields partial even if all bank balances exist。
2. A USD holding without TWD FX remains visible but excluded from complete TWD total with explicit blocker。
3. Same as-of inputs and watermarks produce byte-equivalent normalized output。

## Test Mapping

```yaml
test_mapping:
  fixture: test/fixtures/financial-control/post-style-pressure.json
  future:
    - test/financial-position.test.js
    - test/cross-context-invariants.test.js
```

## Evidence

- `lib/queries/finance/inventory.js`、`analysis-context.js`、`investments.js`。
- `docs/plans/master-financial-control-plan.md#phase-1trusted-financial-position`。

## Open Questions

- Needs owner decision：哪些 near-liquid accounts 可納入 reserve/safe-to-spend；Phase 0 fixture 僅以 policy input 表示。

## Update Trigger

Owner核准scope／base currency／FX freshness、foundation fact owner改變、runtime consumer開始實作或acceptance fixture改變時更新。
