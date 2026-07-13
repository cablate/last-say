# Last Say 財務資料基礎建設 Master Plan

> - 文件地位：資料基礎建設 canonical spec-plan
> - 狀態：`Ready for Phase 0`；Phase 1-7 需依前置 contracts、spikes 與驗收逐步解鎖
> - 日期：2026-07-14
> - 上位目標：[Last Say Long-Term Goal](../long-term-goal.md) `LTG-1`
> - 產品範圍：個人／家庭優先、local-first、外部 AI operator、TWD 預設、多幣別原幣儲存
> - 本計畫擁有：核心財務資料語意、持久化、遷移、CRUD、AI data API、readiness 與人類資料維護介面
> - 下游規格：[Accounting Reports Architecture Spec](../accounting-reports-spec.md)、[Financial Control Master Plan](./master-financial-control-plan.md)

## 1. 結論先行

目前 Last Say 的強項是信用卡／銀行流水匯入、商家分類、人工審核、規則記憶與第一版管理損益。它還不是完整的個人財務資料平台，因為重要事實仍缺少正式 owner：

- 帳戶身分、歸屬、幣別與納入範圍；
- 使用者對「有哪些帳戶／負債／投資已盤點」的範圍聲明，以及各來源預期更新頻率；
- 官方／人工餘額快照；
- 信用卡帳單、未出帳、應繳與付款關係；
- 貸款條件、剩餘本金與本金／利息拆分；
- 投資標的、交易、持倉、價格與匯率；
- 固定收入、付款承諾與其他人工估值資產／負債；
- AI 執行前可查詢的資料完整度、缺口與新鮮度。

本計畫完成後，Last Say 應成為：

> **可由外部 AI 安全讀寫、由人類裁決歧義、由程式維持財務不變量，並能明確說出資料缺口的個人財務資料基礎。**

這次不把所有金融商品硬塞進單一萬用表，也不追求無限相容。採用以下架構：

> **Shared Kernel + Typed Bounded Contexts + Read Models**

- Shared Kernel 統一 entity、institution、account、source、money、currency、authority、review、audit 與版本語意。
- 銀行／信用卡流水、負債、投資、承諾、人工估值資產各自擁有 typed schema 與不變量。
- 跨領域分析透過受控 query/read model 組合，不以共用一張表為前提。
- 當新商品無法沿用既有 context 而不增加高風險 nullable 欄位、破壞單位／生命週期／會計語意時，必須另建 bounded context 或明確不支援。

本計畫的「完成資料儲存」是指：下列明定範圍均有可驗證的 schema、API、來源、審核、稽核、readiness 與 AI 操作契約；不是宣稱世上所有金融商品都已建模。

---

## 2. Repo Reality：2026-07-14 現況

以下事實已對照目前 `main`、`lib/db.js`、API routes、tests 與 Last Say Skill；實作前仍需重跑列出的 repo checks。

| Area | 現況證據 | 對本計畫的影響 |
|---|---|---|
| Runtime | Next.js 15、React 19、Node 22 `node:sqlite`、`node --test` | 沿用 JavaScript／CJS query owner；不為本計畫導入 ORM 或 server-side AI |
| DB | `lib/db.js` 以單一 `SCHEMA_SQL` 建表，`SCHEMA_VERSION = 1`，使用 `PRAGMA user_version` | 多 context schema 前必須先落地正式 migration ledger；`lib/db.js` 保留相容 facade |
| Migration | `initializeDatabase()` 在 `BEGIN IMMEDIATE` 內建表、migrate、寫版本；拒絕 newer DB；`migrateSchema` 目前已 export | 保留原子性與 newer-version refusal；既有 Accounting Spec 對 export 狀態的描述已漂移，須同步修正 |
| 現有帳戶 | `accounts(id, name UNIQUE, institution TEXT, account_type, masked_number)` | 可增欄但不能再以 `name` 當 canonical identity；新增 stable key 與 source alias mapping |
| 現有來源 | `sources` 保存 source type、file、description、statement month、row count | 擴充成 source evidence；不可另建互不相連的第二套文件來源 |
| 現有交易 | `transactions` 是單一 account 的匯入 row，含 dates、amount/inflow/outflow、flow type、category、confidence、reason、balance 與 review state | 繼續擁有銀行／卡片活動與分類；不可承擔投資 quantity、loan schedule 等所有語意 |
| 去重 | `dedupe_key` 唯一；卡片重複同額同名交易使用 occurrence；重匯不覆寫人工分類 | 新 context 必須有自己的 deterministic identity／idempotency，並保留現有 dedupe 行為 |
| 金額 | 既有 DDL 是 `REAL`，但值自 migration 後代表 integer cents | 新 schema 一律使用 `INTEGER ..._minor`；相容層明示舊 `amount` 為 TWD cents，不延續模糊命名 |
| 人工權威 | `correction_log` append-only；人工分類不被重匯或規則覆寫 | 新 context 需一致的 human-authoritative review 與 append-only change evidence |
| 規則生命週期 | 規則語意變更會原子地重新校正未審歷史，保留人工決策 | 新 mapping／alias／readiness 規則不得繞過既有權威模型 |
| Reporting | P&L、report mapping、coverage 已實作；Balance Sheet／Cash Flow contracts 存在但資料 owner 未完成 | 本計畫擁有上游 facts；報表只能消費，不可另造 snapshots／transfers |
| External AI | `.claude/skills/last-say-ops/` 是自含操作契約；現有 Flow A/B 只覆蓋流水、分類、規則與 P&L mapping | 每個 Phase 同步 Skill；最終 AI 先查 capabilities／inventory／readiness，再 preview／commit |
| API safety | 現有寫入使用欄位白名單、參數化 SQL；匯入路徑限制於 ignored directories | 新 API 不提供 arbitrary SQL、generic column patch、任意 URL fetch 或直接 DB path write |
| Tests | 目前有 16 個 `node --test` 檔，涵蓋 DB foundation、import dedupe、review、rule history、P&L 與 runtime safety | 延續 real temp SQLite 黑箱整合測試；每個 Phase 使用獨立 `FINANCE_DB_PATH` |
| Working tree | 本計畫前已有 README、Long-Term Goal 與 Financial Control Plan 文件變更 | 實作／commit 時必須保留這些使用者要求的文件，不能以 cleanup 名義丟棄 |

### 2.1 現有能力可以直接重用

- `lib/db.js` 的 lazy singleton、WAL、foreign keys、busy timeout、transaction wrapper 與 newer-version refusal。
- `transactions`、`transaction_sources`、`sources` 的匯入來源與去重關係。
- `classification_rules`、`correction_log`、`rule_change_log` 的 human-over-AI 權威模式。
- `lib/queries/*` 的 route → query → DB owner 邊界。
- `lib/reporting/coverage.js` 的 coverage 心智模型。
- `FINANCE_DB_PATH`、temp DB tests、demo seed 與 release privacy scan。
- Last Say Skill 的外部 AI／本機 API／人類終審操作模型。

### 2.2 不可直接重用為新基礎的部分

- `accounts.name` 不可繼續當跨來源 account identity。
- `source_type LIKE '%信用卡%'`／`'%帳戶%'` 不可成為新 context 的正式 account-kind 判斷。
- transaction running `balance` 只能作來源 hint，不能替代 snapshot。
- `flow_type` 的既有中文字串需保留相容，但新 domain logic 不能持續以散落字串判斷所有金融語意。
- `transactions.amount/inflow/outflow` 不適合保存價格、持倉數量、FX rate 或攤還表。
- 現有 `/api/meta` 只提供交易月份與分類統計，不能回答完整財務 inventory／readiness。

---

## 3. Product Intent 與 GORE

### 3.1 本階段 Primary Goal

**DF-PG1：使用者與外部 AI 能在不直接操作 SQLite、不猜測缺失事實的前提下，持續建立、維護、查詢一份足以支援個人財務分析的可追溯資料集；工具能程式化指出每種分析目前缺少、過期、衝突或未確認的資料。**

DF-PG1 是 [`LTG-1`](../long-term-goal.md) 的資料基礎 operationalization。本階段不以「完成某張報表」或「新增很多表」取代這個使用者成果。

### 3.2 Actors And Jobs

| Actor | Job to be done | 不應被迫承擔的工作 |
|---|---|---|
| 一般使用者 | 提供能取得的帳單、餘額、契約與投資資料，確認必要歧義 | 先理解 schema、手算對帳或填滿所有可能欄位才能開始 |
| 家庭／深度使用者 | 維護多機構、多帳戶、多幣別與多種資產負債 | 用多份試算表重複建同一份資料 |
| 外部 AI operator | 盤點現況、判斷缺口、解析異質來源、查價格、提交 typed payload、產生分析 | 直接寫 SQLite、任意 SQL、猜不存在的帳戶／餘額、繞過 review |
| 人類 reviewer | 裁決低信心 account mapping、來源衝突、價格、負債條件與 reconciliation | 逐筆重做可由程式驗證的格式、總和與重複檢查 |
| Last Say runtime | 驗證、去重、持久化、計算、readiness、audit 與受控 read model | 在 server 內呼叫 LLM、代替人類做財務決策、對缺資料輸出假精準 |
| 開源維護者 | 新增 adapter、instrument/profile 或 bounded context | 接觸使用者真實資料、為單一銀行把格式硬編入 shared kernel |

### 3.3 Supporting Goals

| Goal ID | Goal | Observable outcome |
|---|---|---|
| DF-G1 | 建立穩定身分與範圍 | entity、institution、account、instrument 不再依顯示名稱猜測；同一來源能重複映射到同一資源；分析範圍有可追溯的人類聲明 |
| DF-G2 | 保存來源與權威 | 每筆重要 fact 可追到 source、as-of、authority、review state；衝突來源不被靜默覆蓋 |
| DF-G3 | 完成現金／銀行／信用卡基礎 | 現有流水不退化，且能保存 account metadata、posted/pending、正式餘額與卡片帳單狀態 |
| DF-G4 | 完成負債與未來義務基礎 | 貸款條件、剩餘本金、schedule、付款拆分與 commitments 有 typed owner |
| DF-G5 | 完成投資與估值基礎 | instruments、trades、holdings、quotes、FX 與 valuation freshness 可追溯且不使用浮點近似作事實 |
| DF-G6 | 提供有限但可擴充的其他資產／負債 | 常見人工估值項目能保存；不符合核心假設者被明確降級或切出新 context |
| DF-G7 | 建立安全、冪等的 AI 寫入流程 | AI 可 preview、validate、commit、重試；重複提交不產生重複 facts，人工決策不被覆寫，高風險操作沒有 confirmation receipt 就 fail closed |
| DF-G8 | 建立 machine-readable readiness | AI 可先問「為了分析 X 還缺什麼」並取得 blocker、freshness、priority 與 next action；系統不從現有 row 數量猜測資料宇宙已完整 |
| DF-G9 | 建立可自然語言分析的受控讀取面 | AI 可按 scope、期間與 dataset 取 context pack，不需要任意 SQL 或整庫 dump |
| DF-G10 | 控制抽象與維護成本 | 每個新類型都經 extension gate；shared kernel 不因特殊商品變成 nullable mega-schema |
| DF-G11 | 保護既有使用者資料與工作流 | legacy DB 可原子升級；信用卡匯入、分類、review、rules、P&L 與 human evidence 持續通過 |

### 3.4 Soft Goals

- **可信**：重要數字知道來源、時間、權威與推導方式。
- **低維護**：AI 做格式研究與資料準備，人類只處理必要裁決。
- **可理解**：資料缺口以使用者問題說明，不以 table／column 名稱丟給使用者。
- **可恢復**：失敗匯入不留下半套 canonical state，重試不重複。
- **可擴充但克制**：新增常見類型成本低；特殊類型不污染共享核心。
- **local-first**：真實資料、價格查詢結果與 AI 操作證據留在本機 DB／ignored paths。
- **AI 可替換**：API 與 Skill 不綁 Claude、Codex 或特定 provider。

### 3.5 Domain Invariants

1. 原始金額、日期、來源文字與來源檔 fingerprint 不可為了對帳或分析而竄改。
2. Source fact、human assertion、AI proposal、derived value、AI interpretation 必須分層，不能共用同一權威標記。
3. 人類明確確認優先於 AI、mapping rule、歷史統計與市場資料猜測。
4. 所有新金額欄位使用 ISO 4217 currency + integer minor units；quantity／price／FX rate 不得用 JavaScript `Number` 或 SQLite `REAL` 作 canonical 精度來源。
5. 交易流水不能替代官方／人工 balance snapshot；snapshot 也不能抹除流水差額。
6. 投資 current value 必須由 holding + quote + FX + rounding policy 推導；任何 quote 都要有 `as_of` 與 source。
7. 信用卡消費是支出／負債形成，繳卡費是現金清償；不得重複計入支出。
8. 貸款本金是負債清償，利息與費用才是期間成本。
9. 自有帳戶轉帳在兩端未確認前不得靜默視為收入／支出或完成 reconciliation。
10. Canonical table 禁止 EAV 作主要模型，禁止以 opaque JSON 取代可驗證 typed fields；JSON 僅限 staging、audit before/after 與原始 provider payload。
11. 每個 mutation 必須有明確 transaction boundary、idempotency 行為與 audit actor。
12. Existing `transactions.dedupe_key`、人工分類與 append-only logs 的語意不得被 migration 改寫。
13. 缺必要資料、過期資料、未確認 mapping 或不支援商品時，readiness 不得為 `complete`。
14. 工具不提供 arbitrary SQL、任意欄位 patch、server-side LLM 或由 AI 自由拼接表名／欄位名的能力。
15. 所有開發、測試、demo、截圖與 migration rehearsal 必須使用隔離 DB，不得碰 `data/finance.sqlite`。
16. 每個新增 API、enum、payload、readiness goal 與人類 review 邊界都必須在同一 Phase 同步 `.claude/skills/last-say-ops/`。
17. 只要分析目標依賴「所有帳戶／負債／投資」這類未知宇宙，沒有在有效期限內的人類 scope attestation 時，readiness 不得為 `complete`；資料列存在不等於範圍完整。
18. 已知帳戶或來源若有 user-confirmed 更新期待，缺期、超過 grace period 或只剩推測資料時必須成為 freshness gap，不能因最近一次值仍可讀就靜默沿用。
19. 一致性備份不得只複製 WAL 模式下的主 `.sqlite` 檔；backup／restore 必須由經驗證的 SQLite 一致性流程負責，且不得暴露成 AI 可下載整庫的 API。
20. Request 自稱 `actor_type=human` 不是人類身分證明。Merge、`declared_complete`、active DB replace 等高風險操作必須引用綁定 preview hash／resource version 的一次性 human confirmation receipt；缺少、過期、重放或 payload 改變時拒絕 commit。

### 3.6 Non-Goals

- 本階段不完成 Safe-to-Spend、90 天 forecast、主動 alerts 或財務建議。
- 本階段不把自然語言聊天介面內建到 Last Say；自然語言由外部 AI 提供。
- 不提供銀行／券商登入、自動同步、交易下單或付款操作。
- 不做稅務申報、完整投資 tax lots、衍生品定價、保證金風險、DeFi protocol state 或企業合併報表。
- 不承諾 audit-grade double-entry bookkeeping；正式 journal／accrual 仍屬 Accounting bounded context。
- 不建立 OFX／ISO 20022 等全格式交換層或保證跨產品無損匯出；本階段提供的是可驗證 SQLite 備份／還原與 versioned APIs。
- 不把所有來源格式硬編進 server；外部 AI／adapter 負責來源理解。
- 不要求每個人先輸入所有資料才可使用；readiness 依分析目的漸進揭露缺口。
- 不以 generic plugin system 作為 Phase 0-7 的交付條件；先完成具名 context 與 extension contract。

---

## 4. 核心架構裁決：共用語意，不強迫共用儲存

### 4.1 候選模型比較

| Candidate | 優點 | 主要風險 | 裁決 |
|---|---|---|---|
| A. 持續擴充 `transactions` | 最少 migration、現有 UI/API 可直接查 | 投資 quantity／quote、loan schedule、balance snapshot 被迫塞 nullable 欄；生命週期與單位混亂 | 否決作為全域模型；保留為 Cash Activity context |
| B. 所有資料轉成 universal event + balanced postings | 理論上統一、會計查詢強 | migration 與概念成本高；來源不完整時難平衡；投資 quantity、market quote、future obligation 仍需額外模型；容易為理論純度犧牲現有流程 | 不作 foundation 強制模型；未來 Accounting context 可消費 facts 產生 postings |
| C. Shared Kernel + Typed Bounded Contexts + Read Models | 共用身分／來源／精度／review；各 context 保留正確單位與生命週期；可逐步 migration | 需要明確 context map 與跨 context reconciliation；不能靠一張表完成任意查詢 | **採用** |
| D. Generic `financial_records(type, json)` | 表少、初期新增類型快 | 無 FK、無型別、難 migration、難索引、AI 容易寫入半合法資料、長期風險最高 | 禁止作 canonical model；只允許 staging／raw payload |

### 4.2 Selected Pattern

```text
Shared Kernel
  ├─ Entity / Institution / Account Identity
  ├─ Source / Authority / Review / Audit
  ├─ Money / Currency / Decimal / Time
  └─ Capability / Schema / Error Contract

Typed Bounded Contexts
  ├─ Cash Activity (existing transactions)
  ├─ Account & Balance
  ├─ Credit Card & Liability
  ├─ Commitment
  ├─ Investment & Valuation
  ├─ Manual Valued Items
  └─ Reconciliation

Read Models
  ├─ Inventory
  ├─ Readiness / Data Gaps
  ├─ Analysis Context Packs
  └─ Downstream Reports / Financial Control
```

### 4.3 Shared Kernel 的准入標準

一個概念只有同時符合以下條件才可進 shared kernel：

1. 至少有兩個已核准 bounded contexts 需要它。
2. 身分、單位、生命週期與權威規則在這些 contexts 中相同。
3. 可用 DB constraints 或單一 validator 清楚驗證。
4. 不需要大量 `NULL`、type switch 或 provider-specific fields。
5. 放入 shared kernel 能降低重複與不一致，而不是只讓 class／table 數量變少。

### 4.4 必須切出獨立 Context 的訊號

任一條成立就停止擴充現有抽象，進行 ADR／spike：

- 使用不同基本單位，例如 money、security quantity、option contract、staking share。
- 具有不同生命週期，例如 pending bank transaction、loan amortization、market quote、corporate action。
- 需要不同一致性邊界或 failure policy。
- 需要專屬法規、稅務、provider 或市場日曆語意。
- 為支援它需讓既有 table 增加超過 3 個僅單一 type 使用的 nullable 欄位。
- 既有 validator／CRUD 開始充滿 type-specific branches。
- 新功能失敗會污染其他 context 的 source facts 或 completeness。
- 只有一個消費者且未證明第二個穩定使用者。

### 4.5 支援等級

| Tier | 定義 | 本計畫項目 | 保證 |
|---|---|---|---|
| Tier 1：First-class | typed schema、CRUD、source、review、readiness、fixtures、analysis read model 均完整 | bank、cash、e-wallet、credit card、loan、simple investments、commitments | 可宣稱正式支援 |
| Tier 2：Generic valued item | 保存身分、owner、價值 snapshot、來源與 freshness，但不理解完整交易生命週期 | 房產、車輛、私人應收／應付、其他人工估值資產負債 | 只支援淨值／inventory，不宣稱收益、稅務或 cash-flow 完整 |
| Tier 3：Separate context required | 共通模型會增加不可接受成本／風險 | options、futures、margin、DeFi、複雜保單、tax lots、business consolidation | 保存原始 source 或標示 unsupported；另立 spec 後才進核心分析 |

