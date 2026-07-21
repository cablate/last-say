# 外部 GPT 討論的架構交叉核對

用途：把 2026-07-21 提供的 GPT 討論整理成可驗證的架構判斷，並逐項對照目前 Repository 的實作。本文不是新需求清單，也不把外部討論中的長期構想誤寫成已核准範圍。

Status: Confirmed current-state cross-check
Discussion source: `C:/Users/User/.codex/attachments/0fc343e8-67f6-4e1d-be50-9e5622d114bf/pasted-text.txt`
Last validated against repository: 2026-07-21
Repository state: current working tree；未將其他未提交變更視為本次授權可修改內容

## 結論

外部討論與目前產品方向的核心是一致的：工具不能只是把原始明細堆在畫面上，而要把「來源證據、財務語意、可重算報表、AI解讀」分層。這條個人財務路徑目前已經有可執行實作。

目前實作的準確描述是：

```text
source evidence + typed facts / relationships
→ query-time deterministic read models
→ compact AI Context Pack or bounded named datasets
→ AI interpretation / proposal
→ human confirmation where required
```

不能把目前描述成完整的：

```text
raw records → persisted financial_events → double-entry postings
→ generic allocations → personal/business consolidated accounting
```

後者是可放進長期架構的方向，但目前尚未實作，也不是現階段必要前置條件。

## 討論內容與 Repository 對照

| 討論中的能力 | 目前判定 | Repository 證據與實際邊界 |
|---|---|---|
| 原始來源證據不可被報表覆寫 | **Confirmed／Partial** | `sources`、`transaction_sources`、`ingestion_runs`、`data_change_log`、typed reversal 與 correction log 保留來源與變更脈絡；交易可被人工修正，但不是無痕覆寫。尚無獨立 `source_records` immutable event table。 |
| 經濟事件、現金清償、未來義務分開 | **Confirmed** | `lib/finance/semantics/financial-events.js`、`docs/contracts/financial-event-semantics-contract.md` 定義三條時間線；P&L、Cash Flow、Balance Sheet 與 obligations 各自使用對應 owner。 |
| Credit-card charge 與 payment 不重複認列 | **Confirmed** | `credit_card_charge`、`credit_card_payment` 語意、card payment match、P&L／Cash Flow queries 與 `test/financial-event-semantics.test.js`、report tests。 |
| 貸款本金、利息、費用拆分 | **Confirmed／Partial by evidence** | `loan_payment_allocations`、schedule component check、cash-flow／P&L mapping 已存在；沒有官方拆分時維持 `partial`，不由 APR 猜測。 |
| 通用 financial event persistence | **Partial** | 有 pure semantic envelope 與 typed contexts，但沒有持久化且統一擁有所有事件的 `financial_events` table；目前交易與 typed owner tables共同構成事實基礎。 |
| Double-entry postings／journal ledger | **Not implemented／Explicit non-goal** | Repository 沒有 `postings`、`journal_entries` 或 generic double-entry migration；`docs/contracts/financial-event-semantics-contract.md` 明確列為 non-goal，Feature Inventory也聲明不是GAAP／IFRS／audit-ready ledger。 |
| 多對多 allocations | **Partial／Typed only** | 已有 loan allocation、card payment match、transfer match、reimbursement one-to-many、investment cash match；沒有跨所有事件通用的 allocation layer，也沒有收入／帳單／訂單通用分攤。 |
| 個人／企業／合併視角 | **Partial** | `reporting_entities`、`entity_key` 與 entity-scoped queries已存在，現在以 `personal` 為主要範圍；沒有完整 business entity、combined elimination、owner draw／salary／dividend模型。`business_consolidation`在capabilities中明確列為unsupported。 |
| 收入認列與入帳分離 | **Partial／limited personal management basis** | 管理P&L有 economic recognition與cash settlement邊界；但沒有 customer、project、order、invoice、platform gross/fee/net settlement 的企業收入事件模型。 |
| 應收／應付／預收／遞延收入生命週期 | **Not implemented as a full lifecycle** | 有 `receivable`／`payable` account kind、private valued item與typed reimbursement/obligation，但沒有 customer invoice、due／collection、prepayment或deferred-revenue owner。 |
| 報表由基礎事實重算，不保存另一套報表真相 | **Confirmed** | `lib/queries/reports/**`、`lib/queries/finance/control/**` 為 server-side query-time read models；`deterministic-analysis-read-model-contract.md` 禁止把 derived read model當canonical truth。 |
| Compact AI Context Pack | **Confirmed／bounded** | `getFinancialHealthReview`、`/api/finance/control/financial-health`、`lib/finance/capabilities.js`、`.claude/skills/last-say-ops` 與 `test/control-financial-health.test.js`；先給FA-0 facts／derived，再用named datasets drillback。 |
| AI主要輸入、UI確認與少量修正 | **Confirmed** | `Final-Long-Term-Goal.md`、`.claude/skills/last-say-ops/SKILL.md`、proposal envelope、review workbench與human confirmation routes；server不內建LLM。 |
| 2026期初／期末邊界與資料完整度 | **Capability exists／real-data partial** | `account_balance_snapshots`、report coverage、reconciliation與cash boundary已存在；缺少歷史期初或匹配時報表保留 `partial`／`unreconciled`，不補成0。 |
| Gross revenue、platform fee、net payout 三者分開 | **Not a generic capability** | 現有分類與管理P&L可保存收入／費用，但沒有一個可將平台結算拆成 gross sale、fee、net cash 並與訂單逐筆分攤的通用模型。 |

