# Last Say 完整財務掌控 Master Plan

> - 狀態：Spec-plan；Control Center已確認為資料基礎建設之後的下一階段；Phase 0 reference已完成，Phase 1-6排在foundation業務流程收斂之後
> - 日期：2026-07-15（原始規劃 2026-07-13）
> - 適用範圍（proposed）：個人與家戶優先；local-first；AI主輸入＋UI確認／少量修正；Control MVP沿用TWD簡單default，需要時再擴充
> - 上位目標：把 Last Say 從「事後看懂交易」推進為「在未來義務追上現金以前，先看見風險並採取行動」
> - Canonical goal：[Final Long-Term Goal](../../Final-Long-Term-Goal.md)／原始 `LTG-1`
> - 上游資料 owner：已實作的foundation code與[`financial-data-core-contract.md`](../contracts/financial-data-core-contract.md)、[`account-balance-storage-contract.md`](../contracts/account-balance-storage-contract.md)、[`liability-and-commitment-storage-contract.md`](../contracts/liability-and-commitment-storage-contract.md)、[`investment-valuation-storage-contract.md`](../contracts/investment-valuation-storage-contract.md)
> - 報表關聯契約：[`reports-phase1-implementation-contract.md`](../contracts/reports-phase1-implementation-contract.md)、[`balance-sheet-contract.md`](../contracts/balance-sheet-contract.md)、[`cash-flow-contract.md`](../contracts/cash-flow-contract.md)、[`report-coverage-contract.md`](../contracts/report-coverage-contract.md)

執行順序固定為「財務資料基礎建設 → 本計畫」。本計畫擁有 projection、policy、safe-to-spend、alerts 與 scenario semantics；entity、account、source、balance、card、liability、commitment、investment、valuation 與 reconciliation 的 canonical persistence 由上游資料基礎計畫擁有。本文提到的資料表或欄位若與上游衝突，以資料基礎計畫與其 behavior contracts 為準，不建立第二套資料真相。

Owner於2026-07-15進一步確認：目前仍屬foundation業務流程收斂期；AI是主要輸入方式，UI只負責確認與少量修正。只有owner對foundation實際流程滿意後才啟動本計畫runtime phases。Reserve、reliable income與其他進階policy延後到對應consumer，不是目前工作。

## 1. 結論先行

貼文指出的不是單純「沒有記帳」，而是三個時間差造成的控制失靈：

1. 刷卡日在經濟上已經支出並形成負債，但銀行存款尚未下降。
2. 貸款讓眼前戶頭仍有現金，但未來每月已被還款義務占用。
3. 使用者通常只在扣款後看見結果，沒有在扣款前看見最低現金點與死線。

目前 Last Say 已能回答：

- 這筆錢花到哪裡；
- 哪些交易需要人工審查；
- 本月相較常態有何變化；
- 哪些商家規則可以在下次匯入時自動套用；
- 在資料覆蓋有限的前提下，本期管理損益大致如何。

目前還不能可靠回答：

- 今天實際還能安全花多少；
- 未出帳信用卡與已出帳帳單合計承諾了多少未來現金；
- 下一次現金低於安全水位是哪一天；
- 所有貸款、卡費、房租與固定帳單扣完後，90 天內最低餘額是多少；
- 哪個風險來自真的超支，哪個只是資料過期或帳戶漏匯；
- 若現在少花、延後購買或調整還款，死線會移動多少。

因此正確方向不是只加一個「月預算進度條」，而是先建立：

> **可信的現況資產負債 + 未來承諾日曆 + 每日現金預測 + 有覆蓋率保護的安全可花金額 + 使用者定義的消費守門線。**

完成 Phase 0-4 後，產品即可處理貼文描述的核心情境。完成 Phase 5-6 後，才接近完整、可持續改善的個人財務控制系統。

---

## 2. Repo Reality：目前能支援到哪裡

以下判定已於2026-07-15依實際程式碼、tests與本輪驗證更新，不以UI標籤或舊計畫推測。

| 能力 | 現況 | 可支援程度 | 主要證據／限制 |
|---|---|---:|---|
| 銀行／信用卡交易匯入 | 已有 | 高 | 外部 AI 依 Skill 整理 ledger，再由 `/api/import-ledger` 匯入；有去重與來源紀錄。 |
| 商家分類與信心度 | 已有 | 高 | 每筆可有分類、信心度、判斷理由；低信心進待審。 |
| 人工修正與持續學習 | 已有 | 高 | `correction_log` append-only；學習 API 只採可信人類證據；規則變更會重新校正歷史未審資料。 |
| 月度支出／分類／趨勢 | 已有 | 中高 | Overview、Breakdown、Trend、Top movers、固定底盤；回答「發生了什麼」。 |
| 全期間總覽 | 已有 | 中 | `month=all` 可跨月查詢，但仍以已匯入交易為界。 |
| 管理損益表 | 已有第一版 | 中 | 可做 scoped P&L、coverage、report mapping；不是稅務或完整權責制報表。 |
| 資產負債表 | foundation facts已有；正式read model／報表未完成 | 低 | UI明確顯示unavailable；需position scope、FX freshness與reconciliation，不能把inventory當報表。 |
| 現金流量表 | readiness已有；正式read model／報表未完成 | 低 | UI明確顯示unavailable；需cash boundary、mapping與begin/end reconciliation。 |
| 帳戶資料 | typed foundation與manual UI已有 | 高 | entity、institution、account kind、currency、status、aliases與balance snapshots已存在；所有account kinds可由Data Center建立。 |
| 當前信用卡暴險 | typed facts已有，統一timeline未完成 | 中 | profiles、statements、items、payment matches、installments已存在；尚無Control read model整合未出帳／已出帳／due。 |
| 貸款契約與還款表 | typed facts已有，Control projection未完成 | 中 | liability profile、schedule entries、payment allocations已存在；尚無統一future cash timeline。 |
| 固定／週期承諾 | typed templates／occurrences已有 | 中 | 可保存recurring／one-off facts；unknown amount／due與materialization仍需Control policy。 |
| 投資與FX | typed facts與manual UI已有 | 中高 | instruments、holdings、quotes、FX與valuation存在；manual source＋fact原子寫入，正式statement／trade import仍走operator/API。 |
| Control Phase 0 | pure reference已完成 | 中（語意）／無（runtime） | 四份contracts、metric dictionary、synthetic fixture與90日timeline projector已驗證；不讀真實DB、無API／UI。 |
| 每日現金預測 | 只有pure reference | 無runtime能力 | 尚缺trusted starting position、DB adapter、統一future events、owner policies與runtime surface。 |
| 安全可花金額 | 沒有 | 無 | 沒有 reserve floor、forecast coverage、支付工具時點模型。 |
| 預算與警示 | 沒有 | 無 | 無 alert rule、事件、確認／處理紀錄與通知節流。 |
| 情境模擬 | 沒有 | 無 | 無「多花 X、延後 Y、收入晚到」的 before/after projection。 |

