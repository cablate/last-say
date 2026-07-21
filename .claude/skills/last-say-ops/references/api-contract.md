# API Contract

Base URL: `http://127.0.0.1:3127`. All responses are JSON. Start ledger/rule runs with `GET /api/health`, `GET /api/meta`, `GET /api/rules`, and `GET /api/learning/context`. Start financial inventory/source work with `GET /api/health` and `GET /api/finance/capabilities`.

## Read Routes

- `GET /api/finance/control/financial-health?as_of_date=&entity_id=&currency=&taiwan_instrument_keys=&taiwan_leverage_factor=`: FA-0 query-time financial position／liquidity／debt／investment-factor／stress Context Pack. Use explicit instrument keys and factor assumptions; missing assumptions remain `null` with coverage warnings. It is read-only, does not call AI, and does not persist a report snapshot. Use this compact read model for financial-health decisions; only fetch raw named datasets for drillback or a clearly stated missing-data investigation.
- `GET /api/health`: `{ok, transactions, corrections, schema_version}`. Stop if it is not HTTP 200 or `ok` is not true; HTTP 503 means the database could not be initialized or read safely.
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
- `GET /api/reports/income-statement?month=&entity_id=&currency=&basis=card_accrual_management`: management P&L, coverage, blockers, source watermark, and drilldown IDs. Other bases fail closed until their recognition semantics exist.
- `GET /api/reports/balance-sheet?as_of_date=&entity_id=&currency=`: management assets, liabilities, derived net worth, valuation/snapshot watermarks, obligations drillback, and coverage.
- `GET /api/reports/cash-flow?month=&entity_id=&currency=` or explicit `period_start`/`period_end`: direct-method operating/investing/financing cash, internal-transfer elimination, unresolved cash, boundary snapshots, reconciliation delta, drillback, and coverage.
- `GET /api/finance/control/monthly-pulse?month=&entity_id=&currency=`: query-time composition of management P&L, direct cash movement, typed card／loan／investment／reimbursement movements, proposed reimbursement candidates, coverage, deterministic source watermark, and drillback. It is read-only, does not call AI, and does not persist a report snapshot.
- `GET /api/finance/control/spending-structure?month=YYYY-MM&entity_id=&currency=&basis=card_accrual_management`: FC-A3 query-time expense lines, confirmed commitments, confirmed reimbursement recovery, proposed reimbursement disclosure, coverage and drillback. It is read-only and does not decide essentiality, work reimbursement, or savings.
- `GET /api/finance/control/obligations?as_of_date=&entity_id=&currency=&horizon_days=90`: FC-2 query-time 7／30／90-day obligation windows for card statements／installments, loan schedule entries, and confirmed commitments. Exact amounts, ranges, unknowns, blockers, source facts and event keys remain separate; it is not a cash forecast or safe-to-spend result.
- `GET /api/finance/control/forecast?as_of_date=&entity_id=&currency=&horizon_days=90`: FC-3 query-time raw cash path from current trusted liquid-cash snapshots plus FC-2 events. Missing/stale/conflicted opening cash fails closed; reserve, reliable income and `safe_to_spend` remain unavailable.
- For all three report routes, the compatibility parameter is named `entity_id` but its value is the stable entity key (for example `personal`), not the numeric SQLite row id.
- `GET /api/finance/review-workbench`: side-effect-free additive human-review projection grouped into browser confirmations, actionable typed reviews, owner-unresolved cash, and source conflicts. Counts are calculated from returned sections; expired confirmation status is evaluated at read time without cleanup writes.
- `GET /api/finance/capabilities`: authoritative API/schema versions, enums, limits, readiness goals, and unsupported contexts.
- `GET /api/finance/inventory?entity=&as_of=`: inventory v2 with institutions, accounts, scope attestations, expectations, aggregate source coverage, review counts, Tier 1/Tier 2 net-worth inventory, policy/source watermarks, and all readiness goals. It intentionally excludes source filenames and descriptions.
- `GET /api/finance/readiness?goal=&entity=&as_of=&account=`: deterministic policy result with requirements, satisfied requirements, prioritized gaps, impact, effort hint, next actions, conflicts, freshness, scope, and source watermark. Account scope is available only for goals advertised as scoped. The 90-day goal reports prerequisite readiness while `forecast_available=false`; `tax_or_derivatives` is explicitly unsupported.
- `POST /api/finance/analysis-context`: read-only named dataset batch. Request `{entity?,as_of?,datasets:[{name,...allowed_filters}]}`. Allowed names are advertised by capabilities and include core facts plus `transfer_candidates`, `reimbursement_candidates`, `recurring_candidates`, `installment_anomalies`, `statement_blockers`, `spending_structure`, and `financial_dashboard_history`. The history dataset returns six completed months of deterministic revenue, expense, net-result, and cash-change facts with per-metric sample counts, so an AI does not need raw transactions for a baseline comparison. Candidate rows carry `finance.proposal-envelope/v1` owner/action/evidence/impact/missing-evidence hints; these are not canonical mutation payloads or human confirmation. Limits are dataset-specific; arbitrary SQL/table/column expressions fail closed. Responses include policy, source, and resource watermarks and exclude source filenames, raw payloads, and content hashes.
- `GET /api/finance/imports/:runKey`: preview/commit/reversal run evidence; staged sensitive payload is not returned.
- `GET /api/finance/balance-snapshots?account=`: active typed balance facts; add `history=1` for reversed/superseded audit drilldown.
- `GET /api/finance/entities`, `/institutions`, `/accounts`, `/sources`, `/scope-attestations`, `/source-expectations`: typed financial foundation inventory. Resource detail routes use the stable key.
- `GET /api/finance/credit-cards`, `/liabilities`, `/commitments`: typed obligations, evidence ownership, schedules, payment matches, and occurrences.
- `GET /api/finance/investments/instruments|holdings`: instrument inventory and deterministic positions with quote/FX watermark.
- `GET /api/finance/valued-items`, `/reconciliation/summary`, `/review-tasks`, `/source-conflicts`: Tier 2 values and the cross-context review/reconciliation queue.
- `GET /api/finance/identity-redirects?type=&key=`: resolve a merged institution, account, or instrument key.
- `GET /api/finance/human-confirmations?status=pending`: high-risk proposals. AI may inspect status but may not call the browser confirmation route.

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
- Typed CRUD: `POST /api/finance/entities|institutions|accounts|sources|scope-attestations|source-expectations|balance-snapshots`; `PATCH` resource detail routes with `expected_version`; add aliases through `/institutions/:key/aliases` or `/accounts/:key/aliases`.
- `POST /api/finance/imports/preview`: validate and stage an atomic `finance.ingestion-bundle/v1`; no canonical writes.
- `POST /api/finance/imports/:runKey/commit`: atomically write all supported sections and purge staged payload.
- The same preview/commit routes accept `finance.card-transaction-lifecycle/v1` for current/unbilled-to-posted replacement. Supply one existing or new official posted source, exact signed row totals, occurrence ordinals, current source keys to supersede, and explicit release transaction keys. Commit is blocked by ambiguous matches or any unresolved provisional row in the superseded boundary.
- Existing-transaction AI judgment uses the bundle's `transaction_classifications` section with `transaction_key`, standard category, optional canonical flow type, confidence, specific reason, and `expected_updated_at`; authority is `ai_researched` or `ai_inferred`.
- Obligations writes: `POST /api/finance/credit-cards`, `/credit-cards/statements`, `/credit-cards/installments`, `/credit-cards/payment-matches`, `/liabilities`, `/liabilities/:key/schedule`, `/liabilities/allocations`, `/commitments`, and `/commitments/:key/occurrences`. Profile/template updates use stable-key `PATCH` plus `expected_version`.
- Investment writes: `POST /api/finance/investments/instruments|trades|holdings|quotes`, `PATCH /api/finance/investments/instruments/:key` with `expected_version` for metadata correction, `/api/finance/fx-quotes`, and `/api/finance/investments/cash-matches`. Decimal facts are strings; quote source/as-of are mandatory.
- Phase 5 writes: `POST /api/finance/valued-items`, `/valued-items/:key/valuations`, `/reconciliation/transfers`, `/source-conflicts`, and `/source-conflicts/:key/resolve`. A new source conflict requires a specific human-readable `reason`; use optional `impact_note` to identify the report/readiness conclusion it blocks. Do not create a conflict when selecting one source cannot repair a transformation error.
- Typed review decisions must use their canonical owner: transfer and reimbursement proposals use versioned PATCH on their match route; commitment candidates use the versioned commitment PATCH; source conflicts use `/source-conflicts/:key/resolve`. `PATCH /api/finance/review-tasks/:key` must never replace those state changes and will reject typed-owner tasks.
- Merge preview is `POST /api/finance/identity-merges/preview`. A merge proposal uses the exact preview as payload, `resource_type=identity_merge`, the matching `merge_institution|merge_account|merge_instrument` action, and source version; only `/confirmations` may execute it.
- `POST /api/finance/imports/:runKey/reverse-preview`: read-only impact and blocker check. A reversible result supplies the exact `impact_hash` for a human-confirmed reversal proposal.
- `POST /api/finance/human-confirmations`: prepare a registry-approved high-risk proposal. For `declare_scope_complete`, submit `{action_kind:"declare_scope_complete",resource_type:"scope_attestation",payload:<exact scope payload>}` and tell the user to review `/confirmations`. Do not call `/browser-session` or `/:key/confirm` as AI.

