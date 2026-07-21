# Impact Review Workbench Contract

> Status: frozen implementation contract (`finance.review-workbench/v1`).
> Scope: MP-04 minimal human review experience.
> Upstream owners: `ai-analysis-context-and-proposal-contract.md`,
> `financial-data-operator-contract.md`, typed reconciliation/obligation owners,
> and browser-bound human confirmation routes.

## Purpose

The review workbench is the small human-authority surface between AI proposals
and canonical financial state. It presents only decisions that require a person,
with enough evidence and impact context to confirm, reject, or make a small
correction without rebuilding the source data.

It is not a CRUD administration console and it does not own financial semantics.

## Behavior Change Identity

- **Before:** `/confirmations` lists pending scope confirmations only. Open
  `review_tasks`, source conflicts, owner-unresolved cash rows, transfer matches,
  reimbursement matches, and provisional commitments are distributed across
  unrelated APIs or screens.
- **After:** one read model groups pending items into `human_confirmations`,
  `actionable_reviews`, `owner_unresolved`, and `conflicts`. Every actionable
  item names its canonical owner, evidence, impact, missing information,
  available actions, current version, and recovery behavior.
- **Public contract:** additive `GET /api/finance/review-workbench`; existing
  mutation routes remain authoritative and unchanged.
- **Optional scope:** `?month=YYYY-MM` limits the `owner_unresolved` transaction
  section to that transaction month. Without it, the projection remains global.
  Human confirmations and typed review tasks retain their own evidence scope;
  the response exposes this distinction in `scope.note`.

## Authority and Ownership Invariants

1. The workbench is a projection. It never becomes a second store for accounts,
   transactions, matches, obligations, sources, or proposals.
2. A generic `review_tasks` status update must not stand in for a typed resource
   mutation. Transfer, reimbursement, commitment, and source-conflict decisions
   go through their existing typed routes, which close the review task in the
   same transaction.
3. Browser-bound human confirmations still require a fresh same-origin browser
   nonce and a single-use receipt. The workbench cannot manufacture, cache, or
   replay that authority.
4. `owner_unresolved` means visible but not currently actionable. It remains in
   cash reconciliation and coverage; the UI must not coerce it into a guessed
   category or reusable rule.
5. Source amounts, currencies, dates, account identities, and evidence are
   display-only here. Small transaction corrections continue to use the existing
   transaction edit/audit path.
6. A stale version, expired confirmation, missing source, or changed resource
   fails closed and causes a full workbench refresh.
7. `GET /api/finance/review-workbench` and confirmation list reads are
   side-effect free. Expiry is evaluated at query time for projection/filtering;
   only an explicit browser confirmation attempt may persist an expired state.

## Read Model

```json
{
  "contract": "finance.review-workbench/v1",
  "generated_at": "2026-07-16T00:00:00.000Z",
  "scope": {
    "month": "2026-06",
    "kind": "transaction_month",
    "note": "目前只列出 2026-06 的待釐清交易；確認提案與 typed review 仍依其自身證據範圍顯示。"
  },
  "counts": {
    "human_confirmations": 1,
    "actionable_reviews": 2,
    "owner_unresolved": 3,
    "conflicts": 1,
    "total_attention": 7
  },
  "sections": {
    "human_confirmations": [],
    "actionable_reviews": [],
    "owner_unresolved": [],
    "conflicts": []
  },
  "partial_errors": []
}
```

Each review item uses this minimum shape:

```json
{
  "item_key": "stable key",
  "item_kind": "transfer_match | reimbursement_match | commitment_candidate | source_conflict | owner_unresolved_transaction | scope_confirmation",
  "task_key": "optional review task key",
  "resource": {
    "type": "canonical owner type",
    "key": "canonical resource key",
    "version": 1,
    "status": "proposed"
  },
  "title": "human-readable decision",
  "reason": "why review is required",
  "evidence": [],
  "impact": {
    "financial": [],
    "timelines": ["economic", "cash", "obligation"]
  },
  "missing_evidence": [],
  "before": {},
  "after_preview": {},
  "actions": [],
  "recovery": {
    "on_stale": "refresh",
    "reversible": true
  }
}
```

The server may omit empty optional values, but it must not replace an unknown
amount or effect with zero. `counts` are calculated from the returned sections,
not from a separate client-side estimate.

## Supported Decisions

| Item | Confirm | Reject | Small correction | Canonical mutation owner |
|---|---|---|---|---|
| Scope confirmation | Yes, browser receipt | No mutation; allow expiry/refresh | No | human confirmation route |
| Transfer proposal | Set `confirmed` with `expected_version` | Set `rejected` with `expected_version` | Resolution note only | transfer match PATCH |
| Reimbursement proposal | Set `confirmed` with `expected_version` | Set `rejected` with `expected_version` | Resolution note only | reimbursement match PATCH |
| Commitment candidate | Promote to confirmed/scheduled owner state | Cancel/reject candidate | Existing typed commitment fields | commitment PATCH |
| Source conflict | Select one supplied source and provide a note | Defer; do not invent a third source | Selection/note only | source-conflict resolve POST |
| Owner-unresolved row | No guessed confirmation | No destructive dismissal | Link to existing transaction correction | transaction edit/audit path |

## UI State Contract

- **First paint/loading:** stable labelled skeleton; no false empty state.
- **Ready:** sections and counts agree; evidence and reason are visible at list
  level; details may expand for full provenance.
- **Empty:** explicitly says there are no human decisions, not that the financial
  dataset is complete.
- **Partial load:** usable sections remain visible and `partial_errors` identify
  failed sources with retry.
- **Mutation pending:** disable only the affected item and announce progress.
- **Stale/expired/conflict:** show the server reason, keep no optimistic canonical
  state, refresh the full projection, and preserve the user's note locally when
  practical.
- **Success:** remove the resolved item only after the typed endpoint succeeds;
  then refresh counts from the server.

Buttons and expandable controls must be keyboard reachable, have visible focus,
and expose action plus target in their accessible name. Status changes use an
ARIA live region or an equivalent toast plus persistent state update.

## Compatibility and Failure Semantics

- Existing `/api/finance/human-confirmations`, `/review-tasks`, typed mutation,
  and reconciliation routes remain public and compatible.
- An unsupported task kind remains visible as a blocker with no unsafe action.
- A source conflict must carry a human-readable `reason`; an optional
  `impact_note` explains which readiness/report conclusion remains blocked.
  The workbench projects both fields and never asks the owner to choose between
  two opaque source labels.
- If one resource hydration fails, return the remaining sections and a typed
  `partial_errors` entry; a database/contract failure that invalidates all counts
  returns the normal finance error response.
- No tracked test fixture, screenshot, or log may contain real financial rows.

## Verification Contract

1. Query/API fixture covers every section and proves counts equal section sizes.
2. Transfer and reimbursement confirm/reject use versioned typed owners and close
   their corresponding review tasks.
3. Commitment and source-conflict actions cannot be replaced by generic task
   resolution.
4. Owner-unresolved rows remain non-actionable and visible.
5. Component tests cover loading, empty, ready, partial error, mutation failure,
   stale refresh, and keyboard-accessible controls.
6. Browser evidence covers one successful typed review and one expired/stale
   recovery path without a real database.

## Update Rule

Update this contract whenever review sections, typed mutation ownership, human
confirmation authority, or public action behavior changes. Cosmetic changes that
do not affect decisions or evidence do not require a contract revision. Last
validated against repository: 2026-07-16.
