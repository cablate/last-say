---
schema_version: behavior-contract/v1
id: infrastructure.finance-backup-restore
title: 財務資料一致備份與還原
status: active
owner_surface: infrastructure
change_context:
  type: feature
  reason: 在 WAL 模式下提供可驗證、可攜且不誤碰正式資料的本機備份與還原。
  non_goals:
    - 不提供 AI/HTTP 整庫下載或 restore API。
    - 不承諾內建加密、cloud backup 或 provider-neutral interchange。
---

# 備份與還原契約

## Behavior Boundary

擁有 explicit-path local operator backup/restore、manifest、integrity/schema compatibility、DB-only/full-bundle source coverage 與 active DB replacement guard。

## Consumers And Entrypoints

- `node scripts/finance-backup.mjs --db <path> --output <ignored-dir> [--include-sources]`。
- `node scripts/finance-restore.mjs --input <backup> --target <new-path>`。
- SQLite online backup/checkpoint capability、manifest與 allowlisted source roots。

## Inputs And State

- Backup/restore 必須提供 explicit resolved paths；output/source roots 必須 gitignored，禁止 traversal/symlink escape。
- Manifest 包含 app/schema version、mode、created-at、DB hash/integrity、source relative paths/hashes與 coverage聲明。
- Full bundle 只收 sources 實際引用且在 allowlist roots 的 artifacts；DB-only 明示不含 artifacts。

## Outputs And Side Effects

- Backup 使用 WAL-consistent mechanism 建立 snapshot，對結果執行 `integrity_check` 並原子完成 manifest/bundle。
- Restore 先在新路徑驗證 manifest/hash/integrity/schema compatibility/FKs，再允許使用；target 已存在預設拒絕。
- Active DB replacement 需停服、`--replace` 與獨立 high-risk human confirmation contract；AI 無法呼叫。
- 缺 source artifact 不改 canonical facts，但 restore inventory 標 missing並降低 provenance/reparse readiness。

## UI States

Phase 0-1 無 restore UI。CLI 必須有 progress/success/failure與敏感資料警告，不輸出 statement/account/raw payload。

## Invariants

- 不以複製單一 `.sqlite` 主檔假裝 WAL-consistent backup。
- 不在缺 explicit path 時猜 `data/finance.sqlite`，不覆蓋既有 target。
- 還原保留 append-only logs、migration ledger、FK integrity與 schema version。
- Backup bundle 高度敏感且預設未加密，文件必須說明權限/存放風險。
- 測試只使用 temp DB，不碰真實 DB。

## Acceptance Examples

1. Given WAL DB 在 snapshot 前已有 committed rows，when backup/restore 到新路徑，then rows/logs/user_version/FK 與 integrity 一致。
2. Given corrupt DB/hash mismatch/newer unsupported schema，when restore，then 在建立可用 target 前拒絕。
3. Given DB-only backup，then manifest 明列 source artifacts omitted；full bundle 遇 allowlist外或 symlink artifact 時拒絕/標 missing，不跟隨。

## Test Mapping

```yaml
test_mapping:
  integration:
    - test/backup-restore.test.js
    - test/database-foundation.test.js
  manual:
    - Stop service and rehearse restore into a new anonymized path before any active replacement.
```

## Evidence

- Spike：`docs/adr/spikes/node-sqlite-bigint-wal-backup.md`。

## Intentional Changes

- Phase 1 新增 operator utility；不新增 network/AI restore surface。
