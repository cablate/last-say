# Report Coverage Contract

> Status: frozen implementation contract (`finance.report-coverage/v1`).
> Scope: shared coverage semantics for management reports.

## Purpose

Every accounting report must disclose whether the displayed numbers are safe to
read as a complete scoped statement. Coverage is a first-class output, not a UI
decoration.

Reports may be useful while incomplete, but the product must never present an
incomplete, stale, or unreconciled report as complete.

## Report Scope Inputs

Every report request is scoped by:

- `entity_id` or default entity `personal`;
- period start and end for income statement and cash flow;
- `as_of_date` for balance sheet;
- basis: `cash`, `card_accrual_management`, or future `accrual`;
- included account ids, or an account-scope preset;
- currency, default `TWD`.

If no entity/account metadata exists yet, existing imported data may default to
`personal`, but the response must say which values were defaulted.

## Coverage Statuses

### `empty`

No usable source data exists for the requested scope.

Examples:

- no transactions in period;
- no balance snapshots for the selected as-of date;
- no accounts included in the report scope.

### `unmapped`

The report has usable rows and no broader reconciliation failure, but one or
more rows have no accounting report-line mapping. This existing public P&L state
is retained for compatibility and is still a blocking, incomplete state.

### `partial`

Enough data exists to compute a scoped report, but missing or stale data prevents
complete status.

Examples:

- P&L can compute reviewed credit-card expenses, but some transactions are
  unmapped;
- balance sheet has bank snapshots but no credit-card balance snapshot;
- cash flow has beginning cash but missing ending cash;
- a one-sided transfer exists and the receiving account is not imported.

### `unreconciled`

The report has enough data to run reconciliation checks, but the checks fail.

Examples:

- cash flow beginning cash plus net cash movement does not equal ending cash;
- transfer matches produce a non-zero internal-transfer residual;
- balance sheet explicit assets, liabilities, and equity do not tie out.

### `complete`

All required data for the selected scope exists, no blocking review items remain,
and report-specific reconciliation checks pass.

## Shared Coverage Object

```json
{
  "status": "empty | unmapped | partial | unreconciled | complete",
  "entity_id": "personal",
  "period_start": "2026-06-01",
  "period_end": "2026-06-30",
  "as_of_date": "2026-06-30",
  "basis": "card_accrual_management",
  "currency": "TWD",
  "included_account_ids": [1, 2],
  "defaulted_fields": ["entity_id"],
  "missing_required_accounts": [],
  "missing_balance_snapshots": [],
  "stale_balance_snapshots": [],
  "unreviewed_transaction_count": 0,
  "unmapped_transaction_count": 0,
  "unmatched_transfer_count": 0,
  "reconciliation_delta_cents": 0,
  "blockers": [],
  "warnings": []
}
```

`blockers` must be machine-readable and UI-readable:

```json
{
  "kind": "missing_balance_snapshot",
  "severity": "blocks_complete",
  "account_id": 12,
  "label": "示範銀行 A 活存帳戶",
  "recommended_action": "add_balance_snapshot"
}
```

## Blocking Rules By Report

| Blocker | Income Statement | Balance Sheet | Cash Flow |
|---|---:|---:|---:|
| No period transactions | empty | not applicable | empty or partial |
| Unreviewed low-confidence transactions | partial | partial if account/snapshot affected | partial |
| Unmapped report lines | partial | partial if asset/liability/equity affected | partial |
| Missing balance snapshot | warning only | partial | partial or unreconciled |
| Stale balance snapshot | warning only | partial | partial |
| Unmatched transfer | partial if transfer could affect P&L exclusion | warning or partial | partial or unreconciled |
| Failed equation check | not applicable | unreconciled | unreconciled |

## UI Requirements

- Show status next to the report title.
- Show blockers before report tables when status is `partial` or
  `unreconciled`.
- Do not hide computed values for partial reports; label them as scoped.
- Drill blockers to the related transaction, account, snapshot, or transfer
  review queue.
- Empty state must tell the user what input is missing next.

## Acceptance Examples

1. Missing card statement:
   - Bank account has complete snapshots.
   - Credit card account is marked required but has no snapshot.
   - Balance sheet coverage is `partial`.
   - Income statement may still be `partial` or `complete` depending on P&L
     mappings.

2. Cash flow mismatch:
   - Beginning cash NT$10,000.
   - Net cash movement NT$2,000.
   - Ending cash snapshot NT$11,900.
   - Coverage is `unreconciled` with `reconciliation_delta_cents = 10000`.

3. One-sided transfer:
   - Bank outflow NT$5,000 is mapped as internal transfer.
   - No matching receiving account row exists.
   - Cash flow coverage is `partial` or `unreconciled`.

## Test Requirements

- Unit tests for status selection.
- Query/API tests for coverage object shape.
- Fixtures for `empty`, `partial`, `unreconciled`, and `complete`.
- No test may point at `data/finance.sqlite`.

## Update Rule

Update this contract whenever scope defaults, coverage statuses, blockers,
reconciliation rules, or public drillback behavior changes. Last validated
against repository: 2026-07-16.
