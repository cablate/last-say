# Financial Data Foundation: Phase 1-2 Operator Guide

Read this reference for account inventory, institution aliases, source evidence,
scope attestations, source expectations, balance snapshots, cash activity, and
structured ingestion. Credit-card statements/schedules, loans, investments,
valuations, and general analysis datasets are not available yet. Do not simulate
them with generic JSON or direct DB writes.

## Bootstrap

1. `GET /api/health`; stop on non-200 or `ok != true`.
2. `GET /api/finance/capabilities`; use its enums/schema IDs as authority.
3. `GET /api/finance/inventory`; then read the relevant readiness goal through
   `GET /api/finance/readiness?goal=spending_history|cash_position`.
4. Read `entities`, `institutions`, `accounts`, `sources`,
   `scope-attestations`, and `source-expectations` relevant to the task.
5. Separate known facts, identity conflicts, missing scope, and unsupported
   contexts before proposing writes.

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
Supported Phase 2 sections are `accounts`, `sources`, `balance_snapshots`, and
`cash_transactions`. Each item has a unique `client_item_key`; later sections
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

Official, running, and manually entered balances can coexist. Never overwrite a
source snapshot to make totals agree. Running balances must use
`authority=ai_inferred`, remain `needs_review`, and cannot alone complete cash
position. The UI is `/data`; it displays latest selection, actual date, source,
stale/missing/conflict state, and scope gaps.

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
- Need card statements/installments, loan/commitment, investment/valuation,
  reconciliation, or arbitrary analysis datasets: report that the current
  capability does not expose it yet.
- Options, futures, margin, DeFi, tax lots, or business consolidation: report
  `unsupported`; never store as `other` to claim complete support.
