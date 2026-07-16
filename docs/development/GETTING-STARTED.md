# Getting Started

用途：提供可重現且不碰真實資料的本機啟動流程，再說明如何安全切換到自己的 private database。

Last validated against repository: 2026-07-16

## 環境需求

- Node.js `>=22.5.0`；Repository 與 CI 使用 Node 22。`node:sqlite` 是必要內建模組。
- npm 與 `package-lock.json` 相容版本。
- Windows PowerShell、macOS 或 Linux shell；本文範例以 PowerShell 為主。
- localhost 可用；預設 port 是 3127，也可用 `PORT` 選擇其他 port。
- 若要處理真實來源：一個能遵循 `.claude/skills/last-say-ops/SKILL.md` 的外部 AI agent。

確認版本：

```powershell
node --version
npm --version
```

Node <22 時，`lib/db.js` 會在載入 `node:sqlite` 前回報明確錯誤。

## 安裝

在 Repository 根目錄執行：

```powershell
npm ci
```

`npm ci` 使用既有 lockfile 且不應改寫它。若已安裝並且本次只做文件或 read-only 稽核，可直接使用現有 `node_modules`。

## 以匿名 demo 啟動

先建立隔離 demo DB：

```powershell
$env:FINANCE_DB_PATH='data/dev-demo.sqlite'
npm run seed:demo:reset
npm run dev
```

預設開啟 `http://127.0.0.1:3127`。若 3127 已被占用，可在啟動前指定：

```powershell
$env:PORT='3128'
npm run dev
```

啟動器的優先順序是 process environment → `.env.development.local` → `.env.local` → `.env.development` → `.env` → `3127`；host 固定為 loopback `127.0.0.1`。請依 terminal 顯示的實際 port 檢查 health：

```powershell
Invoke-RestMethod http://127.0.0.1:<PORT>/api/health
```

預期 `ok=true` 且 `schema_version=10`。demo DB在`data/`，已被Git忽略。若既有DB低於v10，啟動前應先依operations文件建立可驗證backup、在還原副本演練，再由正常初始化流程升級；不得用開發測試直接碰正式DB。

停止 server 後，PowerShell session 內仍保留 `FINANCE_DB_PATH`；切換專案或 DB 前先確認：

```powershell
$env:FINANCE_DB_PATH
```

## 使用預設 DB

未設定 `FINANCE_DB_PATH` 時，`npm run dev` 會開啟 `data/finance.sqlite`，並在第一次連線自動初始化／遷移：

```powershell
Remove-Item Env:FINANCE_DB_PATH -ErrorAction SilentlyContinue
npm run dev
```

**重要：** 不要用預設 DB 跑測試、demo seed或未知腳本。正式 verifier已硬性使用 `data/dev-verify-*.sqlite` 並拒絕真實 DB。

## 使用自己的資料

1. 將來源放在 private、gitignored 位置，例如 `uploads/`；不要把內容貼進 README、issue或 log。
2. 啟動 Last Say，確認 `/api/health`。
3. 讓外部 AI 先讀 `.claude/skills/last-say-ops/SKILL.md`。
4. AI 依序讀 capabilities → inventory → readiness。
5. 使用 typed preview；先檢查 source、scope、identity、money／currency與 errors。
6. 再 commit；高風險 scope、reverse、identity merge 由 browser confirmation完成。
7. 回到 Data Center／Transactions／Reports review結果。

Legacy ledger流程仍可用 `npm run seed`／`seed:reset`，但新財務 context 應優先走 typed foundation API。

## Production-style 本機驗證

```powershell
npm run build
npm run start
```

兩個 script 都透過 `scripts/run-next-local.mjs` 啟動：host 固定綁 `127.0.0.1`，port 可設定且預設為 3127。這是目前無一般 auth 設計的重要安全邊界；不要改為 `0.0.0.0` 或直接對外暴露。

## 第一次應讀什麼

- `AGENTS.md`：不可破壞的工程與資料規則。
- [`../README.md`](../README.md)：文件導覽與 AI bootstrap。
- [`../project/CURRENT-STATUS.md`](../project/CURRENT-STATUS.md)：已完成與未完成能力。
- [`../architecture/DATA-AND-FLOWS.md`](../architecture/DATA-AND-FLOWS.md)：money、identity、ingestion與 confirmation語意。
- [`DEVELOPMENT-AND-TESTING.md`](DEVELOPMENT-AND-TESTING.md)：提交前驗證。

更新觸發：Node／npm需求、安裝、seed、port、啟動、health或首次資料流程改變時更新。