### 現況產品定位

目前是可信的 **AI 協作交易審查與月度理解工具**。它已具備升級所需的好基礎：來源、理由、信心度、審核、規則、歷史修正和 coverage 思維；但尚不是主動的財務控制系統。

---

## 3. GORE／產品意圖

### 3.1 Primary Goal

**PG-1：使用者在未來付款義務造成現金短缺以前，能可靠知道可安全動用的金額、風險發生日與原因，並完成一個可驗證的因應行動。**

PG-1 是 canonical [Final Long-Term Goal](../../Final-Long-Term-Goal.md) 在本計畫 Phase 0-4 的階段性 operationalization。這個目標不能被「新增預算功能」「做一張現金圖」或「完成 build」取代。

### 3.2 Actors And Jobs

| Actor | Job to be done | 系統不應逼他做的事 |
|---|---|---|
| 一般使用者 | 快速知道今天能不能花、下次壓力何時出現、該先處理什麼 | 每天手動重算所有卡費、貸款與帳戶；閱讀會計底稿才得到答案 |
| 深度使用者／家庭管理者 | 管理多帳戶、多卡、多筆貸款與共同支出 | 用試算表重建 Last Say 已有的交易與分類 |
| 外部 AI operator | 解析帳單、契約、現行明細與餘額，提出有證據的結構化資料 | 猜測未提供的負債、直接把低信心資料當真、在 Skill 保存私人商家字典 |
| 人類 reviewer | 確認高風險且 AI 無法可靠判斷的欄位 | 逐筆重做 AI 已有高品質證據的工作 |
| 開源維護者 | 擴充新銀行格式、帳戶類型與控制規則 | 接觸使用者真實資料或依賴單一銀行私有格式 |

### 3.3 Supporting Goals

| Goal ID | Goal | Depends on | Observable outcome |
|---|---|---|---|
| G1 | 建立可信的當下財務位置 | 現有交易、帳戶、餘額 snapshot | 使用者可看到納入範圍、現金、信用卡負債、貸款與資料新鮮度 |
| G2 | 把未來義務具體化 | G1、帳單／契約／週期規則 | 每筆未來付款有日期、金額或範圍、來源、狀態與可信度 |
| G3 | 建立可解釋的每日現金預測 | G1、G2 | 90 天每日投影、最低現金點、首個破底日可重算且可 drill down |
| G4 | 提供可行動的守門指標與警示 | G3 | 安全可花、現金 runway、消費守門線、未來 7/30 天義務與警示原因一致 |
| G5 | 不以假精準掩蓋缺資料 | 所有目標 | 缺帳戶、過期餘額或未知卡費時，顯示 partial／range／unknown，而非精確綠燈 |
| G6 | 建立可持續的人類 + AI 操作循環 | G1-G5 | AI 準備資料，人類只審高風險項，審完即重算，月結可對帳 |
| G7 | 從預測誤差與修正中學習 | G6 | 週期金額、日期與分類的建議逐月改善，但人類確認仍具最高權威 |
| G8 | 與三大管理報表共用同一財務事實 | G1、G2、既有 reporting plan | 卡費、貸款、轉帳不重複計算；控制中心與報表能互相追溯 |

### 3.4 Soft Goals

- **可信**：每個重要數字都有來源、as-of time、coverage 與推導說明。
- **低負擔**：正常週期只需數分鐘確認，不要求使用者重做記帳員工作。
- **可行動**：警示必須回答「發生什麼、何時、影響多少、可檢查哪些資料」。
- **不羞辱**：呈現風險，不用道德化文案評價消費者。
- **local-first**：真實財務資料預設只在本機；AI 仍為外部 operator。
- **可擴充**：銀行格式與 AI provider 不成為核心財務模型的一部分。

### 3.5 Domain Invariants

1. 匯入的金額、日期、來源、原始文字不可為了預測或報表對帳而竄改。
2. 信用卡消費在交易日形成支出與負債；信用卡繳款是現金清償，不可再算一次支出。
3. 貸款本金是負債清償；利息與費用才是期間成本。
4. 未確認的 AI 推測不可讓 forecast coverage 變成 `complete`。
5. 缺少必要帳戶或過期 snapshot 時，不得顯示單一精確「安全可花」數字。
6. 所有規則、契約、承諾、警示的語意變更都需保留 append-only change evidence。
7. Forecast 是可重建的 projection，不是新的交易事實來源。
8. 人類修正優先於 AI、歷史規則與統計推測。
9. 所有開發、測試、demo 必須使用隔離 DB，不得碰 `data/finance.sqlite`。
10. 所有新 API 與 operator 欄位必須在同一 Phase 更新 `.claude/skills/last-say-ops/`。

### 3.6 Non-Goals

- 不做銀行法規意義的授信或債務建議。
- 不宣稱能取代會計師、理財顧問、債務協商或稅務服務。
- MVP 不做銀行即時串接；先支援使用者提供檔案、餘額與外部 AI 操作。
- MVP 不做投資部位逐日市價、稅務成本、投資 lot accounting。
- MVP 不做多幣別合併總額；先儲存 currency，未有 FX 規則時分幣別呈現。
- 不以 AI 對未提供的收入、債務或繳款條件做「合理猜測」。
- 不把月預算達成率當作完整財務健康分數。

