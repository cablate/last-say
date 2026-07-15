# FX And Market Valuation Refresh

Use this runbook when refreshing foreign-currency, crypto, or other quoted
positions into the entity base currency. This updates valuation evidence only;
it must never rewrite native balances, holdings, cash activity, or P&L.

## Storage Semantics

- Store bank balances in `account_balance_snapshots.amount_minor` with the
  account's native `currency`. Do not create a second TWD balance snapshot.
- Store holding quantity and optional source-reported market value in
  `holding_snapshots`, also in the instrument quote currency.
- Store one dated provider price per instrument in `market_quotes`.
- Store FX orientation explicitly in `fx_quotes`: one `base_currency` equals
  `rate_decimal` units of `quote_currency`. For example, USD/TWD 32.215 means
  USD 1 = TWD 32.215. Never reverse or cross the rate silently.
- `investment_positions` derives `derived_value_minor` in quote currency and
  `base_value_minor` in entity base currency, returning holding/quote/FX
  watermarks. `account_balances` remains native-currency data; a combined
  balance sheet must convert it deterministically with the selected FX
  watermark rather than persisting a synthetic TWD bank balance.

## Daily Refresh Workflow

1. Run `health -> capabilities -> inventory -> readiness` for
   `investment_value` and, when producing total assets, `net_worth`. Record
   entity, base currency, valuation date, scope, blockers, and prior quote
   watermarks.
2. Discover required quote pairs from active non-base-currency accounts and
   latest holdings. Do not hard-code the currency universe. A source-reported
   aggregate portfolio value needs only FX refresh; do not replace it with an
   invented public market price.
3. Select one canonical valuation date and one quote set:
   - Fiat: prefer an official institution's same-day business-hours closing
     spot quote. If using midpoint, preserve raw buy, raw sell, and the stated
     arithmetic-midpoint method in evidence.
   - Crypto: use a named provider's official spot endpoint and record the exact
     retrieval timestamp. Preserve the native quote currency and convert
     through a separately sourced FX pair.
   - On a fiat-market holiday, keep the latest prior official FX quote. Do not
     relabel an old quote as current-day evidence.
4. Save immutable evidence under an ignored private path. Include provider,
   direct URL or endpoint, retrieval timestamp, market/as-of date, raw values,
   currency orientation, and valuation method. Register web-fetched evidence
   as `authority=ai_researched`, not `official`; `official` is reserved for a
   directly supplied institution artifact under the operator contract.
5. Write through `finance.ingestion-bundle/v1` using `sources`,
   `market_quotes`, and `fx_quotes`. Use decimal strings, preview then commit,
   and a deterministic idempotency key containing provider set, date, version,
   and environment. Never use direct SQLite writes.
6. Re-read inventory/readiness and request `investment_positions` through
   `POST /api/finance/analysis-context`. Require `valuation_status=current`,
   expected quote/FX dates, and complete watermarks for every supported
   non-base-currency holding.
7. For a balance-sheet snapshot, request `account_balances`,
   `debt_obligations`, `investment_positions`, and `net_worth_inventory`.
   Derive TWD bank values from native balances plus the selected FX quote.
   Report source facts, deterministic conversion, and interpretation as three
   separate layers. State stale dates, estimated liabilities, exclusions, and
   scope/readiness gaps.

## Scheduling Contract

- Default proposal: one refresh per day at 22:15 `Asia/Taipei`, after the Bank
  of Taiwan business-hours close and at a defined crypto observation time.
  The owner may choose a different cadence; do not create or change an
  automation without explicit authorization.
- The current schema records `as_of_date` but no intraday quote timestamp in
  quote identity/selection. Therefore do not create multiple canonical rows
  from the same provider on the same date. Re-running the job must return the
  same committed ingestion run and zero new rows.
- If a same-day quote is wrong, do not append a competing row and hope ordering
  selects it. Use the governed reversal/conflict path, then import a corrected
  version with traceable evidence.
- Keep quote freshness policy visible. The current investment valuation read
  model treats quotes older than seven days as stale by default.

## Acceptance Output

- A same-date retry returns the original committed ingestion run and creates no
  duplicate source, market quote, or FX quote rows.
- Every supported position is `current`, and non-base positions have complete
  holding, quote, and FX watermarks.
- Source hashes, database integrity, foreign keys, and a post-refresh sensitive
  backup are verified by the local operator when the task includes direct local
  database maintenance.
- The final report states valuation date, retrieval time, providers, rate
  method, assets covered, exclusions, stale inputs, and whether bank conversion
  was calculated outside the current read model.

## Stop Conditions

- Do not refresh more than once for the same provider and date with different
  payloads; the date-only selection model cannot represent a trustworthy
  intraday correction.
- Do not derive a public quote for an aggregate brokerage position from ticker
  guesses. Request a current brokerage snapshot instead.
- Do not produce a complete TWD total when any material native currency lacks a
  dated conversion path.
- Do not call the result a complete balance sheet when card payables, accrued
  interest, account scope, or other liability scope remains incomplete.
