# ADR-0002: Money, Decimal Arithmetic, and BigInt

- Status: Accepted
- Date: 2026-07-14
- Goals: DF-G1, DF-G5, DF-G10

## Context

Existing legacy transactions use SQLite `REAL`, but new balances, liabilities,
commitments, and valuations must not introduce binary floating-point loss.
Money and investment quantities have different representation needs.

## Decision

- New canonical money uses SQLite `INTEGER` minor units plus ISO currency.
- Runtime SQLite reads for domain arithmetic enable `StatementSync#setReadBigInts(true)`.
- API accepts/returns canonical integer strings where a value may exceed
  JavaScript's safe integer range. Conversion to `Number` is allowed only after
  an explicit safe-integer check.
- Quantity, unit price, APR, and FX use normalized decimal strings; SQLite
  `REAL` is forbidden for these new facts.
- Phase 4 will introduce `decimal.js` as the single decimal arithmetic owner.
  On 2026-07-14 npm reports version 10.6.0 and MIT license. It is runtime-only
  domain arithmetic, not a UI dependency.
- Every money-producing operation names the currency exponent and rounding
  mode. Default monetary multiplication/division rounds half-even at the final
  target currency minor unit; intermediate decimal operations retain configured
  precision and do not round through `Number`.
- Legacy `transactions.amount/inflow/outflow` are not mechanically migrated in
  this foundation. Compatibility adapters must validate safe conversion when
  interacting with new money types.

## Rejected Alternatives

- JavaScript `Number`/SQLite `REAL`: cannot preserve all 64-bit minor units or decimal rates.
- Ad-hoc scaled-BigInt parser: possible, but increases parsing, exponent,
  rounding, and property-test ownership without reducing product risk.
- Money as arbitrary decimal text: weakens integer minor-unit constraints.

## Evidence

`node scripts/fixtures/financial-data/run-phase0-spikes.mjs` round-tripped
`9007199254740993` as JavaScript `bigint` exactly on Node 22.19.0 / SQLite
3.50.4. See `docs/adr/spikes/phase0-blocking-spikes.md`.

## Follow-up Gate

Phase 4 must add canonical parser/formatter/property tests, audit the dependency,
and prove negative values, currency exponents, very large values, rounding ties,
and invalid decimal syntax. If `decimal.js` fails that gate, update this ADR
before selecting a replacement; do not fall back to `Number`.