---

## 4. 核心領域模型：三個時間軸與一個新鮮度軸

### 4.1 經濟事件時間軸

交易發生時就影響消費、損益或資產負債。例如刷卡買 NT$10,000 商品：

- P&L：交易日認列支出；
- Balance Sheet：信用卡負債增加；
- 銀行現金：此時不變。

### 4.2 帳單／義務時間軸

結帳、分期、貸款契約與固定帳單把經濟事件轉成可執行的付款義務：

- statement close date；
- payment due date；
- amount due／minimum due；
- loan principal／interest split；
- autopay source account。

### 4.3 現金時間軸

真正從銀行、現金、電子錢包流入或流出的日期。這是 daily cash forecast 與 runway 的基礎。

### 4.4 Data Freshness 軸

任何 projection 都要附：

- 資料最後更新時間；
- 使用官方帳單、當前明細、人工輸入或估計；
- 哪些帳戶／義務未納入；
- 下一次應更新的時間。

**沒有新鮮度就沒有可信的安全可花。** 每月只匯正式帳單，可以做月結；若要在扣款前預警，還需每 1-3 天提供信用卡當前交易／未出帳資訊，並定期更新銀行餘額。

---

## 5. 指標定義

### 5.1 Projected Cash

```text
projected_cash[d]
= opening_liquid_cash
+ dependable_inflows[<= d]
- committed_outflows[<= d]
- modeled_variable_outflows[<= d]
```

- `opening_liquid_cash` 只含納入範圍且 snapshot 新鮮的流動帳戶。
- `dependable_inflows` 只含已確認或符合可靠性政策的收入；不把期待中的案款當成確定現金。
- `committed_outflows` 包含卡費、貸款、房租、保險、訂閱、稅費與確認的一次性付款。
- `modeled_variable_outflows` 是可選的保守估計，必須與已知承諾分開顯示。

### 5.2 Reserve Floor

使用者設定最低保留現金，可為：

- 固定金額；
- 必要支出 N 天；
- 指定帳戶不可動用金額；
- 多者取高。

產品不替所有人硬編一個唯一正確比例。

### 5.3 Safe-to-Spend

```text
headroom[d] = projected_cash[d] - reserve_floor[d] - uncertainty_buffer[d]
safe_to_spend = max(0, min(headroom[d] within horizon))
```

實作必須考慮支付工具：

- 現金／簽帳卡：新增支出立即降低現金；
- 信用卡：新增支出立即增加負債，並在預估繳款日降低現金；
- 分期：依已確認分期表形成多筆未來義務。

若 coverage 不完整，顯示區間或「目前無法可靠計算」，不可給假精準單值。

### 5.4 Cash Runway

```text
cash_runway_days = 首個 projected_cash[d] < reserve_floor[d] 的日期 - as_of_date
```

沒有破底日則顯示「在目前 90 天 horizon 內未破底」，而不是「永遠安全」。

### 5.5 Debt Service Ratio

```text
debt_service_ratio = 當月已確認債務付款 / 當月可靠收入
```

僅作描述與趨勢，不用單一硬門檻替使用者下授信或財務健康結論。

### 5.6 Fixed Burden Ratio

```text
fixed_burden_ratio
= (必要固定支出 + 債務付款) / 可靠收入
```

它比單純「本月花了多少」更能說明收入有多少在月初就失去自由度。

### 5.7 Forecast Coverage

沿用既有報表 coverage 心智模型：

| 狀態 | 條件 | UI 行為 |
|---|---|---|
| `empty` | 無 opening balance 或無納入帳戶 | 不計算 safe-to-spend，提示下一個必要輸入 |
| `partial` | 有足夠資料看趨勢，但缺卡片、貸款、承諾或 snapshot 過期 | 顯示已知 projection、缺口與 range，不顯示安全綠燈 |
| `unreconciled` | 現金投影與實際 snapshot／轉帳對不上 | 顯示差額與 drilldown，要求對帳 |
| `complete` | 範圍、snapshot、承諾與 reconciliation 均通過當期政策 | 可顯示 safe-to-spend 與正式警示 |

### 5.8 Discretionary Spend Pace

```text
discretionary_spend_pace
= period_discretionary_spend / user_guardrail_amount
```

- `user_guardrail_amount` 是使用者針對日／週／月、整體或分類設定的提醒線，不是系統宣稱的「正確預算」。
- 信用卡消費以交易日計入 pace，不等扣款日；退款與 reversal 必須按原始語意沖回。
- 守門線只能補充 safe-to-spend，不能取代它：即使尚未超過月度守門線，若未來卡費會讓現金破底，仍應警示。
- 未設定守門線時不顯示假造的百分比；可由歷史分布提出 candidate，但需人類確認。

---

## 6. 使用者與 AI 的完整操作流程

### 6.1 首次建檔

使用者可提供：

- 所有銀行、現金、電子錢包、信用卡、貸款與投資帳戶清單；
- 各帳戶目前餘額與 as-of date；
- 最近一期信用卡帳單及目前未出帳交易；
- 貸款契約或官方攤還表；
- 固定收入、房租、保險、訂閱、稅費等週期資料；
- 希望保留的最低現金與警示偏好。

AI operator：

1. 識別來源、帳戶、日期、幣別與官方／暫定狀態。
2. 逐項提出 account profile、snapshot、liability terms、commitment。
3. 每項帶來源、信心度、人話理由與是否需人工確認。
4. 不從本金與利率猜官方月付；有官方 schedule 時以 schedule 為準。
5. 將低信心或語意衝突項目送到統一 review queue。

人類必須確認：

- 帳戶是否完整、哪些納入控制範圍；
- 信用卡結帳／繳款條件與目前應繳；
- 貸款剩餘本金、月付、利率、到期日；
- 固定義務、收入可靠性與 reserve floor。

### 6.2 日常／每週循環

