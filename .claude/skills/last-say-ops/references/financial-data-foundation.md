# Financial Data Foundation: Phase 1-6 Operator Guide

Read this reference for account inventory, institution aliases, source evidence,
scope attestations, source expectations, balance snapshots, cash activity,
credit cards, loans, commitments, simple investments, quotes, FX, deterministic
valuation, structured ingestion, readiness policy, and governed analysis
contexts. Phase 5 also exposes manual valued items, typed reconciliation,
review tasks, source conflicts, and human-confirmed identity merge. Complex
investment contexts remain unsupported. Do not simulate any context with
generic JSON, arbitrary SQL, or direct DB writes.

## Bootstrap

1. `GET /api/health`; stop on non-200 or `ok != true`.
2. `GET /api/finance/capabilities`; use its enums/schema IDs as authority.
3. `GET /api/finance/inventory`; then read the relevant readiness goal through
   `GET /api/finance/readiness` for the task's supported goal.
4. Read `entities`, `institutions`, `accounts`, `sources`,
   `scope-attestations`, and `source-expectations` relevant to the task.
5. Separate known facts, identity conflicts, missing scope, and unsupported
   contexts before proposing writes.

## Analysis Preflight And Reporting

For every natural-language financial analysis request:

1. Read health and capabilities. Select one advertised readiness goal; do not
   invent a goal or silently substitute a nearby one.
2. Read readiness for the exact entity, optional account, and as-of date. Stop
   or qualify the answer when status is empty, partial, stale, conflicted,
   unreconciled, or unsupported.
3. Fetch only the minimum named datasets needed through
   `POST /api/finance/analysis-context`. The registry currently allows
   `cash_activity`, `account_balances`, `debt_obligations`,
   `investment_positions`, `valued_items`, `reconciliation`, and
   `net_worth_inventory`. Obey advertised filters, page limits, and response
   limits; never send SQL, table names, or column expressions.
4. Write the answer in three labeled layers: source-backed facts,
   deterministic derived values, and AI interpretation. Interpretation never
   becomes a canonical fact without a typed write and its required review.
5. Report goal, entity/account scope, as-of date, readiness status, datasets,
   policy version, source/resource watermarks, material gaps, and exclusions.
   Ask the human for the highest-priority missing typed evidence first.

An account-scoped complete result means only that account is ready; it never
proves global completeness. `liquidity_forecast_90d` can have complete
prerequisites while `forecast_available=false`. `tax_or_derivatives` and
complex investment analysis return unsupported and require a separate typed
context.

Every API error is shaped as:

```json
{"error":{"code":"VERSION_CONFLICT","message":"...","retryable":true}}
```

Never retry `IDENTITY_CONFLICT`, `HUMAN_CONFIRMATION_REQUIRED`, or
`UNSUPPORTED_CONTEXT` by changing facts silently.

## Typed Identity Writes

Create an account:

```json
POST /api/finance/accounts
{
  "display_name": "Everyday checking",
  "entity_key": "personal",
  "institution_key": "<stable key from institutions>",
  "account_kind": "bank",
  "currency": "TWD",
  "authority": "ai_inferred",
  "review_state": "needs_review"
}
```

AI-inferred account kind always remains `needs_review`. Two accounts may share
`display_name`; their stable keys and source aliases distinguish them. Never
merge based on display name. Add source identity through:

```json
POST /api/finance/accounts/:accountKey/aliases
{
  "source_system": "statement-parser-name",
  "alias_type": "source_account_id",
  "alias_value": "masked-or-provider-id",
  "authority": "institution_export",
  "review_state": "needs_review"
}
```

An alias already bound elsewhere returns `IDENTITY_CONFLICT`; stop for human
resolution. PATCH entity/institution/account/source/expectation with the entire
typed v1 body plus `expected_version`. On `VERSION_CONFLICT`, re-read the
resource and rebuild the proposal; never last-write-wins.

## Source Evidence

`POST /api/finance/sources` records metadata/fingerprint, not the statement
blob. Use a capabilities-supported `source_kind`, authority, period/as-of,
optional SHA-256, institution/account keys, and artifact status. Keep the real
file in ignored local paths. Do not send it to an arbitrary service or include
private rows in logs.

`official` means an institution statement/contract, not "AI found a web page".
Web evidence is `ai_researched` and must include an as-of/source note when the
later typed context supports it.

## Scope And Completeness

The existence of accounts or rows never proves all resources are known.
Attestations use these initial scope kinds:

- `cash_accounts`
- `credit_cards`
- `liabilities`
- `investments`
- `valued_items`

AI may create `unknown` or `declared_partial`. To propose
`declared_complete`, prepare the exact scope payload, then:

