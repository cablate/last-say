---
schema_version: behavior-contract/v1
id: dashboard.financial-overview
title: 財務儀表板與近期基準
status: active
owner_surface: dashboard
change_context:
  type: feature
  reason: 將既有即時財務 facts 收束成使用者每天能讀懂、也能帶去諮詢核對的單一儀表板。
  non_goals:
    - 不修改交易明細、分類、確認或匯入行為。
    - 不把 AI 生成的判斷或本人的特定數字硬寫進前端。
    - 不猜測未建檔的貸款月付、剩餘期數或必要生活費。
---

# 財務儀表板呈現契約

Last validated: 2026-07-21

## Purpose

本契約限定 `/control`、`/` 與三張 `/reports` 財務報表的呈現範圍。目標是讓不熟悉財務術語的人先看懂目前資產、負債、現金、本月收支與尚未能判斷的風險，也能在財務諮詢時讓對方快速核對數字、期間、來源與資料缺口；既有交易明細與資料管理流程仍是唯一修正入口。

## Behavior Boundary

### In scope

- 重整儀表板的資訊層級、文字、版面與響應式呈現。
- 重整共用頁首與側欄，使日常入口集中在總覽、收支、資產與負債、投資、交易。
- 以現有 server read models 即時組合第一屏摘要：
  - `/api/finance/control/monthly-pulse`
  - `/api/finance/control/financial-health`
  - `/api/finance/control/spending-structure`
- 將資料缺口轉成一般使用者看得懂、可前往處理的待辦。
- 讓資料中心可由 URL 直接開啟投資、負債等既有分頁。
- 讓損益表、資產負債表與現金流量表使用一般人可理解的中文名稱，並保留來源日期與 drillback。
- 當查詢月份尚未結束時，資產負債表的預設截止日與現金流量表的預設期間終點都不得晚於今天。
- 將系統計算出的權益列明確呈現為「淨資產（資產扣除負債）」，不得顯示內部代號或未命名項目。
- 在 `/control` 顯示最近六個「已結束月份」的已確認收入、支出、損益與現金增減平均；若選擇歷史月份，該月份可納入，當月尚未結束時不得混入平均。
- 在 `/control` 分開呈現「已建檔固定生活義務」、「已知債務月付」與「完整每月生存線」。任一必要組成未知時，完整生存線必須保持未知。
- 在 `/control` 以同一張負債表列出目前餘額、利率、下一筆月付與剩餘排程；缺值逐欄顯示，不得隱藏整列。
- 在 `/control` 同時呈現投資市值占淨資產比例、明示槓桿情境曝險與跌幅壓力。

### Out of scope / protected behavior

- 不修改 `components/TransactionTable.jsx` 的確認、分類、單筆編輯、批次修正或搜尋行為。
- 不修改交易、分類、確認或匯入 API。
- 不修改資料庫 schema、migration、既有資料或任何寫入規則。
- 不在前端重新建立財務真相來源；儀表板只呈現與少量組合既有 read-model facts。
- 不因缺資料而顯示 `0`、正常或安全；未知必須明確顯示為未知／尚無法計算。
- 不把這一版擴張成完整投資建議、現金安全線或 AI 諮詢報告。
- 不為了讓報表看起來完整而猜測期初餘額、貸款本金／利息拆分或待分類交易。

## Consumers And Entrypoints

- Browser route：`/control?month=YYYY-MM`。
- Client presenter：`components/financial-control/FinancialDashboard.jsx`。
- Server read models：`monthly-pulse`、`financial-health`、`spending-structure`、`history`。
- API：`/api/finance/control/monthly-pulse`、`/financial-health`、`/spending-structure`、`/history`。
- Pure presentation helpers：`lib/finance/control/dashboard-presentation.js`。
- Durable data owners：transactions、account balance snapshots、liability profiles / schedules、commitments、investment holdings / quotes；DOM 與 client state 都不是真相來源。

## Inputs and outputs

### Inputs

- URL：`month`、`entity_id`、`currency`；可選的 `taiwan_instrument_keys`、`taiwan_leverage_factor` 只作為本次查詢的明示曝險情境。
- 月度管理損益與現金變動。
- 指定日期的資產、負債、現金、投資與 coverage。
- 月度支出、報銷 proposal 與已確認固定義務。
- 以選定月份為界的最近六個完整月份；每月數字由同一份 Monthly Financial Pulse read model 重算。