1. 使用者提供銀行餘額或近期明細、信用卡當前交易／未出帳金額。
2. AI 先跑既有交易 Flow A／B，再更新 snapshot 與 commitment occurrences。
3. 系統重算 90 天 projection、safe-to-spend、runway 與 alerts。
4. 人類只審：新帳戶、未知負債、金額大幅偏移、日期衝突、低信心承諾。
5. 審核完成後卡片自動收起，projection 立即更新。

建議操作頻率：

- 信用卡當前交易：每 1-3 天，否則刷卡風險會延遲；
- 銀行 snapshot：每週或大額收支後；
- 正式帳單：每月；
- 貸款與保險契約：條件變更時；
- 月結：每月一次，完成 reconciliation 與報表 review。

### 6.3 警示後的行動循環

每個 alert 需提供：

- 風險發生日；
- 預估最低現金與 reserve 差額；
- 造成差額的主要義務；
- 資料缺口與 freshness；
- 可執行但非命令式的 scenario，例如「減少未承諾支出」「延後計畫購買」「更新缺少的帳戶資料」。

使用者可：

- 查看來源；
- 修正資料；
- 確認已知風險；
- 建立暫定行動方案；
- snooze，但不可刪除歷史警示證據。

### 6.4 月結循環

1. 正式帳單取代 provisional estimate，但不刪除先前來源紀錄。
2. occurrence 與實際交易配對，計算日期／金額 forecast error。
3. 卡費、貸款、轉帳按會計規則處理，避免重複計算。
4. 完成 P&L、Balance Sheet、Cash Flow coverage review。
5. AI 從人類修正與預測誤差提出新規則，不自行提升未確認資料權威。

---

## 7. 目標資料架構

本節保留 decision-layer 的邏輯需求與歷史命名，**不是 canonical DDL**。實作前由 Phase 0 將 account、snapshot、card、liability、commitment 與 reconciliation 全部映射到既有foundation owner；現行責任切分以[`financial-data-core-contract.md`](../contracts/financial-data-core-contract.md)及各storage contracts為準。重複名稱應改成引用或 read model，不得照本文另建同義 tables。

### 7.1 四層資料責任

| 層 | 內容 | 原則 |
|---|---|---|
| Source Facts | 原始來源、交易、帳戶 snapshot、官方帳單、契約 | 不可為了 projection 改寫 |
| Financial Semantics | account role、liability terms、report mapping、commitment templates | AI 可提案，人類確認優先 |
| Derived Projection | occurrences、daily projected balances、metrics、scenario outputs | 可由 facts + policy 重建 |
| Decision Evidence | 修正、規則變更、警示、acknowledgement、scenario decision | append-only 或有 append-only change log |

### 7.2 沿用既有資料

- `transactions`
- `sources` / `transaction_sources`
- `accounts`
- `classification_rules` / `rule_change_log`
- `correction_log`
- `transaction_report_mappings` / `report_mapping_rules`

不得建立另一份平行交易帳本。

### 7.3 與既有 Accounting Plan 共用

- reporting entities；
- account register 語意；
- `balance_snapshots`；
- `transfer_matches`；
- report coverage；
- report-line mapping；
- foundation migration runner。

### 7.4 Foundation-owned 輸入

下列是本計畫需要消費的 logical facts，不由 Financial Control 建表或提供第二套 write API。欄位、authority、review、version、supersession 與 API 以資料基礎 contracts 為準。

#### `liability_profiles`

表達信用卡、循環、信貸、房貸、車貸等負債條件：

- account／entity；
- liability type；
- currency；
- original terms；current principal／statement balance 由 foundation snapshots／statements 擁有；
- APR／interest policy；
- statement close／due policy；
- maturity；
- official／provisional；
- source note、confidence、reviewed。

信用卡與貸款使用 foundation 的 typed contexts，不塞入 opaque JSON 或共用 liability mega-table。

#### `cash_commitments`

未來現金承諾模板：

- kind：income、rent、loan_payment、card_payment、insurance、subscription、tax、planned_purchase、other；
- direction；
- fixed／range／unknown amount model；禁止任意 formula；
- frequency、next due、end date；
- source／autopay account；
- essentiality／priority；
- official／provisional；
- confidence、reason、review state。

#### `commitment_occurrences`

具體到期事件：

- commitment id；
- due date；
- expected amount／range；
- state：forecasted、confirmed、settled、skipped、overdue；
- matched transaction／statement；
- forecast error；
- source watermark。

### 7.5 本計畫新增概念

#### `forecast_policies`

- horizon days；
- reserve floor；
- dependable-income policy；
- uncertainty buffer；
- freshness thresholds；
- included account scope。

#### `spending_guardrails`

- cadence：daily、weekly、monthly；
- scope：all discretionary、category、merchant group；
- amount、warning threshold、effective date；
- user-confirmed／AI-candidate、source note、change evidence；
- 僅產生提醒與 scenario，不直接封鎖付款。

#### `alert_rules` / `alert_events` / `alert_change_log`

- rule：cash below zero、below reserve、large card acceleration、due soon、stale data、commitment mismatch；
- event：trigger date、severity、explanation、projection watermark；
- acknowledgement／snooze／resolved 需有歷史紀錄。

### 7.6 不建議持久化的資料

MVP 的每日 projected balance 與 safe-to-spend 優先由 query deterministic 計算，必要時才用帶 source watermark 的 cache。不能讓舊 forecast cache 變成第二事實來源。

---

## 8. Target Owner Architecture

建議 owner 邊界，不要求在第一個 Phase 一次建立所有檔案：

```text
lib/financial-control/
  coverage.js
  foundation-inputs.js
  forecast.js
  metrics.js
  alert-policy.js

lib/queries/financial-control/
  position.js
  obligations.js
  forecast.js
  alerts.js

app/api/financial-control/
  position/*
  obligations/*
  policies/*
  guardrails/*
  forecast/*
  alerts/*

components/financial-control/
  ControlCenter.jsx
  CashTimeline.jsx
  UpcomingCommitments.jsx
  CoveragePanel.jsx
  LiabilitySummary.jsx
  ScenarioSheet.jsx
```