---

## 5. 財務事實分層

| Layer | 定義 | 範例 | 可否改寫 |
|---|---|---|---|
| Source Artifact | 使用者提供或 AI 查得的原始證據及 metadata | statement、CSV、PDF、price webpage、manual note | 不改原文；可新增 replacement／supersession |
| Source Fact | 從來源直接讀出的 typed value | 2026-07-14 bank balance、statement due amount、holding quantity | 不因分析需要改寫；更正需保留 evidence |
| Human Assertion | 使用者裁決的語意 | 這兩筆是自有轉帳、這個 account 屬於 household | 可透過新版本變更，舊值保留 audit |
| AI Proposal | AI 的 mapping／價格／類型候選 | account kind、instrument match、loan term extraction | 未確認時不能提升 coverage 權威 |
| Derived Value | 程式用 facts + policy 重建 | market value、reconciliation delta、readiness | 不作第二事實來源；cache 必須帶 watermark |
| AI Interpretation | 外部 AI 對 structured data 的自然語言分析 | 支出增加原因、風險說明 | 預設不寫回 canonical facts；保存時另有 insight contract |

任何 API response 與 UI 都必須能辨識這六層，不能只回一個沒有 provenance 的值。

---

## 6. Canonical Vocabulary

| Concept | 定義 | 不等於 |
|---|---|---|
| Entity | 報告與資料納入範圍，例如 personal／household | 登入使用者；目前仍是單人 local app |
| Institution | 提供帳戶或商品的銀行、券商、平台 | Source file |
| Account | 持有現金、負債或投資活動的容器 | 顯示名稱、卡片商家 |
| Account Alias | 某來源用來辨識 account 的穩定／半穩定字串或外部 ID | Canonical account identity |
| Instrument | 可持有數量或報價的金融標的 | Brokerage account |
| Activity | 某 account 已發生或 pending 的金錢變動 | Balance snapshot、future commitment |
| Snapshot | 某一時點官方／人工觀察到的狀態 | 交易推導 running balance |
| Statement | 金融機構對一段期間與 due state 的正式／暫定彙總 | 單筆 card transaction |
| Liability Profile | 負債契約與生命週期條件 | 當期付款流水 |
| Commitment | 預期未來發生的現金流模板 | 已發生交易 |
| Occurrence | Commitment 在具體日期的預期／確認／結清事件 | Template 本身 |
| Holding | account 對 instrument 的數量狀態 | Instrument master |
| Quote | 某 instrument 在時間點的單位價格 | Holding market value |
| FX Quote | 一對 currency 在時間點的轉換率 | 永久固定匯率 |
| Reconciliation | 兩份或多份 facts 的關係與差異判斷 | 為了平衡而修改 source fact |
| Scope Attestation | 人類對某 entity／資料領域在某時點已盤點、部分盤點或未知的可版本化聲明 | 從 DB row count 推測「應該都在了」 |
| Source Expectation | 某 account／context 預期取得何種來源、頻率與寬限期 | 實際 source fact 或自動下載排程 |
| Readiness | 某 analysis goal 在指定 scope／as-of 下的資料可用程度 | 全產品只有一個 completeness 百分比 |

---

## 7. Representation Rules

### 7.1 Identity

- Internal FK 繼續使用 SQLite integer id。
- 對 AI、API、audit 與跨 context reference 提供 immutable `resource_key`／`account_key`（UUID 或等價 random stable key）。
- 顯示名稱可以改，不能作 dedupe 或 foreign identity。
- Provider external id 只能在 `account_aliases`／source identity 中使用，不能當全域 PK。
- Existing transaction integer id 與 dedupe key 保持不變。

### 7.2 Money

- 新欄位命名：`amount_minor`、`balance_minor`、`market_value_minor`。
- 儲存：SQLite `INTEGER`；currency 使用 ISO 4217 code；minor-unit exponent 由 code registry 驗證。
- Domain arithmetic 與 SQLite read/write 必須保留 64-bit integer；Phase 0 驗證 `node:sqlite` BigInt 模式。轉成 JavaScript `Number` 前必須檢查 safe integer，不可先失真再轉字串。
- API：JSON number 只允許 JavaScript safe integer 範圍；超出時用 integer string 並由 schema 明示。SQLite 64-bit 上下限之外直接拒絕。
- Activity 的 principal／fee／gross 等 magnitude 預設非負，方向另用 typed enum；balance snapshot 保存來源顯示的正負號並以 account `normal_balance` 解讀。禁止同一欄位在不同 route 使用相反 sign convention。
- Existing `transactions.amount/inflow/outflow/balance` 保持 integer cents 相容；adapter 將其呈現為 `*_minor`。
- 禁止以 float 比對金額或轉帳候選。

### 7.3 Quantity、Price、FX

- Canonical storage 使用經 validator 正規化的 decimal string，不使用 SQLite `REAL`。
- 欄位命名：`quantity_decimal`、`unit_price_decimal`、`fx_rate_decimal`。
- 所有 arithmetic 經單一 decimal owner，輸出 money 時套明確 rounding mode 與 currency exponent。
- Phase 0 spike 預設評估 `decimal.js`；若不引入 dependency，需提供經 property tests 證明的 BigInt-scaled helper，不能退回 `Number`。

### 7.4 Date And Time

- Business date：`YYYY-MM-DD`。
- Timestamp：UTC ISO 8601 `...Z`；來源 timezone 另存。
- `effective_at`、`observed_at`、`imported_at`、`reviewed_at` 不可互換。
- Market quote 必須有 market/as-of time；只有日期的來源不得偽造盤中時間。

### 7.5 Currency And Consolidation

- Phase 1 起保存原幣，不等待多幣別報表。
- `fx_quotes` 固定定義為「1 base currency = rate 個 quote currency」；反轉或 cross-rate 都是帶來源 watermark 的 derived value，不靜默保存成原始 quote。
- 沒有合格 FX quote 時，各幣別分組呈現，consolidated readiness 為 partial／unavailable。
- 不在 source fact 上覆寫換算後金額；derived valuation 帶 quote ids 與 watermark。

### 7.6 State And Authority

建議共用 enum：

```text
record_status: provisional | posted | confirmed | superseded | reversed | archived
authority: official | institution_export | user_confirmed | ai_researched | ai_inferred | estimated
review_state: not_required | proposed | needs_review | confirmed | rejected
freshness_state: current | stale | missing | unknown
```

enum 必須由 shared constants／JSON Schema 單一來源提供；不能在 route、Skill 與 UI 各自重寫。

---

## 8. Target Context Map 與資料 Owner

### 8.1 Shared Kernel

#### `reporting_entities`

- `id`, `entity_key`, `name`, `entity_type`, `base_currency`, `active`
- 預設 migration 建立 `personal`。
- 一個 account 在本計畫先屬於一個 reporting entity。
- Joint ownership ratio、跨 entity consolidation 暫不支援；需要時另立 allocation context。

#### `institutions`

- `id`, `institution_key`, `display_name`, `institution_type`, `country_code`, `active`, optional `merged_into_institution_id`
- 不把 bank-specific parser、網站 URL、credential 放入 canonical institution row。

#### `institution_aliases`

- `institution_id`, `source_system`, `alias_value_normalized`, `country_hint`, `authority`, `review_state`
- 金融機構名稱縮寫、舊名與來源代碼不直接當 canonical identity；alias 衝突時由人類裁決。

#### `accounts` additive evolution

保留現有 id／name／institution／account_type／masked_number，新增：

- `account_key`
- `display_name`
- `entity_id`
- `institution_id`
- `account_kind`
- `currency`
- `normal_balance`
- `liquidity_class`
- `active`
- `included_in_analysis`
- `authority`
- `review_state`
- `version`
- `updated_at`
- optional `merged_into_account_id`

決策：Phase 1 採 additive columns，不新建平行 `financial_accounts`。`name UNIQUE` 暫留為 legacy internal label，使用者可見名稱改由 `display_name` 擁有；source mapping 改由 aliases。只有實際 collision／migration spike 證明 additive 無法安全維護時，才啟動 accounts table rebuild ADR。

#### `account_aliases`

- `account_id`, `source_system`, `alias_type`, `alias_value_normalized`, `masked_hint`, `confidence`, `authority`, `review_state`
- unique identity 以 source system + normalized alias 組合。
- AI 可提案；衝突時不得自動換綁 account。

#### Identity duplicate／merge contract

- Preview 階段先以 alias、masked hints、institution、currency、entity 與 source overlap 阻擋疑似重複建立；不靠顯示名稱直接合併。
- 已有 downstream facts 的 institution／account／instrument 只能走 typed merge preview → human confirm → commit。
- Preview 必須列出將重綁的每個 table／row count、衝突欄位、scope/readiness 影響與不可合併原因；AI 不可 commit merge。
- Commit 在單一 transaction 將所有已知 typed FKs 重綁到 canonical target，repoint aliases，將 source identity archived 並寫 typed `merged_into_*_id` + `data_change_log`；禁止 generic polymorphic cascade 或只刪 source row。
- Merge 禁止 cycle、跨不相容 entity／currency 的靜默合併，以及任何會覆寫兩筆不同 source facts 的 last-write-wins。遇到 semantic conflict 先停在 review。
- Phase 1-4 以 prevention + conflict queue 為主；Phase 5 在全部本計畫 FK owners 到位後實作 typed merge。後續新增 context 必須同步擴充 merge impact registry 與 tests，否則該 resource type 禁止 merge。

#### `sources` additive evolution

保留現有來源連結，新增：

- `source_key`, `source_kind`, `authority`, `status`, `artifact_status`
- `content_sha256`（可得時）
- `period_start`, `period_end`, `as_of_at`, `observed_at`
- `institution_id`, `account_id`
- `is_official`, `supersedes_source_id`
- `created_by`, `review_state`

`artifact_status` 至少區分 available、missing、purged、external-only；原始檔不可用不會刪除已驗證 facts，但 provenance drilldown 與需要重解析的 readiness 必須揭露限制。

原始檔內容仍放 ignored path；DB 保存 path hint／fingerprint／metadata，不把完整檔案 blob 塞進 SQLite。

#### `scope_attestations`

- `attestation_key`, `entity_id`, `scope_kind`, `as_of_date`, `coverage_state`
- `coverage_state`：`declared_complete`、`declared_partial`、`unknown`
- optional human-readable included／excluded note、`valid_until`, `source_id`, `authority`, `review_state`, `version`
- `scope_kind` 至少包含 cash accounts、credit cards、liabilities、investments、valued items；analysis goal 可組合多個 scope kinds。
- 只有 `user_confirmed` 或明確核准的 authoritative inventory source 能建立 `declared_complete`；AI 只能提案 partial／unknown 或請人確認。
- 新 account／liability 被加入、attestation 到期或來源衝突時，相關 readiness cache 必須失效。

#### `source_expectations`

- `expectation_key`, `entity_id`, optional `account_id`, `target_context`, `expected_source_kind`
- `cadence`, `grace_days`, optional period anchor、`active`, `authority`, `review_state`, `version`
- `source_expectation_goals(expectation_id, goal_key)` 明確連結哪些 analysis goals 受影響，不以 JSON/EAV 隱藏關係。
- 系統可依 account kind 建 candidate，但只有 user-confirmed expectation 會讓缺期成為硬 blocker；candidate 只作提示。
- 這是資料維護期待，不是銀行連線、自動同步或 future cash commitment。

#### `data_change_log`

- append-only operational audit：`resource_type`, `resource_key`, `action`, `before_json`, `after_json`, `actor_type`, `actor_note`, `changed_at`
- JSON 只作 audit evidence，不是 canonical state。
- 不取代 `correction_log`／`rule_change_log`；既有 logs 保留其學習語意。

#### `human_confirmation_requests`

- operational authorization evidence：`proposal_key`, `action_kind`, `resource_type/key`, `payload_hash`, `expected_version`, `status`, `expires_at`, `confirmed_at`, `consumed_at`
- confirmation secret 只存 hash；pending／confirmed receipt 短效、one-time，payload 或 version 改變即 invalid。
- 只支援 registry 中的 high-risk actions，不提供 generic table／field mutation；expired／consumed rows 可依 retention policy 清理，實際 commit 仍寫 `data_change_log`。

### 8.2 Ingestion Context

#### `ingestion_runs`

- `run_key`, `status`, `operator`, `payload_schema_version`, `idempotency_key`
- `source_id`, `bundle_kind`, `payload_hash`, optional `reverses_run_id`
- preview counts、warning/error counts、started／committed／failed times
- commit 後只保留必要 metadata；包含真實細節的 staged payload 依 retention policy 清除或限制在本機 DB。

#### `ingestion_run_contexts`

- `run_id`, `context_key`, `schema_version`, `status`, item/warning/error counts
- 一個 source artifact 可包含多個 typed sections，例如 card transactions + statement + balance + installments。
- Context key 必須在 capabilities registry；不是任意 table name。

#### `ingestion_items`

- staging only：context/typed target、client item key、跨 section client references、validated payload、proposed action、errors、warnings、review requirement
- canonical commit 成功後保存 target resource key 與結果，不作分析來源。
- Staging JSON 可接受，因為它不是 canonical fact；仍需 size limit、schema validation 與 retention。

### 8.3 Account & Balance Context

#### `account_balance_snapshots`

- `snapshot_key`, `account_id`, `as_of_date`, `observed_at`
- `balance_kind`：ledger、available、statement、unbilled、principal、cash、market_value、other
- `balance_minor`, `currency`
- `source_id`, `authority`, `review_state`, `note`
- `supersedes_snapshot_id`, `created_by`, timestamps

Rules：

- 同 account／kind／as-of／source 不重複。
- 同一時點衝突來源並存，readiness 回 conflict；不採 last-write-wins。
- transaction running balance 可產生 `ai_inferred` candidate，但不能標 official 或讓 coverage complete。

### 8.4 Cash Activity Context

`transactions` 繼續作銀行、cash、e-wallet、credit-card activity 的 canonical imported row。Additive 欄位方向：

- `currency`
- `transaction_status`
- `external_transaction_id`
- `posted_date`
- `source_authority`
- `supersedes_transaction_id`／reversal linkage（若 contract 通過）

Compatibility：

- 不改既有 dedupe algorithm，除非有獨立 migration plan。
- `flow_type` 保留；新增 canonical event kind 時由 mapping layer 提供，不批次改寫舊 source facts。
- `POST /api/import-ledger` 保留為 legacy adapter，內部逐步導向 ingestion service；現有 CSV workflow 不被迫一次重寫。

### 8.5 Credit Card Context

#### `credit_card_profiles`

- `account_id` PK/FK
- statement close policy、payment due policy、autopay account
- credit limit amount/currency
- terms authority、review state、source id、version

#### `credit_card_statements`

- `statement_key`, `account_id`, period start/end, close date, due date
- statement balance、minimum due、full payment due、currency
- official/provisional、source、review state

#### `credit_card_statement_items`

- link existing `transaction_id` to `statement_id`
- role：charge、refund、fee、interest、installment、adjustment
- 不複製 merchant transaction amount 作第二事實。

#### `credit_card_payment_matches`

- bank transaction ↔ card statement/account settlement
- candidate／confirmed／rejected、confidence、reason、human evidence
- 付款可對多個 statement 或 partial payment；不得只用 one-to-one 假設。

#### `credit_card_installment_plans`

- `plan_key`, `account_id`, optional originating `transaction_id`
- financed principal、currency、installment count、start/end、APR／fee terms、official/provisional、source、review、version
- 原消費只認列一次；plan 保存未來清償結構，不複製 merchant expense 作第二筆支出。

#### `credit_card_installment_entries`

- plan、sequence、statement/due date、principal、interest、fee、total、status
- optional `statement_item_id`；官方 schedule 可 supersede provisional entries，但 settled entry 不被重寫。
- 各 entry component sum 必須等於 total；整份 schedule 與 financed principal 不合時標 unreconciled。
- 只有 official／human-confirmed schedule 能讓未來義務 complete。循環利息、現金預借或未知費率只能依 statement 保存已發生事實；未來估算不冒充官方 schedule。

### 8.6 Liability Context

#### `liability_profiles`

- `account_id`, liability type, original principal、currency
- `rate_type`：fixed、variable_reported、unknown；APR decimal、rate as-of、start／maturity date、payment frequency
- official/provisional、source、review state、version

Variable rate 只保存來源已報告的 rate facts；未提供重定價規則或官方 schedule 時，工具不推測未來 payment。Revolving credit、balloon payment、interest-only 等特殊生命週期若無 typed contract，readiness partial 或另立 context。

Current principal 由 `account_balance_snapshots(balance_kind=principal)` 或已對帳 schedule read model 擁有，profile 不保存第二份可漂移的 current balance。

#### `loan_schedule_entries`

- due date、expected payment、principal、interest、fee、currency
- source／schedule version、status、supersession
- 官方 schedule 優先；AI 不從本金與 APR 猜出 authoritative payment。

#### `loan_payment_allocations`

- bank transaction ↔ schedule entry
- principal／interest／fee split
- allocation sums 必須等於 matched cash amount，否則 unreconciled。

信用卡與 loan 共用 account/source/money/review 契約，但不共用一張 `liability_details` mega-table。

### 8.7 Commitment Context

#### `cash_commitments`

- `commitment_key`, entity, optional account
- kind、direction、currency、`amount_kind`
- `amount_kind` 只允許 fixed／range／unknown；fixed 使用 `amount_minor`，range 使用 min/max，禁止任意公式字串
- cadence 使用具名 enum（one_time、weekly、monthly、yearly、custom_dates）+ timezone／date policy；不執行任意 RRULE／code
- next due、start/end、essentiality
- authority、confidence、review state、source、version

#### `commitment_occurrences`

- due date、expected amount/range、status
- matched transaction／statement／schedule reference 由 typed match tables負責
- occurrence 可由 confirmed commitment 重建；已 settled history 不隨 template edit 被竄改。

歷史 fixed baseline 只能產生 candidate，不自動 confirmed commitment。

Card statement due、loan schedule 與 card installment entries 由各自 typed context 擁有；Commitment read model 可以彙整它們，但不得複製成另一份可漂移的 commitment template。

### 8.8 Investment & Valuation Context

#### `instruments`

- `instrument_key`, type、name、symbol、exchange、ISIN／provider identifiers
- quote currency、active、authority、review state、optional `merged_into_instrument_id`
- simple supported types：stock、ETF、mutual fund、bond、cash equivalent、simple crypto、other quoted asset

#### `investment_trades`

- account、instrument、trade/settle date、activity type
- quantity decimal、unit price decimal、gross/net/fee/tax money
- source、status、external id、review state
- supported activity：buy、sell、dividend、interest、fee、deposit、withdrawal、split candidate、other reviewed

複雜 corporate action、option/future、margin 與 tax lot 不得以 `other` 偽裝成完整支援；觸發 separate-context gate。

#### `holding_snapshots`

- account、instrument、as-of、quantity decimal
- optional reported cost basis／reported market value
- source、authority、review state、supersession
- source reported value 與 tool-derived value 分欄，不互相覆寫。

#### `market_quotes`

