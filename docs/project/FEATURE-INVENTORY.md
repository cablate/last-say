# Feature Inventory

用途：以目前程式、API、UI與驗證證據盤點能力。`Implemented`表示有可執行路徑，不表示真實資料coverage一定complete。

Last validated against repository: 2026-07-16

## 狀態定義

- **Implemented：** 程式路徑與直接測試存在。
- **Partial：** 能力存在，但真實資料、UI或owner acceptance尚未閉合。
- **Operator-first：** 主要由外部 AI／API／CLI 操作，UI只處理material decisions或少量修正。
- **Planned：** 只有contract／plan，尚無runtime consumer。

## 交易、審查與學習

| 能力 | 狀態 | 證據 |
|---|---|---|
| CSV／ledger匯入、dedupe、source linkage | Implemented | `app/api/import-ledger/route.js`、`scripts/seed-from-ledger.js`、import tests |
| 交易查詢、filter、單筆／批次修正 | Implemented | `components/TransactionTable.jsx`、`app/api/transactions/**` |
| Optimistic stale protection | Implemented | `lib/queries/transactions.js`、`test/transaction-review-versioning.test.js` |
| Human correction／review evidence | Implemented | `correction_log`、review policy tests |
| Classification learning／rule history | Implemented | `lib/queries/rules.js`、`learning.js`、rule tests |
| AI classification preview／commit／reversal | Implemented, operator-first | transaction classification ingestion、`test/transaction-ai-classification.test.js` |

## Typed financial foundation

| Context | 狀態 | 主要 owner／入口 |
|---|---|---|
| entities、institutions、accounts、aliases、scope、sources | Implemented | `/api/finance/entities/**`、`accounts/**`、`sources/**` |
| balances | Implemented；manual UI available | `/api/finance/balance-snapshots`、`AccountRegister.jsx` |
| typed ingestion／atomic commit／reversal | Implemented | `/api/finance/imports/**`、`lib/finance/ingestion/**` |
| cards、statements、payments、installments | Implemented；operator-first beyond basic UI | `/api/finance/credit-cards/**`、`obligations.js` |
| liabilities、schedules、allocations | Implemented；operator-first | `/api/finance/liabilities/**` |
| commitments／occurrences | Implemented；review workbench integrated | `/api/finance/commitments/**` |
| instruments、trades、holdings、quotes、FX | Implemented；manual setup UI partial | `/api/finance/investments/**`、`InvestmentRegister.jsx` |
| valued items／valuation snapshots | Implemented；operator-first | `/api/finance/valued-items/**` |
| transfer matching | Implemented, versioned | reconciliation routes、`transfer_matches`、transfer tests |
| reimbursement one-to-many matching | Implemented in code schema v7+ | reimbursement routes、`reimbursement_matches`、matching tests |
| source conflicts／identity merge／redirect | Implemented | source conflict、identity routes與tests |
| browser-bound human confirmation | Implemented | `/api/finance/human-confirmations/**` |

## Analysis、review與reports

| 能力 | 狀態 | 證據與限制 |
|---|---|---|
| Inventory／8 readiness goals | Implemented | capability、inventory、readiness APIs；readiness不等於資料complete |
| 12 named analysis datasets | Implemented, operator-facing | `analysis/registry.js`、`analysis-context.js` |
| Proposal envelope | Implemented | `finance.proposal-envelope/v1`；不具canonical mutation／human authority |
| Unified impact review workbench | Implemented | `/api/finance/review-workbench`、`ConfirmationQueue.jsx`、Node＋Playwright tests |
| Management P&L | Implemented | `income-statement.js`、`finance.management-pl/v1`；只支援card-accrual management basis |
| Balance sheet／net worth | Implemented | `balance-sheet.js`、API、`BalanceSheet.jsx`；snapshot／FX／valuation不足時partial |
| Direct-method cash flow | Implemented | `cash-flow.js`、API、`CashFlowStatement.jsx`；按selected currency獨立scope，boundary／typed match不足時partial或unreconciled |
| Shared report coverage | Implemented | `lib/reporting/coverage.js`；complete／partial／empty／unmapped／unreconciled |
| 90-day forecast | Phase 0 reference only | pure synthetic projector；無foundation adapter／API／UI |
| safe-to-spend、alerts、scenarios | Planned | Control plan only |

## UI surfaces

`/`、`/transactions`、`/reports`、`/data`、`/trend`、`/corrections`、`/rules`、`/confirmations`均存在。

- `/reports`現在是三張server-backed報表，不再是Balance Sheet／Cash Flow占位頁。
- `/confirmations`是material review workbench；typed decisions回到各自owner endpoint，owner-unresolved交易deep-link到精確transaction id。
- Data Center涵蓋完整account kinds、currency-aware balances與bounded manual investment／FX資料；statements、schedule、bulk source ingestion仍採AI／API-first。

## Operations與品質

| 能力 | 狀態 | 證據 |
|---|---|---|
| checksummed migrations／newer-version refusal | Implemented | migration runner與tests |
| backup／restore／hash／integrity／freshness | Implemented CLI | backup scripts、backup tests、MP-07 real backup check |
| release verifier | Implemented | `scripts/verify-release.mjs` |
| runtime smoke | Implemented | isolated production server、health、CSP |
| browser E2E | Implemented bounded suite | Data Center／reports + review workbench，最新5/5 |
| Skill eval | Implemented | 17 adversarial cases |
| general API auth | Not implemented | localhost `127.0.0.1` trust boundary only |
| centralized monitoring／service deployment | Planned only if needed | health＋console目前為最小實作 |

## 明確不支援或未知

- Tax／statutory reporting與derivatives不在目前支援範圍。
- 不是GAAP／IFRS／audit-ready ledger；目前三張表是personal management views。
- Large DB、multi-browser、long-running concurrency與remote deployment沒有成熟證據。
- 正式DB尚未升到v9；code-level implemented不能誤寫成formal-data published。

更新觸發：功能、typed owner、API／UI、schema、report contract或驗證證據改變時更新。
