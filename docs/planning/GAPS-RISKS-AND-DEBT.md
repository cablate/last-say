# Gaps, Risks And Debt

用途：把目前到長期目標之間仍存在的缺口轉成有證據、影響、前置條件與驗證方式的優先級，並保留已完成修正的證據。本文件不是一般 TODO 清單。

Last validated against repository: 2026-07-21

## 評分方式

- Priority：P0 阻礙正常運作／資料安全；P1 高價值且應優先；P2 基礎穩定後處理；P3 品質改善；Later 現在價值不足；Needs owner decision 會改變產品邊界。
- Impact／Urgency／Confidence／Risk：High、Medium、Low。
- Effort：S（數天內）、M（約一個可驗證切片）、L（跨多個切片）；不是工期承諾。
- Reversibility：High 表示易撤回；Low 表示涉及資料語意／migration，回復成本高。
- Alignment：對 `Final-Long-Term-Goal.md` 的 G1–G8。

**Confirmed：** 目前 localhost＋既有 verifier 下沒有已證實的 P0。若 server 對外暴露，無 auth 會立刻成為 P0；目前 loopback 是禁止任意改變的 trust boundary。

**Owner sequencing decision（2026-07-15，2026-07-21重驗）：** Current gate仍是讓foundation的AI主輸入→typed commit→UI確認／少量修正流程在實際業務中跑順。R4 formal Balance Sheet、FC-A2、FA-0、FC-A3、FC-2與FC-3已有bounded code／synthetic／runtime consumers；下一步是用真實問題驗收Context Pack與AI提示詞。Reserve／reliable income／safe-to-spend等policy延後。最新release verifier的非瀏覽器檢查通過，但Chromium 4／7，3個案例因舊畫面契約／selector落差失敗，尚不能宣稱release gate全綠。

## 仍開放的優先級

| ID | Priority | 缺口 | Impact | Urgency | Confidence | Effort | Risk | Dependency | Reversibility | Alignment |
|---|---|---|---|---|---|---|---|---|---|---|
| R6 | P1 — next stage | FC-3已提供bounded runtime raw path；仍缺safe-to-spend／alerts／scenario policy | High | Medium | High | L | High financial interpretation | R4、FC-2 obligation timeline、later owner policies | Medium | G4, G5 |
| R7 | P1 — owner gate | AI-primary、unified review、三張表、正式DB v10與代表性typed flow已完成；scope／proposal／owner acceptance未關閉 | High | High | High | S（owner操作） | High authority | browser-bound confirmation＋owner acceptance | High | G3, G8 |
| R15 | P1 — foundation maintenance | 2026-01至05官方卡片月檔與既有normalized rows總額不一致；現有source-conflict選擇語意不能修復轉換差異 | Medium | Medium | High | M | High data repair | reversible re-import／transaction repair contract | Medium | G2, G3, G8 |
| R16 | P1 — implemented；real statement acceptance pending | current／unbilled→posted生命週期匯入器、reversal與operator recipe已完成；尚待07月正式帳單在backup副本與正式DB驗收 | High | High | High | S（操作驗收） | High duplicate/statement risk | actual posted source、backup／rehearsal | High | G2, G3, G8 |
| R17 | P2 — verification maintenance | 最新release gate的Chromium為4／7；2個Monthly Pulse E2E仍驗收舊`MonthlyPulseView`，另1個Data Center E2E以裸`JPY`對照目前「日圓」呈現 | Medium | Medium | High | S | Medium contract drift | 先更新E2E UI contract／selector，再重跑完整gate | High | G8 |
| R8 | Later | legacy／typed schema與money語意雙軌 | Medium | Low | High | L | High migration | stable business flow＋compatibility evidence | Low | G1, G8 |
| R9 | Later | 大型UI／query模組責任集中 | Medium | Low | High | L | Medium regression | actual flow pain＋characterization | High | G8 |
| R10 | Later / Needs owner decision | 已有backup health與policy worksheet；缺實際排程、retention、RPO／RTO、restore drill與graceful shutdown | High | Low | High | M | High recovery | actual operations need＋owner policy | Medium | G6, G8 |
| R11 | Later | 缺structured observability與large-DB／concurrency baseline | Medium | Low | High | M | Medium operations | measured scale／SLO | High | G7, G8 |
| R13 | Needs owner decision | localhost single-user是否永久邊界 | High | Medium | High | N/A | Critical if changed | product strategy | Low | G6, G8 |
| R14 | Later | bank API／cloud sync／multi-tenant抽象 | Unknown | Low | Medium | L | High scope creep | R13明確改變 | Low | 非現行目標 |

