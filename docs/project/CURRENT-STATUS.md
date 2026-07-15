# Current Status

用途：提供截至 2026-07-15 的專案快照，區分「完成的財務資料基礎」、「剛完成的穩定化／Control Phase 0 reference slice」與「仍待正式 runtime 實作的財務控制能力」。

Last validated against repository: 2026-07-15

## 結論

**Confirmed：財務資料基礎Phase 0–7 release line已完成，並在2026-07-14通過release acceptance。** 證據是`e28f8af`至`4a4ac68`的能力提交、schema v6 migrations、active storage／operator contracts與release verification。這包含typed schema、migration、ingestion、cards／liabilities／commitments、investment valuation、reconciliation／review、analysis contexts、operator skill與backup／restore。

**Confirmed：2026-07-15 完成一輪 correctness／operability stabilization 與 Financial Control Phase 0 reference slice。** JPY money bug、account/investment UI gap、static report preview、PORT漂移、browser E2E與backup health check已處理；四份Control contracts、metric dictionary、synthetic pressure fixture與pure 90-day cash-timeline projector已存在。

**Confirmed：整體產品仍未完成。** 正式 trusted financial position、Balance Sheet／Cash Flow、foundation-to-forecast adapter/API/UI、safe-to-spend與alerts仍是主要缺口。Pure synthetic projector不是使用者財務結論。

## Owner-confirmed execution direction（2026-07-15）

- **Current stage：** 繼續收斂資料基礎建設的實際業務流程。Foundation Phase 0–7完成代表技術基線存在，不代表AI輸入→typed commit→UI確認／少量修正已在真實使用中永久封版。
- **Operating model：** AI是主要輸入方式；UI只負責確認、歧義、高風險授權與少量修正，不追求full CRUD admin。
- **Next stage：** Financial Control Center，且必須圍繞／消費既有foundation展開，不得重建canonical facts。
- **Deferred：** reserve、reliable income與其他進階財務policy到實際control／forecast phase再決定；目前不以它們阻擋foundation工作。
- **Simplicity rule：** 核心業務邏輯尚未跑順並獲owner滿意前，沿用簡單local-first defaults，只處理真實流程阻礙與correctness，不提前平台化或大規模優化。

## 目前版本與基線

| 項目 | 狀態 |
|---|---|
| Audit baseline | 本輪開始時`main`／`origin/main`為`4a4ac68`（`feat: complete financial data foundation release`）；本文件描述該baseline之後的盤點與stabilization delivery，實際branch／commit以Git為準 |
| package version | `0.2.3` |
| schema | version 6，checksummed migrations `0001`–`0006`；本輪未改schema/migration |
| runtime | Node >=22.5、Next.js 15、React 19、SQLite |
| app/API | 8 app pages；78 route files，其中57個`/api/finance` route files |
| automated tests | 47個`.test.js`檔 + 1個Chromium E2E spec；最終結果見audit report |
| CodeGraph | 本輪定稿時在專案根目錄重跑；最終數量見audit validation record |
| documentation | `Final-Long-Term-Goal.md`與`docs/README.md`為唯一正式冷啟動入口；active ADR／contract／runbook留在工作樹，被取代的舊文件已在有效內容吸收後移除，歷史追溯使用Git |

數量是盤點快照，不是產品 KPI；新增檔案後會自然改變。

## 最近已完成的主線

Financial Data Foundation Git歷史依能力相依順序落地：

1. `e28f8af` — shared kernel。
2. `d078db8` — atomic ingestion／balances。
3. `bf79442` — typed debt／commitments。
4. `20d75cb` — deterministic investment valuation。
5. `f692956` — cross-context reconciliation。
6. `31a926b` — governed analysis contexts。
7. `4a4ac68` — complete financial data foundation release。

本輪實作範圍與驗證ledger見[`../plans/active-stabilization-and-control-phase0-plan.md`](../plans/active-stabilization-and-control-phase0-plan.md)。

## 能力完成度

### 已完成且可由測試支持

- legacy transaction import／review／correction／classification learning。
- management P&L、report mappings、coverage。
- shared kernel與account／source／scope identity。
- typed preview、staging、atomic commit、idempotency與confirmed reversal。
- balance snapshots、cards、liabilities、loan schedules、commitments。
- investments、market／FX quotes、valuation、valued items。
- transfers、source conflicts、review tasks、identity redirects／merge。
- 8 readiness goals、7 governed analysis datasets。
- 完整canonical account-kind/currency create UI，以及bounded manual instrument／holding／quote／FX UI。
- currency-aware UI money presentation；JPY 0位與兩位小數幣別共用canonical exponent。
- Balance Sheet／Cash Flow的honest unavailable state；不再顯示static readiness claims。
- high-risk browser confirmation、backup／restore、唯讀backup health/freshness check。
- isolated Chromium critical E2E，納入local／CI／release gate。
- Financial Control Phase 0 contracts、metric dictionary、synthetic fixture與pure reference projector。

