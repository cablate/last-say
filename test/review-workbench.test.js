const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { createSource } = require('../lib/queries/finance/sources');
const { createSourceConflict } = require('../lib/queries/finance/source-conflicts');
const { createTransferMatch, updateTransferMatch } = require('../lib/queries/finance/reconciliation');
const { createReimbursementMatch } = require('../lib/queries/finance/reimbursements');
const { createCommitment } = require('../lib/queries/finance/obligations');
const { createHumanConfirmation } = require('../lib/queries/finance/human-confirmations');
const { listReviewTasks, resolveReviewTask } = require('../lib/queries/finance/review-tasks');
const { CONTRACT, reviewWorkbench } = require('../lib/queries/finance/review-workbench');

function isolated(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-review-workbench-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function account(db, name) {
  return createAccount({
    display_name: name,
    account_kind: 'bank',
    currency: 'TWD',
    authority: 'user_confirmed',
    review_state: 'confirmed',
  }, {}, db);
}

function cash(db, target, amount, name, flowType = 'expense', category = '其他') {
  return createCashActivity({
    account_key: target.account_key,
    transaction_date: '2026-07-10',
    name,
    amount_minor: String(amount),
    currency: 'TWD',
    flow_type: flowType,
    category_primary: category,
    judgment_reason: 'Synthetic workbench fixture.',
  }, {}, db);
}

test('review workbench hydrates every authority class and keeps counts aligned', () => isolated((db) => {
  const checking = account(db, 'Synthetic checking');
  const savings = account(db, 'Synthetic savings');

  const transferOut = cash(db, checking, -5000, 'Synthetic transfer out', '信用卡繳款/移轉', '轉帳/內部移轉');
  const transferIn = cash(db, savings, 5000, 'Synthetic transfer in', '信用卡繳款/移轉', '轉帳/內部移轉');
  const transfer = createTransferMatch({
    from_transaction_key: transferOut.transaction_key,
    to_transaction_key: transferIn.transaction_key,
    amount_minor: '5000',
    currency: 'TWD',
    match_status: 'proposed',
    confidence: 0.75,
    authority: 'ai_inferred',
  }, {}, db);

  const reimbursement = cash(db, checking, 4000, 'Synthetic reimbursement', 'income', '其他收入');
  const expense = cash(db, checking, -3000, 'Synthetic work expense', 'expense', '工作/事業支出');
  createReimbursementMatch({
    reimbursement_transaction_key: reimbursement.transaction_key,
    currency: 'TWD',
    match_status: 'proposed',
    authority: 'ai_inferred',
    confidence: 0.8,
    reason: 'Synthetic reimbursement proposal.',
    items: [{ expense_transaction_key: expense.transaction_key, allocated_minor: '3000' }],
  }, {}, db);

  createCommitment({
    entity_key: 'personal',
    commitment_kind: 'subscription',
    direction: 'out',
    amount_kind: 'fixed',
    amount_minor: '500',
    currency: 'TWD',
    cadence: 'monthly',
    start_date: '2026-01-01',
    next_due_date: '2026-08-01',
    status: 'provisional',
    authority: 'ai_inferred',
    review_state: 'needs_review',
  }, {}, db);

  const left = createSource({ source_kind: 'manual_note', description: 'Synthetic evidence A', authority: 'user_confirmed' }, {}, db);
  const right = createSource({ source_kind: 'manual_note', description: 'Synthetic evidence B', authority: 'official' }, {}, db);
  createSourceConflict({
    target_context: 'valuation',
    semantic_key: 'synthetic:asset:2026-07-10',
    left_source_key: left.source_key,
    right_source_key: right.source_key,
    authority: 'ai_inferred',
    reason: 'Synthetic valuation evidence disagrees.',
    impact_note: 'Valuation completeness remains conflicted.',
  }, {}, db);

  const ownerUnresolved = cash(db, checking, -800, 'Synthetic unresolved row', 'expense', '無法確認');
  createHumanConfirmation({
    action_kind: 'declare_scope_complete',
    resource_type: 'scope_attestation',
    payload: {
      scope_kind: 'cash_accounts',
      as_of_date: '2026-07-10',
      included_note: 'Synthetic scope only.',
      excluded_note: 'None.',
    },
  }, db, new Date());

  const result = reviewWorkbench(db, new Date());
  assert.equal(result.contract, CONTRACT);
  assert.deepEqual(result.counts, {
    human_confirmations: 1,
    actionable_reviews: 3,
    owner_unresolved: 1,
    conflicts: 1,
    total_attention: 6,
  });
  assert.equal(result.partial_errors.length, 0);
  assert.equal(result.sections.human_confirmations[0].actions[0].kind, 'confirm_scope');
  assert.equal(result.sections.owner_unresolved[0].actions[0].kind, 'open_transaction_correction');
  assert.equal(result.sections.owner_unresolved[0].transaction_id, ownerUnresolved.id);
  assert.equal(result.sections.conflicts[0].evidence.length, 2);
  assert.equal(result.sections.conflicts[0].reason, 'Synthetic valuation evidence disagrees.');
  assert.deepEqual(result.sections.conflicts[0].impact.notes, ['Valuation completeness remains conflicted.']);

  const transferItem = result.sections.actionable_reviews.find((item) => item.item_kind === 'transfer_match');
  assert.equal(transferItem.resource.key, transfer.match_key);
  assert.equal(transferItem.resource.version, 1);
  assert.equal(transferItem.evidence.length, 2);
  assert.equal(transferItem.impact.financial[0].amount_minor, '5000');
  assert.deepEqual(transferItem.actions.map((item) => item.kind), ['confirm', 'reject']);
  assert.ok(result.sections.actionable_reviews.every((item) => item.reason));
}));

test('generic task resolution cannot orphan a typed owner decision', () => isolated((db) => {
  const checking = account(db, 'Synthetic checking');
  const savings = account(db, 'Synthetic savings');
  const transferOut = cash(db, checking, -5000, 'Synthetic transfer out', '信用卡繳款/移轉', '轉帳/內部移轉');
  const transferIn = cash(db, savings, 5000, 'Synthetic transfer in', '信用卡繳款/移轉', '轉帳/內部移轉');
  const transfer = createTransferMatch({
    from_transaction_key: transferOut.transaction_key,
    to_transaction_key: transferIn.transaction_key,
    amount_minor: '5000',
    currency: 'TWD',
    match_status: 'proposed',
    confidence: 0.75,
    authority: 'ai_inferred',
  }, {}, db);
  const task = listReviewTasks({}, db)[0];

  assert.throws(() => resolveReviewTask(task.task_key, {
    status: 'resolved',
    resolution_note: 'Unsafe generic close.',
  }, { type: 'human_ui' }, db), (error) => error.code === 'REVIEW_REQUIRED');
  assert.equal(db.prepare('SELECT match_status FROM transfer_matches WHERE match_key=?').get(transfer.match_key).match_status, 'proposed');
  assert.equal(db.prepare('SELECT status FROM review_tasks WHERE task_key=?').get(task.task_key).status, 'open');

  updateTransferMatch(transfer.match_key, {
    expected_version: 1,
    match_status: 'confirmed',
    resolution_note: 'Typed owner confirmation.',
  }, { type: 'human_ui' }, db);
  assert.equal(db.prepare('SELECT status FROM review_tasks WHERE task_key=?').get(task.task_key).status, 'resolved');
}));
