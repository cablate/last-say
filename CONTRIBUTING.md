# Contributing

感謝你想改善 Last Say。這個專案優先處理能降低真實財務審查成本的改動：資料正確性、銀行格式、規則品質、待審效率、報表可信度與隱私安全。

## 開始前

1. 先搜尋既有 Issues 與 Discussions，避免重複工作。
2. 功能或資料模型變更先開 Issue 說明使用情境與驗收方式。
3. 保持 PR 聚焦；不要把無關重構混在同一個變更裡。

## 隱私紅線

- 不得提交真實帳單、交易、卡號、姓名、帳戶、餘額、截圖或 SQLite。
- 範例與測試必須使用明確虛構資料，例如 `DEMO MARKET`、`****1234`。
- 開發與測試一律設定隔離的 `FINANCE_DB_PATH`，不得使用 `data/finance.sqlite`。
- Issue、PR、log 與 screenshot 同樣適用這些限制。

## 本機開發

```bash
npm ci
FINANCE_DB_PATH=data/dev-contrib.sqlite npm run seed:demo
FINANCE_DB_PATH=data/dev-contrib.sqlite npm run dev
```

PowerShell：

```powershell
$env:FINANCE_DB_PATH="data/dev-contrib.sqlite"
npm run seed:demo
npm run dev
```

提交前執行：

```bash
npm run verify:release
```

## PR 應包含

- 使用者問題與預期行為。
- 變更範圍與刻意不處理的項目。
- 測試指令與實際結果。
- UI 變更的 demo 資料截圖，桌面與手機至少各一張。
- API、資料模型或 operator 行為改變時，同步 `.claude/skills/last-say-ops/`。

銀行格式貢獻請附去識別化 fixture、欄位／正負號說明與特殊列處理方式，不要只附解析程式。
