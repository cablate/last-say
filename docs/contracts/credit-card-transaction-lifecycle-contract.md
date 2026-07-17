---
schema_version: behavior-contract/v1
id: finance.credit-card-transaction-lifecycle
title: Credit-card current and unbilled to posted lifecycle
status: active
owner_surface: api
change_context:
  type: feature
  reason: Prevent a card purchase from being counted twice when current or unbilled evidence is replaced by an official posted statement.
  non_goals:
    - Repair historical statement-normalization differences without row-level evidence.
    - Infer a released authorization only because one merchant row is absent from an incomplete export.
    - Create a second transaction ledger or delete superseded source evidence.
---

# Credit-card current／unbilled → posted lifecycle contract

用途：固定 R16 的卡片交易生命週期、跨來源 identity、preview／commit／reversal 與失敗邊界。最後依 repository 驗證：2026-07-17。

## Behavior boundary

本能力消費既有 `accounts`、`sources`、`transactions`、`transaction_sources`、`ingestion_runs` 與 `data_change_log`。它把 provisional 卡片交易晉升為 posted、建立新 posted 交易、明確釋放舊授權，並 supersede 已被完整取代的 current source；不建立另一套卡片交易 truth。

入口沿用既有 ingestion API：

- `POST /api/finance/imports/preview`
- `POST /api/finance/imports/:runKey/commit`
- `GET /api/finance/imports/:runKey`
- `POST /api/finance/imports/:runKey/reverse-preview`
- `POST /api/finance/imports/:runKey/reverse`

Lifecycle payload 的 `schema_id` 是 `finance.card-transaction-lifecycle/v1`。

## Inputs and authority

- `account_key` 必須指向 active `credit_card` account。
- `posted_source_key` 與 `posted_source` 必須擇一。既有 source 必須 active；新 source 會在 commit 建立。兩者都必須屬於相同 account、`source_kind=credit_card_statement_csv`、具有 `period_end`，且 authority 是 `official` 或 `institution_export`。
- `posted_rows` 保存 signed minor units、currency、transaction date、merchant text、source row key 與 `occurrence_ordinal`。`expected_rows_total_minor` 必須等於所有 row signed amount 的精確合計；它不是 statement balance。
- `supersede_source_keys` 只能指向相同 account、active、`current_transactions_csv` 且 `period_end` 不晚於 posted source 的來源。
- `release_transaction_keys` 是明確確認要結束的 provisional authorization。單純缺席不會自動 release。
- ambiguous row 可在新 preview 中提供 `match_transaction_key`；該交易仍須符合 account、date、currency、signed amount 與 external-id 或 normalized merchant 的強 identity。

## Deterministic identity and preview

每筆 posted row 只在以下順序尋找 provisional candidate：

1. 相同 account、transaction date、currency、signed amount，且 non-empty `external_id` 精確相同；
2. 相同 account、transaction date、currency、signed amount，且 merchant 經 NFKC、trim、collapse-space、uppercase 後精確相同；
3. payload 明確提供且仍符合上述強 identity 的 `match_transaction_key`。

若有 `supersede_source_keys`，candidate 還必須至少連到其中一個來源。唯一 candidate 才能自動 match；零個 candidate 是 new；多個 candidate 是 ambiguous。`occurrence_ordinal` 保留來源列順序與 drillback，但在沒有穩定的兩側 ordinal mapping 前，不得單獨消除 ambiguity。名稱＋金額、模糊日期、相似字串或 AI confidence 都不是自動合併鍵。

Preview 必須回傳：

- `matched`
- `new`
- `ambiguous`
- `released`
- `unresolved_release_candidates`
- `source_supersessions`
- 精確 row total 與 `committable`

任何 ambiguous row、無效 explicit match、row-total mismatch，或 superseded source 範圍內仍有未處理 provisional transaction，都使 commit fail closed。

## Commit and source lineage

- Matched row 沿用原 `transaction_key`、分類與經濟事實，只把 `record_status` 由 provisional 改為 posted，並新增 posted source link。
- New row 透過既有 `createCashActivity` 建立一筆 posted canonical transaction。
- Explicit release 把 provisional transaction 改為 `superseded`；舊 source link 與 audit evidence 保留。
- Current source 只在其範圍內的 provisional facts 全部 matched 或 explicit released 後改為 `superseded`。
- 所有 mutation 都綁定 ingestion run、寫入 typed ingestion item 與 append-only before／after audit。
- 同一 idempotency key＋相同 payload 回傳同一 run；同 key＋不同 payload 必須 conflict。
- Commit 後 staged row payload 必須清除；run result 只保留 counts、keys、match basis 與 blockers。

## Reversal

Reversal 沿用 `reverse_ingestion_run` 的 browser-bound human confirmation。Impact preview 必須在 mutation 前檢查：

- promoted transaction 仍是 posted，且 source link 尚未被後續 statement owner 依賴；
- released transaction 仍是 superseded；
- superseded source 未在 lifecycle run 後再次修改；
- lifecycle 建立的 source／transaction 沒有 run 外的有效 owner。

Confirmed reversal 恢復 provisional transaction status、移除本 run 新增的 source association、恢復 old source active status，並把本 run 新建交易／來源改為 reversed。Append-only audit 與原 source artifact 不刪除。若後續 statement item 或其他 owner 已依賴結果，reversal 必須 blocked。

## Acceptance examples

1. Given one unique provisional row and one new posted row, when preview and commit run, then counts are matched=1/new=1, canonical transaction count only increases by one, and both rows are posted under the official source.
2. Given two provisional rows with the same strong signature, when no explicit key is supplied, then preview lists both candidates and commit returns `REVIEW_REQUIRED`.
3. Given a provisional authorization omitted from the posted statement, when it is not in `release_transaction_keys`, then it appears under `unresolved_release_candidates` and source supersession cannot commit.
4. Given a committed lifecycle run with no downstream owner, when a confirmed reversal is executed, then promoted/released/source states return to their effective prior states and newly created facts become reversed.
5. Given the same payload and idempotency key, when preview or commit is retried, then the same run is returned and no transaction or source link is duplicated.

## Test mapping

```yaml
test_mapping:
  integration:
    - test/card-transaction-lifecycle.test.js
    - test/financial-ingestion.test.js
    - test/ingestion-reversal.test.js
  fixture:
    - test/fixtures/financial-data/source-mappings/card-transaction-lifecycle.json
```

## Evidence and maintenance

- Canonical cash owner：`lib/queries/finance/cash-activity.js`。
- Source owner：`lib/queries/finance/sources.js`。
- Ingestion／reversal：`lib/finance/ingestion/`。
- Gap evidence：`docs/planning/GAPS-RISKS-AND-DEBT.md` R16。

當 identity、source status、transaction lifecycle、ingestion route、reversal blocker 或 statement ownership 改變時更新本文件與 fixture；不得因單次真實資料修補放寬 fail-closed 規則。
