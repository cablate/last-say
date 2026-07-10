# Reporting Operator Contract

> Status: planning contract.
> Scope: how an external AI operator and human reviewer prepare data for
> management reports.

## Purpose

Last Say does not run server-side LLM calls. An external AI operator may
read user-provided files, reason about statements, use web search when needed,
and write structured data through local APIs. The tool stores facts, review
state, rules, mappings, snapshots, and correction evidence.

## User Inputs The AI May Receive

- Credit-card statements.
- Current unbilled card transaction exports.
- Bank account statements.
- Brokerage, loan, e-wallet, or payment-platform exports.
- Account list and masked numbers.
- Statement ending balances.
- User notes about business/personal/entity boundaries.
- Known transfer explanations.
- Prior correction logs and rule performance summaries.

The operator must inspect formats before transforming. It must not blindly run a
generic parser that skips judgment, confidence, and reason fields.

## Operator Preflight

Before writes:

1. Read the project playbook.
2. Call local health/meta/rules endpoints.
3. Identify target entity, period, source type, account, and whether each file is
   official or provisional.
4. Confirm that real-data outputs stay under ignored paths.
5. Preserve original source text, dates, amounts, and account identifiers.

## Source Understanding

For each file, the operator must identify:

- statement period;
- transaction date and posting date if both exist;
- debit/credit sign convention;
- account identity and masked number;
- beginning/ending balance if present;
- payment rows;
- internal transfers;
- fees, interest, refunds, and reversals;
- rows that are not transactions.

## Transaction Classification

For current bookkeeping:

- classify user-facing category;
- use calibrated confidence;
- provide one human-readable reason per AI-classified row;
- create merchant rules only when evidence is strong enough;
- include rule notes with source/evidence;
- route low-confidence rows to review.

## Report Metadata Preparation

For management reports:

- propose entity;
- propose account kind and report role;
- extract balance snapshots with source note;
- propose report-line mapping separate from merchant category;
- propose cash-flow class;
- propose transfer candidates;
- flag low-confidence mappings instead of forcing complete reports.

## Write Path

Current write path:

- import normalized ledger rows through import API;
- create merchant classification rules through rules API;
- rely on transaction review API for human corrections.

Future write path:

- save account metadata;
- save balance snapshots;
- save transaction report mappings;
- save report mapping rules;
- save transfer candidates and confirmed matches;
- save manual adjustments only after accrual phase exists.

## Human Review Loop

The user reviews:

- low-confidence transactions;
- unmapped report lines;
- inferred account metadata;
- missing/stale balance snapshots;
- transfer candidates;
- reconciliation blockers.

After review:

- correction evidence remains append-only;
- merchant corrections improve merchant classification rules;
- report mapping corrections improve report mapping rules;
- transfer confirmations improve future matching hints.

## Required Evidence Fields

Any AI-proposed report metadata must carry:

- confidence;
- reason;
- source reference or note;
- whether web search was used;
- whether the result is safe for rule creation;
- whether human review is required.

## Prohibited Behavior

- Do not mutate imported amount, date, source, or raw text to make reports tie
  out.
- Do not create rules for confidence below the configured threshold.
- Do not infer a complete balance sheet from transaction rows alone.
- Do not silently auto-confirm low-score transfer matches.
- Do not store merchant facts in a skill file when they belong in DB rules.
- Do not commit real financial data, screenshots, outputs, or ignored internal
  audit docs.

## Handoff Summary

After each processing batch, the operator must report:

- files processed;
- rows imported;
- duplicate/provisional rows;
- new rules and skipped low-confidence rules;
- low-confidence transactions;
- mappings created;
- snapshots extracted;
- missing accounts/snapshots;
- unmatched transfers;
- report coverage impact;
- exact UI queue the user should review next.

## Acceptance Examples

1. Official credit-card statement plus current unbilled export:
   - official rows imported as final;
   - current rows imported or flagged as provisional if supported;
   - duplicates skipped;
   - card charges mapped to P&L expenses;
   - card payments excluded from P&L.

2. Bank statement with ending balance:
   - transactions imported;
   - ending balance snapshot saved with source note;
   - internal transfer candidates proposed;
   - cash flow coverage updates.

3. Brokerage transfer:
   - bank cash outflow detected;
   - if brokerage cash/investment detail is missing, cash flow is partial;
   - do not classify purchase as ordinary expense.
