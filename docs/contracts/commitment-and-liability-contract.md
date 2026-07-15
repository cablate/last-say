---
schema_version: behavior-contract/v1
id: finance.control.commitment-liability-projection
title: Commitment And Liability Projection Contract
status: draft
owner_surface: control-read-model
owner_approval_required: true
last_validated_against_repository: 2026-07-15
change_context:
  type: feature
  reason: 將已存在的 card、loan 與 general commitment facts 映射成不重複的未來現金義務。
  non_goals:
    - 不複製 foundation canonical obligations。
    - 不由 APR 猜官方還款表。
    - 不把 card payment 再算成 P&L expense。
---

# Commitment And Liability Projection Contract

## Behavior Boundary

本契約只擁有 projection occurrence mapping：card statement/installment、official loan schedule 與 general commitment 各自保持 typed owner，再轉成帶 source links 的 projected cash events。

## Consumers And Entrypoints

- Future commitment calendar、cash forecast event adapter、alert evidence。
- Foundation card/liability/commitment APIs and `docs/contracts/liability-and-commitment-storage-contract.md`。

## Inputs And State

- Occurrence 需具 stable event key、kind、due date、amount/range/unknown、currency、cash direction、status、reliability、source fact keys。
- Card merchant charge 是 economic event；cash effect 只在 payment occurrence 發生。
- Loan payment 可帶 principal/interest/fee components，總和必須等於 cash effect。

## Outputs And Side Effects

- Deterministic occurrence list with blockers for unknown date/amount, provisional schedule or stale statement。
- Template edit only rebuilds unsettled future occurrences；settled history unchanged。

## UI States

Future calendar distinguishes confirmed, estimated, range, unknown, overdue, settled and source-conflicted。未知不得以 0 顯示。

## Invariants

- Merchant expense、card liability and card cash settlement are three views of linked facts, not three expenses。
- Loan cash outflow equals principal + interest + fee；P&L only receives interest/fee。
- Duplicate source fact/event key fails closed。
- Uncertain income cannot silently offset committed outflow。

## Acceptance Examples

1. NT$10,000 card charge raises liability now, creates one due-date cash event, and produces no second expense on payment。
2. NT$20,000 loan due split 19,000 principal + 1,000 interest reduces projected cash by 20,000。
3. Missing official variable-rate schedule yields partial coverage rather than invented future payments。

## Test Mapping

```yaml
test_mapping:
  fixture: test/fixtures/financial-control/post-style-pressure.json
  future:
    - test/control-occurrence-mapping.test.js
    - test/cross-context-invariants.test.js
```

## Evidence

- `lib/queries/finance/obligations.js`與`docs/contracts/liability-and-commitment-storage-contract.md`。
- Acceptance A1、A2、A5 in `docs/plans/master-financial-control-plan.md`。

## Open Questions

- Needs owner decision：card statement close/due fallback when official policy is missing；fallback must remain estimated and partial。

## Update Trigger

Card／loan／commitment lifecycle、event dedupe、unknown policy、foundation owner或runtime occurrence adapter改變時更新。
