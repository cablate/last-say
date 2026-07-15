const { FinanceError, enumValue, currency, optionalString, requiredString } = require('../../finance/contracts');
const { moneyMinor } = require('./balances');
const { createReviewTask, resolveReviewTask } = require('./review-tasks');
const { getDb, stableKey, logChange, requireRow, assertVersion, withTransaction } = require('./common');

const ACTIVE_STATUSES = new Set(['provisional', 'posted', 'confirmed']);

function transaction(db, key) {
  return requireRow(db.prepare(`SELECT t.*,a.entity_id,a.account_key
    FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.transaction_key=?`).get(key), 'Transaction');
}

function activeAmount(row, field) {
  if (!ACTIVE_STATUSES.has(row.record_status || 'posted')) throw new FinanceError('VERSION_CONFLICT', 'Reimbursement matching requires active transactions', { status: 409 });
  return BigInt(row[field] ?? (field === 'inflow_minor' ? row.inflow : row.outflow) ?? 0);
}

function projection() {
  return `SELECT m.*,r.transaction_key AS reimbursement_transaction_key,
      CAST(COALESCE(r.inflow_minor,r.inflow,0) AS TEXT) AS reimbursement_amount_minor,
      a.account_key,e.entity_key
    FROM reimbursement_matches m
    JOIN transactions r ON r.id=m.reimbursement_transaction_id
    JOIN accounts a ON a.id=r.account_id
    JOIN reporting_entities e ON e.id=a.entity_id`;
}

function serialize(row, db) {
  const items = db.prepare(`SELECT i.id,t.transaction_key AS expense_transaction_key,
      CAST(i.allocated_minor AS TEXT) AS allocated_minor
    FROM reimbursement_match_items i JOIN transactions t ON t.id=i.expense_transaction_id
    WHERE i.match_id=? ORDER BY i.id`).all(row.id);
  const allocated = items.reduce((sum, item) => sum + BigInt(item.allocated_minor), 0n);
  const reimbursement = BigInt(row.reimbursement_amount_minor);
  return {
    ...row,
    reimbursement_amount_minor: reimbursement.toString(),
    allocated_minor: allocated.toString(),
    unallocated_minor: (reimbursement - allocated).toString(),
    items,
  };
}

function getReimbursementMatch(key, db = getDb()) {
  return serialize(requireRow(db.prepare(`${projection()} WHERE m.match_key=?`).get(key), 'Reimbursement match'), db);
}

function listReimbursementMatches({ status = null } = {}, db = getDb()) {
  if (status) enumValue(status, 'reimbursement_match_status', 'status');
  const rows = status
    ? db.prepare(`${projection()} WHERE m.match_status=? ORDER BY m.created_at DESC,m.id DESC`).all(status)
    : db.prepare(`${projection()} ORDER BY m.created_at DESC,m.id DESC`).all();
  return rows.map((row) => serialize(row, db));
}