## Next-stage P1詳細項目

### R4 — Trusted position／formal Balance Sheet（Resolved in code；real-data acceptance pending under R7）

- **完成證據：** `lib/queries/reports/balance-sheet.js`、API route、`BalanceSheet.jsx`、`balance-sheet-contract.md`與`test/reporting-three-view.test.js`。
- **已關閉風險：** Account snapshot優先、完整holding fallback、tier-2 valuation、FX／source／snapshot watermarks、missing／stale blockers與derived net worth均由server read model提供；current debt不由original principal或schedule猜測。
- **Real-data closure（2026-07-16）：** 已在可驗證備份與副本演練後，加入主要卡片current-liability與低活動現金帳戶的same-date snapshot；正式Balance Sheet現在為`complete`、equation delta 0、blockers 0。這只關閉當前position缺口，不會補出歷史cash boundaries，也不代表owner已接受所有分類。精確私人金額只存在ignored evidence zone。

### R6 — 缺safe-to-spend／alerts／scenario policy

- **問題／證據：** FC-3已提供`lib/finance/control/project-cash-timeline.js`、trusted opening cash adapter、query／API與`/control` raw path；但沒有owner核准的reserve、reliable income、safe-to-spend override、alert lifecycle或scenario policy。
- **影響：** Last Say可以呈現有界的已知義務與raw cash path，但仍不能把它包裝成「今天可花多少」、完整缺口預警或可靠的風險控制結論。
- **與長期目標：** 是G4 deterministic calculations與G5 risk-before-event的核心。
- **不處理後果：** 使用者仍要外部手算，或後續UI可能誤把不完整資料變成精確建議。
- **前置條件：** R4 starting position、FC-2 obligation／commitment timeline、owner核准reliable income、reserve、as-of與freshness政策。
- **Recommended：** 先建立DB-to-contract adapter與deterministic base case；coverage不是complete時，safe-to-spend必須維持Unavailable。AI只能解釋輸出。
- **規模／可逆性：** L／Medium；依adapter、timeline、forecast、control signals分stage。
- **驗證：** raw path可重現daily curve、minimum cash與driver events；uncertain income排除、unknown commitment降級、duplicate與loan component invariant生效；後續safe-to-spend與alerts另需policy fixture、ack／resolve與不重複驗收。

### FC-A2 — Monthly Financial Pulse（Resolved in code；formal-data acceptance pending under R7）

- **完成證據：** `monthly-financial-pulse-contract.md`、`lib/queries/finance/control/monthly-pulse.js`、API route、`MonthlyPulseView.jsx`、3個focused tests與2個browser flows。
- **已關閉風險：** 管理淨收支、現金變動、card／loan／investment／reimbursement movement不再由AI或前端臨時拼算；proposed reimbursement不會先扣抵，且所有值可drillback並帶deterministic watermark。
- **剩餘界線：** 此切片不提供90日forecast、safe-to-spend、essentiality判斷或正式資料接受；真實Cash Flow缺boundary／matching時，Pulse會跟著維持partial／unreconciled。

## Current gate與延後項目

### R7 — AI-primary foundation workflow仍需實際收斂

- **Owner decision：** AI是主要輸入方式；UI只負責確認、歧義、高風險授權與少量修正，不追求純GUI full onboarding。
- **現況證據：** Account／investment UI、15 named analysis datasets、FA-0 Context Pack、proposal envelope、unified review workbench、三張server reports與FC-A2／FC-A3／FC-2／FC-3 bounded consumers均已存在；正式DB已先備份／演練後升至v10，代表性card／liability／commitment facts及reimbursement proposal均走typed API。2026-07-21最新release verifier的非瀏覽器檢查通過，但Chromium 4／7，不能把browser gate標成全綠。
- **剩餘缺口：** 五類scope尚未由browser-bound human confirmation聲明；1筆reimbursement proposal待owner確認／拒絕；20筆真正未知仍刻意owner-unresolved；GATE-F6沒有人工acceptance evidence。
- **不處理後果：** 技術table雖齊全，實際使用仍可能卡在Skill指引、錯誤訊息、identity／source缺口或confirmation，而被誤判為foundation完成。
- **Recommended：** 以真實workflow發現的摩擦做最小修正；優先Skill、contract、error recovery與bounded confirmation UI，不以CRUD數量衡量進度。
- **驗證：** Owner常用來源不需直接改SQLite即可完成canonical commit與必要UI確認，並由owner明確接受流程。