邊界規則：

- domain calculation 不直接依賴 React 或 HTTP。
- route 只做 parse／validate／respond，SQL 放 query owner。
- UI 不自行重算財務公式。
- 報表與 Control Center 共用 account、snapshot、transfer、liability facts，但各有自己的 query。
- `TransactionTable.jsx` 不因本計畫被一次性拆解；僅透過既有 filter／drilldown 契約連接。

---

## 9. UI／UX Blueprint

### 9.1 Navigation

```text
今日（Control Center）
交易
時間軸
報表
帳戶與負債
規則與學習
```

「今日」是實際工作畫面，不是行銷首頁。

### 9.2 今日／Control Center

第一視窗只回答四件事：

1. **安全可花**：有 complete coverage 才給單值；否則顯示 range／unknown。
2. **下一個風險日**：距離 reserve 破底或現金不足幾天。
3. **未來 7／30 天承諾**：卡費、貸款、房租與其他固定付款。
4. **資料可信度**：最後更新、缺少帳戶、未審項目。

下方才顯示：

- 90 天 daily cash timeline；
- 造成最低點的 Top obligations；
- 本月 discretionary spend pace；
- 守門線剩餘額與超出原因；
- 待審與資料更新 CTA；
- 本月 vs 常態與現有 Top movers。

### 9.3 Cash Timeline

- 折線顯示 projected cash 與 reserve floor。
- 每個 inflow／outflow event 可點開來源。
- official、confirmed、estimated 使用不同視覺語意，不只不同顏色。
- 顯示最差日，不用讓使用者自行尋找圖表低點。
- 可切換 conservative／base scenario，但預設不展示過多模型選項。

### 9.4 帳戶與負債

使用緊密列表或表格，不用裝飾性卡片牆：

- 帳戶最新餘額與 freshness；
- 信用卡 current statement、unbilled、due date、limit；
- 貸款剩餘本金、下一期付款、到期日；
- 缺資料／需確認狀態；
- 直接更新 snapshot 或開啟來源。

### 9.5 Mobile

手機首頁優先順序：

1. 安全可花／目前無法計算；
2. 下一個風險日；
3. 7 天內付款；
4. 更新資料／處理待審；
5. 簡化 timeline。

不在手機首屏塞完整會計報表；報表保留摘要與 drilldown。

### 9.6 Alert UX

- 警示不是 toast-only；必須有持久 inbox／timeline 紀錄。
- Severity 由現金差額、時間距離、資料可信度共同決定。
- stale-data alert 與 overspend alert 必須明確區分。
- 同一根因的 alert 需 dedupe／cooldown，避免每次重算重複轟炸。
- 不用「你又亂花錢」等羞辱式文案。

---

## 10. 分階段實作計畫

> 本文件的 Phase 編號只描述Financial Control工作；現行reporting與foundation責任分別由active contracts及既有code擁有。共用schema／API時，由較早落地的owner建立，後續不得重建平行表。

### Phase 0：Outcome Contracts、Metric Dictionary、Demo Fixtures

**Execution status：Completed as a reference package on 2026-07-15；owner financial policies intentionally deferred to their runtime consumers。**

#### Goal Contribution

- G1-G8：建立共用語意與可驗證樣本。

#### Deliverables

- `docs/contracts/financial-position-contract.md`
- `docs/contracts/commitment-and-liability-contract.md`
- `docs/contracts/cash-forecast-contract.md`
- `docs/contracts/financial-alert-contract.md`
- metric dictionary：每個指標的 numerator、denominator、as-of、coverage、unknown policy。
- anonymized fixtures：銀行、兩張卡、信貸、薪資、房租、訂閱、缺資料與風險情境。
- 引用並驗證 foundation migration／rollback／newer-version evidence；本計畫不另做 migration ledger 決策。
- 將既有reporting contracts與實作之間的「規格／已實作」狀態標記清楚。

#### Invariants And Boundaries

- 不新增正式 UI。
- 不碰真實 DB。
- 不先硬編 safe-to-spend threshold。
- 不把 readiness preview 說成正式資產負債表／現金流量表。

#### Outcome Evidence

- 同一 fixture 能算出明確的 90 天最低現金、card due、loan due 與 coverage expectation。
- 每個 Goal ID 都映射到 requirement、Phase 與 acceptance example。
- 所有測試 DB 使用 `FINANCE_DB_PATH` 隔離路徑。

#### 2026-07-15 Execution Record

- Contracts：`docs/contracts/financial-position-contract.md`、`commitment-and-liability-contract.md`、`cash-forecast-contract.md`、`financial-alert-contract.md`。
- Metrics：`docs/planning/FINANCIAL-CONTROL-METRIC-DICTIONARY.md`。
- Synthetic fixture：`test/fixtures/financial-control/post-style-pressure.json`，涵蓋兩銀行、兩卡、貸款、薪資、房租、訂閱、保險、不確定收入、stale card與unknown commitment。
- Pure projector：`lib/finance/control/project-cash-timeline.js`；duplicate、loan component sum、uncertain income exclusion、coverage degradation、reserve breach、runway與safe-to-spend gate都有test。
- Fixed fixture result：coverage=`partial`、最低現金TWD minor `5800000`（2026-08-20）、首次reserve breach 2026-08-05、runway 21日、safe-to-spend=`null`。
- Boundary：尚無DB adapter、API、UI或forecast persistence；不得對外宣稱runtime forecast可用。

### Phase 1：Trusted Financial Position

#### Goal Contribution

- G1、G5、G8。

#### Deliverables

- foundation position adapter：entity、scope attestation、accounts、balances、cards、liabilities、investments。
- Control-specific position／coverage read model；不新增 canonical account／snapshot／liability tables。
- 帳戶與負債缺口導向 foundation Data Center，Control Center 不複製 CRUD UI。
- 正式 Balance Sheet query 的最小版本，沿用既有 coverage contract。
- Skill 新增 financial-control preflight；補 account／snapshot／liability 仍走 foundation workflow。

