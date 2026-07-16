# Data And Flows

用途：描述 Last Say 的持久資料模型、事實層次、資料生命週期、主要寫入／分析流程，以及一致性與資料遺失風險。

Last validated against repository: 2026-07-16

## 資料庫與表示規則

- **Confirmed：** 單一 SQLite，預設 `data/finance.sqlite`，可由 `FINANCE_DB_PATH` 覆寫。
- **Confirmed：** repository code與正式DB schema version 10；`schema_migrations` ledger由`lib/db/migration-runner.js`管理checksum與順序。2026-07-16正式postflight確認ledger `1..10`、1,078筆legacy transactions與交易雜湊在v6→v9→v10後保持不變，`integrity_check=ok`且0 FK violations。
- **Confirmed：** money 的 typed canonical 表示是 integer minor units + ISO-like currency；`lib/finance/money/decimal.js` 定義 TWD／USD 等 exponent 2、JPY exponent 0。
- **Legacy / compatibility：** legacy transaction 欄位 DDL 宣告為 `REAL`，migration 後實際保存整數 cents。名稱與型別不表達現行語意，修改時不可假設是 major units。
- **Confirmed：** dates／timestamps 以 ISO-like TEXT 保存；as-of、period 與 source freshness 是財務解釋的一部分。

## 資料分層

```mermaid
flowchart TB
    Raw["Raw source evidence\nstatement/file metadata"] --> Canonical["Canonical typed facts\nidentity, transaction, balance, obligation, holding"]
    Canonical --> Match["Reconciliation and review\ntransfer, payment, conflict, task"]
    Canonical --> Derived["Deterministic read models\nP&L, balance sheet, cash flow, valuation, inventory, readiness"]
    Match --> Derived
    Derived --> Interpretation["External AI interpretation"]
    Human["Human decisions"] --> Canonical
    Human --> Match
    Human --> Audit["Append-only evidence"]
```

事實、工具推導與 AI 解釋必須分開。Repository 不應把 AI summary 寫回 canonical financial facts，除非經 typed contract、來源與 authority policy。

## Schema 群組

### Legacy transaction／review／reporting

| 表 | 責任 |
|---|---|
| `accounts`、`sources` | legacy 起源但已由 shared-kernel migration 增補 canonical key、entity、institution、status、period 等欄位 |
| `transactions`、`transaction_sources` | 交易事實、來源 row linkage、dedupe／typed identity |
| `classification_rules`、`rule_change_log` | merchant／direction 分類規則與 append-only rule mutation evidence |
| `correction_log` | 人工修改前後值與理由；append-only |
| `report_mapping_rules`、`transaction_report_mappings` | P&L line mapping，與 classification rule 分離 |
| `tags`、`transaction_tags` | legacy tag 關聯 |

### Shared kernel（migration 0002）

`reporting_entities`、`institutions`、`institution_aliases`、`account_aliases`、`scope_attestations`、`source_expectations`、`source_expectation_goals`、`data_change_log`、`human_confirmation_requests`，並擴充 `accounts`／`sources`。

### Ingestion 與 balances（0003）

`ingestion_runs`、`ingestion_run_contexts`、`ingestion_items`、`account_balance_snapshots`，並為 transactions 加入 typed identity／status／source 欄位與 unique indexes。

### Obligations（0004）

`credit_card_profiles`、`credit_card_statements`、`credit_card_statement_items`、`credit_card_payment_matches`、`credit_card_installment_plans`、`credit_card_installment_entries`、`liability_profiles`、`loan_schedule_entries`、`loan_payment_allocations`、`commitment_templates`、`commitment_occurrences`。

### Investments（0005）

`instruments`、`investment_trades`、`holding_snapshots`、`market_quotes`、`fx_quotes`、`investment_cash_matches`。

### Reconciliation／other assets（0006）

`valued_items`、`valuation_snapshots`、`transfer_matches`、`source_conflicts`、`review_tasks`、`identity_redirects`。

### Reimbursement matching（0007）

`reimbursement_matches`保存報銷流入、authority、status、review與version；`reimbursement_match_items`保存一至多筆支出allocation。Gross transactions不改寫，rejected／reversed match保留歷史列但不參與active reconciliation。

### Obligation ingestion lifecycle（0008）

Migration `0008`為card profile／statement／payment match／installment plan、liability／schedule／allocation、commitment／occurrence補上`ingestion_run_id`、`record_status`與`reversed_by_run_id`。Compound ingestion保存run ownership；confirmed reversal以soft lifecycle排除active reads與reconciliation，但保留header、child、source與audit evidence。若既有UNIQUE identity會讓修正run無法重建，reverse preview會保留原run為committed並回具名blocker。

