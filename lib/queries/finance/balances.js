const { createHash } = require('node:crypto');
const { validateSchemaShape, enumValue, currency, isoDate, optionalString, FinanceError } = require('../../finance/contracts');
const { getDb, stableKey, logChange, requireRow, withTransaction } = require('./common');

const ACTIVE_STATUS_SQL = "record_status IN ('provisional','posted','confirmed')";
const AUTHORITY_RANK_SQL = `CASE b.authority
  WHEN 'official' THEN 6 WHEN 'institution_export' THEN 5 WHEN 'user_confirmed' THEN 4
  WHEN 'ai_researched' THEN 3 WHEN 'ai_inferred' THEN 2 ELSE 1 END`;

function localDate() { return new Date().toLocaleDateString('en-CA'); }

function moneyMinor(value, field = 'amount_minor') {
  const text = String(value ?? '');
  if (!/^-?(0|[1-9]\d*)$/.test(text) || text.length > 40) {
    throw new FinanceError('VALIDATION_ERROR', `${field} must be an integer minor-unit string`, { field });
  }
  return BigInt(text);
}

function projection() {
  return `SELECT b.id,b.snapshot_key,a.account_key,s.source_key,b.as_of_date,b.observed_at,b.balance_kind,
    CAST(b.amount_minor AS TEXT) AS amount_minor,b.currency,b.authority,b.review_state,b.record_status,
    b.duplicate_key,b.note,sup.snapshot_key AS supersedes_snapshot_key,b.version,b.created_at,b.updated_at
    FROM account_balance_snapshots b JOIN accounts a ON a.id=b.account_id
    LEFT JOIN sources s ON s.id=b.source_id
    LEFT JOIN account_balance_snapshots sup ON sup.id=b.supersedes_snapshot_id`;
}

function getBalanceSnapshot(key, db = getDb()) {
  return requireRow(db.prepare(`${projection()} WHERE b.snapshot_key=?`).get(key), 'Balance snapshot');
}

function listBalanceSnapshots(filters = {}, db = getDb()) {
  const where = []; const values = [];
  if (filters.account_key) { where.push('a.account_key=?'); values.push(filters.account_key); }
  if (filters.active_only !== false) where.push(`b.${ACTIVE_STATUS_SQL}`);
  return db.prepare(`${projection()} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.as_of_date DESC,b.id DESC`).all(...values);
}

function resolve(db, table, column, key, label, required = true) {
  if (!key && !required) return null;
  return requireRow(db.prepare(`SELECT * FROM ${table} WHERE ${column}=?`).get(key), label);
}

function normalizedSnapshot(input, db) {
  validateSchemaShape('balance_snapshot', input);
  const account = resolve(db, 'accounts', 'account_key', input.account_key, 'Account');
  const source = resolve(db, 'sources', 'source_key', input.source_key, 'Source', false);
  const supersedes = resolve(db, 'account_balance_snapshots', 'snapshot_key', input.supersedes_snapshot_key, 'Superseded snapshot', false);
  const authority = enumValue(input.authority, 'authority', 'authority');
  const status = enumValue(input.record_status, 'record_status', 'record_status', 'posted');
  if (authority === 'ai_inferred' && status === 'confirmed') throw new FinanceError('REVIEW_REQUIRED', 'AI-inferred running balance cannot be confirmed', { status: 409 });
  return {
    account, source, supersedes,
    as_of_date: isoDate(input.as_of_date, 'as_of_date'),
    observed_at: optionalString(input.observed_at, 'observed_at', 40),
    balance_kind: enumValue(input.balance_kind, 'balance_kind', 'balance_kind'),
    amount_minor: moneyMinor(input.amount_minor), currency: currency(input.currency), authority,
    review_state: authority === 'ai_inferred' ? 'needs_review' : enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'),
    record_status: status, note: optionalString(input.note, 'note', 1000),
  };
}

function duplicateKey(value) {
  return createHash('sha256').update([value.account.account_key, value.balance_kind, value.as_of_date, value.source?.source_key || 'no-source'].join('\u001f')).digest('hex');
}

function createBalanceSnapshot(input, actor = {}, db = getDb(), ingestionRunId = null) {
  const value = normalizedSnapshot(input, db); const key = stableKey(); const duplicate = duplicateKey(value);
  return withTransaction(db, () => {
    try {
      db.prepare(`INSERT INTO account_balance_snapshots(snapshot_key,account_id,source_id,ingestion_run_id,as_of_date,observed_at,balance_kind,amount_minor,currency,authority,review_state,record_status,duplicate_key,note,supersedes_snapshot_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(key, value.account.id, value.source?.id || null, ingestionRunId, value.as_of_date, value.observed_at, value.balance_kind, value.amount_minor, value.currency, value.authority, value.review_state, value.record_status, duplicate, value.note, value.supersedes?.id || null);
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        const existing = db.prepare(`${projection()} WHERE b.duplicate_key=?`).get(duplicate);
        throw new FinanceError('DUPLICATE', `Equivalent balance snapshot already exists: ${existing?.snapshot_key || 'unknown'}`, { status: 409 });
      }
      throw error;
    }
    const row = getBalanceSnapshot(key, db);
    logChange(db, { resourceType: 'balance_snapshot', resourceKey: key, action: 'create', after: row, actorType: actor.type, actorNote: actor.note });
    return row;
  });
}

function latestBalanceForAccount(accountKey, { asOfDate = localDate(), staleDays = 45 } = {}, db = getDb()) {
  const candidates = db.prepare(`${projection()} WHERE a.account_key=? AND b.${ACTIVE_STATUS_SQL} AND b.as_of_date<=? ORDER BY b.as_of_date DESC,${AUTHORITY_RANK_SQL} DESC,b.id DESC`).all(accountKey, asOfDate);
  if (!candidates.length) return { status: 'missing', selected: null, conflicts: [] };
  const latestDate = candidates[0].as_of_date;
  const sameDate = candidates.filter((row) => row.as_of_date === latestDate);
  const selected = sameDate[0];
  const conflicts = sameDate.filter((row) => row.balance_kind === selected.balance_kind && row.currency === selected.currency && row.amount_minor !== selected.amount_minor);
  const ageDays = Math.floor((Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${latestDate}T00:00:00Z`)) / 86400000);
  return {
    status: conflicts.length ? 'conflicted' : (ageDays > staleDays ? 'stale' : (selected.review_state === 'needs_review' ? 'needs_review' : 'current')),
    selected, selection_reason: 'latest date, then strongest source authority', conflicts, age_days: ageDays, stale_after_days: staleDays,
  };
}

module.exports = { ACTIVE_STATUS_SQL, moneyMinor, listBalanceSnapshots, getBalanceSnapshot, createBalanceSnapshot, latestBalanceForAccount };