- instrument、price decimal、quote currency、as-of／market date
- source id／source URL note、retrieved by、authority、confidence
- quote type：close、realtime、NAV、manual estimate
- duplicate key 需含 instrument/provider/as-of/quote type。

#### `fx_quotes`

- base／quote currency、rate decimal、as-of、provider/source、authority
- 不建立永遠有效的 default FX。

#### Derived valuation

```text
holding_value_minor
= round(quantity_decimal × unit_price_decimal, quote_currency minor unit)

base_value_minor
= round(holding_value × fx_rate, entity base currency minor unit)
```

Derived valuation 預設 query-time 計算；若效能需要 cache，必須帶 holding／quote／FX watermark，不能成為第二事實來源。

### 8.9 Manual Valued Items Context

#### `valued_items`

- entity、item type、asset/liability direction、name、currency
- ownership/status、valuation method、authority、review state

#### `valued_item_snapshots`

- as-of、value minor、currency、source、method、confidence、note

適用房產、車輛、私人借款、應收／應付等 Tier 2 項目。只支援 inventory／net-worth contribution；不自動產生 P&L、cash flow、折舊或稅務。

### 8.10 Reconciliation Context

保留 typed match tables，不建立無 FK 的 universal relationship table：

- `transfer_matches`
- `credit_card_payment_matches`
- `loan_payment_allocations`
- `investment_cash_matches`

共用 contract：status、confidence、reason、authority、review、source watermark、confirmed_by、confirmed_at。

如果未來三種以上 match flow 出現完全相同生命週期，再評估共用 service／base metadata；不預先建立 polymorphic target table。

### 8.11 Review Context

各 canonical record 自帶 `review_state`。Unified review UI 可使用 `review_tasks` 作 operational queue：

- resource type/key、issue type、severity、status、reason、source watermark
- assign／acknowledge／resolve history
- resource 仍由 typed table 擁有，review task 不保存 canonical value。
- resource 被 supersede 時必須 resolve／repoint task，禁止孤兒 task 靜默存在。

---

## 9. Source Authority 與衝突政策

### 9.1 建議權威順序

```text
human_confirmed correction
> official institution statement / contract
> institution export / provider quote
> user-supplied manual snapshot
> AI-researched evidence
> AI-inferred candidate
> statistical estimate
```

這是 default precedence，不是自動覆寫規則。不同 as-of、balance kind 或 scope 的資料不可直接比較。

### 9.2 衝突處理

- 同一 semantic key 出現不同值時建立 conflict blocker。
- API 回傳所有 candidate、source、authority 與差異，不只回最高權威值。
- Tool 可選出 `effective` value 供 read model 使用，但 selection policy 與理由必須可見。
- 人類確認 selection 後寫 change evidence；不得刪掉被拒絕來源。
- AI 可以提出 resolve candidate，不能在高影響 conflict 上自動確認。

### 9.3 Freshness

Freshness 是 policy，不硬寫進 snapshot：

- bank balance：預設 7 天，可由 analysis goal 覆寫；
- credit-card unbilled：主動控制場景預設 1-3 天；
- market quote：依 instrument／market、分析目的與 quote type；
- loan principal：最新 official statement／schedule；
- manual valued item：使用者設定週期。

Policy 必須版本化並在 readiness response 回傳，不能只回 stale=true。

---

## 10. Ingestion：Preview → Validate → Commit

### 10.1 End-To-End Flow

1. **Preflight**：AI 呼叫 health、capabilities、inventory、readiness。
2. **Register Source**：提交 source metadata／fingerprint，不上傳到任意外部服務。
3. **Resolve Identity**：account／instrument alias match；衝突先停。
4. **Preview**：提交一個或多個 typed sections；工具驗證所有 schema、跨 section client references、總和與 proposed actions，不寫 canonical state。
5. **Review Warnings**：AI 修正 validation errors；高風險 warning 交人類。
6. **Commit**：使用 preview run key + payload hash + idempotency key 原子寫入。
7. **Reconcile**：建立 candidates，不自動確認低信心 matches。
8. **Postflight**：重新查 inventory／readiness，回報新增、更新、忽略、衝突、待審與缺口。

### 10.2 Preview Response 最小格式

```json
{
  "run_key": "...",
  "bundle_kind": "credit-card-statement",
  "schemas": ["finance.cash-activity/v1", "finance.card-statement/v1", "finance.account-balance/v1"],
  "payload_hash": "...",
  "summary": {
    "create": 2,
    "update": 0,
    "ignore_duplicate": 1,
    "conflict": 1,
    "needs_review": 1
  },
  "items": [
    {
      "context": "cash_activity",
      "client_item_key": "row-1",
      "action": "create",
      "errors": [],
      "warnings": [],
      "normalized": {}
    }
  ]
}
```

### 10.3 Commit Rules

- Commit 不接受 preview 後被改過的 payload hash。
- 同 idempotency key + same hash 回傳原結果；same key + different hash 回 `409`。
- 一個 ingestion run 的所有 typed sections 預設 all-or-nothing；card statement 這類互相依賴的 sections 禁止 partial canonical commit。
- 真正互不相依且需分批處理的資料，在 preview 前拆成不同 run／idempotency key；不得在 commit 失敗後留下「成功的半張來源」。
- 跨 section references 先以 client item key 解析，commit 後才替換成 canonical resource keys；任何 unresolved／ambiguous reference 使整個 run fail。
- Canonical writes、source links、audit、review tasks 在同一 DB transaction。
- Stale `expected_version` 回 `409 conflict`，不採 last-write-wins。
- API 不接受未在 capability registry 公布的 record type 或欄位。

### 10.4 Committed Run Reversal

- 錯 account、錯 source period 或整批誤匯不得靠 SQL／hard delete 修正；使用 `reverse-preview` 列出所有 canonical resources、downstream matches、human evidence、reports/readiness 影響。
- Reversal 是 high-risk human-confirmed operation，綁 run version、impact hash 與 confirmation receipt。
- Commit 以各 context 的 typed reversed／superseded semantics 排除原 facts，建立 reversal run、audit 與 review tasks；不刪原 source、change logs 或 human evidence。
- 若某 context 尚未實作可逆語意、或 reversal 會讓已確認 human evidence 失去 owner，整批 fail closed 並要求先人工解除衝突。
- Reversal 完成後用新的 ingestion run 匯入正確資料；不得修改原 run payload/hash 來假裝沒發生。

### 10.5 Legacy Ledger Adapter

`POST /api/import-ledger` 在本計畫期間持續可用：

- 現有 CSV schema、dedupe、rules-applied stats 與 human protection 不變。
- Phase 2 起 route 可將 account/source identity 交由新 service，但 response 保持相容。
- 不在同一 Phase 同時重寫 CSV parser、dedupe algorithm 與 account identity；一次只改一個高風險交會點。
- Legacy adapter 的退場條件是新 structured import 覆蓋既有 Flow A、fixtures 與 Skill eval，且使用者明確核准；本計畫預設不移除。

---

## 11. AI Data API Contract

### 11.1 Bootstrap Read APIs

```text
GET  /api/finance/capabilities
GET  /api/finance/inventory?entity=&asOf=
GET  /api/finance/readiness?goal=&entity=&asOf=
POST /api/finance/analysis-context
```

#### `capabilities`

回傳：

- API/schema versions；
- supported contexts、record types、enums；
- required／optional fields；
- batch limits、money/decimal format；
- supported readiness goals；
- mutation preview/commit requirements；
- unsupported／separate-context list。

Capability registry 由 code constants／JSON Schemas 產生，Skill 不自行猜 enum。

#### `inventory`

回傳 entity、institutions、accounts、最新 snapshots、liabilities、commitments、investment holdings、scope attestations、source expectations、source coverage、review counts 與 freshness summary。預設不回整筆交易明細。

#### `readiness`

針對具名 analysis goal 回傳 status、requirements、satisfied、gaps、conflicts、freshness、priority 與 next actions。

#### `analysis-context`

AI 提交具名 datasets 與 filters，例如：

```json
{
  "entity": "personal",
  "as_of": "2026-07-14",
  "datasets": [
    { "name": "cash_activity", "from": "2026-01-01", "to": "2026-07-14", "group_by": "month" },
    { "name": "account_balances", "freshness": true },
    { "name": "investment_positions", "valuation": "latest_available" }
  ]
}
```

Server 只接受 registry 白名單中的 dataset、filter、grouping 與 limit；不接受 SQL、column expression 或任意 table name。

### 11.2 Domain CRUD APIs

目標路徑方向：

```text
/api/finance/entities
/api/finance/institutions
/api/finance/institutions/:id/aliases
/api/finance/institutions/:id/merge-preview
/api/finance/institutions/:id/merge
/api/finance/accounts
/api/finance/accounts/:id/aliases
/api/finance/accounts/:id/merge-preview
/api/finance/accounts/:id/merge
/api/finance/accounts/:id/balance-snapshots
/api/finance/sources
/api/finance/scope-attestations
/api/finance/source-expectations
/api/finance/human-confirmations/*
/api/finance/credit-cards/*
/api/finance/liabilities/*
/api/finance/commitments/*
/api/finance/investments/instruments
/api/finance/investments/instruments/:id/merge-preview
/api/finance/investments/instruments/:id/merge
/api/finance/investments/trades
/api/finance/investments/holdings
/api/finance/investments/quotes
/api/finance/fx-quotes
/api/finance/valued-items/*
/api/finance/reconciliation/*
/api/finance/review-tasks/*
/api/finance/imports/preview
/api/finance/imports/:runKey/commit
/api/finance/imports/:runKey/reverse-preview
/api/finance/imports/:runKey/reverse
```

不建立 `POST /api/finance/records` 萬用 mutation。每個 bounded context 使用自己的 JSON Schema、validator、service 與 transaction boundary。

### 11.3 Mutation Envelope

所有 AI proposal 至少帶：

- `source_key` 或可驗證 manual source note；
- `client_item_key`；
- authority；
- confidence（AI proposal）；
- human-readable reason；
- review requirement；
- `expected_version`（update）；
- idempotency key（batch）。

高風險 human-only commit 另外需要 server-side pending proposal key 與一次性 confirmation receipt；receipt 不得出現在 capabilities、Skill 範例、一般 read API 或 logs，且 payload hash／expected version 任一改變就失效。

### 11.4 Error Envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "人類可讀說明",
    "field": "items[2].currency",
    "allowed_values": ["TWD", "USD"],
    "retryable": false
  }
}
```

Stable error codes：`VALIDATION_ERROR`、`UNKNOWN_SCHEMA`、`IDENTITY_CONFLICT`、`VERSION_CONFLICT`、`DUPLICATE`、`SOURCE_REQUIRED`、`REVIEW_REQUIRED`、`HUMAN_CONFIRMATION_REQUIRED`、`UNSUPPORTED_CONTEXT`、`DB_UNAVAILABLE`。

### 11.5 AI 禁止能力

- arbitrary SQL／SQLite shell；
- generic table／field patch；
- delete source facts without supersession；
- 對任意 URL 的 server-side fetch；
- 直接把 web page text 當 official source；
- 以自然語言 prompt 取代 JSON Schema validation；
- request 中夾帶可執行 code／shell command；
- 讀取或回傳超出使用者分析 scope 的全庫資料。

---

## 12. Readiness / Data Gap Engine

### 12.1 為什麼必須程式化

Skill 可以教 AI 問問題，但只有 runtime 知道 DB 現況。缺口判斷若只存在 prompt：

- AI 會重複要求已存在資料；
- 不同 AI 給出不同完整度；
- 無法測試「缺什麼」是否正確；
- coverage 會被對話記憶取代。

因此 readiness requirement graph 由程式擁有，AI 只負責解釋與依優先級向使用者索取。

### 12.2 Initial Analysis Goals

| Goal key | 必要資料 | 常見 blocker | 本計畫是否完成計算 |
|---|---|---|---|
| `spending_history` | scoped transactions、分類/review coverage | 月份缺漏、低信心、source gap | 是，沿用現況並補 scope |
| `cash_position` | liquid-account scope attestation、included accounts、current balance snapshots | account universe 未確認、snapshot stale、expected source 缺期 | 是 |
| `net_worth` | asset/liability/investment scope attestations、accounts、snapshots、holding valuations、FX | 未知負債、盤點聲明到期、缺 quote/FX、Tier 3 item | 是資料與 readiness；正式報表由下游完成 |
| `debt_obligations` | card/liability scope attestation、card statements、liability profiles、schedule | 未知負債、due date／principal／installment schedule 缺漏 | 是資料與 readiness |
| `investment_value` | investment scope attestation、holdings、quotes、FX、freshness policy | 券商範圍未確認、instrument 未辨識、quote stale | 是 deterministic valuation |
| `cash_flow_statement` | beginning/end cash、transactions、transfer matches | unmatched transfer、missing snapshot | 是 readiness；報表由 Accounting Spec 完成 |
| `liquidity_forecast_90d` | cash position、commitments、card/loan due、income policy | provisional commitments、stale card | 是 readiness；forecast 由 Financial Control Plan 完成 |
| `tax_or_derivatives` | separate context | unsupported | 回 `unsupported`，不假裝 partial |

使用者若明確要求「只分析帳戶 A」這種封閉 scope，可以不要求全域 attestation，但 response 必須標示為 scoped result，不能把它改寫成「所有現金」或「完整淨資產」。對全域語句（全部、總資產、所有負債、完整現金部位）則必須有對應 scope attestations。

### 12.3 Status

```text
empty         無最小起點
partial       可做有限分析，但缺必要範圍
stale         主要 blocker 是資料過期
conflicted    同一 semantic fact 有未解來源衝突
unreconciled  必要關係／期初期末無法對上
complete      指定 goal/scope/as-of 的 requirements 均通過
unsupported   超出核准 bounded contexts
```

Status 是針對 `goal + entity + scope + as_of + policy_version`，不是一個永久全域 badge。

### 12.4 Gap Priority

建議 deterministic priority：

1. 未確認資料宇宙的 missing／expired scope attestation。
2. 阻止任何結果的 missing identity／explicit scope。
3. 會讓主要金額錯誤的 missing liability／account／holding。
4. 已超過 source expectation 的缺期，或可由單一 snapshot／quote 補足的 stale data。
5. 未確認 conflict／reconciliation。
6. 只改善細節或 confidence 的 optional data。

Readiness response 同時回 `impact` 與 `effort_hint`；AI 可依使用者情境重新排序，但不得改 blocker 判定。

---

## 13. 自然語言分析完整流程

### Example：使用者問「我目前總共有多少資產？」

1. AI 查 `/health`、`/finance/capabilities`。
2. AI 查 `/finance/readiness?goal=net_worth`。
3. Tool 回：兩個銀行帳戶 current、一張信用卡缺 statement balance、券商持倉有 USD quote 但缺 TWD/USD FX、一筆房產 snapshot 已 18 個月。
4. AI 不直接給單一總額；先說明可計算範圍與缺口。
5. AI 向使用者索取最有影響的 card balance 與同日 FX／允許查價。
6. AI 查價後提交 quote preview；工具 validate source/as-of/currency。
7. AI commit；人類確認低信心房產估值是否沿用。
8. AI 再查 readiness；若 complete，透過 analysis-context 取得 typed facts 與 deterministic valuation。
9. AI 用自然語言回答，分開列 source facts、derived total、stale items 與未納入項目。

### 分析輸出契約

AI 回答必須包含：

- scope／as-of；
- readiness status；
- 使用的 datasets 與重要來源；
- 已知結果；
- 缺口／排除；
- interpretation 與 fact 的區分；
- 建議補資料項目，但不越權做付款、投資或借貸決定。

---

## 14. Human Data Center UI

本階段需要最小但完整的人類資料維護介面，不只 API。

### 14.1 Navigation

```text
財務資料
  ├─ 資料完整度
  ├─ 盤點範圍與更新期待
  ├─ 帳戶與餘額
  ├─ 卡片與負債
  ├─ 投資與估值
  ├─ 未來承諾
  ├─ 來源
  └─ 待確認／對帳
```

### 14.2 Desktop

- 緊密 table/list，顯示 institution、account、kind、currency、latest snapshot、freshness、review state。
- Scope panel 顯示「已確認盤點到哪一天、涵蓋哪些領域、哪些來源預期何時更新」；不得用 record count 取代人類聲明。
- Account detail 使用 tabs：identity、balances、activity、terms/holdings、sources、change history。
- Readiness panel 以分析目的呈現缺口，不顯示「schema 87% 完成」這種無意義數字。
- Edit 使用 Sheet/Dialog；提交前顯示來源與將改變的 derived outcomes。
- AI proposals 與 human-confirmed values 使用文字＋icon／badge，不只靠顏色。

### 14.3 Mobile

- 首屏優先：最高影響資料缺口、過期餘額、待確認數量。
- Account row 固定顯示名稱、種類、餘額／unknown、as-of。
- 編輯一次只處理一個 resource；避免寬表硬縮。
- 支援從 gap CTA 直接進入對應新增／確認流程。

### 14.4 Required States

- loading skeleton；
- empty onboarding；
- partial；
- stale；
- conflicted；
- unreconciled；
- complete；
- unsupported；
- API error with retry；
- version conflict with reload/diff。

UI 不重算 money、valuation、coverage 或 readiness；只呈現 API view model。

---

## 15. Target Owner Architecture

`lib/db.js` 保留 facade，避免現有 imports 全面斷裂。新增 owner 方向：

```text
lib/
  db.js                         # compatibility facade
  db/
    connection.js               # open/pragma/close
    migration-runner.js         # schema_migrations + user_version
    backup.js                   # consistent backup/restore verification
    migrations/
      002-data-foundation-core.js
      003-account-balance.js
      004-liabilities.js
      005-investments.js
      006-readiness.js

  finance/
    contracts/
      schemas/                  # machine-readable JSON Schemas
      enums.js
      capabilities.js
      errors.js
      authority.js
    money/
      currency.js
      decimal.js
      valuation.js
    identity/
      account-aliases.js
      institution-aliases.js
      instrument-identifiers.js
      merge-impact.js
    ingestion/
      preview.js
      commit.js
      idempotency.js
    readiness/
      goals.js
      evaluate.js
      priority.js
    analysis/
      datasets.js
      context-pack.js

  queries/
    finance/
      entities.js
      institutions.js
      accounts.js
      sources.js
      scope-attestations.js
      source-expectations.js
      human-confirmations.js
      balances.js
      credit-cards.js
      liabilities.js
      commitments.js
      investments.js
      valued-items.js
      reconciliation.js
      review-tasks.js
      inventory.js
      readiness.js

