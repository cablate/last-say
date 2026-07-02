# 💰 Finance Viewer

**你架設的本機財務伺服器 — 把 AI 留在你那一端，把資料與審核介面留在這裡。**

> _Bring your own AI agent. This server holds your data + API + UI; Codex / Claude Code does the thinking._

![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933?logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![shadcn/ui](https://img.shields.io/badge/shadcn--ui-radix--nova-000000)
![SQLite](https://img.shields.io/badge/SQLite-node:sqlite-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

Finance Viewer 是一個**本機財務資料伺服器**：SQLite 儲存 + REST API + Web UI。它**本身不做 AI** —— 你用慣用的 AI 編程助手（Codex、Claude Code 等）分析銀行帳單、產出含初分的 CSV、打 API 批次處理、做後續分析；你（人）在 Web UI 逐筆終審。AI 永遠在你那一端，可隨時換最強的模型。

---

## 🤔 為什麼是這個架構？

市售記帳軟體把 AI 綁死在雲端：你用的是它選的模型、它的分類邏輯、它的伺服器，資料還得送上雲。**你不擁有任何一環。**

Finance Viewer 反過來 👇

| 痛點 | Finance Viewer 怎麼解 |
|---|---|
| AI 被綁特定模型 | **Bring Your Own Agent** — 不內建 AI，你用 Codex / Claude Code 透過乾淨 API 操作，隨時換最強的模型 |
| 資料不想上雲 | **100% 本機** — SQLite 在你電腦，AI 在你電腦，資料不離開 |
| AI 分類 + 人工校對兩頭跑 | AI 在外部產出 CSV / 打 API 批次處理，**人在 Web UI 拍板**，分工清楚 |
| 改過又忘 | 每次修正寫進 **append-only 的 correction_log**，AI 可讀它做「分類規則分析」 |
| 想知道錢花哪去 | **分類分析**（標準 14 類支出結構），AI 初分 + 人工終審 |
| UI 像上個世紀 | **shadcn/ui + Recharts**，現代、乾淨、手機也順 |

> 你的 AI、你的資料、你的規則。伺服器只是忠實的資料層與審核介面。

---

## ✨ 特色 Features

- 🤝 **外部 AI Agent 友善** — 完整 REST API + 操作 playbook（[`prompts/playbook.md`](./prompts/playbook.md)），Codex / Claude Code 直接打 API 匯入帳單、批次分類、產出分析
- 🎯 **低信心優先審** — AIBanner 提示「AI 沒把握」筆數，一鍵帶到交易明細依信心度排序（最沒把握的排最前）
- ⚡ **批次修正** — AI 透過 API 批次改、或你在 UI 勾選改
- 🔍 **全文搜尋** — 交易名稱、備註、分類原因即時搜尋
- 📊 **雙視角儀表板** — 圓餅圖 + 月趨勢 + 餘額走勢，scope 切換數字即時變
- 📝 **修正歷史 = 學習資產** — `correction_log` append-only，trigger 阻擋竄改，是 AI 產出規則的原料
- 🔒 **安全第一** — CSP / X-Frame-Options 安全標頭 + import 路徑白名單 + 金額欄位無寫入路徑（不可竄改）
- 📱 **RWD** — 桌面、平板、手機都順

---

## 🧠 AI 在哪一端？（架構）

```
┌─────────────────────────┐        ┌─────────────────────────────────┐
│  你的 AI Agent（外部）   │        │  Finance Viewer Server（你架的） │
│  Codex / Claude Code    │        │  http://localhost:3127           │
│                         │  API   │                                  │
│  • 分析原始帳單 → CSV   │ ─────► │  POST /api/import-ledger         │
│  • 批次分類、產出規則    │ ─────► │  POST /api/transactions/batch    │
│  • 讀 correction_log    │ ◄───── │  GET  /api/corrections           │
│  • 月度分析報告          │ ◄───── │  GET  /api/summary /trend /...   │
└─────────────────────────┘        │                                  │
                                   │  Web UI（人工終審）              │
                                   │  逐筆校對 / 批次 / 下鑽          │
                                   └─────────────────────────────────┘
```

AI 看不到你的資料細節？錯 — **AI 就是你跑的 Codex/Claude Code**，資料在它讀得到的地方（你電腦），但它不經過任何第三方雲端。

---

## 🚀 快速開始 Quick Start

```bash
git clone https://github.com/cablate/finance-viewer
cd finance-viewer
npm install
npm run seed:demo   # 產生示範假資料（通用商家，不含任何真實個資）
npm run dev         # 啟動 → http://localhost:3127
```

打開 **http://localhost:3127**，你會看到 6 個月、約 200 筆示範交易的完整儀表板。

### 匯入你自己的帳單
```bash
npm run seed -- --ledger=path/to/your/ledger.csv
# 或讓你的 AI agent 打 POST /api/import-ledger
```

---

## 🖥 使用方式 Usage

1. **匯入** — AI 分析帳單產出 CSV → 匯入（CLI 或 API）
2. **總覽** — Overview 看 淨現金流 / 各類支出 / 餘額走勢，點指標卡可**下鑽**
3. **審查** — AIBanner「AI 待審」一鍵帶到低信心交易，逐筆校對
4. **修正** — 展開交易 → 改 分類/備註 → 儲存（寫進 correction_log）
5. **批次** — UI 勾選 或 AI 透過 API 批次改
6. **AI 後續分析** — AI 讀 `/api/corrections` 產出分類規則建議、`/api/summary` 做月報

---

## 📡 API — 給你的 AI Agent 用

> 完整契約與 SOP 見 [`prompts/playbook.md`](./prompts/playbook.md)；開發規則見 [`AGENTS.md`](./AGENTS.md)。本機同源 `http://localhost:3127/api/*`、統一錯誤 envelope。

| Method | Route | 用途 |
|---|---|---|
| GET | `/api/summary` `/breakdown` `/trend` `/transactions` `/spending` `/corrections` `/balance-history` `/meta` `/health` | 查詢（AI 讀這些做分析；`/api/meta` 含 needsReview 待審計數） |
| GET | `/api/transactions/:id` | 單筆明細 |
| PATCH | `/api/transactions/:id` | 單筆修正（白名單欄位） |
| POST | `/api/transactions/batch` | 批次修正（AI 批次處理） |
| POST | `/api/transactions/review` | 批次標記已審（人類認可規則套用） |
| GET | `/api/rules` `/rules/:id` `/rules/normalize` | 規則查詢／正規化預覽 |
| POST | `/api/rules` | 新增規則（帶 confidence） |
| PATCH/DELETE | `/api/rules/:id` | 改／刪規則 |
| POST | `/api/import-ledger` | 匯入 CSV（csvPath 白名單） |

---

## 🛠 技術棧 Tech Stack

| 層 | 技術 |
|---|---|
| Framework | **Next.js 15** (App Router) + **React 19** |
| UI | **shadcn/ui** (radix-nova) + **Tailwind CSS v4** + **lucide-react** |
| 圖表 | **Recharts** |
| 資料庫 | **node:sqlite**（Node 22 內建，零外部依賴） |
| 金額 | **INTEGER cents**（元 ×100，消除浮點累積誤差） |

---

## 🏗 架構 Architecture

```
finance-viewer/
├─ app/            (app)/ route group（共享 layout + 5 個 page：/ /transactions /trend /corrections /rules）+ 17 API route + root layout
├─ components/     Overview · TransactionTable(編輯+批次+確認+待審篩選) · RulesManager(規則 CRUD)
│                  · CorrectionsLog(交易為主體) · TrendView · AppSidebar · ScopeBar
│                  · SearchInput · AIBanner · ErrorBoundary · charts/
├─ lib/            db（單例）· queries/（core/transactions/rules/corrections 子模組）· normalize · constants
│                  · format（cents/100）· constants · api-client · hooks · utils
├─ middleware.js   安全標頭（CSP / X-Frame-Options / nosniff / Referrer-Policy）
├─ AGENTS.md       給 AI 編程助手的開發規則（改碼時遵守的不變量與分析角度）
├─ prompts/        playbook.md — 外部 AI Agent（Codex/Claude Code）操作契約 + SOP
├─ scripts/        seed-from-ledger.js · seed-demo.js · migrate-amount-to-cents.js
└─ data/           finance.sqlite（本機，gitignore 不追蹤）
```

### 設計原則
1. **人先確認，AI 才學** — 未確認的不會變成規則
2. **外部 AI 初分、人工終審** — AI 在外部產出含初分的 CSV / 打 API 批次處理，人在 Web UI 拍板
3. **不雙向同步** — 匯入不會覆蓋人工已改的分類
4. **金額不可端改** — 金額欄位完全沒有 UPDATE 路徑
5. **修正軌跡 append-only** — `correction_log` 有 trigger 阻擋 UPDATE/DELETE

---

## ☁️ 部署 Deploy

### 本機（推薦 ✅，隱私最佳）
```bash
npm run build && npm run start    # → http://localhost:3127
```
AI agent（Codex/Claude Code）與 server 都在你電腦，資料不外流。

### 雲端（Vercel / 自架）
這是**本機工具**：DB 是本機 SQLite、API 無身份驗證（設計為單人本機 + 本機 AI agent）。要部署雲端需：換雲端 DB、加身份驗證、確認安全標頭與 import 白名單。

---

## 🔐 隱私 Privacy

**100% 本機。** 你的銀行帳單與你的 AI 都在你電腦 —— 不上傳、不分析、不回報。
SQLite 在 `data/finance.sqlite`，隨時可 `rm` 或備份。

---

## 🧰 開發 Development

```bash
npm run dev              # 開發（hot-reload）
npm run build            # 生產 build
npm run seed:demo:reset  # 重建示範資料（會清空既有 DB）
npm run lint             # ESLint
```

需求 Node ≥ 22.5（`node:sqlite` 內建）。

---

## 📜 授權 License

MIT — 自由使用、修改、散布、商用。

---

## 🤝 貢獻 Contributing

PR welcome。

**已實作**：規則系統（兩環進化、匯入自動套用、RulesManager）、多 route 架構（取代 `?mode=` 單頁）、needsReview 單一判定（低信心優先審）、CorrectionsLog 交易為主體、mobile card、確認鈕、API 綁 localhost、`.env` 支援、Node 版本守門、AI 操作 playbook（`prompts/`）。

**未來方向**（roadmap）：
- 關鍵路徑自動化測試、eslint 設定。
- AI 流程優化：websearch 提升分類信心、控制分類發散度（避免過細）、進一步降低人類負擔。

---

<div align="center">

**你的 AI，你的資料，你的伺服器。** 💪

</div>
