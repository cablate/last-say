---
schema_version: behavior-contract/v1
id: finance.evidence-backed-pl-exclusions
title: Evidence-backed management P&L exclusions
status: active
owner_surface: shared
change_context:
  type: bugfix
  reason: Broad transfer, payment, principal, and investment keywords were excluding real income and expenses without canonical evidence.
  non_goals:
    - Change imported transaction facts or transaction-detail editing behavior.
    - Guess unresolved transaction purposes or loan allocations.
    - Change cash-flow, balance-sheet, transfer-matching, or obligation write APIs.
---

# Evidence-backed Management P&L Exclusions Contract

## Behavior Boundary

This contract governs whether a transaction may appear in the management P&L
`excluded` group. It narrows exclusion authority; it does not reclassify or
rewrite source transactions.

In scope:

- exclusion precedence in `classifyTransactionForReport`;
- confirmed owner facts loaded by the income-statement query;
- review output for exclusion-like rows that lack evidence;
- the evidence wording shown by the income-statement UI.

Out of scope:

- creating transfer, card-payment, investment, or loan-allocation facts;
- editing transaction descriptions, categories, or amounts;
- deciding the purpose of an unresolved cash movement;
- changing another financial statement's recognition rules.

## Consumers And Entrypoints

- Browser: `/reports?month=YYYY-MM&statement=income`.
- API: `GET /api/reports/income-statement`.
- Query: `lib/queries/reports/income-statement.js::getIncomeStatement`.
- Classifier: `lib/reporting/report-lines.js::classifyTransactionForReport`.
- Canonical owners: `transaction_report_mappings`, `transfer_matches`,
  `credit_card_payment_matches`, `loan_payment_allocations`, and
  `investment_cash_matches`.
- Downstream consumers: Monthly Financial Pulse, Spending Structure, Financial
  Dashboard, analysis-context datasets, tests, and AI operators.

## Inputs And State

The classifier may use:

1. an explicit valid `transaction_report_mappings.report_line`; an exclusion
   mapping additionally requires reviewed human ownership;
2. a confirmed typed owner fact joined to the transaction;
3. an enabled report-mapping rule;
4. a normal income or expense category/keyword mapping;
5. exclusion-like text only as a review hint.

Typed owner facts are usable by this report only when their lifecycle state is
confirmed and active according to that owner's schema. A transaction name,
bank rail description such as `轉入` or `轉出`, `flow_type`, merchant category,
AI confidence, or an ordinary category of `轉帳/內部移轉` is not sufficient
evidence by itself.

## Outputs And Side Effects

- `excluded` contains only confirmed typed-owner facts or reviewed human
  per-transaction report mappings.
- A likely transfer, card payment, loan payment, or investment purchase without
  canonical evidence becomes an `unmapped` review item with a concrete reason.
- Confirmed loan allocations split principal to `excluded`, interest to expense,
  and fees to expense. An unallocated payment is never treated wholly as
  principal.
- Income and expense categories are no longer overridden merely because the
  bank description contains transfer wording.
- The query remains read-only: no database writes, transaction edits, or owner
  facts are created as a side effect.

## UI States

- Loading, empty, and error behavior remain owned by the existing Reports view.
- Ready: the collapsed exclusion section states that exclusions require
  confirmed evidence or an explicit mapping.
- Review required: unresolved exclusion candidates appear in the existing
  report-review table, including a human-readable reason.
- The transaction drill-down keeps the existing read-only navigation behavior.

## Invariants

- A credit-card purchase and its confirmed payment affect P&L only once.
- A confirmed own-account transfer does not affect consolidated P&L.
- Loan principal is excluded only for the verified principal component.
- Investment cash is excluded only when linked to an investment owner fact.
- Uncertainty lowers report completeness; it does not silently become zero,
  income, expense, or an exclusion.
- Reviewed human per-transaction report mappings remain the highest-priority
  owner correction. An AI-authored exclusion proposal is a review item, not a
  confirmed exclusion.
- General report-mapping rules may classify income or expense but cannot create
  an exclusion.
- No code path in this change writes to transaction or matching tables.

## Acceptance Examples

1. Given `跨行轉入 | 講師費` is categorized as business revenue but has no
   transfer match, when the P&L is generated, then it remains revenue and is not
   excluded merely because its name contains `轉入`.
2. Given `電子轉出 | 房租` is categorized as housing expense but has no transfer
   match, then it remains an expense and is not excluded merely because its name
   contains `轉出`.
3. Given a row is categorized as an internal transfer but has no confirmed
   transfer match or explicit report mapping, then it is unmapped, appears in
   review, and does not enter the exclusion subtotal.
4. Given both cash legs have a confirmed `transfer_matches` row, then both legs
   appear under `excluded:internal_transfer`.
5. Given a possible loan payment has no confirmed allocation, then the report
   does not infer that the entire payment is principal.
6. Given a confirmed loan allocation contains principal, interest, and fee,
   then only principal is excluded and the other components are expenses.
7. Given a generic report rule proposes any `excluded:*` line without typed
   evidence, then the row remains a review item.
8. Given an AI-authored per-transaction exclusion, then it remains a review item
   until a human-reviewed mapping confirms it.
9. Given a generic report rule conflicts with a confirmed typed card-payment
   owner, then the typed owner remains authoritative unless a reviewed human
   per-transaction report mapping corrects it.

## Test Mapping

```yaml
test_mapping:
  focused:
    - test/reporting-income-statement.test.js
    - test/reporting-three-view.test.js
  integration:
    - GET /api/reports/income-statement?month=2026-07
  manual:
    - Open the July income statement and confirm earned income is not under exclusions.
    - Confirm unresolved payment/allocation candidates appear in the review table.
```

## Evidence

- Before fix, the 2026-07 API excluded NT$90,398 using only `built_in`
  mappings; the nine rows had no transfer, card-payment, loan-allocation, or
  explicit report-mapping records.
- Before fix, `跨行轉入 | 嘟嘟數位科技有限公司`, `跨行轉入 | 0630登月教育講師費`,
  and `電子轉出 | 7月房租 押金` were overridden by transfer keywords despite
  income/housing categories.
- After the fix, `GET /api/reports/income-statement?month=2026-07` reports
  NT$94,282 revenue, NT$28,813 expense, provisional net income of NT$65,469,
  NT$0 confirmed exclusions, and four explicit review items. Coverage remains
  `unmapped`; these totals are intentionally not presented as final.
- `npm test` passed all 232 tests. The focused
  `npm test -- test/reporting-income-statement.test.js` run passed 16/16 tests.
- `npm run lint`, `npm run build`, and `git diff --check` completed successfully.
- Browser verification confirmed the July report shows `AI 分類`,
  `已確認不列入損益 NT$0`, four reasoned review rows, and no duplicate
  unmatched-transfer blocker. The `查看` action opened the intended filtered
  transaction view at `/transactions?ids=1117` and returned to the report.

## Intentional Changes

- Broad transfer/card/principal/investment text no longer directly creates an
  excluded report line.
- Confirmed typed owner evidence now precedes ordinary report rules; ordinary
  rules and categories cannot override an active confirmed match.
- Unproven exclusion candidates now make report coverage incomplete instead of
  making the P&L appear complete with a guessed exclusion.

## Open Questions

- The economic split of transactions that combine rent and a refundable deposit
  still requires owner evidence or a future split-adjustment capability.

Last validated against repository: 2026-07-21.
