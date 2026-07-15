---
schema_version: behavior-contract/v1
id: finance.event-semantics
title: 經濟事件、現金清償與未來義務語意
status: active
owner_surface: shared
change_context:
  type: feature
  reason: 讓損益、現金活動、資產負債與未來義務共用同一套事件角色，避免付款、分期、轉帳與報銷重複認列。
  non_goals:
    - 不實作完整雙式簿記或法定財務報表。
    - 不建立第二套交易、帳戶、負債、承諾或 AI 分析資料真相。
    - 不猜測未知用途、貸款拆分、分期來源、報銷配對或未來 schedule。
---

# 經濟事件、現金清償與未來義務語意契約

## Behavior Boundary

本契約是 Foundation reporting 與 obligation consumers 共用的語意邊界，回答同一來源事實在三種時間線應扮演什麼角色：

1. **Economic recognition：** 收入或費用何時屬於管理損益期間。
2. **Cash settlement：** 現金何時實際進出納入範圍的帳戶。
3. **Obligation position／due：** 截至某日尚未清償的負債，以及未來何時到期。

專門契約仍各自擁有輸出形狀與細節：`management-pl-contract.md` 擁有管理損益、`cash-flow-contract.md` 擁有現金流、`balance-sheet-contract.md` 擁有 position、`liability-and-commitment-storage-contract.md` 擁有 typed obligations、`transfer-matching-contract.md` 擁有 reconciliation。若專門契約與本文對同一事件角色衝突，先停止實作並修復契約，不由 consumer 自行選邊。

## Consumers And Entrypoints

- `lib/reporting/report-lines.js::classifyTransactionForReport`。
- `lib/queries/reports/income-statement.js::getIncomeStatement`。
- `lib/queries/finance/cash-activity.js`、未來 cash-flow read model。
- `lib/queries/finance/obligations.js`、`lib/queries/finance/reconciliation.js`。
- Readiness／analysis-context named datasets。
- External AI operator、review UI 與未來 Financial Control projection。

## Canonical Terms

| Term | Meaning | Canonical source／owner |
|---|---|---|
| Source fact | 機構或使用者提供的日期、金額、幣別、帳戶、摘要與來源身分 | Transaction、statement item、snapshot、manual/source evidence |
| Economic event | 對管理損益造成一次收入、費用、reversal 或不影響損益的事件 | Transaction/report mapping；不得由付款 row 複製 |
| Cash settlement | 納入範圍帳戶中已 posted 的現金流入或流出 | Cash transaction；保留 institution date／amount |
| Obligation | 截至 as-of 尚未清償或未來到期的 card、loan 或 commitment 事實 | Typed card／liability／commitment owners |
| Link／match | 說明多個 source facts 屬於同一經濟生命週期 | Statement item、payment match、allocation、transfer/reimbursement match |
| Interpretation | AI／rule／human 對 source fact 的角色、分類或關聯判斷 | Versioned mapping／classification／match evidence；不可覆蓋 source fact |

## Required Semantic Envelope

任何會影響報表或 typed obligation 的 proposal 至少帶：

- `source_fact_keys`：一個或多個 stable source／transaction／statement keys；
- `target_owner` 與具名 `action`；
- `economic_role`、`cash_role`、`obligation_role`，不適用時明示 `not_applicable`；
- 各角色使用的 date／period 與理由；
- authority、confidence、逐案 reason、missing evidence；
- 對 P&L、cash、position／obligation、coverage 的預期影響；
- expected version／idempotency key 與 reversal／supersession path。

Runtime schema 可依現有 typed APIs 拆成不同 payload，不要求建立通用 envelope table。Envelope 是 operator／preview contract，不是第二套 persistence owner。

## Recognition Decision Table

