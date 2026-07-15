# Troubleshooting

用途：提供安全、非破壞性的診斷順序。任何修復都不得以刪真實 DB、改 migration ledger、關閉安全 guard或重寫測試作為捷徑。

Last validated against repository: 2026-07-15

## 第一個診斷順序

1. 確認 cwd 是 Repository根目錄。
2. 記錄 `node --version`、`git status --short`與 `FINANCE_DB_PATH`，不要輸出 DB內容。
3. 從啟動 terminal 確認實際 server URL；預設為 `http://127.0.0.1:3127`。
4. 呼叫 `/api/health`。
5. 依症狀讀 server terminal的第一個實質錯誤。
6. 若與資料完整度有關，再查 inventory／readiness；不要把 health成功當成資料完整。
7. 在隔離 DB重現；不要直接對真實 DB試修復腳本。

## 常見症狀

### `Cannot find module 'node:sqlite'` 或 Node版本錯誤

- 原因：Node <22，或 runtime不是 `package.json#engines`要求。
- 檢查：`node --version`。
- 處理：切換到支援的 Node 22+，重新 `npm ci`。不要改掉 `lib/db.js`版本guard。

### 啟動後看到空資料庫

- 常見原因：`FINANCE_DB_PATH`未設定、拼錯，或從錯誤cwd啟動導致相對路徑指向其他位置。
- 檢查：PowerShell執行 `$env:FINANCE_DB_PATH`，再核對 `lib/db.js`以 `process.cwd()`解析。
- 處理：停止server，以正確explicit path重啟。不要把另一個空 DB複製覆蓋真正 DB。

### Port 3127 已被占用

- 檢查：確認是否已有 Last Say terminal／process。
- 處理：先正常停止舊 process，或在啟動前設定 `$env:PORT='3128'`／private `.env` 後執行 `npm run dev`。同步更新 health URL；host 仍固定為 loopback。
- 若 launcher 回報範圍錯誤，將 `PORT` 改為 1–65535 的整數；不要繞過 launcher 改成對外 host。

### `/api/health` 回 503

- 可能原因：DB path不可讀／不可寫、migration drift、newer schema、SQLite corruption或lock。
- 檢查server error；只記錄sanitized message。
- 若是migration checksum／newer-version：停止，不要手改ledger；使用相容app版本或restore backup。
- 若是integrity問題：保留原檔，對backup／copy做調查；不要在原檔執行破壞性修復。

### `SQLITE_BUSY`／database is locked

- 確認是否同時有 dev server、start server、seed、backup或其他直接DB工具。
- 正常停止writer，等待WAL checkpoint後重試。
- `busy_timeout=5000`不是允許無限重試；若穩定重現，保留operation與transaction證據並建立bug。

### Migration checksum drift／unknown newer migration

- 這是保護機制，表示已套用migration內容被改或DB來自較新app。
- 不要修改 `schema_migrations`、`PRAGMA user_version`或migration source來配合現有 DB。
- 使用正確code版本；必要時從升級前backup restore到新target。

### Build／release verifier碰到資料風險guard

- `smoke-runtime`只允許 `data/dev-verify-runtime.sqlite`；這是刻意安全邊界。
- `verify:release`會使用四個 `dev-*`隔離 DB，並明示不開真實 DB。
- 若guard拒絕路徑，改正執行方式，不要修改guard。

### Release privacy scan失敗

- 檢查輸出的 tracked 或 untracked working file與行號，移除／匿名化真實銀行名稱、卡號或個資。
- 不要只把pattern加入allowlist，除非內容確定是必要的公開fixture且有審查理由。
- `prompts/playbook.md`與 `.gitignore`有既有例外，不代表其他文件可放真實資料。

### UI金額不合理，尤其是 JPY

- 先確認 API中的 integer minor amount與currency。
- UI 已共用 `lib/finance/money/presentation.js` 的 canonical exponent；JPY 應為 0 位，TWD／USD目前為 2 位，輸入超過允許精度時應拒絕而不是四捨五入。
- 若仍出現倍率錯誤，確認畫面來源 currency 與 API fact currency一致，並用匿名隔離 DB重現；不要直接改真實 DB數值補償顯示問題。

### Balance Sheet／Cash Flow 意外顯示正式數字

- 目前這兩個 tab 應明確顯示「尚不可用」，不會渲染靜態 readiness 表或正式 statement。
- 目前只有 management P&L 是 data-backed report。若 Balance Sheet／Cash Flow 出現正式數字，先停止使用該輸出，檢查是否啟動了舊 process／舊 build artifact，再以當前 commit重建。

### Readiness顯示 blocked／stale

- 這通常不是server故障，而是資料治理結果。
- 依 `gaps[].next_action`補scope attestation、expected source、balance、quote／FX、reconciliation或commitment。
- 不要把 `status`硬改成ready，也不要讓AI猜缺值。

### High-risk confirm失敗

- 確認操作是從同源browser頁面進行、cookie／session nonce未過期、request尚未consumed。
- `actor` header不能取代browser confirmation。
- expired／consumed request應重新建立preview與confirmation，不重放舊receipt。

### Backup／restore失敗

- backup必須同時提供 `--db`與 `--output`；restore必須提供manifest與全新target。
- 目標已存在時restore會拒絕，這是防覆蓋設計。
- 停止writer，確認private disk空間與permission；不要直接覆蓋active DB。

### `backup:check` 回報 stale／hash／integrity 失敗

- `stale`：最新可用 bundle 超過指定 `--max-age-hours`；先建立新備份並調查排程或人工流程，不要只放寬門檻掩蓋缺口。
- hash／artifact：bundle可能不完整或被修改；保留證據、建立新備份，不要手改 manifest 配合檔案。
- integrity／foreign key／schema：不要還原到 active path；改用較早的已驗證 bundle或 owner 核准的資料復原程序。

### Browser E2E 無法啟動 Chromium

- 本機先執行 `npx playwright install chromium`；CI 使用 `npx playwright install --with-deps chromium`。
- 一律透過 `npm run test:e2e`，讓 runner使用隔離 port、DB與build output；不要把測試指向真實 DB。

## 何時停止自行處理

遇到以下情況先封存證據並請owner決策：真實DB疑似corruption、migration drift、資料反轉會影響已確認事實、遠端曝光、安全事件、無可用backup、identity merge結果有歧義。避免把診斷升級成未授權資料變更。

## 建立問題回報時

可安全附上：app commit、Node版本、OS、sanitized command、HTTP status、schema version、匿名fixture重現與stack trace中不含private path的部分。不要附DB、statement、完整payload、銀行／卡號、private source path或真實screenshot。

更新觸發：新增常見故障、錯誤guard、health語意、money／migration問題或安全診斷流程改變時更新。
