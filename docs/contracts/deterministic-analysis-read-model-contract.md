---
schema_version: behavior-contract/v1
id: finance.control.deterministic-analysis-read-model
title: Deterministic Analysis Read Model Contract
status: active
owner_surface: shared
owner_approval_required: false
last_validated_against_repository: 2026-07-17
change_context:
  type: feature
  reason: 固定第二階段分析表的查詢時重算、來源追溯、coverage與AI邊界，避免每張表各自發明輸出或依賴AI臨時計算。
  non_goals:
    - 不改動既有Income Statement、Balance Sheet或Cash Flow public response。
    - 不新增canonical transaction、account、asset、liability、investment或report snapshot tables。
    - 不在本切片建立Monthly Pulse、Spending Structure、Control UI或runtime API。
    - 不加入background refresh、WebSocket、AI provider或報表持久化。
---

# Deterministic Analysis Read Model Contract

## Change Context

Owner於2026-07-17確認：分析表在使用者查詢時，應依當下canonical data直接重算；AI是資料輸入與模糊語意協作者，不是日常報表計算器。本契約把該決策固定為`FC-A1`的共用行為邊界。

## Behavior Boundary

本契約適用於`FC-A2`及之後新增的Monthly Financial Pulse、Spending Structure、Reimbursement Burden、Net-worth Bridge及其他Control analysis read models。每個read model均為read-only projection：接收明確scope，讀取現有canonical facts與typed relationships，在同一request內計算結果並回傳coverage、watermarks與drillback。

既有三張正式management reports保留自己的query與public contract。新analysis可以組合或抽取其共用pure semantics，但不得複製accounting分類、card／loan／transfer排除或FX規則形成第二套真相。

## Consumers And Entrypoints

- Planned query owners：`lib/queries/finance/control/**`。
- Planned API owners：`app/api/finance/control/**`。
- Planned UI consumers：`components/financial-control/**`。
- AI consumer：named analysis context或Last Say operator只讀同一read model，再提供解釋；不得自行重算不同總額。
- Existing source owners：
  - `lib/queries/reports/income-statement.js`
  - `lib/queries/reports/balance-sheet.js`
  - `lib/queries/reports/cash-flow.js`
  - `lib/reporting/report-lines.js`
  - `lib/reporting/coverage.js`
  - `lib/queries/finance/analysis-context.js`
  - foundation account、balance、obligation、investment、reconciliation與reimbursement queries。
- FC-A1 evidence fixture：`test/fixtures/financial-control/deterministic-analysis-response.json`。

## Inputs And State

每個request必須明確或由response揭露default：

- `analysis_id`與其`formula_version`；
- `entity_id`；
- period型分析的`period_start／period_end`，或position型分析的`as_of_date`；
- `currency`；
- account／entity scope與必要的basis；
- 若consumer需要owner policy，必須傳入可追溯的`policy_version`；沒有policy時對應metric為unknown／unavailable。

State只來自canonical DB及已確認typed relationships。候選、proposed match、unreviewed AI inference與missing source可以出現在`candidates／coverage`，但不能進入confirmed subtotal。

不同資料各有自己的權威：交易與mapping改變期間收支；balance snapshot改變position與cash boundary；holding／quote／FX改變valuation；card／liability／commitment facts改變obligation；confirmed match改變排除、allocation與reconciliation。Read model不得用其中一種資料猜另一種資料。

## Outputs And Side Effects

新analysis response至少包含：

```json
{
  "schema_version": "finance.analysis-read-model/v1",
  "analysis_id": "monthly_financial_pulse",
  "formula_version": "monthly-financial-pulse/1",
  "scope": {
    "entity_id": "personal",
    "period_start": "2026-06-01",
    "period_end": "2026-06-30",
    "as_of_date": null,
    "currency": "TWD",
    "basis": "card_accrual_management",
    "defaulted_fields": []
  },
  "source_watermark": {},
  "coverage": {
    "status": "empty | unmapped | partial | unreconciled | complete",
    "blockers": [],
    "warnings": []
  },
  "facts": {},
  "derived": {},
  "candidates": [],
  "drillback": {}
}
```

- Analysis-specific fields放在`facts／derived`；共用scope、coverage與provenance不得藏進analysis-specific payload。
- Canonical money一律為帶`_minor`後綴的integer decimal string或`null`；ratio使用可重現decimal/rational表示。
- `source_watermark`至少能識別此次結果所依賴的source／fact版本；formula或policy改變時另由`formula_version／policy_version`辨識。
- `drillback`必須能回到transaction、snapshot、holding、quote、match、commitment、policy或其他canonical resource key。
- Query沒有DB write、file write、AI／network call、timer、notification或background mutation。
- 若未來加入operational response timestamp，該欄位不得參與semantic equality，也不能取代source watermark。

## UI States

FC-A1沒有browser surface。未來consumer必須支援：