| Case | Economic recognition | Cash settlement | Position／obligation | Coverage／review rule |
|---|---|---|---|---|
| 現金、簽帳卡或銀行 merchant purchase | 交易日認列一次費用 | 同一 posted row 為現金流出 | 無額外 obligation | 用途未知則 P&L partial；cash leg仍保留 |
| Credit-card merchant charge | Merchant transaction date 認列一次費用 | Charge 本身不是 bank cash outflow | 增加 card liability；statement／unbilled scope決定 position | 缺 card identity／statement link 時 position partial，不補第二筆費用 |
| Credit-card payment | 不影響 P&L | Bank posted date 認列 settlement outflow | 降低 card liability；以 payment match 連結 statement | 明確機構證據可形成可回復 AI classification；match 衝突或多候選需 review |
| Merchant charge converted to installments | 原 merchant transaction date／官方調整後 date 認列一次完整購買費用 | 各期實際扣繳只進 cash timeline | Installment plan／entries表示未來清償；不得複製 merchant expense | 找不到原始 charge 或官方 plan 時保持 partial，不把每期當新消費 |
| Installment entry／monthly deduction | 不新增 merchant expense；利息／fee 若有明確 component才分別認列 | Posted payment date 為 cash outflow | Settles corresponding installment obligation | `statement_month`／due month不得覆蓋原 purchase recognition date |
| Loan proceeds | 不列收入 | 入帳日為 financing cash inflow | 建立／增加 loan liability | 無 principal evidence 時 position partial |
| Loan payment with verified allocation | Interest／fee 為當期費用；principal 不進 P&L | 全額 payment 為 cash outflow | Principal component降低 liability | Principal＋interest＋fee 不等於 cash amount時 unreconciled |
| Loan payment without verified allocation | 不猜 principal／interest；confirmed P&L不認列拆分 | 全額仍是 cash outflow | Liability變動保持 partial | 進 review／gap，不以 APR 反推 authoritative split |
| Own-account transfer，兩側都在 scope | 不影響 P&L | 兩個 cash legs保留，consolidated cash view消除 | 不改總資產；各帳戶 position依 snapshots | 只有 confirmed match 才消除；source rows不改寫 |
| Own-account transfer，只有一側 | 不認列為 confirmed收入／費用 | 可見的一側照實保留 | 對側 position未知 | `partial`／`unreconciled`，不可假造另一 leg |
| Merchant refund linked to original purchase | 作為原 expense line reversal／reduction，不列一般收入 | Posted refund date 為 cash/card settlement inflow | 降低 card liability或增加 cash | 無可證明 original link 時不得自動抵銷 |
| Reimbursable expense＋matched reimbursement | Expense 與 reimbursement recovery保留 gross facts；net僅為具來源 links 的 derived explanation，recovery不冒充營業收入 | 各自依 posted date進出 cash | 若存在應收 typed owner才影響 position；本階段不由 match自創 receivable | 一對多可保留 match；未匹配 allowance不靜默淨額化 |
| Investment contribution／purchase | 資產重分類，不是一般費用；gain/loss需 trade evidence | 視 cash account scope為 investing outflow或 internal transfer後續 | 增加 investment asset／brokerage cash | 缺 brokerage side時 partial，不把整筆當生活消費 |
| General commitment candidate | 尚未發生時不進 P&L | 尚未 settled時不進 cash actual | 只有 official/user-confirmed evidence可成 confirmed occurrence | 歷史 pattern／AI只能產生 candidate |
| Commitment occurrence settled | 依底層經濟事件認列，不因 occurrence再複製 | Posted settlement進 cash | Occurrence標 settled | Template edit不重寫 settled history |
| Owner-unresolved posted cash activity | 不進 confirmed收入或費用 | Cash inflow／outflow照實保留一次 | 不自行建立 transfer、liability或asset | Owner 明確確認「無法恢復用途」後才可進此狀態；coverage維持 partial |

## Date And Period Rules

- 管理損益預設 `card_accrual_management`：merchant transaction date 是 economic recognition date。
- Posted bank／wallet date 是 cash settlement date；statement close／payment month只是彙整或清償期間。
- Due date 是 obligation timeline 的日期，不得自動取代 purchase／service date。
- 官方 reversal／corrected transaction 可 supersede recognition date；修正需保留舊 evidence。
- 來源只提供月份而無精確日期時，保存來源精度並揭露 limitation；不得捏造日。
- 任何 consumer 都必須明示使用的 timeline，不得以單一 `transaction_date` 同時冒充三者。

## Authority And Review Matrix

| Class | Example | AI permission | Human requirement |
|---|---|---|---|
| A — Fact-preserving interpretation | 標準 category、明確 card-payment exclusion、候選 recurring pattern | 可 preview／atomic commit，保留 AI authority、confidence、reason、unreviewed/reversible state | 有衝突、低信心或 human-owned target 時 review |
| B — Lifecycle link／cross-period meaning | Statement payment match、installment origin、loan allocation、transfer/reimbursement match | 可產生 proposal與 preview；deterministic official link可依 typed contract commit | 多候選、跨 entity、會改變既有 confirmed period／position時確認 |
| C — Authority／identity／global completeness／destructive recovery | Merge、declare complete、reverse run、replace DB | 只能建立 proposal | 必須沿用 browser-bound human confirmation receipt |
| D — Unsupported／unknown | 無來源的用途、schedule、split、配對 | 不得 commit猜測 | 保持 Unknown／partial；使用者可提供新 evidence或確認 owner-unresolved |

