---
name: last-say-ops
description: "Operate Last Say as the external AI: process bank statements, classify and import monthly ledgers, create or repair classification rules, refresh dated FX and market quotes for TWD valuation, use web search for ambiguous merchants, learn from correction_log, and report aggregate QA. Use for monthly statement imports, exchange-rate or crypto-price refreshes, TWD net-worth valuation, rule evolution, low-confidence review support, Phase 3-style validation, and Last Say operations."
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
- Classify existing transactions through the ingestion bundle's `transaction_classifications` section. Never use the human PATCH/batch routes for AI judgment, because those routes create human-owned evidence.
- Similarity is retrieval relevance, not classification confidence.
- Do not edit `correction_log`; treat it as append-only evidence.
- Before changing classification semantics, disabling, or deleting a rule, read that rule's `linked_rows`, `unreviewed_rows`, and `reviewed_rows`; never bypass reclassification with direct DB edits.
- After a rule mutation, verify the returned `impact` and re-read the rule plus needs-review queue. A 2xx response alone is not completion.
- Do not store merchant dictionaries in this skill. Merchant facts belong in Last Say rules and notes.
- Use aggregate DB/API checks for acceptance whenever possible.
- For account, source, scope, or other financial-data work, start with `GET /api/finance/capabilities`; never guess an enum or field.
- Before answering any financial-analysis question, run `health -> capabilities -> readiness` for the requested goal and scope. Do not fetch datasets or interpret values until readiness status, blockers, as-of date, and scope are known.
- Fetch analysis evidence only through the named datasets advertised by capabilities and `POST /api/finance/analysis-context`. Never request SQL, table names, column expressions, or an unregistered dataset.
- For financial-health, exposure, debt-capacity, or stress questions, after preflight prefer the advertised `analysis_read_models.financial_health_review` route. Give AI the compact Context Pack first; use raw named datasets only for drillback or a stated gap investigation, and never recompute its totals with a second ad hoc calculation.
- Treat `finance.proposal-envelope/v1` in candidate datasets as a bounded hint: verify its resource keys and current versions, then use the named typed owner route. Never submit the hint itself as authority, a commit payload, or human confirmation.
- Keep analysis output in three explicit layers: sourced facts, deterministic derived values, and AI interpretation. Never present an interpretation as a stored or reconciled fact.
- Every analysis response must state goal, entity/account scope, as-of date, readiness status, datasets used, source/resource watermarks, material gaps, and exclusions. Ask for the highest-priority missing typed evidence before suggesting lower-impact cleanup.
- Before importing account, balance, or cash activity facts, read `GET /api/finance/inventory` and the relevant readiness goal. Report existing identity, coverage, conflicts, and gaps before proposing writes.
- Structured financial writes must use preview then commit. Inspect normalized actions and warnings; never skip preview or treat staging rows as canonical facts.
- Credit-card payments are settlement matches, not a second expense. Installment entries are future obligations, not repeated merchant purchases.
- Replace current/unbilled card evidence with a posted statement through `finance.card-transaction-lifecycle/v1`. Require unique strong identity, explicit authorization release, and a committable preview; never import the posted rows again as unrelated cash transactions.
- Never derive an official loan schedule, revolving-card interest, or future payment amount from APR, principal, or historical averages. Store only sourced facts; leave readiness partial when official evidence is missing.
- Before changing a commitment template, inspect settled occurrences. Template edits must not rewrite settled history.
- Investment quantities, prices, and FX rates must be canonical decimal strings. Every quote needs typed source evidence and an as-of date; never reuse a quote as timeless.
- Keep native-currency balances and holding quantities unchanged during valuation refreshes. Store new dated FX/market evidence and derive TWD values; never replace a USD, JPY, BTC, or USDT fact with a TWD balance.
- The current quote schema is date-grained. Create at most one canonical provider quote per instrument or currency pair per date, and make same-date retries idempotent; do not treat repeated intraday fetches as newer facts.
- Never invent FX to complete a base-currency total. Options, futures, margin, DeFi, and tax lots require a separate context and must not be stored as ordinary quoted assets.
- Manual property or private-asset values are Tier 2 snapshots: require method, date, currency, and source evidence, and never turn them into cash-flow or P&L facts.
- Reconcile transfers and settlements through their typed match routes. A one-sided or low-confidence match stays queued; never force it confirmed to make totals agree.
- Identity merges require a fresh typed impact preview and browser confirmation. Never reuse an old impact hash, merge a collided identity, or bypass the redirect/audit path.
- After commit, re-read inventory/readiness. For a wrong committed run, use reverse-preview and prepare a `reverse_ingestion_run` confirmation; never hard-delete or patch source facts into disappearance.
- Never use arbitrary SQL, direct SQLite writes, generic field patches, server-side URL fetch, or hard deletion of source facts.
- A database row count does not prove that all accounts, liabilities, or investments are known. Only report global completeness when the relevant scope attestation and runtime readiness permit it.
- `actor_type=human` is not human confirmation. Prepare high-risk proposals, then stop for the user's `/confirmations` action; never forge, request, print, or replay a confirmation receipt.

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
- `references/financial-data-foundation.md`: financial inventory/readiness, governed analysis context, account/balance/cash ingestion, typed payloads, reversal, scope rules, confirmation, backup boundary, and current limitations.
- `references/fx-and-market-valuation-refresh.md`: executable daily FX/crypto quote refresh, evidence capture, TWD conversion semantics, idempotency, same-day limits, validation, and scheduling guidance.
- `references/analysis-recipes.md`: executable recipes for fixed/variable spend, work/personal/reimbursement, descriptive income floor, installment audit, unresolved transfers, and three-statement readiness.
- `references/analysis-prompt-template.md`: reusable analysis prompt skeleton、read-model selection與facts／derived／interpretation answer boundary。
- `references/analysis-recipes.md`: also contains the FC-2 obligation timeline and FC-3 raw cash forecast recipes。
- `docs/contracts/financial-health-review-contract.md`: FA-0 deterministic financial-health Context Pack, explicit exposure assumptions, stress boundaries, and AI handoff.

