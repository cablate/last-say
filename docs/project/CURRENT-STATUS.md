# Current Status

用途：讓下一位人類或 AI 先知道目前真正完成到哪裡、哪些數字可用、哪些動作仍需要專案擁有者。本文描述 repository 現況，不取代功能契約或長期目標。

Last validated against repository: 2026-07-16

## 一句話結論

Last Say 已從「有 typed 資料表的財務資料基礎」推進為「可由 AI 讀取受治理資料、由人類在統一工作台裁決、並產生管理損益表／資產負債表／現金流量表的 local-first 系統」。目前剩下的 foundation 關卡不是再建第二套資料模型，而是正式 DB 的受保護升級、真實待釐清項目處理，以及擁有者完成代表性操作驗收。

## 已確認完成

- Repository code schema 已到 v9，migrations `0001`–`0009`涵蓋 shared kernel、ingestion、balances、obligations、investments、reconciliation、reimbursement matching、obligation reversal lifecycle 與 transfer optimistic versioning。
- AI 分析面提供 12 個 allowlisted datasets 與 `finance.proposal-envelope/v1`；proposal 只描述 evidence、impact、missing data、typed owner 與 recovery，不直接取得 human authority。
- 統一待審工作台 `finance.review-workbench/v1` 已接上 scope confirmations、transfer、reimbursement、recurring commitment、source conflict 與 owner-unresolved transaction。Typed owner 狀態不能再被 generic review task 單獨關閉。
- 交易單筆修正與批次 review 已加入 `updated_at` stale guard；嚴格批次遇到任一版本衝突會整批拒絕。
- 三張管理報表均為 server-side read model：
  - management P&L：economic recognition，唯一已支援 basis 為 `card_accrual_management`；
  - balance sheet：account／holding／valuation snapshots、FX watermarks、net worth 與 coverage；
  - direct-method cash flow：cash settlement、typed transfer／card／loan／investment／reimbursement owner、begin/end reconciliation 與 coverage。
- 報表 UI 只呈現 server 結果；partial、empty、unmapped、unreconciled 與 complete 都有明確狀態，不在 React 端重算財務語意。
- Operator Skill 已加入固定／變動支出、工作／個人／報銷、descriptive income floor、分期 audit、未決轉帳、三視角 bridge 與 typed review recipes；adversarial eval 目前 17/17。
- 最新整合驗證：`npm run verify:release`完整通過（86.3秒），其中Node tests 195/195、Skill eval 17/17、Chromium 5/5、production build、runtime smoke、privacy scan與匿名backup restore皆通過；Markdown links／fences與`git diff --check`也通過。

## 正式資料安全狀態

- 正式 `data/finance.sqlite` 仍是 schema v6；本輪沒有在正式 DB 執行 migration 或 canonical mutation。
- 2026-07-16 唯讀盤點：1,078 transactions、13 accounts、19 sources、10 balance snapshots，交易日期涵蓋 2025-04-05 至 2026-07-15。
- 已建立新的 ignored DB-only backup bundle；`backup:check` 驗證 hash、`integrity_check=ok`、0 foreign-key violations、schema v6，且在 24 小時 freshness gate 內。
- 已把該 backup 還原到 OS temporary path，僅在暫存副本演練 v6→v9。結果為 schema v9、`integrity_check=ok`、0 FK violations，migrations 0007–0009 欄位／tables 存在；演練後暫存目錄已安全移除。
- 隔離真實資料副本能產生三張表，但都誠實維持 `partial`：P&L 仍有 unmatched transfer；balance sheet 有 missing／stale snapshots與missing valuation；cash flow有missing boundaries、card／loan／transfer typed matching缺口。工作台另辨識20筆owner-unresolved transactions。

這些 aggregate evidence 不代表擁有者已接受每一筆分類，也不代表正式 DB 已可直接啟動新版本。

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
| code schema | v9 |
| formal DB schema | v6；只完成 backup + isolated rehearsal |
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

- Formal DB 尚未升到 v9，因此新 reimbursement lifecycle、review workbench與三張表不能在 active DB 上宣稱已發布。
- 真實 transfer、card settlement、loan allocation、reimbursement與commitment evidence仍不完整；部分報表合理維持 partial。
- 部分 cash accounts 缺期初／期末 boundary，部分 position snapshots stale／missing；不能用零補齊。
- 20筆交易的現金方向已知但用途仍需owner；這是刻意保留的未知，不是AI失敗後可以硬猜的分類。
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
- `MP-07`：backup、唯讀inventory、restore→migration rehearsal與real-copy report preflight complete；正式migration、owner逐項決策、browser acceptance與GATE-F6仍待owner醒來後執行。

因此，不能把 master plan 標為 Complete，也不能把 Financial Control `FC-1` entry gate 標成 passed。

## 下一個合理動作

1. 由owner確認是否現在執行正式DB v6→v9；若同意，使用已驗證backup，升級後立即做PRAGMA、aggregate、inventory／readiness／report postflight。
2. 由owner在統一工作台處理material items，特別是20筆owner-unresolved與transfer／card／loan／reimbursement evidence。
3. Owner用常見問題驗收AI回答與三張表差異；接受remaining gaps後才關閉GATE-F6。
4. Gate F通過後，才由`master-financial-control-plan.md`接手Financial Control runtime。

更新觸發：schema／正式DB版本、master plan package、報表契約、驗證基線、真實coverage或owner acceptance改變時更新。
