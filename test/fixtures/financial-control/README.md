# Financial Control Phase 0 Fixtures

此目錄只含合成資料，與專案擁有者的真實帳戶、卡片、貸款、收入或支出無關。Fixture 用來固定 forecast、coverage 與 cross-context invariant，不是 canonical database import format。

- `post-style-pressure.json`：兩個銀行帳戶、兩張卡、一筆貸款、薪資、房租、訂閱、保險、不確定收入、過期卡片資料與未知支出。它證明 card charge/payment、loan split、conservative income 和 partial coverage 的共同語意。
- `deterministic-analysis-response.json`：固定未來Control analysis的共用response envelope，並證明同一查詢在confirmed fact改變後會重算、candidate與unknown不會進入confirmed totals。
- `monthly-financial-pulse.json`：固定FC-A2的月度管理損益、現金流、typed cash movements、coverage、watermark與drillback輸出，不含真實財務資料。
- `financial-health-review.json`：固定FA-0的position、liquidity、debt、investment-factor、stress與missing-input Context Pack邊界，不含真實財務資料。
- `manifest.json`：fixture registry 與隱私聲明。

更新`post-style-pressure.json`必須同步`docs/contracts/cash-forecast-contract.md`、metric dictionary與`test/control-cash-timeline.test.js`；更新deterministic analysis fixture必須同步`docs/contracts/deterministic-analysis-read-model-contract.md`與`test/deterministic-analysis-contract.test.js`；更新Monthly Pulse fixture必須同步`docs/contracts/monthly-financial-pulse-contract.md`與`test/control-monthly-financial-pulse.test.js`；更新Financial Health fixture必須同步`docs/contracts/financial-health-review-contract.md`與`test/control-financial-health.test.js`。不得用真實資料取代synthetic values。
