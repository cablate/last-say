---
schema_version: behavior-contract/v1
id: finance.control.financial-health-review
title: Financial Health Review v0 Contract
status: active
owner_surface: analysis
owner_approval_required: false
last_validated_against_repository: 2026-07-17
change_context:
  type: feature
  reason: 將個人財務健康、負債與投資曝險的第一個最小分析切片做成查詢時重算的Context Pack，供AI解讀而不是每次拉原始資料自行計算。
  non_goals:
    - 不新增canonical account、balance、liability、investment、transaction或report snapshot table。
    - 不建立完整Financial Control Center、safe-to-spend、可靠收入、必要支出政策或90日forecast。
    - 不把所有台股、所有投資或所有負債無標籤合併成單一曝險數字。
    - 不讓AI或UI在本read model之外重算財務公式。
---

# Financial Health Review v0 Contract

## Change Context

`FA-0`是目前資料基礎建設之上的第一個小型決策支援切片。它把既有Balance Sheet、liability profiles、card statements與investment positions組成單一可重算Context Pack，先回答「目前位置、流動性、負債服務、指定標的曝險與壓力」；它不宣稱已完成專業理財顧問或完整控制中心。

## Behavior Boundary

In scope：

- 指定`entity_id`、`as_of_date`與`currency`後，從既有canonical facts重新計算position、liquidity、debt與investment facts。
- 將貸款APR、當前負債餘額、可取得的下一期schedule payment與信用卡statement due分開揭露。
- 接受明確的`taiwan_instrument_keys`與`taiwan_leverage_factor` request assumption，計算指定因子曝險與-10%／-20% underlying stress loss。
- 回傳`coverage`、`source_watermark`與`drillback`；缺essential spend、reliable income或曝險假設時維持`null`／warning。
- 使用共享`finance.analysis-read-model/v1` envelope，讓AI只拿這個精簡Context Pack做解釋與選項比較。

Out of scope：

- 90日現金流預測、safe-to-spend、reserve policy、reliable income policy、完整支出必要性分析、net-worth bridge與persistent alerts。
- 將request assumption寫入DB或默認某個標的為使用者的正二部位。
- AI call、network call、DB write、file write、timer、cache或report persistence。
- 自動判斷「可以／不可以投資」或代替人類做買賣、還貸與高風險財務決定。

## Consumers And Entrypoints

- API：`GET /api/finance/control/financial-health`。
- Query owner：`lib/queries/finance/control/financial-health.js#getFinancialHealthReview`。
- Upstream owners：
  - `lib/queries/reports/balance-sheet.js#getBalanceSheet`
  - `lib/queries/finance/obligations.js#listLiabilities`
  - `lib/queries/finance/obligations.js#listCreditCards`
  - `lib/queries/finance/investments.js#investmentPositions`
- AI consumer：Last Say operator透過named API取得Context Pack，再將facts、derived、assumptions與coverage分層說明。
- Synthetic fixture：`test/fixtures/financial-control/financial-health-review.json`。

## Inputs And State

- `as_of_date`：optional，default local date並揭露於`scope.defaulted_fields`。
- `entity_id`：optional，default`personal`。
- `currency`：optional，default`TWD`。
- `taiwan_instrument_keys`：optional comma-separated instrument keys；未提供時不猜測台灣曝險。
- `taiwan_leverage_factor`：optional canonical decimal string；只有同時提供instrument keys才接受，且以`facts.investments.analysis_assumptions`標示為request assumption，不是canonical fact。
- State只讀既有balance snapshots、holdings、quotes／FX、liability profiles／schedules、card statements與source watermark。

## Outputs And Side Effects

Response固定為`finance.analysis-read-model/v1`，`analysis_id=financial_health_review`，`formula_version=financial-health-review/1`。

`facts`至少包括：

- `position`：balance-sheet total assets、liabilities、net worth、equation delta。
- `liquidity`：已知cash、cash minus confirmed liabilities、可取得的known debt service與明確的runway unavailable狀態。
- `debt`：confirmed liability lines、profiles、APR、annualized interest estimate、next scheduled payment、card statement due與unsupported obligations。
- `investments`：balance-sheet investment value、valued position value、largest positions、指定標的市值、factor exposure與request assumptions。

