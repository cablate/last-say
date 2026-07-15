---
schema_version: behavior-contract/v1
id: finance.owner-unresolved-cash-activity
title: Owner-unresolved cash activity
status: active
owner_surface: shared
change_context:
  type: bugfix
  reason: Cash rows whose purpose cannot be recovered must still reconcile to bank activity without being invented as income, expense, or internal transfer.
  non_goals:
    - Infer an economic purpose without evidence.
    - Implement a complete double-entry general ledger or cash-flow statement.
    - Store full personal bank account numbers in documentation, logs, or public searches.
    - Treat ordinary low-confidence AI classifications as owner-unresolved.
---

# Owner-unresolved cash activity contract

## Change Context

This contract separates two facts that were previously conflated:

1. the cash movement is confirmed by an institution statement; and
2. the owner can identify its economic purpose.

A transaction can satisfy the first fact while the second remains unavailable. In that case the system must preserve the cash leg, disclose the uncertainty, and avoid inventing a profit-and-loss effect.

Baseline evidence on 2026-07-16: the live database had 20 open rows whose owner could not recover the purpose. Thirteen rows used `flow_type=信用卡繳款/移轉`; the general transaction filter hid those rows before applying the review filter. The 20 rows represented TWD 40,048 inflow and TWD 44,970 outflow.

## Behavior Boundary

In scope:

- an explicit `無法確認` transaction category selected from owner evidence;
- separate counts and amounts for owner-unresolved inflows and outflows;
- a dedicated transaction-list view that includes unresolved transfer-shaped rows;
- the normal needs-review view showing all genuinely open rows, including transfer-shaped rows;
- management P&L exclusion lines and an explicit coverage blocker;
- preservation of statement amounts, dates, accounts, sources, and cash direction.

Out of scope:

- changing imported amounts, dates, account ownership, or source evidence;
- silently converting an unresolved row into an internal transfer;
- considering an unresolved row complete for report-readiness percentages;
- replacing transfer matching or account reconciliation.

## Consumers And Entrypoints

- `POST /api/transactions/batch` and `PATCH /api/transactions/:id`
- `GET /api/transactions?view=needs-review`
- `GET /api/transactions?view=unresolved`
- `GET /api/meta`
- `GET /api/summary`
- `GET /api/reports/income-statement`
- `lib/review-policy.js`
- `lib/queries/transactions.js`
- `lib/reporting/report-lines.js`
- `lib/queries/reports/income-statement.js`
- transaction, overview, and report browser surfaces
- future AI sessions that read `.claude/skills/last-say-ops/references/category-guide.md`

## Inputs And State

- `category_primary=無法確認` is an explicit owner-resolution outcome, not an AI fallback category.
- Applying the category through the existing correction API sets `classification_source=human` and `reviewed=1` while retaining the original cash fields.
- The governed AI-classification API rejects `無法確認` with `REVIEW_REQUIRED`, and reusable classification rules reject it entirely. The category becomes valid only when carrying an explicit owner decision through the human correction path.
- A later evidence-backed category correction replaces the unresolved state without deleting correction history.
- Account identifiers used for transfer matching remain local. Bank code plus a stable masked suffix is preferred; a full account number is used only when masked identifiers are not unique and must not be emitted in logs or documentation.

## Outputs And Side Effects

- The transaction remains active and continues to contribute its signed amount to account cash activity.
- `needsReview` excludes an owner-resolved `無法確認` row.
- `ownerUnresolved` includes it and exposes count, inflow, outflow, and net amounts.
- Management P&L maps unresolved inflows and outflows to separate excluded lines.
- Management P&L remains `partial` while any owner-unresolved row is in scope.
- Unresolved amounts do not increase confirmed revenue, confirmed expense, or net income.
- Correction history records the owner action; no classification rule is created automatically.

## UI States

- Loading and API-error states continue to use the existing transaction and report components.
- Ready state provides distinct native buttons for `只看待審` and `只看無法確認`, each exposing `aria-pressed`.
- Empty unresolved state says that the selected scope has no owner-unresolved rows; it must not claim all transactions are reviewed.
- Overview shows owner-unresolved count separately from actionable needs-review count.
- Report summary and coverage panel disclose unresolved count and amounts without relying on color alone.

## Invariants

