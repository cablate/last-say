# Gaps, Risks And Debt

用途：把目前到長期目標之間仍存在的缺口轉成有證據、影響、前置條件與驗證方式的優先級，並保留已完成修正的證據。本文件不是一般 TODO 清單。

Last validated against repository: 2026-07-15

## 評分方式

- Priority：P0 阻礙正常運作／資料安全；P1 高價值且應優先；P2 基礎穩定後處理；P3 品質改善；Later 現在價值不足；Needs owner decision 會改變產品邊界。
- Impact／Urgency／Confidence／Risk：High、Medium、Low。
- Effort：S（數天內）、M（約一個可驗證切片）、L（跨多個切片）；不是工期承諾。
- Reversibility：High 表示易撤回；Low 表示涉及資料語意／migration，回復成本高。
- Alignment：對 `Final-Long-Term-Goal.md` 的 G1–G8。

**Confirmed：** 目前 localhost＋既有 verifier 下沒有已證實的 P0。若 server 對外暴露，無 auth 會立刻成為 P0；目前 loopback 是禁止任意改變的 trust boundary。

**Owner sequencing decision（2026-07-15）：** R4／R6仍是最高價值的下一階段產品缺口，但不是目前execution。Current gate是讓foundation的AI主輸入→typed commit→UI確認／少量修正流程在實際業務中跑順。Reserve／reliable income等policy延後，不得把control規劃擠到foundation closure之前。

## 仍開放的優先級

| ID | Priority | 缺口 | Impact | Urgency | Confidence | Effort | Risk | Dependency | Reversibility | Alignment |
|---|---|---|---|---|---|---|---|---|---|---|
| R4 | P1 — next stage | 缺可信 financial position／formal BS | High | Medium | High | L | High semantic | Foundation Closure、Phase 0 contracts | Medium | G1, G2, G4 |
| R6 | P1 — next stage | Phase 0只有純reference；缺runtime 90日forecast／safe-to-spend／alerts | High | Medium | High | L | High financial interpretation | R4、obligation timeline、later owner policies | Medium | G4, G5 |
| R7 | P1 — current gate | AI-primary輸入邊界已確認；完整operator→typed commit→UI review流程仍需實際使用驗收 | Medium | High | High | M | Medium workflow | Foundation Closure Gate | High | G3, G8 |
| R8 | Later | legacy／typed schema與money語意雙軌 | Medium | Low | High | L | High migration | stable business flow＋compatibility evidence | Low | G1, G8 |
| R9 | Later | 大型UI／query模組責任集中 | Medium | Low | High | L | Medium regression | actual flow pain＋characterization | High | G8 |
| R10 | Later / Needs owner decision | 已有backup health與policy worksheet；缺實際排程、retention、RPO／RTO、restore drill與graceful shutdown | High | Low | High | M | High recovery | actual operations need＋owner policy | Medium | G6, G8 |
| R11 | Later | 缺structured observability與large-DB／concurrency baseline | Medium | Low | High | M | Medium operations | measured scale／SLO | High | G7, G8 |
| R13 | Needs owner decision | localhost single-user是否永久邊界 | High | Medium | High | N/A | Critical if changed | product strategy | Low | G6, G8 |
| R14 | Later | bank API／cloud sync／multi-tenant抽象 | Unknown | Low | Medium | L | High scope creep | R13明確改變 | Low | 非現行目標 |

## Next-stage P1詳細項目

### R4 — 缺可信 financial position／formal Balance Sheet