`derived`至少包括：

- liability／asset、cash／liability與factor exposure／net worth的basis-point ratios。
- 指定underlying下跌10%與20%的stress loss、stress後net worth與loss ratio。
- 所有公式以文字欄位說明；若必要輸入不存在，對應欄位為`null`。

Money欄位一律為integer minor-unit decimal string或`null`。本查詢不寫DB、不呼叫AI／網路、不建立報表快照；同一DB state與request應產生semantic-equivalent response。

## UI States

本v0沒有browser UI；API與AI handoff先行。未來UI若消費它，必須顯示partial／missing assumption，不能把`null`格式化為0，也不能自行重算stress或ratio。

## Invariants

1. 每次request直接查canonical DB；加入、修正、確認或反轉資料後，下一次相同request反映新結果。
2. Balance Sheet是position totals的semantic owner；本query不從transaction raw rows自行重算資產或負債。
3. APR與schedule只作debt context；不能因為有原始本金就假造current balance或還款剩餘期數。
4. 未提供標的範圍或槓桿因子時，不產生factor exposure或stress loss。
5. `taiwan_leverage_factor`只屬明示request assumption，不能被寫入canonical DB或呈現成quote／instrument fact。
6. Unknown、stale、conflicted、unsupported與partial coverage不能轉成0或無條件的安全結論。
7. AI只解讀Context Pack；不在工具外重新相加不同風險因子，也不能把AI answer回寫為財務事實。
8. 所有重要結果可透過`source_watermark`與`drillback`追到source／snapshot／holding／quote／liability／statement key。

## Acceptance Examples

1. Given bank balance 10,000 TWD、loan balance 5,000 TWD與指定ETF 2,000 TWD，when factor=2，then net worth、4,000 TWD factor exposure與10%／20% stress loss可重算且可追溯。
2. Given同一指定ETF但沒有factor，then market value仍顯示，factor exposure與stress loss為`null`並有`missing_leverage_factor` warning。
3. Given只有原始貸款本金沒有current balance snapshot，then profile保留本金與APR，但current balance與annualized interest estimate為`null`，coverage為partial。
4. Given貸款有current balance但沒有可用的下一期schedule，then balance與APR仍顯示，但debt service status與coverage維持partial，不用APR反推月付金。
5. Given沒有essential spend與reliable income，then runway不是0也不是假估值，而是`null`並列為v0缺口。
6. Given相同DB state與request，then response semantic hash與所有facts／derived一致；不會因查詢時間戳改變。

## Test Mapping

```yaml
test_mapping:
  contract_fixture:
    - test/fixtures/financial-control/financial-health-review.json
  focused:
    - test/control-financial-health.test.js
  regression:
    - test/deterministic-analysis-contract.test.js
    - test/reporting-three-view.test.js
```

## Evidence

- Existing position owner：`lib/queries/reports/balance-sheet.js`。
- Existing debt／card owners：`lib/queries/finance/obligations.js`。
- Existing holding valuation owner：`lib/queries/finance/investments.js`。
- Shared deterministic envelope：`docs/contracts/deterministic-analysis-read-model-contract.md`。
- Long-term direction：`Final-Long-Term-Goal.md#financial-analysis-and-decision-support-directionowner-confirmed-direction-2026-07-17`。

## Intentional Changes

- 新增`financial-health` query與GET route，作為FA-0第一個AI Context Pack來源。
- 新增synthetic-only contract fixture與focused tests。
- 不新增schema、migration、UI或正式DB資料。

## Open Questions

- 真正的標的／因子映射應由owner以canonical instrument identity、外部quote或明確policy決定；v0不把使用者口頭假設永久化。
- 是否加入收入中斷、必要支出與投資／還貸比較的policy thresholds，留待五個決策問題測試後決定。

## Update Trigger

調整公式、曝險假設、coverage、Context Pack欄位、API query params、drillback或AI handoff規則時，必須同步更新本契約、fixture與focused tests。
