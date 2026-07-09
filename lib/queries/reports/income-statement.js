const { getDb } = require('../core');
const {
  classifyTransactionForReport,
  amountForReportGroup,
} = require('../../reporting/report-lines');
const { buildIncomeStatementCoverage } = require('../../reporting/coverage');

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
  return ['cash', 'card_accrual_management'].includes(basis) ? basis : DEFAULT_BASIS;
}

function normalizeCurrency(params) {
  return getParam(params, 'currency') || DEFAULT_CURRENCY;
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
function loadRows(db, month) {
  const values = {};
  const where = [];
  if (month) {
    where.push('t.transaction_month = $month');
    values.$month = month;
  }
  return db.prepare(`
    SELECT
      t.id,
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
      t.reviewed,
      a.name AS account_name,
      a.account_type AS account_type,
      trm.report_line AS mapping_report_line,
      trm.mapping_source AS mapping_source,
      trm.confidence AS mapping_confidence,
      trm.reason AS mapping_reason,
      trm.rule_id AS mapping_rule_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
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

function getIncomeStatement(params, db = getDb()) {
  const month = selectedMonth(params);
  const entityId = normalizeEntityId(params);
  const basis = normalizeBasis(params);
  const currency = normalizeCurrency(params);
  const rows = loadRows(db, month);
  const rules = loadRules(db);
  const lineMap = new Map();
  const reviewItems = [];

  let mappedCount = 0;
  let unmappedCount = 0;
  let unreviewedCount = 0;

  for (const row of rows) {
    if (Number(row.reviewed) !== 1) unreviewedCount += 1;

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
    unmatchedTransferCount: 0,
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
    review_items: reviewItems,
    coverage,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  getIncomeStatement,
};