### R15 — 歷史信用卡normalization差異

- **問題／證據：** 2026-01至05的官方月檔總額與現有normalized card rows各有差異；2026-06可精確對上150筆items與唯一bank payment。差異可能包含漏列分期與正負號處理，但目前沒有足夠證據逐筆指定repair。
- **影響：** 歷史月份的P&L／card settlement不能宣稱statement-level reconciliation complete；強行建立statement會把錯誤normalization包裝成正式事實。
- **語意限制：** `source_conflicts`適用於兩個互斥來源由人選一個；此處是官方source與derived rows間的轉換缺口，選source不會修復transactions，因此目前正式conflict count保持0。
- **Recommended：** 先建立可preview、可逐筆diff、可reversal的card transaction repair／re-import contract；以官方statement totals與row identity驗證，不直接SQL修補。
- **驗證：** 每期items合計等於官方statement total、credits／installments保持正確符號與timeline、re-import idempotent、P&L不重複、payment match唯一且完整。

### R16 — Current／unbilled卡片生命週期（Implemented in code；real statement acceptance pending）

- **原問題／證據：** 07-16主要信用卡匯出含92筆未出帳與10筆即時授權；其中72筆已存在於07-08舊快照。一般cash dedupe包含`source_key`，正式posted source若直接逐列新增會重複經濟事件或保留已解除授權。
- **2026-07-17完成內容：** `credit-card-transaction-lifecycle-contract.md`、`lib/finance/ingestion/card-lifecycle.js`、既有ingestion dispatch、typed reversal blocker／restore、capabilities schema、synthetic fixture與Operator Skill recipe已落地。唯一強identity才自動match；new row才建立交易；release必須明確列key；ambiguous、stale impact、row-total mismatch或未處理provisional facts都阻擋commit。
- **驗證證據：** `test/card-transaction-lifecycle.test.js`共4例覆蓋match／new／release／source supersession／idempotency／existing source／explicit ambiguity resolution／reversal及downstream statement blocker；該slice驗證時Node suite為209/209、Skill eval 18/18、lint與diff check通過；加入FA-0後最新Node suite為212/212。所有R16資料為synthetic，沒有正式DB write或schema migration。
- **剩餘驗收：** 取得07月正式posted source後，先建立可驗證backup，在restore副本preview並比對matched／new／released／ambiguous與signed row total；只有副本commit、reversal及typed statement total都通過後才寫正式DB。這是real-data acceptance，不再是缺產品API。

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
| R2 | BS／CF readiness preview可能被誤認為正式能力 | `ReportsView.jsx`、三張server query／API、reporting tests、browser E2E | 靜態preview先被移除；2026-07-16由具coverage與drillback的正式management read models取代 |
| R3 | Control Phase 0 contract／metric／fixture缺口 | 四份behavior contracts、metric dictionary、synthetic fixture、`project-cash-timeline.js`、`test/control-cash-timeline.test.js` | reference語意與acceptance通過；owner policy與runtime adapter仍屬R4／R6 |
| R5 | 缺browser E2E | Playwright config／runner、Data Center／reports spec、review workbench／Monthly Pulse spec、CI／release gate | 隔離DB驗證JPY account、manual valuation、server-backed reports、typed decisions、Monthly Pulse ready／partial／error／retry；Chromium 7/7 |
| R12 | port設定漂移 | `scripts/run-next-local.mjs`、package scripts、`.env.example`、`test/local-next-launcher.test.js` | PORT precedence／range與loopback binding已測試 |

本次另補上manual investment source＋fact atomicity、backup health check／policy worksheet，以及privacy scan對untracked working files的coverage。2026-07-21重驗另發現E2E與目前Control UI契約漂移，列為R17；不代表產品資料語意已失效，但在修正selector／測試前不能宣稱release gate穩定。這些不代表formal statements、safe-to-spend或實際backup schedule已完成。

更新觸發：風險被修復、證據或優先級改變、新P0／P1出現、owner決策改變dependency時更新；完成項保留驗證證據，避免後續文件退回舊敘述。
