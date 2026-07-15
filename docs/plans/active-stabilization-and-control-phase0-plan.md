# Active Stabilization And Financial Control Phase 0

Status: Completed
Started: 2026-07-15
Delivery baseline: `main` at `4a4ac68`; this ledger covers the subsequent documentation audit and stabilization delivery
Last updated: 2026-07-15

## Outcome

修正已確認的 Data Center／report／runtime／backup 缺口，建立可重複 browser evidence，並完成 Financial Control Phase 0 的 contracts、metric dictionary、synthetic fixture 與 pure cash-timeline reference implementation。

## Scope

1. Currency-aware money presentation and account/obligation forms.
2. Full canonical account-kind/currency creation and bounded manual investment valuation entry.
3. Honest unavailable Balance Sheet/Cash Flow states.
4. Environment-driven local port launcher.
5. Isolated Chromium E2E in local/release/CI verification.
6. Readonly backup health/freshness verification and owner policy worksheet.
7. Four Control contracts, metric dictionary, post-style synthetic fixture and deterministic timeline test.

## Non-goals

- No schema/migration or dependency upgrades unrelated to Playwright E2E.
- No formal Balance Sheet/Cash Flow query implementation.
- No runtime safe-to-spend, alert inbox or autonomous financial action.
- No automatic backup deletion/scheduling and no active DB replacement.

## Contract Questions Answered

- Goal contribution：G1/G2/G3/G5/G8；先建立可信輸入、projection semantics與可驗證 evidence。
- Preserved invariants：integer minor units、typed owners、source/authority/review、no duplicate card/loan expense、unknown is not zero、isolated DB。
- User-visible evidence：JPY 正確顯示、可建立缺少的帳戶/投資資料、未完成報表不再誤導、設定 port 生效、backup health 可檢查。
- Scope guard：本切片不宣稱完整財務掌控或 safe-to-spend 已可使用。

## Execution Ledger

| Stage | State | Evidence |
|---|---|---|
| Behavior contracts | Completed | Data Center／operator reliability contracts active；四份Control contracts為owner-approval-required draft |
| Product stabilization | Completed | canonical money、all account kinds、manual investment source+fact、honest reports；focused tests＋Chromium E2E |
| Backup operations | Completed within authorized scope | readonly health／freshness verification＋policy worksheet；schedule／retention仍待owner |
| Control Phase 0 | Completed as reference | synthetic fixture＋pure projector golden test；無runtime DB／API／UI |
| Cross-check/release verification | Completed | CodeGraph 269 files／2,338 nodes／5,426 edges／pending 0；`npm run verify:release` PASS |

## Final Verification Record

- `npm run verify:release`：PASS，89.5秒；real `data/finance.sqlite`明示未開啟。
- Node tests：148／148 pass，0 fail／skip／todo；47個test files。
- Chromium E2E：1／1 pass；empty isolated DB完成JPY balance、manual investment valuation與BS／CF unavailable assertions。
- Skill eval：8／8；Next production build與runtime smoke PASS；schema version 6，production CSP不含`unsafe-eval`。
- Working-tree privacy scan：tracked＋untracked、未被ignore的`.js`／`.jsx`／`.mjs`／`.json`／`.md`通過。
- Anonymous demo：180 transactions、6 months、typed foundation contexts存在；backup→new-path restore integrity=`ok`、0 FK violations、schema 6、34 change-evidence rows。
- In-app browser QA：Data Center與Cash Flow unavailable state通過，browser console 0 error／warning。
- 文件交叉檢查：66份Markdown，missing relative links 0、unbalanced fences 0、required docs 20／20；`git diff --check`無error。
- Node執行`node:sqlite`時仍輸出ExperimentalWarning；屬runtime warning，不是test failure。

第一次full gate因新擴大的`.mjs` privacy scan掃到verifier註解中的示例號碼而fail；移除註解中的號碼、保留擴大後的scan coverage，再跑完整gate後通過。沒有縮減guard或修改測試迎合結果。

## Handoff Rule

每完成一階段即更新此表與受影響的 project/status/architecture/operations/planning docs。若執行中發現需要 schema、正式財務政策或會改變外部安全邊界，停止該子項並標記 `Needs owner decision`，其餘項目繼續。

更新觸發：本輪 scope、contract、test mapping、驗證結果或阻擋條件變更時。