### 部分完成

- Data Center已能建立所有canonical account kinds與人工投資估值資料；正式statement／schedule／trade／source lifecycle仍以external AI/API為主。
- runtime smoke與critical Chromium E2E都存在；尚未涵蓋所有高風險流程、mobile journey與長時間併發。
- management reporting有P&L；Balance Sheet／Cash Flow正式query仍未實作。
- security對localhost使用情境有安全標頭與高風險確認；一般API沒有auth，不能安全假設可對外網路暴露。

### 尚未開始或只有plan／draft contract

- trusted financial-position read model／API與formal Balance Sheet presentation。
- foundation facts → deterministic 90-day forecast的正式adapter／API／UI。
- owner-approved reserve、dependable-income、freshness與uncertainty policies；已明確延後到相關control phase，不是目前foundation blocker。
- safe-to-spend、alert lifecycle與scenario comparison。
- formal Cash Flow與accounting closure。
- centralized logging、monitoring、alerting、deployment／rollback automation。

## 最近plan的正確讀法

### Foundation Phase 0–7 release line

- **Current truth：Completed and validated。** `e28f8af`至`4a4ac68`、schema v6、active foundation contracts及release verifier共同支持此結論。
- **仍延後：** formal Balance Sheet／Cash Flow、forecast／safe-to-spend等downstream能力。
- 舊規劃內容已自working tree移除；需要重建phase決策脈絡時才查Git history，不把歷史baseline當成目前現況。

### Master Financial Control Plan

- **Current truth：Phase 0 reference artifacts implemented and verified；Control Center已被owner確認為下一階段，但排在foundation業務流程收斂之後；Phase 1–6 runtime implementation尚未開始。**
- Phase 0已建立contracts、metric dictionary、synthetic fixture與pure timeline；reserve、dependable-income、freshness與alert policy保留為後續phase decisions，不要求現在回答。
- Phase 1–6依序涵蓋trusted position／formal BS、commitment calendar、forecast、control center、Cash Flow、learning／scenarios。

### Reporting implementation reality

- **Current truth：** Management P&L、mapping與coverage已完成，typed foundation與versioned migrations已存在；現行語意由active reporting contracts、code與tests擁有。
- Formal Balance Sheet／Cash Flow仍未完成；report tabs現在誠實標示unavailable，不代表statement已實作。

## 目前最重要的風險

1. **P1 product gap：** 使用者已有多資產／負債事實與reference projection semantics，但缺乏正式trusted position、forecast與風險控制輸出。
2. **P1 scope／security：** 一般API依賴localhost trust，若改成LAN／remote exposure會立即需要auth、CSRF與threat model。
3. **Current acceptance gap：** AI主輸入／UI確認是刻意產品模式；尚缺的是完整來源在實際使用中的流程順暢度與owner acceptance evidence，不是所有resource的CRUD UI。
4. **P2 maintainability：** `TransactionTable.jsx`、`Overview.jsx`、`lib/queries/transactions.js`、`lib/queries/finance/obligations.js`等責任集中且變更半徑大。
5. **P2 operations：** backup可檢查freshness，但owner尚未核准RPO／RTO／retention，也沒有production service definition、graceful shutdown或central observability。

完整分級與證據見[`../planning/GAPS-RISKS-AND-DEBT.md`](../planning/GAPS-RISKS-AND-DEBT.md)。

## 下一個合理關卡

**Current gate：** 以AI operator為主要入口，逐步確認各類來源能完成capabilities／inventory／readiness → typed preview／commit → UI確認／少量修正 → reconciliation／analysis的完整閉環；發現真實阻礙就修正，直到owner對foundation業務邏輯滿意。

**After that：** 才進入Financial Control Center，先用既有foundation建立trusted position與obligation timeline。Reserve／reliable income等policy到forecast或safe-to-spend真正需要時再決定；不要現在為它們擴充架構，也不要把Phase 0 synthetic projector直接接成使用者財務結論。

更新觸發：release、schema、主要plan phase、驗證基線、重大風險或產品能力狀態改變時更新。
