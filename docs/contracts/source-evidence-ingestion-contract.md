---
schema_version: behavior-contract/v1
id: finance.foundation.ingestion
title: 來源證據與原子匯入
status: active
owner_surface: api
change_context:
  type: feature
  reason: 讓 AI 能以可預覽、可驗證、冪等且可追溯的方式寫入 typed 財務資料。
  non_goals:
    - 不提供任意 SQL、任意 URL 抓取或 generic records API。
    - 不移除或改寫既有 import-ledger 相容流程。
---

# 來源證據與原子匯入契約

## Behavior Boundary

擁有 source registration、typed compound bundle 的 preview/validate/commit、idempotency、staging retention、committed-run typed reversal，以及 legacy ledger adapter 的相容邊界。

## Consumers And Entrypoints

- `POST /api/finance/imports/preview`。
- `POST /api/finance/imports/:runKey/commit`。
- `POST /api/finance/imports/:runKey/reverse-preview`、`reverse`。
- `POST /api/import-ledger` legacy adapter。
- `ingestion_runs`、`ingestion_run_contexts`、`ingestion_items`、typed context services。

## Inputs And State

- Bundle 必須帶 schema version、source key、bundle kind、typed sections、client item keys、idempotency key、authority、reason 與 AI confidence。
- 跨 section reference 只可指向同 bundle 的 client item key 或已存在 stable resource key。
- Payload 有 size/item/text/decimal/date limits，unknown context/field 拒絕。
- Source artifact 留在 allowlisted gitignored roots；DB 只存 metadata、fingerprint/path hint，不存完整 blob。

## Outputs And Side Effects

- Preview 只寫有期限的 staging metadata/items，不寫 canonical facts；回 run key、payload hash、normalized items、actions、warnings、errors 與 review requirements。
- Commit 驗證 run、hash、schema、idempotency 與 expected versions，並在單一 transaction 寫入所有 typed sections、links、audit、review tasks。
- 同 idempotency key + same hash 回原結果；same key + different hash 回 `409 DUPLICATE`/conflict。
- 任一 section validation/reference/commit 失敗時，整個 compound run canonical writes 為零。
- 成功後移除或依 retention policy 最小化 staged raw payload；保留必要 run evidence。
- Reversal 不 hard delete；以 typed reversed/superseded state、reversal run 與 audit 排除錯誤 facts。任一 context 不可逆或 human evidence 無安全 owner 時整批 fail closed。

## UI States

後續 importer 顯示 previewing、validation-error、warning/review、ready-to-commit、committing、committed、conflict、reversal-impact 與 reversal-blocked。Phase 0 不新增 UI。

## Invariants

- Preview 後 payload 改變必須建立新 preview。
- Canonical commit 預設 all-or-nothing；互不相依資料要在 preview 前拆 run。
- `POST /api/import-ledger` 的 CSV schema、dedupe、rules-applied stats 與 human protection 保持。
- Staging JSON 不是分析來源，且不得無限期保存敏感原文。
- 原 source、change logs 與 human evidence 不因 reversal 被刪除。

## Acceptance Examples

1. Given card bundle 含 transactions、statement、balance、installments，when installment reference unresolved，then 所有 context canonical rows 都是零新增。
2. Given 已 commit 的 idempotency key，when 相同 hash 重試，then 回原結果；不同 hash 重試回 conflict。
3. Given 一批資料匯錯帳戶，when impact preview 完整且 human receipt 有效，then typed facts 原子 reversed，原 source/audit 留存，正確資料需用新 run 匯入。

## Test Mapping

```yaml
test_mapping:
  integration:
    - test/financial-ingestion.test.js
    - test/compound-ingestion.test.js
    - test/ingestion-reversal.test.js
    - test/import-dedupe.test.js
  manual:
    - Inspect committed run metadata and verify staged sensitive payload follows retention policy.
```

## Evidence

- ADR：`docs/adr/0005-ingestion-staging-retention.md`。
- Mapping fixtures：`test/fixtures/financial-data/source-mappings/`。

## Intentional Changes

- 新 structured ingestion 與 legacy adapter 並存；除非另立退場計畫，不移除舊 API。
