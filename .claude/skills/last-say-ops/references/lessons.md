# Lessons

This file stores operating lessons for Last Say AI runs. It should not contain private transaction details or merchant classification facts.

## Phase 3 Redo Lesson

Do not use scripts to generate ledger CSVs for a "real AI first run" acceptance test.

The prior failed attempt generated monthly ledgers in bulk, which made the database look populated but destroyed the intended validation:

- Judgment reasons became templated or missing.
- Rule notes were missing.
- Confidence values were absent or uncalibrated.
- Rules were not actually applied during import.
- The system did not prove that rule compounding works month by month.

The corrected workflow requires the operator to read each statement month in order, classify uncovered rows manually, use web search where needed, write one human-readable reason per row, create only justified rules, and record `stats.rules_applied` after each import.

## Acceptance Style

Use DB aggregates for acceptance checks and avoid printing private transaction details in chat.

Useful aggregate checks:

- Count transactions by `statement_month`.
- Count `classification_source`.
- Count missing `judgment_reason`.
- Count distinct `judgment_reason`.
- Count rules with missing `note`.
- Count rules with `confidence < 0.6`.
- Sum rule `applied_count`.
- Count `correction_log`.

## Reporting Preference

Report checkpoints honestly:

- One completed month is a checkpoint, not full Phase 3 completion.
- If P10 or another incident is not reproduced, say it remains open.
- If a dev server or DB lock changes the verification path, state the deviation and what remained true.

## UI Review Loop

After one month passes quality gates, prefer user UI review before importing all remaining months. Human corrections create `correction_log`, which gives workflow B real evidence for rule improvement before the next month.
