---
schema_version: behavior-contract/v1
id: finance.transaction-ai-classification
title: Existing Transaction AI Classification
status: active
owner_surface: api
change_context:
  type: feature
  reason: Existing imported transactions need auditable AI classification without being mislabeled as human corrections.
  non_goals:
    - Change transaction amount, date, name, currency, account, source, or record status.
    - Auto-confirm low-confidence decisions.
    - Replace merchant rules, accounting mappings, transfer matching, or human review.
---

# Existing Transaction AI Classification Contract

## Change Context

The legacy transaction correction API records category edits as human evidence.
External AI therefore must not use it to classify already imported pending rows.
This contract adds a governed classification context to the existing compound
ingestion preview/commit path.

## Behavior Boundary

In scope:

- preview and atomically commit AI category proposals for existing active cash
  transactions;
- preserve AI confidence and a row-specific human-readable judgment reason;
- reject stale proposals and all human-owned/reviewed classifications;
- log before/after evidence and support the existing confirmed reversal flow.

Out of scope:

- importing new transactions;
- changing immutable source facts or `flow_type`;
- treating classification as transfer, card-payment, loan, or investment
  reconciliation;
- making a global completeness assertion.

## Consumers And Entrypoints

- `POST /api/finance/imports/preview` with
  `sections.transaction_classifications`;
- `POST /api/finance/imports/:runKey/commit`;
- `POST /api/finance/imports/:runKey/reverse-preview` and the existing
  human-confirmed reversal executor;
- `transactions` classification columns, `ingestion_runs`, `ingestion_items`,
  and append-only `data_change_log`;
- Last Say external AI operator Skill and transaction review UI.

## Inputs And State

Each item requires:

- `client_item_key`;
- canonical `transaction_key`;
- standard `category_primary`;
- optional `category_sub`;
- optional canonical `flow_type` when correcting the interpretation of a source row;
- `ai_confidence` from 0 through 1;
- non-empty, transaction-specific `judgment_reason`;
- exact `expected_updated_at` read before preview.

The bundle authority must be `ai_researched` or `ai_inferred`. The target must
be active, unreviewed, and not owned by `classification_source=human`.

## Outputs And Side Effects

Preview creates staging evidence only. Commit atomically updates only:

- `category_primary`;
- `category_sub`;
- optional `flow_type`;
- `ai_confidence`;
- `judgment_reason`;
- `classification_source=ai`;
- `rule_id=NULL` and `reviewed=0`.

Commit writes ingestion evidence and append-only before/after change evidence.
It does not write `correction_log`, because AI output is not a human correction.

## UI States

No new browser surface is introduced. Committed rows remain unreviewed and use
the existing AI/needs-review presentation according to confidence policy.

## Invariants

- AI must never become `classification_source=human` or create correction-log
  evidence.
- Human-owned or reviewed classifications are immutable to this context.
- Amount, date, name, account, source, currency, and record status remain
  byte-for-byte unchanged. `flow_type` changes only when explicitly supplied
  as one of the canonical interpretation values.
- A proposal whose `expected_updated_at` no longer matches fails atomically
  with `VERSION_CONFLICT`.
- Every committed item has non-empty reason and bounded confidence.
- Reversal restores the exact prior classification only when no later
  classification change exists; otherwise reversal preview reports a blocker.
- Same idempotency key and payload return the same run and create no duplicate
  classification event.

## Acceptance Examples

1. Given a pending bank transaction at update timestamp T, when an AI bundle is
   previewed, then the canonical row is unchanged; after commit it has the
   proposed category, confidence, reason, `classification_source=ai`, and
   `reviewed=0`.
2. Given a transaction reviewed by a human, when the same context is previewed,
   then it fails with `REVIEW_REQUIRED` and stages no run.
3. Given a preview created at T and a later classification edit at T+1, when
   commit runs, then the whole bundle fails with `VERSION_CONFLICT` and no item
   from that bundle changes.
4. Given a committed AI classification with no later edit, when its confirmed
   reversal executes, then the prior classification fields are restored and
   immutable transaction facts remain unchanged.
5. Given a bank transfer incorrectly interpreted as a card payment, an explicit
   canonical `flow_type` may correct reporting treatment while preserving all
   institution-exported facts and remaining unreviewed.

## Test Mapping

```yaml
test_mapping:
  unit:
    - test/transaction-ai-classification.test.js
  integration:
    - test/financial-ingestion.test.js
    - test/ingestion-reversal.test.js
  manual:
    - Preview and commit an ignored real-data bundle, then compare API aggregates and review queue without printing private rows.
```

## Evidence

Use focused test output, ingestion run status, aggregate classification counts,
`data_change_log` evidence, integrity/foreign-key checks, and a sensitive local
backup manifest for real-data maintenance.

## Intentional Changes

- `finance.ingestion-bundle/v1` gains the additive
  `transaction_classifications` context.
- Existing correction routes keep their human-authority behavior unchanged.

## Open Questions

- A later product phase may add UI review of staged AI classification bundles;
  this change keeps the current API-first operator workflow.
