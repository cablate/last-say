# Project Audit Report

用途：保存2026-07-15對Last Say的Repository-wide盤點、知識重建、主要發現、本輪修正、驗證與覆蓋限制，供後續規劃、開發與稽核追蹤。

Status: Final
Audit date: 2026-07-15
Repository baseline: `main` at `4a4ac68` when audit began
Current delivery state: audited and remediated delivery scope; exact branch and commit are recorded by Git
Last validated against repository: 2026-07-16

Post-audit closure addendum（2026-07-16）：repository code與正式DB已到schema v10，完成reimbursement owner、obligation reversal lifecycle、versioned transfer decisions、12個governed analysis datasets、proposal envelope、unified impact review workbench、server-backed management P&L／Balance Sheet／Cash Flow，以及source-conflict review context。正式v6→v9與v9→v10都先建立可驗證backup、在temporary restore演練，再執行formal migration；1,078筆交易與交易雜湊保持不變，`integrity_check=ok`、0 FK violations。代表性card／liability／commitment facts與1筆reimbursement proposal已透過typed APIs進入正式DB。最新證據包含Node suite 199/199、Skill eval 17/17、Chromium 5/5、production audit／build／runtime／privacy／backup restore全部通過。剩餘gate僅為owner scope／proposal confirmation與GATE-F6 acceptance；2026-07-15與本輪早期的v6／v9數量只保留作historical ledger，目前truth以本addendum、`CURRENT-STATUS.md`與active contracts為準。

## Executive conclusion

**Confirmed：** Last Say已超過單純帳單分類器。它是local-first、single-user、localhost財務事實與審查平台：保留legacy交易學習與management P&L，同時具備typed accounts、sources、balances、cards、liabilities、commitments、investments、valuations、reconciliation、review、readiness與governed analysis contexts。

**Confirmed：** Financial Data Foundation Phase 0–7 release line與2026-07-15 trust stabilization構成baseline；2026-07-16再完成AI proposal→typed human review→three-view reporting與正式v10 real-data closure。系統與operator發布gate已通過，MP-07只剩不能由AI代做的owner confirmation與acceptance。

**Confirmed：** 整體產品仍未抵達長期終點。Formal management Balance Sheet／Cash Flow已實作，但真實coverage仍partial；foundation-to-forecast runtime adapter、safe-to-spend、alerts與scenario lifecycle尚未實作。`projectCashTimeline`仍只對explicit synthetic inputs計算，不能被描述為使用者現有財務預測。

**Owner direction recorded after audit（2026-07-15）：** AI是主要輸入方式，UI負責確認與少量修正；目前先讓foundation業務流程完整跑順，Financial Control Center排在下一階段並只能消費foundation。Reserve／reliable income與其他優化延後到真正需要時，不是current blocker。

**Documentation consolidation（2026-07-15）：** 新版文件系統是唯一冷啟動入口。原始`LTG-1`、歷史reporting spec、已完成foundation plan及舊root audit／design／journal／raw principles的仍有效內容，已交叉吸收到長期目標、current status、active contracts、roadmap與本報告；原檔自working tree移除，歷史追溯改用Git。仍約束現行行為的ADRs、behavior contracts與runbooks維持active。

**Maturity assessment（Inferred）：** engineering foundation與核心資料治理屬可用alpha／early product foundation；forward-control與operations maturity仍偏pre-production。這不是owner核准的市場版本標籤。

## Scope、方法與證據

### 已覆蓋

- Repository root、package／runtime／framework／configuration、Git狀態與history。
- 所有第一方pages、API routes、components、query／domain modules、DB façade與migrations。
- legacy import／review／rules／reporting與typed foundation核心流程。
- schema、money／identity、source／scope、ingestion、reversal、confirmation、reconciliation、analysis與manual investment flow。
- external AI skill、scripts、tests、Playwright E2E、CI／CodeQL、backup／restore／health、runtime smoke與security headers。
- active／draft contracts、ADRs、目前master plan、long-term goal、README、文件入口與文件保留邊界。
- TODO／FIXME／HACK／deprecated、large modules與高影響symbols。

### 低價值內容的覆蓋方式

`node_modules`、`.next*`、cache、generated output與third-party vendor未逐檔閱讀；只讀manifest、scripts、build entry與audit摘要。`package-lock.json`只檢查direct dependency變更、lock consistency與production audit，不逐項分析transitive dependency。

### 隱私邊界

