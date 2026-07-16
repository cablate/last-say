const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase, SCHEMA_VERSION } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createEntity } = require('../lib/queries/finance/entities');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { createReimbursementMatch, updateReimbursementMatch } = require('../lib/queries/finance/reimbursements');
const { reconciliationSummary } = require('../lib/queries/finance/reconciliation');
const { previewIngestion, commitIngestion } = require('../lib/finance/ingestion');
const { reversePreview, reverseIngestion } = require('../lib/finance/ingestion/reversal');
const { createHumanConfirmation, confirmHumanConfirmation, consumeHumanConfirmation } = require('../lib/queries/finance/human-confirmations');

function isolatedDb(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  return { db, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function createTransaction(db, accountKey, amount, name) {
  return createCashActivity({
    account_key: accountKey,
    transaction_date: '2026-06-01',
    name,
    amount_minor: String(amount),
    currency: 'TWD',
    flow_type: amount > 0 ? 'income' : 'expense',
    category_primary: amount > 0 ? 'reimbursement' : 'work expense',
  }, {}, db);
}

test('reimbursement matching preserves gross facts and resolves through review', () => {
  const fixture = isolatedDb('finance-reimbursement-'); const { db } = fixture;
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT MAX(version) version FROM schema_migrations').get().version, SCHEMA_VERSION);
    const account = createAccount({ display_name: 'Test bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
    const reimbursement = createTransaction(db, account.account_key, 5000, 'Travel reimbursement');
    const expenseA = createTransaction(db, account.account_key, -1200, 'Train');
    const expenseB = createTransaction(db, account.account_key, -2800, 'Hotel');
    const match = createReimbursementMatch({
      reimbursement_transaction_key: reimbursement.transaction_key,
      currency: 'TWD', match_status: 'proposed', authority: 'ai_inferred', confidence: 0.91,
      reason: 'Same work trip and documented reimbursement.',
      items: [
        { expense_transaction_key: expenseA.transaction_key, allocated_minor: '1200' },
        { expense_transaction_key: expenseB.transaction_key, allocated_minor: '2800' },
      ],
    }, { type: 'ai' }, db);

    assert.equal(match.allocated_minor, '4000');
    assert.equal(match.unallocated_minor, '1000');
    assert.equal(db.prepare("SELECT COUNT(*) count FROM review_tasks WHERE task_kind='reimbursement_match' AND status='open'").get().count, 1);
    assert.equal(db.prepare('SELECT amount_minor FROM transactions WHERE transaction_key=?').get(reimbursement.transaction_key).amount_minor, 5000);
    assert.equal(db.prepare('SELECT amount_minor FROM transactions WHERE transaction_key=?').get(expenseA.transaction_key).amount_minor, -1200);
    assert.equal(reconciliationSummary(db).status, 'unreconciled');
    assert.equal(reconciliationSummary(db).duplicate_context_conflicts.length, 0);

    const confirmed = updateReimbursementMatch(match.match_key, { expected_version: 1, match_status: 'confirmed', resolution_note: 'Receipts checked.' }, { type: 'human_ui' }, db);
    assert.equal(confirmed.match_status, 'confirmed');
    assert.equal(confirmed.version, 2);
    assert.equal(db.prepare("SELECT status FROM review_tasks WHERE task_kind='reimbursement_match'").get().status, 'resolved');
    assert.equal(reconciliationSummary(db).status, 'complete');
    assert.throws(() => updateReimbursementMatch(match.match_key, { expected_version: 1, match_status: 'rejected', resolution_note: 'Stale.' }, {}, db), /version/i);
  } finally { fixture.close(); }
});

test('reimbursement matching rejects invalid allocations and permits replacement after rejection', () => {
  const fixture = isolatedDb('finance-reimbursement-invalid-'); const { db } = fixture;
  try {
    const account = createAccount({ display_name: 'Test bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
    const reimbursement = createTransaction(db, account.account_key, 1000, 'Reimbursement');
    const expense = createTransaction(db, account.account_key, -800, 'Expense');
    const usdAccount = createAccount({ display_name: 'USD account', account_kind: 'bank', currency: 'USD', authority: 'user_confirmed' }, {}, db);
    const usdExpense = createCashActivity({ account_key: usdAccount.account_key, transaction_date: '2026-06-01', name: 'USD expense', amount_minor: '-800', currency: 'USD', flow_type: 'expense', category_primary: 'work expense' }, {}, db);
    const business = createEntity({ name: 'Test business', entity_type: 'business', base_currency: 'TWD' }, {}, db);
    const businessAccount = createAccount({ entity_key: business.entity_key, display_name: 'Business bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
    const businessExpense = createTransaction(db, businessAccount.account_key, -800, 'Business expense');
    const base = { reimbursement_transaction_key: reimbursement.transaction_key, currency: 'TWD', authority: 'ai_inferred', confidence: 0.9, reason: 'Test.', items: [{ expense_transaction_key: expense.transaction_key, allocated_minor: '800' }] };
    assert.throws(() => createReimbursementMatch({ ...base, items: [{ expense_transaction_key: expense.transaction_key, allocated_minor: '1200' }] }, {}, db), /cannot exceed/i);
    assert.throws(() => createReimbursementMatch({ ...base, reimbursement_transaction_key: expense.transaction_key }, {}, db), /must be an inflow/i);
    assert.throws(() => createReimbursementMatch({ ...base, items: [...base.items, ...base.items] }, {}, db), /only once/i);
    assert.throws(() => createReimbursementMatch({ ...base, items: [{ expense_transaction_key: usdExpense.transaction_key, allocated_minor: '800' }] }, {}, db), /currency must match/i);
    assert.throws(() => createReimbursementMatch({ ...base, items: [{ expense_transaction_key: businessExpense.transaction_key, allocated_minor: '800' }] }, {}, db), /Cross-entity/i);
    const first = createReimbursementMatch({ ...base, match_status: 'proposed' }, {}, db);
    assert.throws(() => createReimbursementMatch({ ...base, match_status: 'proposed' }, {}, db), /already exists/i);
    updateReimbursementMatch(first.match_key, { expected_version: 1, match_status: 'rejected', resolution_note: 'Wrong trip.' }, {}, db);
    const replacement = createReimbursementMatch({ ...base, match_status: 'proposed', reason: 'Corrected proposal.' }, {}, db);
    assert.notEqual(replacement.match_key, first.match_key);
  } finally { fixture.close(); }
});

test('compound ingestion resolves reimbursement references and reverses additively', () => {
  const fixture = isolatedDb('finance-reimbursement-ingestion-'); const { db } = fixture;
  try {
    const sections = {
      accounts: [{ client_item_key: 'account', display_name: 'Imported bank', account_kind: 'bank', currency: 'TWD', authority: 'ai_inferred' }],
      cash_transactions: [
        { client_item_key: 'income', account_client_ref: 'account', transaction_date: '2026-06-10', name: 'Reimbursement', amount_minor: '5000', currency: 'TWD', flow_type: 'income', category_primary: 'reimbursement' },
        { client_item_key: 'train', account_client_ref: 'account', transaction_date: '2026-06-09', name: 'Train', amount_minor: '-1200', currency: 'TWD', flow_type: 'expense', category_primary: 'work expense' },
        { client_item_key: 'hotel', account_client_ref: 'account', transaction_date: '2026-06-09', name: 'Hotel', amount_minor: '-2800', currency: 'TWD', flow_type: 'expense', category_primary: 'work expense' },
      ],
      reimbursement_matches: [{
        client_item_key: 'match', reimbursement_transaction_client_ref: 'income', currency: 'TWD', match_status: 'proposed', authority: 'ai_inferred', confidence: 0.9, reason: 'Imported trip.',
        items: [
          { expense_transaction_client_ref: 'train', allocated_minor: '1200' },
          { expense_transaction_client_ref: 'hotel', allocated_minor: '2800' },
        ],
      }],
    };
    const bundle = { schema_id: 'finance.ingestion-bundle/v1', idempotency_key: 'reimbursement-bundle', bundle_kind: 'mixed', authority: 'ai_inferred', reason: 'Synthetic integration test.', sections };
    const run = commitIngestion(previewIngestion(bundle, {}, db).run_key, {}, db);
    assert.equal(run.result.created.reimbursement_matches.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM reimbursement_match_items').get().count, 2);

    const impact = reversePreview(run.run_key, db);
    assert.equal(impact.reversible, true);
    const payload = { reason: 'Synthetic reversal.', impact_hash: impact.impact_hash };
    const proposal = createHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: run.run_key, payload, expected_version: null }, db);
    const receipt = confirmHumanConfirmation(proposal.proposal_key, { browserConfirmed: true }, db);
    consumeHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: run.run_key, payload, expected_version: null, proposal_key: proposal.proposal_key, confirmation_receipt: receipt.confirmation_receipt }, (authorization) => reverseIngestion(run.run_key, payload, { type: 'human_ui' }, db, authorization), db);
    assert.equal(db.prepare('SELECT match_status FROM reimbursement_matches').get().match_status, 'rejected');
    assert.equal(db.prepare("SELECT status FROM review_tasks WHERE task_kind='reimbursement_match'").get().status, 'dismissed');
    assert.equal(db.prepare('SELECT COUNT(*) count FROM reimbursement_match_items').get().count, 2);

    const invalid = structuredClone(bundle); invalid.idempotency_key = 'bad-reimbursement-ref';
    invalid.sections.reimbursement_matches[0].items[0].expense_transaction_client_ref = 'missing';
    assert.throws(() => previewIngestion(invalid, {}, db), /Unresolved expense_transaction_client_ref/);
  } finally { fixture.close(); }
});
