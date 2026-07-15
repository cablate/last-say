# Deployment And Operations

用途：說明 Last Say 目前真正支援的部署／維運姿態、升級與恢復流程，以及 Repository 尚未提供的 production能力。

Last validated against repository: 2026-07-15

## 支援範圍

**Confirmed：** 目前支援單一使用者在自己的裝置上，以 loopback `127.0.0.1`（預設 port 3127，可用 `PORT` 覆寫）執行 Next.js與本機 SQLite。Repository沒有 container、system service、reverse proxy、cloud manifest、multi-node或zero-downtime deployment。

不要把以下步驟描述成正式 SaaS部署手冊；它是 production build模式的 localhost operation。

## 啟動

```powershell
$env:FINANCE_DB_PATH='D:\Private\LastSay\finance.sqlite'
$env:PORT='3127' # 可省略；預設即為 3127
npm ci
npm run build
npm run start
```

檢查：

```powershell
Invoke-RestMethod http://127.0.0.1:<PORT>/api/health
```

健康 payload包含 `ok`、transaction／correction counts與 `schema_version`。這證明 process可讀 DB與schema相容，不等於所有來源新鮮、對帳完成或報表可信；資料 readiness須另外查 `/api/finance/readiness`。

## 停止與 graceful shutdown

使用啟動 terminal的正常中斷（Ctrl+C）停止。SQLite WAL通常能處理正常 process結束。

**Gap：** 產品 server沒有明確 process signal handler呼叫 `closeDb()`；`closeDb()`主要供 tests使用。不要在仍有 writer時複製／移動 DB或執行 restore切換。

## 升級程序

1. 停止 server與所有會寫目標 DB的 CLI／agent。
2. 以 [`backup-restore.md`](backup-restore.md) 建立 explicit-path backup，保存manifest。
3. 在 code change上執行 `npm ci`與 `npm run verify:release`。
4. 先對 backup restore的新 DB或匿名 fixture演練新版本。
5. 啟動新版本；`initializeDatabase`自動執行 checksummed migrations。
6. 檢查 `/api/health` schema version、Data Center inventory／readiness、transactions與reports。
7. 人類確認後再恢復日常寫入。

Migration是 forward evolution；沒有自動 downgrade。

## Rollback

- 只有 code change、沒有 schema change時，可停止新 process後回到已驗證code，再用原 DB啟動。
- schema已升級時，舊app可能因 newer-version guard拒絕開啟。不要刪 `schema_migrations`或改 `user_version`冒充 rollback。
- 正確方式是停止process、保留失敗 DB做調查，再從升級前backup restore到「新的 target path」，檢查後由人類切換 `FINANCE_DB_PATH`。

**Unknown：** Repository沒有自動 release artifact、版本化部署包或 rollback rehearsal beyond backup/restore tests。

## Backup／restore

```powershell
node scripts/finance-backup.mjs --db D:\Private\LastSay\finance.sqlite --output D:\Private\LastSayBackups
npm run backup:check -- --directory D:\Private\LastSayBackups --max-age-hours <OWNER_APPROVED_RPO_HOURS>
node scripts/finance-restore.mjs --input D:\Private\LastSayBackups\<bundle>\manifest.json --target D:\Private\RestoreTest\finance.sqlite
```

- backup預設 DB-only；`--include-sources`只應用於受保護目的地。
- bundle有manifest／hash但不加密；`backup:check`可 read-only 驗證最新 bundle的hash、integrity、foreign keys、schema與新鮮度。
- restore只接受不存在的新 target，並驗證完整性。
- Repository沒有排程器、retention或off-site backup；由使用者／OS負責。待 owner 核准的 worksheet見 [`BACKUP-POLICY.md`](BACKUP-POLICY.md)。

## Logging 與觀測

| 能力 | 現況 |
|---|---|
| Health | `/api/health`；server、DB、schema與簡單count |
| Application logs | Next stdout／stderr與少量 `console.error` |
| Structured logs／correlation ID | 無 |
| Metrics／tracing／APM | 無 |
| Alerting | 無 |
| Audit evidence | DB內 correction／rule／data-change／confirmation records；不是ops telemetry |

不要讓 OS／terminal log收錄來源內容、完整 local path或financial payload。一般錯誤回應使用 `safeErrorMessage`避免洩漏內部細節；維運紀錄也應遵守同樣原則。

## Capacity 與 availability

- 單 process、同步 `DatabaseSync`、單 SQLite file；沒有高可用與horizontal scaling。
- WAL與busy timeout適合有限 localhost concurrency。
- 無正式資料量、latency、memory或long-running baseline。
- process停止時服務不可用；這符合目前個人工具定位。

任何「常駐服務／家庭多人使用／遠端存取」需求都會引入未處理的auth、TLS、backup automation、observability與process supervision責任。

## 安全作業守則

- 永遠維持 loopback binding，除非先完成遠端 threat model與security implementation。
- 不以真實 DB跑 demo／test／release verifier。
- 不手改 SQLite來跳過 migration或confirmation。
- backup放在private、受存取控制的位置；必要時使用OS／volume encryption。
- release前跑 `npm run verify:release`與 `git status`；release gate包含隔離 Chromium E2E。

## 尚缺營運能力

- service manager／auto restart與明確 graceful shutdown。
- 已有 backup health CLI與 policy worksheet，但尚缺 owner核准的RPO／RTO、實際schedule、retention automation、restore drill提醒與last-known-good紀錄。
- structured logging、metrics、alerting、diagnostic bundle。
- signed／versioned release與deployment manifest。
- Windows與macOS production-like operation matrix。
- disaster recovery目標（RPO／RTO）與 owner核准。

更新觸發：deployment target、process supervision、network exposure、upgrade／rollback、backup或observability能力改變時更新。
