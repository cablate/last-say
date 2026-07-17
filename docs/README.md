# Last Say 文件入口

用途：這是人類與 AI 重新進入 Last Say 時的第一個文件索引。它說明各文件的責任、閱讀順序、證據標籤與更新規則；產品入口仍是根目錄 `README.md`。

Last validated against repository: 2026-07-17

## 先理解目前結論

- **Confirmed：** Last Say 已有可運作的本機交易審查、規則學習、管理損益表，以及 Phase 0–7 財務資料基礎；這不等於完整的財務控制產品。
- **Confirmed：** 管理損益表、資產負債表與直接法現金流量表都已有server-backed read model、coverage／blockers與UI；第一個Financial Control runtime consumer「Monthly Financial Pulse」也已用query-time composition接上既有P&L／Cash Flow owner。真實資料仍會因缺少boundary、matching或新鮮快照而誠實降級；Control Phase 0的pure 90日timeline尚未接成runtime forecast，safe-to-spend與主動警示也尚未實作。
- **Confirmed：** 伺服器不內建 LLM；外部 AI 透過 `.claude/skills/last-say-ops/` 與受約束 API 操作。
- **Owner-confirmed（2026-07-15）：** AI是主要輸入方式，UI負責確認與少量修正；目前先收斂foundation業務流程，Financial Control Center是下一階段。Reserve／reliable income與其他優化延後處理。
- **Recommended：** 開始任何新功能前，先讀根目錄 [`Final-Long-Term-Goal.md`](../Final-Long-Term-Goal.md)、[目前狀態](project/CURRENT-STATUS.md) 與[風險／技術債](planning/GAPS-RISKS-AND-DEBT.md)。

## 證據標籤

| 標籤 | 意義 |
|---|---|
| **Confirmed** | 已由程式碼、測試、設定、Git 歷史或現行文件直接證實 |
| **Inferred** | 多項證據支持的合理推論，但沒有 owner 核准的正式規格 |
| **Unknown** | Repository 內沒有足夠證據可判斷 |
| **Recommended** | 根據現況提出的建議，不是已核准工作 |
| **Legacy / Deprecated** | 有證據顯示是相容層、舊路徑或已被新責任取代 |
| **Needs owner decision** | 會改變產品方向、風險承擔或優先級，不能由 AI 代決 |

文件與程式碼衝突時，不以文件覆蓋程式碼事實。先重新驗證相關入口、測試與資料契約，再把衝突記到 [稽核報告](audit/PROJECT-AUDIT-REPORT.md)。

## 文件地圖

### 使命與產品

- [`../Final-Long-Term-Goal.md`](../Final-Long-Term-Goal.md)：長期終點、非目標、成功標準、反推路徑與決策框架；目前為 Draft，需 owner 核准。
- [`project/PROJECT-OVERVIEW.md`](project/PROJECT-OVERVIEW.md)：專案用途、技術輪廓、執行單元與核心流程。
- [`project/PRODUCT-AND-USERS.md`](project/PRODUCT-AND-USERS.md)：產品定位、主要使用者、任務與人機責任。
- [`project/FEATURE-INVENTORY.md`](project/FEATURE-INVENTORY.md)：功能、能力、入口、狀態與缺口。
- [`project/CURRENT-STATUS.md`](project/CURRENT-STATUS.md)：截至驗證日的完成度與最近計畫進度。

### 架構與資料

- [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md)：實際部署形態、依賴方向、信任邊界與高風險區。
- [`architecture/MODULE-MAP.md`](architecture/MODULE-MAP.md)：第一方模組責任、入口、消費者與耦合。
- [`architecture/DATA-AND-FLOWS.md`](architecture/DATA-AND-FLOWS.md)：資料模型、生命週期、主要控制流與一致性機制。
- [`architecture/EXTERNAL-INTEGRATIONS.md`](architecture/EXTERNAL-INTEGRATIONS.md)：外部 AI、本機檔案、第三方依賴與失效行為。
- [`adr/`](adr/)：已接受的跨階段架構決策。
- [`contracts/`](contracts/)：行為契約；必須同時查看其 `status` 與實作證據。
- [`contracts/financial-event-semantics-contract.md`](contracts/financial-event-semantics-contract.md)：Foundation 共用的 economic recognition／cash settlement／obligation 三時間線、唯一認列、AI proposal與review邊界；MP-01之後的語意實作依此驗收。
- [`contracts/transfer-and-recurring-reconciliation-contract.md`](contracts/transfer-and-recurring-reconciliation-contract.md)：Transfer match驗證／裁決、未配對候選、reconciliation completeness與AI recurring candidate review邊界。
- [`contracts/ai-analysis-context-and-proposal-contract.md`](contracts/ai-analysis-context-and-proposal-contract.md)：AI named candidate datasets、proposal envelope、typed owner提示與隱私／權限邊界。
- [`contracts/monthly-financial-pulse-contract.md`](contracts/monthly-financial-pulse-contract.md)：FC-A2月度財務脈搏的P&L／現金／typed movement分離、query-time重算、候選揭露與Control UI狀態契約。
- [`contracts/financial-health-review-contract.md`](contracts/financial-health-review-contract.md)：FA-0財務健康Context Pack的position／liquidity／debt／指定投資因子／stress邊界，以及AI只解讀、不重新計算的協作契約。
- [`planning/FINANCIAL-CONTROL-METRIC-DICTIONARY.md`](planning/FINANCIAL-CONTROL-METRIC-DICTIONARY.md)：Control Phase 0 metrics、availability與去重語意；目前是proposed reference，非owner核准政策。

