const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { markReviewed, patchTransaction } = require('../lib/queries/transactions');

function isolated(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-transaction-version-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function transaction(db, account, name) {
  return createCashActivity({
    account_key: account.account_key,
    transaction_date: '2026-07-10',
    name,
    amount_minor: '-500',
    currency: 'TWD',
    flow_type: '支出',
    category_primary: '餐飲',
    ai_confidence: 0.4,
    judgment_reason: 'Synthetic low-confidence row.',
  }, {}, db);
}

test('transaction review fails the whole strict batch when one row is stale', () => isolated((db) => {
  const account = createAccount({ display_name: 'Synthetic bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
  const first = transaction(db, account, 'Synthetic first');
  const second = transaction(db, account, 'Synthetic second');
  db.prepare("UPDATE transactions SET updated_at='2026-07-10T12:00:00.000Z' WHERE id=?").run(second.id);

  const result = markReviewed([
    { id: first.id, expected_updated_at: first.updated_at },
    { id: second.id, expected_updated_at: second.updated_at },
  ], db);
  assert.equal(result.reviewed, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].code, 'VERSION_CONFLICT');
  assert.equal(db.prepare('SELECT SUM(reviewed) total FROM transactions').get().total, 0);
}));

test('single correction rejects stale state and succeeds after refresh', () => isolated((db) => {
  const account = createAccount({ display_name: 'Synthetic bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
  const row = transaction(db, account, 'Synthetic correction');
  db.prepare("UPDATE transactions SET updated_at='2026-07-10T12:00:00.000Z' WHERE id=?").run(row.id);

  const stale = patchTransaction(row.id, {
    category_primary: '交通',
    expected_updated_at: row.updated_at,
  }, db);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'VERSION_CONFLICT');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM correction_log').get().count, 0);

  const current = db.prepare('SELECT * FROM transactions WHERE id=?').get(row.id);
  const saved = patchTransaction(row.id, {
    category_primary: '交通',
    expected_updated_at: current.updated_at,
  }, db);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.transaction.category_primary, '交通');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM correction_log').get().count, 1);
}));