```json
POST /api/finance/human-confirmations
{
  "action_kind": "declare_scope_complete",
  "resource_type": "scope_attestation",
  "payload": {
    "entity_key": "personal",
    "scope_kind": "cash_accounts",
    "as_of_date": "2026-07-14",
    "coverage_state": "declared_complete",
    "authority": "user_confirmed",
    "included_note": "Human-readable inventory boundary"
  }
}
```

Report the proposal key and ask the user to inspect `/confirmations`. Stop.
Do not call browser-session/confirm routes or ask for the receipt. Confirmation
is payload-bound, expires after ten minutes, is one-time, and executes through
the browser flow. A new relevant account invalidates the earlier attestation.

Source expectations describe what data should recur and which analysis goals
it affects. AI-inferred expectations are hints. Only user-confirmed expectations
may later make a missing period a hard blocker.

## Structured Account, Balance, And Cash Ingestion

Use `finance.ingestion-bundle/v1`; retrieve current enums from capabilities.
Supported sections are `accounts`, `sources`, `balance_snapshots`,
`cash_transactions`, `transaction_classifications`, `credit_card_profiles`, `credit_card_statements`,
`credit_card_installments`, `credit_card_payment_matches`, `liabilities`,
`loan_schedules`, `loan_allocations`, `commitments`, `commitment_occurrences`,
`instruments`, `investment_trades`, `holding_snapshots`, `market_quotes`,
`fx_quotes`, and `investment_cash_matches`. Each item has a unique
`client_item_key`; later sections
may use `account_client_ref` or `source_client_ref` to reference items in the
same bundle. Money is an integer minor-unit JSON string plus currency.

1. `POST /api/finance/imports/preview` with an idempotency key, evidence
   authority, reason, optional calibrated AI confidence, and typed sections.
2. Inspect the returned contexts/actions/warnings. Preview writes staging only;
   it must not change accounts, balances, or transactions.
3. Resolve all identity conflicts and review requirements. If the payload
   changes, create a new preview and idempotency key.
4. `POST /api/finance/imports/:runKey/commit`. Commit is all-or-nothing. A retry
   of the same committed run returns its result; do not manufacture duplicates.
5. Re-read inventory and readiness. Report created resources, duplicates,
   conflicts, stale/missing evidence, and remaining scope gaps.

`transaction_classifications` is the only governed write path for AI judgment
on an existing transaction. Each item supplies `transaction_key`, a standard
`category_primary`, optional `category_sub`, optional canonical `flow_type`, calibrated `ai_confidence`, a
specific non-empty `judgment_reason`, and the exact `expected_updated_at` read
before preview. The bundle authority must be `ai_researched` or `ai_inferred`.
Commit changes interpretation fields only, keeps `reviewed=0`, records
`classification_source=ai`, and appends audit evidence without creating a
`correction_log` row. It fails closed on stale versions and must never replace
a human-owned or reviewed classification. Amount, date, name, currency,
account, source, and record status remain immutable. Do not use the legacy transaction
PATCH or batch correction routes for AI classifications.

Official, running, and manually entered balances can coexist. Never overwrite a
source snapshot to make totals agree. Running balances must use
`authority=ai_inferred`, remain `needs_review`, and cannot alone complete cash
position. The UI is `/data`; it displays latest selection, actual date, source,
stale/missing/conflict state, and scope gaps.

## Credit Cards, Loans, And Commitments

Start with inventory and `GET /api/finance/readiness?goal=debt_obligations`.
Create account identity before its profile. Direct human-maintenance routes are:

- `GET|POST /api/finance/credit-cards`, `GET|PATCH /api/finance/credit-cards/:key`;
- `POST /api/finance/credit-cards/statements|installments|payment-matches`;
- `GET|POST /api/finance/liabilities`, `GET /api/finance/liabilities/:key`;
- `POST /api/finance/liabilities/:key/schedule`, `POST /api/finance/liabilities/allocations`;
- `GET|POST /api/finance/commitments`, `GET|PATCH /api/finance/commitments/:key`;
- `POST /api/finance/commitments/:key/occurrences`.

For AI or compound source ingestion, use the shared preview/commit bundle. Use
client refs to connect account, source, transaction, profile, statement,
installment, liability, schedule, and occurrence sections. Commit is atomic.

Card statement items own closed charge/refund/fee/interest facts. Unbilled
transactions remain owned by the card account/profile and an unbilled balance
snapshot; never attach them to a closed statement. A bank-side card
payment is linked through `credit_card_payment_matches`; never classify it as a
second expense. Installment plans point to the one originating purchase. Their
entries are obligations and cannot create additional P&L expenses.

Loan profile APR is only a reported fact. A schedule requires `official` or
`user_confirmed` authority plus a source. Never calculate an authoritative
schedule or revolving interest from principal and APR. Payment allocations must
split principal, interest, and fee; a cash mismatch remains `unreconciled`.