#### Invariants And Boundaries

- transaction running balance 只能當 hint，不能替代官方／人工 snapshot。
- 推測 account kind 必須 reviewable。
- 混合幣別不產生未定義合併總額。

#### Outcome Evidence

- 使用者可看到所有納入帳戶、最新餘額、信用卡／貸款負債與 freshness。
- 缺一張信用卡時，Balance Sheet 與 Control coverage 皆為 partial。
- 資產 = 負債 + 淨值檢查可 drill down。

### Phase 2：Commitment Calendar And Card／Loan Lifecycle

#### Goal Contribution

- G2、G5、G6、G8。

#### Deliverables

- foundation obligations adapter：commitments/occurrences、card statement/unbilled/due/installments、loan schedules/allocations。
- projection event normalization，只產生可由 foundation facts + policy 重建的 derived events。
- upcoming 7／30／90-day obligations API 與 review queue。
- Skill 的契約解析、承諾更新與人類確認引用 foundation workflow；本計畫只增加 forecast usage。

#### Invariants And Boundaries

- 歷史固定底盤不可直接轉成 confirmed commitment。
- AI 可由歷史提出 candidate，但需人類或官方來源確認。
- 卡費 settlement 不重複成 expense。

#### Outcome Evidence

- 新增信用卡消費後，負債立即上升且預估卡費在 due date 出現。
- 貸款每期本金／利息正確進入 Balance Sheet、P&L 與 future cash event。
- 修改 recurring due date 後，舊值保留在 change log，未來 occurrence 重建。

### Phase 3：Deterministic 90-Day Cash Forecast

#### Goal Contribution

- G3、G5、G8。

#### Deliverables

- pure domain forecast engine。
- daily projected cash、minimum cash、risk date、headroom。
- conservative／base scenario policies。
- source watermark 與 deterministic cache policy。
- `/api/financial-control/forecast`。
- direct-method cash flow所需 transfer matching／reconciliation 只消費 foundation owner；缺 owner 時本 Phase blocked，不自行補表。

#### Invariants And Boundaries

- UI 不重算公式。
- 未確認收入不能在 conservative scenario 救回破底。
- one-sided transfer 不可被靜默當作消費或收入。

#### Outcome Evidence

- 固定 fixture 在任意重跑得到相同每日 projection。
- 新增 NT$10,000 卡費時，payment instrument timing 正確影響最低現金點。
- 缺 opening snapshot 時 API 明確回 `empty`，不是回 0。
- 期末實際 snapshot 可計算 reconciliation delta。

### Phase 4：Control Center、Safe-to-Spend、Alerts

#### Goal Contribution

- PG-1、G4、G5、G6。

#### Deliverables

- 今日 Control Center。
- safe-to-spend、cash runway、7／30 日義務、fixed burden、discretionary spend pace。
- 使用者可設定日／週／月整體或分類守門線；AI 只能提出 candidate。
- Cash Timeline 與最低點 explanation。
- alert rules、persistent alert inbox、ack／snooze／resolved history。
- review completion 後自動重算與收起。
- desktop、mobile、empty、partial、unreconciled、complete、error evidence。

#### Invariants And Boundaries

- partial coverage 不顯示精確安全綠燈。
- alert 必須可追到 source events。
- toast 只用於操作回饋，不承擔持久風險通知。
- 不做背景銀行同步；資料 stale 時直接告知。

#### Outcome Evidence

- 貼文式情境可在卡費扣款前至少 7 天顯示風險，前提是資料按 freshness policy 更新。
- 使用者修正一筆卡費或收入後，risk date／safe-to-spend 即時一致更新。
- 同一根因不產生重複 alert storm。
- 手機可在不開完整報表下完成「看風險 → 看原因 → 更新資料／處理待審」。

### Phase 5：Accounting Closure And Month-End Reconciliation

#### Goal Contribution

- G5、G8。

#### Deliverables

- 完成active contracts中尚未落地的 Balance Sheet 與 Cash Flow。
- 消費 foundation transfer matches 與 beginning／ending cash facts，完成 report reconciliation projection。
- report review queue 與 control alert 共用 blocker references。
- 月結 occurrence settlement 與 forecast accuracy。
- P&L、Balance Sheet、Cash Flow、Control Center 的 cross-report consistency tests。

#### Invariants And Boundaries

- 不因 Control Center 需要速度而繞過 accounting mappings。
- 不把 cash-flow settlement 改名成 expense。
- partial／unreconciled 一律可見。

#### Outcome Evidence

- Card charge、card payment、loan principal、interest、internal transfer 在四個 surface 不重複且可追溯。
- opening cash + cash flows = ending cash，否則明確 unreconciled。
- 月結後 forecast error 與 coverage 可計算。

### Phase 6：Adaptive Learning And Scenario Decisions

#### Goal Contribution

- G6、G7。

#### Deliverables

- 從 settled occurrence 學習 recurring amount／date range。
- forecast error attribution：資料晚到、金額變動、漏帳戶、規則錯誤。
- scenario：減少 discretionary spend、延後 planned purchase、收入延遲、調整 reserve。
- 個人化但可解釋的 alert threshold candidates。
- Skill 新增「分析風險但不越權替使用者做決策」契約。

#### Invariants And Boundaries

- AI 不可從單次異常建立高權威 recurring rule。
- scenario 不直接改 source facts；採用方案需形成明確 policy／commitment change。
- 不提供保證性投資、借貸或債務協商建議。

#### Outcome Evidence

- 連續三期穩定帳單可提出候選範圍；人類確認後才成為 commitment。
- 預測誤差可被歸因且次月改善，不只顯示一個平均準確率。
- scenario before／after 使用同一 source watermark，可重現差異。

---

## 11. Acceptance Scenarios

### A1：貼文式貸款 + 卡費壓力

- **Given** 使用者有薪資帳戶、NT$1,500,000 聯合信貸與官方 7 年還款表，每月約 NT$20,000 自動扣款
- **And** 使用者有兩張信用卡與當前未出帳消費
- **And** 銀行帳戶目前看起來仍有錢
- **When** 系統建立 90 天 projection
- **Then** loan due、card due 與必要支出皆出現在具體日期
- **And** 顯示最低現金點、reserve 差額與首個風險日
- **And** 新刷卡會在扣款前降低 safe-to-spend

