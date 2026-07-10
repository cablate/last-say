---
schema_version: behavior-contract/v1
id: finance.rule-history-reclassification
title: 分類規則變更與歷史交易重新校正
status: active
owner_surface: shared
change_context:
  type: bugfix
  reason: 規則修改、停用或刪除後，已套用交易仍保留舊分類且不會回到待審，會持續污染分類統計與報表。
  non_goals:
    - 不修改金額、日期、來源、名稱或原始交易資訊。
    - 不改變 normalizeForRule 或規則優先序。
    - 不覆寫 classification_source=human 的人工分類。
    - 不讓伺服器自行呼叫 LLM 或替 pending 交易猜新分類。
    - 不在本次程式變更中直接清理真實資料庫的特定規則。
---

# 分類規則變更與歷史交易重新校正

## Behavior Boundary

規則的比對條件、分類結果或啟用狀態改變，以及規則被刪除時，系統必須重新評估目前仍由該規則負責的歷史交易。規則備註、信心度、來源或樣本數等非分類語意欄位改變時，不重算歷史交易。

重新評估只處理 `classification_source='rule' AND rule_id=:id` 的交易。已確認交易保留現有分類並轉成人工權威；未確認交易重新跑完整的啟用規則優先序，找不到替代規則時轉為 `pending`。

## Consumers And Entrypoints

- `GET /api/rules`、`GET /api/rules/:id`
- `PATCH /api/rules/:id`
- `DELETE /api/rules/:id`
- `POST /api/rules/:id/reclassify`
- `lib/queries/rules.js`
- `components/RulesManager.jsx`
- `classification_rules`、`transactions`、`rule_change_log`
- `.claude/skills/finance-viewer-ops/`
- `/transactions?view=needs-review` 與報表統計讀取端

## Inputs And State

- PATCH 仍接受既有規則部分欄位；伺服器以舊值合併後完整驗證。
- 刪除、停用與分類語意更新預設一律重算目前連結的歷史交易，不提供靜默跳過參數。
- 已停用但仍有舊版歷史連結的規則，可顯式要求重新校正；此操作不會重新啟用或修改規則。
- 現有影響統計包含 `linked_rows`、`unreviewed_rows`、`reviewed_rows`。
- 規則匹配使用交易名稱的 canonical `match_key`、來源與流向，並呼叫既有 `getMatchingRule`。

## Outputs And Side Effects

- 規則清單與明細回傳目前連結、未確認、已確認交易數。
- PATCH 回傳 `{ ok, rule, impact }`。
- DELETE 回傳 `{ ok, impact }`。
- POST reclassify 回傳 `{ ok, rule, impact }`。
- `impact` 至少包含 `linked_rows`、`reclassified_rows`、`pending_rows`、`preserved_reviewed_rows`。
- 未確認交易命中替代規則時更新 `category_primary`、`rule_id`、`classification_source='rule'`，並保持 `reviewed=0`。
- 未確認交易沒有規則可命中時保留目前分類作為暫存提案，但改成 `classification_source='pending'`、`rule_id=NULL`、`reviewed=0`。
- 已確認規則交易保留分類，改成 `classification_source='human'`、`rule_id=NULL`、`reviewed=1`。
- 每次分類語意變更寫入 append-only `rule_change_log`；不得寫入代表人工欄位修正的 `correction_log`。

## UI States

- 清單 ready：每條規則顯示目前仍連結的交易筆數。
- 編輯 ready：若規則有歷史連結，表單明示儲存後會重新校正的未確認筆數及會保留的已確認筆數。
- 停用／刪除確認：對話框顯示連結、未確認、已確認筆數，主按鈕明確寫「停用並重新校正」或「刪除並重新校正」。
- 舊資料清理：已停用但仍有連結的規則顯示「校正舊資料」，確認後規則維持停用。
- Submitting：防止重複送出，不關閉對話框直到 API 成功。
- Success：toast 回報重新分類、送回待審與保留已確認筆數，規則清單和全域資料讀取端重新整理。
- Error：對話框保留並顯示既有 toast 錯誤；不得顯示成功或清空本地狀態。

## Invariants

- 金額、日期、來源、名稱與原始交易資訊不可改。
- `classification_source=human` 不可被規則維護覆寫。
- `correction_log` 保持 append-only，且不記錄系統規則重算。
- `rule_change_log` 保持 append-only。
- 規則停用或刪除後，不可留下未確認交易繼續以該規則作為目前分類依據。
- 找不到替代規則的交易必須可由 needs-review 查詢看見。
- 報表與總覽在同一 DB transaction commit 後讀到一致的新分類。

## Acceptance Examples

1. Given 規則 A 將 21 筆未確認交易分為飲食, when 規則 A 被停用且沒有替代規則, then 21 筆保留暫存分類但全部轉為 pending 並進入 needs-review。
2. Given 規則 A 的交易同時可命中較精確規則 B, when 規則 A 被停用, then 該交易改由規則 B 分類而不是轉 pending。
3. Given 一筆規則交易已由使用者確認, when 原規則分類被修改或規則被刪除, then 該筆分類不變、改成人工權威且不再連結原規則。
4. Given 一筆交易已是人工分類, when 任一規則被修改, then 該筆所有分類與審核欄位完全不變。
5. Given 規則只修改 note, when PATCH 成功, then 歷史交易不重算且 impact 的變更筆數為 0。
6. Given 舊版資料仍有交易連結已停用規則, when 操作者執行校正舊資料, then 規則維持停用且所有連結交易依同一套重算契約處理。

## Test Mapping

- Unit/integration: `test/rule-history-reclassification.test.js`
- Regression: `test/review-policy.test.js`, `test/learning-context.test.js`, `test/r1-empty-match-key-and-direction-case.test.js`
- Full: `npm test`, `npm run build`, `npm run verify:release`
- Browser: 以隔離 `FINANCE_DB_PATH` 驗證規則清單及停用／刪除確認對話框。
- Skill: `quick_validate.py` 與 API／learning-loop／monthly-workflow 關鍵字檢查。

## Evidence

- 變更前：停用規則仍有 21 筆未確認交易保留舊 `rule_id` 與分類，且不在 needs-review。
- 變更後：測試 fixture 必須證明替代規則重配、pending 回流、已確認保護與 append-only 稽核。

## Intentional Changes

- 規則分類語意變更不再只影響未來匯入；目前連結的歷史規則交易會同步重新校正。
- 已確認規則結果在原規則失效時轉成人工權威，避免規則更新覆寫已完成決策。
- 刪除規則不再讓 FK 單獨清空 `rule_id` 後留下無法追溯的舊分類。

## Open Questions

- 未來可增加完整 rule version snapshot，讓每筆交易保留曾套用的規則版本；本次先以 append-only 聚合稽核封住資料污染路徑。
