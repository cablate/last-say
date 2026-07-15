const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { createCommitment, updateCommitment } = require('../lib/queries/finance/obligations');
const { createTransferMatch, updateTransferMatch, reconciliationSummary } = require('../lib/queries/finance/reconciliation');

function isolated(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-reconciliation-candidates-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function account(db, name) {
  return createAccount({ display_name: name, account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
}

function transferCash(db, target, amount, name, category = '轉帳/內部移轉') {
  return createCashActivity({
    account_key: target.account_key,
    transaction_date: '2026-07-02',
    name,
    amount_minor: amount,
    currency: 'TWD',
    flow_type: '信用卡繳款/移轉',
    category_primary: category,
    judgment_reason: 'Synthetic transfer candidate',
  }, {}, db);
}

test('detectable unmatched transfer-shaped cash prevents false complete status', () => isolated((db) => {
  const a = account(db, 'A');
  const b = account(db, 'B');
  transferCash(db, a, '-100000', 'UNKNOWN OUT', '無法確認');
  transferCash(db, b, '100000', 'TRANSFER IN');
  const summary = reconciliationSummary(db);
  assert.equal(summary.status, 'unreconciled');
  assert.equal(summary.unmatched_transfer_candidates.length, 2);
  assert.deepEqual(new Set(summary.unmatched_transfer_candidates.map((row) => row.candidate_reason)), new Set(['owner_unresolved_transfer_shape', 'unmatched_internal_transfer']));
}));

test('rejected transfer leaves evidence but returns both legs to candidate scope', () => isolated((db) => {
  const a = account(db, 'A');
  const b = account(db, 'B');
  const out = transferCash(db, a, '-100000', 'OUT');
  const incoming = transferCash(db, b, '100000', 'IN');
  const proposed = createTransferMatch({
    from_transaction_key: out.transaction_key,
    to_transaction_key: incoming.transaction_key,
    amount_minor: '100000',
    currency: 'TWD',
    match_status: 'proposed',
    confidence: 0.6,
    authority: 'ai_inferred',
  }, {}, db);
  assert.equal(reconciliationSummary(db).unmatched_transfer_candidates.length, 0);
  updateTransferMatch(proposed.match_key, { expected_version: 1, match_status: 'rejected', resolution_note: 'These cash rows are unrelated.' }, { type: 'human_ui' }, db);
  const summary = reconciliationSummary(db);
  assert.equal(summary.typed_legs.length, 0);
  assert.equal(summary.unmatched_transfer_candidates.length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM transfer_matches WHERE match_status='rejected'").get().count, 1);
}));

test('AI recurring commitment enters review queue and owner promotion closes it', () => isolated((db) => {
  const candidate = createCommitment({
    entity_key: 'personal',
    commitment_kind: 'subscription',
    direction: 'out',
    amount_kind: 'fixed',
    amount_minor: '50000',
    currency: 'TWD',
    cadence: 'monthly',
    start_date: '2026-01-01',
    next_due_date: '2026-08-01',
    status: 'provisional',
    authority: 'ai_inferred',
    review_state: 'needs_review',
  }, {}, db);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM review_tasks WHERE task_kind='commitment_candidate' AND status='open'").get().count, 1);
  const confirmed = updateCommitment(candidate.commitment_key, {
    entity_key: 'personal',
    commitment_kind: 'subscription',
    direction: 'out',
    amount_kind: 'fixed',
    amount_minor: '50000',
    currency: 'TWD',
    cadence: 'monthly',
    start_date: '2026-01-01',
    next_due_date: '2026-08-01',
    status: 'scheduled',
    authority: 'user_confirmed',
    review_state: 'confirmed',
    expected_version: 1,
  }, { type: 'human_ui' }, db);
  assert.equal(confirmed.status, 'scheduled');
  assert.equal(db.prepare("SELECT status FROM review_tasks WHERE task_kind='commitment_candidate'").get().status, 'resolved');
}));
