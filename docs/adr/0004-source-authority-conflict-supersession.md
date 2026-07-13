# ADR-0004: Source Authority, Conflict, and Supersession

- Status: Accepted
- Date: 2026-07-14
- Goals: DF-G2, DF-G6, DF-G9

## Context

Financial sources can disagree without either being globally wrong. Authority
depends on semantic key, as-of, scope, and source type. Last-write-wins would
erase evidence and make AI/human review untraceable.

## Decision

Default authority precedence is:

1. human-confirmed correction;
2. official institution statement/contract;
3. institution export/provider quote;
4. user-supplied manual snapshot;
5. AI-researched evidence;
6. AI-inferred candidate;
7. statistical estimate.

This ordering selects a candidate only after semantic key, kind, currency,
scope, and as-of are comparable. It never authorizes overwrite.

- Persist conflicting candidates with their source, authority, review state,
  version, and difference.
- Read models return the effective candidate, selection policy/reason, and all
  unresolved conflicts.
- A material same-semantic-key disagreement blocks relevant readiness.
- Human selection appends change evidence; rejected evidence remains queryable.
- Correction creates a new fact/selection or typed supersession. It does not
  mutate imported source facts.
- Committed source mistakes use typed reversal; prior facts become
  reversed/superseded but source/audit/human evidence remain.
- Lower authority cannot supersede confirmed human evidence. Ambiguous identity
  or human-evidence ownership fails closed.

## Consequences

Queries need explicit effective-selection helpers and provenance. Storage is
larger than last-write-wins, but auditability and readiness remain truthful.

## Verification

- `canonical/additional-contexts.json` freezes a conflicting balance case.
- Phase 2+ tests must cover equal authority, lower-vs-human authority,
  supersession chains, reversal, and no orphaned review tasks.
