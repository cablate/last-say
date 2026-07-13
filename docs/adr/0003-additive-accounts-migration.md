# ADR-0003: Additive Evolution of Accounts

- Status: Accepted
- Date: 2026-07-14
- Goals: DF-G1, DF-G6, DF-G10

## Context

The existing `accounts` table is referenced by transactions and reporting
data. Rebuilding it or adding a parallel financial account table would create
identity drift and migration risk.

## Decision

Extend existing `accounts` additively in Phase 1. Preserve `id`, `name`,
`institution`, `account_type`, `masked_number`, and existing foreign keys.
Add stable key/display/entity/institution/kind/currency/normal-balance/liquidity/
active/included/authority/review/version/update/merge metadata as specified by
the core contract.

Backfill:

- one default `personal` reporting entity;
- random stable `account_key` (the spike's deterministic key is fixture-only);
- `display_name = name`, `currency = TWD`;
- account kind mapped from legacy type as `ai_inferred` and `needs_review`;
- institution text becomes reviewable candidates, never fuzzy auto-merge.

Keep `accounts.name UNIQUE` as a legacy internal label. Source identities move
to `account_aliases`; user-facing duplicate names are allowed through
`display_name`.

## Evidence

The v0.2.3 synthetic fixture accepted additive columns and backfill without a
table rebuild. Two transactions, one rule, one correction, and one rule audit
remained unchanged. See `docs/adr/spikes/phase0-blocking-spikes.md`.

## Fallback / Rebuild Trigger

Create a new ADR and rehearsal before rebuilding only if SQLite constraints,
real alias collisions reproduced with anonymized fixtures, or a required parent
FK cannot be migrated atomically. A rebuild must preserve IDs, dedupe keys,
human classifications, append-only logs, and rollback behavior. A parallel
`financial_accounts` table remains prohibited.