### Outputs

- 一句目前狀況與一行必要限制。
- 四個第一層數字：淨資產、現金與活存、確認負債、投資市值。
- 四個第二層區塊：本月收支、待處理、資產與負債、投資風險。
- 近期基準：六個完整月份的已確認收入、支出、損益與帳面現金增減平均，以及實際納入月份數。
- 負債明細：目前餘額、APR、下一筆已建檔還款、剩餘排程筆數與缺口。
- 連往現有報表、交易明細、資料確認與資料中心的 drillback。

### Side effects

- 讀取四個 control APIs；不寫入 DB、不寫 local storage、不建立背景排程。
- 收到 `last-say:data-changed` 時重新查詢所有 dashboard read models。
- 點擊 drillback 或套用明示投資情境，只改變 URL 與查詢，不改變任何財務資料。

## UI States

- First paint / loading：保留穩定骨架高度，避免主要區塊跳動。
- Ready：先顯示淨資產、現金、負債與投資，再顯示每月收支、負債、投資風險及最多三項待辦。
- Partial：已知金額照常顯示，區塊旁同時標示「資料不完整」或具體缺欄；不得用 0 取代未知。
- Empty：顯示缺少哪種資料及既有資料中心入口，不生成範例數字。
- Error：保留其他成功回應，集中顯示可重試提示；重新整理會重抓四個 read models。
- Responsive：小螢幕單欄；負債資料以可讀的 stacked rows 呈現，不依賴整頁水平捲動。
- Teardown：hook abort 尚未完成的 fetch，舊回應不得覆蓋新月份。

## Invariants

1. 所有金額在每次查詢時由目前資料重新取得，不保存前端計算結果。
2. 每月固定義務只加總同幣別、`monthly`、`fixed` 且已有明確金額的 confirmed commitments；貸款排程不完整時必須標示「不是全部」。
3. 投資曝險或壓力測試為 `null` 時顯示「尚無法計算」，不得轉成 `0`。
4. 月度 read model coverage 不完整時，已知數字仍可呈現，但畫面必須同時揭露主要缺口。
5. 儀表板的任何連結不得改變交易編輯契約；進入 `/transactions` 後沿用原本 URL 篩選與 editor。
6. 桌面與手機版都不得產生水平頁面捲動；互動控制需可用鍵盤操作並保留可見 focus。
7. 當月資產負債表的預設 `as_of_date` 為「月份月底與今天兩者較早者」；歷史月份仍使用該月月底，明確指定日期則尊重指定值。
8. 使用者可見文字不得直接顯示 `derived_net_worth`、`Derived net worth`、內部 enum 或無意義的「未命名」標籤；內部識別碼僅能收在可展開的來源證據中。
9. 報表 coverage 不完整時，必須同時顯示已知數字與缺口，不得把未知期初現金或對帳差額顯示成 `0`。
10. 槓桿倍率不得從部位名稱偷偷寫成 canonical fact；儀表板只能把 URL 中明示的工具 key 與倍率傳給 Financial Health read model，並在畫面標示為「此頁情境」。
11. 「近六月平均」只平均畫面明列的月份與非 null facts；必須回傳樣本數與 coverage，且不得稱為「可靠收入」或「必要支出」。
12. 當選定月份尚未結束時，畫面須標示「截至 YYYY-MM-DD」，且該月不得納入完整月份平均。
13. 完整每月生存線只有在固定義務、債務月付與必要生活支出都已知時才可顯示精確值；本版沒有必要生活支出 policy，因此保持未知。
14. 負債表中的餘額、利率、月付與期數都來自 Financial Health facts；缺 schedule 時月付與剩餘排程必須顯示「尚未建檔」。
15. 投資占比以目前投資市值除以目前淨資產計算；分母不存在或不為正時保持未知。

## Acceptance examples

