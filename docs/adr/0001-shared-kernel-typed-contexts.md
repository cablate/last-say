# ADR-0001: Shared Kernel + Typed Bounded Contexts

- Status: Accepted
- Date: 2026-07-14
- Goals: DF-G1, DF-G2, DF-G7, DF-G10, DF-G11

## Context

Last Say needs accounts, balances, credit cards, loans, commitments,
investments, valuations, reconciliation, and readiness. They share identity,
source, money, authority, review, version, and audit semantics, but their facts
have different lifecycles and constraints.

## Decision

Use **Shared Kernel + Typed Bounded Contexts + Read Models**.

The Shared Kernel is limited to reporting entity, institution, account,
source/evidence, money/currency/date, authority/review/status, scope,
expectation, version, and audit contracts. Canonical facts live in named typed
contexts. Cross-context reports and analysis use named read models/datasets.

Reject:

- `financial_records(type, json)` and EAV canonical storage;
- one universal `financial_events` or postings table as the foundation;
- a generic CRUD endpoint accepting table/field names;
- polymorphic relationship tables without typed foreign-key ownership.

When a proposed field needs context-specific lifecycle, authority, arithmetic,
or reconciliation, it belongs to that context. When a context cannot safely
represent a product, capabilities/readiness return `unsupported`; a separate
spec is required before storage or analysis.

## Consequences

- Some metadata and service patterns repeat across contexts; correctness and
  explicit ownership take priority over premature abstraction.
- Adding a context requires typed schema/API/merge/reversal/readiness/Skill
  coverage. It cannot use generic JSON to bypass those gates.
- Reports may consume facts but may not recreate account, balance, liability,
  investment, or source facts.

## Verification

- Contracts: `docs/contracts/financial-data-*-contract.md` and typed storage contracts.
- Unsupported derivative fixture must fail rather than map to `other`.
