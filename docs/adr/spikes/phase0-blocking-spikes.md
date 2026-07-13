# Phase 0 Blocking Spike Evidence

- Date: 2026-07-14
- Command: `node scripts/fixtures/financial-data/run-phase0-spikes.mjs`
- Data: synthetic; all databases created under OS temp and deleted on exit
- Environment: Node v22.19.0, SQLite 3.50.4, Windows x64

## BigInt Round-trip

`9007199254740993` (one above JavaScript's safe-integer boundary) was inserted
as SQLite `INTEGER`, read with `setReadBigInts(true)`, and returned as
`9007199254740993n`. Result: exact.

Decision: new money uses integer minor units and BigInt-aware reads. See
ADR-0002.

## WAL-consistent Backup and Restore

The source remained open in `journal_mode=wal`. `node:sqlite` exported
`backup(sourceDb, destinationPath)` restored:

```text
integrity_check: ok
foreign_key_violations: 0
restored_value: committed-in-wal
append_only_log_rows: 1
schema_version: 23
```

Decision: Phase 1 may use the Node online backup API, followed by integrity,
FK, manifest/hash, and schema compatibility checks. Copying a lone main DB file
is prohibited. The runtime API is still marked experimental by Node 22, so the
operator utility must fail clearly and remain covered by recovery tests.

## Legacy v0.2.3 Additive Accounts Rehearsal

The builder created one synthetic account/source/rule/correction/rule audit and
two transactions. Additive columns/backfill/index completed in one transaction.
After migration, counts remained:

```text
transactions: 2
classification_rules: 1
correction_log: 1
rule_change_log: 1
```

The account retained its legacy name and received `display_name`, TWD currency,
`credit_card` kind, `ai_inferred` authority, `needs_review`, and version 1.
Result: no rebuild required. See ADR-0003.

## Source-to-typed-payload Mapping

The four mappings under `test/fixtures/financial-data/source-mappings/` cover:

- bank transactions + ending balances + transfer/card-payment candidates;
- card transactions + statement + unbilled balance + installment plan;
- loan profile + principal snapshot + schedule + cash allocation;
- TWD/USD holdings + market/FX evidence + investment cash leg.

Each has input, canonical schema list/cross-references, and expected
commit/readiness behavior. Unknown references must abort the compound commit.

## Query Baseline

Synthetic rows: 100,000 transactions, 10,000 holdings, 10,000 quotes. Twenty
warm iterations on this environment produced:

```text
transaction summary p50 66.581 ms, p95 74.171 ms
investment positions p50 0.838 ms, p95 1.072 ms
```

Query plans used `benchmark_tx_month_account`,
`benchmark_holdings_account_date`, and `benchmark_quotes_instrument_date`;
transaction grouping also used a temporary B-tree. These values are an
architecture baseline, not a release performance claim. Phase 6 must rerun the
benchmark against final read-model queries and decide whether month/status
index order or pre-aggregation is required.
