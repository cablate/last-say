# Bank Quirks

This file records statement-format behavior that the database cannot learn. Keep it generic and reusable. Do not store merchant classifications here.

## Credit Card Statement CSV

- Statement month and transaction month are different concepts. A January statement can contain December transactions and older delayed postings.
- Preserve original statement row order while preparing a ledger. Order helps audit whether rows were skipped or duplicated.
- Truncated merchant names are common. Treat them as incomplete evidence, not as final merchant facts.
- Names containing `*`, mixed English, or shortened descriptors often need normalization through `GET /api/rules/normalize?text=...` before rule matching.
- Negative values and payment rows must be interpreted from the source contract and `operator-contract.md`, not by category intuition alone.
- Fees, rebates, payments, and transfers should be checked against `flow_type` and direction before creating category rules.

## General Rules

- If a bank-specific assumption affects ledger shape, record it here.
- If an observation identifies a specific merchant or category, record it in `classification_rules.note` instead.
- If a bank format changes, update this file and then run a small import validation before processing a full month.