### Transfer decision lifecycle（0009）

Migration `0009`只為既有`transfer_matches`補上`version`與`updated_at`，支援proposed match以optimistic version check確認或拒絕。Transfer owner現在驗證active outflow→inflow、same entity／currency、different account與累計allocation bounds；rejected rows保留evidence但不參與typed legs。Reconciliation summary另從active cash rows產生不持久化的unmatched transfer candidates，避免零registered matches被誤報為完整。

**Confirmed missing schema：** 沒有 forecast runs／events、reserve policy、safe-to-spend decisions、financial alerts 或 scenario tables。

## 流程 1：legacy statement → human learning

```mermaid
sequenceDiagram
    participant AI as External AI
    participant Import as import-ledger / seed script
    participant DB as SQLite
    participant UI as Transactions UI
    participant Rules as Learning / Rules

    AI->>Import: normalized ledger + source metadata
    Import->>DB: validate, dedupe, link source rows
    DB-->>UI: transactions + confidence + review state
    UI->>DB: human correction / batch review
    DB->>DB: append correction_log
    UI->>Rules: propose or mutate rule
    Rules->>DB: reclassify linked non-human rows
    Rules->>DB: append rule_change_log
```

重要 invariant：human classification／reviewed transaction 不可被普通 rule mutation 靜默覆蓋；dedupe 重跑應增加 source linkage而不是重複經濟事件。

## 流程 2：typed ingestion

```mermaid
stateDiagram-v2
    [*] --> Preview: validate finance/v1 payload
    Preview --> Staged: create ingestion run/contexts/items
    Preview --> Rejected: schema/identity/source error
    Staged --> Committed: commitIngestion in one DB transaction
    Staged --> Expired: timeout / abandoned
    Committed --> ReversePreview: operator requests reversal
    ReversePreview --> ConfirmedReverse: browser confirmation + one-time authorization
    ConfirmedReverse --> Reversed: soft reverse dependents + audit
    Rejected --> [*]
    Reversed --> [*]
```

`lib/finance/ingestion/index.js#commitIngestion` dispatches typed contexts；route 是 `app/api/finance/imports/[key]/commit/route.js`。Unique keys、run state 與 transaction boundaries 支援 idempotency／atomicity。reversal 會先檢查依賴並保留 history，不做任意硬刪除。

## 流程 3：analysis readiness

1. Agent 讀 `/api/health` 與 `/api/finance/capabilities`。
2. 讀 `/api/finance/inventory` 與特定 goal 的 `/readiness`。
3. readiness 依 `scope`、balances、sources、obligations、valuation、reconciliation 等 requirements 回傳 status、gaps、priority、next actions、source watermark。
4. 只有足夠時，agent 向 `/api/finance/analysis-context` 要求白名單 dataset。
5. server 只接受 registry 中 12 個 dataset 與 allowlisted filters，並限制 dataset count／response bytes；其中5個candidate datasets以`finance.proposal-envelope/v1`指向typed owner、evidence、impact與missing evidence，但不具canonical write或human authority。
6. AI 在 facts／derived data 之外增加 interpretation，不能把 Unknown 補成數字。

目前 8 個 readiness goals：`spending_history`、`cash_position`、`net_worth`、`debt_obligations`、`investment_value`、`cash_flow_statement`、`liquidity_forecast_90d`、`tax_or_derivatives`。最後一項明確要求 separate context；forecast readiness 不等於 forecast engine。

## 流程 4：manual investment evidence

Data Center 的 manual holding、market quote與FX輸入不直接建立無來源的fact。各route呼叫 `lib/queries/finance/investments.js` 的atomic composite，在同一DB transaction內建立`manual_note` source與typed fact；任何一步失敗都rollback。manual entry的authority是user-confirmed／manual-estimate，不等同官方statement或market feed。

```mermaid
flowchart LR
    UI["Data Center manual form"] --> Route["manual holding / quote / FX route"]
    Route --> Tx["single SQLite transaction"]
    Tx --> Source["manual_note source"]
    Tx --> Fact["typed holding / quote / FX fact"]
    Source --> Valuation["deterministic valuation"]
    Fact --> Valuation
```

正式statement、trade history或大量匯入仍應走external AI／typed ingestion，不應把manual UI當成來源擷取器。

## 流程 5：Control Phase 0 reference timeline

`lib/finance/control/project-cash-timeline.js`可從純input facts投影90日daily timeline，驗證duplicate protection、loan component sum、uncertain income exclusion、unknown commitment造成coverage降級、reserve breach、runway與safe-to-spend gate。`test/fixtures/financial-control/**`只有synthetic fixture。

