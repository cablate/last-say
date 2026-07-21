function coverageItems(coverage) {
  return [...(coverage?.blockers || []), ...(coverage?.warnings || [])]
}

function hasCoverageKind(coverage, ...kinds) {
  const wanted = new Set(kinds)
  return coverageItems(coverage).some((item) => wanted.has(item?.kind))
}

function finiteMinor(value) {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function knownMonthlyCommitmentsMinor(spending, currency = "TWD") {
  const commitments = spending?.facts?.confirmed_commitments
  if (!Array.isArray(commitments)) return null

  return commitments.reduce((total, item) => {
    if (item?.cadence !== "monthly" || item?.amount_kind !== "fixed") return total
    if ((item?.currency || currency) !== currency) return total
    const amount = finiteMinor(item?.amount_minor)
    return amount === null ? total : total + amount
  }, 0)
}

export function monthlyObligationSummary({ spending, health, currency = "TWD" } = {}) {
  const fixedCommitmentMinor = knownMonthlyCommitmentsMinor(spending, currency)
  const debtServiceMinor = finiteMinor(health?.facts?.liquidity?.known_monthly_debt_service_minor)
  const debtServiceStatus = health?.facts?.liquidity?.known_monthly_debt_service_status || "unavailable"
  const debtServiceComplete = debtServiceStatus === "known" && debtServiceMinor !== null
  return {
    fixed_commitment_minor: fixedCommitmentMinor,
    known_debt_service_minor: debtServiceMinor,
    debt_service_status: debtServiceStatus,
    known_fixed_and_debt_minor: fixedCommitmentMinor === null || !debtServiceComplete
      ? null
      : fixedCommitmentMinor + debtServiceMinor,
    survival_line_minor: null,
    missing_components: [
      ...(!debtServiceComplete ? ["debt_service_schedule"] : []),
      "essential_living_spend_policy",
    ],
  }
}

export function spendingToIncomeBps(pulse) {
  const revenue = finiteMinor(pulse?.facts?.management_pl?.confirmed_revenue_minor)
  const expense = finiteMinor(pulse?.facts?.management_pl?.confirmed_expense_minor)
  if (revenue === null || expense === null || revenue <= 0) return null
  return Math.round((expense / revenue) * 10_000)
}

export function dashboardStatus({ health, pulse } = {}) {
  const position = health?.facts?.position || {}
  const assets = finiteMinor(position.total_assets_minor)
  const liabilities = finiteMinor(position.total_liabilities_minor)
  const netWorth = finiteMinor(position.net_worth_minor)
  const healthCoverage = health?.coverage
  const pulseCoverage = pulse?.coverage
  const missingExposure = hasCoverageKind(
    healthCoverage,
    "missing_investment_position_detail",
    "selected_investment_unvalued",
  )
  const incompleteDebt = hasCoverageKind(
    healthCoverage,
    "incomplete_debt_service_schedule",
    "missing_liability_balance",
  )
  const missingBoundaries = hasCoverageKind(pulseCoverage, "missing_balance_snapshot")

  if (assets === null || liabilities === null || netWorth === null) {
    return {
      tone: "unknown",
      title: "資料還不足，暫時無法判斷整體財務狀況",
      detail: "先補齊帳戶、負債與投資餘額；缺資料的部分不會被當成 0。",
    }
  }

  if (netWorth < 0) {
    return {
      tone: "danger",
      title: "目前負債高於資產，需要先處理現金與還款壓力",
      detail: "先確認近期還款、必要支出與可用現金，再評估新增投資。",
    }
  }

  const gaps = []
  if (incompleteDebt) gaps.push("貸款還款排程仍未完整")
  if (missingExposure) gaps.push("投資持倉明細仍未完整")
  if (missingBoundaries) gaps.push("部分帳戶缺少月份邊界餘額")

  if (incompleteDebt) {
    return {
      tone: "positive",
      title: "資產大於負債，但每月還款壓力尚未完整",
      detail: `${gaps.slice(0, 2).join("；")}。`,
    }
  }

  if (missingExposure) {
    return {
      tone: "positive",
      title: "資產大於負債，但投資持倉明細尚未完整",
      detail: `${gaps.slice(0, 2).join("；")}。`,
    }
  }

  if (healthCoverage?.status !== "complete" || pulseCoverage?.status !== "complete") {
    return {
      tone: "positive",
      title: "資產大於負債，仍有資料待補齊",
      detail: gaps.length ? `${gaps.slice(0, 2).join("；")}。` : "目前可先看已知數字，未完成的部分仍保持未知。",
    }
  }

  return {
    tone: "positive",
    title: "資產大於負債，主要資料已可使用",
    detail: "儀表板會在交易、餘額或估值更新後重新計算。",
  }
}

export function dashboardTasks({ health, pulse, spending } = {}) {
  const tasks = []
  const healthCoverage = health?.coverage
  const pulseCoverage = pulse?.coverage
  const proposedReimbursements = spending?.facts?.proposed_reimbursements

  if (Array.isArray(proposedReimbursements) && proposedReimbursements.length > 0) {
    tasks.push({
      key: "reimbursements",
      title: `確認 ${proposedReimbursements.length} 筆報銷`,
      description: "確認後才會從個人支出扣回。",
      href: "/confirmations",
    })
  }

  if (hasCoverageKind(healthCoverage, "incomplete_debt_service_schedule", "missing_liability_balance")) {
    tasks.push({
      key: "debt-schedule",
      title: "補齊貸款還款排程",
      description: "目前每月義務只是已知下限。",
      href: "/data?tab=obligations",
    })
  }

  if (hasCoverageKind(healthCoverage, "missing_investment_position_detail", "selected_investment_unvalued")) {
    tasks.push({
      key: "investment-exposure",
      title: "補齊投資持倉明細",
      description: "完成後才能把市值對應到實際標的。",
      href: "/data?tab=investments",
    })
  }

  if (hasCoverageKind(
    pulseCoverage,
    "unmatched_transfer",
    "unmatched_card_settlement",
    "missing_loan_allocation",
  )) {
    tasks.push({
      key: "transaction-review",
      title: "整理待配對紀錄",
      description: "避免轉帳、卡費或貸款重複算成支出。",
      href: "/transactions?view=needs-review",
    })
  }

  if (hasCoverageKind(pulseCoverage, "missing_balance_snapshot")) {
    tasks.push({
      key: "balance-boundary",
      title: "補齊月份邊界餘額",
      description: "補齊後才能完整核對現金流。",
      href: "/data?tab=accounts",
    })
  }

  return tasks.slice(0, 3)
}

export function liabilityShareBps(health) {
  const assets = finiteMinor(health?.facts?.position?.total_assets_minor)
  const liabilities = finiteMinor(health?.facts?.position?.total_liabilities_minor)
  if (assets === null || liabilities === null || assets <= 0) return null
  return Math.max(0, Math.round((liabilities / assets) * 10_000))
}

export function investmentShareOfNetWorthBps(health) {
  const investments = finiteMinor(health?.facts?.investments?.balance_sheet_investment_value_minor)
  const netWorth = finiteMinor(health?.facts?.position?.net_worth_minor)
  if (investments === null || netWorth === null || netWorth <= 0) return null
  return Math.max(0, Math.round((investments / netWorth) * 10_000))
}
