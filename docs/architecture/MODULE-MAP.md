# Module Map

用途：讓維護者快速找到每個第一方模組的責任、入口、主要消費者與風險；檔案清單不是完整 API reference。

Last validated against repository: 2026-07-17

## Web 與 UI

| 模組 | 入口／責任 | 主要依賴與注意事項 |
|---|---|---|
| `app/(app)/page.js` + `components/Overview.jsx` | 月度總覽、支出方向與 movers | legacy dashboard APIs；component 約 900 行，資料轉換與視覺化集中 |
| `app/(app)/transactions/page.js` + `components/TransactionTable.jsx` | 交易搜尋、篩選、review、批次操作 | transactions／rules APIs；約 1,200 行，是最大 UI 變更熱點 |
| `app/(app)/reports/page.js` + `components/reports/**` | management P&L、coverage、mapping；BS／CF誠實不可用狀態 | `lib/reporting/**`、reports APIs；只有 P&L 是目前正式data-backed statement |
| `app/(app)/data/page.js` + `components/finance-data/**` | account、obligation、manual investment／quote／FX、valued item、reconciliation、readiness | `/api/finance/**`；account kinds與manual investment core已可從UI輸入，正式statement／trade import仍走external AI/API |
| `app/(app)/rules/page.js` + `components/RulesManager.jsx` | classification rule CRUD、影響預覽／重分類 | `lib/queries/rules.js`；需保護 human-reviewed transactions |
| `app/(app)/corrections/page.js` + `components/CorrectionsLog.jsx` | append-only correction evidence | correction API／query |
| `app/(app)/confirmations/page.js` + `components/finance/ConfirmationQueue.jsx` | human confirmation queue | browser session與 one-time authorization |
| `app/(app)/trend/page.js` + `components/TrendView.jsx` | 月度趨勢 | trend API、Recharts |
| `app/(app)/control/page.js` + `components/financial-control/MonthlyPulseView.jsx` | 月度財務脈搏：管理淨收支、現金變動、typed義務／投資／報銷與coverage | `/api/finance/control/monthly-pulse`；前端只格式化與drillback，不重算財務語意 |
| `components/ui/**` | shadcn／Radix 基礎元件 | 第三方風格封裝；通常不是 domain owner |

## HTTP API

| Surface | 路徑 | 責任 |
|---|---|---|
| Legacy transaction | `app/api/transactions/**`、`import-ledger`、`rules/**`、`corrections/**` | 交易審查、分類、rules、learning、匯入 |
| Overview／trend | `app/api/summary/route.js`、`breakdown`、`spending`、`trend`、`balance-history` | legacy transaction-derived dashboard read models |
| Reports | `app/api/reports/**` | management P&L、balance sheet、cash flow、mapping rules與coverage |
| Foundation discovery | `/api/finance/capabilities`、`inventory`、`readiness`、`analysis-context` | agent 開始工作與分析前的 governed read path |
| Financial analysis | `/api/finance/control/financial-health` | FA-0 Financial Health Review v0；由query-time canonical facts產出position／liquidity／debt／factor exposure／stress與coverage；不寫入報表、不呼叫AI |
| Shared kernel | `/api/finance/entities/**`、`institutions/**`、`accounts/**`、`sources/**`、`scope-attestations/**` | canonical identity、source、scope、balances |
| Ingestion | `/api/finance/imports/**` | preview、staging、commit、reverse preview／confirmed reverse |
| Obligations | `/api/finance/credit-cards/**`、`liabilities/**`、`commitments/**` | cards、loans、schedules、allocations、commitment occurrences |
| Investments／valuations | `/api/finance/investments/**`、`fx-quotes`、`valued-items/**` | instruments、trades、holdings、quotes、FX、other assets；manual holding／quote／FX routes會原子建立source與typed fact |
| Reconciliation／review | `/api/finance/reconciliation/**`、`reimbursements/**`、`source-conflicts/**`、`review-tasks/**`、`review-workbench` | cross-context match、typed decisions、conflict resolution與統一workbench projection |
| Identity／authority | `/api/finance/identity-merges/**`、`identity-redirects/**`、`human-confirmations/**` | previewed merge、redirect resolution、高風險確認 |