### 開發與維運

- [`development/GETTING-STARTED.md`](development/GETTING-STARTED.md)：環境需求與最小啟動流程。
- [`development/DEVELOPMENT-AND-TESTING.md`](development/DEVELOPMENT-AND-TESTING.md)：變更規律、測試層次、CI 與 release verifier。
- [`development/CONFIGURATION.md`](development/CONFIGURATION.md)：環境變數、路徑、port、資料隱私與設定限制。
- [`operations/DEPLOYMENT-AND-OPERATIONS.md`](operations/DEPLOYMENT-AND-OPERATIONS.md)：目前支援的 localhost 部署、啟停、健康與恢復責任。
- [`operations/backup-restore.md`](operations/backup-restore.md)：備份與還原命令。
- [`operations/BACKUP-POLICY.md`](operations/BACKUP-POLICY.md)：待owner填寫／核准的RPO、RTO、retention、責任與restore drill worksheet。
- [`operations/TROUBLESHOOTING.md`](operations/TROUBLESHOOTING.md)：常見症狀、診斷順序與安全處理方式。

### 規劃與稽核

- [`planning/GAPS-RISKS-AND-DEBT.md`](planning/GAPS-RISKS-AND-DEBT.md)：有證據與優先級的缺口、風險、技術債。
- [`planning/IMPROVEMENT-OPPORTUNITIES.md`](planning/IMPROVEMENT-OPPORTUNITIES.md)：依價值與成熟度分類的改善機會。
- [`planning/ROADMAP.md`](planning/ROADMAP.md)：由現況與長期目標推導的能力階段。
- [`planning/OPEN-QUESTIONS.md`](planning/OPEN-QUESTIONS.md)：需要 owner 決策或 Repository 無法回答的問題。
- [`audit/PROJECT-AUDIT-REPORT.md`](audit/PROJECT-AUDIT-REPORT.md)：2026-07-15 全專案盤點、證據、驗證與覆蓋限制。
- [`plans/master-financial-control-plan.md`](plans/master-financial-control-plan.md)：foundation完成後唯一canonical Financial Control spec-plan；包含real-data entry gate、`FC-*`／`FA-*`執行包、Data Source Map、AI權限矩陣、平行邊界與驗證階梯。`FC-A1`、`FC-A2`與`FA-0`已完成第一輪code／synthetic closure；先用五個決策問題驗收FA-0，再決定`FC-A3`，正式資料接受仍受Gate F約束。
- [`contracts/deterministic-analysis-read-model-contract.md`](contracts/deterministic-analysis-read-model-contract.md)：未來分析表共用的query-time recomputation、coverage、watermark、drillback、money與no-AI-hot-path契約。
- [`contracts/credit-card-transaction-lifecycle-contract.md`](contracts/credit-card-transaction-lifecycle-contract.md)：current／unbilled卡片交易晉升為posted時的強identity、explicit release、source supersession、idempotency與reversal契約。
- [`plans/ai-assisted-financial-semantics-plan.md`](plans/ai-assisted-financial-semantics-plan.md)：目前 Gate F 唯一 canonical Foundation AI master plan；包含 GORE goals、ownership、三時間線語意、typed closure、AI context／review、三視角報表、Skill、真實資料驗收與交棒條件。
- [`plans/active-stabilization-and-control-phase0-plan.md`](plans/active-stabilization-and-control-phase0-plan.md)：2026-07-15 stabilization／Control Phase 0 reference的歷史execution ledger；報表能力現況以`CURRENT-STATUS`與active contracts為準。

## 建議閱讀順序

### 新開發者

1. 根目錄 `README.md` 與 `AGENTS.md`。
2. `Final-Long-Term-Goal.md`、本索引、`PROJECT-OVERVIEW.md`。
3. `CURRENT-STATUS.md`、`ARCHITECTURE.md`、`DATA-AND-FLOWS.md`。
4. `GETTING-STARTED.md`、`DEVELOPMENT-AND-TESTING.md`、`CONFIGURATION.md`。
5. 依工作範圍讀相關 contract、ADR、module map 與 operations 文件。

