# Financial Control Metric Dictionary

用途：固定 Financial Control Track 的指標語意、資料時間點、coverage 與 unknown policy，避免未來 API、UI、AI 或測試各自發明算法。

Status: Draft — owner approval required
Authority: `docs/plans/master-financial-control-plan.md` + Phase 0 behavior contracts
Last validated: 2026-07-15

## Shared Rules

- 所有 money 使用 currency + integer minor-unit string；ratio 才可使用 deterministic decimal/rational 計算。
- `as_of_date` 是 source facts 的查詢截止日；forecast horizon 以該日為 day 0，預設候選值 90 天但仍是 explicit policy input。
- `unknown`、missing、stale、conflicted 與 unreconciled 不得自動變成 0。
- Coverage=`empty|partial|unreconciled` 時不得顯示安全綠燈或假精準 safe-to-spend。
- Dependable income 必須符合 owner-confirmed policy；期待收入／未確認案款不得抵銷保守情境風險。
- Card merchant expense、card liability、card payment；loan principal、interest、cash payment必須保持 cross-context consistency，不重複認列。

## Metric Definitions

| Metric | Definition / numerator | Denominator / comparison | As-of / horizon | Coverage requirement | Unknown policy | Phase 0 evidence |
|---|---|---|---|---|---|---|
| `projected_cash[d]` | opening liquid cash + dependable inflows through d − committed outflows through d − explicitly included modeled outflows | none | daily from as-of through horizon | may show known path when partial, with gaps | unknown committed outflow remains blocker; uncertain inflow excluded from conservative path | `project-cash-timeline.js`, post-style fixture |
| `minimum_projected_cash` | minimum closing `projected_cash[d]` | none | selected horizon | same as forecast | label as minimum of known projection when partial | fixture expected `5800000` TWD minor |
| `reserve_floor[d]` | max of enabled fixed amount / essential-N-days / protected-account policies | projected cash comparison | daily | owner policy required | absent policy = unknown; never assume zero | fixture supplies explicit fixed floor only |
| `headroom[d]` | projected cash[d] − reserve floor[d] − uncertainty buffer[d] | none | daily | forecast path available | unknown buffer means safe-to-spend unavailable | fixture buffer is explicit zero for reference only |
| `safe_to_spend` | max(0, minimum headroom within horizon), adjusted for payment-instrument semantics | none | horizon | complete + reconciled + approved policy | partial/unreconciled/unknown policy → null/range, never 0-as-answer | Phase 0 does not expose a runtime value |
| `first_reserve_breach_date` | first d where projected cash[d] < reserve floor[d] | strict `<`; equality is not breach | horizon | known path may expose provisional date | unknown outflow can make date earlier; mark partial | fixture expected 2026-08-05 |
| `cash_runway_days` | day difference from as-of to first reserve breach | first breach date | horizon | same as breach metric | no breach means “not within horizon”, not forever safe | fixture expected 21 days |
| `debt_service_ratio` | confirmed monthly debt payments | dependable monthly income | calendar month | denominator known and >0 | unknown/zero dependable income → unavailable, not infinity or 0 | contract only; runtime later |
| `fixed_burden_ratio` | essential fixed outflows + debt payments | dependable income | calendar month | classified/confirmed obligations | missing commitment scope → partial/unavailable | contract only; runtime later |
| `forecast_coverage` | categorical result from opening scope, freshness, obligations, reconciliation and policy | no numeric denominator | as-of + horizon | always emitted | gaps remain machine-readable | fixture expected partial due stale card + unknown amount |
| `discretionary_spend_pace` | period discretionary spend by transaction/economic date | owner-confirmed guardrail amount | guardrail cadence | reviewed classification + configured guardrail | no guardrail → unavailable; do not invent percentage | contract only; runtime later |

## Coverage Decision Table

| Status | Minimum conditions | Allowed output | Prohibited output |
|---|---|---|---|
| `empty` | no eligible opening liquid cash or account scope | missing-input actions | safe-to-spend / safety status |
| `partial` | known path exists but stale/missing/unknown required inputs remain | known timeline, gaps, provisional minimum/breach | “complete”, green safety, exact safe-to-spend |
| `unreconciled` | inputs exist but cash/transfer/obligation equation fails | delta, source drilldown | trusted control decision |
| `complete` | scope, freshness, obligations, reconciliation and required policy pass | deterministic metrics and alerts | claims beyond selected horizon |

## Owner Decisions Still Required

1. Which accounts count as liquid/near-liquid for reserve and safe-to-spend.
2. Reserve-floor method and protected-account amounts.
3. Dependable-income eligibility and probation window.
4. Whether/how modeled variable outflows and uncertainty buffer enter conservative forecast.
5. Freshness thresholds by source type.
6. Guardrail cadence/amount and alert severity/cooldown.

Until approved, these remain request policy fields or `Unknown`; no default may be marketed as the owner’s financial rule.

## Change Control

Any formula change must update the owning behavior contract, synthetic fixture expected output, pure/unit tests, API/UI copy and `master-financial-control-plan.md` traceability. A new UI label alone cannot redefine a metric.

更新觸發：formula、policy input、coverage、time semantics、source owner、payment-instrument treatment 或 owner decision改變時。
