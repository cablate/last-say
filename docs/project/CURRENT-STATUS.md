# Current Status

用途：讓下一位人類或 AI 先知道目前真正完成到哪裡、哪些數字可用、哪些動作仍需要專案擁有者。本文描述 repository 現況，不取代功能契約或長期目標。

Last validated against repository: 2026-07-16

## 一句話結論

Last Say 已從「有 typed 資料表的財務資料基礎」推進為「正式資料庫已升級、可由 AI 透過受治理 API 寫入真實資料、由人類在統一工作台裁決，並產生管理損益表／資產負債表／現金流量表的 local-first 系統」。Foundation 的系統與 operator 工作已完成；剩餘關卡只包含擁有者專屬的範圍聲明、待審決策與最終接受，不再需要另一輪基礎架構開發。

## 已確認完成

- Repository code與正式資料庫均已到 schema v10；migrations `0001`–`0010`另包含 source conflict 的人類可讀原因與影響脈絡。
- AI 分析面提供 12 個 allowlisted datasets 與 `finance.proposal-envelope/v1`；proposal 只描述 evidence、impact、missing data、typed owner 與 recovery，不直接取得 human authority。
- 統一待審工作台 `finance.review-workbench/v1` 已接上 scope confirmations、transfer、reimbursement、recurring commitment、source conflict 與 owner-unresolved transaction。Typed owner 狀態不能再被 generic review task 單獨關閉。
- 交易單筆修正與批次 review 已加入 `updated_at` stale guard；嚴格批次遇到任一版本衝突會整批拒絕。
- 三張管理報表均為 server-side read model：
  - management P&L：economic recognition，唯一已支援 basis 為 `card_accrual_management`；
  - balance sheet：account／holding／valuation snapshots、FX watermarks、net worth 與 coverage；
  - direct-method cash flow：cash settlement、typed transfer／card／loan／investment／reimbursement owner、begin/end reconciliation 與 coverage。
- 報表 UI 只呈現 server 結果；partial、empty、unmapped、unreconciled 與 complete 都有明確狀態，不在 React 端重算財務語意。
- Operator Skill 已加入固定／變動支出、工作／個人／報銷、descriptive income floor、分期 audit、未決轉帳、三視角 bridge 與 typed review recipes；adversarial eval 目前 17/17。
- 最新整合驗證：`npm run verify:release`完整通過（100.3秒），其中Node tests 199/199、Skill eval 17/17、Chromium 5/5、production build、runtime smoke、production dependency audit、privacy scan與匿名backup restore皆通過。

## 正式資料安全狀態

- 升級前先建立並驗證 schema v6 DB-only backup，再於全新暫存還原副本演練 v6→v9；正式升級後又建立 schema v9 backup並演練 v9→v10。兩次正式 migration 均保留1,078筆交易及相同交易雜湊，`integrity_check=ok`且0 foreign-key violations。Real-data closure後另建立並驗證最新schema v10 DB-only backup；所有bundles均在ignored private data zone。
- 2026-07-16正式唯讀postflight：schema ledger為`1..10`、1,078 transactions、13 accounts、24 sources、10 balance snapshots；正式資料庫目前`integrity_check=ok`、0 foreign-key violations。
- 真實typed facts目前包含1張card profile、1期可精確對帳的statement與payment match、3筆liability profile、2筆固定commitment、2筆私人應收與valuation，以及1筆「待人確認」的reimbursement match。未知貸款起日、學貸估算本金與未提供的還款拆分仍明示為partial，沒有由APR反推。
- 三張正式報表均可查詢並誠實維持`partial`／`unreconciled`：June P&L仍有4筆unmatched transfer；7/16 balance sheet方程式差額為0，但缺目前信用卡餘額且一筆included cash snapshot已超過freshness policy；H1 cash flow缺期初／期末cash boundaries及多項typed matching。工作台目前有1筆actionable reimbursement proposal與20筆owner-unresolved transactions；reconciliation另列57筆transfer-shaped candidates。
- 2026-01至2026-05的官方信用卡月檔與既有normalized card rows各有總額差異；2026-06精確一致。前五期沒有用source conflict「選一邊」假裝修復，因為問題屬於正規化／漏列差異，後續需以可逆的transaction repair或重新匯入流程處理。

這些aggregate evidence代表正式版本可安全運作，但不代表擁有者已接受每一筆分類或已聲明所有scope完整。

## Owner-confirmed operating direction