- Imported amount, currency, direction, date, account, source, and external identity never change when setting `無法確認`.
- Bank/cash reconciliation includes unresolved rows exactly once.
- Confirmed P&L excludes unresolved rows exactly once.
- `needs-review` never hides a row solely because its flow type resembles a settlement or transfer.
- A row selected by explicit `ids` remains drillable even when its flow type is normally hidden from the default transaction view.
- Owner-unresolved is reversible through an ordinary human category correction.
- AI must not use `無法確認` merely because research is inconvenient or confidence is low.
- Neither an AI classification bundle nor a reusable classification rule can produce `無法確認`.

## Acceptance Examples

```gherkin
Given a posted TWD 10,000 bank outflow has an unknown purpose
And the owner confirms the purpose cannot be recovered
When the category is changed to 無法確認
Then the original TWD 10,000 cash outflow remains on the account
And confirmed expenses do not increase
And the unresolved-outflow total increases by TWD 10,000
And report coverage remains partial
```

```gherkin
Given a pending transaction uses flow_type 信用卡繳款/移轉
When the user opens view=needs-review
Then the row is returned if it satisfies the shared review policy
```

```gherkin
Given an owner-unresolved transfer-shaped transaction
When the user opens view=unresolved or drills down by transaction id
Then the transaction is visible
And its uncertainty is shown as text rather than inferred as an internal transfer
```

## Test Mapping

```yaml
test_mapping:
  unit:
    - test/review-policy.test.js
    - test/reporting-income-statement.test.js
    - test/owner-unresolved-transactions.test.js
    - test/transaction-ai-classification.test.js
  integration:
    - GET transaction/meta/summary query verification against a temporary SQLite database
    - GET management P&L verification against the live local database after migration
  manual:
    - Open the transaction list and toggle both review buttons with keyboard input.
    - Confirm unresolved count and totals match the live database control query.
```

## Evidence

- Baseline focused tests: `node --test test/review-policy.test.js test/reporting-income-statement.test.js test/spend-where-non-spend.test.js test/transfer-matching.test.js` — 19 passed on 2026-07-16.
- Baseline live control totals: 20 rows; inflow TWD 40,048; outflow TWD 44,970; net outflow TWD 4,922.
- Post-change focused tests: 21 passed, including unresolved category navigation, transfer-shaped visibility, review separation, and P&L exclusion.
- Full verification on 2026-07-16: `npm test` 155 passed; `npm run lint`, `npm run build`, `npm run smoke:runtime`, and `npm run test:e2e` passed.
- Live migration verification: all 20 rows are `classification_source=human`, `reviewed=1`, and `category_primary=無法確認`; actionable `needsReview=0` while `ownerUnresolved=20`.
- Live report verification: confirmed net income remains TWD 89,756; unresolved inflow TWD 40,048 and unresolved outflow TWD 44,970 are separate exclusion lines; coverage is `partial`.
- Browser verification: the dedicated unresolved view and category link each show all 20 rows; the category navigation discloses TWD 85,018 gross cash movement rather than reporting zero or hiding transfer-shaped rows.
- Account-identity audit: the six bank-account records currently have no masked number or source alias, and `transfer_matches` is empty. Exact self-transfer automation therefore remains unavailable until local account identifiers and opposite cash legs are present.
- CodeGraph was synchronized from the repository root after implementation; `buildTransactionWhere` impact remained bounded to summary, breakdown, trend, and transaction query consumers.

## Intentional Changes

- `無法確認` becomes a supported human-only outcome instead of leaving the row indefinitely actionable.
- Needs-review queries include transfer-shaped rows before owner resolution.
- Owner-unresolved rows are visible separately and block complete-report claims.
- P&L exposes separate unresolved inflow and outflow exclusions.

## Open Questions

- Whether future full double-entry reporting should post these rows to dedicated suspense asset/liability accounts is deferred to the cash-flow and balance-sheet phase.
- Full owned-account identifiers are not required unless bank code plus stable masked suffix cannot distinguish two local accounts.
- Since schema v9／MP-02B, reconciliation summary also lists detectable active transfer-shaped cash rows as `unmatched_transfer_candidates` and remains `unreconciled` while any exist. This still does not prove global source completeness or automatically identify the opposite owned account; exact pairing requires both cash legs and sufficient account evidence.

Update this contract when review-state semantics, report completeness, transfer matching, or account-identifier privacy rules change.