Commitments cover confirmed fixed or ranged recurring cash items. Historical
patterns may only produce candidates. Editing a template never changes settled
occurrences. `liquidity_forecast_90d` exposes prerequisites only in Phase 3; do
not claim that a forecast exists.

## Investments, Quotes, FX, And Valuation

Start with `GET /api/finance/inventory` and
`GET /api/finance/readiness?goal=investment_value`. Create an investment account,
instrument identity, and source evidence before holdings or trades. Use
`/api/finance/investments/instruments|trades|holdings|quotes`,
`/api/finance/fx-quotes`, and `/api/finance/investments/cash-matches`, or include
their typed sections in one preview/commit bundle.

Quantity, price, and FX values are decimal strings, never JSON numbers. A market
or FX quote requires `source_key`, provider, currency pair, and `as_of_date`.
`fx_quotes` means one base currency equals `rate_decimal` quote currency. Do not
reverse or cross rates silently. Multiple providers remain separate source facts;
the deterministic valuation read model selects by date, authority, then stable
provider ordering and returns a holding/quote/FX watermark.

Source-reported market value and derived value are separate fields. Missing or
stale quote, currency mismatch, or missing FX keeps readiness partial/stale and
must not produce a base-currency total. Options, futures, margin, DeFi, tax lots,
and complex corporate actions are unsupported; never store them as
`quoted_asset` or `other_reviewed` to claim support.

## Manual Valuation And Reconciliation

Use `POST /api/finance/valued-items` for real estate, vehicles, collectibles,
private receivables, or private businesses, then add dated evidence through
`POST /api/finance/valued-items/:key/valuations`. Every snapshot requires a
source, currency, valuation method, authority, and as-of date. These are Tier 2
net-worth facts only; never create transactions, revenue, expenses, or cash flow
from a valuation change.

Read `GET /api/finance/reconciliation/summary` before claiming transfers or
settlements are reconciled. Internal transfers use
`POST /api/finance/reconciliation/transfers`; card, loan, and investment cash
legs keep their existing typed match owners. Missing counterpart transactions
remain one-sided and `unreconciled`. AI-researched matches below 0.8 cannot be
confirmed; leave them proposed for review.

`GET /api/finance/review-tasks?status=open` is the unified work queue. Source
conflicts are created and resolved through `/api/finance/source-conflicts`; a
resolution must select one candidate source and include a human-readable note.
Resolving the conflict closes the linked task with the selected source evidence.
Do not close a task merely to improve readiness.

For duplicate institution, account, or instrument identity:

1. `POST /api/finance/identity-merges/preview` with resource type, old key, and
   retained key.
2. Stop when `can_merge=false`; report every collision and do not edit facts.
3. Submit the exact preview as a human-confirmation payload with the matching
   `merge_*` action, `resource_type=identity_merge`, old key, and source version.
4. Tell the user to inspect `/confirmations`; never confirm it yourself.
5. After browser execution, resolve the old key through `identity-redirects`,
   then re-read inventory/readiness. The executor explicitly rebinds every
   registered FK, archives the old identity, and preserves audit evidence.

For an incorrect committed run:

1. `POST /api/finance/imports/:runKey/reverse-preview`.
2. Stop if `reversible=false`; human evidence or facts outside the run require
   manual resolution.
3. Create a high-risk proposal with
   `action_kind=reverse_ingestion_run`, `resource_type=ingestion_run`, the run
   key, and exact `{reason,impact_hash}` payload.
4. Tell the user to inspect `/confirmations`; do not confirm it yourself.
5. After human execution, re-read the run, inventory, and readiness. Reversal
   preserves source/audit rows and marks typed facts reversed; it is not delete.

## Backup Boundary

Backup/restore has no HTTP or AI route. A human local operator can use explicit
paths while the service is appropriately stopped:

```text
node scripts/finance-backup.mjs --db <explicit-db> --output <ignored-dir> [--include-sources]
node scripts/finance-restore.mjs --input <manifest> --target <new-db-path>
```

Restore never overwrites an existing target. DB-only backup explicitly omits
source artifacts. Bundles are sensitive and not encrypted by Last Say.

## Current Stop Conditions

- No account/source identity: create or resolve typed identity first.
- Alias collision: stop at `IDENTITY_CONFLICT`.
- Complete-scope proposal: hand off to `/confirmations`.
- Need an unregistered analysis dataset, arbitrary SQL, or complex investment
  context: report `unsupported` and request or design a separate typed context.
- Missing official card statement, loan principal snapshot, or loan schedule:
  report the exact readiness gap; never fill it with an AI estimate.
- Options, futures, margin, DeFi, tax lots, or business consolidation: report
  `unsupported`; never store as `other` to claim complete support.
