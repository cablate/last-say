---
schema_version: behavior-contract/v1
id: reports.phase1.management_pl
title: Reports Phase 1 Management P&L
status: active
owner_surface: dashboard
change_context:
  type: feature
  reason: Add the first accounting report surface without claiming balance sheet or cash-flow completeness.
  non_goals:
    - Do not implement balance sheet computation.
    - Do not implement cash-flow computation.
    - Do not call server-side LLMs.
    - Do not mutate imported transaction facts.
---

# Reports Phase 1 Management P&L Contract

Implementation status note (validated 2026-07-16): this contract remains deliberately scoped to management P&L. The repository now also implements Balance Sheet and Cash Flow under their own contracts and server read models; those statements are not governed by this Phase 1 P&L contract.

## Behavior Boundary

In scope:

- A `/reports` route that shows a scoped management P&L.
- `GET /api/reports/income-statement` returning report JSON.
- Additive report mapping tables that are separate from merchant classification rules.
- Deterministic built-in report-line mapping for the first release.
- Coverage status, blockers, and warnings for empty, unmapped, partial, and complete P&L states.

Out of scope:

- Balance sheet and cash-flow statements.
- Transfer matching persistence.
- Balance snapshots.
- Accrual adjustments and statutory accounting claims.

## Consumers And Entrypoints

- Browser route: `/reports`.
- API route: `GET /api/reports/income-statement`.
- Query module: `lib/queries/reports/income-statement.js`.
- Pure helpers: `lib/reporting/report-lines.js` and `lib/reporting/coverage.js`.
- DB schema: `report_mapping_rules` and `transaction_report_mappings`.
- Navigation: app sidebar and app route title.

## Inputs And State

- `month`: `YYYY-MM` or absent. If absent, the API uses all available transaction rows.
- `entity_id`: optional string, default `personal`.
- `basis`: optional string, default `card_accrual_management`.
- `currency`: optional string, default `TWD`.
- Source rows come from `transactions`.
- Explicit mappings, when present, come from `transaction_report_mappings`.
- Built-in mappings are deterministic and must not reuse `classification_rules` as accounting rules.

## Outputs And Side Effects

The API returns JSON with:

- `report: "management_pl"`;
- selected scope and period;
- revenue, expense, and excluded line arrays;
- total revenue, total expense, net income, excluded total;
- unmapped, unreviewed, and transaction counts;
- coverage object.

Side effects:

- Schema creation is additive and idempotent.
- The report endpoint does not write report rows, call external services, or edit transactions.
- UI state is client-only except for API reads.

## UI States

- First paint: existing app shell remains mounted; report body shows skeletons while loading.
- Empty: shows an actionable empty state when no transactions exist in scope.
- Unmapped: shows an info alert when transactions exist in scope and are all reviewed, but one or more still need a report-line assignment. This state is distinct from partial because the rows have already been reviewed; the only remaining gap is the report mapping itself.
- Partial: shows computed values plus blockers (unreviewed transactions, unmatched transfers, etc.) before the statement table.
- Complete: shows the coverage badge and statement table without blockers.
- Error: shows an inline destructive alert with the API error message.
- Mobile: shows compact cards and a line list, not a squeezed desktop-only layout.

## Invariants

- `category_primary` remains the user-facing bookkeeping category.
- Report lines are separate accounting semantics.
- Card payments and internal transfers are not P&L expenses.
- Credit-card charges count once as expenses when mapped as expense lines.
- Existing summary, breakdown, trend, transactions, corrections, and rules routes remain unchanged.
- Tests and demos must use `FINANCE_DB_PATH` pointing at non-real databases.

## Acceptance Examples

1. Given a credit-card restaurant charge for NT$1,000 and a later bank card payment for NT$1,000, when the P&L is requested, then expense total includes NT$1,000 once and excluded total includes the card payment.
2. Given a checking outflow and matching savings inflow marked as transfers, when the P&L is requested, then both rows are excluded from revenue and expense.
3. Given a salary bank inflow for NT$80,000, when the P&L is requested, then revenue total includes NT$80,000.
4. Given a loan principal repayment and a loan interest row, when the P&L is requested, then principal is excluded and interest is an expense.
5. Given no transactions in scope, when `/reports` loads, then the UI shows empty state and the API coverage status is `empty`.

## Test Mapping

```yaml
test_mapping:
  unit:
    - test/reporting-income-statement.test.js
  integration:
    - test/reporting-income-statement.test.js
  manual:
    - npm run build
```

## Evidence

- `git diff --check -- ...` passed for the touched Phase 1 files.
- `FINANCE_DB_PATH=data/reporting-all-tests.test.sqlite npm test` passed: 10 tests, 10 pass.
- `FINANCE_DB_PATH=data/reporting-build.test.sqlite npm run build` passed and listed `/reports` plus `/api/reports/income-statement`.
- Playwright smoke against `http://127.0.0.1:3130/reports?month=2026-06` passed for desktop and mobile with no console/page errors.

## Intentional Changes

- A new Reports navigation item is added.
- New additive report mapping tables are initialized in SQLite.
- The first P&L may be `unmapped` when all rows are reviewed but some still lack a report-line assignment, or `partial` when unreviewed transactions, unmatched transfers, or other blockers exist. Coverage status resolves in the order empty → unmapped → partial → complete.

## Open Questions

- Future phases need separate review UI for explicit report-line corrections.
- Future phases need balance snapshots before balance sheet or cash-flow completeness can be claimed.