## Error Recovery

- `VERSION_CONFLICT`: re-read the current resource, preserve the human's newer values, and rebuild the proposal with its new `expected_version`. Never use last-write-wins.
- `IDENTITY_CONFLICT`: stop and report both typed identities and aliases. Do not merge by display name.
- `HUMAN_CONFIRMATION_REQUIRED`: prepare the exact proposal, tell the user to inspect `/confirmations`, and stop. Never confirm as AI or forge a receipt.
- `UNSUPPORTED_CONTEXT`: name the unsupported boundary and the separate typed context required. Do not coerce it into an available schema.
- Failed preview or commit: report the run key, item/section error, and canonical write count. Change the payload only through a new preview.
- A complete result only means the requested goal, scope, and as-of date satisfy the current readiness policy. It never proves the user's whole financial picture is complete.

## A6 Completion Self-Check

Before declaring any financial-data or analysis task complete, answer all six:

1. **Preflight:** Did I run health, capabilities, inventory, and goal/scope/as-of readiness before analysis or writes?
2. **Evidence:** Did I separate source-backed facts, deterministic derived values, and interpretation, with source/resource watermarks?
3. **Write safety:** For a bank import or compound update, did I use preview then commit and re-read readiness afterward?
4. **Gap honesty:** Did I report the highest-priority gap and request typed evidence instead of inventing missing facts? For `cash_flow_statement`, did I verify cash boundaries and reconciliation?
5. **Domain limits:** Did I avoid deriving a loan schedule from APR, timeless investment quotes, invented FX, generic records, and arbitrary SQL?
6. **Human authority:** Did I preserve human decisions, surface review/version conflicts, and stop at browser confirmation for high-risk actions?

The final report must state scope, as-of date, readiness, datasets/actions used, watermarks, remaining gaps, exclusions, and the exact human next step.

## Self-Update Protocol

Update only workflow-level experience in this skill:

- parsing quirks;
- search tactics;
- QA failures;
- user reporting preferences;
- operational lessons.

Do not add private transaction details or merchant classification dictionaries. Store merchant/category facts in `classification_rules.note`, transaction `judgment_reason`, and `correction_log` through the app APIs.
