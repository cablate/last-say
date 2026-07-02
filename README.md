<p align="center">
  <img src="./docs/brand/finance-viewer-banner.jpg" alt="Finance Viewer">
</p>

<h1 align="center">Finance Viewer</h1>

<p align="center">
  <b>AI 負責整理，人負責判斷，系統負責記住。</b><br>
  本機財務審查工作台 — <i>bring your own AI agent.</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%E2%89%A522.5-339933?logo=node.js&logoColor=white" alt="Node ≥22.5">
  <img src="https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white" alt="Next.js 15">
  <img src="https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License">
</p>

---

Finance Viewer 是一個**本機財務資料伺服器**（SQLite + REST API + Web UI），本身不內建 AI。你把銀行帳單交給慣用的 AI 編程助手（Claude Code、Codex⋯），它讀懂格式、補全商家、給出分類與信心度；你在 Web UI 只審 AI 沒把握的部分；每次修正都沉澱成分類規則，下個月自動套用——**越用越省力**。

資料、規則、審核權全部留在你的電腦。不綁模型、不上雲、不做黑盒分類。

![Overview — 月結卡與月報](./docs/screenshots/overview-demo.png)

## 特色

- **Bring Your Own Agent** — 不內建 AI。完整 REST API + 操作契約（[playbook](./prompts/playbook.md)），任何 AI 編程助手都能接手帳單處理，隨時換最強的模型
- **審查為中心的工作流** — 低信心交易優先排序、每筆附 AI 判斷理由、鍵盤連續審查、同商家分組一次處理
- **修正會複利** — 人工修正寫入 append-only 的 `correction_log`，AI 據此進化分類規則，自動化率逐月上升
- **月結報告** — 已處理量／自動化率／待審數、本月 vs 常態、Top movers、固定支出底盤
- **100% 本機** — SQLite 在你電腦，金額欄位無任何寫入路徑，資料不離開

<p align="center">
  <img src="./docs/screenshots/trend-demo.png" alt="規則自動化率逐月上升" width="720">
</p>

## 運作方式

```
你的 AI Agent（外部）                Finance Viewer（本機 :3127）
讀帳單 · 查商家 · 分類 · 建規則  ──►  REST API ──► SQLite
讀修正紀錄 · 進化規則            ◄──  correction_log（append-only）
                                     Web UI ── 你在這裡終審
```

1. AI 讀原始帳單 → 產出含分類與信心度的 ledger CSV → 打 API 匯入
2. 已知商家由規則自動分類；AI 沒把握的進審查佇列，你在 UI 拍板
3. 修正寫入 `correction_log` → AI 讀取並修訂規則 → 下個月自動化率更高

## 快速開始

```bash
git clone https://github.com/cablate/finance-viewer
cd finance-viewer
npm install
npm run seed:demo   # 產生 6 個月示範資料（不含任何真實個資）
npm run dev         # → http://localhost:3127
```

> 已經有正式資料、想另開隔離的 demo 庫時，加上 `FINANCE_DB_PATH=data/dev-demo.sqlite`（PowerShell：`$env:FINANCE_DB_PATH="data/dev-demo.sqlite"`）。

### 用你自己的帳單

啟動 server 後，把這段貼給你的 AI agent：

```text
我架好了 Finance Viewer（localhost:3127），請讀專案的 prompts/playbook.md，
照流程 A 處理我這份帳單：<檔案路徑>
```

AI 會解析帳單、搜尋補全商家、匯入並建立規則；低信心交易留給你在 Web UI 審查。

## 文件

| 文件 | 內容 |
|---|---|
| [`prompts/playbook.md`](./prompts/playbook.md) | 外部 AI 的完整操作契約：API 表、資料模型、分類判準、月度 SOP |
| [`AGENTS.md`](./AGENTS.md) | 開發規則：系統不變量、架構、設計原則 |
| [`docs/screenshots/`](./docs/screenshots) | 更多畫面 |

## 開發

```bash
npm run dev              # 開發
npm test                 # 關鍵路徑測試
npm run verify:release   # 一鍵驗收（test + build + 殘留掃描 + demo 指標）
```

Next.js 15 · React 19 · shadcn/ui · Recharts · `node:sqlite`（Node ≥ 22.5，零外部 DB 依賴）。金額一律 INTEGER cents。

這是單人本機工具：API 綁 localhost、無身份驗證。要部署到雲端需自行加上驗證與雲端 DB。

## Roadmap

個人／事業維度 · AI 月度洞察報告 · 分類清單可配置化 · 銀行別帳單格式 adapter（歡迎以 PR 貢獻你的銀行格式經驗）

## License

[MIT](./LICENSE)
