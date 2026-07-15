const { FinanceError, enumValue, currency, optionalString, requiredString, expectedVersion } = require('../../finance/contracts');
const { moneyMinor } = require('./balances');
const { createReviewTask, resolveReviewTask } = require('./review-tasks');
const { getDb, stableKey, logChange, requireRow, assertVersion, withTransaction } = require('./common');

const ACTIVE_TRANSACTION_STATUSES = new Set(['provisional', 'posted', 'confirmed']);

function transaction(db, key, required = true) {
  if (!key && !required) return null;
  return requireRow(db.prepare(`SELECT t.*,a.account_key,a.entity_id,
      CAST(COALESCE(t.inflow_minor,t.inflow,0) AS TEXT) AS active_inflow_minor,
      CAST(COALESCE(t.outflow_minor,t.outflow,0) AS TEXT) AS active_outflow_minor
    FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.transaction_key=?`).get(key), 'Transaction');
}

function activeLegAmount(row, direction) {
  if (!ACTIVE_TRANSACTION_STATUSES.has(row.record_status || 'posted')) {
    throw new FinanceError('VERSION_CONFLICT', 'Transfer matching requires active transactions', { status: 409 });
  }
  return BigInt(direction === 'out' ? row.active_outflow_minor : row.active_inflow_minor);
}

function projection() {
  return `SELECT m.*,f.transaction_key AS from_transaction_key,t.transaction_key AS to_transaction_key
    FROM transfer_matches m JOIN transactions f ON f.id=m.from_transaction_id
    LEFT JOIN transactions t ON t.id=m.to_transaction_id`;
}

function serialize(row) {
  return { ...row, amount_minor: String(row.amount_minor) };
}

function getTransferMatch(key, db = getDb()) {
  return serialize(requireRow(db.prepare(`${projection()} WHERE m.match_key=?`).get(key), 'Transfer match'));
}

function listTransferMatches({ status = null } = {}, db = getDb()) {
  if (status) enumValue(status, 'transfer_match_status', 'status');
  const rows = status
    ? db.prepare(`${projection()} WHERE m.match_status=? ORDER BY m.created_at DESC,m.id DESC`).all(status)
    : db.prepare(`${projection()} ORDER BY m.created_at DESC,m.id DESC`).all();
  return rows.map(serialize);
}

function allocatedToLeg(db, transactionId) {
  return BigInt(db.prepare(`SELECT CAST(COALESCE(SUM(amount_minor),0) AS TEXT) amount_minor
    FROM transfer_matches
    WHERE match_status<>'rejected' AND (from_transaction_id=? OR to_transaction_id=?)`).get(transactionId, transactionId).amount_minor);
}

function validateTransferMatch(input, db) {
  const from = transaction(db, requiredString(input.from_transaction_key, 'from_transaction_key', 80));
  const to = transaction(db, input.to_transaction_key, false);
  if (to && from.id === to.id) throw new FinanceError('VALIDATION_ERROR', 'Transfer legs must be different transactions');
  const fromAmount = activeLegAmount(from, 'out');
  if (fromAmount <= 0n) throw new FinanceError('VALIDATION_ERROR', 'Transfer from leg must be an outflow', { field: 'from_transaction_key' });
  let toAmount = null;
  if (to) {
    toAmount = activeLegAmount(to, 'in');
    if (toAmount <= 0n) throw new FinanceError('VALIDATION_ERROR', 'Transfer to leg must be an inflow', { field: 'to_transaction_key' });
    if (from.entity_id !== to.entity_id) throw new FinanceError('REVIEW_REQUIRED', 'Cross-entity cash movement is not an own-account transfer', { status: 409 });
    if (from.account_id === to.account_id) throw new FinanceError('VALIDATION_ERROR', 'Own-account transfer legs must use different accounts', { field: 'to_transaction_key' });
  }
  const amount = moneyMinor(input.amount_minor);
  if (amount <= 0n) throw new FinanceError('VALIDATION_ERROR', 'amount_minor must be positive', { field: 'amount_minor' });
  const matchCurrency = currency(input.currency);
  if (from.currency !== matchCurrency || (to && to.currency !== matchCurrency)) {
    throw new FinanceError('VALIDATION_ERROR', 'Transfer legs and match currency must agree', { field: 'currency' });
  }
  if (allocatedToLeg(db, from.id) + amount > fromAmount || (to && allocatedToLeg(db, to.id) + amount > toAmount)) {
    throw new FinanceError('VALIDATION_ERROR', 'Transfer allocation cannot exceed either cash leg', { field: 'amount_minor' });
  }
  const confidence = input.confidence == null ? null : Number(input.confidence);
  if (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new FinanceError('VALIDATION_ERROR', 'confidence must be between 0 and 1', { field: 'confidence' });
  }
  const authority = enumValue(input.authority, 'authority', 'authority');
  const status = enumValue(input.match_status, 'transfer_match_status', 'match_status', 'proposed');
  if (!to && status === 'confirmed') throw new FinanceError('REVIEW_REQUIRED', 'A one-sided transfer cannot be confirmed', { status: 409 });
  if (status === 'confirmed' && !['user_confirmed', 'official'].includes(authority) && (confidence == null || confidence < 0.8)) {
    throw new FinanceError('REVIEW_REQUIRED', 'Low-confidence transfer requires human review', { status: 409 });
  }
  return { from, to, amount, matchCurrency, confidence, authority, status };
}

