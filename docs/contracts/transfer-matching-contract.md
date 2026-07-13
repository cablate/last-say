# Transfer Matching Contract

> Upstream data owner: `financial-data-core-contract.md`,
> `account-balance-storage-contract.md`, and
> `liability-and-commitment-storage-contract.md`. This contract owns typed
> reconciliation proposals and decisions, not source transaction or balance
> facts.

> Status: planning contract.
> Scope: candidate matching and human confirmation for internal transfers.

## Purpose

Transfer matching prevents own-account movements from being misread as income,
expenses, or external cash flow.

The system may propose transfer candidates, but confirmed transfer matches are
separate records. Source transaction rows remain immutable.

## Transfer Types

- bank to bank;
- bank to e-wallet;
- e-wallet to bank;
- bank to brokerage cash;
- bank payment to credit card;
- loan payment split candidates;
- owner contribution/draw when explicitly marked.

Credit-card payments are liability settlements. They are not P&L expenses, but
they are cash movements for cash flow.

## Candidate Inputs

For each candidate pair or group:

- transaction ids;
- source account id;
- target account id when known;
- transaction dates;
- amount in cents;
- direction;
- source type and flow type;
- raw name/counterparty;
- source statement id when available;
- account roles and kinds.

## Scoring Signals

Positive signals:

- equal absolute amount;
- opposite direction;
- dates within allowed window;
- account kinds make sense for transfer;
- names/counterparties include transfer/payment/card/account hints;
- both rows are in the same entity;
- source statements identify related accounts.

Negative signals:

- same direction;
- materially different amounts;
- dates outside window;
- merchant-like counterparty on one side;
- different entities;
- row already confirmed in another transfer match;
- low source confidence or missing account identity.

Default date windows:

- bank-to-bank: 3 calendar days;
- card payment: 7 calendar days;
- brokerage/e-wallet settlement: 7 calendar days;
- anything outside the window requires human confirmation.

## Match States

- `candidate`: proposed but not reviewed.
- `confirmed`: human confirmed or high-confidence deterministic rule accepted
  by policy.
- `rejected`: human rejected.
- `needs_review`: candidate is plausible but below auto-confirm threshold.
- `superseded`: replaced by a better match.

Low-score candidates must never become `confirmed` without human action.

## Output Shape

```json
{
  "id": 42,
  "state": "candidate",
  "score": 0.84,
  "kind": "bank_to_bank",
  "transaction_ids": [1001, 1002],
  "amount_cents": 500000,
  "date_delta_days": 1,
  "reason": "Equal amount, opposite directions, both own bank accounts.",
  "requires_review": true
}
```

## Accounting Effects

Income statement:

- confirmed internal transfers are excluded;
- rejected transfers return to normal report-line mapping;
- unreviewed plausible transfers can keep P&L partial when their treatment would
  materially change the statement.

Cash flow:

- confirmed internal transfers are eliminated when both accounts are in scope;
- one-sided transfers block complete status;
- unmatched transfer residuals contribute to `partial` or `unreconciled`.

Balance sheet:

- transfer matches do not change snapshots;
- they can explain reconciliation differences but cannot replace missing
  balances.

## Human Review Requirements

Review queue must show:

- candidate rows side by side;
- amount/date/account comparison;
- score and reason;
- confirm, reject, and edit actions;
- whether confirming affects P&L, cash flow, or both.

## Acceptance Examples

1. Same-day own transfer:
   - Checking outflow NT$5,000.
   - Savings inflow NT$5,000.
   - Score high; human can confirm.
   - P&L excludes both and cash flow eliminates both.

2. One-sided transfer:
   - Checking outflow NT$5,000 to a known savings account.
   - No receiving row imported.
   - Candidate remains incomplete; cash flow coverage is partial or
     unreconciled.

3. Card payment:
   - Bank outflow NT$10,000.
   - Credit-card liability settlement row or statement balance change exists.
   - P&L excludes payment; cash flow includes settlement outflow.

4. False candidate:
   - Grocery purchase NT$500.
   - Bank inflow NT$500 refund from unrelated source.
   - Merchant-like names and source mismatch lower score; human review required.

## Test Requirements

- Unit tests for scoring equal/opposite/date-window matches.
- Unit tests for false-positive suppression.
- Query/API tests for state transitions.
- Cash flow fixture proving confirmed transfers are eliminated.
- Cash flow fixture proving one-sided transfers block complete status.