## Invariants

- Money is stored as integer cents.
- `correction_log` is append-only.
- `rule_change_log` is append-only. System reclassification is recorded there, never as a human correction.
- Re-import must not overwrite `classification_source=human` decisions.
- AI classification changes classification fields only, remains unreviewed, writes `classification_source=ai`, creates no human correction evidence, and fails closed if the row was reviewed or changed after it was read.
- Rule mutation responses include `impact: {linked_rows, reclassified_rows, pending_rows, preserved_reviewed_rows}`. Verify it against the pre-mutation counts and re-read `/api/transactions?view=needs-review`.
- Unreviewed linked rows use the full enabled-rule priority after a semantic mutation. No replacement means `classification_source=pending`; reviewed rows keep their category and become `classification_source=human`.
- `classification_rules` learn merchant categories; reporting mappings learn accounting lines. Do not mix them.
- Deterministic exclusions such as credit-card payments, internal transfers, loan principal, and investment purchases cannot be turned into P&L expenses by an ordinary mapping rule.
- Credit-card payment matches settle statements; installment entries do not create new expenses. Loan schedules require official or user-confirmed evidence, and AI must never infer them from APR.
- A liability may be created without `start_date` when principal/rate/payment evidence exists but the exact start is unknown. The read model returns `start_date=null`, and readiness remains partial with `missing_loan_start_date`; estimated principal also keeps `loan_principal_needs_review` visible.
- Derived investment totals require a complete holding/quote/FX watermark. Missing FX never yields a base-currency total; complex derivatives cannot be disguised as ordinary instruments.
- Balance sheet and cash flow are implemented but may return partial／empty／unreconciled coverage until account metadata, snapshots, valuations, and matching exist. Never invent missing numbers or describe a partial report as complete.
- Cash flow is explicitly currency-scoped: only included cash accounts in the requested currency form its boundary and movement scope. Request foreign currencies separately unless a future contract adds governed consolidated FX cash-flow semantics.
- Learning context is evidence retrieval, not automatic classification. Never copy `similarity` into ledger confidence. `consensus.conflict=true` caps confidence below `0.6` and forbids rule creation until new evidence resolves it.
- Finance API errors use `{error:{code,message,field?,allowed_values?,retryable}}`; handle `IDENTITY_CONFLICT`, `VERSION_CONFLICT`, `HUMAN_CONFIRMATION_REQUIRED`, and `UNSUPPORTED_CONTEXT` explicitly.
- New financial money facts use integer minor units and currency; quantity/price/FX use canonical decimal strings. Legacy transaction endpoints retain their established compatibility representation.
- Active summaries/P&L/readiness exclude `reversed`, `superseded`, and `archived`; history/review drilldown may still show them.