### A2：刷卡不應等到扣款才算

- **Given** 使用者新增 NT$10,000 信用卡消費
- **When** 交易匯入
- **Then** P&L 支出與信用卡負債立即增加
- **And** 現金仍不變
- **And** 預估 payment occurrence 出現在對應 due date
- **And** 實際繳卡費時不重複計入支出

### A3：資料過期

- **Given** 信用卡當前交易已 10 天未更新
- **When** 使用者開啟今日頁
- **Then** coverage 為 partial
- **And** safe-to-spend 顯示 range 或 unavailable
- **And** UI 指出需更新哪張卡，不把風險誤寫成已安全

### A4：可靠收入與不確定收入

- **Given** 月薪已確認，另有一筆尚未確定的自由工作收入
- **When** conservative forecast 計算
- **Then** 月薪可列 dependable inflow
- **And** 未確認案款不得消除現金破底警示

### A5：貸款拆分

- **Given** 本期付款含本金 NT$19,000、利息 NT$1,000
- **Then** cash forecast 減少 NT$20,000
- **And** P&L 只認列 NT$1,000 利息
- **And** Balance Sheet 負債減少 NT$19,000

### A6：帳戶漏匯

- **Given** 銀行轉出 NT$50,000 但收款自有帳戶未納入
- **Then** transfer 保持 unmatched
- **And** cash flow／forecast coverage 不得 complete
- **And** 人類可確認外部支出或補上另一帳戶

### A7：人類修正承諾

- **Given** AI 將年繳保費誤判為月繳
- **When** 人類修正 frequency
- **Then** change evidence append-only
- **And** 未來 occurrences 重建
- **And** 已結清歷史交易不被竄改

### A8：完整使用者控制

- **Given** 所有納入帳戶 snapshot 新鮮、義務已審、轉帳已對帳
- **When** 使用者查看今日頁
- **Then** coverage complete
- **And** safe-to-spend、runway、timeline、P&L、Balance Sheet、Cash Flow 使用相容的同一組財務事實

### A9：花到守門線即提醒

- **Given** 使用者設定每月非必要支出守門線 NT$15,000，80% 時先提醒
- **And** 本月刷卡非必要支出在交易日累計達 NT$12,000
- **When** 最新交易匯入並完成分類
- **Then** 系統建立可追溯的 pace alert
- **And** 顯示目前累計、守門線、剩餘額與主要支出來源
- **And** 若 safe-to-spend 已因未來卡費破底，風險警示優先於「尚有 NT$3,000 額度」的守門線訊息

---

## 12. KPI Framework

KPI 不只量「使用者有沒有打開 App」，而要證明它真的提早揭露風險並降低維護負擔。

### North Star

**可行動預警覆蓋率**：實際造成 reserve 破底或付款失敗的事件中，有多少在至少 N 天前被有效揭露，且當時 coverage 足以採取行動。

### Outcome KPIs

| KPI | 定義 | 初期目標方向 |
|---|---|---|
| Early-warning lead time | 實際風險日 - 首次有效警示日 | 越早越好，但同時控制 false positive |
| Surprise shortfall count | 未曾被預警的現金不足次數 | 趨近 0 |
| 7-day balance forecast error | 7 日前預估餘額與實際 snapshot 的絕對差 | 逐月下降 |
| Obligation match rate | 已到期 occurrence 成功配對實際交易比例 | 逐月上升 |
| Safe-to-spend availability | 有 complete coverage 的活躍日比例 | 上升，但不可用放寬 coverage 造假 |

### Quality Guardrails

- false alert rate；
- stale-data days；
- missing required account count；
- unreconciled delta；
- AI proposal override rate；
- 人類每週 review 分鐘數；
- 高風險欄位未審數。

### Learning KPIs

- recurring candidate confirmation rate；
- recurring amount／date prediction error；
- merchant rule applied／overridden；
- forecast error attribution coverage；
- 人類修正後下一期相同錯誤重發率。

禁止用單一「財務健康分數」掩蓋指標定義與資料缺口。

---

## 13. Goal-To-Plan Traceability

| Goal ID | Requirement | Owner／Phase | Evidence |
|---|---|---|---|
| PG-1 | 扣款前呈現風險、原因與行動 | P3-P4 | A1、early-warning lead time、mobile flow evidence |
| G1 | 帳戶、snapshot、負債位置 | P1 | A6、Balance Sheet coverage、freshness tests |
| G2 | 未來承諾與 occurrence | P2 | A1、A2、A5、recurrence tests |
| G3 | 90 天 deterministic forecast | P3 | A3、A4、golden projection fixtures |
| G4 | safe-to-spend、runway、spending guardrails、alerts | P4 | A1、A3、A9、alert dedupe／coverage tests |
| G5 | partial／unreconciled 誠實呈現 | 全 Phase | A3、A6、coverage contract tests |
| G6 | 人類 + AI 操作閉環 | P1-P4 | Skill eval、review completion browser evidence |
| G7 | 從誤差與修正學習 | P6 | A7、next-period repeat-error KPI |
| G8 | 跨報表同一事實 | P1、P3、P5 | A2、A5、A8、cross-report consistency tests |

---

## 14. 主要決策與衝突裁決

### D1：先做預算還是先做承諾／預測

**裁決：先承諾與預測。** 月預算只能說本月花費速度，不能處理卡費扣款日、貸款死線與收入到帳時間。預算 pace 在 Phase 4 作為次級 guardrail。

### D2：Safe-to-spend 是否永遠顯示

**裁決：否。** Coverage partial 時顯示 range／unknown 與缺口。可信度比總有一個漂亮數字重要。

### D3：歷史固定支出是否自動變未來承諾

**裁決：只能形成 candidate。** 官方帳單、契約或人類確認後才是 confirmed commitment。

### D4：是否先做銀行 API 串接