這是**reference implementation，不是runtime產品能力**：尚未讀SQLite、沒有API／UI、沒有owner核准的reserve／income政策，也沒有保存forecast run。它的用途是先鎖定語意，避免未來把未知收入或未完整commitment誤算為可花金額。

## 流程 6：統一待審工作台

`GET /api/finance/review-workbench`將open review tasks、human confirmations與owner-unresolved transactions投影成`finance.review-workbench/v1`。每個material item帶evidence、reason、financial／timeline impact、missing information、before／after preview、typed action與recovery。

```mermaid
flowchart LR
    Facts["Typed facts／review tasks"] --> WB["Review workbench read model"]
    WB --> UI["Confirmations UI"]
    UI --> T["Transfer owner"]
    UI --> R["Reimbursement owner"]
    UI --> C["Commitment owner"]
    UI --> S["Source-conflict owner"]
    UI --> X["Exact transaction correction deep-link"]
```

Generic `review_tasks.status`不是typed decision owner；transfer／reimbursement／commitment／conflict必須先由各自mutation關閉，否則會留下orphan semantic state。Stale version回409，UI完整refetch並保留使用者已輸入備註。

## 流程 7：三張管理報表

- P&L依economic recognition；card purchase只認一次，settlement／principal／investment purchase／confirmed own transfer不重複列支出。
- Balance Sheet依as-of account／holding／valuation snapshots；投資account-level snapshot存在時優先，holding只做fallback，缺FX／估值／current debt snapshot時維持partial。
- Cash Flow依cash settlement，按selected currency只納入同幣別cash accounts；confirmed own transfer抵銷，loan allocation拆principal／interest／fee，reimbursement allocation必須精確對上整筆receipt才可取得typed owner。
- 三張表共用coverage contract與stable resource／transaction keys；數字不必相同，但差異必須由timeline、typed match或blocker解釋。

## 流程 8：高風險確認

browser 取得 session nonce → server 建立待確認 request → 同源頁面以 Origin／Sec-Fetch-Site與 cookie nonce確認 → server發一次性 receipt／authorization → scope declaration、import reversal 或 identity merge 消耗授權。確認資料有 expiry／status；重放應失敗。

## 資料生命週期

| 階段 | 保存／刪除行為 | 風險控制 |
|---|---|---|
| 收集 | source metadata、optional private files | 原始檔留在 ignored private zone；不要把路徑／內容寫入公開 artifact |
| Preview | 驗 contract、identity、context | preview 不應寫 canonical facts |
| Commit | atomic typed writes + data change evidence | unique key、transaction、status guard |
| Review | correction／rule／conflict／task state | append-only evidence與 human authority |
| Derive | query-time read models，無獨立 cache | freshness／coverage／scope 隨輸出附帶 |
| Reverse | soft status／redirect／audit | preview + confirmation，不硬刪 evidence |
| Backup | bundle + manifest + hashes | explicit private destination；未加密；可read-only檢查integrity／freshness |
| Restore | 僅新 target | integrity check；人類決定是否切換 active DB |

Repository 未定義一般資料 retention／purge policy；**Needs owner decision**，尤其是 source metadata、confirmation records與已反轉資料應保留多久。

## 一致性、併發與 retry

- WAL + `busy_timeout=5000` 處理有限本機併發；重要 writes 使用 transaction／`BEGIN IMMEDIATE`。
- synchronous `DatabaseSync` 符合目前單機規模，但大型 query／write 會阻塞 request process；尚無效能基準。
- 沒有 background retry queue；HTTP client／agent應在讀取新 inventory 前確認 commit 結果，不能對未知狀態盲目重送非冪等 operation。
- ingestion identity 與 confirmation token 提供局部 idempotency／replay safety；一般 CRUD 並非全部有 idempotency key。
- **Unknown：** 高頻多 request 寫入與長時間 server 運行的 race／lock特性，沒有壓力測試證據。

## 資料正確性與治理風險

- Data Center money UI已使用canonical exponent與exact decimal conversion；後續新增金額欄位若繞過shared helper，仍可能重新引入倍率錯誤。
- legacy `REAL` 欄位實際存 cents，容易被新程式誤讀。
- P&L 與 classification 是不同 mapping owner，不應混用。
- Balance Sheet／Cash Flow已有formal management read models與UI；但`partial`不等於`complete`，Control Phase 0 pure projector仍不是runtime forecast。
- `source_file`／CSV path 等 local metadata 若直接回傳或記 log，可能暴露本機路徑；目前 `/api/import-ledger` response 含 `csvPath`，只適合 localhost boundary。
- 沒有 DB 加密；backup bundle也不加密，存取控制由 OS／使用者負責。

更新觸發：schema／migration、money／identity semantics、資料分層、主要流程、retention、transaction／retry或備份策略改變時更新。
