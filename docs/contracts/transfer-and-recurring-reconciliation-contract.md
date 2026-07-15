---
schema_version: behavior-contract/v1
id: finance.transfer-recurring.reconciliation
title: 轉帳配對、未配對候選與週期承諾審查
status: active
owner_surface: api
change_context:
  type: feature
  reason: 讓轉帳與週期承諾從候選到人工裁決皆有唯一owner，並避免零match被誤報為完整對帳。
  non_goals:
    - 不由名稱或金額相似直接自動確認自己轉給自己。
    - 不建立第二套交易、commitment或review資料。
    - 不把信用卡繳款、貸款清償或投資現金腿硬配成internal transfer。
---

# 轉帳配對、未配對候選與週期承諾審查契約

## Behavior Boundary

`transfer_matches`是own-account transfer relationship唯一owner；原始兩邊cash transactions保持不變。未配對轉帳只是deterministic candidate，不是canonical match。`commitment_templates`是recurring/fixed commitment唯一owner；AI pattern只能建立provisional candidate並進既有`review_tasks`。

## Consumers And Entrypoints

- `GET／POST /api/finance/reconciliation/transfers`與`PATCH /api/finance/reconciliation/transfers/[key]`。
- `GET /api/finance/reconciliation/summary`。
- Commitment create／update APIs與review task queue。
- Cash-flow、report coverage、未來AI proposal datasets。

## Inputs And State

- Transfer from leg必須是active outflow；to leg如存在，必須是active inflow、同entity、同currency、不同account。
- Match amount為positive minor units；同一active cash leg的累計allocation不得超過該leg絕對金額。
- One-sided match只能是`proposed`；confirmed match必須有兩邊。
- `proposed`只能用version-checked PATCH轉成`confirmed`或`rejected`；resolution同時關閉對應review task並留audit evidence。
- 只有active、尚未被non-rejected transfer match擁有的transfer-shaped cash rows可出現在unmatched candidates。Candidate只表明值得調查，不宣稱用途或對手腿。
- AI／estimated commitment必須是`provisional`＋`needs_review`；建立後產生`commitment_candidate` review task。升格為非provisional且具human／official authority時關閉task；仍為candidate時task保持open。

## Outputs And Side Effects

- Rejected transfer不參與typed legs、allocation、one-sided counts或completeness。
- Reconciliation summary在有open source conflict、duplicate typed context時為`conflicted`；有proposed／one-sided／unmatched transfer candidates或proposed reimbursement時為`unreconciled`；只有這些registered／detectable gaps皆清空才可為`complete`。
- `complete`只代表目前可偵測的reconciliation scope無未決項，不宣稱所有歷史資料、帳戶範圍或來源都完整。
- Matching／rejecting不修改原始transaction分類、金額、日期或來源。

## Failure And Recovery

- 錯方向、inactive row、跨entity、同account、跨幣別、超額allocation、stale version或低權威confirmed request：fail closed，canonical writes為零。
- 無法唯一選擇to leg：保留unmatched candidate或one-sided proposal；不得任選一筆。
- Rejected match保留audit evidence。若日後新證據需要相同pair，先提出明確reopen／supersede contract，不繞過UNIQUE identity手改DB。

## Acceptance Examples

1. Given同entity兩個銀行帳戶各有TWD 5,000 outflow／inflow，when建立confirmed match，then兩筆cash仍存在、summary不重複認列且該pair不再是candidate。
2. Givenfrom leg其實是inflow或兩腿屬不同entity／同account，when preview／create，then fail closed。
3. GivenTWD 5,000 cash leg已有TWD 4,000 active allocation，when再配TWD 2,000，then拒絕超額。
4. Givenproposed transfer，when以正確version確認，thenmatch變confirmed、review task resolved；stale version不改任何狀態。
5. Given沒有任何match但有transfer-shaped active transaction，then summary為unreconciled並列出candidate，不回complete。
6. Given AI判斷每月可能有固定支出，when建立commitment，then只能是provisional且review queue可見；未經owner確認不建立scheduled occurrence。

## Test Mapping

```yaml
test_mapping:
  integration:
    - test/transfer-matching.test.js
    - test/reimbursement-matching.test.js
    - test/obligation-closure.test.js
    - test/reconciliation-candidates.test.js
```

## Evidence

- Preflight evidence：`lib/db/migrations/0006-reconciliation.js`、`lib/queries/finance/reconciliation.js`、`lib/queries/finance/obligations.js`、`docs/contracts/owner-unresolved-cash-activity-contract.md`。
- 2026-07-16確認的既有缺口：transfer rows沒有version／updated_at、沒有resolution route、create未驗方向／entity／allocation；rejected match仍進summary；零match可掩蓋transfer-shaped未配對rows；provisional commitment未建立review task。

## Intentional Changes

- Additive migration只為`transfer_matches`增加`version`與`updated_at`，不重建table、不移除既有UNIQUE constraint。
- 擴充既有reconciliation／commitment owners與review task kind，不建立candidate table。

更新觸發：transfer identity、allocation、candidate selection、review lifecycle、commitment authority或reconciliation completeness語意改變時更新。