## 目前是否符合現階段目標

**符合的部分：**

- 個人財務 foundation 已能保存來源、帳戶、餘額、交易、卡片、負債、投資、FX、估值、對帳與人工裁決。
- 重要語意已拆成 economic recognition、cash settlement、obligation 三條時間線。
- P&L、Balance Sheet、Cash Flow、Monthly Pulse、Spending Structure、Obligation Timeline、Raw Cash Forecast與FA-0 Health Review都是查詢時重算的read model。
- AI取得的是受限的Context Pack或named datasets；原始資料只在需要drillback或調查缺口時取用。
- 缺資料、過期快照、未配對轉帳與未知貸款拆分會變成coverage／blocker，而不是被AI或UI硬湊成完整數字。
- 目前沒有建立第二套帳戶、資產、負債或投資真相。

**不應宣稱已完成的部分：**

- 目前不是正式雙式簿記，也不是法定會計或企業ERP。
- `financial-events.js` 是語意與驗證核心，不等於已存在統一的 persisted financial event ledger。
- `allocations` 是各 typed owner 的關係，不等於通用多對多分攤引擎。
- `FA-0` 是有界的財務健康 Context Pack，不等於已經能回答可靠收入、必要支出、safe-to-spend或完整投資建議。
- 有 `business_revenue` 等管理分類，不等於已完成企業收入認列、發票、應收帳款或平台結算拆分。

## 本次整合後的範圍決策

### Confirmed now

1. 目前仍以個人／家戶優先的財務資料 foundation與Control MVP為主。
2. AI負責主要輸入、解析、查詢與提出建議；UI負責確認、歧義與少量修正。
3. 工具先負責可重現的金額、比例、曝險、壓力測試、coverage與drillback；AI負責解釋、比較與處理難以程式化的語意。
4. 報表與分析資料在查詢時由canonical facts重算，不建立報表快照作為第二真相。
5. 業務邏輯先跑順；不因這次討論直接加入完整企業會計、double-entry或大型重構。

### Inferred long-term direction

若未來真的擴張到企業／接案財務，再評估演進為：

```text
raw evidence
→ financial events
→ postings / account effects
→ generic allocations and relations
→ personal / business / combined views
→ statements, AR/AP and decision Context Packs
```

這條路徑必須先由 owner 確認企業範圍、法定／管理會計邊界與責任，再建立獨立的behavior contract、migration與驗收切片。不得因目前有 `receivable`、`business_revenue` 或 typed allocation 就假設這條路徑已經存在。

### Not now

- 正式GAAP／IFRS ledger、稅務申報、審計底稿。
- 客戶／專案／訂單／發票與完整AR/AP。
- 自動平台串接與無人監督的收入認列。
- 多租戶、遠端部署、完整會計後台與大型抽象重構。

## 驗證紀錄

本次以目前 working tree 重新核對：

- CodeGraph 在 `D:\_CabLate_Agents\general\finance-viewer` 執行 `sync .`；完成後 index 為 335 files、3,200 nodes、7,522 edges、pending changes 0。
- CodeGraph查得 `getFinancialHealthReview`、`analysisContext`、`projectCashTimeline`的實際入口，再回看source、migration、contract與tests；graph結果未單獨作為功能證據。
- `rg`核對 schema／migrations／contracts，未發現 `postings`、`journal_entries` 或 `financial_events` persisted schema；反而確認目前契約明確排除完整double-entry。
- `test/control-financial-health.test.js`驗證FA-0 deterministic replay、explicit factor scope與missing-input降級；`test/analysis-context-api.test.js`驗證named dataset、provenance、privacy與arbitrary SQL拒絕。
- `npm test`：PASS，232／232，0 fail。
- `npm run lint`：PASS，0 warnings。
- `npm run build`：PASS，Next.js production build完成，77個static pages與所有current routes成功產生。
- `git diff --check`：PASS；本次文件變更沒有whitespace error。
- 最新 `npm run verify:release`：整體 **FAIL，exit 1**；Node tests、lint、build、dependency audit、Skill eval（18／18）與其他非瀏覽器檢查通過，Chromium為4／7通過、3／7失敗。
  - 2個 `monthly-financial-pulse.spec.js`案例仍以舊版 `/control` 的 `MonthlyPulseView` heading／loading label驗收；目前 route實際掛載的是 `FinancialDashboard`，雖仍使用 Monthly Pulse API，但畫面契約已變更。這是E2E與目前UI的落差，不是由本次文件整合推導出的資料計算錯誤。
  - 1個 Data Center案例在幣別選單等待原始字串 `JPY`；目前 `AccountRegister` 透過 `displayCurrency`顯示人類可讀的「日圓」，而不是裸露ISO code，因此測試selector與目前呈現契約不一致。該案例仍應在後續更新E2E selector後重新驗證完整流程。
- 未執行正式DB寫入；release verifier使用隔離的synthetic DB，未以 `data/finance.sqlite` 作為本次驗證輸入。這些限制不影響本次對資料模型與read model程式邊界的判定，但代表瀏覽器release gate尚未全綠，也不等於owner已完成正式資料接受。

## 需要更新的情況

當新增統一 financial event／postings／allocation schema、企業 entity／AR/AP、報表計算 owner、AI Context Pack路由或本次範圍決策改變時，必須重新核對本文、`Final-Long-Term-Goal.md`、`CURRENT-STATUS.md`、`FEATURE-INVENTORY.md`、架構／資料流文件與Roadmap。
