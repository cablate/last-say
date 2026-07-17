# Financial Analysis Recipes

Use these recipes after the mandatory `health -> capabilities -> readiness`
preflight. They are operator procedures, not permission to invent missing facts or
write derived analysis into a second canonical store.

## Required Answer Order

Every financial-analysis answer follows this order:

1. goal, entity/account scope, period or as-of date, currency, and report basis;
2. readiness and coverage status, source/resource watermarks, and exclusions;
3. sourced facts;
4. deterministic derived values and the exact formula;
5. AI interpretation, clearly labelled as interpretation;
6. material gaps, blockers, and the smallest next typed action.

Never lead with a confident recommendation when readiness is partial,
unreconciled, stale, conflicted, or unsupported.

## Fixed And Variable Spend

1. Request `spending_history` readiness for the target entity and period.
2. Read the management P&L plus named `cash_activity`, `recurring_candidates`,
   `statement_blockers`, and confirmed commitments when advertised.
3. Treat a user-confirmed commitment as fixed. A repeated merchant pattern is
   only a recurring candidate until its cadence and business meaning are
   confirmed. Do not call every repeated purchase mandatory.
4. Exclude card settlements, loan principal, investing cash, and confirmed own
   transfers from economic spend. Keep owner-unresolved cash in a separate
   disclosed bucket.
5. Report fixed confirmed total, variable observed total, candidate total, and
   unresolved amount separately; include drillback keys and coverage.

## Work, Personal, And Reimbursement

1. Keep objective ownership/category evidence separate from subjective spending
   judgment. Use existing transaction classifications and typed reimbursement
   matches; do not infer a business purpose from a merchant name alone.
2. Preserve gross expense and gross reimbursement cash facts. A confirmed match
   explains recovery; it does not delete either source transaction.
3. Report personal expense, work expense, confirmed reimbursement allocation,
   unallocated reimbursement, and unmatched candidates separately.
4. Missing receipts, trip/event identity, or reimbursement remainder keeps the
   answer partial and belongs in `missing evidence`, not a guessed net expense.

## Descriptive Income Floor

`reliable income`, a safety threshold, and future safe-to-spend policy are not
Foundation capabilities. Do not label a historical number safe or guaranteed.

For a descriptive historical floor only:

1. Require complete or explicitly scoped income periods and the management P&L.
2. Exclude own transfers, refunds that merely reverse expenses, loan proceeds,
   investment cash, owner-unresolved inflows, and unmatched reimbursements.
3. Show each included period, then calculate the requested minimum/median using
   those observed periods. State sample count and missing months.
4. Call the result `observed historical income floor`, not reliable income. If
   the user asks what income is safe for the future, return the readiness gap and
   defer policy to the future Financial Control phase.

## Installment Audit

1. Read the originating purchase, card statement item, installment plan and
   entries, payment matches, and statement blockers through typed datasets.
2. The original purchase is one economic expense. Installment entries are future
   obligations; card payments are cash settlements. Never repeat principal as a
   new expense each month.
3. Interest and fees enter P&L only when explicitly sourced. Do not derive them
   from APR or a payment difference.
4. Report original principal, scheduled/settled/unmatched entries, cash paid,
   explicit interest/fees, remaining sourced obligation, and blockers with
   resource watermarks.

## Unresolved Transfers

1. Read transfer candidates and existing matches. Verify direction, entity,
   account, currency, amount allocation, date window, current version, and both
   transaction keys.
2. Confirm/reject only through the versioned transfer owner. A one-sided transfer
   cannot be confirmed; keep its cash leg and report the missing counterpart.
3. Never force a match to make a cash-flow reconciliation delta equal zero.
4. After a typed decision, re-read reconciliation and the review workbench.

## Statement Readiness And Three-View Bridge

1. Use the same entity, currency, period end/as-of date, and account scope for
   management P&L, cash flow, and balance sheet.
2. Read each report's coverage, blockers, watermarks, and drillback IDs before
   comparing totals. `empty`, `unmapped`, `partial`, and `unreconciled` are not
   complete.
3. Explain differences by timeline:

   - P&L: economic recognition;
   - cash flow: settlement date and cash account movement;
   - balance sheet/obligations: position as-of and future due state.

4. Card charge versus payment, loan principal versus interest, own transfer,
   investment purchase, reimbursement, and owner-unresolved rows must follow the
   typed semantic rules. No hardcoded adjustment may be added just to tie totals.
5. If a difference cannot be traced to a source key, transaction key, snapshot
   key, valuation/FX key, match key, or named blocker, report it as unexplained
   and keep coverage partial/unreconciled.

## Financial Health Review v0

Use this for questions about current financial position, liquidity, debt capacity,
investment exposure, or stress scenarios.

1. Run `health -> capabilities -> readiness` for the requested entity, as-of date,
   and relevant goals before interpreting any number.
2. Call the advertised
   `GET /api/finance/control/financial-health` read model first. Supply the exact
   instrument keys and any owner-provided leverage/sensitivity assumption; never
   silently treat all Taiwan investments or all investments as one factor.
3. Give the AI Context Pack's `facts` and `derived` to the AI before any raw
   transaction or holding dataset. Keep `facts`, formulas, assumptions, and AI
   interpretation in separate sections.
4. Use `coverage`, `source_watermark`, and `drillback` to state what is known,
   stale, missing, or only assumed. `null` is unavailable, not zero.
5. For v0, treat runway, reliable income, essential spend, safe-to-spend, and
   buy/hold/sell or repay/invest thresholds as unresolved unless separate evidence
   and an owner-approved policy exist.
6. Validate the same Context Pack against concrete user questions before adding
   a second metric or a full Control Center surface.

## Human Review Handoff

Use `GET /api/finance/review-workbench` to describe the smallest material human
decision. External AI may prepare evidence and a suggested typed action, but it
must stop for browser-bound high-risk confirmation and must not call generic task
closure for a transfer, reimbursement, commitment, or source conflict.