所有 route handler 都在同一 Next.js process；不是獨立微服務。

## Domain 與 shared helpers

| 位置 | Owner responsibility | 消費者 |
|---|---|---|
| `lib/finance/contracts/**` | finance/v1 enums、schema 與 payload validation | typed routes、ingestion、tests、operator contract |
| `lib/finance/money/decimal.js` | currency exponent、decimal → integer minor units | typed finance modules與presentation helper；legacy UI仍可能有自己的money表示 |
| `lib/finance/money/presentation.js` | exact major↔minor presentation、currency input metadata與格式化 | Data Center account／obligation UI、tests |
| `lib/finance/control/project-cash-timeline.js` | 純函式90日daily cash reference、coverage degradation、reserve breach、runway與safe-to-spend gate | synthetic Phase 0 tests；尚無runtime adapter/API/UI |
| `lib/queries/finance/control/monthly-pulse.js` | FC-A2 query-time composition owner；重用P&L／Cash Flow並提取typed movements、candidate reimbursements與deterministic watermark | `/api/finance/control/monthly-pulse`、`MonthlyPulseView.jsx`、focused／browser tests；不保存報表、不呼叫AI |
| `lib/queries/finance/control/financial-health.js` | FA-0 Financial Health Review v0 owner；以既有Balance Sheet、liability／card與investment owners組合compact deterministic Context Pack | `/api/finance/control/financial-health`、capabilities、Operator Skill與focused tests；factor scope必須由request明確提供，缺schedule／income／essential spend時保留partial／null |
| `lib/finance/ingestion/index.js` | staged payload、context dispatch、atomic commit | import commit route |
| `lib/finance/ingestion/card-lifecycle.js` | official posted source對provisional card facts的唯一強identity match、explicit release、source supersession與stale impact guard | shared import preview／commit routes、Operator Skill |
| `lib/finance/ingestion/reversal.js` | reverse preview、依賴檢查、soft reversal | import reverse routes |
| `lib/finance/readiness/policy.js` | 8 goal requirements、gap priority、next action、watermark | inventory/readiness query、API、agent |
| `lib/finance/analysis/registry.js`、`proposal-envelope.js` | 12 named datasets、filter allowlist、response limits與candidate proposal hints | analysis-context query／route、external AI |
| `lib/finance/capabilities.js` | 支援 context／endpoint／policy 描述 | capability route、skill |
| `lib/finance/http.js` | typed API error envelope／request helpers | finance routes |
| `lib/reporting/report-lines.js` | management report-line與deterministic exclusion semantics | income statement、cash fallback、UI、skill |
| `lib/reporting/coverage.js` | 三張表的coverage status／blocker／warning | reports queries／UI |
| `lib/normalize.js` | legacy transaction／merchant normalizer | import、transactions、rules、learning |
| `lib/constants.js` | editable fields與 legacy categories／rules constants | routes、queries、UI |

## Query modules

### Legacy owner modules

- `lib/queries/transactions.js`：transaction read/write、filters、batch edits、correction logging。
- `lib/queries/rules.js`：rule mutation、impact、reclassification、rule history。
- `lib/queries/learning.js`：AI/operator learning context 與 correction-derived rules。
- `lib/queries/corrections.js`：correction log read model。
- `lib/queries/reports/**`：income statement、balance sheet、cash flow與report mapping rules；所有會計語意在server read model計算。

### Typed foundation owner modules

