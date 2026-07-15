const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createSource } = require('../lib/queries/finance/sources');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const {
  createCreditCardProfile,
  createCardStatement,
  createCardPaymentMatch,
  getCreditCard,
} = require('../lib/queries/finance/obligations');
const { readinessForGoal } = require('../lib/queries/finance/inventory');
const { previewIngestion } = require('../lib/finance/ingestion');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-card-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function cash(db, accountKey, sourceKey, key, name, amount) {
  return createCashActivity({ account_key: accountKey, source_key: sourceKey, transaction_date: '2026-06-02', external_id: key, name, amount_minor: amount, currency: 'TWD', flow_type: '一般支出', category_primary: '待確認' }, {}, db);
}

test('statement owns closed charges and refunds while unbilled and payment facts stay separate', () => fixture((db) => {
  const card = createAccount({ display_name: 'Synthetic card', account_kind: 'credit_card', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  const bank = createAccount({ display_name: 'Synthetic bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  const cardSource = createSource({ source_kind: 'credit_card_statement_csv', description: 'Synthetic card statement', account_key: card.account_key, authority: 'official', is_official: true }, {}, db);
  const bankSource = createSource({ source_kind: 'bank_statement_csv', description: 'Synthetic bank statement', account_key: bank.account_key, authority: 'institution_export' }, {}, db);
  const profile = createCreditCardProfile({ account_key: card.account_key, statement_close_day: 20, payment_due_day: 8, credit_limit_minor: '5000000', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  const charge = cash(db, card.account_key, cardSource.source_key, 'charge', 'Synthetic charge', '-1200000');
  const refund = cash(db, card.account_key, cardSource.source_key, 'refund', 'Synthetic refund', '20000');
  const unbilled = cash(db, card.account_key, cardSource.source_key, 'unbilled', 'Synthetic unbilled', '-340000');
  const statement = createCardStatement({ profile_key: profile.profile_key, source_key: cardSource.source_key, period_start: '2026-05-21', period_end: '2026-06-20', close_date: '2026-06-20', due_date: '2026-07-08', statement_balance_minor: '1180000', minimum_due_minor: '118000', full_due_minor: '1180000', currency: 'TWD', authority: 'official', review_state: 'confirmed', items: [{ transaction_key: charge.transaction_key, item_role: 'charge' }, { transaction_key: refund.transaction_key, item_role: 'refund' }] }, {}, db);
  const payment = cash(db, bank.account_key, bankSource.source_key, 'payment', 'Synthetic card payment', '-600000');
  const match = createCardPaymentMatch({ statement_key: statement.statement_key, transaction_key: payment.transaction_key, amount_minor: '600000', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  assert.equal(match.match_status, 'partial');
  const stored = getCreditCard(profile.profile_key, db);
  assert.deepEqual(stored.statements[0].items.map((item) => item.item_role).sort(), ['charge', 'refund']);
  assert.equal(db.prepare('SELECT account_id FROM transactions WHERE transaction_key=?').get(unbilled.transaction_key).account_id, db.prepare('SELECT account_id FROM credit_card_profiles WHERE profile_key=?').get(profile.profile_key).account_id);
  assert.equal(stored.statements[0].payment_matches.length, 1);
}));

test('an unbilled transaction cannot be attached to a closed statement', () => fixture((db) => {
  const card = createAccount({ display_name: 'Synthetic card', account_kind: 'credit_card', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  const cardSource = createSource({ source_kind: 'credit_card_statement_csv', description: 'Synthetic card statement', account_key: card.account_key, authority: 'official' }, {}, db);
  const profile = createCreditCardProfile({ account_key: card.account_key, currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  const unbilled = cash(db, card.account_key, cardSource.source_key, 'future', 'Future charge', '-10000');
  assert.throws(() => createCardStatement({ profile_key: profile.profile_key, source_key: cardSource.source_key, period_start: '2026-05-21', period_end: '2026-06-20', close_date: '2026-06-20', due_date: '2026-07-08', statement_balance_minor: '0', currency: 'TWD', authority: 'official', items: [{ transaction_key: unbilled.transaction_key, item_role: 'unbilled' }] }, {}, db), (error) => error.code === 'VALIDATION_ERROR');
}));

test('debt readiness names a missing statement instead of claiming completeness', () => fixture((db) => {
  const card = createAccount({ display_name: 'Card without statement', account_kind: 'credit_card', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  createCreditCardProfile({ account_key: card.account_key, currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  const readiness = readinessForGoal('debt_obligations', { asOfDate: '2026-07-14' }, db);
  assert.ok(readiness.gaps.some((gap) => gap.gap === 'missing_credit_card_statement'));
}));

test('compound card ingestion rejects invalid installments before staging canonical context', () => fixture((db) => {
  const bundle = {
    schema_id: 'finance.ingestion-bundle/v1', idempotency_key: 'card-atomic-invalid', bundle_kind: 'card_statement',
    authority: 'official', reason: 'Synthetic compound card fixture.', sections: {
      accounts: [{ client_item_key: 'card-account', display_name: 'Atomic card', account_kind: 'credit_card', currency: 'TWD', authority: 'official', review_state: 'confirmed' }],
      sources: [{ client_item_key: 'card-source', account_client_ref: 'card-account', source_kind: 'credit_card_statement_csv', description: 'Atomic statement', authority: 'official', review_state: 'confirmed' }],
      cash_transactions: [{ client_item_key: 'charge', account_client_ref: 'card-account', source_client_ref: 'card-source', transaction_date: '2026-06-02', name: 'Atomic charge', amount_minor: '-1200000', currency: 'TWD', flow_type: '一般支出', category_primary: '購物' }],
      balance_snapshots: [{ client_item_key: 'balance', account_client_ref: 'card-account', source_client_ref: 'card-source', as_of_date: '2026-06-20', observed_at: '2026-06-20T00:00:00Z', balance_kind: 'statement', amount_minor: '-1200000', currency: 'TWD', authority: 'official', review_state: 'confirmed' }],
      credit_card_profiles: [{ client_item_key: 'profile', account_client_ref: 'card-account', currency: 'TWD', authority: 'official', review_state: 'confirmed' }],
      credit_card_statements: [{ client_item_key: 'statement', profile_client_ref: 'profile', source_client_ref: 'card-source', period_start: '2026-05-21', period_end: '2026-06-20', close_date: '2026-06-20', due_date: '2026-07-08', statement_balance_minor: '1200000', currency: 'TWD', authority: 'official', review_state: 'confirmed', items: [{ transaction_client_ref: 'charge', item_role: 'charge' }] }],
      credit_card_installments: [{ client_item_key: 'plan', profile_client_ref: 'profile', originating_transaction_client_ref: 'charge', financed_principal_minor: '1200000', installment_count: 1, start_date: '2026-07-08', currency: 'TWD', authority: 'official', entries: [{ sequence: 1, due_date: '2026-07-08', principal_minor: '1200000', interest_minor: '0', total_minor: '1199999' }] }],
    },
  };
  assert.throws(() => previewIngestion(bundle, {}, db), (error) => error.code === 'VALIDATION_ERROR');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM ingestion_runs').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM accounts').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM transactions').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM credit_card_statements').get().count, 0);
}));
