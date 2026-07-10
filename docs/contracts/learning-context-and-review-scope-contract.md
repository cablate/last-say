---
schema_version: behavior-contract/v1
id: finance.learning-context-and-review-scope
title: AI 經驗檢索與待審範圍一致性
status: active
owner_surface: shared
change_context:
  type: feature
  reason: 外部 AI 必須在分類前取得過去修正與相似案例，且 UI 必須以目前月份顯示同一個待審數量。
  non_goals:
    - 不在 Finance Viewer 伺服器內呼叫 LLM。
    - 不改變既有 match_key 正規化演算法或規則命中語意。
    - 不自動把相似案例寫成規則或覆寫交易分類。
    - 不新增或遷移資料庫 schema。
---

# AI 經驗檢索與待審範圍一致性

## Behavior Boundary

本次新增唯讀的 AI 經驗檢索 API，讓外部 AI 在分類前取得現有規則、人工修正、人工確認與相似商家案例。相似度只負責找證據，不直接分類或寫入資料。

本次也統一全域提示列與交易待審列表的月份範圍；使用者完成一筆審查後，提示列與列表必須更新，不可繼續顯示舊的全庫數量。

## Consumers And Entrypoints

- `GET /api/learning/context`
- `GET /api/learning/context?name=&sourceType=&direction=&limit=`
- `POST /api/learning/context` with `{ items: [...] }`
- `.claude/skills/finance-viewer-ops/`
- `/transactions?month=YYYY-MM&view=needs-review`
- `components/AIBanner.jsx`
- `components/TransactionTable.jsx`
- `correction_log`, `classification_rules`, `transactions` read paths

## Inputs And State

- Merchant context requires a non-empty `name`.
- Optional `sourceType` and `direction` improve evidence ranking; direction accepts only `in` or `out`.
- Batch requests accept at most 200 items.
- Only human corrections, rule applications, and reviewed AI classifications may become learning evidence. Unreviewed AI guesses must not train later AI decisions.
- Existing data remains authoritative; no learning API call writes DB state.

## Outputs And Side Effects

- Overview returns correction/rule counts, recent monthly rule application rates, correction candidates, and weak rule performance signals.
- Merchant context returns the canonical match key, the currently matching rule, ranked historical cases, category consensus, conflict status, and an evidence-based confidence ceiling.
- Similarity score is retrieval metadata, not classification confidence.
- API errors are JSON with 400 for invalid input and 500 for unexpected failures.
- UI review mutations emit a local data-change signal so the visible banner refetches its scoped count.

## UI States

- Loading: the existing page remains stable; the AI banner does not display a fabricated count.
- Ready with pending items: banner names the active month when one is selected and shows that month's count.
- Ready with zero pending items: banner disappears; the transaction queue displays a completion-specific empty state.
- Error: the transaction list keeps its existing inline error and retry behavior; a banner count failure must not block the page.
- Mobile and desktop use the same scoped count and completion wording.

## Invariants

- Finance Viewer does not call an LLM.
- `correction_log` remains append-only.
- `normalizeForRule` remains unchanged.
- Similar historical cases never mutate transactions or rules.
- Human classifications are never overwritten by import or retrieval.
- A conflicting evidence set caps suggested confidence below the rule-creation threshold of 0.6.
- The count shown beside a month-filtered review queue uses the same month and review predicate as the queue.

## Acceptance Examples

1. Given a reviewed human correction for `OPENAI *CHATGPT SUBSCR`, when an AI requests context for `OPENAI CHATGPT SUBSCRIPTION`, then the response includes that prior case as similar evidence and does not create a rule.
2. Given similar reviewed cases split across two categories, when context is requested, then `conflict` is true and `confidence_ceiling` is below 0.6.
3. Given 34 pending rows globally and 5 in 2026/06, when `/transactions?month=2026-06&view=needs-review` is open, then the banner and queue both show 5, not 34.
4. Given the last pending row is confirmed, when the mutation succeeds, then the row is removed, the scoped banner disappears, and the empty state says the selected queue is complete.

## Test Mapping

- Unit: `test/learning-context.test.js`
- Regression: `test/query-month-all.test.js`, `test/reviewed-on-correction.test.js`
- Full: `npm test`, `npm run verify:release`
- Browser: production server on the existing local port, desktop and 390px review queue
- Skill: `quick_validate.py` plus a forward eval using only the skill directory

## Evidence

- Baseline DB: 696 transactions, 34 global needs-review rows, 5 needs-review rows in 2026/06.
- Baseline browser: the 2026/06 queue displayed 5 rows while the banner and queue status displayed 34.

## Intentional Changes

- The banner changes from a global count to an active-month count on month-scoped pages.
- External AI instructions change from exact-key-only history lookup to deterministic retrieval before web search and classification.

## Open Questions

- A future version may persist explicit merchant entities and aliases after retrieval quality is validated across multiple banks. This change deliberately does not add that schema yet.