沒有讀取`data/`、`uploads/`、`outputs/`或statement files中的真實財務內容。所有新tests與browser flows使用synthetic／anonymous isolated DB。release privacy gate現在掃描tracked與untracked、未被Git ignore的`.js`／`.jsx`／`.mjs`／`.json`／`.md`。

### 分析工具

- `rg`／PowerShell建立file、route、symbol、test與Git map。
- Git log核對foundation各phase落地。
- CodeGraph嚴格從`D:\_CabLate_Agents\general\finance-viewer`執行；final sync為269 files／2,338 nodes／5,426 edges／pending 0／worktree mismatch null。
- CodeGraph context／impact核對`majorToMinorExact`、`createManualHolding`、`projectCashTimeline`、`verifyFinanceBackup`與`runNextLocal`，再回看source與tests，不把graph output單獨當事實。
- 現有focused tests、in-app browser QA與完整`npm run verify:release`。

## Repository map

| Area | Evidence-backed inventory |
|---|---|
| Runtime | Node 22.5+、Next.js 15、React 19、JavaScript／JSX、Tailwind 4、`node:sqlite` |
| Process | 單一Next UI＋API process；`127.0.0.1`固定loopback，port預設3127且可設定；單一SQLite |
| Pages | 8：overview、transactions、reports、data、trend、corrections、rules、confirmations |
| API | 84個`route.js`；61個位於`app/api/finance/**` |
| Persistence | repository與正式DB schema v10／migrations 0001–0010；WAL、FK、busy timeout、checksummed ledger |
| Tests | 58個`.test.js` files，加2個Playwright specs／5個Chromium cases |
| AI | `.claude/skills/last-say-ops/**`外部operator contract；server無LLM call |
| Operations | seed、local launcher、backup／restore／health、skill eval、browser E2E、runtime smoke、release verifier |
| CI | Ubuntu／Node22、Playwright Chromium、release verifier；JavaScript CodeQL |

證據：`package.json`、`app/**`、`components/**`、`lib/**`、`scripts/**`、`test/**`、`e2e/**`、`.github/workflows/**`。

## Major findings and remediation

### F1 — Foundation完成，歷史文件曾落後

- **Confirmed：** Git commits `e28f8af`至`4a4ac68`、schema v6、active foundation contracts與release verifier證明Phase 0–7完成。
- **Original drift：** plan header曾保留`Ready for Phase 0`，容易讓接手者誤判。
- **Resolved：** current status、audit、roadmap與root goal已同步；被取代的plan原檔已移除，早期repo-reality只能從Git history按需追溯。

### F2 — 過去入口未完整呈現的能力

- typed compound ingestion、staging、atomic commit與confirmed reversal。
- card installment／payment matching、loan schedules／allocations、commitment occurrences。
- deterministic investments／FX／valuations、other valued items與manual evidence composites。
- transfer matching、source conflicts、review queue與identity merge／redirect。
- 8 readiness goals、12 allowlisted analysis datasets、proposal envelope、source watermarks與response limits。
- unified impact review workbench，以及reimbursement／obligation／transfer的versioned typed owners。
- browser nonce＋same-origin＋one-time authorization的high-risk boundary。
- checksummed migrations、backup／restore／health與release rehearsal。

**Resolved documentation gap：** 上述能力已納入`docs/project/FEATURE-INVENTORY.md`、architecture與data flows。

### F3 — Reports信任呈現

- **Confirmed current：** management P&L、Balance Sheet與direct-method Cash Flow皆是正式server-backed能力，並共用coverage／blocker／drillback呈現。
- **Original issue：** Balance Sheet／Cash Flow曾與P&L並列顯示static readiness claims；不是硬編碼財務金額，但仍可能誤導成熟度，且文字落後foundation。
- **Resolved：** `lib/queries/reports/{balance-sheet,cash-flow}.js`、對應routes與React consumers已實作；typed transfer、settlement、loan allocation、investment與reimbursement ownership有cross-view tests，React不自行加總語意。
- **Remaining gap：** 正式migration已完成，仍需owner acceptance；真實報表因缺少部分boundary、current card balance、loan／transfer matches與歷史card normalization closure而維持partial／unreconciled。這是資料coverage，不是程式把未知補成0。

### F4 — Data Center UI／backend落差