app/api/finance/
  capabilities/route.js
  inventory/route.js
  readiness/route.js
  analysis-context/route.js
  entities/*
  institutions/*
  accounts/*
  sources/*
  scope-attestations/*
  source-expectations/*
  human-confirmations/*
  credit-cards/*
  liabilities/*
  commitments/*
  investments/*
  valued-items/*
  reconciliation/*
  review-tasks/*
  imports/*

scripts/
  finance-backup.mjs           # explicit DB path -> ignored backup + manifest
  finance-restore.mjs          # backup -> new path validation; explicit replace only

components/finance-data/
  DataReadinessView.jsx
  ScopeAndExpectationView.jsx
  AccountRegister.jsx
  AccountDetail.jsx
  CreditCardRegister.jsx
  CommitmentRegister.jsx
  LiabilityRegister.jsx
  InvestmentRegister.jsx
  ValuedItemRegister.jsx
  SourceRegister.jsx
  DataReviewQueue.jsx
  HumanConfirmationQueue.jsx
```

### Owner Rules

- Routes 只 parse／validate HTTP envelope、呼叫 service/query、回 JSON。
- Query modules 擁有 SQL；UI、Skill 與 route 不拼 SQL。
- Domain service 擁有 transaction boundary、authority、version、audit 與 cross-table invariants。
- JSON Schema 與 enums 是 API／Skill／validator 的 machine source；避免手寫三份白名單。
- Components 消費 view model，不 import DB、money math 或 readiness evaluator。
- Existing `lib/queries/transactions.js` 不在一個 Phase 內全面拆除；只透過 adapters 接入新 scope/account semantics。
- Generic repository 禁止；每個 context 擁有具名 query/service。
- 新 abstraction 需通過 Shared Kernel 准入標準與至少兩個實際 consumers。

---

## 16. Migration Strategy

### 16.1 Migration Ledger

新增 `schema_migrations`：

- version／name／checksum／applied_at／app_version；
- runner 依序執行，checksum mismatch 停止；
- `PRAGMA user_version` 保留快速 newer-version guard；
- migration 與 schema version 在同一 transaction 更新。

### 16.2 Compatibility Facade

- `require('../lib/db')` 的現有 exports 保持。
- `SCHEMA_SQL` 可逐步移到 baseline migration；Phase 1 不同時重寫所有 schema owner。
- `initializeDatabase` 仍是唯一完整初始化入口。
- Existing `migrateSchema` 先包進 runner；退場需所有 migration tests 改走 public initializer。

### 16.3 Existing DB Upgrade

每個 schema Phase 必須準備：

1. 由 anonymized v0.2.3 schema 建立 legacy fixture DB。
2. 升級後比較 table／row counts、transaction ids、dedupe keys、human classifications、logs。
3. 重跑 migration 證明 idempotent。
4. 以 higher `user_version` 證明舊 app refusal。
5. 中途失敗證明全部 rollback。

正式使用者升級前應提示備份 DB；不實作自動 down migration。Rollback strategy 是還原備份＋舊版 app，不執行高風險 reverse DDL。

### 16.4 Accounts Migration

- Backfill default `personal` entity。
- Backfill `account_key`、`display_name=name`、currency=`TWD`、account kind from current account type as `ai_inferred`／needs review。
- Existing institution text 可建立 institution candidates，但不能自動合併名稱相似機構。
- Existing source_type 建立 account aliases。
- `accounts.name UNIQUE` 暫時保留；不在 foundation migration 中重建 parent table。

### 16.5 No Real DB Rule

所有 rehearsal 使用：

```powershell
$env:FINANCE_DB_PATH = Join-Path $env:TEMP "last-say-foundation-test.sqlite"
```

不得將命令指向 `data/finance.sqlite`；不得以 real DB row count 作公開驗收證據。

### 16.6 Backup、Restore 與可攜性

- Phase 0 先 spike Node 22 `node:sqlite` 在 WAL 模式下的一致性 backup API／checkpoint 行為；不得假設複製單一主檔即可還原。
- Phase 1 提供 local operator utility：建立 timestamped backup、寫入 app/schema version manifest、對備份執行 integrity check；預設輸出到 gitignored 路徑。
- Backup mode 分為 DB-only 與 optional full bundle。DB-only 必須明示「不含原始 source artifacts」；full bundle 只收錄 `sources` 實際引用、位於 allowlisted gitignored roots 的檔案，保存 relative path + hash，不追 symlink、不接受 path traversal。
- Restore 必須是顯式、停服或新路徑 dry-run 驗證後的操作；先檢查 manifest、SQLite integrity、schema version 與 migration compatibility，再允許替換 active DB。
- Restore 後逐一核對 source artifact hash；缺檔不竄改 canonical facts，但把 artifact availability 顯示為 missing，相關 drilldown／audit readiness 不得假裝完整。
- Backup／restore 測試要涵蓋 WAL、append-only logs、foreign keys、migration ledger、重複 restore 與損毀檔案拒絕。
- 不提供 AI 可呼叫的整庫 download／restore API。外部 AI 只使用 capabilities、inventory、readiness、named datasets 與 typed mutations。
- SQLite DB + manifest 是本階段的 operational portability boundary；完整 provider-neutral interchange format 需另立計畫，不用 generic JSON dump 偽裝完成。
- Backup bundle 含高度敏感資料且預設不承諾加密；CLI／README 必須警告儲存位置與檔案權限。若要內建加密、key recovery 或 cloud backup，另立 threat model／計畫。

目標 CLI 契約：

```powershell
node scripts/finance-backup.mjs --db <explicit-db-path> --output <ignored-backup-dir> [--include-sources]
node scripts/finance-restore.mjs --input <backup> --target <new-db-path>
```

兩個命令都不得在缺少 explicit path 時猜測真實 DB；restore 預設不得覆蓋既有 target，active DB replacement 另需停服、`--replace` 與互動式／明確確認契約。

---

## 17. Security、Privacy 與 Agent Safety

### 17.1 Threat Boundary

目前是 localhost single-user app，沒有 auth／multi-tenant isolation。這降低網路風險，但外部 AI payload、來源檔、URL note 與 bulk writes 仍是不可信輸入。

因此 human confirmation receipt 是防止正常 operator 誤越權的 workflow control，不是抵抗惡意本機程式的 security boundary。任何能讀取使用者瀏覽器 session、程序記憶體或本機檔案的攻擊者仍超出本階段威脅模型；不得把 receipt 宣稱成真正使用者認證。

### 17.2 Required Controls

- 所有 SQL parameterized；動態 sort／field／dataset 來自白名單。
- JSON Schema validation 在 route/service 邊界執行；拒絕 unknown fields 或明確設定 policy。
- Request body、batch items、text fields、decimal precision、date range、pagination 有上限。
- No arbitrary SQL、shell、filesystem path 或 URL fetch。
- File path 繼續限制 ignored directories；以 resolved path 防 traversal。
- Logs／error 不輸出完整 statement、account number、raw payload 或 source content。
- Masked account identity 不保存完整卡號；source raw text 仍視為敏感資料。
- Ingestion preview／commit 綁 payload hash，避免 tool-call injection 改寫待確認內容。
- scope `declared_complete` 與 restore 是高權限人類操作：AI 可準備 preview，但不能自行 commit complete attestation、替換 DB 或降低既有 coverage scope。
- 高風險 commit receipt 必須 one-time、短效、SameSite browser flow、server-side hash binding、不可只信 request actor label；重放與 changed-payload tests 是硬門檻。
- Human-confirmed mutation 使用 optimistic version，避免 AI 與 UI lost update。
- Append-only logs 以 triggers 防 UPDATE／DELETE。
- AI 提供 web price 時，保存來源與 as-of，但 server 不主動抓 user-controlled URL，避免 SSRF。
- 新 dependency 需 license、maintenance、`npm audit` 與 bundle/runtime boundary 檢查。

### 17.3 Deployment Boundary

本計畫不增加 public deployment safety。README 必須持續警告：只綁 localhost；若未來公開服務，需另立 auth、authorization、CSRF、rate limiting、tenant isolation、encryption 與 threat model。

---

## 18. Testing Strategy

### 18.1 Test Layers

| Layer | 證明內容 | 不可替代 |
|---|---|---|
| Schema contract tests | JSON Schema、enum、unknown field、precision、error shape | 不證明 DB writes |
| Pure domain tests | money/decimal、valuation、freshness、readiness、priority | 不 mock internal helpers |
| SQLite integration | migrations、constraints、idempotency、audit、rollback、conflicts | 使用 real temp SQLite |
| API component tests | route → service/query → DB response/side effect | 不只測 function existence |
| Compatibility tests | legacy ledger、dedupe、human correction、rules、P&L | 每 Phase 必跑 |
| Recovery tests | WAL-consistent backup、manifest、integrity、restore rehearsal | 不用單檔 copy 假裝備份成功 |
| Browser tests | Data Center empty/partial/conflict/edit/review/mobile | 只用 anonymized demo DB |
| Skill evals | AI 能否先盤點、補缺口、preview、處理錯誤、停止越權 | 不以單次成功對話取代固定 eval cases |

### 18.2 Fixture Matrix

至少包含：

- TWD bank checking + savings；
- 兩張 credit cards：official statement + unbilled；
- card installment：official 12-entry schedule + provisional／mismatched schedule；
- loan with official schedule；
- TWD stock／ETF；
- USD brokerage holding + TWD/USD FX；
- stale quote、missing quote、conflicting balance；
- cash/e-wallet；
- recurring salary、rent、insurance；
- manually valued home／private receivable；
- internal transfer、card payment、loan split、investment cash leg；
- unsupported derivative source；
- no scope attestation、expired attestation、declared partial、new account invalidates attestation；
- existing v0.2.3 ledger with human corrections and rules。

### 18.3 Property／Invariant Tests

- money round-trip 不丟 minor units；
- decimal parse／format canonicalization；
- repeated import idempotent；
- payload order 不影響 deterministic result；
- confirmed human value 不被 lower authority overwrite；
- derived valuation watermark 相同則結果相同；
- missing FX 不產生 consolidated total；
- loan allocations sum mismatch 必定 unreconciled；
- migration failure 不留下半套 schema；
- full-scope readiness 在缺／過期 attestation 時不得 complete；
- high-risk receipt 不可重放，payload/version 改變必定 invalid；
- typed identity merge 前後所有 FK count、source facts 與 audit 可對帳；
- WAL backup restore 後 canonical rows、logs、FK 與 schema version 一致。

### 18.4 Global Verification Gate

```powershell
git diff --check
$env:FINANCE_DB_PATH = Join-Path $env:TEMP "last-say-foundation-verify.sqlite"
npm test
npm run lint
npm run build
npm run audit:prod
npm run verify:release
```

`verify:release` 若自行管理隔離 DB，仍需確認不會讀取 caller 的真實 DB；任何 screenshot 使用 demo DB。

---

## 19. Data Source Map

| User input | AI extracts/researches | Canonical persistence | Program validates/derives |
|---|---|---|---|
| Account list | institution、kind、masked identity、currency、entity | institutions、accounts、aliases | identity conflict、scope、review |
| User inventory confirmation | 哪些 account／liability／investment 領域已盤點、截至何日、排除什麼 | scope attestations | expiry、new-resource invalidation、full-scope readiness guard |
| Expected data cadence | 每個 account/context 預期 statement／snapshot 頻率與 grace | source expectations／goal links | missing period、overdue source、next action |
| Bank CSV/statement | transactions、pending/posted、balance、period | transactions、sources、balance snapshots | dedupe、sum、freshness、reconciliation |
| Credit-card statement | charges、refunds、statement balance、due/min due、official installment schedule | transactions、card statements/items、installment plans/entries | no double expense、schedule sum、statement coverage |
| Current/unbilled card data | provisional transactions、unbilled balance | transactions/status、balance snapshots | provisional/official supersession |
| Loan contract/schedule | terms、principal、APR、schedule split | liability profiles、schedule entries | payment allocation、remaining principal readiness |
| Brokerage statement | account、trades、holdings、reported value | investment trades、holding snapshots | holdings/trade consistency |
| Market web/API evidence | instrument identity、price、as-of、currency | market quotes、sources | decimal validation、staleness、valuation |
| FX evidence | currency pair、rate、as-of | fx quotes | inversion/cross-rate policy、staleness |
| Recurring income/bills | cadence、amount/range、due、source | commitments/occurrences | occurrence generation、conflict |
| Manual asset/liability | identity、value、method、as-of | valued items/snapshots | Tier 2 limitation、freshness |
| Human corrections | selected identity/value/relation | typed state + change log | authority precedence、recompute readiness |

---

## 20. Phase Plan

所有 Phase 依序執行。每個 Phase 驗收通過後才 commit、才進下一個；禁止空 commit。Schema migration、registry 與 shared public API 為 serial coordinator owner，不平行修改。

### Phase 0：Contracts、ADRs、Spikes、Fixtures

#### Goal Contribution

- DF-G1-DF-G11：鎖定語意、相容性與可驗證樣本。

#### Required Contracts

- `docs/contracts/financial-data-core-contract.md`
- `docs/contracts/source-evidence-ingestion-contract.md`
- `docs/contracts/account-balance-storage-contract.md`
- `docs/contracts/liability-and-commitment-storage-contract.md`
- `docs/contracts/investment-valuation-storage-contract.md`
- `docs/contracts/readiness-analysis-context-contract.md`
- `docs/contracts/financial-data-operator-contract.md`
- `docs/contracts/backup-restore-contract.md`
- 更新既有 `balance-sheet`、`cash-flow`、`transfer-matching` contracts 的上游 owner 引用，不複製其報表行為。

#### ADRs／Spikes

- ADR-1：Shared Kernel + Typed Contexts，拒絕 universal record table。
- ADR-2：新 money／decimal representation 與 library decision。
- ADR-3：accounts additive migration vs rebuild；預設 additive。
- ADR-4：source authority、conflict selection、supersession。
- ADR-5：ingestion staging retention 與 privacy。
- ADR-6：localhost actor boundary、high-risk pending proposal 與 human confirmation receipt；明列不防惡意本機程式。
- SPIKE：legacy v0.2.3 DB migration rehearsal。
- SPIKE：`node:sqlite` BigInt round-trip 與 WAL-consistent backup／restore。
- SPIKE：bank/card/loan/investment fixture mapping。
- SPIKE：100k transactions + 10k holdings/quotes query benchmark baseline。

#### Files／Owners

- `docs/plans/financial-data-foundation-master-plan.md`
- `docs/contracts/*`
- `test/fixtures/financial-data/*` 或 repo-approved anonymized builders
- 不新增 runtime tables／routes／正式 UI。

#### Invariants And Boundaries

- 不碰真實 DB。
- 不以聊天決策取代 ADR。
- Fixture 不含真實銀行、商家、帳號或持倉。
- 不先做 Data Center UI。

#### Validation

```powershell
git diff --check -- docs test
git check-ignore data/finance.sqlite uploads outputs
```

#### Outcome Evidence

- 每種 Tier 1 context 至少一個 input → canonical payload → expected DB/readiness fixture。
- 每個 Goal ID 對應 requirement、Phase 與 acceptance scenario。
- Decimal、account migration、authority 與 retention 的 blocking decisions 已裁決。
- 新 session 能只讀本計畫與 contracts 說明 Phase 1 owner、禁止項與驗收。

### Phase 1：Migration Runner 與 Shared Kernel

#### Goal Contribution

- DF-G1、DF-G2、DF-G7、DF-G10、DF-G11。

#### Deliverables

- `schema_migrations` runner，保留 `lib/db.js` facade、newer refusal 與 atomic migration。
- `reporting_entities`、`institutions`。
- institution aliases、additive accounts metadata、stable `account_key`、`account_aliases`。
- additive sources evidence metadata。
- scope attestations、source expectations 與 goal links。
- `data_change_log` append-only。
- high-risk `human_confirmation_requests` workflow 與 one-time receipt validator。
- shared enums、money/currency/date/error JSON Schemas。
- `GET /api/finance/capabilities` v1。
- account/source CRUD services 與 optimistic version。
- consistent local backup／restore utility + manifest／integrity rehearsal；不提供 AI restore route。
- Last Say Skill 同步 Phase 1 API 與安全規則。

#### Target Owners

- `lib/db/*`
- `lib/finance/contracts/*`
- `lib/queries/finance/entities.js`
- `lib/queries/finance/institutions.js`
- `lib/queries/finance/accounts.js`
- `lib/queries/finance/sources.js`
- `app/api/finance/capabilities/*`
- domain CRUD routes

#### Invariants And Boundaries

- 不重建 `transactions`／accounts parent table。
- 不改 legacy dedupe／normalize。
- Inferred account kind 一律 needs review。
- 不以 generic repository／generic records API 實作。

#### Validation

```powershell
$env:FINANCE_DB_PATH = Join-Path $env:TEMP "last-say-foundation-p1.sqlite"
npm test -- test/database-foundation.test.js test/unit-a-migrate-schema.test.js test/import-dedupe.test.js test/financial-scope.test.js test/human-confirmation.test.js test/backup-restore.test.js
npm run lint
npm run build
```

#### Outcome Evidence

- 新 DB 與 legacy fixture DB 均升級成功且重跑冪等。
- Existing transaction ids/dedupe/human corrections/rules 數量與語意不變。
- 同名顯示帳戶可透過 stable key／alias 區分，source alias conflict 可見。
- 沒有 scope attestation 時，全域 readiness 不會因資料列存在而 complete；新增 resource 會讓舊聲明失效。
- WAL fixture 可建立一致備份並還原到新路徑；損毀／newer manifest 被拒絕。
- 偽造 `actor_type=human`、receipt replay、expired／changed payload 均無法通過 high-risk commit。
- capabilities schema 與 runtime validators 使用同一 enum source。

### Phase 2：Ingestion Foundation、Accounts、Balances、Cash Activity Compatibility

#### Goal Contribution

- DF-G2、DF-G3、DF-G7、DF-G8、DF-G11。

#### Deliverables

- `ingestion_runs`／contexts／items compound preview/commit/idempotency。
- committed-run reverse-preview／human-confirmed typed reversal，不 hard delete source facts。
- `account_balance_snapshots`。
- transactions additive currency/status/external identity fields。
- current ledger adapter 接入 account alias／source evidence service。
- account/balance/source preview + CRUD APIs。
- scope attestation／source expectation CRUD APIs；complete attestation 只允許人類確認。
- inventory v1：entities、accounts、latest balances、sources、transaction coverage。
- readiness goals：`spending_history`、`cash_position`。
- 最小 Account Register／balance review UI，desktop/mobile。
- Skill：bank/account/snapshot ingestion workflow。

#### Work Packages

- P2A：ingestion protocol + JSON Schema + idempotency。
- P2B：balance snapshot service + conflict/freshness。
- P2C：legacy ledger compatibility adapter。
- P2D：account/balance human UI。

P2A-P2C durable writes 必須序列整合；UI 可在 API contract 固定後平行實作。

#### Invariants And Boundaries

- Preview 不寫 canonical tables。
- Commit 對同一 run 的所有 typed sections all-or-nothing；跨 section client reference 未解析不得 commit。
- Reversal 也 all-or-nothing；缺任何 context reversal owner 或存在 unresolved human evidence 時 fail closed。
- Existing transaction queries 將 legacy null/posted 視為 active、reversed/superseded 排除於 summary／P&L／readiness；review/audit drilldown 仍可查歷史。這個 filter 必須由共用 query helper 擁有，不能各頁散寫。
- running balance 不可標 official。
- Source expectation candidate 不可自行升級成 hard blocker；AI 不可自行宣告盤點完整。
- 現有 `/api/import-ledger` response 與 rules-applied stats 保持。

#### Validation

```powershell
$env:FINANCE_DB_PATH = Join-Path $env:TEMP "last-say-foundation-p2.sqlite"
npm test -- test/import-dedupe.test.js test/query-month-all.test.js test/reviewed-on-correction.test.js test/financial-ingestion.test.js test/compound-ingestion.test.js test/ingestion-reversal.test.js test/account-balances.test.js
npm run lint
npm run build
```

#### Outcome Evidence

- 同一 bank/card source 重送不重複；payload key/hash conflict 回 409。
- Compound card fixture 任一 section validation 失敗時 transactions／statement／balance／installments 全部零寫入。
- 誤匯 run 經 impact preview + human receipt 後可完整反轉；原 source/audit 留存，相關 readiness 回到缺口狀態。
- Official balance 與 running balance 衝突時兩者並存且 readiness 不 complete。
- 缺期／過期來源與 scope 未確認會分別回 gap；使用者可在 UI 確認盤點範圍與更新期待。
- 使用者可在 UI 看見所有帳戶、最新餘額、來源與 stale/missing。
- 現有信用卡交易 review、rules、P&L 無回歸。

### Phase 3：Credit Cards、Loans、Commitments

#### Goal Contribution

- DF-G3、DF-G4、DF-G7、DF-G8、DF-G9。

#### Deliverables

- credit-card profiles／statements／statement item links／payment matches。
- credit-card installment plans／entries，並與 statement items、commitments read model 對接。
- liability profiles／loan schedules／payment allocations。
- commitments／occurrences。
- Domain preview/CRUD APIs、conflict/review services。
- inventory/readiness：`debt_obligations`、`liquidity_forecast_90d` prerequisites。
- 卡片與負債人類維護／review UI。
- Skill：card terms、loan contract、schedule、commitment workflows。

#### Invariants And Boundaries

- 卡費付款不重複成 expense。
- 分期原消費只認列一次；未來 entries 是清償義務，schedule 不平衡即 unreconciled。
- Loan allocation 不平衡即 unreconciled。
- AI 不從 APR 猜 official payment schedule。
- 歷史 fixed baseline 只形成 candidate。
- 本 Phase 不實作 90-day forecast。

#### Validation

```powershell
$env:FINANCE_DB_PATH = Join-Path $env:TEMP "last-say-foundation-p3.sqlite"
npm test -- test/credit-card-storage.test.js test/credit-card-installments.test.js test/liability-storage.test.js test/commitments.test.js test/reporting-income-statement.test.js
npm run lint
npm run build
```

#### Outcome Evidence

- Statement charge、refund、due、partial payment 與 unbilled 各有正確 owner。
- 官方分期 schedule 能提供後續 obligations；unknown revolving interest 保持 partial，不製造假 schedule。
- Loan payment 可拆 principal/interest/fee，總和與 cash transaction 一致。
- 修改 commitment template 不改寫 settled occurrences。
- 缺 card statement／loan principal 時 readiness 明確列出 blocker 與 next action。

### Phase 4：Investments、Quotes、FX、Valuation

#### Goal Contribution

- DF-G2、DF-G5、DF-G7、DF-G8、DF-G9、DF-G10。

#### Deliverables

- decimal owner 與 property tests。
- instruments／trades／holding snapshots／market quotes／FX quotes。
- investment cash matches。
- deterministic valuation service + watermark。
- inventory/readiness：`investment_value`、net-worth investment prerequisites。
- 投資資料／quote freshness UI。
- Skill：instrument identity、quote research、source/as-of、preview/commit。

#### Invariants And Boundaries

- Quantity、price、FX 不用 float canonical storage。
- Quote 無 source/as-of 不可 commit。
- Source-reported market value 與 derived valuation 分欄。
- 缺 FX 不產生 base-currency total。
- Options／futures／margin／DeFi／tax lots 回 unsupported 或 needs separate context。

#### Validation

```powershell
$env:FINANCE_DB_PATH = Join-Path $env:TEMP "last-say-foundation-p4.sqlite"
npm test -- test/money-decimal.test.js test/investment-storage.test.js test/investment-valuation.test.js test/financial-readiness.test.js
npm run audit:prod
npm run lint
npm run build
```

#### Outcome Evidence

- USD holding + USD quote + TWD/USD FX 得到可重現 TWD value 與完整 watermark。
- Quote stale／missing／currency mismatch 各有 deterministic readiness。
- 同 instrument 多 provider quotes 不被 last-write-wins 覆蓋。
- Unsupported derivative 不會被 `other` 類型誤算成普通 stock。

### Phase 5：Manual Valued Items 與 Cross-Context Reconciliation

#### Goal Contribution

- DF-G6、DF-G8、DF-G9、DF-G10、DF-G11。

#### Deliverables

- valued items／valuation snapshots。
- transfer matches、typed cross-context match contract 完整化。
- institution／account／instrument typed merge preview + human-only commit，含 FK impact registry 與 redirect。
- unified review task projection／lifecycle。
- source conflict resolution flow。
- net-worth readiness 所需所有 Tier 1／Tier 2 inventory。
- Skill：manual valuation、unsupported escalation、reconciliation workflow。

#### Invariants And Boundaries

- Tier 2 value 不產生未建模的 P&L/cash flow。
- Generic relationship table 不得取代 typed FK matches。
- Identity merge 不得以 generic cascade、刪 source row 或 AI auto-confirm 實作。
- Low-confidence transfer／settlement 不自動 confirmed。
- Unsupported context 不得靠 JSON bypass validator。

#### Validation

```powershell
$env:FINANCE_DB_PATH = Join-Path $env:TEMP "last-say-foundation-p5.sqlite"
npm test -- test/valued-items.test.js test/transfer-matching.test.js test/reconciliation.test.js test/identity-merge.test.js test/financial-readiness.test.js
npm run lint
npm run build
```

#### Outcome Evidence

- 房產人工估值可進 net-worth inventory，但清楚標示 method/as-of/Tier 2。
- Bank transfer、card settlement、loan allocation、investment cash leg 不重複計算。
- One-sided transfer 讓相關 goal unreconciled。
- Merge preview 列出所有 FK impact；人類確認後 source key redirect、facts 不遺失、scope/readiness 重算。
- Review task resolution 可追到 human evidence，無孤兒 task。

### Phase 6：Readiness Engine 與 Analysis Context Packs

#### Goal Contribution

- DF-PG1、DF-G8、DF-G9、DF-G10。

#### Deliverables

- 全部 initial readiness goals 與 requirement graph。
- inventory v2、gap priority、policy version、source watermark。
- analysis-context dataset registry、filters、pagination、aggregation limits。
- deterministic valuation/reconciliation read models。
- API contract tests、privacy/size/error tests。
- Skill：自然語言分析 preflight、缺口引導、fact/derived/interpretation 回報格式。

#### Invariants And Boundaries

- No SQL／column expressions from client。
- Readiness 只針對 goal/scope/as-of，不產生全域 completeness 分數。
- Analysis context 不保存 AI interpretation 為 fact。
- Dataset aggregation 不繞過 source/authority filters。

#### Validation

```powershell
$env:FINANCE_DB_PATH = Join-Path $env:TEMP "last-say-foundation-p6.sqlite"
npm test -- test/financial-readiness.test.js test/analysis-context-api.test.js test/api-error-safety.test.js
npm run lint
npm run build
```

#### Outcome Evidence

- 同一 fixture 對不同 analysis goals 回不同且可解釋的 gaps。
- 補入最高優先資料後，相關 blocker 消失且其他 scope 不被誤改。
- Arbitrary dataset/table/filter 被拒絕。
- AI 可只靠 API 結構回答「目前能分析什麼、缺什麼、下一步補什麼」。

### Phase 7：Human Data Center、Operator Closure、Release Gate

#### Goal Contribution

- DF-PG1、DF-G7、DF-G8、DF-G9、DF-G11。

#### Deliverables

- 完整 Data Center navigation 與所有 required UI states。
- Desktop/mobile end-to-end review、version conflict、source drilldown。
- Last Say Skill 自含 capabilities、各 context workflows、error recovery、A6-style self-check。
- Skill eval corpus：inventory、bank import、loan、investment quote、gap analysis、unsupported escalation。
- Demo seed 覆蓋全部 anonymized contexts。
- README／README.en capability、privacy、scope、unsupported boundary 更新。
- Backup／restore 操作文件與從 anonymized backup 還原後的 release rehearsal。
- `npm run verify:release` 整合全部 foundation gates。

#### Invariants And Boundaries

- UI 不顯示真實資料證據圖。
- AI eval 不使用真實 statement。
- UI 不內建 LLM 或分析 chat。
- Phase 7 不臨時新增未經前面 schema contracts 的 context。

#### Validation

```powershell
$env:FINANCE_DB_PATH = Join-Path $env:TEMP "last-say-foundation-p7.sqlite"
npm test
npm run lint
npm run build
npm run audit:prod
npm run verify:release
```

另需使用 demo DB 保存：

- desktop inventory/readiness screenshot；
- mobile gap → edit/review screenshot；
- API transcript：AI preflight → preview → commit → readiness improved；
- Skill eval results 與失敗案例。

#### Outcome Evidence

- 新使用者可由 AI 盤點已有資料、補一個缺口、提交、人工確認並重新分析。
- 人類能從每個重要 value drill down 到來源與 change evidence。
- Existing credit-card monthly workflow 完整通過。
- 所有 Tier 1／Tier 2 scope、unsupported boundary 與後續計畫依賴同步。

---

## 21. Acceptance Scenarios

### A1：Legacy 信用卡零回歸

- **Given** v0.2.3 DB 有信用卡交易、人工分類、規則與 corrections
- **When** 升級並重匯同一 ledger
- **Then** transaction ids/dedupe 數量不變
- **And** 人工分類不被覆寫
- **And** 新 account/source metadata 可補上但不改原始交易事實

### A2：銀行流水與官方餘額分離

- **Given** bank CSV 最後 running balance 是 NT$50,000
- **And** official statement snapshot 是 NT$49,800
- **When** 兩者匯入
- **Then** 交易與 snapshot 各自保存
- **And** reconciliation 顯示 NT$200 差額
- **And** tool 不修改任何交易來湊平

### A3：重複提交冪等

- **Given** AI 已 preview/commit 一批 100 筆 bank activities
- **When** 以相同 idempotency key／payload hash 重試
- **Then** 回傳原 commit 結果
- **And** canonical rows 不增加

### A4：帳戶 Alias 衝突

- **Given** 同一來源 alias 可能對應兩個 accounts
- **When** AI 提交 mapping
- **Then** preview 回 `IDENTITY_CONFLICT`
- **And** 不寫 transactions/snapshots
- **And** 人類可選擇 account 並留下 evidence

### A5：信用卡帳單與付款不重複

- **Given** card charge NT$10,000、official statement due NT$10,000、bank payment NT$10,000
- **Then** charge 只形成一次 expense/liability fact
- **And** payment 是 settlement/cash movement
- **And** statement/payment match 可追溯

### A6：貸款本金與利息

- **Given** monthly payment NT$20,000 = principal NT$19,000 + interest NT$1,000
- **Then** cash movement NT$20,000
- **And** principal reduction NT$19,000
- **And** cost NT$1,000
- **And** allocation 不平衡時 readiness unreconciled

### A7：投資現值由 AI 查價、工具計算

- **Given** 10.5 units、USD 123.456 quote、同日 TWD/USD FX
- **When** AI 提交 quote/FX evidence
- **Then** tool 依 decimal/rounding policy 算 market value
- **And** response 帶 holding/quote/FX watermark
- **And** AI 不直接寫無來源的 TWD total

### A8：過期價格不可假裝現值

- **Given** holding current、quote 已超過 goal freshness policy
- **When** 查 investment_value readiness
- **Then** status stale
- **And** 回傳需更新的 instrument、舊 quote as-of 與影響金額範圍

### A9：多幣別缺 FX

- **Given** TWD cash 與 USD holding 都有 current facts
- **And** 缺 TWD/USD FX
- **Then** 各原幣明細可用
- **And** TWD consolidated net worth unavailable/partial
- **And** 不沿用無 as-of 的 default rate

### A10：人工估值項目

- **Given** 使用者提供房產估值與日期
- **Then** 保存為 Tier 2 valued item snapshot
- **And** 可納入 scoped net-worth inventory
- **And** 不自動產生折舊、capital gain 或 cash flow

### A11：Unsupported 衍生品

- **Given** AI 遇到 option position
- **When** capabilities 未宣告 option context
- **Then** preview 回 `UNSUPPORTED_CONTEXT`
- **And** source 可註冊但 position 不偽裝成 ordinary stock
- **And** readiness 說明需另立 context

### A12：分析前主動找缺口

- **Given** 使用者問「我總共有多少資產」
- **And** 一張卡缺 balance、brokerage 缺 FX
- **When** AI 查 net_worth readiness
- **Then** tool 回具體 blockers、影響與 next actions
- **And** AI 先引導補資料，不給假精準總額

### A13：人類與 AI 同時修改

- **Given** AI preview 基於 record version 3
- **And** 人類在 UI 將 record 更新為 version 4
- **When** AI commit version 3 update
- **Then** API 回 409 VERSION_CONFLICT
- **And** version 4 不被覆寫

### A14：來源權威衝突

- **Given** official statement 與 manual snapshot 同日不同值
- **Then** 兩份 facts 與 sources 都保留
- **And** effective selection 有 policy/人類 evidence
- **And** conflict 解決前 readiness 不 complete

### A15：Migration 原子性

- **Given** legacy DB upgrade 在第 N migration 中途失敗
- **Then** schema/data/version 全部 rollback
- **And** 舊 app 仍可讀原 DB copy
- **And** 真實 DB 未被測試命令觸碰

### A16：不能從現有資料推測「全部都在」

- **Given** DB 有一個銀行帳戶與最新 balance，但沒有 cash-account `scope_attestation`
- **When** 查 `cash_position` 或使用「我所有現金」的 full scope
- **Then** readiness 是 `partial` 並要求確認帳戶盤點範圍
- **And** AI 不可自行建立 `declared_complete`
- **When** 人類確認範圍後又新增第二個相關 account
- **Then** 舊 attestation 失效，readiness 回到 partial，直到人類重新確認

### A17：信用卡分期不重複支出也不遺失未來義務

- **Given** 一筆 NT$12,000 消費與官方 12 期 schedule
- **When** statement、P&L 與 debt readiness 被查詢
- **Then** 原消費只認列一次支出
- **And** 12 個 installment entries 作為未來清償義務，不各自再形成 merchant expense
- **And** 每期 statement/payment settlement 只減少 card liability／cash
- **And** schedule principal、fee 或總額對不上時保持 `unreconciled`

### A18：WAL 一致備份與還原

- **Given** 隔離 test DB 在 WAL 模式且含 migrations、facts、append-only logs
- **When** local operator 建立 backup 並 restore 到新的 test path
- **Then** integrity、schema/app manifest、FK、row identities、logs 與 checksums 通過
- **And** DB-only manifest 明列未包含 source artifacts；full bundle 逐檔驗證 allowlisted path 與 hash
- **And** 損毀檔案、newer schema 或只複製主 DB 的不完整 artifact 被拒絕
- **And** backup／restore 不可透過 AI data API 執行

### A19：重複 Identity 的安全合併

- **Given** 兩個 account 已各自連結 transactions、sources、snapshots 與 review evidence
- **When** AI 提交 merge preview
- **Then** response 列出所有 FK row counts、欄位衝突、禁止條件與 readiness impact，不改 canonical state
- **When** 人類確認且 receipt/version/payload hash 有效
- **Then** typed FKs 原子重綁、aliases repoint、source account archived + redirect、audit append
- **And** source facts、human evidence、resource keys 都可追溯，merge cycle／不相容 currency/entity 被拒絕

### A20：偽造人類 actor 不等於確認

- **Given** high-risk scope-complete 或 identity-merge proposal
- **When** caller 只送 `actor_type=human`，或重放／竄改已確認 receipt
- **Then** API 回 `HUMAN_CONFIRMATION_REQUIRED` 或 version/hash conflict，不 commit
- **And** 只有 UI confirmation flow 產生、尚未使用且綁定同 payload/version 的 receipt 可完成操作
- **And** 文件清楚說明這是 localhost workflow control，不防惡意本機程式

### A21：一份來源的多 Context 原子匯入

- **Given** 一張 card statement bundle 含 transactions、statement header/items、ending balance 與 installment schedule
- **And** installment section 有一筆 unresolved client reference
- **When** preview／commit
- **Then** preview 明確指出 section/item error，commit 被拒絕
- **And** transactions、statement、balance、installments、source links、audit 全部零新增
- **When** reference 修正後以新 hash preview/commit
- **Then** 所有 sections 在同一 transaction 成功，重送同 idempotency key/hash 回原結果且不重複

### A22：整批誤匯可復原但不抹除歷史

- **Given** 一個 committed bank bundle 被匯到錯 account，且尚無衝突 human correction
- **When** AI 建立 reverse-preview
- **Then** 工具列出 transactions、balances、source links、matches、audit 與 readiness impact，不立即修改
- **When** 人類確認同一 impact hash/version
- **Then** reversal run 原子標記 typed facts reversed/superseded，保留原 source/run/logs，analysis 排除錯誤 facts
- **And** 正確資料必須以新 run 匯入；若存在無法安全保留的 human evidence，reversal fail closed

---

## 22. Goal-To-Plan Traceability

| Goal ID | Requirement | Owner／Phase | Observable evidence |
|---|---|---|---|
| DF-PG1 | AI 可盤點、補缺口、安全寫入、再分析 | P1-P7 | A12、完整 operator transcript、Skill eval |
| DF-G1 | entity/institution/account/instrument stable identity + declared scope | P1、P4、P5 | A4、A16、A19、alias/id migration tests |
| DF-G2 | source/authority/conflict/supersession/reversal | P1-P5 | A2、A7、A14、A22 |
| DF-G3 | bank/card activity + balances | P2-P3 | A1、A2、A5、A17 |
| DF-G4 | liabilities + commitments | P3 | A6、A17、debt readiness |
| DF-G5 | investments + quotes + FX + valuation | P4 | A7-A9 |
| DF-G6 | Tier 2 valued items | P5 | A10 |
| DF-G7 | preview/compound commit/reversal/idempotency/version/human confirmation | P1-P7 | A3、A13、A20-A22 |
| DF-G8 | readiness/data-gap engine | P2-P6 | A8、A9、A12、A14、A16 |
| DF-G9 | controlled analysis context | P6 | dataset whitelist/API contract evidence |
| DF-G10 | bounded contexts/extension gate | 全 Phase | A11、ADR reviews、schema nullability check |
| DF-G11 | legacy/data protection | 全 Phase | A1、A15、A18、A20、A22、existing test suite/release verifier |

---

## 23. 主要決策

### D1：是否建立 universal `financial_events`／postings 作所有資料核心

**裁決：否。** Current transactions 保留 Cash Activity；Accounting context 未來可從 typed facts 建 postings。若三個以上 context 確認需要穩定 event envelope，再以 ADR 引入，不能先為理論一致性遷移全庫。

### D2：共用 schema 還是 bounded contexts

**裁決：共用 shared kernel 與契約，各 context typed storage。** 共用「語意與安全機制」不等於共用同一張表。

### D3：新增 `financial_accounts` 還是擴充 `accounts`

**裁決：先 additive 擴充 `accounts` + `account_aliases`。** 避免雙 account truth；若 unique-name 或 FK migration 實證成為 blocker，另立 rebuild ADR，不先建 sidecar 平行身份。

### D4：Canonical JSON／EAV

**裁決：禁止。** JSON 只用於 staging、raw payload 與 audit snapshot；canonical facts 必須 typed、可約束、可索引。

### D5：Money 與投資小數

**裁決：money integer minor units；quantity/price/FX validated decimal strings + decimal arithmetic owner。** 禁止 float 作 canonical fact。

### D6：多幣別

**裁決：從第一階段保存原幣；有合格 FX 才 consolidated。** 不等待未來才補 currency，也不在缺 FX 時產生總額。

### D7：AI 是否可任意查 SQL

**裁決：不可。** 使用 capability registry + named datasets + white-listed filters；分析彈性由新增 read model 提供，不把 DB attack surface 交給 prompt。

### D8：AI 查投資現值的責任

**裁決：外部 AI 查找並提交 quote evidence；Last Say validate/persist/calculate。** Server 不內建 provider、credential 或任意 URL fetch。

### D9：資料更新與刪除

**裁決：source facts 以 supersede/reverse 為主；metadata 可 optimistic update；有 downstream evidence 的 resource 預設 archive，不 hard delete。** 每個 context contract 明定例外。

### D10：Entity ownership

**裁決：一個 account 先屬於一個 reporting entity，existing default personal。** Joint ratio／mixed ownership 不塞進 Phase 1；以 household entity 或 partial warning 處理，未來另立 allocation context。

### D11：Generic valued item 的能力

**裁決：只保證 identity + valuation snapshots + provenance + net-worth inventory。** 不因「可保存價值」就宣稱具備交易、收益、稅務或 forecast 語意。

### D12：Migration rollback

**裁決：forward-only atomic migrations + pre-upgrade backup。** 不實作高風險自動 down migration；失敗原子 rollback，升級後回復靠 DB backup。

### D13：如何判斷「已盤點全部資料」

**裁決：以有期限、可版本化的 human scope attestation 作 full-scope guard；不得從現有 accounts／sources row count 推測完整。** 明確指定單一 account 的分析可不要求全域 attestation，但輸出必須標示 scoped，不能改稱總資產／所有現金。

### D14：資料缺期何時成為硬 blocker

**裁決：source expectation 可以由程式／AI 提案，但只有 human-confirmed expectation 會驅動 hard missing-period blocker。** 這避免系統因猜錯銀行帳單週期持續誤報，同時保留可程式化檢查漏月與過期資料的能力。

### D15：Backup／restore 是否放進 AI API

**裁決：不放。** 備份與還原是 local operator recovery capability；AI data API 不可下載整庫或替換 active DB。WAL-consistent backup、manifest、integrity check 與新路徑 restore rehearsal 是 foundation release gate。

### D16：重複 identity 是否直接刪除／通用合併

**裁決：都不可。** Phase 1-4 先以 preview conflict 防止重複；Phase 5 才提供 institution／account／instrument 各自 typed merge impact registry。Human-confirmed merge 原子重綁已知 FKs、保留 archived redirect 與 audit；任何新 context 未加入 impact tests 前會讓該 merge 類型 fail closed。

### D17：如何技術上區分 AI 與人類確認

**裁決：不信任 request 的 actor label；高風險操作需 pending proposal + one-time human confirmation receipt。** Receipt 綁 payload hash、resource version、action 與 expiry。這只防一般 agent 誤越權；無 auth 的 localhost app 無法抵抗已取得瀏覽器／本機權限的惡意 caller，公開部署需另立認證授權設計。

### D18：一份來源跨多個 Context 如何 commit

**裁決：使用 compound ingestion run，所有 typed sections 同一 transaction all-or-nothing。** 跨 section 以 client item keys 在 preview 解析；不以 partial commit 接受半張 statement。真正互不相依的資料由 operator 在 preview 前拆成不同 runs，而不是讓 server 猜哪些失敗可忽略。

### D19：Committed 誤匯要刪除還是反轉

**裁決：human-confirmed typed reversal，不 hard delete／in-place rewrite。** Reversal 先列完整 impact，所有 context 都能安全反轉才原子 commit；原 source、run、audit 與 human evidence 保留。修正資料以新 run 匯入，讓錯誤與復原都可追溯。

---

## 24. Spikes And Risks

### SPIKE 1：Decimal Arithmetic

- 驗證 dependency license/security、rounding、large values、performance，以及 `node:sqlite` 64-bit INTEGER／BigInt round-trip。
- Default：`decimal.js` 或等級相當 library。
- Fallback：central BigInt-scaled implementation + property tests。
- Blocks：Phase 4。

### SPIKE 2：Accounts Additive Migration

- 驗證 name unique、institution backfill、aliases 與 existing FK。
- Fallback：仍不直接建平行 account truth；先用 additive internal unique name + alias，table rebuild 另立 ADR。
- Blocks：Phase 1。

### SPIKE 3：Source Conflict And Supersession

- 驗證同日多來源、official replacement、provisional → posted、quote provider conflict。
- Fallback：不選 effective value，readiness conflicted，要求人類。
- Blocks：Phase 2 conflict automation。

### SPIKE 4：Investment Coverage

- 用 anonymized broker statement 驗證 trades vs holding snapshots、dividends、splits、fees、multi-currency。
- Fallback：Phase 4 先以 official holding snapshots + quotes 支援 valuation；transaction-derived holdings 延後。
- Blocks：宣稱 investment trades complete。

### SPIKE 5：Ingestion Staging Retention

- 評估 pending payload size、privacy、resume need。
- Default：pending/failed 短期保存，committed 清除 payload 只留 hash/count/result refs。
- Blocks：Phase 2。

### SPIKE 6：Read Model Performance

- 100k transactions、10k holdings/quotes、1k accounts/commitments benchmark。
- Fallback：indexes + watermark cache，不建立第二事實來源。
- Blocks：公開 performance claim，不阻擋個人 MVP。

### SPIKE 7：WAL Backup／Restore

- 驗證 Node 22 `node:sqlite` consistent backup、checkpoint／busy connection 行為、manifest 與 restore 到新 path。
- 禁止 fallback 為「只複製主 `.sqlite` 檔」；若 runtime API 不足，fallback 是明確停服、驗證 `-wal` 已安全 checkpoint 後再複製整組 artifact。
- Blocks：Phase 1 recovery utility 與任何 migration release。

### Major Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| Schema explosion | 維護與 migration 成本失控 | Context gate、phase contracts、每 table 明確 owner |
| Over-generalization | 無法約束、AI 寫入錯誤 | 禁 EAV/generic write、typed JSON Schemas |
| Under-generalization | 每個銀行／商品重造 API | shared identity/source/money/review + adapters |
| Lost update | AI 覆蓋人類新修改 | expected_version + 409 + audit |
| False completeness | 缺帳戶仍出健康總額 | scope attestation、source expectations、readiness requirement graph |
| Investment precision | float 造成價值誤差 | decimal strings + centralized arithmetic |
| Migration damage | 真實歷史資料受損 | temp rehearsal、atomic migration、backup、compat tests |
| Broken backup | WAL 未納入或 restore 才發現損毀 | consistent backup spike、manifest、integrity、new-path restore rehearsal |
| Skill drift | AI 依過期 payload 寫入 | same-phase Skill sync + capabilities API + evals |
| Privacy leakage | 真實資料進 log/fixture/commit | ignored paths、sanitized fixtures、release scan |
| Context coupling | 改 investment 破壞 transactions | typed bounded contexts + read models |

---

## 25. Parallel／Serial Execution Boundaries

### Must Be Serial

- migration runner／schema versions；
- accounts/sources shared columns；
- capability registry／enums；
- ingestion commit transaction；
- shared API error contract；
- backup／restore active-DB replacement；
- legacy import adapter integration；
- final Skill/README/release integration。

### Can Be Parallel After Contracts Freeze

- Pure fixtures for liabilities vs investments；
- Domain query/service implementation in non-overlapping files；
- Data Center UI against fixed API schemas；
- Skill eval cases；
- Documentation source maps。

### Worktree Rule

每個平行 work package 必須列：allowed files、forbidden shared files、schema/API version、lightweight gates、deferred browser evidence、integration owner。任何需要改 `lib/db.js`、migration registry、shared enums 或 package dependencies 的 worktree 必須交由 coordinator 序列整合。

---

## 26. Deferred Verification Ledger

本計畫允許把昂貴的跨 context、完整瀏覽器與 release 驗證集中到後續 integration gate，但不允許以「之後再測」跳過當下可低成本證明的行為。每個 Phase 的 targeted tests、migration rollback、lint、build、真實資料隔離與 `git diff --check` 仍是該 Phase commit 前的硬門檻。

### 26.1 延後規則

1. 只有跨 Phase 才能成立、成本顯著高於當前 work package，或需要完整 demo surface 的驗證可以延後。
2. Syntax、schema validation、lint、targeted unit／integration tests、API error shape、資料保護與 forbidden import 不可延後。
3. 每筆延後項目必須記錄 origin package、原因、最晚關閉 Phase、驗證命令／證據、失敗回修 owner，以及是否阻塞 release／legacy cleanup。
4. Phase 可以在 targeted acceptance 通過且 ledger 已登記時完成 architecture landing；不得因此宣稱使用者流程或整體產品已驗收。
5. Phase 7 結束時 ledger 必須為空；若任一 release-blocking 項目仍開啟，Master DoD 不成立。

### 26.2 初始 Ledger

| ID | Origin | 延後驗證 | 延後理由 | 最晚關閉 | 必跑命令／證據 | 失敗回修 owner | 阻塞 |
|---|---|---|---|---|---|---|---|
| DVL-01 | P1-P6 | 全套 legacy + foundation regression | 各 Phase 已跑 targeted tests；完整組合需所有 migration 與 read model 到位 | P7 | 隔離 DB 下 `npm test`、`npm run verify:release` 原文輸出 | 首個失敗 test 所屬 package；migration 問題回 P1 coordinator | release、legacy facade cleanup |
| DVL-02 | P2-P5 | Data Center 跨頁 desktop/mobile 完整流程 | 早期 Phase 只能驗證自己的最小 UI；完整 drilldown、review、conflict 需所有 context | P7 | anonymized demo DB；desktop 與 mobile 的 inventory → gap → edit → review 截圖及 browser console/network 證據 | 對應 UI package；view-model 問題回資料 owner | release |
| DVL-03 | P1-P6 | Last Say Skill 全 corpus eval | 單 Phase 只能驗證當期 payload；跨 context preflight 與 recovery 需 capabilities 完整 | P7 | 固定 eval：inventory、bank、card、loan、investment、gap、version conflict、unsupported；保存逐案 pass/fail | 當期 Skill sync package；API 漂移回 contract owner | release |
| DVL-04 | P2-P6 | 100k transactions／10k holdings-quotes 整合 benchmark | Phase 0 只建立 baseline；最終 query shape 到 P6 才完整 | P6 | anonymized benchmark builder、硬體／Node／SQLite 版本、各 query p50/p95 與 query plan | P6 read-model owner；索引 migration 回 coordinator | 公開效能主張，不阻塞小資料正確性 |
| DVL-05 | P3-P5 | card settlement、loan allocation、transfer、investment cash leg 跨 context 不重複 | 每個 typed match 可個別測；完整 reconciliation 要所有 match owner 存在 | P6 | canonical fixture 的 P&L／cash／net-worth before-after totals、unmatched/conflict cases 與 invariant tests | P5 reconciliation owner；來源事實錯誤回原 context owner | statements、net-worth readiness、release |
| DVL-06 | P4-P6 | quote／FX freshness 隨時間與 policy version 重算 | 單一 valuation 可先驗證；跨日期、時區與 policy migration 需 readiness owner | P6 | frozen-clock tests、stale boundary、missing FX、policy-version cache invalidation | P4 valuation + P6 readiness owner | investment readiness、release |
| DVL-07 | P7 | 最終 privacy／artifact／dependency gate | 只能在 docs、Skill、demo、screenshots 全部生成後完整掃描 | P7 | `npm run audit:prod`、`npm run verify:release`、tracked-file privacy scan、evidence 圖人工檢查 | P7 release coordinator；敏感 fixture 回產生 package | release、公開發佈 |

Phase 驗收紀錄若新增 deferred item，必須追加此表或同 schema 的獨立 ledger；不得只寫在聊天、commit message 或 agent 記憶。

---

## 27. Work Package 執行契約

Phase 是驗收與 commit 邊界，不是單次 agent 任務大小。每個 Phase 必須先依下列 package index 執行；單一 package 原則上只擁有一個 domain／layer，預期修改不超過六個 implementation files。超過時必須再拆，或在 package handoff 中說明無法拆分的 transaction／public API 原因。

### 27.1 標準格式

每個實作 session 開始前，必須從本計畫建立一份具體 handoff；缺任何必填欄位就不得修改檔案：

```text
ID:
Goal IDs:
Required behavior contract:
Baseline behavior and repo evidence:
Current owner:
Target owner:
Allowed files:
Forbidden files:
Existing owners to reuse:
Public API / schema version:
Type / validation / authority rules:
Parallel or serial:
Dependencies and entry gate:
Implementation steps:
Lightweight gates:
Deferred verification IDs:
Done when (observable outcome):
Cleanup / compatibility exit condition:
Integration risks and return owner:
```

共通 forbidden files／actions：真實 `data/finance.sqlite`、真實 `uploads/`／`outputs/`、未經指定的 `lib/normalize.js`、直接 SQLite 手改、任意 SQL API、server-side LLM、以 fixture 或 UI 需求竄改 source facts。需要修改 `lib/db.js`、migration registry、shared enums、public error envelope、package dependency 或 Skill 主入口時，一律改由 serial coordinator 整合。

### 27.2 Package Index

下表的「Owner／allowed surface」是預設寫入範圍；測試可另寫同 package 對應的 `test/*`，behavior contract 與 Skill 只有在該列明列時可改。任何跨列需求先停下更新 handoff，不以順手修改越界。

| ID | 交付 | Owner／allowed surface | Entry gate | Mode | Done evidence |
|---|---|---|---|---|---|
| P0A | GORE → behavior contracts | `docs/contracts/*`、本計畫 traceability | 本計畫 accepted | 可與 P0B 分析平行；contract integration 序列 | 每個 user-visible／API／persistence 行為有 contract ID、acceptance examples、evidence map |
| P0B | ADR-1 至 ADR-6 與 blocking spikes | `docs/adr/*`、anonymized spike evidence | P0A contract skeleton | 可平行研究，裁決序列 | decimal/BigInt、accounts、authority、retention、backup、human receipt、context boundary 均有結論與 fallback |
| P0C | Fixture matrix、legacy DB rehearsal、benchmark baseline | `test/fixtures/financial-data/*`、approved fixture builders | P0A payload shape；P0B privacy decision | 可平行依 context 建 fixture；builder integration 序列 | Tier 1 每種來源均可重建，無真實識別資訊，legacy migration baseline 可重跑 |
| P0D | Phase 1 execution freeze | 本計畫、contracts、ADRs | P0A-P0C complete | 序列 | Phase 1 handoff 的 paths、exports、schema/API versions、forbidden files 均已對 repo 重查 |
| P1A | Migration runner 與 rollback skeleton | `lib/db.js`、`lib/db/*`、migration tests | P0D | **序列 coordinator** | 新／legacy／newer DB、checksum、failure rollback、re-run idempotency 通過 |
| P1B | Shared contracts、money/currency/date/error schemas | `lib/finance/contracts/*` | ADR-2、P1A migration API fixed | 可平行實作；shared enum merge 序列 | JSON Schema 與 runtime validator 同源；unknown／precision／error tests 通過 |
| P1C | Entity、institution/account aliases、source、scope／expectation persistence | P1 migration、finance query owners、routes | P1A-P1B | **序列 schema**；query/route 可依 frozen schema 平行 | legacy backfill、alias conflict、source evidence、scope invalidation、optimistic version 通過 |
| P1D | Capabilities v1 與 operator contract sync | capabilities owner、`.claude/skills/last-say-ops/*` | P1B-P1C public contract | 序列 integration | runtime capabilities、Skill enums／examples、contract tests 無漂移 |
| P1E | WAL-consistent backup／restore utility | `lib/db/backup.js`、operator script、recovery tests/docs | P1A、P0 backup spike | **序列 recovery owner** | manifest/integrity/new-path restore 通過；損毀/newer backup 拒絕；無 AI restore API |
| P1F | High-risk pending proposal／human confirmation receipt | authority contract、confirmation query/route、tests、最小 UI queue | ADR-6、P1A-P1C | **序列 authority owner** | actor label spoof、receipt replay/expiry/hash/version mismatch 被拒絕；commit evidence append-only |
| P2A | Compound ingestion preview／commit／idempotency | `lib/finance/ingestion/*`、imports routes、P2 migration | P1 complete | **序列 durable-write owner** | preview zero canonical writes；multi-section commit atomic；client refs/duplicate/hash conflict deterministic |
| P2B | Balance snapshots、authority、freshness／conflict | balances query/service/routes、P2 migration | P2A source envelope | schema serial；domain tests 可平行 | official/running/manual 並存且不 last-write-wins；readiness 可見 stale/conflict |
| P2C | Legacy ledger compatibility adapter | `/api/import-ledger` adapter 與既有 import tests | P2A-P2B service contract | 序列高風險交會點 | response、dedupe、rules-applied、human protection 與既有行為相同 |
| P2D | Inventory v1、scope／source expectations 與 cash-position／spending readiness | inventory/readiness queries、named API routes | P2B-P2C | 可平行 read-only；registry merge 序列 | AI 可辨識盤點範圍、latest balance、缺期/source gap，不需整庫明細 |
| P2E | Account／balance 最小 Data Center | `components/finance-data/*`、對應 app route | P2D view model frozen | 可平行 UI | desktop/mobile empty、partial、stale、conflict、error、edit smoke 通過 |
| P2F | Committed-run reversal | ingestion reversal registry/routes/tests、human confirmation integration | P2A-P2E、P1F | **序列 cross-context owner** | impact preview 完整；unsupported/human-evidence conflict fail closed；reversal atomic 且 audit/readiness 正確 |
| P2G | Bank/account/reversal Skill workflow | `.claude/skills/last-say-ops/*`、Skill eval fixture | P2A-P2F contract fixed | 序列 contract sync | AI 先 inventory/readiness，再 preview/commit；誤匯走 reversal proposal；不使用 SQL／直接 DB |
| P3A | Card／liability／commitment schema migration | P3 migrations、shared FK/enums | P2 complete | **序列 coordinator** | migration、constraints、rollback、legacy compatibility 通過 |
| P3B | Credit-card profiles、statements、installments、settlement | card queries/services/routes/tests | P3A | 可與 P3C/P3D 平行 | charge/refund/unbilled/due/partial payment/official installment owner 正確且不重複 expense |
| P3C | Liability profile、schedule、payment allocation | liability queries/services/routes/tests | P3A | 可與 P3B/P3D 平行 | principal/interest/fee sum invariant；current principal 不與 profile 重複 |
| P3D | Commitments、occurrences、template lifecycle | commitment queries/services/routes/tests | P3A | 可與 P3B/P3C 平行 | candidate 不自動 confirmed；template edit 不改 settled history |
| P3E | Debt inventory/readiness 與 typed integration | inventory/readiness/reconciliation read models | P3B-P3D | 序列 integration | 缺 statement、principal、schedule 的 blocker 與 next action deterministic |
| P3F | Card／debt UI、Skill 與 eval | finance-data UI、Skill、anonymized evals | P3E view models | UI 可平行；final sync 序列 | 人類可維護/review；AI 不猜 schedule；targeted browser/Skill evidence 通過 |
| P4A | Decimal owner 與 investment schema migration | `lib/finance/money/*`、P4 migrations | ADR-2、P3 complete | **序列 shared precision owner** | decimal property tests、no-float canonical guard、rollback 通過 |
| P4B | Instrument、trade、holding persistence | investment queries/services/routes/tests | P4A | 可與 quote owner 依 frozen IDs 平行 | instrument identity conflict、trade/holding source authority 可追溯 |
| P4C | Quote、FX、valuation、watermark | valuation owner、quote/FX queries/routes/tests | P4A-P4B identity contract | 序列 calculation integration | source/as-of required；missing FX/stale/mismatch 不產生假完整 total |
| P4D | Investment inventory/readiness、UI、Skill | read models、finance-data UI、Skill eval | P4C | read/UI 可平行；contract sync 序列 | TWD/USD fixture 可重現；unsupported derivative 明確停止，不偽裝 other |
| P5A | Manual valued items | valued-item migration/query/service/routes/tests | P4 complete | schema serial；domain 可獨立 | Tier 2 value 有 method/as-of/source，只進允許的 inventory/net-worth |
| P5B | Typed cross-context reconciliation | match services/read models/tests | P3-P5A | **序列 integration** | transfer/card/loan/investment cash legs 不重複，one-sided 保持 unreconciled |
| P5C | Unified review task projection／source conflict flow | review queries/services/routes/tests | P5A-P5B | 序列 lifecycle owner | supersession 不留孤兒 task；resolution 可追 human evidence |
| P5D | Institution／account／instrument typed identity merge | merge impact registry、typed routes、tests、human confirmation integration | P3-P5C、P1F | **序列 FK coordinator** | preview impact 完整；human commit 原子重綁/redirect/audit；conflict/cycle fail closed |
| P5E | Reconciliation／review／merge UI 與 Skill | finance-data UI、Skill、evals | P5C-P5D view models | UI 可平行；final sync 序列 | 人類能從 issue 到 source、preview、decision、recomputed readiness 完成閉環 |
| P6A | Readiness requirement graph／policy version | `lib/finance/readiness/*`、tests | P2-P5 complete | **序列 goal registry owner** | 每個 initial goal 對 same fixture 產生可解釋 status/gaps/priority |
| P6B | Named analysis datasets 與 deterministic read models | `lib/finance/analysis/*`、finance queries/tests | P6A goal/schema contract | 可按 dataset 平行；registry merge 序列 | whitelist filter/limit 生效；任意 table/column/SQL 被拒絕 |
| P6C | Inventory v2、readiness、analysis-context APIs | named routes、API contract/security tests | P6A-P6B | 序列 public API integration | payload size/privacy/error/version/watermark contracts 通過 |
| P6D | AI preflight／data-gap Skill 與 corpus eval | Skill references/evals | P6C | 序列 contract sync | AI 能回答能分析什麼、缺什麼、補哪項；fact/derived/interpretation 分層 |
| P7A | 完整 Data Center navigation 與 states | app routes、`components/finance-data/*` | P2-P6 view models stable | 可按 surface 平行；router/global style 序列 | desktop/mobile full flow、version conflict、source drilldown 證據齊全 |
| P7B | Demo seed、browser evidence、Skill full eval | demo/fixture/evidence owner、Skill eval | P7A | 可平行產證；結果整合序列 | anonymized contexts 全覆蓋，DVL-02/03 關閉，無真實資料 |
| P7C | Docs、backup rehearsal、privacy、release integration | README、Skill、recovery/release scripts、audit evidence | P7A-P7B | **序列 release coordinator** | 全域 gate 與 anonymized restore 原文通過，DVL 全關閉，capability/scope/unsupported 說明一致 |

### 27.3 Phase Integration Protocol

每個 Phase 只能由一位 coordinator 完成整合，順序固定：

1. 重查 working tree 與 package handoff，確認沒有覆蓋使用者變更。
2. 序列套用 migration／registry／public contract，再整合可平行 domain packages。
3. 同步 Skill、README／contracts 與 demo fixtures；以 grep 證明舊 enum／route／schema 說法沒有殘留。
4. 跑該 Phase 的 targeted validation，附指令與原文輸出；更新 DVL。
5. 用隔離 DB 執行 acceptance scenario，保存不含真實資料的 evidence。
6. `git diff --check`、scope review、privacy review 通過後才 commit；禁止空 commit。
7. Commit 完成後才允許下一 Phase 取得 entry gate。

---

## 28. Master Definition Of Done

只有以下全部成立，才能宣稱「Financial Data Foundation 完成」：

1. Entity、institution／account aliases、source、scope attestations、source expectations 與 stable identity 可由 UI/API 維護。
2. Bank/card/cash/e-wallet activities 與 official/manual balances 有 typed persistence，legacy workflow 無回歸。
3. Credit-card statements/unbilled/due/payment/installments、loans/schedules/allocations、commitments 有正式 owner。
4. Investments 有 instrument、trade、holding、quote、FX 與 deterministic valuation；精度與 source/as-of 可驗證。
5. Tier 2 assets/liabilities 可保存 valuation，但能力限制清楚。
6. Typed reconciliation 不重複計算 transfer、card payment、loan principal、investment cash legs。
7. 所有重要 records 有 source、authority、review、version 與 audit／supersession 行為。
8. AI 可查 capabilities、inventory、readiness、analysis context，且不能任意 SQL／generic write。
9. AI writes 使用 preview/validate/compound commit/idempotency/version conflict；同一來源跨 context 不留半套 canonical state；committed 誤匯可 typed reversal；high-risk commit 不信任 actor label，必須有有效 human confirmation receipt。
10. Tool 可針對 initial analysis goals 說出 missing/stale/conflicted/unreconciled/unsupported 與 next action；full-scope complete 有有效的人類 attestation，而非由 row count 猜測。
11. Human Data Center 在 desktop/mobile 可完成 gap → source → edit/review → readiness refresh。
12. Last Say Skill 自含全部已實作 API、workflow、安全界線與 eval；不宣稱未落地能力。
13. Existing credit-card import、classification、rules、corrections、P&L、release verifier 全數通過。
14. Legacy DB migration 原子、冪等、可拒絕 newer version，且有 anonymized migration evidence。
15. 所有 tests/demo/screenshots 使用隔離資料；privacy scan 無真實資料。
16. Tier 3 extension gate 經測試：unsupported 商品不會被 generic JSON 偷渡進 complete analysis。
17. Accounting Reports 與 Financial Control plans 已改為消費本計畫 facts，不重建平行 tables。
18. 每個 goal 有可重跑 evidence，不以 table existence 或 build success 代替使用者結果。
19. WAL-consistent backup／new-path restore rehearsal、manifest 與 integrity check 通過；DB-only／full bundle 的 source artifact coverage 清楚，AI 無整庫下載／restore 能力。
20. Deferred Verification Ledger 全部關閉；沒有 architecture landing 被誤當產品驗收。
21. Duplicate institution／account／instrument 可先阻擋、後 typed merge；source identity、facts、aliases 與 audit 不因合併遺失。

---

## 29. Execution Readiness Verdict

### Verdict：Ready for Phase 0

Phase 0 可直接建立 contracts、ADRs、fixtures 與 spikes。Phase 1-7 不得一次性開工；以下 blockers 必須先關閉：

- Decimal owner／rounding decision。
- Accounts additive migration rehearsal。
- Source authority/conflict/supersession contract。
- Scope attestation／source expectation 完整度規則。
- Localhost actor boundary／human confirmation receipt contract。
- Ingestion staging retention policy。
- `node:sqlite` BigInt 與 WAL backup／restore spike。
- Anonymized cross-context fixtures。
- Behavior contracts 與 API schemas。

### 第一個執行切片

1. 建立八份 behavior contracts 的 skeleton 與最高風險 acceptance examples。
2. 建立 anonymized v0.2.3 legacy DB fixture builder。
3. 完成 ADR-1 至 ADR-6。
4. 對 bank/card/loan/investment 各做一份 source → typed payload map。
5. 完成 decimal/BigInt、accounts、source-conflict、WAL backup／restore 四個 blocking spikes。
6. 審核 Phase 1 是否仍為 additive migration；通過才開始 runtime schema。

下一個執行 agent 開始任何 slice 前必須回答：

> 這個 slice 改善哪個 DF Goal？保留哪些 invariants？屬於哪個 bounded context？為什麼不應進 shared kernel 或另立 context？哪個 outcome evidence 證明完成？

答不出來時，停止實作並回到本計畫／ADR，不得以 generic schema 或聊天猜測補上。

---

## 30. 參考與最佳實踐來源

- [Open Banking UK Read/Write API v4.0](https://openbankinguk.github.io/read-write-api-site3/v4.0/)：Account、Balance、Transaction 分離的資料責任；本計畫只借用概念，不宣稱相容該 API。
- [SQLite Foreign Key Support](https://www.sqlite.org/foreignkeys.html)：FK 與 migration constraints。
- [SQLite Datatypes](https://www.sqlite.org/datatype3.html)：SQLite dynamic typing 風險；本計畫以 validator、INTEGER minor units 與 decimal strings 補強。
- [SQLite Online Backup API](https://www.sqlite.org/backup.html)：WAL-safe consistent backup 的正式機制與限制；實作仍需以目前 Node runtime spike 驗證。

---

## 31. Phase 0 Execution Record And Phase 1 Freeze

### 31.1 Phase 0 Artifacts

- Behavior contracts：`docs/contracts/financial-data-core-contract.md`、`source-evidence-ingestion-contract.md`、`account-balance-storage-contract.md`、`liability-and-commitment-storage-contract.md`、`investment-valuation-storage-contract.md`、`readiness-analysis-context-contract.md`、`financial-data-operator-contract.md`、`backup-restore-contract.md`。
- ADR：`docs/adr/0001-*` 至 `0006-*`。
- Spike evidence：`docs/adr/spikes/phase0-blocking-spikes.md` 與可重跑 `scripts/fixtures/financial-data/run-phase0-spikes.mjs`。
- Synthetic fixtures：`test/fixtures/financial-data/manifest.json`、四份 source mapping、canonical/readiness scenarios 與 v0.2.3 builder。

### 31.2 Phase 1 Fixed Interfaces

- API major version：`finance/v1`；schema IDs 使用 `finance.<typed-name>/v1`，未知 major/schema fail closed。
- Stable errors：`VALIDATION_ERROR`、`UNKNOWN_SCHEMA`、`IDENTITY_CONFLICT`、`VERSION_CONFLICT`、`DUPLICATE`、`SOURCE_REQUIRED`、`REVIEW_REQUIRED`、`HUMAN_CONFIRMATION_REQUIRED`、`UNSUPPORTED_CONTEXT`、`DB_UNAVAILABLE`。
- Existing `lib/db.js` facade exports 必須保留：`getDb`、`closeDb`、`openDatabase`、`initializeDatabase`、`migrateSchema`、`ensureReportingSchema`、`getSchemaVersion`、`SCHEMA_VERSION`、`DB_PATH`、`DEFAULT_DB_PATH`、`PROJECT_ROOT`。
- Phase 1 schema owner：`lib/db/migrations/*`（新）與 `lib/db.js` compatibility facade；contract owner：`lib/finance/contracts/*`；typed query owner：`lib/queries/finance/*`；capabilities owner：`app/api/finance/capabilities/*`。
- Money：new canonical `INTEGER` minor units + currency，BigInt-aware reads；decimal fields是 normalized strings。`decimal.js` arithmetic owner延至 P4，P1 只凍結 schema/validator contract，不先以 `Number` 實作替代品。
- Account migration：只 additive evolution + aliases；legacy `accounts.name UNIQUE`、ids、FKs、transaction dedupe/human evidence不變。
- Backup：Phase 1 使用 explicit-path local utility + Node online backup API + manifest/integrity/new-path restore；沒有 HTTP/AI restore route。
- High-risk actions：registry-specific proposal + browser confirmation + 10-minute one-time receipt；actor label 不可信。

### 31.3 Phase 1 Forbidden Changes

- 禁止讀寫 `data/finance.sqlite`，也禁止把 `data/`、`uploads/`、`outputs/` 內容帶入 fixture、log、screenshot 或 commit。
- 禁止修改 `lib/normalize.js`、legacy CSV parser/dedupe algorithm、imported transaction amount/date/source、human editable allowlist、`correction_log`/`rule_change_log` append-only semantics。
- 禁止重建 `accounts`、新增平行 `financial_accounts`、universal records/postings/EAV canonical table、generic CRUD/SQL API、server-side LLM/URL fetch。
- 禁止在 P1 提前建立 card/loan/investment canonical facts；P1 只建立 shared kernel、identity/source/scope/expectation/audit/confirmation/recovery 基礎。
- `.claude/skills/last-say-ops/` 只同步實際上線 capabilities/API，不描述尚未可呼叫的 Phase 2-7 mutation。

### 31.4 Phase 1 Entry Gate

Phase 1 coordinator 開工前必須：

1. 以 v0.2.3 builder 建 temp DB並記錄 transactions/dedupe/human corrections/rules/log counts。
2. 先建立 checksum migration runner與 rollback/idempotency/newer-version tests，再新增 shared tables/columns。
3. 讓 JSON Schema/runtime enums 同源；API/Skill 不各自維護 enum。
4. 每個 high-risk registry action先有 spoof/replay/expiry/hash/version/concurrency test，再開 commit path。
5. 所有命令明確設定 temp `FINANCE_DB_PATH`，且 acceptance evidence 不含真實 row count。

### 31.5 Goal And Evidence Trace

| Contract | Goals | Phase 0 evidence | First runtime owner |
|---|---|---|---|
| `finance.foundation.core` | DF-G1/G2/G7/G10/G11 | ADR-0001/2/3、legacy fixture | P1A-P1D |
| `finance.foundation.ingestion` | DF-G2/G7/G11 | ADR-0005、source maps | P2A/P2F |
| `finance.account-balance.storage` | DF-G1/G2/G3/G6 | bank fixture、conflict fixture | P2B/P2D |
| `finance.liability-commitment.storage` | DF-G1/G2/G4/G6 | card/loan fixture | P3A-P3D |
| `finance.investment-valuation.storage` | DF-G1/G2/G5/G9 | investment fixture、ADR-0002 | P4A-P4D |
| `finance.readiness-analysis-context` | DF-G3/G6/G8/G9 | readiness scenarios | P2D/P6 |
| `finance.operator.external-ai` | DF-G7/G8/G11 | operator acceptance cases | P1D then every phase |
| `infrastructure.finance-backup-restore` | DF-G10/G11 | WAL restore spike | P1E |

### 31.6 Phase 0 Validation Evidence

2026-07-14 於 Windows x64、Node v22.19.0、SQLite 3.50.4，以 synthetic/temp DB 執行：

```text
JSON fixtures parsed: 7
Behavior contract schema check: 8/8 complete
Markdown local links valid: 25 changed/untracked files
Sensitive tracked artifacts: 0
Privacy pattern scan: clean

npm run lint
Exit code: 0 (eslint . --max-warnings=0)

npm test
tests 77, pass 77, fail 0, duration_ms 1783.7334

legacy v0.2.3 builder
accounts 1, sources 1, transactions 2, classification_rules 1,
correction_log 1, rule_change_log 1
integrity ok, foreign-key violations 0, schema version 1

Phase 0 spikes
BigInt exact true; WAL restore integrity ok; FK violations 0;
additive accounts rebuild_required false;
benchmark rows transactions 100000, holdings 10000, quotes 10000
```

`git check-ignore data/finance.sqlite uploads outputs` 原文：

```text
data/finance.sqlite
uploads
outputs
```

Phase 0 狀態：acceptance passed。Runtime tables/routes/UI 變更為零；Phase 1 只有在本 Phase commit 與 push 成功後解鎖。

### 31.7 Phase 1 Validation Evidence

2026-07-14 於 Windows x64、Node v22.19.0、SQLite 3.50.4，全程以 explicit temp `FINANCE_DB_PATH`、隔離 Next dist 與 synthetic fixture 驗收；未讀寫 `data/finance.sqlite`，亦未碰既有 port 3127。

```text
npm test
tests 95, pass 95, fail 0, duration_ms 2102.6164

npm run lint
Exit code: 0 (eslint . --max-warnings=0)

$env:NEXT_DIST_DIR = '.next-p1-verify'; npm run build
Compiled successfully; 38 pages/routes generated
```

以 temp port 3137 執行實際 HTTP rehearsal：

```text
GET /api/health => health true, schema_version 2
GET /api/finance/capabilities => api_version finance/v1
POST account fixture => account_kind bank, review_state needs_review
Browser high-risk confirmation => HTTP 200, coverage_state declared_complete
GET /api/finance/confirmations?status=pending => pending count 0
GET /confirmations => HTTP 200
```

公開 CLI 的 legacy migration、backup 與 new-path restore rehearsal：

```text
node scripts/fixtures/financial-data/build-legacy-v0.2.3.mjs --output <temp>/source.sqlite
schema_version 1; accounts 1; sources 1; transactions 2;
classification_rules 1; correction_log 1; rule_change_log 1

FINANCE_DB_PATH=<temp>/source.sqlite node -e <initialize through lib/db facade>
schema_version 2; migrations 2

node scripts/finance-backup.mjs --db <temp>/source.sqlite --output <temp>/backups
mode db-only; manifest created

node scripts/finance-restore.mjs --input <temp>/backups/<bundle>/manifest.json --target <temp>/restored.sqlite
integrity ok; foreign_key_violations 0; schema_version 2

restored DB verification
integrity ok; foreign_key_violations 0; schema_version 2

cleanup_exists=False
```

Focused negative evidence 由 tests 覆蓋：migration checksum drift／newer schema／rollback、backup hash corruption／newer manifest／existing-target refusal、confirmation actor spoof／payload or version change／expiry／replay／concurrency 均 fail closed。Shared enums、JSON Schemas 與 runtime validators 同源；legacy transaction IDs、dedupe、human corrections、rules 與 append-only logs 在 migration characterization tests 中保持不變。

Phase 1 狀態：acceptance passed。Shared kernel、typed finance API、human-confirmation boundary、backup／restore 與 Skill 同步均完成；Phase 2 只有在本 Phase commit 與 push 成功後解鎖。

### 31.8 Phase 2 Validation Evidence

2026-07-14 於 Windows x64、Node v22.19.0、SQLite 3.50.4，全程以 explicit temp `FINANCE_DB_PATH`、隔離 Next dist 與 synthetic data 驗收；未讀寫 `data/finance.sqlite`，runtime 使用 temp port 3138，未碰 3127。

```text
npm test
tests 104, pass 104, fail 0, duration_ms 2088.5738

npm run lint
Exit code: 0 (eslint . --max-warnings=0)

$env:NEXT_DIST_DIR = '.next-p2-final'; npm run build
Compiled successfully; 43 pages/routes generated; /data and all P2 APIs present
```

Focused automated evidence：

```text
preview canonical writes: 0
same idempotency key + same hash: original run returned
same idempotency key + changed hash: conflict
compound late-section validation failure: all canonical sections remain 0
unresolved client reference: rejected before staging
successful commit: account/source/balance/cash all committed atomically; staged_json purged
uncommitted preview after 24h: run/items expired; staged_json purged
official + inferred same-date balance: both retained; official selected; conflict visible
AI expectation: candidate gap only; user-confirmed expectation: hard gap
confirmed reversal: typed facts marked reversed; source/audit retained; summary/P&L exclude reversed row
reversal with later out-of-run fact: reversible=false and fail closed
legacy CSV import: repeated rows deduped; rules_applied and human classifications preserved
```

以 temp server `http://127.0.0.1:3138` 走實際 browser/API rehearsal：

```text
GET /api/health => ok true, schema_version 3
GET /data => HTTP 200
UI add account => account visible in inventory
UI enter 4321.09 TWD => amount_minor 432109, balance status current
UI rename account => updated display name and optimistic version
GET /api/finance/inventory => as_of_date 2026-07-14; missing_scope_attestation remains visible
desktop 1440x900 => account, balance, source date, readiness gap rendered
mobile 390x844 => scrollWidth 390, clientWidth 390
browser console errors => 0
temp server/DB/dist/screenshots removed; port 3138 listener false
```

日期驗收曾發現以 UTC `toISOString()` 產生 business date，會讓 Asia/Taipei 凌晨顯示前一天並暫時隱藏當日 snapshot；已改用主機本地日期並以 UI/API 重驗。計畫 Phase 2 摘要只列 P2A-P2D，但 §27.2 package index 另列 P2E-P2G；本次以較完整的現實 package index 為準，Data Center、reversal 與 Skill sync 均納入同一 Phase commit。

Phase 2 狀態：acceptance passed。Structured ingestion、balances、legacy adapter、inventory/readiness、Data Center、human-confirmed reversal 與 Skill workflow 已完成；Phase 3 只有在本 Phase commit 與 push 成功後解鎖。

### 31.9 Phase 3 Validation Evidence

2026-07-14 於 Windows x64、Node v22.19.0、SQLite 3.50.4，全程以 explicit temp `FINANCE_DB_PATH`、隔離 Next dist 與 synthetic data 驗收；未讀寫 `data/finance.sqlite`，runtime 使用 temp port 3138，未碰 3127。

```text
npm test
tests 112, pass 112, fail 0, duration_ms 2493.6003

npm run lint
Exit code: 0 (eslint . --max-warnings=0)

$env:NEXT_DIST_DIR = '.next-p3-acceptance'; npm run build
Compiled successfully; 50 static pages generated; /data and all Phase 3 APIs present
```

Focused automated evidence：

```text
statement ownership: closed charge/refund retained; unbilled remains card-owned
partial card payment: match_status partial; no second expense created
complete installment principal schedule: reconciliation_status reconciled
partial installment schedule: reconciliation_status unreconciled
installment obligations: transaction count remains 1; P&L expense recognized once
AI-inferred loan schedule: REVIEW_REQUIRED before persistence
official loan allocation: principal + interest + fee equals cash; reconciled
missing card statement: readiness gap missing_credit_card_statement
missing loan principal: readiness gap missing_loan_principal_balance
settled commitment occurrence: unchanged after optimistic template update
compound card late-section failure: account/transaction/statement canonical rows all 0
legacy P&L, CSV import, learning, reversal, and append-only tests remain green
```

以 temp server `http://127.0.0.1:3138` 走實際 browser/API rehearsal：

```text
GET /api/health => ok true, schema_version 4
GET /data => account and obligations tabs rendered
UI add credit-card account => account visible
UI add card profile => close day 20; due day 8; credit_limit_minor 12000000
UI add fixed rent commitment => amount_minor 1800000; next due 2026-08-01
GET /api/finance/inventory => accounts 1; cards 1; commitments 1; debt status partial
desktop 1440x1000 => empty, ready, dialog, and saved states exercised
mobile 390x844 => no horizontal overflow; card and commitment visible
browser console errors => 0
temp server/DB/dist/screenshots removed; port 3138 listener false
```

規格與現實偏差：Phase 3 validation 原列 `canonical/credit-cards.json`、`liabilities.json`、`commitments.json`，repository 實際 fixture 為 `source-mappings/card-statement.json`、`loan-statement.json` 與 `canonical/additional-contexts.json`；驗收沿用現存 synthetic fixture 語意並新增四個 focused test files。首次 compound fixture rehearsal 少了既有 balance schema 必填 `observed_at`，已補正 fixture 後重跑通過。`liquidity_forecast_90d` 僅回 prerequisites 與 `forecast_available=false`，沒有提前實作 Phase 6 forecast。

Phase 3 狀態：acceptance passed。Credit cards、statements、payment matches、installments、liabilities、official schedules、payment allocations、commitments、typed routes、compound ingestion、debt readiness、Data Center UI 與 Skill workflow 均完成；Phase 4 只有在本 Phase commit 與 push 成功後解鎖。

### 31.10 Phase 4 Validation Evidence

2026-07-14 於 Windows x64、Node v22.19.0、SQLite 3.50.4，全程使用 explicit temp `FINANCE_DB_PATH`、隔離 Next dist、synthetic investment facts 與 temp port 3138；未讀寫 `data/finance.sqlite`，未碰 3127。

```text
npm test
tests 118, pass 118, fail 0, duration_ms 2365.6071

npm run audit:prod
found 0 vulnerabilities

npm run lint
Exit code: 0 (eslint . --max-warnings=0)

$env:NEXT_DIST_DIR = '.next-p4-final'; npm run build
Compiled successfully; 56 static pages generated; /data and all Phase 4 APIs present
```

Focused automated evidence：

```text
canonical decimal input rejects JSON Number and exponent notation
half-even rounding: 2.5 -> 2; 3.5 -> 4
USD: 10.25 * 101.23 = 103761 minor; USD/TWD 32.5 = 3372232 minor
JPY exponent 0: 10.25 * 101.23 = 1038 minor
missing quote => missing_quote; quote older than 7 days => stale
same instrument/date with two providers => both rows retained; deterministic authority/provider selection
missing FX => base_value_minor null; holding/instrument currency mismatch => no derived total
option payload and quote without matching source/currency => rejected fail closed
investment bundle late-section failure => atomic rollback remains covered by ingestion tests
```

以 temp production server `http://127.0.0.1:3138` 走實際 API/browser rehearsal：

```text
GET /api/health => ok true, schema_version 5
GET /api/finance/inventory?as_of=2026-07-14
=> valuation_status current; derived_value_minor 103761; base_value_minor 3372232
=> watermark includes holding_key, quote_key, fx_key
GET /data => HTTP 200; 投資估值 tab active; holding, quote date, FX date rendered
desktop 1440x1000 => scrollWidth 1440, clientWidth 1440
mobile 390x844 => scrollWidth 390, clientWidth 390; tab/holding/value visible
browser console errors => 0
temp server/DB/logs/dist removed; port 3138 listener false
```

規格與現實偏差：初版 decimal helper 與 UI formatter 仍假設所有 currency exponent 為 2，runtime review 時發現這會錯算 JPY 且 UI 的 BigInt-to-Number 可能讓極大金額失真；已在 Phase 4 內補上 currency-aware exponent、minor/decimal conversion 與全程 BigInt 顯示，並新增 JPY focused evidence。計畫只要求 TWD/USD fixture，本次提高到所有目前 supported currencies 可沿用明確 exponent owner；現階段 supported list 中只有 JPY 為 0，其餘為 2。

Phase 4 狀態：acceptance passed。Decimal precision owner、investment persistence、quotes/FX、deterministic valuation/watermark、inventory/readiness、Data Center UI 與 Skill workflow 均完成；Phase 5 只有在本 Phase commit 與 push 成功後解鎖。

### 31.11 Phase 5 Validation Evidence

2026-07-14 於 Windows x64、Node v22.19.0、SQLite 3.50.4，全程使用 explicit temp `FINANCE_DB_PATH`、隔離 Next dist、synthetic valued-item/reconciliation facts 與 temp port 3138；未讀寫 `data/finance.sqlite`，未碰 3127。

```text
npm test
tests 127, pass 127, fail 0, duration_ms 2406.8289

npm run audit:prod
found 0 vulnerabilities

npm run lint
Exit code: 0 (eslint . --max-warnings=0)

$env:NEXT_DIST_DIR = '.next-p5'; npm run build
Compiled successfully; 63 static pages generated; /data and all Phase 5 APIs present
```

Focused automated evidence：

```text
manual real-estate value 1800000000 TWD => Tier 2 inventory; transactions remain 0
needs-review valuation => one open valuation task linked to valuation_key
confirmed bank transfer => two typed legs; no duplicate context; reconciliation complete
one-sided/low-confidence transfer => confirmed rejected; proposed task; status unreconciled
source conflict resolution => selected source + note retained; linked task resolved atomically
account merge preview => every registered FK count listed; balance FK rebind verified
human-confirmed merge => old account archived; redirect retained; source facts preserved
redirect chain => old key resolves through two merges to the active terminal key
incompatible account kind => can_merge false; no mutation
schema FK scan => institution/account/instrument registry covers every downstream FK owner
legacy CSV import, human classifications, correction/rule logs, reporting, reversal remain green
```

以 temp production server `http://127.0.0.1:3138` 走實際 API/browser rehearsal：

```text
GET /api/health => ok true, schema_version 6
synthetic Tier 2 valuation => 1800000000 TWD; net-worth inventory rendered
open review tasks => 2 (valuation + source conflict); reconciliation conflicted
UI source decision => selected official candidate with note; conflict task closed
postflight inventory => remaining tasks 1; reconciliation complete
UI account merge preview => 0 FK rows, 0 collisions, deterministic impact hash
UI merge proposal => pending merge_account visible on /confirmations; AI did not confirm it
desktop 1440x1000 => item, task, source resolution, preview and proposal states exercised
mobile 390x844 => scrollWidth 390, clientWidth 390; tab/item/merge controls visible
browser console errors => 0
temp server/DB/logs/dist removed; port 3138 listener false
```

規格與現實偏差：計畫寫「cross-context match contract 完整化」，現有 card settlement、loan allocation 與 investment cash leg 已各有 typed owner，因此沒有建立 generic relationship table；Phase 5 只新增 typed internal-transfer match，統一 read model 以 transaction key 投影四種既有 owner，偵測一筆 transaction 同時落入多 context 的衝突。Net-worth 在本 Phase 只提供 Tier 1/Tier 2 inventory 與 prerequisites，沒有提前實作 Phase 6 的完整 requirement graph 或 analysis dataset。

Phase 5 狀態：acceptance passed。Manual valued items、valuation snapshots、typed reconciliation、review/source-conflict lifecycle、registry-guarded human identity merge、redirect/audit、net-worth inventory、Data Center UI 與 Skill workflow 均完成；Phase 6 只有在本 Phase commit 與 push 成功後解鎖。

### 31.12 Phase 6 Validation Evidence

2026-07-14，Windows x64、Node v22.19.0、SQLite 3.50.4。所有測試、build 與 runtime 均明確使用 temp `FINANCE_DB_PATH`；production runtime 只使用 3138，未讀寫 `data/finance.sqlite`，未碰 3127。

```text
$env:FINANCE_DB_PATH = Join-Path $env:TEMP 'last-say-foundation-p6-evidence.sqlite'; npm test
# tests 132
# pass 132
# fail 0
# duration_ms 2490.9442

npm run audit:prod
found 0 vulnerabilities

npm run lint
> eslint . --max-warnings=0
Exit code: 0

$env:NEXT_DIST_DIR='.next-p6'; npm run build
Compiled successfully; /api/finance/analysis-context and all existing routes generated
Exit code: 0
```

Focused automated evidence:

```text
all 8 initial goals => policy_version, scope, requirements, satisfied, prioritized gaps, next actions, source watermark
global cash readiness without attestation => partial; account-scoped cash readiness => account-only and does not claim global completeness
cash-flow readiness => boundary/reconciliation gaps remain explicit
tax_or_derivatives => unsupported + separate_context_required
liquidity_forecast_90d => prerequisites may be complete while forecast_available=false
named datasets => strict whitelist, typed filters, pagination/group limits, deterministic response bytes
unknown dataset => UNKNOWN_SCHEMA; SQL-like/unknown field => VALIDATION_ERROR
request body over 64 KiB => 413 even without Content-Length
response payload => no source_file, raw_info, content_sha256, private source descriptions, or filenames
legacy personal accounts plus typed accounts => both retained in global cash_activity; scoped account query stays isolated
v1 migration checksum => upgraded once to stable v2 checksum; later source drift still rejected
```

Temp production runtime `http://127.0.0.1:3138` API rehearsal:

```text
GET /api/health => ok true, transactions 180, corrections 4, schema_version 6
GET /api/finance/capabilities => 7 named datasets; arbitrary_sql false
GET /api/finance/readiness?goal=spending_history&as_of=2026-07-14
=> status complete, policy finance-readiness/1, scope global
POST /api/finance/analysis-context => cash_activity + account_balances
=> months 2026-01 through 2026-06, response_bytes 1420, private field leak false
POST dataset containing sql => HTTP 400 VALIDATION_ERROR, field body.sql
temp server/DB/logs/dist removed; port 3138 stopped
```

Reality deviations discovered and resolved:

1. Existing migration checksums included `Function#toString()`, which changes in a Next production bundle. A CLI-created demo DB therefore failed production startup. The ledger now uses stable `v2:` checksums over version/name/source and transactionally upgrades identifiable 64-hex v1 checksums once; regression tests prove subsequent drift still fails closed.
2. Demo/legacy accounts predate `entity_id` and `account_key`. The original named cash dataset used typed inner joins, so readiness saw 180 legacy rows while analysis returned none. Global personal analysis now includes those legacy rows with an explicit compatibility boundary; account-scoped analysis still requires a typed account.

Phase 6 acceptance passed: readiness requirement graph, inventory v2, governed analysis datasets, privacy/size/error limits, deterministic provenance, Skill preflight/reporting contract, production DB compatibility, and legacy spending coverage are complete. Phase 7 may begin only after this Phase commit is pushed.

### 31.13 Phase 7 Validation Evidence

2026-07-14，Windows x64、Node v22.19.0、SQLite 3.50.4。所有自動化、demo、build、backup rehearsal 與 browser runtime 均使用明確隔離 DB；production browser runtime 僅使用 3138，未讀寫 `data/finance.sqlite`，未碰 3127。證據檔位於 ignored `outputs/foundation-phase7-evidence/`，不進 git。

```text
npm run lint
> eslint . --max-warnings=0
Exit code: 0

node --test test/foundation-demo-and-skill-eval.test.js test/runtime-smoke-safety.test.js test/backup-restore.test.js
# tests 6
# pass 6
# fail 0

npm run eval:skill
PASS inventory-preflight
PASS bank-import
PASS loan-gap
PASS investment-quote
PASS gap-analysis
PASS version-conflict
PASS high-risk-confirmation
PASS unsupported-derivative
Skill eval: 8/8 passed

npm run verify:release
PASS eslint - 0 warnings
PASS production-audit - 0 vulnerabilities at moderate or above
PASS node-test - 134/134 passed
PASS skill-eval - 8/8 fixed cases passed
PASS next-build - 64 pages/routes generated
PASS runtime-smoke - health + transactions page + production CSP passed
PASS personalized-residue
PASS demo-db-seeded
PASS demo-metrics - 6 months; automation 30% -> 40% -> 53.3% -> 63.3% -> 73.3% -> 80%; lowConfidence=30; humanCorrectionRules=2
PASS demo-foundation-contexts - accounts=4; balances=3; cards=1; liabilities=1; commitments=1; holdings=1; valuedItems=1; openTasks=1
PASS backup-restore-rehearsal - integrity=ok; transactions=180; changeEvidence=34
PASS screenshots - all existing release screenshots present and non-empty
Exit code: 0
```

以匿名 demo DB 與 production server `http://127.0.0.1:3138` 執行 browser/API closure：

```text
desktop 1440x1000 => all 8 readiness goals rendered; policy finance-readiness/1; prioritized gap and source aggregation visible
source drilldown => kind, authority, review state, description, period, artifact status and source key rendered
review tab => one source_conflict task visible and actionable
mobile 390x844 => scrollWidth 390, clientWidth 390; all 8 goals and review task reachable
desktop browser errors => 0 before intentional conflict request
mobile browser errors => 0
optimistic conflict => external PATCH 200/version 2; stale UI PATCH 409; dialog rendered "Expected version 1, current version is 2"
the single console network error is the expected HTTP 409 resource response; no unhandled page error occurred

GET /api/health => ok true; transactions 180; corrections 4; schema_version 6
GET /api/finance/capabilities => preview_commit_available true; arbitrary_sql false
scoped readiness before => stale; gaps balance_stale + expected_source_overdue
POST /api/finance/imports/preview => HTTP 201; preview_ready
POST /api/finance/imports/<run>/commit => HTTP 200; committed
scoped readiness after => partial; balance_stale removed; expected_source_overdue retained
```

Backup/restore 操作文件已落於 `docs/operations/backup-restore.md`。Demo seed 現在同時覆蓋 legacy 六個月分類學習與 account/card/loan/commitment/investment/Tier 2/source conflict typed contexts。Last Say Skill 加入 preflight、fact/derived/interpretation 分層、最高優先缺口、四種 error recovery、高風險 browser confirmation handoff 與六項 A6 自查。

Reality deviations discovered and resolved：

1. 首次 `verify:release` 因前一個被 caller timeout 的 verifier 子行程仍在清理同一 `.next-verify`，造成 `pages-manifest.json` race；確認無殘留行程後單獨 build 通過，後續完整 verifier 穩定通過。這是驗收啟動競態，不是產品 build failure。
2. `scripts/smoke-runtime.mjs` 仍硬編碼 schema version 1，健康端點正確回 6 卻被誤判；已改為引用 `lib/db.js` 的 `SCHEMA_VERSION` 並保留精確相等的 fail-closed 驗證。
3. Privacy scan 將 ADR 的公開 BigInt 邊界 fixture `9007199254740993` 誤判為卡號；只精確 allowlist 該一個 `Number.MAX_SAFE_INTEGER + 2` fixture，其他 13-16 位與 4-4-4-4 模式仍全數掃描。

Deferred Verification Ledger closure：DVL-01 由 134/134 全套 regression 與 release verifier 關閉；DVL-02 由 desktop/mobile inventory -> gap -> source/review 與 conflict evidence 關閉；DVL-03 由固定 8-case Skill eval 關閉；DVL-04～06 已由 Phase 6 benchmark、cross-context invariant 與 frozen freshness/policy tests 關閉並在 31.12 記錄；DVL-07 由 audit、privacy scan、匿名 demo、backup restore 與證據圖人工檢查關閉。Release-blocking ledger 為空。

Phase 7 acceptance passed: Human Data Center navigation/states、source drilldown、version conflict、anonymous full-context demo、operator Skill closure/eval、backup/restore docs and rehearsal、README capability/unsupported boundary、privacy scan 與 integrated release gate 均完成。Financial Data Foundation Phase 0-7 完成；正式 balance sheet/cash-flow statement presentation、forecast/safe-to-spend、tax 與 complex derivatives 仍依下游計畫或 separate typed context 處理，不在本階段宣稱完成。

- [Node.js SQLite API](https://nodejs.org/api/sqlite.html)：`node:sqlite` 的 BigInt、backup 與版本行為入口；不得只依模型記憶假設 API signature。
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12)：machine-readable AI payload／capability contract。
- [SIX Financial Data Standards](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html)：currency／instrument identifier 標準入口；instrument identity 仍需 source 與 review。
- [Last Say Long-Term Goal](../long-term-goal.md)：產品意圖與 AI／工具／人類責任。
- [Accounting Reports Architecture Spec](../accounting-reports-spec.md)：statement／coverage／transfer／report mapping 下游語意。
- [Financial Control Master Plan](./master-financial-control-plan.md)：commitments、forecast、safe-to-spend 與 alerts 下游規劃。
