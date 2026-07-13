# Cash Flow Contract

> Upstream data owner: `financial-data-core-contract.md`,
> `account-balance-storage-contract.md`,
> `liability-and-commitment-storage-contract.md`, and
> `transfer-matching-contract.md`. This contract owns only the cash-flow read
> model and must not recreate canonical balances, obligations, or matches.

> Status: planning contract.
> Scope: direct-method management cash flow statement.

## Purpose

The cash flow statement answers how included cash changed during a period. It is
not the same as P&L, category spend, or balance history.

Cash flow completeness depends on beginning and ending cash snapshots plus
reviewed cash movements and transfer handling.

## Required Inputs

- Included cash-equivalent accounts: bank, cash, e-wallet, brokerage cash when
  in scope.
- Beginning cash snapshot at period start or prior period close.
- Ending cash snapshot at period end.
- Cash transaction rows for included accounts.
- Report-line/cash-flow class mapping.
- Transfer matches for internal transfers.
- Credit-card, loan, and investment account metadata when those flows exist.

## Direct Method Sections

Minimum sections:

- operating cash flow;
- investing cash flow;
- financing cash flow;
- internal transfers eliminated;
- excluded or unresolved flows.

## Classification Rules

| Flow | Cash flow treatment |
|---|---|
| Customer/business revenue cash receipt | Operating inflow |
| Salary cash receipt | Operating inflow for personal management reports |
| Food/rent/subscription cash payment from bank | Operating outflow |
| Credit-card payment from bank | Operating settlement outflow by default; not P&L expense |
| Loan principal repayment | Financing outflow |
| Loan interest payment | Operating outflow unless a later policy changes it |
| Investment purchase | Investing outflow |
| Investment sale cash receipt | Investing inflow; gains/losses require separate data |
| Owner contribution | Financing inflow |
| Owner draw | Financing outflow |
| Own-account transfer, both sides in scope | Eliminated |
| Own-account transfer, one side missing | Partial or unreconciled |

The card-payment section intentionally does not allocate card payments back to
merchant categories. P&L remains the category-detail view.

## Transfer Matching

Transfer candidates may be proposed by:

- equal absolute amount;
- opposite direction;
- date window;
- source account and target account roles;
- counterparty/name hints;
- statement source references.

Low-score candidates cannot be auto-confirmed. Confirmed matches are stored
separately from source transactions.

## Reconciliation

```text
beginning_cash
+ operating_cash_flow
+ investing_cash_flow
+ financing_cash_flow
+ unresolved_cash_flow
= expected_ending_cash

reconciliation_delta = expected_ending_cash - ending_cash_snapshot
```

For single-currency TWD cents, required delta for `complete` is exactly zero.
Non-zero delta returns `unreconciled`.

For future multi-currency reports, reconcile by currency unless FX rules exist.

## Output Shape

```json
{
  "report": "cash_flow",
  "period_start": "2026-06-01",
  "period_end": "2026-06-30",
  "currency": "TWD",
  "beginning_cash_cents": 1000000,
  "operating": [{ "line": "credit_card_settlement", "amount_cents": -50000 }],
  "investing": [{ "line": "investment_purchase", "amount_cents": -200000 }],
  "financing": [{ "line": "loan_principal", "amount_cents": -90000 }],
  "internal_transfers_eliminated_cents": 500000,
  "unresolved_cash_flow_cents": 0,
  "ending_cash_cents": 660000,
  "reconciliation_delta_cents": 0,
  "unmatched_transfer_count": 0,
  "coverage": {}
}
```

## Human Review Requirements

Review queue must expose:

- unmatched transfer candidates;
- low-confidence cash-flow class mappings;
- missing beginning/ending cash snapshots;
- reconciliation delta with drilldown to candidate rows;
- confirm/reject/edit transfer match actions.

## Acceptance Examples

1. Complete cash flow:
   - Beginning cash NT$100,000.
   - Operating outflow NT$20,000.
   - Ending cash NT$80,000.
   - Delta NT$0, coverage `complete`.

2. Bank-to-bank transfer:
   - Checking outflow NT$5,000.
   - Savings inflow NT$5,000.
   - Both accounts in scope and match confirmed.
   - Eliminated from net cash change.

3. One-sided transfer:
   - Checking outflow NT$5,000.
   - Receiving account missing.
   - Coverage `partial` or `unreconciled`, not complete.

4. Card payment:
   - Bank outflow NT$10,000 paying credit card.
   - Cash flow includes NT$10,000 cash outflow.
   - P&L does not count the card payment as an expense.

5. Investment purchase:
   - Bank outflow NT$20,000 to brokerage.
   - Cash flow investing outflow NT$20,000 unless both bank and brokerage cash
     accounts are in scope and it is a pure internal transfer awaiting purchase
     detail.

## Test Requirements

- Unit tests for transfer candidate scoring.
- Query fixture for complete reconciliation.
- Query fixture for one-sided transfer blocker.
- Query fixture for card payment treatment.
- API response shape test with reconciliation delta.
