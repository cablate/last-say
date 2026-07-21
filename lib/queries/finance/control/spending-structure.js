const { createHash } = require('node:crypto');

const { FinanceError, currency: validateCurrency } = require('../../../finance/contracts');
const { POLICY_VERSION, sourceWatermark } = require('../../../finance/readiness/policy');
const { getDb } = require('../common');
const { getIncomeStatement } = require('../../reports/income-statement');
const { listCommitments } = require('../obligations');
const { listReimbursementMatches } = require('../reimbursements');

const ANALYSIS_ID = 'spending_structure';
const FORMULA_VERSION = 'spending-structure/1';
const BASIS = 'card_accrual_management';

function getParam(params, key) {
  if (!params) return null;
  if (typeof params.get === 'function') return params.get(key);
  return params[key] ?? null;
}

function monthScope(params) {
  const month = getParam(params, 'month');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) {
    throw new FinanceError('VALIDATION_ERROR', 'month must be one specific YYYY-MM value', { field: 'month' });
  }
  const entityId = getParam(params, 'entity_id') || 'personal';
  const currency = validateCurrency(getParam(params, 'currency') || 'TWD');
  const basis = getParam(params, 'basis') || BASIS;
  if (basis !== BASIS) throw new FinanceError('VALIDATION_ERROR', `basis must be ${BASIS}`, { field: 'basis' });
  const [year, monthNumber] = month.split('-').map(Number);
  const endDay = String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0');
  return {
    month,
    entityId,
    currency,
    basis,
    periodStart: `${month}-01`,
    periodEnd: `${month}-${endDay}`,
    defaultedFields: [
      !getParam(params, 'entity_id') && 'entity_id',
      !getParam(params, 'currency') && 'currency',
      !getParam(params, 'basis') && 'basis',
    ].filter(Boolean),
  };
}

function sum(values) {
  const known = values.filter((value) => value !== null && value !== undefined);
  return known.length ? known.reduce((total, value) => total + BigInt(value), 0n).toString() : null;
}

function inPeriod(date, scope) {
  return date >= scope.periodStart && date <= scope.periodEnd;
}

function scopedReimbursements(scope, db) {
  const all = listReimbursementMatches({}, db).filter((row) => row.entity_key === scope.entityId);
  const matches = all.filter((row) => inPeriod(row.reimbursement_transaction_date || row.created_at?.slice(0, 10) || '', scope)
    || row.items.some((item) => inPeriod(item.expense_transaction_date || '', scope)));
  const confirmed = matches.filter((row) => row.match_status === 'confirmed');
  const proposed = matches.filter((row) => row.match_status === 'proposed');
  const confirmedRecovered = sum(confirmed.map((row) => row.allocated_minor));
  const confirmedGrossExpense = sum(confirmed.flatMap((row) => row.items.map((item) => item.allocated_minor)));
  const confirmedUnallocated = sum(confirmed.map((row) => row.unallocated_minor));
  const serialize = (row) => ({
    match_key: row.match_key,
    reimbursement_transaction_key: row.reimbursement_transaction_key,
    reimbursement_amount_minor: row.reimbursement_amount_minor,
    allocated_minor: row.allocated_minor,
    unallocated_minor: row.unallocated_minor,
    expense_transaction_keys: row.items.map((item) => item.expense_transaction_key),
    included_in_confirmed_totals: row.match_status === 'confirmed',
  });
  return {
    confirmed_recovered_minor: confirmedRecovered,
    confirmed_gross_expense_minor: confirmedGrossExpense,
    confirmed_unallocated_minor: confirmedUnallocated,
    confirmed_matches: confirmed.map(serialize),
    proposed_candidates: proposed.map(serialize),
  };
}

function commitmentFacts(scope, db) {
  const rows = listCommitments(db).filter((row) => row.entity_key === scope.entityId
    && row.direction === 'out'
    && row.currency === scope.currency
    && row.authority === 'user_confirmed'
    && row.review_state === 'confirmed'
    && row.status !== 'cancelled');
  return rows.map((row) => ({
    commitment_key: row.commitment_key,
    commitment_kind: row.commitment_kind,
    amount_kind: row.amount_kind,
    amount_minor: row.amount_minor,
    amount_min_minor: row.amount_min_minor,
    amount_max_minor: row.amount_max_minor,
    currency: row.currency,
    cadence: row.cadence,
    next_due_date: row.next_due_date,
    status: row.status,
  }));
}