### 未來 AI 接手

1. 先讀 `Final-Long-Term-Goal.md`，確認哪些是 Confirmed、Inferred、Needs owner decision。
2. 讀 `PROJECT-OVERVIEW.md` 與 `CURRENT-STATUS.md`，避免把已完成基礎當待辦，或把計畫當實作。
3. 依任務讀架構、資料流、功能、設定與維運文件。
4. 提案前讀 `GAPS-RISKS-AND-DEBT.md`、`ROADMAP.md`、`OPEN-QUESTIONS.md`。
5. 修改前仍以程式碼、測試、Git diff 與執行驗證重新確認。

## 依任務選文件

| 任務 | 必讀 |
|---|---|
| 處理 Bug | `CURRENT-STATUS` → `MODULE-MAP` → 相關 contract／test → `TROUBLESHOOTING` |
| 開發新功能 | `Final-Long-Term-Goal` → `FEATURE-INVENTORY` → `ARCHITECTURE`／`DATA-AND-FLOWS` → `GAPS`／`ROADMAP` → 新行為契約 |
| 開發Financial Control第二階段 | `Final-Long-Term-Goal` → `CURRENT-STATUS` → `master-financial-control-plan`第17節 → 對應Control contract → 實際code／tests |
| 重構 | `ARCHITECTURE` → `MODULE-MAP` → 受影響 contract／test → CodeGraph impact → `GAPS` |
| 產品規劃 | `Final-Long-Term-Goal` → `PRODUCT-AND-USERS` → `CURRENT-STATUS` → `IMPROVEMENT-OPPORTUNITIES` → `ROADMAP`／`OPEN-QUESTIONS` |
| 部署／故障 | `CONFIGURATION` → `DEPLOYMENT-AND-OPERATIONS` → `backup-restore` → `TROUBLESHOOTING` |

## AI Session Bootstrap

把以下 prompt 直接交給下一個 AI；再於末尾補上本次任務：

```text
你正在處理 Last Say Repository。開始前：
1. 先完整閱讀根目錄 Final-Long-Term-Goal.md。
2. 再讀 docs/README.md、docs/project/PROJECT-OVERVIEW.md 與 docs/project/CURRENT-STATUS.md。
3. 根據任務閱讀相關的功能、架構、模組、資料流、開發、設定與維運文件，以及直接相關的 contracts／ADRs／plans。
4. 提案或排程前，檢查 docs/planning/GAPS-RISKS-AND-DEBT.md、IMPROVEMENT-OPPORTUNITIES.md、ROADMAP.md 與 OPEN-QUESTIONS.md。
5. 不得只相信文件；修改前仍需重新驗證相關程式碼、測試、設定與 Git 狀態。把事實、推論、未知與 owner 決策分開。
6. 不得讀取或輸出 data/、uploads/、outputs/ 中的真實財務內容，除非 owner 對該具體資料另有明確授權。
7. 完成工作後，回寫所有受影響的現況、架構、功能、維運、風險或 Roadmap 文件，並記錄實際驗證結果。
8. 使用 CodeGraph 時，cwd 必須是 finance-viewer 專案根目錄，不得在其上層目錄執行。

本次任務：<填入任務>
```

## Source of truth 與更新規則

同一問題的判讀順序為：執行中的程式碼與 migration／schema → 自動化測試與 release verifier → active contract／ADR → 本文件系統。只有在明確需要歷史決策脈絡時才查Git history；歷史內容不得覆蓋目前實作或owner最新決策。這是判讀證據強度，不代表可以略過產品 owner 的決策權。

- 功能行為改變：更新 `FEATURE-INVENTORY`、`CURRENT-STATUS`、相關 contract 與測試說明。
- 模組邊界或資料模型改變：更新 `ARCHITECTURE`、`MODULE-MAP`、`DATA-AND-FLOWS` 與 ADR。
- 設定、部署或故障處理改變：更新 development／operations 文件。
- 優先級或階段完成：更新 `GAPS`、`ROADMAP` 與相應 plan 的狀態／execution record。
- 使命或長期責任改變：先取得 owner 明確核准，再更新 `Final-Long-Term-Goal.md` 並記錄原因。
- 文件被新版入口取代、計畫完成且不再指導執行，或內容只剩歷史價值：先把仍有效的決策、證據與連結吸收到active文件，更新所有active links，再自working tree移除；歷史追溯使用Git，不保留會競爭source of truth的archive。
- 每次更新都要保留「最後驗證日期」；只改日期而未重新驗證不算更新。

更新觸發：新增／移除文件、source-of-truth 責任改變、主要流程或閱讀順序改變時，必須更新本索引。
