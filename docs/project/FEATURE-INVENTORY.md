# Feature Inventory

用途：以實作、測試與 UI／API 入口盤點功能狀態。`Implemented` 表示有程式路徑，不代表所有使用者旅程或正式營運能力都成熟。

Last validated against repository: 2026-07-15

## 狀態定義

- **Implemented：** 主要程式路徑與直接證據存在。
- **Partial：** 核心的一部分存在，但流程、UI、驗證或語意尚未閉合。
- **Operator-only：** backend／API 可用，主要由外部 AI 或 CLI 操作，沒有完整手動 UI。
- **Unavailable state：** UI明確說明正式能力未實作，不呈現推測結果。
- **Planned：** 只存在 plan／contract，未找到產品實作。
- **Unknown：** Repository 不足以確認實際可用性。

## 交易審查與學習

| 能力 | 狀態 | 證據與影響 |
|---|---|---|
| ledger／CSV 匯入、dedupe、source linkage | Implemented | `app/api/import-ledger/route.js`、`scripts/seed-from-ledger.js`、`test/import-dedupe.test.js` |
| 交易清單、filter、單筆／批次修改 | Implemented | `app/(app)/transactions/page.js`、`components/TransactionTable.jsx`、`app/api/transactions/**` |
| 人工 review 與 correction history | Implemented | `lib/queries/transactions.js`、`correction_log` trigger、`test/reviewed-on-correction.test.js` |
| classification rules 與歷史 | Implemented | `lib/queries/rules.js`、`app/api/rules/**`、`rule_change_log`、`test/rule-history-reclassification.test.js` |
| 由修正產生／更新規則 | Implemented | `lib/queries/learning.js`、`test/learning-context.test.js` |
| 規則重分類並保護 human-reviewed 交易 | Implemented | `lib/queries/rules.js#reclassifyRuleDependents`、相關 tests |

## 分析與報表

| 能力 | 狀態 | 證據與影響 |
|---|---|---|
| Overview、支出方向、breakdown、top movers | Implemented | `components/Overview.jsx`、`lib/queries/index.js`、`lib/queries/core.js`、dashboard API routes與spend tests |
| Trend | Implemented | `app/(app)/trend/page.js`、`app/api/trend/route.js` |
| 管理 P&L、mapping、coverage | Implemented | `lib/queries/reports/**`、`lib/reporting/**`、`components/reports/IncomeStatement.jsx`、reporting tests |
| Balance Sheet | Unavailable state | `components/reports/ReportsView.jsx#StatementUnavailable`；無正式query／API，畫面連到Data Center |
| Cash Flow | Unavailable state | 同上；無正式activity classification／reconciliation query |
| governed analysis contexts | Implemented, operator-facing | `lib/finance/analysis/registry.js`、`lib/queries/finance/analysis-context.js`、`app/api/finance/analysis-context/route.js` |
| 90 日 forecast | Phase 0 reference only | `lib/finance/control/project-cash-timeline.js`可對synthetic fixture純計算；無foundation adapter／API／UI，readiness仍明示runtime unavailable |
| safe-to-spend、alerts、scenarios | Planned | 僅 control plan；無 schema／query／API／UI |

## Typed financial foundation

