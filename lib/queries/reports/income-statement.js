const { getDb } = require('../core');
const {
  classifyTransactionForReport,
  amountForReportGroup,
  getReportLineDefinition,
} = require('../../reporting/report-lines');
const { buildIncomeStatementCoverage } = require('../../reporting/coverage');
const { isOwnerUnresolvedRow, needsReviewRow } = require('../../review-policy');
const { activeRecordSql } = require('../../finance/active-records');
const { FinanceError, currency: validateCurrency } = require('../../finance/contracts');
const { listUnmatchedTransferCandidates } = require('../finance/reconciliation');

const DEFAULT_ENTITY_ID = 'personal';
const DEFAULT_BASIS = 'card_accrual_management';
const DEFAULT_CURRENCY = 'TWD';
const MAX_LINE_TRANSACTION_IDS = 200;
const MAX_REVIEW_ITEMS = 25;

function getParam(params, key) {
  if (!params) return null;
  if (typeof params.get === 'function') return params.get(key);
  return params[key] ?? null;
}

function selectedMonth(params) {
  const month = getParam(params, 'month');
  if (!month || month === 'all') return null;
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

function dateRangeForMonth(month) {
  if (!month) return { periodStart: null, periodEnd: null };
  const [year, monthPart] = month.split('-').map((part) => Number(part));
  const end = new Date(Date.UTC(year, monthPart, 0));
  const day = String(end.getUTCDate()).padStart(2, '0');
  return {
    periodStart: `${month}-01`,
    periodEnd: `${month}-${day}`,
  };
}

function normalizeBasis(params) {
  const basis = getParam(params, 'basis') || DEFAULT_BASIS;
  if (basis !== DEFAULT_BASIS) {
    throw new FinanceError('UNSUPPORTED_REPORT_BASIS', 'Only card_accrual_management is currently implemented for the management P&L', {
      field: 'basis',
      allowedValues: [DEFAULT_BASIS],
    });
  }
  return basis;
}

function normalizeCurrency(params) {
  return validateCurrency(getParam(params, 'currency') || DEFAULT_CURRENCY);
}

function normalizeEntityId(params) {
  return getParam(params, 'entity_id') || DEFAULT_ENTITY_ID;
}

function defaultedFields(params) {
  const fields = [];
  if (!getParam(params, 'entity_id')) fields.push('entity_id');
  if (!getParam(params, 'basis')) fields.push('basis');
  if (!getParam(params, 'currency')) fields.push('currency');
  return fields;
}

// 只 SELECT classifyTransactionForReport / addToLine / reviewItem 實際讀取的欄位，
// 排除 dedupe_key / judgment_reason / balance / account_original_order /
// first_source_id / classification_source / rule_id / statement_month /
// created_at / updated_at 等分類與彙總用不到的欄位，降低 100k 列的資料傳輸與 GC。
// 注意：分類語意不變 —— 若日後 classifyTransactionForReport 新增讀取的欄位，
// 必須同步補進此 SELECT，否則該欄位會是 undefined。
function loadRows(db, month, entityId, currency) {
  const values = { $entityId: entityId, $currency: currency };
  const where = [
    activeRecordSql('t'),
    "COALESCE(e.entity_key, 'personal') = $entityId",
    "COALESCE(t.currency, a.currency, 'TWD') = $currency",
  ];
  if (month) {
    where.push('t.transaction_month = $month');
    values.$month = month;
  }
  return db.prepare(`
    SELECT
      t.id,
      t.transaction_key,
      t.import_match_key,
      t.transaction_date,
      t.transaction_month,
      t.source_type,
      t.flow_type,
      t.name,
      t.amount,
      t.inflow,
      t.outflow,
      t.category_primary,
      t.category_sub,
      t.memo,
      t.raw_info,
      t.account_id,
      t.ai_confidence,
      t.classification_source,
      t.reviewed,
      COALESCE(t.currency, a.currency, 'TWD') AS currency,
      s.source_key,
      COALESCE(e.entity_key, 'personal') AS entity_key,
      COALESCE(tm.amount_minor,0) AS typed_transfer_amount_minor,
      tm.match_keys AS typed_transfer_match_keys,
      COALESCE(cm.amount_minor,0) AS typed_card_payment_amount_minor,
      cm.match_keys AS typed_card_payment_match_keys,
      COALESCE(lm.principal_minor,0) AS typed_loan_principal_minor,
      COALESCE(lm.interest_minor,0) AS typed_loan_interest_minor,
      COALESCE(lm.fee_minor,0) AS typed_loan_fee_minor,
      COALESCE(lm.total_minor,0) AS typed_loan_total_minor,
      lm.match_keys AS typed_loan_allocation_keys,
      COALESCE(im.amount_minor,0) AS typed_investment_cash_minor,
      im.match_keys AS typed_investment_cash_match_keys,
      rm.match_keys AS typed_reimbursement_match_keys,
      a.name AS account_name,
      a.account_type AS account_type,
      trm.report_line AS mapping_report_line,
      trm.mapping_source AS mapping_source,
      trm.confidence AS mapping_confidence,
      trm.reason AS mapping_reason,
      trm.rule_id AS mapping_rule_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN reporting_entities e ON e.id = a.entity_id
    LEFT JOIN sources s ON s.id = t.first_source_id
    LEFT JOIN (
      SELECT transaction_id,SUM(amount_minor) amount_minor,GROUP_CONCAT(match_key) match_keys FROM (
        SELECT from_transaction_id transaction_id,amount_minor,match_key FROM transfer_matches WHERE match_status='confirmed'
        UNION ALL
        SELECT to_transaction_id transaction_id,amount_minor,match_key FROM transfer_matches WHERE match_status='confirmed' AND to_transaction_id IS NOT NULL
      ) GROUP BY transaction_id
    ) tm ON tm.transaction_id=t.id
    LEFT JOIN (
      SELECT transaction_id,SUM(amount_minor) amount_minor,GROUP_CONCAT(match_key) match_keys
      FROM credit_card_payment_matches WHERE record_status NOT IN ('reversed','superseded','archived')
      GROUP BY transaction_id
    ) cm ON cm.transaction_id=t.id
    LEFT JOIN (
      SELECT transaction_id,SUM(principal_minor) principal_minor,SUM(interest_minor) interest_minor,
        SUM(fee_minor) fee_minor,SUM(total_minor) total_minor,GROUP_CONCAT(allocation_key) match_keys
      FROM loan_payment_allocations WHERE record_status NOT IN ('reversed','superseded','archived')
      GROUP BY transaction_id
    ) lm ON lm.transaction_id=t.id
    LEFT JOIN (
      SELECT transaction_id,SUM(ABS(amount_minor)) amount_minor,GROUP_CONCAT(match_key) match_keys
      FROM investment_cash_matches GROUP BY transaction_id
    ) im ON im.transaction_id=t.id
    LEFT JOIN (
      SELECT transaction_id,GROUP_CONCAT(match_key) match_keys FROM (
        SELECT reimbursement_transaction_id transaction_id,match_key FROM reimbursement_matches WHERE match_status='confirmed'
        UNION ALL
        SELECT i.expense_transaction_id transaction_id,m.match_key FROM reimbursement_match_items i
          JOIN reimbursement_matches m ON m.id=i.match_id WHERE m.match_status='confirmed'
      ) GROUP BY transaction_id
    ) rm ON rm.transaction_id=t.id
    LEFT JOIN transaction_report_mappings trm ON trm.transaction_id = t.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.transaction_date ASC, t.id ASC
  `).all(values);
}

function loadRules(db) {
  return db.prepare(`
    SELECT *
    FROM report_mapping_rules
    WHERE enabled = 1
    ORDER BY confidence DESC, id ASC
  `).all();
}

function makeLine(line, definition) {
  return {
    line,
    label: definition.label,
    group: definition.group,
    amount_cents: 0,
    transaction_count: 0,
    transaction_ids: [],
    transaction_keys: [],
    source_keys: [],
    mapping_sources: [],
  };
}

function addToLine(bucket, row, classification) {
  const definition = classification.definition;
  const amount = Math.round(amountForReportGroup(row, definition.group));
  bucket.amount_cents += amount;
  bucket.transaction_count += 1;
  if (bucket.transaction_ids.length < MAX_LINE_TRANSACTION_IDS) {
    bucket.transaction_ids.push(row.id);
    if (row.transaction_key) bucket.transaction_keys.push(row.transaction_key);
    if (row.source_key && !bucket.source_keys.includes(row.source_key)) bucket.source_keys.push(row.source_key);
  }
  if (!bucket.mapping_sources.includes(classification.mappingSource)) {
    bucket.mapping_sources.push(classification.mappingSource);
  }
}

function summarizeLineMap(lineMap, group) {
  return [...lineMap.values()]
    .filter((line) => line.group === group)
    .sort((a, b) => b.amount_cents - a.amount_cents || a.line.localeCompare(b.line));
}

function scopedPeriod(rows, month) {
  if (month) return dateRangeForMonth(month);
  if (rows.length === 0) return { periodStart: null, periodEnd: null };
  return {
    periodStart: rows[0].transaction_date,
    periodEnd: rows[rows.length - 1].transaction_date,
  };
}

function reviewItem(row, classification) {
  return {
    id: row.id,
    transaction_id: row.id,
    transaction_key: row.transaction_key,
    transaction_date: row.transaction_date,
    transaction_month: row.transaction_month,
    name: row.name,
    category_primary: row.category_primary,
    source_type: row.source_type,
    account_name: row.account_name,
    amount_cents: Math.round(amountForReportGroup(row, 'expense')),
    inflow_cents: Math.round(Number(row.inflow) || 0),
    outflow_cents: Math.round(Number(row.outflow) || 0),
    reviewed: Number(row.reviewed) === 1,
    ai_confidence: row.ai_confidence,
    reason: classification.reason,
  };
}

function addKnownAmount(lineMap, row, reportLine, amount, reason) {
  if (amount <= 0) return;
  const definition = getReportLineDefinition(reportLine);
  if (!lineMap.has(reportLine)) lineMap.set(reportLine, makeLine(reportLine, definition));
  const bucket = lineMap.get(reportLine);
  bucket.amount_cents += Math.round(amount);
  bucket.transaction_count += 1;
  if (bucket.transaction_ids.length < MAX_LINE_TRANSACTION_IDS) {
    bucket.transaction_ids.push(row.id);
    if (row.transaction_key) bucket.transaction_keys.push(row.transaction_key);
    if (row.source_key && !bucket.source_keys.includes(row.source_key)) bucket.source_keys.push(row.source_key);
  }
  if (!bucket.mapping_sources.includes('typed_owner')) bucket.mapping_sources.push('typed_owner');
  if (!bucket.reasons) bucket.reasons = [];
  if (!bucket.reasons.includes(reason)) bucket.reasons.push(reason);
}

function getIncomeStatement(params, db = getDb()) {
  const month = selectedMonth(params);
  const entityId = normalizeEntityId(params);
  const basis = normalizeBasis(params);
  const currency = normalizeCurrency(params);
  const rows = loadRows(db, month, entityId, currency);
  const rules = loadRules(db);
  const lineMap = new Map();
  const reviewItems = [];

  let mappedCount = 0;
  let unmappedCount = 0;
  let unreviewedCount = 0;
  let ownerUnresolvedCount = 0;
  let ownerUnresolvedInflow = 0;
  let ownerUnresolvedOutflow = 0;

  for (const row of rows) {
    if (needsReviewRow(row)) unreviewedCount += 1;
    if (isOwnerUnresolvedRow(row)) {
      ownerUnresolvedCount += 1;
      ownerUnresolvedInflow += Math.round(Number(row.inflow) || 0);
      ownerUnresolvedOutflow += Math.round(Number(row.outflow) || 0);
    }

    const typedLoanTotal = Number(row.typed_loan_total_minor) || 0;
    if (typedLoanTotal > 0 && !row.mapping_report_line) {
      const principal = Number(row.typed_loan_principal_minor) || 0;
      const interest = Number(row.typed_loan_interest_minor) || 0;
      const fee = Number(row.typed_loan_fee_minor) || 0;
      addKnownAmount(lineMap, row, 'excluded:loan_principal', principal, 'typed loan allocation principal');
      addKnownAmount(lineMap, row, 'expense:interest', interest, 'typed loan allocation interest');
      addKnownAmount(lineMap, row, 'expense:fees_taxes', fee, 'typed loan allocation fee');
      const cashOutflow = Number(row.outflow) || Math.abs(Math.min(0, Number(row.amount) || 0));
      const remainder = Math.max(0, cashOutflow - principal - interest - fee);
      if (remainder > 0) {
        unmappedCount += 1;
        if (reviewItems.length < MAX_REVIEW_ITEMS) {
          reviewItems.push({ ...reviewItem(row, { reason: `typed loan allocation leaves ${remainder} minor units unexplained` }), unexplained_amount_cents: remainder });
        }
      } else mappedCount += 1;
      continue;
    }

    const classification = classifyTransactionForReport(row, rules);
    if (classification.status !== 'mapped') {
      unmappedCount += 1;
      if (reviewItems.length < MAX_REVIEW_ITEMS) {
        reviewItems.push(reviewItem(row, classification));
      }
      continue;
    }

    mappedCount += 1;
    if (!lineMap.has(classification.reportLine)) {
      lineMap.set(classification.reportLine, makeLine(
        classification.reportLine,
        classification.definition,
      ));
    }
    addToLine(lineMap.get(classification.reportLine), row, classification);
  }

  const revenue = summarizeLineMap(lineMap, 'revenue');
  const expenses = summarizeLineMap(lineMap, 'expense');
  const excluded = summarizeLineMap(lineMap, 'excluded');
  const totalRevenue = revenue.reduce((sum, line) => sum + line.amount_cents, 0);
  const totalExpense = expenses.reduce((sum, line) => sum + line.amount_cents, 0);
  const excludedTotal = excluded.reduce((sum, line) => sum + line.amount_cents, 0);
  const { periodStart, periodEnd } = scopedPeriod(rows, month);
  const includedAccountIds = [...new Set(rows.map((row) => row.account_id))].sort((a, b) => a - b);

  const scopedTransactionKeys = new Set(rows.map((row) => row.transaction_key).filter(Boolean));
  const unmatchedTransferCount = listUnmatchedTransferCandidates(db)
    .filter((candidate) => scopedTransactionKeys.has(candidate.transaction_key)).length;
  const coverage = buildIncomeStatementCoverage({
    entityId,
    periodStart,
    periodEnd,
    basis,
    currency,
    includedAccountIds,
    defaultedFields: defaultedFields(params),
    transactionCount: rows.length,
    unmappedTransactionCount: unmappedCount,
    unreviewedTransactionCount: unreviewedCount,
    ownerUnresolvedTransactionCount: ownerUnresolvedCount,
    ownerUnresolvedInflowCents: ownerUnresolvedInflow,
    ownerUnresolvedOutflowCents: ownerUnresolvedOutflow,
    unmatchedTransferCount,
  });

  return {
    report: 'management_pl',
    basis,
    entity_id: entityId,
    currency,
    month: month || 'all',
    period_start: periodStart,
    period_end: periodEnd,
    revenue,
    expenses,
    excluded,
    total_revenue_cents: totalRevenue,
    total_expense_cents: totalExpense,
    net_income_cents: totalRevenue - totalExpense,
    excluded_total_cents: excludedTotal,
    transaction_count: rows.length,
    mapped_transaction_count: mappedCount,
    unmapped_transaction_count: unmappedCount,
    unreviewed_transaction_count: unreviewedCount,
    owner_unresolved_transaction_count: ownerUnresolvedCount,
    owner_unresolved_inflow_cents: ownerUnresolvedInflow,
    owner_unresolved_outflow_cents: ownerUnresolvedOutflow,
    owner_unresolved_net_cents: ownerUnresolvedInflow - ownerUnresolvedOutflow,
    unmatched_transfer_count: unmatchedTransferCount,
    source_watermark: {
      transaction_keys: rows.map((row) => row.transaction_key).filter(Boolean),
      source_keys: [...new Set(rows.map((row) => row.source_key).filter(Boolean))],
      match_keys: [...new Set(rows.flatMap((row) => [
        row.typed_transfer_match_keys,
        row.typed_card_payment_match_keys,
        row.typed_loan_allocation_keys,
        row.typed_investment_cash_match_keys,
        row.typed_reimbursement_match_keys,
      ].filter(Boolean).flatMap((keys) => String(keys).split(','))))],
    },
    review_items: reviewItems,
    coverage,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  getIncomeStatement,
};
