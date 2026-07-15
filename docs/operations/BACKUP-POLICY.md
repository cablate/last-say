# Backup Policy And Recovery Readiness

用途：把「有 backup CLI」提升為可被 operator 檢查的 recovery routine。本文件不替專案擁有者決定可接受資料損失、還原時間、保留份數或外部儲存位置。

Status: Needs owner decision — deferred until core business flow is stable or recovery becomes an active blocker
Last validated: 2026-07-15

## 現有能力

- WAL-consistent、checksummed backup：`scripts/finance-backup.mjs`。
- 只還原到新 target、拒絕覆蓋：`scripts/finance-restore.mjs`。
- 唯讀 health/freshness check：`scripts/finance-backup-check.mjs`。
- Release verifier 的匿名 backup→restore rehearsal 只驗證程式路徑，不代表真實資料已有最近備份。

## Current Simple Operating Mode

依owner 2026-07-15決策，目前沿用explicit manual backup／restore／health check：不自動刪除、不自動上傳、不自行選擇私密目的地，也不由AI切換active DB。RPO／RTO／scheduler／retention等優化等foundation業務邏輯跑順，或現有方式成為實際風險時再定案。

## Owner Policy Worksheet

以下欄位在 owner 核准前皆為 `Unknown`：

| Decision | Owner value | 說明 |
|---|---|---|
| RPO | Unknown | 最多可損失幾小時／幾天輸入 |
| RTO | Unknown | 故障後多久內需恢復可用 |
| Backup cadence | Unknown | 每日、每週或事件前 |
| Full-bundle cadence | Unknown | 是否需要同時保存來源檔 |
| Retention | Unknown | 保留幾份／多久；目前不自動刪除 |
| Restore drill cadence | Unknown | 建議用新 target 演練，不碰 active DB |
| Protected location | Unknown | OS/volume encryption、ACL、off-site copy |
| Responsible operator | Unknown | 誰檢查失敗與 stale exit code |

## Safe Operator Loop

建立明確路徑的備份：

```powershell
node scripts/finance-backup.mjs --db D:\Private\LastSay\finance.sqlite --output D:\Private\LastSayBackups
```

依 owner 的 RPO 將 `24` 換成允許的最大備份年齡；directory mode 會選 `created_at` 最新的 supported manifest：

```powershell
npm run backup:check -- --directory D:\Private\LastSayBackups --max-age-hours 24
```

Exit code：`0=current and valid`、`2=valid but stale`、其他 non-zero=manifest/hash/integrity/schema/artifact failure。輸出不含財務 rows 或來源內容。

還原演練只寫全新 target：

```powershell
node scripts/finance-restore.mjs --input D:\Private\LastSayBackups\<bundle>\manifest.json --target D:\Private\LastSayRestoreDrill\finance.sqlite
```

演練後記錄日期、manifest path、app/schema version、integrity、operator 與是否能以隔離 `FINANCE_DB_PATH` 啟動。不要把 restore target 直接切成 active DB；切換需要停止服務與獨立人類決策。

## Scheduling Boundary

Repository 目前提供可排程的 non-interactive commands，但不自動建立 Windows Task Scheduler 工作，因為 DB path、backup destination、帳號、加密、RPO 與通知責任都需要 owner 決策。排程不得加入自動刪除，直到 retention policy 核准且有 dry-run／path guard。

## Sensitive Data

Backup bundle 未由 Last Say 加密。目的地必須是 private、受 ACL 或磁碟加密保護的位置；不要同步到未核准的雲端或 repository。Full bundle 可能含來源檔，敏感度高於 DB-only。

更新觸發：owner 核准 RPO/RTO/retention、排程方式、儲存位置、加密或 restore drill結果時；每次實際 drill 後更新操作紀錄（可放在不含敏感資料的 private ops log）。
