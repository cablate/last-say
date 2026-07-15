const { createHash } = require('node:crypto');
const { requiredString, optionalString, enumValue, currency, isoDate, FinanceError, assertObject, rejectUnknown } = require('../../finance/contracts');
const { getDb, stableKey, logChange, requireRow, withTransaction } = require('./common');
const { moneyMinor } = require('./balances');
const { STANDARD_CATEGORIES, OWNER_UNRESOLVED_CATEGORY } = require('../../constants');

const FIELDS = new Set(['account_key', 'source_key', 'transaction_date', 'external_id', 'name', 'amount_minor', 'currency', 'flow_type', 'category_primary', 'category_sub', 'memo', 'judgment_reason', 'ai_confidence', 'record_status']);
const AI_CLASSIFICATION_FIELDS = ['transaction_key', 'category_primary', 'category_sub', 'flow_type', 'ai_confidence', 'judgment_reason', 'expected_updated_at'];
const ACTIVE_RECORD_STATUSES = new Set(['provisional', 'posted', 'confirmed']);
const AI_CLASSIFIABLE_FLOW_TYPES = new Set(['一般支出', '轉入待確認', '信用卡繳款/移轉', '貸款本金還款', '利息收入', '信用卡退款/調整', '信用卡消費']);

function normalizeCashActivity(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FinanceError('VALIDATION_ERROR', 'cash transaction must be an object');
  const unknown = Object.keys(input).find((key) => !FIELDS.has(key));
  if (unknown) throw new FinanceError('VALIDATION_ERROR', `Unknown cash transaction field: ${unknown}`, { field: unknown });
  const amount = moneyMinor(input.amount_minor);
  const confidence = input.ai_confidence === undefined || input.ai_confidence === null ? null : Number(input.ai_confidence);
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new FinanceError('VALIDATION_ERROR', 'ai_confidence must be between 0 and 1', { field: 'ai_confidence' });
  return {
    transaction_date: isoDate(input.transaction_date, 'transaction_date'),
    external_id: optionalString(input.external_id, 'external_id', 200), name: requiredString(input.name, 'name', 300), amount,
    currency: currency(input.currency), flow_type: requiredString(input.flow_type, 'flow_type', 100),
    category_primary: requiredString(input.category_primary, 'category_primary', 100), category_sub: optionalString(input.category_sub, 'category_sub', 100),
    memo: optionalString(input.memo, 'memo', 1000), judgment_reason: optionalString(input.judgment_reason, 'judgment_reason', 1000),
    ai_confidence: confidence, record_status: enumValue(input.record_status, 'record_status', 'record_status', 'posted'),
  };
}

function validateCashActivity(input, db = getDb()) {
  const value = normalizeCashActivity(input);
  return { ...value, account: requireRow(db.prepare('SELECT * FROM accounts WHERE account_key=?').get(input.account_key), 'Account'), source: input.source_key ? requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(input.source_key), 'Source') : null };
}

function cashDedupe(value) {
  return createHash('sha256').update([value.account.account_key, value.source?.source_key || '', value.external_id || '', value.transaction_date, value.amount.toString(), value.name].join('\u001f')).digest('hex');
}

