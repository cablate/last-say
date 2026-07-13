const { createHash } = require('node:crypto');
const { requiredString, optionalString, enumValue, currency, isoDate, FinanceError } = require('../../finance/contracts');
const { getDb, stableKey, logChange, requireRow, withTransaction } = require('./common');
const { moneyMinor } = require('./balances');

const FIELDS = new Set(['account_key', 'source_key', 'transaction_date', 'external_id', 'name', 'amount_minor', 'currency', 'flow_type', 'category_primary', 'category_sub', 'memo', 'judgment_reason', 'ai_confidence', 'record_status']);

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

module.exports = { normalizeCashActivity, validateCashActivity, createCashActivity };