不使用單一 confidence 數字取代上述影響類型。Confidence 只在同一 authority／impact class內幫助排序。

## Failure And Recovery

- Unknown schema、unsupported owner/action、missing source、identity conflict、stale version 或 human-owned target：fail closed。
- Compound preview 任一 section 不一致時 canonical writes 為零；不可留下半套 obligation links。
- Report mismatch 先回到 semantic／match owner；不得用 UI filter、hardcoded adjustment 或改 source amount讓表面對上。
- 新 evidence 以 correction、supersession、match state或 confirmed reversal處理；source facts與 audit不 hard delete。
- 若現有 typed owners無法表達必要事實，先記錄 capability gap、consumer、migration與rollback；未核准前保持 partial。

## Acceptance Examples

1. Given NT$12,000 card merchant charge converted to 12 installments, when original charge and three deductions are in scope, then P&L expense is NT$12,000 once, cash shows only posted settlements, and remaining installment entries stay as obligations。
2. Given bank card payment NT$10,000 and matched card statement, then P&L expense does not increase, cash outflow is NT$10,000, and card liability settlement is traceable。
3. Given loan payment NT$11,000 with verified NT$9,500 principal＋NT$1,300 interest＋NT$200 fee, then cash outflow is NT$11,000, P&L expense is NT$1,500, and principal liability falls NT$9,500。
4. Given loan payment NT$11,000 without allocation evidence, then cash outflow remains NT$11,000 while P&L and liability allocation stay partial。
5. Given own-account transfer with only an outflow leg, then cash activity retains the outflow, consolidated cash flow is unreconciled, and P&L does not invent an expense。
6. Given a work expense and later matched reimbursement, then both source facts remain gross and drillable; a derived net burden may be shown, but reimbursement is not silently classified as business revenue。
7. Given owner confirms a posted row can no longer be identified, then cash remains reconcilable, confirmed P&L excludes it, and report coverage remains partial。

## Test Mapping

```yaml
test_mapping:
  planned_shared_kernel:
    - test/financial-event-semantics.test.js
  existing_regression:
    - test/reporting-income-statement.test.js
    - test/credit-card-installments.test.js
    - test/liability-storage.test.js
    - test/transfer-matching.test.js
    - test/owner-unresolved-transactions.test.js
    - test/transaction-ai-classification.test.js
  integration:
    - test/compound-ingestion.test.js
    - test/ingestion-reversal.test.js
  manual_later:
    - One synthetic source-to-three-views workflow before real-data acceptance.
```

## Implementation Status And Evidence

- **Contract frozen（MP-00, 2026-07-16）：** 三時間線、decision table、authority/review matrix與 failure behavior 已定義。
- **Existing evidence：** Card payment exclusion、installment obligation ownership、loan partial handling、transfer elimination、owner-unresolved與 typed preview/reversal 已分散存在於上述 contracts／tests。
- **MP-01 complete（2026-07-16）：** `lib/finance/semantics/financial-events.js`提供pure三時間線角色、loan allocation validation與共用report exclusion；`test/financial-event-semantics.test.js`提供focused proof。MP-02／MP-05後，typed obligation／reconciliation與三張management reports均已接入此語意；正式DB升級與owner acceptance仍由MP-07負責。

## Intentional Changes

- 把既有專門契約的共同事件角色提升為單一 Foundation contract，防止報表、AI與 obligation owner各自推論。
- 明定 installment statement/due month 不取代原 merchant recognition date。
- 明定 reimbursement 保存 gross facts，net burden只能是可追蹤 derived explanation。
- 明定 owner-unresolved可對 cash，但不能讓 P&L或 readiness假裝完整。

## Update Trigger

Economic／cash／obligation role、date policy、authority precedence、proposal envelope、typed owner、report basis或 recovery path改變時更新本文，並同步 master plan、專門 consumer contracts、tests與 Last Say Skill。單一商家名稱、分類規則或 UI 文案不應修改本契約。

## Open Questions

None for MP-00／MP-01。個別真實資料若缺原始購買、allocation或match evidence，依本文維持Unknown／partial，不改共用語意。