- first paint／loading：保留前一個已標示scope的結果或顯示skeleton，不把0當載入值；
- ready／complete：顯示confirmed totals與drillback；
- empty：指出下一個必要輸入；
- partial／unmapped／unreconciled：顯示已知subtotal與blockers，不顯示完整或安全結論；
- error：保留request scope並可重試；
- stale-on-screen：資料寫入後的下一次fetch必須重算；是否自動觸發refetch由UI invalidation package負責，不改變query semantics。

## Invariants

1. **Query-time recomputation：** 每次API request直接讀取當下canonical DB；不以materialized report、AI answer或client state作durable truth。
2. **No AI hot path：** 關閉網路與AI provider後仍可產生相同complete或誠實降級的response。
3. **Deterministic replay：** 同一DB state、request、formula與policy version產生semantic-equivalent response。
4. **Fresh next read：** 新增、修正、確認或反轉相關canonical fact後，下一次相同request反映新state與watermark，不需要prompt。
5. **Unknown is not zero：** missing、stale、conflicted、candidate與unreconciled值不能被轉成0或confirmed subtotal。
6. **Candidate separation：** proposed transfer／reimbursement／recurring／classification只出現在candidate或blocker；確認後才由typed owner進入計算。
7. **Single semantic owner：** card charge／payment、loan principal／interest、internal transfer、investment cash與reimbursement在P&L、Cash Flow、position與Control中不可重複或互相矛盾。
8. **As-of and period stability：** 查詢只納入scope內有效facts；晚匯入但economic date落在期間內的資料會在下一次查詢反映，期間外資料不影響結果。
9. **Snapshot boundary：** 新交易不會自行改寫position snapshot；缺新snapshot時顯示舊watermark／stale或partial，而不是用交易running balance假造正式餘額。
10. **Server ownership：** UI只格式化、篩選與drill down，不重新分類或加總canonical rows。

## Acceptance Examples

1. Given同一月份已有confirmed收入與費用，when新增一筆期間內confirmed費用，then下一次相同查詢的費用增加、淨收支下降、watermark改變，且不呼叫AI。
2. Given一筆proposed報銷，when查詢Monthly Pulse，then它出現在`candidates`但confirmed reimbursement仍不變；owner確認match後的下一次查詢才進入回收與net burden。
3. GivenCash Flow缺期初snapshot，when查詢期間分析，then已知交易subtotal仍可顯示但coverage=`partial`，期初現金與reconciled cash change不會被填0。
4. Given新增較新的eligible FX quote，when以相同as-of重新查詢跨幣position，thenbase-currency valuation與FX watermark更新；原幣fact不被覆寫。
5. GivenAI完成structured import並commit，when使用者開啟或refetch報表，thenserver read model直接讀新facts；不需要AI再次分析。

## Test Mapping

```yaml
test_mapping:
  contract_fixture:
    - test/fixtures/financial-control/deterministic-analysis-response.json
  focused:
    - test/deterministic-analysis-contract.test.js
  existing_regression:
    - test/reporting-three-view.test.js
    - test/reporting-scope-contract.test.js
    - test/analysis-context-api.test.js
    - test/control-cash-timeline.test.js
  first_runtime_consumer:
    - test/control-monthly-financial-pulse.test.js
    - e2e/monthly-financial-pulse.spec.js
  future_runtime:
    - test/control-spending-structure-api.test.js
```

## Evidence

- Current report routes每次GET直接呼叫query owner：`app/api/reports/**/route.js`。
- Current report hooks依request params重新fetch：`lib/hooks.js`。
- Shared accounting semantics：`lib/reporting/report-lines.js`與`lib/reporting/coverage.js`。
- Named bounded AI context與watermarks：`lib/queries/finance/analysis-context.js`。
- First runtime consumer：`lib/queries/finance/control/monthly-pulse.js`、`app/api/finance/control/monthly-pulse/route.js`與`components/financial-control/MonthlyPulseView.jsx`。
- Plan owner與work packages：`docs/plans/master-financial-control-plan.md#1710-報表產品化與計算責任`。

## Intentional Changes

- 新增`finance.analysis-read-model/v1`作為Control analysis的共用envelope；FC-A2已成為第一個consumer，既有三張report response不變。
- 新analysis canonical money固定為minor-unit string；不延續legacy Overview的float／major-unit欄位。
- 將「UI是否自動refetch」與「query是否讀最新資料」拆開；FC-A1只保證後者。

## Open Questions

- 第一個runtime consumer使用`last-say:data-changed`browser event觸發refetch；未來若改為query cache invalidation，仍必須保持read-through與相同watermark語意。
- 是否需要保存historical report exports屬日後audit/export需求；即使保存，也只能是帶formula／source watermark的artifact，不能取代canonical facts。

## Update Trigger

新增analysis envelope欄位、money representation、scope／coverage、watermark、drillback、AI boundary、cache semantics或第一個runtime consumer時更新。
