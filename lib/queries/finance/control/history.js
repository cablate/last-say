const { createHash } = require('node:crypto');

const { FinanceError, currency: validateCurrency } = require('../../../finance/contracts');
const { roundHalfEven } = require('../../../finance/money/decimal');
const { getDb } = require('../common');
const { getMonthlyFinancialPulse } = require('./monthly-pulse');

const ANALYSIS_ID = 'financial_dashboard_history';
const FORMULA_VERSION = 'financial-dashboard-history/1';
const BASIS = 'card_accrual_management';
const HISTORY_MONTHS = 6;

function getParam(params, key) {
  if (!params) return null;
  if (typeof params.get === 'function') return params.get(key);
  return params[key] ?? null;
}

function localMonth() {
  return new Date().toLocaleDateString('en-CA').slice(0, 7);
}

function normalizeMonth(value, field = 'month') {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || '')) {
    throw new FinanceError('VALIDATION_ERROR', `${field} must be one specific YYYY-MM value`, { field });
  }
  return value;
}

function shiftMonth(month, delta) {
  const [year, monthNumber] = normalizeMonth(month).split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function completedMonthKeys(selectedMonth, currentMonth = localMonth(), count = HISTORY_MONTHS) {
  normalizeMonth(selectedMonth);
  normalizeMonth(currentMonth, 'current_month');
  const lastCompleteMonth = selectedMonth < currentMonth ? selectedMonth : shiftMonth(currentMonth, -1);
  return Array.from({ length: count }, (_, index) => shiftMonth(lastCompleteMonth, index - count + 1));
}

function averageMinor(values) {
  const known = values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => BigInt(value));
  if (!known.length) return { value_minor: null, sample_count: 0 };
  const sum = known.reduce((total, value) => total + value, 0n);
  return {
    value_minor: roundHalfEven(sum, BigInt(known.length)).toString(),
    sample_count: known.length,
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function compactPulse(month, pulse) {
  return {
    month,
    coverage_status: pulse.coverage?.status || 'empty',
    management_status: pulse.coverage?.report_statuses?.management_pl || 'empty',
    cash_flow_status: pulse.coverage?.report_statuses?.cash_flow || 'empty',
    confirmed_revenue_minor: pulse.facts?.management_pl?.confirmed_revenue_minor ?? null,
    confirmed_expense_minor: pulse.facts?.management_pl?.confirmed_expense_minor ?? null,
    net_result_minor: pulse.facts?.management_pl?.net_result_minor ?? null,
    net_cash_change_minor: pulse.facts?.cash_flow?.net_cash_change_minor ?? null,
    blocker_kinds: unique((pulse.coverage?.blockers || []).map((item) => item.kind)),
  };
}

function aggregateHistory(rows) {
  const revenue = averageMinor(rows.map((row) => row.confirmed_revenue_minor));
  const expense = averageMinor(rows.map((row) => row.confirmed_expense_minor));
  const netResult = averageMinor(rows.map((row) => row.net_result_minor));
  const netCash = averageMinor(rows.map((row) => row.net_cash_change_minor));
  return {
    average_confirmed_revenue_minor: revenue.value_minor,
    average_confirmed_expense_minor: expense.value_minor,
    average_net_result_minor: netResult.value_minor,
    average_net_cash_change_minor: netCash.value_minor,
    sample_counts: {
      confirmed_revenue: revenue.sample_count,
      confirmed_expense: expense.sample_count,
      net_result: netResult.sample_count,
      net_cash_change: netCash.sample_count,
    },
    formulas: {
      averages: 'round-half-even(sum of non-null monthly facts / fact sample count)',
      month_window: 'six completed calendar months ending at selected historical month, or previous month when selection is current/future',
    },
  };
}

function getFinancialDashboardHistory(params, db = getDb(), options = {}) {
  const selectedMonth = normalizeMonth(getParam(params, 'month'));
  const entityId = getParam(params, 'entity_id') || 'personal';
  const currency = validateCurrency(getParam(params, 'currency') || 'TWD');
  const basis = getParam(params, 'basis') || BASIS;
  if (basis !== BASIS) {
    throw new FinanceError('VALIDATION_ERROR', `basis must be ${BASIS}`, { field: 'basis' });
  }
  const currentMonth = options.currentMonth || localMonth();
  const months = completedMonthKeys(selectedMonth, currentMonth, HISTORY_MONTHS);
  const pulses = months.map((month) => {
    const query = new URLSearchParams({ month, entity_id: entityId, currency, basis });
    return { month, pulse: getMonthlyFinancialPulse(query, db) };
  });
  const rows = pulses.map(({ month, pulse }) => compactPulse(month, pulse));
  const nonEmpty = rows.filter((row) => row.coverage_status !== 'empty');
  const partial = nonEmpty.filter((row) => row.coverage_status !== 'complete');
  const coverage = {
    status: nonEmpty.length === 0 ? 'empty' : (partial.length ? 'partial' : 'complete'),
    warnings: partial.length ? [{
      kind: 'historical_months_partial',
      severity: 'warning',
      count: partial.length,
      months: partial.map((row) => row.month),
      label: `${partial.length} 個月份仍有分類、配對或期初期末餘額缺口；平均僅代表目前已確認紀錄。`,
    }] : [],
    missing_inputs: unique(rows.flatMap((row) => row.blocker_kinds)),
  };
  const derived = aggregateHistory(rows);
  const sourceKeys = unique(pulses.flatMap(({ pulse }) => pulse.source_watermark?.source_keys || []));
  const factKeys = unique(pulses.flatMap(({ pulse }) => pulse.source_watermark?.fact_keys || []));
  const semanticPayload = { selectedMonth, months, rows, coverage, derived };
  const semanticHash = createHash('sha256').update(JSON.stringify(semanticPayload)).digest('hex');
  return {
    schema_version: 'finance.analysis-read-model/v1',
    analysis_id: ANALYSIS_ID,
    formula_version: FORMULA_VERSION,
    scope: {
      entity_id: entityId,
      selected_month: selectedMonth,
      period_start: `${months[0]}-01`,
      period_end: `${months.at(-1)}-${String(new Date(Date.UTC(Number(months.at(-1).slice(0, 4)), Number(months.at(-1).slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`,
      currency,
      basis,
      month_count: HISTORY_MONTHS,
    },
    coverage,
    facts: { months: rows },
    derived,
    source_watermark: {
      source_keys: sourceKeys,
      fact_keys: factKeys,
      semantic_hash: semanticHash,
      change_sequence: semanticHash.slice(0, 16),
    },
    drillback: {
      months,
      fact_keys: factKeys,
    },
  };
}

module.exports = {
  ANALYSIS_ID,
  FORMULA_VERSION,
  HISTORY_MONTHS,
  aggregateHistory,
  completedMonthKeys,
  getFinancialDashboardHistory,
};
