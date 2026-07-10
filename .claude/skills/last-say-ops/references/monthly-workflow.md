# Monthly Workflow

## Flow A: Process A New Statement

1. Preflight: call health, meta, rules, and `GET /api/learning/context`. Record target statement month, account, official/provisional source status, sign convention, row count, latest correction id, and uncovered correction candidates. If new corrections exist, close Flow B before importing the next month.
2. Read the statement row by row in source order. Preserve original text, dates, amounts, posting information, and account identity. Do not use a script to fabricate AI judgment.
3. Normalize every merchant through `/api/rules/normalize`; check existing rules by normalized key, source type, and direction.
4. Batch uncovered distinct merchants through `POST /api/learning/context`. Read `learning-loop.md`, apply its evidence order and confidence ceiling, and reuse the response for duplicate rows. Only web-search when history is missing, weak, conflicting, or does not establish merchant identity.
5. For uncovered rows, choose a standard category and subcategory, assign calibrated confidence, and write one human-readable judgment reason that identifies the controlling evidence path.
6. Create one reusable exact or alias merchant rule per justified distinct match only when confidence is at least 0.6. Every rule needs a note citing identity/evidence, prior match key or correction id when applicable, and source context. Never build a rule from conflicting history.
7. Produce ledger CSV in an ignored directory with this exact header:

```csv
來源類型,來源說明,日期,月份,名稱,金額,流入,流出,帳戶餘額,帳戶原始排序,原始交易資訊,這筆是什麼,分類,子類別,信心度,判斷理由,備註
```

Every column must have a value; use an empty string rather than omitting a field. Dates are `YYYY-MM-DD`, months are `YYYY-MM`, and money uses the importer's signed amount plus explicit inflow/outflow interpretation.

8. Import through `/api/import-ledger`. Record inserted, deduplicated, linked, and `stats.rules_applied` results.
9. Verify DB/API aggregates: source row count, classification-source counts, missing and distinct reasons, rules missing notes, rules below 0.6, low-confidence count, learning-context conflicts, and report coverage.
10. Stop after the month checkpoint and send the user to `/transactions?month=YYYY-MM&view=needs-review&sort=confidence&direction=asc`. Do not continue to the next month unless requested or the agreed workflow says to continue.

## Flow B: Learn From Human Corrections

1. Read `GET /api/learning/context`, `/api/corrections?limit=1000`, and current rules. Record `latest_correction_id`.
2. Start from uncovered correction candidates and weak rules, then retrieve merchant context for each candidate.
3. Distinguish one-off personal intent from repeated merchant/category evidence. Treat `consensus.conflict=true` as unresolved, not as a majority-vote rule.
4. Before adjusting, disabling, or deleting a rule, read `GET /api/rules/:id` and record linked, unreviewed, and reviewed history counts.
5. Create or adjust an exact rule only with sufficient repeated or authoritative evidence; use `origin=human_correction` and cite correction ids, match keys, identity evidence, source, and direction in `note`.
6. Verify every mutation's `impact`; then re-read the rule and needs-review queue. Disabled rules must have zero current links. Use `POST /api/rules/:id/reclassify` only to clean legacy links that predate this contract.
7. Re-read the learning overview and confirm newly handled candidates are covered. Never edit or delete correction evidence. Report watermark, created, changed, disabled, skipped, conflicts, and historical rows reclassified or returned to review.

## Completion Report

Report files processed, rows imported, duplicates/provisional rows, new rules, skipped low-confidence rules, `rules_applied`, low-confidence rows, rule-mutation impact if any, report mappings/snapshots if any, missing accounts/snapshots, unmatched transfers, coverage impact, and the exact UI queue for the human.
