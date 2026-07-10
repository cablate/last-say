# Learning Loop

Finance Viewer does not retrain an AI model. Durable AI-side learning is retrieval-augmented reasoning: persist human evidence in the database, retrieve it before classification, and make the external AI cite that evidence when it decides.

## Evidence Retrieval Order

Use this order for every uncovered or ambiguous merchant:

1. Enabled matching rule returned by `GET /api/learning/context?name=...`.
2. Human corrections from `correction_log` surfaced as `human_correction` cases.
3. Prior rule applications surfaced as `rule_application` cases, checked against override counts.
4. AI classifications that a human explicitly reviewed, surfaced as `human_confirmed` cases.
5. Web search from authoritative or merchant-owned sources.
6. A low-confidence best judgment left for human review.

Unreviewed AI classifications are excluded from the learning API. Never recreate them as evidence through another query.

## Required Calls

At the start of Flow A or Flow B:

```text
GET /api/learning/context
```

This returns the latest correction watermark, uncovered correction candidates, weak rules, and monthly rule rates.

After exact rule lookup, batch all uncovered distinct merchants:

```json
POST /api/learning/context
{
  "items": [
    { "name": "statement merchant text", "sourceType": "source", "direction": "out" }
  ]
}
```

Use at most 200 items per request. Reuse one response for duplicate merchant rows in the same statement.

## Reading A Merchant Context

- `matched_rule`: importer-authoritative rule that already covers the row.
- `similar_cases`: ranked evidence. `similarity` is only retrieval relevance, never classification confidence.
- `evidence_type`: `human_correction` is strongest, then `rule_application`, then `human_confirmed`.
- `consensus.suggested_category`: evidence summary, not an automatic decision.
- `consensus.conflict`: competing category history. Investigate rather than voting blindly.
- `consensus.confidence_ceiling`: maximum confidence justified by retrieved history alone.
- `should_web_search`: history is missing, weak, or conflicting.
- `may_create_alias_rule`: history may justify a new exact rule for this new match key after identity is checked.

## Confidence And Rule Decisions

- Never exceed `confidence_ceiling` unless new authoritative web evidence resolves the gap, and explain that evidence.
- When `conflict=true`, keep confidence below `0.6`, do not create a rule, and leave the row for human review.
- One similar human correction can justify a provisional category, but verify merchant identity before making a reusable alias rule.
- Multiple consistent human corrections can justify a stronger alias rule when source type and direction also fit.
- A matched rule with high override rate is not automatically trustworthy. Inspect its note, correction candidates, and weak-rule metrics.
- Create alias rules for the new exact `match_key`; do not broaden or change `normalizeForRule` to force unrelated names together.
- Every created or updated rule note must cite the evidence type, prior match key or correction id, source context, and merchant identity conclusion.

## Judgment Reason Contract

Every AI-classified ledger row must say which evidence path controlled the decision. Examples:

- `過去人工修正將相似商家 OPENAI *CHATGPT 歸為訂閱服務；本次名稱為同一服務的完整寫法。`
- `相似案例分成飲食與購物，websearch 無法確認實際品項，暫歸購物並留低信心待審。`
- `既有規則 #18 已覆蓋相同 match_key、來源與方向；匯入時交由規則套用。`

Do not use generic reasons such as `依歷史判斷` or copy the same sentence across unrelated merchants.

## Flow B Closure

1. Read the overview and note `latest_correction_id`.
2. Review uncovered `correction_candidates` and `weak_rules`.
3. For each candidate, retrieve merchant context and inspect all category conflicts.
4. Before updating, disabling, or deleting an existing rule, call `GET /api/rules/:id`. Record its linked, unreviewed, and reviewed counts and explain the intended historical effect.
5. Create or update only evidence-supported exact rules with `origin=human_correction` and a cited note. Never repair a rule by writing `classification_rules` or `transactions` directly.
6. For every semantic mutation, inspect the returned `impact`. Confirm that replacement-rule rows, pending rows, and preserved reviewed rows reconcile to the pre-mutation linked count.
7. Re-read the mutated rule and `/api/transactions?view=needs-review`. A disabled rule must have zero current links; if legacy data remains, call `POST /api/rules/:id/reclassify` and verify again.
8. Re-read the overview. Covered candidates should show `covered_by_rule=true`; unresolved conflicts remain explicitly skipped.
9. Report correction watermark, rules created/updated/disabled, historical impact, conflicts skipped, weak rules inspected, and the next month that may benefit.

The next monthly import must run Flow B first when new corrections exist. Otherwise the human feedback loop has not been closed.
