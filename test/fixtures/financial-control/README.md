# Financial Control Phase 0 Fixtures

此目錄只含合成資料，與專案擁有者的真實帳戶、卡片、貸款、收入或支出無關。Fixture 用來固定 forecast、coverage 與 cross-context invariant，不是 canonical database import format。

- `post-style-pressure.json`：兩個銀行帳戶、兩張卡、一筆貸款、薪資、房租、訂閱、保險、不確定收入、過期卡片資料與未知支出。它證明 card charge/payment、loan split、conservative income 和 partial coverage 的共同語意。
- `manifest.json`：fixture registry 與隱私聲明。

更新 fixture 必須同步 `docs/contracts/cash-forecast-contract.md`、metric dictionary 與 `test/control-cash-timeline.test.js`；不得用真實資料取代 synthetic values。