- **Original issue：** account UI缺loan／payable／investment等kinds；investment UI只讀。
- **Resolved core flow：** `AccountRegister.jsx`使用全部`ENUMS.account_kind`與supported currencies；`InvestmentRegister.jsx`可建立instrument、holding snapshot、market quote與FX。
- **Data integrity：** `createManualHolding`／`createManualMarketQuote`／`createManualFxQuote`在同一SQLite transaction建立`manual_note` source與typed fact；rollback與valuation有tests。
- **Remaining decision：** statement、trade history、schedule與大量source ingestion仍是external-AI／API-first。是否需要full GUI onboarding是owner產品決策，不應機械地為每張table新增CRUD。

### F5 — Currency presentation correctness

- **Original issue：** Data Center components曾固定兩位小數，與JPY exponent 0衝突。
- **Resolved：** `lib/finance/money/presentation.js`以canonical exponent、BigInt與exact decimal parsing處理；不使用float或無聲rounding。Account／obligation／investment UI共用它。
- **Evidence：** `test/money-presentation.test.js`、UI contract test與browser E2E驗證JPY 0位及TWD／USD 2位行為。
- **Residual risk：** legacy UI仍有自己的money表示；任何新金額欄位繞過shared owner都可能重建相同問題。

### F6 — Financial Control成熟度

- **Resolved Phase 0 reference：** 四份draft behavior contracts、metric dictionary、post-style synthetic fixture與pure projector已建立。
- **Confirmed semantics：** duplicate events fail closed；card charge不移動cash；loan principal＋interest＋fee等於單一cash payment；uncertain income排除；unknown commitment使coverage降級；partial coverage時safe-to-spend為`null`。
- **Golden result：** fixture最低cash為TWD minor `5800000`（2026-08-20）、first reserve breach為2026-08-05、runway 21日、coverage partial。
- **Remaining next-stage gaps：** trusted position adapter、obligation timeline、runtime forecast、API／UI、alert lifecycle與persistence均未完成。Owner financial policies延後到相應consumer，不列為目前foundation blocker。

### F7 — Localhost是安全前提

- 一般API沒有auth／roles／rate limit；launcher固定loopback，middleware有CSP與security headers，高風險routes另有browser confirmation。
- **Confirmed boundary：** single-user localhost成立；LAN／remote exposure會新增重大security surface。
- **Needs owner decision：** 是否永久local-only。在完整threat model、authz、TLS、CSRF、rate limit、secrets與audit前不得改成對外host。

### F8 — Verification已強化，但coverage仍有限

- **Current strength：** 58個Node test files、2個Playwright specs／5個Chromium cases、17-case skill eval、production build、runtime smoke、privacy scan、anonymous demo與backup rehearsal均納入整合驗證。
- **Actual browser evidence：** Data Center／三張reports與unified review workbench的empty、partial、typed-owner、conflict及exact transaction deep-link flows通過。
- **Remaining limits：** 沒有完整legacy import、真實AI ingestion、mobile、多瀏覽器、long-running、large-DB或concurrency suite；沒有TypeScript typecheck與coverage threshold。真實owner browser acceptance不得由synthetic E2E代替。

### F9 — Recovery能力有工具、尚無實際政策

- **Resolved groundwork：** `verifyFinanceBackup`與`finance-backup-check.mjs`可read-only驗manifest、SHA-256、SQLite integrity、FK、schema、source artifacts與freshness；`BACKUP-POLICY.md`提供owner worksheet。
- **Remaining risk：** RPO／RTO、backup location、schedule、retention、off-site／encryption與restore drill cadence全是Unknown；沒有automatic scheduler、last-known-good紀錄或graceful shutdown hook。
- **Consequence：** 程式能備份不代表owner最近有可用備份。

### F10 — Compatibility與大型模組維護債

- `lib/db.js`同時承擔legacy schema／ALTER compatibility與versioned migration façade；legacy `REAL`欄實存integer cents。
- `TransactionTable.jsx`、`Overview.jsx`、`RulesManager.jsx`及transactions／obligations query責任集中。
- 這些不是已證實bug；在behavior contract與targeted characterization不足前，大規模拆分可能增加回歸。

## Confirmed capability status