function createTransferMatch(input, actor = {}, db = getDb()) {
  const value = validateTransferMatch(input, db);
  const key = stableKey();
  return withTransaction(db, () => {
    try {
      db.prepare(`INSERT INTO transfer_matches(match_key,from_transaction_id,to_transaction_id,amount_minor,currency,match_status,confidence,authority,review_state,note,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
        key, value.from.id, value.to?.id || null, value.amount, value.matchCurrency, value.status, value.confidence, value.authority,
        enumValue(input.review_state, 'review_state', 'review_state', value.status === 'confirmed' ? 'confirmed' : 'needs_review'),
        optionalString(input.note, 'note', 1000),
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        throw new FinanceError('DUPLICATE', 'This transfer pair already has a recorded decision', { status: 409 });
      }
      throw error;
    }
    const row = getTransferMatch(key, db);
    if (value.status === 'proposed') {
      createReviewTask({
        task_kind: 'transfer_match', resource_type: 'transfer_match', resource_key: key, priority: value.to ? 65 : 80,
        reason: value.to ? 'Confirm the proposed internal transfer pair' : 'Find the missing internal transfer leg',
      }, db);
    }
    logChange(db, { resourceType: 'transfer_match', resourceKey: key, action: 'create', after: row, actorType: actor.type, actorNote: actor.note });
    return row;
  });
}

function updateTransferMatch(key, input, actor = {}, db = getDb()) {
  return withTransaction(db, () => {
    const before = getTransferMatch(key, db);
    assertVersion(before, expectedVersion(input.expected_version));
    if (before.match_status !== 'proposed') throw new FinanceError('VERSION_CONFLICT', 'Only proposed transfer matches can be resolved', { status: 409 });
    const status = enumValue(input.match_status, 'transfer_match_status', 'match_status');
    if (!['confirmed', 'rejected'].includes(status)) throw new FinanceError('VALIDATION_ERROR', 'Resolution must be confirmed or rejected', { field: 'match_status' });
    if (status === 'confirmed' && !before.to_transaction_id) throw new FinanceError('REVIEW_REQUIRED', 'A one-sided transfer cannot be confirmed', { status: 409 });
    const note = requiredString(input.resolution_note, 'resolution_note', 1000);
    db.prepare(`UPDATE transfer_matches SET match_status=?,review_state=?,note=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE match_key=?`)
      .run(status, status === 'confirmed' ? 'confirmed' : 'rejected', note, key);
    const task = db.prepare("SELECT task_key FROM review_tasks WHERE task_kind='transfer_match' AND resource_key=? AND status='open'").get(key);
    if (task) resolveReviewTask(task.task_key, { status: status === 'confirmed' ? 'resolved' : 'dismissed', resolution_note: note }, actor, db, { typedOwner: true });
    const after = getTransferMatch(key, db);
    logChange(db, { resourceType: 'transfer_match', resourceKey: key, action: status, before, after, actorType: actor.type, actorNote: actor.note });
    return after;
  });
}

function listUnmatchedTransferCandidates(db = getDb()) {
  return db.prepare(`SELECT t.transaction_key,t.transaction_date,t.name,t.currency,a.account_key,
      CAST(COALESCE(t.amount_minor,t.amount,0) AS TEXT) amount_minor,
      CASE WHEN COALESCE(t.outflow_minor,t.outflow,0)>0 THEN 'out' ELSE 'in' END direction,
      CASE WHEN t.category_primary='無法確認' THEN 'owner_unresolved_transfer_shape' ELSE 'unmatched_internal_transfer' END candidate_reason
    FROM transactions t JOIN accounts a ON a.id=t.account_id
    WHERE COALESCE(t.record_status,'posted') IN ('provisional','posted','confirmed')
      AND (t.category_primary='轉帳/內部移轉' OR (t.category_primary='無法確認' AND t.flow_type='信用卡繳款/移轉'))
      AND NOT EXISTS (SELECT 1 FROM transfer_matches m WHERE m.match_status<>'rejected' AND (m.from_transaction_id=t.id OR m.to_transaction_id=t.id))
      AND NOT EXISTS (SELECT 1 FROM credit_card_payment_matches m WHERE m.record_status NOT IN ('reversed','superseded','archived') AND m.transaction_id=t.id)
      AND NOT EXISTS (SELECT 1 FROM loan_payment_allocations m WHERE m.record_status NOT IN ('reversed','superseded','archived') AND m.transaction_id=t.id)
      AND NOT EXISTS (SELECT 1 FROM investment_cash_matches m WHERE m.transaction_id=t.id)
      AND NOT EXISTS (SELECT 1 FROM reimbursement_matches m WHERE m.match_status<>'rejected' AND m.reimbursement_transaction_id=t.id)
      AND NOT EXISTS (SELECT 1 FROM reimbursement_match_items i JOIN reimbursement_matches m ON m.id=i.match_id WHERE m.match_status<>'rejected' AND i.expense_transaction_id=t.id)
    ORDER BY t.transaction_date,t.id`).all();
}

function reconciliationSummary(db = getDb()) {
  const legs = db.prepare(`
    SELECT t.transaction_key,'card_settlement' context,m.match_status status FROM credit_card_payment_matches m JOIN transactions t ON t.id=m.transaction_id WHERE m.record_status NOT IN ('reversed','superseded','archived')
    UNION ALL SELECT t.transaction_key,'loan_allocation',m.reconciliation_status FROM loan_payment_allocations m JOIN transactions t ON t.id=m.transaction_id WHERE m.record_status NOT IN ('reversed','superseded','archived')
    UNION ALL SELECT t.transaction_key,'investment_cash_leg',m.reconciliation_status FROM investment_cash_matches m JOIN transactions t ON t.id=m.transaction_id
    UNION ALL SELECT t.transaction_key,'reimbursement',m.match_status FROM reimbursement_matches m JOIN transactions t ON t.id=m.reimbursement_transaction_id WHERE m.match_status<>'rejected'
    UNION ALL SELECT t.transaction_key,'reimbursement',m.match_status FROM reimbursement_match_items i JOIN reimbursement_matches m ON m.id=i.match_id JOIN transactions t ON t.id=i.expense_transaction_id WHERE m.match_status<>'rejected'
    UNION ALL SELECT f.transaction_key,'internal_transfer',m.match_status FROM transfer_matches m JOIN transactions f ON f.id=m.from_transaction_id WHERE m.match_status<>'rejected'
    UNION ALL SELECT t.transaction_key,'internal_transfer',m.match_status FROM transfer_matches m JOIN transactions t ON t.id=m.to_transaction_id WHERE m.to_transaction_id IS NOT NULL AND m.match_status<>'rejected'
  `).all();
  const byTransaction = new Map();
  for (const leg of legs) {
    const current = byTransaction.get(leg.transaction_key) || [];
    current.push({ context: leg.context, status: leg.status });
    byTransaction.set(leg.transaction_key, current);
  }
  const conflicts = [...byTransaction.entries()]
    .filter(([, entries]) => new Set(entries.map((entry) => entry.context)).size > 1)
    .map(([transaction_key, entries]) => ({ transaction_key, entries }));
  const oneSided = db.prepare(`SELECT m.match_key,f.transaction_key AS from_transaction_key FROM transfer_matches m
    JOIN transactions f ON f.id=m.from_transaction_id WHERE m.to_transaction_id IS NULL AND m.match_status<>'rejected'`).all();
  const pending = db.prepare("SELECT COUNT(*) count FROM transfer_matches WHERE match_status='proposed'").get().count;
  const pendingReimbursements = db.prepare("SELECT COUNT(*) count FROM reimbursement_matches WHERE match_status='proposed'").get().count;
  const sourceConflicts = db.prepare("SELECT conflict_key,target_context,semantic_key FROM source_conflicts WHERE status='open' ORDER BY created_at,id").all();
  const candidates = listUnmatchedTransferCandidates(db);
  return {
    status: conflicts.length || sourceConflicts.length ? 'conflicted' : (oneSided.length || pending || pendingReimbursements || candidates.length ? 'unreconciled' : 'complete'),
    typed_legs: legs,
    duplicate_context_conflicts: conflicts,
    source_conflicts: sourceConflicts,
    one_sided_transfers: oneSided,
    unmatched_transfer_candidates: candidates,
    pending_transfer_matches: pending,
    pending_reimbursement_matches: pendingReimbursements,
    completeness_scope: 'registered typed matches plus detectable transfer-shaped active cash rows',
  };
}

module.exports = {
  getTransferMatch,
  listTransferMatches,
  createTransferMatch,
  updateTransferMatch,
  listUnmatchedTransferCandidates,
  reconciliationSummary,
};