function createCashActivity(input, actor = {}, db = getDb(), ingestionRunId = null, sourceItemKey = null) {
  const value = validateCashActivity(input, db); const key = stableKey(); const dedupe = cashDedupe(value);
  const inflow = value.amount > 0n ? value.amount : 0n; const outflow = value.amount < 0n ? -value.amount : 0n;
  return withTransaction(db, () => {
    try {
      const result = db.prepare(`INSERT INTO transactions(dedupe_key,import_match_key,transaction_date,transaction_month,statement_month,source_type,flow_type,name,amount,inflow,outflow,category_primary,category_sub,ai_confidence,judgment_reason,memo,raw_info,account_id,first_source_id,classification_source,reviewed,transaction_key,currency,amount_minor,inflow_minor,outflow_minor,record_status,external_id,source_item_key,ingestion_run_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        dedupe, value.name.normalize('NFKC').trim().toUpperCase(), value.transaction_date, value.transaction_date.slice(0, 7), null,
        value.source?.source_kind || 'structured_cash_activity', value.flow_type, value.name, value.amount, inflow, outflow,
        value.category_primary, value.category_sub, value.ai_confidence, value.judgment_reason, value.memo, '', value.account.id,
        value.source?.id || null, value.ai_confidence === null ? 'pending' : 'ai', 0, key, value.currency, value.amount, inflow, outflow, value.record_status,
        value.external_id, sourceItemKey, ingestionRunId,
      );
      if (value.source) db.prepare('INSERT INTO transaction_sources(transaction_id,source_id,source_row_id,source_description,raw_info) VALUES(?,?,?,?,?)').run(result.lastInsertRowid, value.source.id, sourceItemKey || value.external_id || key, value.source.description, '');
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) throw new FinanceError('DUPLICATE', 'Equivalent cash activity already exists', { status: 409 });
      throw error;
    }
    const row = db.prepare('SELECT *,CAST(amount_minor AS TEXT) AS amount_minor,CAST(inflow_minor AS TEXT) AS inflow_minor,CAST(outflow_minor AS TEXT) AS outflow_minor FROM transactions WHERE transaction_key=?').get(key);
    logChange(db, { resourceType: 'cash_transaction', resourceKey: key, action: 'create', after: { ...row, raw_info: undefined }, actorType: actor.type, actorNote: actor.note });
    return row;
  });
}

function classificationSnapshot(row) {
  return {
    category_primary: row.category_primary,
    category_sub: row.category_sub,
    ai_confidence: row.ai_confidence,
    judgment_reason: row.judgment_reason,
    classification_source: row.classification_source,
    rule_id: row.rule_id,
    reviewed: row.reviewed,
    updated_at: row.updated_at,
  };
}

function validateAiClassification(input, db = getDb()) {
  assertObject(input, 'transaction classification');
  rejectUnknown(input, AI_CLASSIFICATION_FIELDS, 'transaction classification');
  const transactionKey = requiredString(input.transaction_key, 'transaction_key', 80);
  const categoryPrimary = requiredString(input.category_primary, 'category_primary', 100);
  if (!STANDARD_CATEGORIES.includes(categoryPrimary)) {
    throw new FinanceError('VALIDATION_ERROR', 'category_primary must be a standard category', { field: 'category_primary', allowedValues: STANDARD_CATEGORIES });
  }
  if (categoryPrimary === OWNER_UNRESOLVED_CATEGORY) {
    throw new FinanceError('REVIEW_REQUIRED', 'category_primary=無法確認 is reserved for an explicit owner decision', { status: 409, field: 'category_primary' });
  }
  const categorySub = optionalString(input.category_sub, 'category_sub', 100);
  const flowType = optionalString(input.flow_type, 'flow_type', 100);
  if (flowType && !AI_CLASSIFIABLE_FLOW_TYPES.has(flowType)) {
    throw new FinanceError('VALIDATION_ERROR', 'flow_type is not an AI-classifiable canonical flow', { field: 'flow_type', allowedValues: [...AI_CLASSIFIABLE_FLOW_TYPES] });
  }
  const confidence = Number(input.ai_confidence);
  if (input.ai_confidence === undefined || input.ai_confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new FinanceError('VALIDATION_ERROR', 'ai_confidence must be between 0 and 1', { field: 'ai_confidence' });
  }
  const judgmentReason = requiredString(input.judgment_reason, 'judgment_reason', 1000);
  const expectedUpdatedAt = requiredString(input.expected_updated_at, 'expected_updated_at', 40);
  const transaction = requireRow(db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(transactionKey), 'Transaction');
  if (!ACTIVE_RECORD_STATUSES.has(transaction.record_status || 'posted')) {
    throw new FinanceError('VERSION_CONFLICT', 'Only active transactions can be classified', { status: 409 });
  }
  if (transaction.classification_source === 'human' || Number(transaction.reviewed) === 1) {
    throw new FinanceError('REVIEW_REQUIRED', 'Human-owned or reviewed classification cannot be replaced by AI', { status: 409 });
  }
  if (transaction.updated_at !== expectedUpdatedAt) {
    throw new FinanceError('VERSION_CONFLICT', 'Transaction classification changed; read it again before preview', { status: 409, retryable: true });
  }
  return { transaction, transactionKey, categoryPrimary, categorySub, flowType, confidence, judgmentReason };
}

function classifyCashActivity(input, actor = {}, db = getDb(), ingestionRunKey = null, now = new Date()) {
  const value = validateAiClassification(input, db);
  const before = { ...classificationSnapshot(value.transaction), ...(value.flowType ? { flow_type: value.transaction.flow_type } : {}) };
  const updatedAt = now.toISOString();
  return withTransaction(db, () => {
    db.prepare(`UPDATE transactions
      SET category_primary=?,category_sub=?,flow_type=?,ai_confidence=?,judgment_reason=?,classification_source='ai',rule_id=NULL,reviewed=0,updated_at=?
      WHERE transaction_key=?`).run(value.categoryPrimary, value.categorySub, value.flowType || value.transaction.flow_type, value.confidence, value.judgmentReason, updatedAt, value.transactionKey);
    const row = requireRow(db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(value.transactionKey), 'Transaction');
    logChange(db, {
      resourceType: 'cash_transaction_classification', resourceKey: value.transactionKey, action: 'ai_classify', before,
      after: { ...classificationSnapshot(row), ...(value.flowType ? { flow_type: row.flow_type } : {}), ingestion_run_key: ingestionRunKey }, actorType: actor.type,
      actorNote: actor.note,
    });
    return row;
  });
}

module.exports = { normalizeCashActivity, validateCashActivity, createCashActivity, validateAiClassification, classifyCashActivity, classificationSnapshot };