| Capability group | Current status | Primary evidence |
|---|---|---|
| Transaction review／learning | Implemented | `lib/queries/transactions.js`、`rules.js`、`learning.js`與tests |
| Management reporting | P&L／Balance Sheet／Cash Flow implemented；真實coverage partial | `lib/queries/reports/**`、`lib/reporting/**`、`ReportsView.jsx`、report tests |
| Shared kernel／typed ingestion | Implemented | migrations 0002–0003、ingestion modules／routes／tests |
| Obligations | Typed backend implemented；manual profile UI partial | migration 0004、`obligations.js`、card／liability／commitment tests |
| Investments／valuation | Backend＋bounded manual valuation UI implemented | migration 0005、manual routes、investment／valuation tests |
| Reconciliation／review | Transfer／reimbursement／source conflict／unified workbench implemented and published | migrations 0006–0010、reconciliation／workbench／versioning tests |
| Readiness／analysis | Implemented；12 governed datasets＋proposal envelope | readiness policy、analysis registry／query／API tests |
| Human authority | Implemented for designated high-risk flows | confirmation／authorization modules／tests |
| Backup／restore／health | Implemented CLI; policy not operationalized | `lib/db/backup.js`、scripts、tests、operations docs |
| Financial Control | Phase 0 pure reference only | draft contracts、metric dictionary、fixture、projector test |

## Highest remaining risks and debt

1. **P1 owner gate：** formal migration與postflight已完成；scope attestations、1筆typed reimbursement decision與owner browser acceptance尚未完成，不能宣稱Gate F關閉。
2. **P1 data coverage：** 真實card settlement、loan allocation、transfer／reimbursement matching與部分boundary／snapshot仍缺，三張表會誠實partial但尚不能完整回答所有財務問題。
3. **P1 forward control：** pure projector無runtime adapter／owner policies，不能回答真實risk date或safe-to-spend。
4. **Security boundary：** 一般write APIs依賴loopback；任何remote exposure都會使風險急升。
5. **Recovery／operations：** 新backup已驗證且restore→migration rehearsal成功，但RPO／RTO、schedule、retention與定期drill政策仍未知。
6. **Maintainability／observability：** schema compatibility雙軌、大型UI／query模組、僅health＋console，仍增加change radius且缺長期baseline。

詳細優先級、evidence、effort與acceptance見[`../planning/GAPS-RISKS-AND-DEBT.md`](../planning/GAPS-RISKS-AND-DEBT.md)。

## Recommended next actions

1. **由owner關閉MP-07 human gate。** 在`/confirmations`完成scope attestation與typed reimbursement decision，再用常用問題驗收三張表的partial／known gaps；AI不得代按browser confirmation。
2. **用真實常用問題完成AI→UI acceptance。** 讓AI讀named context／reports、只把material ambiguity送到workbench，由owner確認代表性card、loan、transfer與reimbursement案例；保存aggregate evidence與known gaps。
3. **補最影響coverage的typed facts。** 依report blockers優先補cash boundary、current debt snapshot、card payment match與own-transfer identity；每批preview／commit／postflight，驗收是blocker可追溯下降而非硬湊complete。
4. **Gate F接受後才接Financial Control。** 重用現有Balance Sheet facts做position adapter，再建立commitment／liability timeline；不得另建第二套帳戶、資產、負債或投資資料。
5. **進入forecast時才決定policy。** 先接governed DB adapter，再討論reliable income、reserve與safe-to-spend；partial／stale／unknown仍須Unavailable，其他維運優化維持簡單default。

## Owner decisions required

- **Resolved：** AI主輸入、UI確認／少量修正；foundation現在、Control Center下一階段；核心流程滿意前先採簡單defaults。
- **Deferred until relevant phase：** Base currency／FX完整policy、reserve、reliable income、uncertainty buffer與safe-to-spend override。
- **Still open but non-blocking now：** root LTG整體Approved狀態、localhost是否永久、backup RPO／RTO、oldest supported DB、Windows一級支援與telemetry邊界。

完整清單見[`../planning/OPEN-QUESTIONS.md`](../planning/OPEN-QUESTIONS.md)。

## Git history and delivery interpretation

最近已提交主線是可辨識的foundation序列：shared kernel → ingestion／balances → obligations → investments → reconciliation → governed analysis → release。這支持「foundation完成」結論。

盤點開始baseline為`main`／`4a4ac68`。後續依owner授權完成stabilization與Gate F MP-00至MP-07 operator work：新增schema migrations 0007–0010、semantic owners、analysis contexts、review workbench、三張reports、Skill／evals、tests與文件；正式DB經backup／rehearsal後升至v10並以typed APIs寫入代表性facts。最終branch與commit狀態以Git為準。

## Validation record