| Bounded context／能力 | 狀態 | 主要入口 |
|---|---|---|
| reporting entities、institutions、aliases | Implemented, operator-only | `app/api/finance/entities/**`、`institutions/**`、`lib/queries/finance/entities.js` |
| accounts、aliases、balance snapshots | Implemented；core manual UI | `/api/finance/accounts/**`、`balance-snapshots`、`components/finance-data/AccountRegister.jsx`；create UI涵蓋完整canonical kinds/currencies |
| sources、source expectations、scope attestations | Implemented, operator-only | `/api/finance/sources/**`、`source-expectations/**`、`scope-attestations/**` |
| capability／inventory／8 readiness goals | Implemented | `/api/finance/capabilities`、`inventory`、`readiness`、`lib/finance/readiness/policy.js` |
| typed preview／staging／atomic commit | Implemented | `/api/finance/imports/**`、`lib/finance/ingestion/index.js`、compound ingestion tests |
| import reverse preview／confirmed reversal | Implemented | `/api/finance/imports/[key]/reverse*`、`lib/finance/ingestion/reversal.js` |
| card profiles／statements／items／payment matches／installments | Implemented；UI partial | `/api/finance/credit-cards/**`、`lib/queries/finance/obligations.js` |
| liabilities／loan schedules／allocations | Implemented；UI partial | `/api/finance/liabilities/**`、`components/finance-data/ObligationRegister.jsx`；profile可手動建立，schedule/allocation仍operator-first |
| commitment templates／occurrences | Implemented；UI partial | `/api/finance/commitments/**`、`components/finance-data/ObligationRegister.jsx` |
| instruments／trades／holdings／quotes／FX／cash matches | Implemented；valuation setup UI partial | manual instrument／holding／quote／FX可由`InvestmentRegister`建立；trade/cash match與official source ingestion仍operator-first |
| valued items／valuation snapshots | Implemented；operator-only create、UI read-only | `app/api/finance/valued-items/**`、`lib/queries/finance/valued-items.js`；`components/finance-data/ReconciliationRegister.jsx`只顯示inventory counts，沒有manual create UI |
| transfer matches／source conflicts／review tasks | Implemented | `/api/finance/reconciliation/**`、`source-conflicts/**`、`review-tasks/**` |
| identity redirects／confirmed merge | Implemented | `/api/finance/identity-merges/preview`、`identity-redirects/**` |
| human confirmation／one-time authorization | Implemented | `/api/finance/human-confirmations/**`、`lib/queries/finance/authorization.js` |

## UI 與操作面覆蓋

**Confirmed pages：** `/`、`/transactions`、`/reports`、`/data`、`/trend`、`/corrections`、`/rules`、`/confirmations`，證據為 `app/**/page.js` 與 sidebar navigation。

### 已知 UI／backend 落差

- Account create已涵蓋完整canonical kinds/currencies；既有account kind/currency在UI視為identity而唯讀，避免已有facts時就地改語意。
- `InvestmentRegister`已能手動建立instrument、holding snapshot、manual quote與FX；trade／cash match／official statement ingestion仍依賴external AI/API。
- entities、institutions、source expectations、statements、schedules等能力仍沒有完整UI。這符合現行「external AI operator」定位，但onboarding必須明說。
- Money presentation已統一到`lib/finance/money/presentation.js`，JPY/TWD/USD round-trip與browser E2E均有證據。

## Operations 與品質

| 能力 | 狀態 | 證據 |
|---|---|---|
| DB migration ledger、checksum／newer-version refusal | Implemented | `lib/db/migration-runner.js`、migration tests |
| backup／restore、integrity／manifest hash／freshness | Implemented CLI | backup、restore、`finance-backup-check.mjs`與health/restore tests |
| release verifier | Implemented | `scripts/verify-release.mjs` |
| runtime smoke | Implemented focused smoke | health、transactions page與production CSP |
| critical browser E2E | Implemented bounded suite | `e2e/data-center-and-reports.spec.js`；isolated DB、Chromium、CI/release gate |
| CI／CodeQL | Implemented | `.github/workflows/**` |
| authentication／authorization | Not implemented for general routes | localhost trust boundary；高風險操作另有 confirmation |
| logging／monitoring／alerting | Minimal／not implemented | console errors 與 `/api/health`；無集中式 observability |
| deployment／rollback automation | Not implemented | 無 container／service／release manifest；手動 localhost 啟動 |

## 明確不支援或未確認

- **Confirmed unsupported：** tax／statutory reporting、derivatives。
- **Unknown：** 大規模資料量、長時間運行、多瀏覽器併發下的效能與 race characteristics，現有測試沒有提供正式基準。
- **Unknown：** 非技術使用者能否在不看開發文件的情況完成首次建檔；沒有 usability evidence。

更新觸發：新增／移除功能、UI 與 backend 覆蓋改變、contract 狀態改變或驗證結果改變時更新。
