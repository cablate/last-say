# API Contract

Base URL: `http://127.0.0.1:3127`. All responses are JSON. Start every run with `GET /api/health`, `GET /api/meta`, `GET /api/rules`, and `GET /api/learning/context`.

## Read Routes

- `GET /api/meta`: database path, counts, available months, sources, categories, and global `needsReview`.
- `GET /api/transactions?month=&view=&search=&sort=&direction=&limit=&offset=`: transaction list. Use `view=needs-review&sort=confidence&direction=asc` for human review.
- `GET /api/transactions/:id`: one transaction and its source context.
- `GET /api/corrections?limit=1000`: append-only human correction evidence and grouped summaries.
- `GET /api/learning/context`: correction watermark, correction candidates, weak rules, and monthly rule application rates for Flow B preflight.
- `GET /api/learning/context?name=&sourceType=&direction=&limit=`: one merchant's matching rule, ranked historical evidence, category consensus, conflicts, and confidence ceiling.
- `POST /api/learning/context` with `{items:[{name,sourceType,direction}]}`: batch merchant evidence lookup, maximum 200 items. This route is read-only.
- `GET /api/rules?enabled=&maxConfidence=&origin=&q=`: merchant classification rules and performance.
- `GET /api/rules/:id`: one rule plus `linked_rows`, `unreviewed_rows`, and `reviewed_rows`; required before a semantic rule mutation.
- `GET /api/rules/normalize?text=`: canonical `match_key`; never normalize independently.
- `GET /api/reports/income-statement?month=`: management P&L, coverage, blockers, and drilldown IDs.

## Write Routes

- `POST /api/import-ledger` with `{ "csvPath": "outputs/file.csv" }` or `{ "csvContent": "..." }`. Paths are restricted to `uploads/`, `data/`, and `outputs/`. Record returned `stats.rules_applied`.
- `POST /api/rules` with `{match_key, source_type, direction, category_value, confidence, origin, note}`. At least one match condition is required; `note` is required; never create below 0.6 confidence.
- `PATCH /api/rules/:id`: update a rule. Changes to `match_key`, `source_type`, `direction`, `category_value`, or `enabled` atomically reclassify currently linked history. Changes to note, confidence, origin, or sample count do not.
- `DELETE /api/rules/:id`: delete a rule and atomically reclassify currently linked history.
- `POST /api/rules/:id/reclassify`: clean legacy links without changing the rule. Use when a disabled rule still reports `linked_rows > 0`.
- `PATCH /api/transactions/:id` with only `category_primary` and/or `memo`. Amount, date, source, and name are immutable imported facts.
- `POST /api/transactions/batch` with `{corrections:[{id, category_primary?, memo?}]}`.
- `POST /api/transactions/review` with `{ids:[...]}` to confirm classifications without changing facts.
- `POST /api/reports/mappings`: explicit per-transaction report mapping.
- `POST /api/reports/mapping-rules`: reusable accounting mapping rule; keep separate from merchant classification rules.

## Invariants

- Money is stored as integer cents.
- `correction_log` is append-only.
- `rule_change_log` is append-only. System reclassification is recorded there, never as a human correction.
- Re-import must not overwrite `classification_source=human` decisions.
- Rule mutation responses include `impact: {linked_rows, reclassified_rows, pending_rows, preserved_reviewed_rows}`. Verify it against the pre-mutation counts and re-read `/api/transactions?view=needs-review`.
- Unreviewed linked rows use the full enabled-rule priority after a semantic mutation. No replacement means `classification_source=pending`; reviewed rows keep their category and become `classification_source=human`.
- `classification_rules` learn merchant categories; reporting mappings learn accounting lines. Do not mix them.
- Deterministic exclusions such as credit-card payments, internal transfers, loan principal, and investment purchases cannot be turned into P&L expenses by an ordinary mapping rule.
- Balance sheet and cash flow remain incomplete until account metadata, snapshots, and transfer matching exist. Never invent those numbers.
- Learning context is evidence retrieval, not automatic classification. Never copy `similarity` into ledger confidence. `consensus.conflict=true` caps confidence below `0.6` and forbids rule creation until new evidence resolves it.
