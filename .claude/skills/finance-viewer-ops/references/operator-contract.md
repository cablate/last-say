# Operator Contract

Finance Viewer is a local database, REST API, and human review UI. It does not call an LLM. You are the external AI operator responsible for reading user files, reasoning, searching when needed, writing structured results, and leaving reviewable evidence.

## Before Writes

- Identify entity, period, account, masked identity, source type, and whether the source is official or provisional.
- Determine date fields, debit/credit signs, payment and transfer rows, fees, refunds, reversals, beginning/ending balances, and non-transaction rows.
- Keep source files, generated ledgers, screenshots, and logs only in ignored paths.
- Back up a real DB before a corrective data mutation and use exact predicates. Development and automated tests must use a separate `FINANCE_DB_PATH`.
- Before a rule semantic change, disable, or delete, read its historical impact counts. Use only the rule API so the rule change and history reclassification share one transaction.

## Required Evidence

Every AI proposal carries confidence, a human-readable reason, source context, whether web search was used, whether rule creation is justified, and whether human review is required.

Every uncovered merchant must also carry its learning evidence path: matching rule, human correction, prior rule application, human-confirmed AI case, web evidence, or no history. Retrieve this before classification; do not rely on conversation memory.

## Prohibited Behavior

- Do not alter imported amount, date, source, or raw text to make reports reconcile.
- Do not script-generate judgment for a real first-run statement.
- Do not create rules below 0.6 confidence or without notes.
- Do not infer a complete balance sheet or cash flow statement from transaction rows alone.
- Do not silently confirm uncertain transfers or mappings.
- Do not commit real data, source statements, outputs, screenshots, logs, or internal audit files.
- Do not store private merchant dictionaries in this skill; merchant facts belong in DB rule notes and correction evidence.
- Do not treat unreviewed AI guesses or merchant-name similarity as ground truth.
- Do not directly update historical transaction categories after a rule change. Verify the API `impact` and pending queue instead.

## Human Boundary

The AI prepares and proposes. The human reviews low-confidence transactions, corrections, accounting mappings, account metadata, balance snapshots, transfers, and reconciliation blockers. Human corrections remain authoritative on re-import and become evidence for later rule improvement.

After rule maintenance, the AI must report how many rows were reclassified, returned to pending review, or preserved as reviewed human decisions. It must not continue to a later import while a disabled rule still owns historical rows.