function normalizeCreate(input, db) {
  if (!Array.isArray(input.items) || input.items.length === 0) throw new FinanceError('VALIDATION_ERROR', 'items must contain at least one expense allocation', { field: 'items' });
  const reimbursement = transaction(db, input.reimbursement_transaction_key);
  const reimbursementAmount = activeAmount(reimbursement, 'inflow_minor');
  if (reimbursementAmount <= 0n) throw new FinanceError('VALIDATION_ERROR', 'Reimbursement transaction must be an inflow', { field: 'reimbursement_transaction_key' });
  const matchCurrency = currency(input.currency);
  if (reimbursement.currency !== matchCurrency) throw new FinanceError('VALIDATION_ERROR', 'Reimbursement transaction currency must match', { field: 'currency' });
  const seen = new Set(); let allocated = 0n;
  const items = input.items.map((item, index) => {
    const key = requiredString(item.expense_transaction_key, `items[${index}].expense_transaction_key`, 80);
    if (seen.has(key)) throw new FinanceError('IDENTITY_CONFLICT', 'An expense can appear only once in a reimbursement match', { status: 409, field: `items[${index}]` });
    seen.add(key);
    const expense = transaction(db, key);
    if (expense.id === reimbursement.id) throw new FinanceError('VALIDATION_ERROR', 'Reimbursement and expense transactions must differ');
    if (expense.entity_id !== reimbursement.entity_id) throw new FinanceError('REVIEW_REQUIRED', 'Cross-entity reimbursement matching requires owner review', { status: 409 });
    if (expense.currency !== matchCurrency) throw new FinanceError('VALIDATION_ERROR', 'Every expense currency must match the reimbursement', { field: `items[${index}].expense_transaction_key` });
    if (activeAmount(expense, 'outflow_minor') <= 0n) throw new FinanceError('VALIDATION_ERROR', 'Every matched expense must be an outflow', { field: `items[${index}].expense_transaction_key` });
    const amount = moneyMinor(item.allocated_minor);
    if (amount <= 0n) throw new FinanceError('VALIDATION_ERROR', 'allocated_minor must be positive', { field: `items[${index}].allocated_minor` });
    allocated += amount;
    return { expense, amount };
  });
  if (allocated > reimbursementAmount) throw new FinanceError('VALIDATION_ERROR', 'Allocated reimbursement cannot exceed the reimbursement inflow', { field: 'items' });
  const confidence = input.confidence == null ? null : Number(input.confidence);
  if (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new FinanceError('VALIDATION_ERROR', 'confidence must be between 0 and 1', { field: 'confidence' });
  const authority = enumValue(input.authority, 'authority', 'authority');
  const status = enumValue(input.match_status, 'reimbursement_match_status', 'match_status', 'proposed');
  if (status === 'confirmed' && !['official', 'user_confirmed'].includes(authority) && (confidence == null || confidence < 0.8)) {
    throw new FinanceError('REVIEW_REQUIRED', 'Low-confidence reimbursement matching requires human review', { status: 409 });
  }
  return {
    reimbursement, items, matchCurrency, confidence, authority, status,
    reason: requiredString(input.reason, 'reason', 1000),
    note: optionalString(input.note, 'note', 1000),
  };
}

function createReimbursementMatch(input, actor = {}, db = getDb()) {
  const value = normalizeCreate(input, db); const key = stableKey();
  return withTransaction(db, () => {
    try {
      const inserted = db.prepare(`INSERT INTO reimbursement_matches(match_key,reimbursement_transaction_id,currency,match_status,confidence,authority,review_state,reason,note)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(
        key, value.reimbursement.id, value.matchCurrency, value.status, value.confidence, value.authority,
        enumValue(input.review_state, 'review_state', 'review_state', value.status === 'confirmed' ? 'confirmed' : 'needs_review'), value.reason, value.note,
      );
      const matchId = Number(inserted.lastInsertRowid);
      const insertItem = db.prepare('INSERT INTO reimbursement_match_items(match_id,expense_transaction_id,allocated_minor) VALUES(?,?,?)');
      for (const item of value.items) insertItem.run(matchId, item.expense.id, item.amount);
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) throw new FinanceError('DUPLICATE', 'An active reimbursement match already exists for this inflow', { status: 409 });
      throw error;
    }
    const row = getReimbursementMatch(key, db);
    if (value.status === 'proposed') createReviewTask({ task_kind: 'reimbursement_match', resource_type: 'reimbursement_match', resource_key: key, priority: 70, reason: 'Confirm the proposed reimbursement-to-expense allocation' }, db);
    logChange(db, { resourceType: 'reimbursement_match', resourceKey: key, action: 'create', after: row, actorType: actor.type, actorNote: actor.note });
    return row;
  });
}

function updateReimbursementMatch(key, input, actor = {}, db = getDb()) {
  return withTransaction(db, () => {
    const before = getReimbursementMatch(key, db);
    assertVersion(before, input.expected_version);
    if (before.match_status !== 'proposed') throw new FinanceError('VERSION_CONFLICT', 'Only proposed reimbursement matches can be resolved', { status: 409 });
    const status = enumValue(input.match_status, 'reimbursement_match_status', 'match_status');
    if (!['confirmed', 'rejected'].includes(status)) throw new FinanceError('VALIDATION_ERROR', 'Resolution must be confirmed or rejected', { field: 'match_status' });
    const note = requiredString(input.resolution_note, 'resolution_note', 1000);
    db.prepare(`UPDATE reimbursement_matches SET match_status=?,review_state=?,note=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE match_key=?`)
      .run(status, status === 'confirmed' ? 'confirmed' : 'rejected', note, key);
    const task = db.prepare("SELECT task_key FROM review_tasks WHERE task_kind='reimbursement_match' AND resource_key=? AND status='open'").get(key);
    if (task) resolveReviewTask(task.task_key, { status: status === 'confirmed' ? 'resolved' : 'dismissed', resolution_note: note }, actor, db, { typedOwner: true });
    const after = getReimbursementMatch(key, db);
    logChange(db, { resourceType: 'reimbursement_match', resourceKey: key, action: status, before, after, actorType: actor.type, actorNote: actor.note });
    return after;
  });
}

module.exports = { getReimbursementMatch, listReimbursementMatches, createReimbursementMatch, updateReimbursementMatch };
