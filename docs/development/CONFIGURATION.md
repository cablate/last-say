# Configuration

用途：列出 Last Say 現有可配置項、預設值、資料路徑與不應被誤認為支援的設定。

Last validated against repository: 2026-07-15

## Runtime 設定

| 設定 | 預設 | Owner／證據 | 注意事項 |
|---|---|---|---|
| `FINANCE_DB_PATH` | `data/finance.sqlite` | `lib/db.js`、`.env.example` | 可用絕對路徑或相對 Repository根目錄；最重要的 runtime設定 |
| Host | `127.0.0.1` | `scripts/run-next-local.mjs` | launcher 固定 loopback；不要在未加 auth 前改成對外綁定 |
| `PORT` | `3127` | `scripts/run-next-local.mjs`、`.env.example` | process environment 或 mode-specific／local `.env` 可覆寫；只接受 1–65535 整數 |
| `NODE_ENV` | 由 Next設定 | `middleware.js`、Next | development CSP允許 `unsafe-eval`；production不允許 |
| `NEXT_DIST_DIR` | dev 為 `.next-dev`；production 為 `.next` | `next.config.mjs`／verifier／E2E runner | verifier使用 `.next-verify`，browser E2E 使用 ignored temp output；不是一般 user preference |

`.env.example` 只描述 DB path與port。Repository沒有 app secret、API key、OAuth或cloud credential設定。

## `FINANCE_DB_PATH` 解析

`lib/db.js` 使用 `process.cwd()` 作為 project root，因 Next bundle內的 `__dirname`會指向 `.next/server`。因此 npm命令必須從 Repository根目錄執行。

```powershell
# 相對專案根目錄
$env:FINANCE_DB_PATH='data/my-private.sqlite'

# 絕對路徑
$env:FINANCE_DB_PATH='D:\Private\LastSay\finance.sqlite'
```

DB旁可能產生 `-wal`／`-shm`。備份、搬移或刪除前先停止所有 writer，並優先用正式 backup CLI而非直接複製單一 `.sqlite`。

## Port 解析

`npm run dev` 與 `npm run start` 都透過 `scripts/run-next-local.mjs`。launcher 固定 host 為 `127.0.0.1`，並按下列順序選擇 port：

1. process environment `PORT`；
2. `.env.<mode>.local`；
3. `.env.local`；
4. `.env.<mode>`；
5. `.env`；
6. 預設 `3127`。

`mode` 在 dev 是 `development`，start 是 `production`。例如：

```powershell
$env:PORT='3128'
npm run dev
```

空值會繼續尋找下一個來源；非整數、0、負數或大於 65535 會在啟動 Next 前明確失敗。health URL、browser bookmark與 operator 文件需使用 terminal 顯示的實際 port。

## Framework 設定

- `next.config.mjs`：Next build設定與 verifier dist dir支援。
- `jsconfig.json`：`@/` path alias。
- `eslint.config.mjs`：Next／project lint與 ignored generated paths。
- `postcss.config.mjs`：Tailwind PostCSS。
- `middleware.js`：全站security headers／CSP。

這些是產品／build設定，不是 user preference；修改時要跑完整 verifier。

## Private data zones

`.gitignore` 排除：

- `data/*`（只保留 `.gitkeep`）與所有位置的 `*.sqlite*`／backup變體；
- `uploads/`、`outputs/`、一般 `*.csv`；
- `.env*`（保留 `.env.example`）；
- logs、pid、未核准 screenshot與local tool indexes；
- `.gitignore`保留的local internal doc名稱：`AUDIT-*`、`DESIGN.md`、`DEV-JOURNAL.md`、`PRINCIPLES-RAW.md`；目前working tree不保留這些文件或文件archive。

gitignore不是資料加密，也不會阻止程式／使用者把資料複製到其他 tracked file。提交前仍需 `git status`與 release privacy scan。

## Database PRAGMA 與 compatibility

`initializeDatabase` 設定 foreign keys、WAL與5秒 busy timeout，執行compatibility bootstrap與versioned migrations。使用者不應透過環境變數覆寫 schema version或migration list。

較新 schema由較舊 app開啟時應失敗；checksum drift也應失敗。這些 guard不是可關閉的設定。

## 未提供的設定

- authentication users／roles、session secret、TLS。
- remote DB／cloud sync／bank API／LLM provider。
- log level、log destination、telemetry endpoint。
- 自動 retention、backup schedule、encryption key；目前只有 CLI、read-only backup health check與待 owner 填寫的 policy worksheet。
- locale／timezone／base currency 的全域 user preference。currency保存在資料事實中；presentation preference尚無正式設定面。

若新增上述任何一項，需同步 threat model、configuration validation、secret handling、operations與migration策略。

更新觸發：環境變數、defaults、path解析、host／port、framework config、private zones或不可配置guard改變時更新。
