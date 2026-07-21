# Management P&L Contract

> Status: active implementation contract (`finance.management-pl/v1`).
> Scope: income statement / profit and loss for management reporting.

## Purpose

The management P&L answers:

- what income was recognized in the selected period;
- what expenses belong to the selected period;
- what rows are excluded because they are transfers, card payments, loan
  principal, investment purchases, or unresolved items;
- what remains unmapped or unreviewed.

It is not a tax statement, statutory income statement, or full accrual ledger.

## Default Basis

Default basis is `card_accrual_management`:

- credit-card charges are recognized as expenses on transaction date;
- credit-card payments are not expenses;
- bank transfers between own accounts are not income or expenses;
- cash/bank account inflows and outflows can be used when no card account is
  involved;
- future `accrual` basis requires explicit manual adjustments or imported
  receivable/payable data.

This is the only implemented basis in `finance.management-pl/v1`. Requests for
`cash` or future `accrual` fail closed instead of returning the same calculation
under a different label.

## Required Inputs

Current data:

- `transactions.transaction_date`
- `transactions.transaction_month`
- `transactions.amount`, `inflow`, `outflow`
- `transactions.source_type`
- `transactions.flow_type`
- `transactions.category_primary`
- `transactions.classification_source`
- `transactions.ai_confidence`
- `transactions.reviewed`
- `transactions.account_id`

Future data:

- reporting entity/account scope;
- report-line mapping per transaction;
- report mapping rules separate from `classification_rules`;
- optional manual adjustment entries for future accrual mode.

## Mapping Priority

For each transaction:

1. explicit human-reviewed `transaction_report_mappings`;
2. confirmed typed-owner facts from transfer, card-payment, loan-allocation, or
   investment-cash matching;
3. enabled `report_mapping_rules`;
4. normal income or expense category/keyword mapping;
5. `unmapped` review item.

Merchant classification rules must not be reused as accounting mappings. They
can be hints only.

Transaction names, bank rail wording such as `轉入` or `轉出`, `flow_type`, AI
confidence, and an ordinary `轉帳/內部移轉` category are exclusion hints only.
They must not create a P&L exclusion without an explicit report mapping or a
confirmed typed-owner fact. See
`docs/contracts/evidence-backed-pl-exclusions-contract.md`.

## Included Lines

Minimum statement groups:

- revenue:
  - salary;
  - business revenue;
  - interest income;
  - refund or other income when not simply reversing an expense;
- expense:
  - food;
  - housing;
  - transportation;
  - subscription and software;
  - insurance;
  - medical;
  - education;
  - fees and taxes;
  - business operating expense;
  - other expense;
- excluded:
  - internal transfer;
  - credit-card payment;
  - loan principal;
  - investment purchase;
  - owner contribution/draw unless explicitly shown outside P&L.

## Calculation

```text
total_revenue = sum(revenue line amounts)
total_expense = sum(expense line amounts)
net_income = total_revenue - total_expense
```

Amounts are stored and calculated in cents. Display formatting happens outside
query logic.

## Credit Card Rule

If a card charge and a later bank payment both exist:

- card charge appears once as P&L expense;
- card payment is excluded from P&L;
- the same economic purchase must never appear twice.

## Loan Rule

Loan repayment split:

- principal -> excluded from P&L, financing/cash-flow treatment later;
- interest -> expense;
- fees -> expense.

If a single loan payment row cannot be split, mark it `partial` and route it to
review instead of guessing.

## Investment Rule

Investment purchase:

- not a P&L expense;
- maps to investing cash flow or asset reclassification;
- realized gain/loss is not inferred without explicit trade data or manual
  adjustment.

## Output Shape

```json
{
  "report": "management_pl",
  "basis": "card_accrual_management",
  "period_start": "2026-06-01",
  "period_end": "2026-06-30",
  "currency": "TWD",
  "revenue": [{ "line": "business_revenue", "amount_cents": 100000 }],
  "expenses": [{ "line": "food", "amount_cents": 12000 }],
  "excluded": [{ "line": "credit_card_payment", "amount_cents": 50000 }],
  "total_revenue_cents": 100000,
  "total_expense_cents": 12000,
  "net_income_cents": 88000,
  "unmapped_transaction_count": 0,
  "unreviewed_transaction_count": 0,
  "coverage": {}
}
```

## Human Review Requirements

Review queue must expose:

- transaction identity and source account;
- proposed report line;
- confidence;
- human-readable reason;
- confirm/correct/defer actions;
- create mapping rule action only when confidence and evidence justify it.

## Acceptance Examples

1. Card charge plus card payment:
   - Card restaurant charge NT$1,000.
   - Bank card payment NT$1,000.
   - P&L expense is NT$1,000 once.

2. Bank-to-bank transfer:
   - Checking outflow NT$5,000.
   - Savings inflow NT$5,000.
   - P&L excludes both.

3. Salary:
   - Bank inflow NT$80,000 from employer.
   - P&L revenue includes NT$80,000.

4. Loan payment:
   - NT$9,000 principal and NT$1,000 interest.
   - P&L expense includes NT$1,000 only.

## Test Requirements

- P&L query fixture for card payment double-count prevention.
- P&L query fixture for transfer exclusion.
- P&L query fixture for loan principal exclusion.
- API response shape test.
- Drilldown test from statement line to underlying transactions.

## Update Rule

Update this contract when report-line precedence, economic recognition,
owner-unresolved treatment, coverage, or response fields change. Last validated
against repository: 2026-07-16.
