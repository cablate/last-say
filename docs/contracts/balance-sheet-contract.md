# Balance Sheet Contract

> Upstream data owner: `financial-data-core-contract.md`,
> `account-balance-storage-contract.md`, and
> `investment-valuation-storage-contract.md`. This contract owns only the
> balance-sheet read model and must not recreate canonical account, balance,
> liability, or valuation facts.

> Status: frozen implementation contract (`finance.balance-sheet/v1`).
> Scope: management balance sheet / net worth statement.

## Purpose

The balance sheet answers what the selected entity owns and owes as of a date.
It must be built from account semantics and balance snapshots, not inferred from
transaction rows alone.

## Required Inputs

Account register (current repository fields):

- account id;
- entity id;
- account kind: `cash`, `bank`, `credit_card`, `loan`, `investment`,
  `e_wallet`, `receivable`, `payable`, `fixed_asset`, `equity`, `other`;
- normal balance: debit or credit;
- currency;
- active flag;
- `included_in_analysis` flag.

The current schema has no independent `report_role` column. The first release
therefore maps role deterministically from `account_kind`: cash/bank/e-wallet/
investment/receivable/fixed-asset are assets; credit-card/loan/payable are
liabilities; equity is equity. `other` is excluded with a coverage blocker until
the owner gives it a typed account kind. Do not add a parallel role store in the
report query.

Balance snapshots:

- account id;
- as-of date;
- statement month when available;
- balance amount in cents;
- currency;
- source id or manual source note;
- created/updated metadata.

## Snapshot Rule

Balance sheet completeness depends on snapshots.

Transaction-derived running balances may be hints, but they are not complete
balance-sheet evidence unless the statement/source explicitly provides the
ending balance for the as-of date.

For investment accounts, an active account-level balance snapshot is the total
owner when present. Holding snapshots may provide drilldown but must not be added
again. If no account-level snapshot exists, the report may use the sum of current
holding valuations only when every included holding has a usable base-currency
value; otherwise it remains partial.

`valued_items` are separate tier-2 assets/liabilities and use their latest active
valuation on or before the as-of date. A liability profile or payment schedule is
an obligation timeline, not evidence of current principal; current debt enters
the balance-sheet total only through a balance/statement snapshot. The report may
show unsupported obligation rows separately as blockers.

Liability balance snapshots store an unsigned outstanding magnitude. The report
presents that amount in the liabilities section and derives net worth as assets
minus liabilities; source/import code must not encode debt by depending on a
negative snapshot sign.

## Freshness Policy

Default policy:

- snapshot dated exactly on `as_of_date`: current;
- snapshot dated within the selected statement period but before `as_of_date`:
  acceptable with warning;
- snapshot older than the selected statement period: stale and blocks
  `complete`;
- missing required account snapshot: blocks `complete`.

The UI must show the actual snapshot date.

## Calculation

```text
assets = sum(asset account snapshot balances)
liabilities = sum(liability account snapshot balances)
net_worth = assets - liabilities
```

If explicit equity/manual journal entries are later introduced:

```text
assets = liabilities + equity
equation_delta = assets - liabilities - equity
```

For the first management release, deriving net worth is acceptable when no
explicit equity ledger exists.

## Account Treatment

| Account kind | Balance sheet role | Notes |
|---|---|---|
| cash/bank/e_wallet | asset | Positive balances increase assets. |
| credit_card | liability | Statement balance increases liabilities. |
| loan | liability | Principal balance increases liabilities. |
| investment | asset | Requires explicit statement/brokerage snapshot. |
| receivable | asset | Future accrual/manual entry feature. |
| payable | liability | Future accrual/manual entry feature. |
| fixed_asset | asset | Manual snapshot or future depreciation support. |
| equity | equity | Future explicit equity support. |

## Output Shape

```json
{
  "report": "balance_sheet",
  "as_of_date": "2026-06-30",
  "currency": "TWD",
  "assets": [{ "line": "bank", "amount_cents": 1200000 }],
  "liabilities": [{ "line": "credit_card", "amount_cents": 80000 }],
  "equity": [{ "line": "derived_net_worth", "amount_cents": 1120000 }],
  "total_assets_cents": 1200000,
  "total_liabilities_cents": 80000,
  "net_worth_cents": 1120000,
  "equation_delta_cents": 0,
  "coverage": {}
}
```

Every line also carries `resource_type`, `resource_key`, `source_key`, actual
`snapshot_date`, `native_currency`, native amount, conversion watermark when
used, and `drillback_ids`. Unknown conversion or missing snapshots never become
zero-valued lines.

## Human Review Requirements

Review queue must expose:

- account identity;
- account kind/report role suggestion;
- latest snapshot amount and source;
- stale or missing snapshot reason;
- action to add snapshot with source note;
- action to mark account intentionally excluded from scope.

Inferred account metadata can be saved only as reviewable metadata. It must not
change imported transaction facts.

## Acceptance Examples

1. Complete personal scope:
   - Checking NT$100,000.
   - Savings NT$200,000.
   - Credit card payable NT$30,000.
   - Net worth NT$270,000.
   - Coverage `complete` if all required accounts are current.

2. Missing credit card snapshot:
   - Bank snapshots exist.
   - Required credit card account has no snapshot.
   - Coverage `partial`.

3. Stale brokerage snapshot:
   - Brokerage snapshot is dated 2026-03-31.
   - Report as-of date is 2026-06-30.
   - Coverage `partial`, blocker lists stale investment account.

4. One account intentionally excluded:
   - Account is active but marked excluded for this scope.
   - Coverage notes exclusion and does not count it as missing.

## Test Requirements

- Query fixture for complete assets/liabilities/net worth.
- Query fixture for missing snapshot.
- Query fixture for stale snapshot.
- API response includes coverage and blockers.
- UI/browser evidence for partial and complete states when implemented.

## Update Rule

Update this contract when account-role ownership, snapshot precedence,
investment/FX valuation, liability-current-balance evidence, or the public
response changes. Last validated against repository: 2026-07-16.