- Given 資產與負債都有可靠值，when 開啟 `/control?month=2026-07`，then 顯示正確淨資產與負債比例。
- Given 貸款 schedule 不完整，then 每月固定義務只顯示已建檔下限，並明確說明貸款還款尚未完整計入。
- Given `factor_exposure_minor = null`，then 投資區顯示「槓桿曝險尚無法計算」，壓力測試也顯示未知。
- Given 使用者修改交易後觸發 `last-say:data-changed`，then 四個 read model 重新抓取，儀表板隨目前資料更新。
- Given 手機寬度 390px，then 四個首要數字使用 2×2 排列、後續主要區塊改為單欄，文字、數字與導覽不重疊或溢出。
- Given 使用者前往交易頁，then 搜尋、單筆編輯與批次修正仍使用原元件與既有 API。
- Given 今天是 2026-07-21 且 URL 僅指定 `month=2026-07`，when 開啟資產負債表，then 預設截止日為 2026-07-21，而不是尚未到來的 2026-07-31。
- Given 今天是 2026-07-21 且 URL 僅指定 `month=2026-07`，when 開啟現金流量表，then 查詢期間為 2026-07-01 至 2026-07-21；歷史月份仍查到月底。
- Given 報表未建立獨立權益帳戶，when 顯示計算後權益列，then 名稱為「淨資產（資產扣除負債）」且說明為「資產合計 − 負債合計」。
- Given 現金流缺期初快照或仍有待釐清交易，then 已知現金流照常顯示，期初與對帳差額顯示「尚無可靠數值」，並列出缺少哪些資料。
- Given URL 明示 `taiwan_instrument_keys=<00675L key>&taiwan_leverage_factor=2`，when 儀表板查詢 Financial Health，then 原樣傳遞兩項假設、顯示槓桿曝險與壓力測試，且標示為「00675L 市值 × 2（此頁情境）」。
- Given 今天仍在 2026-07 且選擇 2026-07，when 顯示近期基準，then 使用 2026-01 至 2026-06 六個完整月份，不把 7 月部分月份混入平均。
- Given 只有房租與家庭支援 commitments、三筆貸款都沒有 schedule，then 顯示「已建檔固定生活義務」的已知值、貸款月付「尚未建檔」、完整生存線「尚無法計算」。
- Given 負債 profile 有目前餘額與 APR 但沒有 schedule，then 該列保留餘額與 APR，月付與剩餘排程各自顯示未知。
- Given 六個月份都有已確認支出 facts、但 coverage 為 partial，then 平均仍可顯示為「已確認紀錄平均」，並清楚標示六個月份皆有資料缺口。

## Test mapping

- Presenter rules：`test/dashboard-presentation.test.js`。
- 近期基準 read model：`test/control-dashboard-history.test.js`。
- 既有資料與交易回歸：`npm test`。
- 靜態品質：`npm run lint`、`npm run build`。
- 實際畫面與互動：內建瀏覽器桌面及 390px 手機 viewport；結果記錄於 `design-qa.md`。
- 瀏覽器契約：`e2e/monthly-financial-pulse.spec.js`、`e2e/data-center-and-reports.spec.js` 必須跟隨目前中文可見名稱與儀表板結構，不得綁定已淘汰畫面。

## Evidence

- Before：`audit/consultation-20260721/` 與 `design-qa.md` 記錄既有畫面及「固定義務只有 NT$16,000、貸款 schedule 尚未 canonical」的限制。
- After：`npm test` 239／239、Chromium E2E 7／7、Skill eval 18／18、lint、production build、runtime smoke、privacy scan、匿名 backup／restore rehearsal與screenshot checks均於2026-07-21通過；內建瀏覽器另完成1280×720與390×844正式資料QA，詳見`design-qa.md`。

## Intentional Changes

- 將重複的「資產與負債」摘要改為可核對的負債明細，避免和第一排總資產／負債數字重複。
- 將「每月已知固定義務」重新命名為「已建檔固定生活義務」，避免被誤讀成完整必要支出。
- 新增六個完整月份的已確認紀錄平均；它是動態 read model，不是 AI 評語或固定報告。
- 新增投資占淨資產比例；槓桿倍數仍只接受明示情境，不寫回資料庫。

## Open Questions

- 必要生活支出的 owner policy 尚未定義，因此本版不計算完整生存線與安全現金月數。
- 貸款月付、剩餘期數仍應透過 liability schedule 建檔；本次不從聊天紀錄或歷史扣款猜測。

## Update rule

當 dashboard read-model 欄位、交易編輯契約、主要導覽或未知值政策改變時更新本文件。單純色彩、間距或不影響行為的文案微調不需要修改契約。
