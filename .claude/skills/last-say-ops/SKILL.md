---
name: last-say-ops
description: "Operate Last Say as the external AI: process bank statements, classify and import monthly ledgers, create or repair classification rules, use web search for ambiguous merchants, learn from correction_log, and report aggregate QA. Use for monthly statement imports, rule evolution, low-confidence review support, Phase 3-style validation, and Last Say operations."
---

# Last Say Ops

This directory is the complete operator contract. An AI must be able to operate Last Say by reading this `SKILL.md` and the routed files under `references/`; do not require project files outside this skill for normal data operations.

## Operating Model

Last Say is not an AI app. It stores data, exposes local REST APIs, and provides the review UI. The external AI operator reads statements, classifies rows, builds rules, imports ledgers, studies correction history, and reports QA.

Use the tool in two loops:

- Flow A: new monthly statement import.
- Flow B: learn from user corrections in `correction_log`.

Before operating on statements or rules, read the required references below. `AGENTS.md` is only for code modification work and is not part of this operating contract.

## Hard Rules

- Do not generate ledger CSVs by script for a real AI first run; inspect statement rows yourself.
- Do not print or commit private financial details unless the user explicitly asks.
- Do not commit `data/`, `uploads/`, `outputs/`, root statement CSVs, screenshots, logs, or `AUDIT-*.md`.
- Every AI-classified transaction needs a non-empty human-readable `judgment_reason`.
- Every created rule needs a non-empty `note`.
- Do not create rules with `confidence < 0.6`.
- Before web search or classifying an uncovered merchant, retrieve learning context from the API.
- Never use unreviewed AI classifications as learning evidence.
- Similarity is retrieval relevance, not classification confidence.
- Do not edit `correction_log`; treat it as append-only evidence.
- Before changing classification semantics, disabling, or deleting a rule, read that rule's `linked_rows`, `unreviewed_rows`, and `reviewed_rows`; never bypass reclassification with direct DB edits.
- After a rule mutation, verify the returned `impact` and re-read the rule plus needs-review queue. A 2xx response alone is not completion.
- Do not store merchant dictionaries in this skill. Merchant facts belong in Last Say rules and notes.
- Use aggregate DB/API checks for acceptance whenever possible.

## Reference Routing

Read only the files needed for the current task:

- `references/bank-quirks.md`: bank statement format behavior that DB rules cannot learn.
- `references/search-playbook.md`: web search tactics and confidence calibration support.
- `references/learning-loop.md`: mandatory retrieval order, evidence weighting, alias rules, and Flow B closure.
- `references/lessons.md`: operating failures, QA habits, and user reporting preferences.
- `references/api-contract.md`: local API routes, payloads, data invariants, and report write paths.
- `references/category-guide.md`: complete category boundaries and confidence policy.
- `references/monthly-workflow.md`: executable Flow A and Flow B checklists, ledger schema, and acceptance output.
- `references/operator-contract.md`: role, privacy, source handling, and completion contract.

## Self-Update Protocol

Update only workflow-level experience in this skill:

- parsing quirks;
- search tactics;
- QA failures;
- user reporting preferences;
- operational lessons.

Do not add private transaction details or merchant classification dictionaries. Store merchant/category facts in `classification_rules.note`, transaction `judgment_reason`, and `correction_log` through the app APIs.
