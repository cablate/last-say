const { createHash } = require('node:crypto');

const { FinanceError, currency: validateCurrency } = require('../../../finance/contracts');
const { activeRecordSql } = require('../../../finance/active-records');
const { getDb } = require('../common');
const { getIncomeStatement } = require('../../reports/income-statement');
const { getCashFlow } = require('../../reports/cash-flow');

const ANALYSIS_ID = 'monthly_financial_pulse';
const FORMULA_VERSION = 'monthly-financial-pulse/1';
const BASIS = 'card_accrual_management';

function getParam(params, key) {
  if (!params) return null;
  if (typeof params.get === 'function') return params.get(key);
  return params[key] ?? null;
}

function normalizeScope(params) {
  const month = getParam(params, 'month');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) {
    throw new FinanceError('VALIDATION_ERROR', 'month must be one specific YYYY-MM value', {
      field: 'month',
    });
  }
  const entityId = getParam(params, 'entity_id') || 'personal';
  const reportCurrency = validateCurrency(getParam(params, 'currency') || 'TWD');
  const basis = getParam(params, 'basis') || BASIS;
  if (basis !== BASIS) {
    throw new FinanceError('VALIDATION_ERROR', `basis must be ${BASIS}`, { field: 'basis' });
  }
  const defaultedFields = [];
  if (!getParam(params, 'entity_id')) defaultedFields.push('entity_id');
  if (!getParam(params, 'currency')) defaultedFields.push('currency');
  if (!getParam(params, 'basis')) defaultedFields.push('basis');
  const [year, monthNumber] = month.split('-').map(Number);
  const endDay = String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0');
  return {
    month,
    entityId,
    currency: reportCurrency,
    basis,
    periodStart: `${month}-01`,
    periodEnd: `${month}-${endDay}`,
    defaultedFields,
  };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function minor(value) {
  if (value === null || value === undefined) return null;
  return BigInt(value).toString();
}

function allCashLines(cash) {
  return [
    ...(cash.operating || []),
    ...(cash.investing || []),
    ...(cash.financing || []),
    ...(cash.unresolved || []),
    ...(cash.internal_transfers_eliminated || []),
  ];
}

function typedDetails(lines, owner) {
  return lines.flatMap((line) => (line.details || []).filter((detail) => detail.typed_owner === owner));
}

function sumDetails(details, filter = () => true) {
  return details.filter(filter).reduce((sum, detail) => sum + BigInt(detail.amount_cents || 0), 0n);
}

