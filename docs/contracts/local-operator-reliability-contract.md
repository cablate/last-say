---
schema_version: behavior-contract/v1
id: infrastructure.local-operator-reliability
title: 本機啟動、瀏覽器驗收與備份健康檢查契約
status: active
owner_surface: infrastructure
last_validated_against_repository: 2026-07-15
change_context:
  type: reliability
  reason: 讓 PORT 設定實際生效、將關鍵 UI 流程納入可重複瀏覽器驗收，並讓 operator 能非破壞性判斷最近備份是否可用。
  non_goals:
    - 不開放非 loopback 網路介面。
    - 不自動刪除備份、不替 owner 決定 retention／RPO／RTO。
    - 不替換 active database 或新增 HTTP backup／restore API。
    - 不把 CI 的匿名 restore rehearsal 當成個人真實備份。
---

# 本機 Operator Reliability 契約

## Behavior Boundary

本契約擁有 local Next launcher 的 environment/port precedence、critical browser E2E orchestration、backup manifest 非破壞性驗證與 operational policy 文件。Backup creation／restore 的資料一致性仍由 `infrastructure.finance-backup-restore` 擁有。

## Consumers And Entrypoints

- `npm run dev`、`npm run start`、`scripts/run-next-local.mjs`。
- `npm run test:e2e` 與 release verifier／GitHub Actions。
- `node scripts/finance-backup-check.mjs --input <manifest> [--max-age-hours N]`。
- `node scripts/finance-backup-check.mjs --directory <backup-root> [--max-age-hours N]`。

## Inputs And State

- Port precedence：existing process environment > `.env.<mode>.local` > `.env.local` > `.env.<mode>` > `.env` > 3127。
- Port 必須為 1–65535 的整數；host 固定 `127.0.0.1`。
- E2E 必須使用 explicit temporary `FINANCE_DB_PATH`，不得讀寫 `data/finance.sqlite`。
- Backup check 接受 explicit manifest 或 backup root；freshness threshold 是 operator 提供的 policy input，不是產品硬編的財務安全判斷。

## Outputs And Side Effects

- Launcher 以 resolved port 啟動 Next，轉送 exit code 與 signals。
- Browser E2E 建立／清除匿名 temp DB，驗證Data Center、三張server-backed statements與unified review workbench的complete／partial／empty／typed-owner狀態。
- Backup check 驗證 manifest format、hash、SQLite integrity、foreign keys、schema compatibility、source artifact hashes與 age；不建立 restore target、不修改 bundle。
- Directory mode 選擇 manifest `created_at` 最新且格式可解析者；找不到時 non-zero exit。

## UI States

- Invalid port／backup manifest／stale backup 以清楚錯誤和 non-zero exit 呈現。
- `--max-age-hours` 超標回 `stale`；完整可用回 `current`；輸出不包含財務 rows 或 source contents。

## Invariants

- Loopback-only boundary 不變。
- 所有測試與 rehearsal 使用 isolated DB。
- Backup check 唯讀；不以 touch/copy/restore 假裝驗證。
- Stale 是 freshness policy failure，即使 hash/integrity 仍正確也應 non-zero，方便排程監控。
- RPO、RTO、retention、encryption/off-site policy 仍需 owner 明確決定。

## Acceptance Examples

1. Given `.env` contains PORT=4132，when `npm run dev` and no process PORT exists，then server listens on 127.0.0.1:4132。
2. Given process PORT=5123 and `.env` PORT=4132，then process value wins。
3. Given E2E run，then temp DB receives JPY `123456` without ÷100 drift and production DB path remains untouched。
4. Given valid 6-hour-old backup and max age 24，then check returns current；given 30-hour-old backup，then returns stale/non-zero without modifying files。
5. Given corrupted DB or artifact hash，then check fails before any restore action。

## Test Mapping

```yaml
test_mapping:
  unit:
    - test/local-next-launcher.test.js
    - test/backup-health.test.js
  browser:
    - e2e/data-center-and-reports.spec.js
  release:
    - scripts/verify-release.mjs
```

## Evidence

- Implemented launcher：`scripts/run-next-local.mjs`、`package.json`、`.env.example`、`test/local-next-launcher.test.js`。
- Implemented browser gate：`scripts/run-browser-e2e.mjs`、`playwright.config.mjs`、`e2e/data-center-and-reports.spec.js`、`.github/workflows/ci.yml`。
- Consistent backup／restore／health：`lib/db/backup.js`、`scripts/finance-backup-check.mjs`、`test/backup-restore.test.js`、`test/backup-health.test.js`。
- Runtime isolation：`docs/contracts/runtime-build-isolation-contract.md`。

## Intentional Changes

- `dev`／`start` 改由 launcher 解析 env，預設 port 仍為 3127。
- Release gate 新增 Chromium browser E2E。
- Backup utility 新增 readonly health/freshness check；不新增 retention deletion。

## Open Questions

- Owner 必須在 `docs/operations/BACKUP-POLICY.md` 核准個人 RPO、RTO、retention、off-site 與 encryption choices。

## Update Trigger

Launcher precedence／binding、browser E2E scope、release orchestration、backup manifest／health semantics或owner recovery policy改變時更新。
