---
schema_version: behavior-contract/v1
id: finance.liability-commitment.storage
title: 負債、分期與未來承諾
status: active
owner_surface: api
change_context:
  type: feature
  reason: 保存信用卡、貸款與一般現金承諾的正式義務，不重複支出事實；也允許先保存有本金證據但缺精確起始日的貸款。
  non_goals:
    - 不猜測未知利率的未來還款。
    - 不用一張 liability mega-table 合併不同生命週期。
---

# 負債與承諾儲存契約

## Behavior Boundary

Credit Card context 擁有 statements/payment matches/installment plans；Liability context 擁有 loan profile/schedule/allocation；Commitment context 只擁有一般 recurring/fixed commitments，read model 可彙整但不得複製 typed obligations。

## Consumers And Entrypoints

- `/api/finance/credit-cards/*`、`/api/finance/liabilities/*`、`/api/finance/commitments/*`。
- debt-obligations、cash-flow、liquidity-forecast readiness/read models。
- Card、loan、commitment typed tables與 match tables。

## Inputs And State

- Card statement 有 period/close/due、balance/minimum/full due、currency、official/source/review；items 只 link transaction，不複製 merchant amount。
- Installment plan 有 principal、count、dates、APR/fees、authority/version；entry 有 principal/interest/fee/total/status，components 必須相等。
- Loan profile 有 principal/currency/rate type/APR as-of/term；`start_date`可缺省，代表現有證據無法確認起始日，公開 read model必須回傳`null`而不得補一個猜測日期。schedule 只能來自 official/human-confirmed evidence。
- Commitment amount 僅 fixed/range/unknown；cadence 僅具名 enum與 dates，不接受公式字串、任意 RRULE/code。

## Outputs And Side Effects

- Merchant expense 僅在原交易認列一次；installment entries 表示未來清償結構。
- Card payment是 liability settlement/cash movement，不是第二筆 P&L expense。
- Loan allocation principal+interest+fee 必須等於 matched cash amount，否則 unreconciled。
- Card payment match只能連到active cash outflow，且與statement同entity／currency；同一付款與同一statement的累計allocation不得超過來源現金或應付額。
- Loan allocation components不得為負；payment必須是active outflow且與liability同entity／currency。累計allocation不得超過來源現金或schedule各component；少配可保存為unreconciled，多配fail closed。
- AI／estimated recurring pattern只能建立`provisional`＋`needs_review` commitment；未升格為official／user-confirmed前，occurrence也只能是provisional candidate。
- Compound ingestion建立的card／loan／commitment canonical rows必須保存`ingestion_run_id`與active/reversed lifecycle。Confirmed reversal只改 lifecycle與audit，不刪除header、items、entries、source或交易。
- 若回復後以新run重匯會撞到既有不可重用的identity（例如existing liability上的相同schedule sequence、existing commitment上的相同occurrence date），reverse preview必須明示blocker；不得先標reversed再讓修正資料無法落地。
- Official schedule 可 supersede provisional future entries，但 settled history 不被 template/schedule edit 改寫。

## UI States

後續 UI 顯示 no-profile、provisional、official、schedule-mismatch、due-soon、payment-unmatched、complete 與 unsupported lifecycle；不得把 provisional estimate 標成官方義務。

## Invariants

- Card statement item、installment entry、cash commitment 不複製既有交易的 merchant expense。
- Current loan principal 由 principal balance snapshot或 reconciled schedule read model 擁有，不放第二份 current balance 在 profile。
- Variable-rate 未提供官方 schedule/repricing rule 時只保存已報告事實，future readiness partial。
- 已有current principal snapshot但缺`start_date`時，position仍可使用該principal；`debt_obligations`必須列出`missing_loan_start_date`並維持`partial`。缺日期不得阻止已知本金、APR與付款頻率進入同一typed owner。
- Principal snapshot若是`estimated`、`ai_inferred`或未經confirmed review，`debt_obligations`必須列出`loan_principal_needs_review`；有估算列不等於已完成負債對帳。
- Revolving、balloon、interest-only 等未具 typed contract 的生命週期 fail closed/另立 context。
- Installment origin必須是同卡active outflow且幣別一致；financed principal不得超過原始charge絕對值。

## Acceptance Examples

1. Given NT$12,000 merchant charge 分 12 期，then P&L 只有一筆 NT$12,000 expense，另有 12 筆 obligation entries，不產生 12 筆 merchant expense。
2. Given loan cash payment NT$20,000 但 allocation sum NT$19,500，then status `unreconciled`。
3. Given variable loan 只有目前 APR，when 要求未來 schedule，then 回 partial gap，不由 AI 猜 authoritative payment。
4. Given AI從歷史交易推測每月支出，when proposal尚未經owner確認，then只能保存provisional candidate，不得建立scheduled／settled obligation。
5. Given card／loan allocation超過cash leg或typed due component，then preview／commit fail closed且compound run canonical writes為零。
6. Given一批新account＋card profile＋statement資料皆由同一run建立，when human-confirmed reversal執行，thenactive reads不再回傳該批資料、source/audit/child rows仍保留，且新run可重新建立正確資料。
7. Given existing liability上新增schedule sequence 1，when reversal後新run仍會撞到同一unique identity，then reverse preview回不可回復blocker，原run保持committed。
8. Given owner-confirmed principal、APR與monthly payment但無法確認貸款起始日，when建立liability profile，then profile保存且`start_date=null`，principal snapshot可進position，同時debt readiness以`missing_loan_start_date`維持partial。
9. Given學貸只有estimated current principal，when查詢debt readiness，then系統列出`loan_principal_needs_review`，不因snapshot存在就宣稱負債已完整對帳。

## Test Mapping

```yaml
test_mapping:
  integration:
    - test/credit-card-storage.test.js
    - test/credit-card-installments.test.js
    - test/liability-storage.test.js
    - test/financial-readiness.test.js
    - test/commitments.test.js
    - test/obligation-closure.test.js
```

## Evidence

- `lib/db/migrations/0008-obligation-ingestion-lifecycle.js`、`lib/finance/ingestion/reversal.js`與`lib/queries/finance/obligations.js`。
- `test/credit-card-storage.test.js`、`test/credit-card-installments.test.js`、`test/liability-storage.test.js`、`test/commitments.test.js`、`test/obligation-closure.test.js`。
- Compound rehearsal使用`test/fixtures/financial-data/source-mappings/card-statement.json`、`loan-statement.json`與`canonical/additional-contexts.json`；repository沒有三份按domain拆開的canonical fixture。

## Intentional Changes

- 將 statement、installment、loan、general commitment 分成 typed owners，禁止通用義務資料表。
- 2026-07-16 開始，liability ingestion不再強迫沒有證據的起始日；缺值以readiness blocker呈現，不使用估算日期。已有精確`start_date`的payload與read model保持原行為。

## Open Questions

- v9儲存層的`start_date`是`NOT NULL TEXT`；未知值以空字串作相容表示，typed read model統一投影為`null`。若未來需要大規模重建obligation tables，再在有完整FK migration/recovery證據時改為實體nullable column；目前不為了三筆資料提前做高風險table rebuild。