- **問題／證據：** accounts、balances、liabilities、holdings、valued items、FX與reconciliation已存在，但沒有formal position read model／API；`components/reports/ReportsView.jsx`只顯示誠實不可用狀態。
- **影響：** 使用者無法從已完成foundation取得明示scope、as-of、currency、coverage與reconciliation的可信總覽；forecast也缺正式starting position。
- **與長期目標：** 解鎖G1資料可信度、G2解釋與G4 deterministic control。
- **不處理後果：** 大量資料能力停留在inventory，Control Phase 0只能是synthetic reference。
- **前置條件：** owner決定base currency、FX／quote freshness、statement scope；net-worth readiness；沿用`docs/contracts/financial-position-contract.md`。
- **Recommended：** 先做position read model與coverage，再做formal BS presentation；不可先畫dashboard或用balancing plug補Unknown。
- **規模／可逆性：** L／Medium；read model可分片，但任何新persistence或migration需另立contract。
- **驗證：** synthetic fixture對assets、liabilities、net position、missing／stale／unreconciled狀態做exact assertions；缺scope／balance／quote時不得顯示complete；每一line可追到facts。

### R6 — 缺runtime forecast／safe-to-spend／alerts

- **問題／證據：** `lib/finance/control/project-cash-timeline.js`與`test/fixtures/financial-control/**`已鎖定純計算語意，但沒有SQLite adapter、runtime read model、API、UI、forecast run persistence或alert lifecycle。readiness仍只能表示可否分析。
- **影響：** Last Say仍不能用真實canonical facts回答「何時現金不足／今天可花多少」；reference output不是產品結果。
- **與長期目標：** 是G4 deterministic calculations與G5 risk-before-event的核心。
- **不處理後果：** 使用者仍要外部手算，或後續UI可能誤把不完整資料變成精確建議。
- **前置條件：** R4 starting position、統一obligation／commitment timeline、owner核准reliable income、reserve、as-of與freshness政策。
- **Recommended：** 先建立DB-to-contract adapter與deterministic base case；coverage不是complete時，safe-to-spend必須維持Unavailable。AI只能解釋輸出。
- **規模／可逆性：** L／Medium；依adapter、timeline、forecast、control signals分stage。
- **驗證：** runtime fixture可重現daily curve、minimum cash、first breach與driver events；uncertain income排除、unknown commitment降級、duplicate與loan component invariant生效；alerts可ack／resolve且不重複。

## Current gate與延後項目

### R7 — AI-primary foundation workflow仍需實際收斂

- **Owner decision：** AI是主要輸入方式；UI只負責確認、歧義、高風險授權與少量修正，不追求純GUI full onboarding。
- **現況證據：** `AccountRegister.jsx`支援全部account kinds；`InvestmentRegister.jsx`可建立manual valuation facts；operator Skill與typed APIs涵蓋其他resources。
- **剩餘缺口：** 完整statement／trade／schedule來源能否在實際AI流程中順利preflight、preview、commit、recover與UI review，尚缺owner acceptance evidence。
- **不處理後果：** 技術table雖齊全，實際使用仍可能卡在Skill指引、錯誤訊息、identity／source缺口或confirmation，而被誤判為foundation完成。
- **Recommended：** 以真實workflow發現的摩擦做最小修正；優先Skill、contract、error recovery與bounded confirmation UI，不以CRUD數量衡量進度。
- **驗證：** Owner常用來源不需直接改SQLite即可完成canonical commit與必要UI確認，並由owner明確接受流程。

### R8 — Legacy／typed schema雙軌

- **證據：** `lib/db.js`保留legacy schema／ALTER compatibility；`lib/db/migrations/**`管理versioned evolution；legacy `REAL`欄位實存cents。
- **影響／風險：** migration owner與money reader容易誤判；直接刪相容層可能破壞舊DB。
- **Recommended：** 建立oldest-supported DB fixture與support window，再逐步縮小compatibility façade。
- **驗證：** fresh DB、supported-old DB、newer DB refusal與checksum drift全部通過。

### R9 — 大型模組責任集中

- **證據：** `TransactionTable.jsx`、`Overview.jsx`、`RulesManager.jsx`及transactions／obligations query承擔多個use case。
- **影響／風險：** review、filter、mutation與render互相牽動；目前新增的單條E2E仍不足以支撐大規模拆分。
- **Recommended：** 先以behavior contracts與characterization tests鎖定欲拆use case，再依domain owner移動；不以行數本身驅動重構。
- **驗證：** consumer graph縮小、原contract不變、focused tests＋E2E＋full verifier通過。