**裁決：否。** MVP 延續外部 AI + 本地 API；先證明資料模型與控制價值。Bank connector 是後續 adapter，不得污染核心。

### D5：Forecast 是否持久化每日結果

**裁決：先 deterministic query，必要時 watermark cache。** 避免衍生資料成為第二事實來源。

### D6：是否給統一債務健康門檻

**裁決：不硬編唯一標準。** 顯示 ratio、趨勢、使用者 policy 與資料來源；若日後採地區性指引，需版本化並說明適用範圍。

### D7：帳務報表與控制中心是否分開建資料

**裁決：不分開建事實。** 共用 account、snapshot、liability、transfer、mapping；query 與呈現可分 owner。

### D8：直接自動替使用者採取財務行動

**裁決：不做。** 系統提供 scenario 與提醒；付款、借貸、投資或債務協商仍由人類決定。

---

## 15. 風險與 Spike

### SPIKE 1：信用卡 due-date 模型

- 需驗證跨銀行的結帳日、繳款日、假日順延、分期與退款。
- fallback：官方帳單 due date 優先；未出帳只給 range／estimated。
- Blocks：Phase 2 完整信用卡 projection。

### SPIKE 2：Recurring Detection

- 需驗證固定金額、浮動帳單、年繳、月末日期與商家名稱漂移。
- fallback：只產生 candidate，不自動 confirmed。
- Blocks：Phase 6 自動學習；不阻擋手動 commitment。

### SPIKE 3：Payment-Instrument Safe-to-Spend

- 需用 cash、debit、不同 card cycle、installment fixture 驗證新增支出的最差現金影響。
- fallback：先提供 conservative headline，不提供 payment-method comparison。
- Blocks：Phase 4 單值 safe-to-spend。

### SPIKE 4：Forecast Performance

- 以 100k transactions、1k occurrences、365 日 horizon benchmark SQLite query。
- fallback：按 source watermark cache projection。
- Blocks：公開效能主張，不阻擋小型個人資料 MVP。

### SPIKE 5：資料新鮮度實務

- 驗證使用者實際可取得的銀行／信用卡當前明細格式。
- fallback：手動輸入 current balance／unbilled total 並附 source note。
- Blocks：貼文式「扣款前預警」可靠性。

---

## 16. Master Definition Of Done

只有同時滿足以下條件，才能稱為「完整財務掌控第一版」：

1. 使用者可建立完整的帳戶、信用卡、貸款、snapshot 與未來承諾範圍。
2. 新刷卡會立刻影響負債與 safe-to-spend，不等實際扣款。
3. 90 天 projection 能指出最低現金點與首個 reserve 破底日。
4. Coverage 不完整時不顯示假精準安全數字。
5. Alert 可追溯、可處理、可去重並保留歷史。
6. P&L、Balance Sheet、Cash Flow 與 Control Center 不重複計算卡費、貸款或轉帳。
7. 外部 AI Skill 能只靠自身契約完成 onboarding、更新、review 與月結寫入。
8. 人類修正會形成 evidence，下一期相同錯誤率可量測。
9. Desktop／mobile 的核心流程都有 demo DB 瀏覽器證據。
10. 所有 release gate、privacy scan、隔離 DB 與真實資料保護持續通過。
11. 至少一個貼文式 fixture 證明系統能在現金短缺前提早發現問題。
12. 使用者每週維護成本、false alert 與 forecast error 有可觀測 KPI，而非只宣稱「AI 更聰明」。
13. 使用者可設定消費守門線，且守門線訊息不會掩蓋更嚴重的現金破底風險。

---

## 17. Execution Readiness Verdict

### Verdict：Phase 0 reference complete；runtime plan queued behind Foundation Business-Flow Closure

財務資料基礎Phase 0-7與本計畫Phase 0 reference已完成。Owner已確認Control Center是下一階段，但目前先收斂AI輸入→typed commit→UI確認／少量修正的foundation業務閉環；因此Phase 1-6不是current execution。Reserve、reliable income與進階policy到真正consumer需要時再決定。Pure projector不能直接接UI冒充真實forecast，也不得重建canonical account／balance／card／liability／commitment schema。

### Foundation closure後的第一個runtime切片

只有owner明確確認foundation flow已滿意後才執行。不要先做首頁UI：

1. 先記錄Foundation Business-Flow Closure的owner acceptance與仍存在的known gaps。
2. 依`financial-position-contract.md`建立foundation position adapter與coverage read model；request使用explicit currency／TWD simple default，不先建立全域偏好系統。
3. 以synthetic DB fixture證明assets、liabilities、net position、scope／freshness／reconciliation降級。
4. 與Phase 2 commitment timeline的event contract對接，但不先做safe-to-spend、reserve或income policy。
5. 只有read model責任證明需要persistence後，才另立migration contract與rollback evidence；reserve／reliable income留到Phase 3／4。

下一個執行 agent 必須先回答：

> 此切片改善哪個 Goal ID？保留哪些 domain invariants？哪個使用者可見結果證明成功？哪些 non-goals 阻止 scope expansion？

回答不出來時，停止實作並回到本計畫修正。

---

## 18. 參考框架

- CFPB, [Financial well-being scale user guide](https://files.consumerfinance.gov/f/201512_cfpb_financial-well-being-user-guide-scale.pdf)：產品結果不只是一個帳戶餘額，也包含日常控制、承受衝擊、目標進度與選擇自由；本計畫將其轉成可觀測產品能力，但不直接複製成單一健康分數。
- Last Say [`reports-phase1-implementation-contract.md`](../contracts/reports-phase1-implementation-contract.md)、[`balance-sheet-contract.md`](../contracts/balance-sheet-contract.md)、[`cash-flow-contract.md`](../contracts/cash-flow-contract.md)與[`report-coverage-contract.md`](../contracts/report-coverage-contract.md)：現行statement、transfer、coverage與presentation語意。
- Last Say [Operator Skill](../../.claude/skills/last-say-ops/SKILL.md)：外部 AI 與人類審核的現有操作契約。