function proposedReimbursements(db, scope) {
  const rows = db.prepare(`
    SELECT m.match_key,
      r.transaction_key AS reimbursement_transaction_key,
      r.transaction_date AS reimbursement_transaction_date,
      CAST(COALESCE(SUM(i.allocated_minor),0) AS TEXT) AS proposed_amount_minor
    FROM reimbursement_matches m
    JOIN transactions r ON r.id=m.reimbursement_transaction_id
    JOIN accounts a ON a.id=r.account_id
    JOIN reporting_entities e ON e.id=a.entity_id
    LEFT JOIN reimbursement_match_items i ON i.match_id=m.id
    WHERE m.match_status='proposed' AND e.entity_key=? AND m.currency=?
      AND ${activeRecordSql('r')}
      AND (
        r.transaction_date BETWEEN ? AND ?
        OR EXISTS (
          SELECT 1 FROM reimbursement_match_items scoped_item
          JOIN transactions expense ON expense.id=scoped_item.expense_transaction_id
          WHERE scoped_item.match_id=m.id AND expense.transaction_date BETWEEN ? AND ?
            AND ${activeRecordSql('expense')}
        )
      )
    GROUP BY m.id
    ORDER BY r.transaction_date,m.id
  `).all(
    scope.entityId,
    scope.currency,
    scope.periodStart,
    scope.periodEnd,
    scope.periodStart,
    scope.periodEnd,
  );
  const itemKeys = db.prepare(`
    SELECT t.transaction_key
    FROM reimbursement_match_items i
    JOIN reimbursement_matches m ON m.id=i.match_id
    JOIN transactions t ON t.id=i.expense_transaction_id
    WHERE m.match_key=?
    ORDER BY t.transaction_date,t.id
  `);
  return rows.map((row) => ({
    candidate_kind: 'reimbursement_match',
    resource_key: row.match_key,
    reimbursement_transaction_key: row.reimbursement_transaction_key,
    expense_transaction_keys: itemKeys.all(row.match_key).map((item) => item.transaction_key),
    proposed_amount_minor: row.proposed_amount_minor,
    included_in_confirmed_totals: false,
  }));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = [
      item.source || '',
      item.kind || '',
      item.resource_key || '',
      item.transaction_key || item.transaction_id || '',
      item.account_key || item.account_id || '',
      item.boundary || '',
    ].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function coverageFor(income, cash, scope, candidates) {
  const blockers = dedupe([
    ...(income.coverage?.blockers || []).map((item) => ({ ...item, source: 'management_pl' })),
    ...(cash.coverage?.blockers || []).map((item) => ({ ...item, source: 'cash_flow' })),
  ]);
  const warnings = dedupe([
    ...(income.coverage?.warnings || []).map((item) => ({ ...item, source: 'management_pl' })),
    ...(cash.coverage?.warnings || []).map((item) => ({ ...item, source: 'cash_flow' })),
    ...(scope.defaultedFields.length ? [{
      kind: 'defaulted_scope',
      severity: 'info',
      fields: scope.defaultedFields,
      label: `使用預設分析範圍：${scope.defaultedFields.join(', ')}`,
      source: 'monthly_financial_pulse',
    }] : []),
    ...(candidates.length ? [{
      kind: 'proposed_reimbursement_excluded',
      severity: 'warning',
      count: candidates.length,
      label: `${candidates.length} 筆報銷proposal尚未計入confirmed totals。`,
      source: 'reimbursement_matches',
    }] : []),
  ]);

  let status = 'complete';
  const noEconomicFacts = income.coverage?.status === 'empty';
  const noCashFacts = cash.coverage?.status === 'empty';
  if (noEconomicFacts && noCashFacts) status = 'empty';
  else if (cash.coverage?.status === 'unreconciled') status = 'unreconciled';
  else if (income.coverage?.status === 'unmapped'
    && cash.coverage?.status === 'complete'
    && blockers.every((item) => item.source === 'management_pl' && item.kind === 'unmapped_report_line')) status = 'unmapped';
  else if (blockers.length > 0
    || income.coverage?.status !== 'complete'
    || cash.coverage?.status !== 'complete') status = 'partial';

  return {
    status,
    blockers,
    warnings,
    report_statuses: {
      management_pl: income.coverage?.status || 'empty',
      cash_flow: cash.coverage?.status || 'empty',
    },
  };
}

function getMonthlyFinancialPulse(params, db = getDb()) {
  const scope = normalizeScope(params);
  const queryParams = new URLSearchParams({
    month: scope.month,
    entity_id: scope.entityId,
    currency: scope.currency,
    basis: scope.basis,
  });
  const income = getIncomeStatement(queryParams, db);
  const cash = getCashFlow(queryParams, db);
  const candidates = proposedReimbursements(db, scope);
  const cashLines = allCashLines(cash);
  const cardDetails = typedDetails(cash.operating || [], 'credit_card_payment_match');
  const loanDetails = typedDetails([...(cash.operating || []), ...(cash.financing || [])], 'loan_payment_allocation');
  const investmentDetails = typedDetails(cash.investing || [], 'investment_cash_match');
  const reimbursementDetails = typedDetails(cash.operating || [], 'reimbursement_match');
  const hasEconomicFacts = income.coverage?.status !== 'empty';
  const hasCashAccounts = (cash.included_account_ids || []).length > 0;
  const hasCashFacts = cash.coverage?.status !== 'empty';

  const facts = {
    management_pl: {
      confirmed_revenue_minor: hasEconomicFacts ? minor(income.total_revenue_cents) : null,
      confirmed_expense_minor: hasEconomicFacts ? minor(income.total_expense_cents) : null,
      net_result_minor: hasEconomicFacts ? minor(income.net_income_cents) : null,
      owner_unresolved_inflow_minor: minor(income.owner_unresolved_inflow_cents || 0),
      owner_unresolved_outflow_minor: minor(income.owner_unresolved_outflow_cents || 0),
    },
    cash_flow: {
      beginning_cash_minor: minor(cash.beginning_cash_cents),
      ending_cash_minor: minor(cash.ending_cash_cents),
      operating_cash_minor: hasCashFacts ? minor(cash.operating_cash_flow_cents) : null,
      investing_cash_minor: hasCashFacts ? minor(cash.investing_cash_flow_cents) : null,
      financing_cash_minor: hasCashFacts ? minor(cash.financing_cash_flow_cents) : null,
      unresolved_cash_minor: hasCashFacts ? minor(cash.unresolved_cash_flow_cents) : null,
      net_cash_change_minor: hasCashFacts ? minor(cash.net_cash_flow_cents) : null,
      reconciliation_delta_minor: minor(cash.reconciliation_delta_cents),
    },
    typed_cash_movements: {
      confirmed_card_settlement_cash_minor: hasCashAccounts ? sumDetails(cardDetails).toString() : null,
      confirmed_loan_principal_cash_minor: hasCashAccounts
        ? sumDetails(loanDetails, (item) => item.cash_flow_role === 'financing').toString()
        : null,
      confirmed_loan_interest_fee_cash_minor: hasCashAccounts
        ? sumDetails(loanDetails, (item) => item.cash_flow_role === 'operating').toString()
        : null,
      confirmed_investment_cash_minor: hasCashAccounts ? sumDetails(investmentDetails).toString() : null,
      confirmed_reimbursement_cash_minor: hasCashAccounts ? sumDetails(reimbursementDetails).toString() : null,
    },
  };

  const netResult = facts.management_pl.net_result_minor;
  const netCash = facts.cash_flow.net_cash_change_minor;
  const obligationParts = [
    facts.typed_cash_movements.confirmed_card_settlement_cash_minor,
    facts.typed_cash_movements.confirmed_loan_principal_cash_minor,
    facts.typed_cash_movements.confirmed_loan_interest_fee_cash_minor,
  ];
  const derived = {
    economic_to_cash_gap_minor: netResult === null || netCash === null
      ? null
      : (BigInt(netCash) - BigInt(netResult)).toString(),
    confirmed_obligation_settlement_cash_minor: obligationParts.some((value) => value === null)
      ? null
      : obligationParts.reduce((sum, value) => sum + BigInt(value), 0n).toString(),
  };

  const incomeLines = [...(income.revenue || []), ...(income.expenses || []), ...(income.excluded || [])];
  const balanceSnapshotKeys = uniqueSorted([
    ...(cash.beginning_cash_snapshots || []).map((item) => item.snapshot_key),
    ...(cash.ending_cash_snapshots || []).map((item) => item.snapshot_key),
  ]);
  const matchKeys = uniqueSorted([
    ...(income.source_watermark?.match_keys || []),
    ...cashLines.flatMap((line) => (line.details || []).flatMap((detail) => [
      ...(detail.match_keys || []),
      ...(detail.allocation_keys || []),
    ])),
  ]);
  const drillback = {
    revenue_transaction_keys: uniqueSorted((income.revenue || []).flatMap((line) => line.transaction_keys || [])),
    expense_transaction_keys: uniqueSorted((income.expenses || []).flatMap((line) => line.transaction_keys || [])),
    cash_transaction_keys: uniqueSorted(cashLines.flatMap((line) => line.transaction_keys || [])),
    card_settlement_transaction_keys: uniqueSorted(cardDetails.map((item) => item.transaction_key)),
    loan_transaction_keys: uniqueSorted(loanDetails.map((item) => item.transaction_key)),
    investment_transaction_keys: uniqueSorted(investmentDetails.map((item) => item.transaction_key)),
    reimbursement_transaction_keys: uniqueSorted(reimbursementDetails.map((item) => item.transaction_key)),
    match_keys: matchKeys,
    balance_snapshot_keys: balanceSnapshotKeys,
  };
  const coverage = coverageFor(income, cash, scope, candidates);
  const responseScope = {
    entity_id: scope.entityId,
    period_start: scope.periodStart,
    period_end: scope.periodEnd,
    as_of_date: null,
    currency: scope.currency,
    basis: scope.basis,
    defaulted_fields: scope.defaultedFields,
  };
  const semanticHash = createHash('sha256').update(JSON.stringify({
    scope: responseScope,
    coverage,
    facts,
    derived,
    candidates,
    drillback,
  })).digest('hex');
  const sourceWatermark = {
    source_keys: uniqueSorted([
      ...(income.source_watermark?.source_keys || []),
      ...(cash.beginning_cash_snapshots || []).map((item) => item.source_key),
      ...(cash.ending_cash_snapshots || []).map((item) => item.source_key),
    ]),
    fact_keys: uniqueSorted([
      ...incomeLines.flatMap((line) => line.transaction_keys || []),
      ...drillback.cash_transaction_keys,
      ...balanceSnapshotKeys,
    ]),
    match_keys: matchKeys,
    balance_snapshot_keys: balanceSnapshotKeys,
    semantic_hash: semanticHash,
    change_sequence: semanticHash.slice(0, 16),
  };

  return {
    schema_version: 'finance.analysis-read-model/v1',
    analysis_id: ANALYSIS_ID,
    formula_version: FORMULA_VERSION,
    scope: responseScope,
    source_watermark: sourceWatermark,
    coverage,
    facts,
    derived,
    candidates,
    drillback,
  };
}

module.exports = {
  ANALYSIS_ID,
  FORMULA_VERSION,
  getMonthlyFinancialPulse,
};