function getSpendingStructure(params, db = getDb()) {
  const scope = monthScope(params);
  const reportParams = new URLSearchParams({
    month: scope.month,
    entity_id: scope.entityId,
    currency: scope.currency,
    basis: scope.basis,
  });
  const income = getIncomeStatement(reportParams, db);
  const reimbursements = scopedReimbursements(scope, db);
  const commitments = commitmentFacts(scope, db);
  const expenseLines = income.expenses.map((line) => ({
    report_line: line.line,
    label: line.label,
    amount_minor: String(line.amount_cents),
    transaction_count: line.transaction_count,
    transaction_keys: line.transaction_keys || [],
    mapping_sources: line.mapping_sources || [],
    classification: line.line === 'expense:business_operating' ? 'explicit_business_operating' : 'expense_category',
  }));
  const expenseTotal = String(income.total_expense_cents);
  const recovered = reimbursements.confirmed_recovered_minor;
  const response = {
    schema_version: 'finance.analysis-read-model/v1',
    analysis_id: ANALYSIS_ID,
    formula_version: FORMULA_VERSION,
    scope: {
      entity_id: scope.entityId,
      period_start: scope.periodStart,
      period_end: scope.periodEnd,
      month: scope.month,
      currency: scope.currency,
      basis: scope.basis,
      defaulted_fields: scope.defaultedFields,
    },
    coverage: {
      status: income.coverage?.status || 'empty',
      report_coverage: income.coverage,
      warnings: [
        ...(reimbursements.proposed_candidates.length ? [{
          kind: 'proposed_reimbursement_excluded',
          severity: 'warning',
          count: reimbursements.proposed_candidates.length,
          label: '報銷proposal尚未計入已確認回收。',
        }] : []),
        ...(expenseLines.some((line) => line.classification === 'explicit_business_operating') ? [] : [{
          kind: 'business_expense_mapping_missing',
          severity: 'info',
          label: '目前沒有明確對應為業務營運支出的科目；不把交通、住宿或其他支出猜成工作費。',
        }]),
      ],
      missing_inputs: [
        ...(income.unmapped_transaction_count ? ['report_line_mapping'] : []),
        ...(income.owner_unresolved_transaction_count ? ['owner_unresolved_transactions'] : []),
      ],
    },
    facts: {
      confirmed_expense_minor: expenseTotal,
      expense_lines: expenseLines,
      confirmed_commitments: commitments,
      confirmed_reimbursement_recovery_minor: recovered,
      confirmed_reimbursement_gross_expense_minor: reimbursements.confirmed_gross_expense_minor,
      confirmed_reimbursement_unallocated_minor: reimbursements.confirmed_unallocated_minor,
      proposed_reimbursements: reimbursements.proposed_candidates,
    },
    derived: {
      net_expense_after_confirmed_recovery_minor: expenseTotal === null || recovered === null
        ? null
        : (BigInt(expenseTotal) - BigInt(recovered)).toString(),
      explicit_business_expense_minor: sum(expenseLines
        .filter((line) => line.classification === 'explicit_business_operating')
        .map((line) => line.amount_minor)),
      fixed_commitment_count: commitments.length,
      formulas: {
        net_expense_after_confirmed_recovery: 'confirmed expense - confirmed reimbursement allocation',
        explicit_business_expense: 'sum of expense:business_operating report lines only',
      },
    },
    drillback: {
      transaction_keys: income.source_watermark?.transaction_keys || [],
      source_keys: income.source_watermark?.source_keys || [],
      reimbursement_match_keys: reimbursements.confirmed_matches.map((row) => row.match_key),
      proposed_reimbursement_match_keys: reimbursements.proposed_candidates.map((row) => row.match_key),
      commitment_keys: commitments.map((row) => row.commitment_key),
    },
  };
  const semanticPayload = { scope: response.scope, coverage: response.coverage, facts: response.facts, derived: response.derived, drillback: response.drillback };
  const semanticHash = createHash('sha256').update(JSON.stringify(semanticPayload)).digest('hex');
  response.source_watermark = {
    ...sourceWatermark(db),
    policy_version: POLICY_VERSION,
    source_keys: response.drillback.source_keys,
    resource_keys: [
      ...response.drillback.transaction_keys,
      ...response.drillback.reimbursement_match_keys,
      ...response.drillback.proposed_reimbursement_match_keys,
      ...response.drillback.commitment_keys,
    ].filter(Boolean).sort(),
    semantic_hash: semanticHash,
    change_sequence: semanticHash.slice(0, 16),
  };
  return response;
}

module.exports = { ANALYSIS_ID, FORMULA_VERSION, getSpendingStructure };
