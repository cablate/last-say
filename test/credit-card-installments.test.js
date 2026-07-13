const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { createCreditCardProfile, createInstallmentPlan } = require('../lib/queries/finance/obligations');
const { getIncomeStatement } = require('../lib/queries');

test('installment schedule stores obligations without creating repeated merchant expenses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-installment-'));
  const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const card = createAccount({ display_name: 'Synthetic card', account_kind: 'credit_card', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const profile = createCreditCardProfile({ account_key: card.account_key, currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const purchase = createCashActivity({ account_key: card.account_key, transaction_date: '2026-06-02', external_id: 'installment-origin', name: 'Synthetic appliance', amount_minor: '-1200000', currency: 'TWD', flow_type: '一般支出', category_primary: '購物', ai_confidence: 0.9 }, {}, db);
    db.prepare('UPDATE transactions SET reviewed=1 WHERE transaction_key=?').run(purchase.transaction_key);
    const plan = createInstallmentPlan({ profile_key: profile.profile_key, originating_transaction_key: purchase.transaction_key, financed_principal_minor: '1200000', installment_count: 2, start_date: '2026-07-08', currency: 'TWD', authority: 'official', review_state: 'confirmed', entries: [{ sequence: 1, due_date: '2026-07-08', principal_minor: '600000', total_minor: '600000' }, { sequence: 2, due_date: '2026-08-08', principal_minor: '600000', total_minor: '600000' }] }, {}, db);
    assert.equal(plan.reconciliation_status, 'reconciled');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM transactions').get().count, 1);
    const report = getIncomeStatement(new URLSearchParams('month=2026-06'), db);
    assert.equal(report.total_expense_cents, 1200000);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('partial official installment schedule remains unreconciled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-installment-partial-'));
  const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const card = createAccount({ display_name: 'Synthetic card', account_kind: 'credit_card', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const profile = createCreditCardProfile({ account_key: card.account_key, currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const purchase = createCashActivity({ account_key: card.account_key, transaction_date: '2026-06-02', name: 'Synthetic item', amount_minor: '-1200000', currency: 'TWD', flow_type: '一般支出', category_primary: '購物' }, {}, db);
    const plan = createInstallmentPlan({ profile_key: profile.profile_key, originating_transaction_key: purchase.transaction_key, financed_principal_minor: '1200000', installment_count: 12, start_date: '2026-07-08', currency: 'TWD', authority: 'official', entries: [{ sequence: 1, due_date: '2026-07-08', principal_minor: '100000', total_minor: '100000' }] }, {}, db);
    assert.equal(plan.reconciliation_status, 'unreconciled');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