### R10 — Recovery operations尚未落地

- **現況證據：** backup／restore CLI、`verifyFinanceBackup`、`finance-backup-check.mjs`、`BACKUP-POLICY.md`與匿名release rehearsal已存在。
- **剩餘缺口：** owner尚未填RPO／RTO、位置、retention、責任人與演練頻率；Repository無排程器、last-known-good紀錄或server shutdown hook。
- **影響／不處理後果：** 能驗backup不代表最近一定有backup；schema upgrade後rollback仍依賴人工記憶。
- **Current simple default：** 沿用explicit manual backup／health check，不自動刪除、上傳或切換active DB。等核心business flow穩定、備份頻率成為實際風險或owner準備正式維運時，再核准policy、建立OS scheduler與new-target restore drill。
- **驗證：** `backup:check`在RPO內通過，並在RTO內完成新path restore、health、schema、counts與audit evidence核對。

### R11 — Observability／capacity未知

- **證據：** 只有health與console；無metrics／tracing；無large-DB／lock contention benchmark。
- **影響：** 同步SQLite query變慢或long-running問題只能靠手動診斷。
- **Recommended：** 先定義實際規模與關鍵latency，再加最小sanitized timings／diagnostic output；不先部署完整APM。
- **驗證：** 代表性匿名資料量有可重現baseline與threshold，log不含financial payload。

## Needs owner decision／Later

### R13 — Network／multi-user邊界

若維持single-user localhost，無auth是可接受的明示限制；若要LAN／remote／multi-user，必須先做threat model、identity／authorization、TLS、CSRF、rate limit、secrets、audit與migration。不能只改host。

### R14 — 提前的外部整合抽象

沒有已確認需求支持bank aggregator、cloud sync、multi-tenant或microservice。現在投入會增加secret／privacy／operations範圍，與local-first核心不對齊。只有owner改變產品策略後再評估。

## 2026-07-15 已完成的風險修正

| ID | 原缺口 | 完成證據 | 驗收狀態 |
|---|---|---|---|
| R1 | JPY UI money exponent錯誤 | `lib/finance/money/presentation.js`；account／obligation UI；`test/money-presentation.test.js`；browser E2E | JPY 0位、TWD／USD 2位、超額精度拒絕；focused tests與E2E通過 |
| R2 | BS／CF readiness preview可能被誤認為正式能力 | `components/reports/ReportsView.jsx`；`test/data-center-ui-contract.test.js`；browser E2E | 兩tab只顯示明確不可用狀態；沒有靜態財務數字或過期readiness宣稱 |
| R3 | Control Phase 0 contract／metric／fixture缺口 | 四份behavior contracts、metric dictionary、synthetic fixture、`project-cash-timeline.js`、`test/control-cash-timeline.test.js` | reference語意與acceptance通過；owner policy與runtime adapter仍屬R4／R6 |
| R5 | 缺browser E2E | `playwright.config.mjs`、`scripts/run-browser-e2e.mjs`、`e2e/data-center-and-reports.spec.js`、CI／release gate | 隔離empty DB走完JPY account、manual investment valuation與report unavailable；Chromium通過 |
| R12 | port設定漂移 | `scripts/run-next-local.mjs`、package scripts、`.env.example`、`test/local-next-launcher.test.js` | PORT precedence／range與loopback binding已測試 |

本次另補上manual investment source＋fact atomicity、backup health check／policy worksheet，以及privacy scan對untracked working files的coverage。這些不代表formal statements、runtime forecast或實際backup schedule已完成。

更新觸發：風險被修復、證據或優先級改變、新P0／P1出現、owner決策改變dependency時更新；完成項保留驗證證據，避免後續文件退回舊敘述。
