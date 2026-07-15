const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { createEntity } = require('../lib/queries/finance/entities');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { createTransferMatch, updateTransferMatch, reconciliationSummary } = require('../lib/queries/finance/reconciliation');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-transfer-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try {
    const account = (name, entityKey = 'personal') => createAccount({
      entity_key: entityKey,
      display_name: name,
      account_kind: 'bank',
      currency: 'TWD',
      authority: 'user_confirmed',
      review_state: 'confirmed',
    }, {}, db);
    const cash = (target, amount, name) => createCashActivity({
      account_key: target.account_key,
      transaction_date: '2026-07-01',
      name,
      amount_minor: amount,
      currency: 'TWD',
      flow_type: '信用卡繳款/移轉',
      category_primary: '轉帳/內部移轉',
      judgment_reason: 'Synthetic transfer fixture',
    }, {}, db);
    return run({ db, account, cash });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('confirmed bank transfer pairs opposite cash legs without duplicate context', () => fixture(({ db, account, cash }) => {
  const a = account('Synthetic A');
  const b = account('Synthetic B');
  const outflow = cash(a, '-500000', 'SYNTHETIC OUT');
  const inflow = cash(b, '500000', 'SYNTHETIC IN');
  const match = createTransferMatch({
    from_transaction_key: outflow.transaction_key,
    to_transaction_key: inflow.transaction_key,
    amount_minor: '500000',
    currency: 'TWD',
    match_status: 'confirmed',
    confidence: 0.99,
    authority: 'ai_researched',
    review_state: 'reviewed',
  }, {}, db);
  assert.equal(match.match_status, 'confirmed');
  assert.notEqual(match.updated_at, '');
  const summary = reconciliationSummary(db);
  assert.equal(summary.status, 'complete');
  assert.equal(summary.typed_legs.length, 2);
  assert.equal(summary.unmatched_transfer_candidates.length, 0);
}));

test('transfer matching rejects wrong direction, same account, cross entity, and over-allocation', () => fixture(({ db, account, cash }) => {
  const businessEntity = createEntity({ name: 'Synthetic business', entity_type: 'business', base_currency: 'TWD' }, {}, db);
  const a = account('A');
  const b = account('B');
  const business = account('Business', businessEntity.entity_key);
  const out = cash(a, '-500000', 'OUT');
  const incoming = cash(b, '500000', 'IN');
  const sameAccountIn = cash(a, '500000', 'SAME ACCOUNT IN');
  const businessIn = cash(business, '500000', 'BUSINESS IN');
  const base = { from_transaction_key: out.transaction_key, amount_minor: '500000', currency: 'TWD', match_status: 'proposed', confidence: 0.8, authority: 'ai_inferred' };
  assert.throws(() => createTransferMatch({ ...base, from_transaction_key: incoming.transaction_key, to_transaction_key: out.transaction_key }, {}, db), /must be an outflow/i);
  assert.throws(() => createTransferMatch({ ...base, to_transaction_key: sameAccountIn.transaction_key }, {}, db), /different accounts/i);
  assert.throws(() => createTransferMatch({ ...base, to_transaction_key: businessIn.transaction_key }, {}, db), /cross-entity/i);
  assert.throws(() => createTransferMatch({ ...base, to_transaction_key: incoming.transaction_key, amount_minor: '500001' }, {}, db), /cannot exceed/i);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM transfer_matches').get().count, 0);
}));

test('proposed transfer resolves with version check and closes review task', () => fixture(({ db, account, cash }) => {
  const a = account('A');
  const b = account('B');
  const out = cash(a, '-500000', 'OUT');
  const incoming = cash(b, '500000', 'IN');
  const proposed = createTransferMatch({
    from_transaction_key: out.transaction_key,
    to_transaction_key: incoming.transaction_key,
    amount_minor: '500000',
    currency: 'TWD',
    match_status: 'proposed',
    confidence: 0.7,
    authority: 'ai_inferred',
  }, {}, db);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM review_tasks WHERE task_kind='transfer_match' AND status='open'").get().count, 1);
  assert.throws(() => updateTransferMatch(proposed.match_key, { expected_version: 99, match_status: 'confirmed', resolution_note: 'Owner checked both accounts.' }, {}, db), /Expected version/i);
  const confirmed = updateTransferMatch(proposed.match_key, { expected_version: 1, match_status: 'confirmed', resolution_note: 'Owner checked both accounts.' }, { type: 'human_ui' }, db);
  assert.equal(confirmed.match_status, 'confirmed');
  assert.equal(confirmed.version, 2);
  assert.equal(db.prepare("SELECT status FROM review_tasks WHERE task_kind='transfer_match'").get().status, 'resolved');
}));