| Command／check | Result | Classification／impact |
|---|---|---|
| `npm run verify:release` | PASS，exit 0，86.3s | 完整gate成功；script明示`data/finance.sqlite`未開啟 |
| ESLint | PASS，0 warnings | source／scripts／tests無lint regression |
| production dependency audit | PASS，0 vulnerabilities at moderate or above | 驗證日供應鏈gate通過 |
| `node --test` | PASS，199／199，0 fail／skip／todo | legacy、foundation、semantics、reports、review與schema v10全通過 |
| Playwright Chromium E2E | PASS，5／5 | Data Center＋三張reports＋unified workbench的typed owner／stale／partial／retry flows |
| external AI skill eval | PASS，17／17 | operator fixed／adversarial cases通過 |
| Next production build | PASS | 8 pages、84 API routes、71 static-generation entries可build |
| runtime smoke | PASS | isolated DB、schema 9、health、transactions shell、production CSP無`unsafe-eval` |
| working-tree privacy scan | PASS | tracked＋untracked non-ignored JS／JSX／MJS／JSON／Markdown無verifier定義的敏感pattern |
| anonymous demo | PASS | 180 transactions、6 months、foundation contexts與review work存在 |
| anonymous backup→new-path restore | PASS | integrity=`ok`、0 FK violations、schema 9、180 transactions、34 change-evidence rows |
| real DB-only backup check | PASS | schema v6與v9兩個升級前manifest均驗hash／freshness／integrity／FK；bundles ignored且未追蹤 |
| real backup temporary migration rehearsal | PASS | 全新OS temp copies分別完成v6→v9與v9→v10；交易數／hash保留、integrity=`ok`、0 FK violations |
| formal DB migration／postflight | PASS | schema v10 ledger `1..10`、1,078 transactions、integrity=`ok`、0 FK violations；三張reports與workbench可查詢 |
| screenshots | PASS | 3份committed anonymous screenshots存在且非空 |
| Markdown inventory／links／fences | PASS | 74個current Markdown files；missing relative links 0、unbalanced fences 0 |
| `git diff --check` | PASS | 0 whitespace error；package files只有既有line-ending warning，非diff error |
| delivery inventory | PASS with expected scope | source／docs／tests／Skill變更均屬MP-00–06；無generated DB／build output／formal data |

Chromium整合初跑5條中4條通過，失敗指出synthetic owner-unresolved fixture重複宣告`transaction_id`，使deep-link assertion收到舊值。移除重複欄位並增加server read-model ID assertion後，focused test與完整5／5 browser flow通過；未修改產品語意來迎合測試。

Node 22在tests與server中輸出`node:sqlite` ExperimentalWarning；屬runtime warning，不是test failure。沒有為了通過驗證而修改既有assertions或schema。

## Coverage limitations

- 未讀取／驗證真實財務資料，因此不知道實際source coverage、資料品質、規模或owner真實財務結果。
- 未做usability study；manual UI與external AI流程的摩擦只能由code／browser flow推論。
- 未執行remote／multi-user安全測試，因產品不授權該部署姿態。
- 未做專門deep security scan、penetration test、dependency逐項審查或完整threat model。
- 未做large-DB、long-running、concurrency、memory或latency benchmark。
- Browser evidence只有一條committed E2E與本輪focused QA；不代表所有journeys／mobile／browsers成熟。
- 未逐檔閱讀generated、vendor、lockfile transitive entries與所有UI primitives；以入口、owner與高風險路徑覆蓋。
- 真實backup cadence與restore drill仍Unknown；匿名rehearsal不能替代owner evidence。

上述限制不影響「foundation完成」「本輪stabilization完成」「Control只完成Phase 0 reference」「formal statements與runtime forecast未完成」「loopback是安全前提」等直接source結論，但限制對真實資料完整度、易用性、規模與production readiness的判斷。

## Cross-check checklist

- [x] 所有第一方runtime、pages、APIs、query／domain、schema／migrations與operator tools已建map。
- [x] 核心transaction、typed ingestion、manual investment、analysis、confirmation與backup flows已source驗證。
- [x] Confirmed／Inferred／Unknown／Recommended／Needs owner decision已分開。
- [x] Foundation、Control plan、Roadmap、root goal與current status已同步。
- [x] Roadmap由長期目標、風險與dependency推導；Phase 0 reference未被誤寫為runtime能力。
- [x] 文件入口包含人類／AI／bug／feature／refactor／planning閱讀路徑。
- [x] 完整release gate、CodeGraph sync與browser evidence完成。
- [x] Markdown link／fence、`git diff --check`與working-tree inventory已完成並記錄。

更新觸發：重要finding修復、phase完成、validation baseline改變、新高風險證據、coverage擴張或owner決策時更新。每次更新應保留audit date與對應commit／verification evidence。