- AI 是主要輸入方式；UI 負責確認、歧義、高風險授權與少量修正，不追求每個 context 都有 full CRUD admin。
- 目前先把資料基礎與真實操作流程跑順；Financial Control Center 是下一階段，必須消費現有 canonical facts，不建立第二套帳戶、資產、負債或投資 truth。
- Reserve、dependable income、safe-to-spend policy 等到 control／forecast consumer 真正需要時再由 owner 決定。
- 業務邏輯未獲 owner 滿意前，以簡單 local-first defaults 為主，不提前做 remote platform、multi-tenant、複雜 observability 或大規模重構。

## 目前版本與入口

| 項目 | 現況 |
|---|---|
| Git delivery | branch `codex/repository-audit-and-stabilization`；精確commit以`git log -1`為準 |
| package | `0.2.3` |
| code schema | v10 |
| formal DB schema | v10；backup、雙階段rehearsal、migration與postflight已完成 |
| runtime | Node >=22.5、Next.js 15、React 19、SQLite |
| pages | Overview、Transactions、Reports、Data Center、Trend、Corrections、Rules、Confirmations |
| AI contract | `.claude/skills/last-say-ops/` |
| active foundation plan | `docs/plans/ai-assisted-financial-semantics-plan.md` |
| next-stage plan | `docs/plans/master-financial-control-plan.md` |

## 能力狀態

### Implemented and verified

- Legacy transaction import、dedupe、review、correction、classification learning與human-evidence preservation。
- Typed identity／source／scope、preview／staging／atomic commit、idempotency、confirmed reversal與append-only evidence。
- Balances、cards、liabilities、loan schedules／allocations、commitments、investments、quotes／FX、valued items。
- Transfer／reimbursement matching、source conflicts、identity merge／redirect、human confirmation與review workbench。
- Inventory、8 readiness goals、12 governed analysis datasets與proposal envelope。
- Management P&L、balance sheet、cash flow、shared coverage、drillback與browser-backed report UI。
- Backup／restore／health check、isolated runtime smoke、Chromium E2E與release verifier。
- Control Phase 0 pure synthetic projector與contracts；仍不是runtime forecast。

### Partial by real-data evidence

- 正式DB已發布v10與代表性typed facts；真實 transfer、歷史card normalization、loan allocation及scope evidence仍不完整，因此部分報表合理維持partial／unreconciled。
- 部分 cash accounts 缺期初／期末 boundary，部分 position snapshots stale／missing；不能用零補齊。
- 20筆交易的現金方向已知但用途仍需owner；這是刻意保留的未知，不是AI失敗後可以硬猜的分類。
- 一筆活動報銷已由AI建立可逆、具原因與差額揭露的proposal；確認或拒絕必須由owner在UI執行。
- Browser suite涵蓋核心報表與typed review決策，但不是完整mobile、multi-browser或長時間併發證據。

### Planned after foundation acceptance

- Foundation facts → deterministic runtime 90-day forecast adapter／API／UI。
- Owner-approved reserve、dependable-income、freshness與uncertainty policies。
- Safe-to-spend、alert lifecycle、scenario comparison與Financial Control Center。
- Centralized observability、service packaging與更完整的operational automation；只在實際需求出現後投入。

## Master plan progress

- `MP-00`～`MP-03`：semantic kernel、typed owners、reconciliation、AI context／proposal complete。
- `MP-04`：unified impact review workbench complete；server counts與typed actions有Node＋browser evidence。
- `MP-05`：three-view reporting complete at code／synthetic／UI level；真實資料結果仍按coverage降級。
- `MP-06`：operator Skill與17-case adversarial eval complete。
- `MP-07`：backup／restore rehearsal、正式v6→v9→v10 migration、代表性card／liability／commitment／reimbursement typed flow、postflight與完整release verification皆complete；只剩owner專屬的scope／proposal confirmation與GATE-F6 acceptance。

因此，不能把 master plan 標為 Complete，也不能把 Financial Control `FC-1` entry gate 標成 passed。

## 下一個合理動作

1. Owner在統一工作台確認或拒絕目前1筆reimbursement proposal；20筆真正想不起用途的交易可以繼續保留owner-unresolved。
2. Owner透過短效browser confirmation聲明cash accounts、credit cards、liabilities、investments與valued items的scope；AI只能建立proposal，不能代按確認。
3. Owner用常見問題驗收AI回答與三張表的partial／known gaps，接受後關閉GATE-F6。
4. Gate F通過後，由`master-financial-control-plan.md`接手Financial Control runtime；歷史卡片repair與缺失snapshot可作為foundation maintenance持續處理，不建立第二套truth。

更新觸發：schema／正式DB版本、master plan package、報表契約、驗證基線、真實coverage或owner acceptance改變時更新。
