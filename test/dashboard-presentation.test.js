import assert from "node:assert/strict"
import test from "node:test"

import {
  dashboardStatus,
  dashboardTasks,
  investmentShareOfNetWorthBps,
  knownMonthlyCommitmentsMinor,
  liabilityShareBps,
  monthlyObligationSummary,
  spendingToIncomeBps,
} from "../lib/finance/control/dashboard-presentation.js"

test("monthly commitments only sum known fixed monthly facts", () => {
  const spending = {
    facts: {
      confirmed_commitments: [
        { cadence: "monthly", amount_kind: "fixed", amount_minor: 1_000_000, currency: "TWD" },
        { cadence: "monthly", amount_kind: "fixed", amount_minor: 600_000, currency: "TWD" },
        { cadence: "yearly", amount_kind: "fixed", amount_minor: 12_000_000, currency: "TWD" },
        { cadence: "monthly", amount_kind: "range", amount_min_minor: 100, currency: "TWD" },
      ],
    },
  }

  assert.equal(knownMonthlyCommitmentsMinor(spending), 1_600_000)
  assert.equal(knownMonthlyCommitmentsMinor(null), null)
})

test("dashboard status treats missing position detail as a real gap without requiring an optional scenario", () => {
  const health = {
    coverage: { status: "partial", warnings: [{ kind: "missing_investment_position_detail" }] },
    facts: {
      position: {
        total_assets_minor: "206543884",
        total_liabilities_minor: "81816600",
        net_worth_minor: "124727284",
      },
      investments: { factor_exposure_minor: null },
    },
  }

  const result = dashboardStatus({ health, pulse: { coverage: { status: "partial" } } })
  assert.equal(result.title, "資產大於負債，但投資持倉明細尚未完整")
  assert.match(result.detail, /投資持倉明細/)
})

test("dashboard tasks translate internal blockers into plain-language actions", () => {
  const tasks = dashboardTasks({
    health: {
      coverage: {
        warnings: [
          { kind: "incomplete_debt_service_schedule" },
          { kind: "missing_investment_position_detail" },
        ],
      },
      facts: { investments: { factor_exposure_minor: null } },
    },
    pulse: {
      coverage: {
        blockers: [
          { kind: "unmatched_transfer", count: 4 },
          { kind: "unmatched_card_settlement" },
        ],
      },
    },
    spending: { facts: { proposed_reimbursements: [] } },
  })

  assert.deepEqual(tasks.map((item) => item.key), [
    "debt-schedule",
    "investment-exposure",
    "transaction-review",
  ])
  assert.equal(tasks[2].title, "整理待配對紀錄")
  assert.ok(tasks.every((item) => !/[a-z]+_[a-z_]+/.test(item.title)))
})

test("ratios remain unavailable when their denominator is missing", () => {
  assert.equal(spendingToIncomeBps({ facts: { management_pl: { confirmed_revenue_minor: null, confirmed_expense_minor: "10" } } }), null)
  assert.equal(liabilityShareBps({ facts: { position: { total_assets_minor: null, total_liabilities_minor: "10" } } }), null)
  assert.equal(spendingToIncomeBps({ facts: { management_pl: { confirmed_revenue_minor: "3000500", confirmed_expense_minor: "1781300" } } }), 5937)
  assert.equal(investmentShareOfNetWorthBps({ facts: { position: { net_worth_minor: "10000" }, investments: { balance_sheet_investment_value_minor: "2500" } } }), 2500)
  assert.equal(investmentShareOfNetWorthBps({ facts: { position: { net_worth_minor: "0" }, investments: { balance_sheet_investment_value_minor: "2500" } } }), null)
})

test("monthly survival line stays unknown when debt schedule or essential spending policy is missing", () => {
  const summary = monthlyObligationSummary({
    spending: {
      facts: {
        confirmed_commitments: [
          { cadence: "monthly", amount_kind: "fixed", amount_minor: "1600000", currency: "TWD" },
        ],
      },
    },
    health: {
      facts: {
        liquidity: {
          known_monthly_debt_service_minor: null,
          known_monthly_debt_service_status: "partial",
        },
      },
    },
  })

  assert.equal(summary.fixed_commitment_minor, 1600000)
  assert.equal(summary.known_fixed_and_debt_minor, null)
  assert.equal(summary.survival_line_minor, null)
  assert.deepEqual(summary.missing_components, ["debt_service_schedule", "essential_living_spend_policy"])
})