- `accounts.js`、`balances.js`、`entities.js`、`institutions.js`、`sources.js`、`scope.js`：shared kernel。
- `obligations.js`：cards、liabilities、loan schedules／allocations、commitments。
- `investments.js`：instruments、trades、holdings、quotes、FX、cash matches、valuation，以及manual source+fact atomic composites。
- `valued-items.js`：非證券資產及估值快照。
- `reconciliation.js`、`reimbursements.js`、`source-conflicts.js`、`review-tasks.js`、`review-workbench.js`：typed matching、對帳與material review projection。
- `human-confirmations.js`、`authorization.js`：browser proof與一次性授權。
- `identity-merges.js`：merge preview／apply 與 redirect。
- `inventory.js`、`analysis-context.js`、`cash-activity.js`：governed read models。
- `finance/control/monthly-pulse.js`、`finance/control/financial-health.js`：Financial Control與AI決策協作的query-time read models；只重用canonical facts，不建立第二套帳戶／資產／負債／投資真相。

## Persistence 與 migration

- `lib/db.js`：`SCHEMA_VERSION=10`、default DB path、lazy singleton、PRAGMAs、legacy compatibility schema、transaction helper。
- `lib/db/migration-runner.js`：migration ledger、SHA-256 checksum、順序／drift／newer-version guard。
- `lib/db/migrations/0001-legacy-baseline.js`至`0010-source-conflict-review-context.js`：legacy baseline、shared kernel、ingestion/balances、obligations、investments、reconciliation、報銷配對、obligation ingestion lifecycle、transfer decision versioning與source-conflict review context。

**Legacy / compatibility：** `lib/db.js` 仍內嵌 legacy `CREATE TABLE IF NOT EXISTS` 與 column upgrade paths；versioned migrations 是新 canonical evolution path。兩者共存是相容策略，也增加 schema owner 的理解成本。

## CLI、驗證與 AI contract

| 模組 | 責任 |
|---|---|
| `scripts/seed-from-ledger.js` | legacy ledger 驗證與 import；可 reset 指定 DB |
| `scripts/seed-demo.js` | 匿名 demo fixture |
| `scripts/finance-backup.mjs`／`finance-restore.mjs` | explicit-path backup bundle／new-target restore |
| `scripts/finance-backup-check.mjs` | latest manifest、hash、SQLite integrity／FK／schema／freshness read-only檢查 |
| `scripts/run-next-local.mjs` | loopback host與PORT precedence／validation後啟動Next |
| `scripts/run-browser-e2e.mjs` + `playwright.config.mjs` | 隔離DB／port／dist啟動Chromium E2E並清理資源 |
| `scripts/verify-release.mjs` | lint、audit、Node tests、browser E2E、skill eval、build、runtime smoke、working-tree privacy、demo、backup/restore orchestration |
| `scripts/smoke-runtime.mjs` | 在隔離 DB 啟動 server 並檢查 health／runtime surface |
| `.claude/skills/last-say-ops/**` | 外部 AI 如何 discovery、preview、commit、review、analysis；不得視為 server code |
| `test/**` + `e2e/**` | Node／Playwright suites與匿名／synthetic financial fixtures；精確基線見Current Status |

## 耦合與維護熱點

- `TransactionTable.jsx`、`Overview.jsx`、`RulesManager.jsx` 同時持有 UI orchestration 與大量行為；新狀態容易造成回歸。
- `lib/queries/transactions.js` 與 `obligations.js` 各承擔多個 use cases；新增欄位或 lifecycle 必須先切出 invariant tests。
- legacy classification 與 report mapping 有相似的 rule shape，但 owner 不同；不可為去重而合併語意。
- Data Center已收斂至canonical money presentation helper；legacy元件仍需避免另建互相矛盾的currency conversion。
- 沒有找到 source-level circular dependency 證據；**Unknown：** 尚未以專用 cycle detector 建立完整 import-cycle baseline。

更新觸發：新增第一方模組、責任 owner 移動、API surface 改變、shared helper 改變或耦合熱點拆分時更新。
