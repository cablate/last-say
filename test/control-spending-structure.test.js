const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createSource } = require('../lib/queries/finance/sources');
const { createReimbursementMatch } = require('../lib/queries/finance/reimbursements');
const { getSpendingStructure } = require('../lib/queries/finance/control/spending-structure');
const { analysisContext } = require('../lib/queries/finance/analysis-context');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-spending-structure-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function account(db) {
  return createAccount({
    display_name: 'Synthetic spending account', account_kind: 'bank', currency: 'TWD',
    authority: 'user_confirmed', review_state: 'confirmed',
  }, {}, db);
}

function source(db, accountKey) {
  return createSource({
    source_kind: 'bank_statement_csv', description: 'Synthetic spending statement', account_key: accountKey,
    authority: 'official', review_state: 'confirmed', is_official: true,
  }, {}, db);
}

function transaction(db, target, evidence, key, amount, name, category) {
  const value = BigInt(amount);
  const result = db.prepare(`INSERT INTO transactions (
    dedupe_key,import_match_key,transaction_date,transaction_month,source_type,flow_type,
    name,amount,inflow,outflow,category_primary,ai_confidence,judgment_reason,account_id,
    first_source_id,classification_source,reviewed,transaction_key,currency,
    amount_minor,inflow_minor,outflow_minor,record_status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `dedupe:${key}`, key, '2026-06-10', '2026-06', 'bank', 'synthetic', name,
    value, value > 0n ? value : 0n, value < 0n ? -value : 0n, category, 1,
    'Synthetic spending structure fixture', target.id, evidence.id, 'human', 1, key,
    'TWD', value, value > 0n ? value : 0n, value < 0n ? -value : 0n, 'confirmed',
  );
  return { id: Number(result.lastInsertRowid), transaction_key: key };
}

test('FC-A3 separates expense lines, confirmed recovery and proposed recovery', () => fixture((db) => {
  const target = account(db);
  const evidence = source(db, target.account_key);
  const expense = transaction(db, target, evidence, 'transaction:expense', '-10000', 'Synthetic work meal', '業務營運支出');
  const confirmedReceipt = transaction(db, target, evidence, 'transaction:confirmed-receipt', '6000', 'Synthetic reimbursement', '其他收入與收益');
  const proposedExpense = transaction(db, target, evidence, 'transaction:proposed-expense', '-5000', 'Synthetic travel', '交通');
  const proposedReceipt = transaction(db, target, evidence, 'transaction:proposed-receipt', '5000', 'Synthetic travel reimbursement', '其他收入與收益');
  db.prepare(`INSERT INTO transaction_report_mappings
    (transaction_id, report_line, mapping_source, confidence, reason, reviewed)
    VALUES (?, ?, ?, ?, ?, 1)`).run(
    expense.id, 'expense:business_operating', 'human', 1, 'Synthetic business expense mapping',
  );
  createReimbursementMatch({
    reimbursement_transaction_key: confirmedReceipt.transaction_key,
    currency: 'TWD', match_status: 'confirmed', confidence: 1,
    authority: 'user_confirmed', review_state: 'confirmed', reason: 'Synthetic confirmed allocation.',
    items: [{ expense_transaction_key: expense.transaction_key, allocated_minor: '6000' }],
  }, {}, db);
  createReimbursementMatch({
    reimbursement_transaction_key: proposedReceipt.transaction_key,
    currency: 'TWD', match_status: 'proposed', confidence: 0.8,
    authority: 'ai_inferred', review_state: 'needs_review', reason: 'Synthetic candidate only.',
    items: [{ expense_transaction_key: proposedExpense.transaction_key, allocated_minor: '5000' }],
  }, {}, db);

  const first = getSpendingStructure(new URLSearchParams('month=2026-06&entity_id=personal&currency=TWD'), db);
  assert.equal(first.analysis_id, 'spending_structure');
  assert.equal(first.facts.confirmed_expense_minor, '15000');
  assert.equal(first.facts.confirmed_reimbursement_recovery_minor, '6000');
  assert.equal(first.derived.net_expense_after_confirmed_recovery_minor, '9000');
  assert.equal(first.facts.proposed_reimbursements.length, 1);
  assert.equal(first.derived.explicit_business_expense_minor, '10000');
  assert.ok(first.drillback.transaction_keys.includes(expense.transaction_key));
  assert.deepEqual(getSpendingStructure(new URLSearchParams('month=2026-06&entity_id=personal&currency=TWD'), db), first);
  const context = analysisContext({
    entity: 'personal', as_of: '2026-06-30',
    datasets: [{ name: 'spending_structure', month: '2026-06', currency: 'TWD', basis: 'card_accrual_management' }],
  }, db);
  assert.equal(context.datasets[0].data.analysis_id, 'spending_structure');
  assert.equal(context.datasets[0].data.derived.net_expense_after_confirmed_recovery_minor, '9000');
}));

test('FC-A3 requires a single month and rejects a different report basis', () => fixture((db) => {
  assert.throws(() => getSpendingStructure(new URLSearchParams('month=all'), db), (error) => error.code === 'VALIDATION_ERROR' && error.field === 'month');
  assert.throws(() => getSpendingStructure(new URLSearchParams('month=2026-06&basis=direct_method'), db), (error) => error.code === 'VALIDATION_ERROR' && error.field === 'basis');
}));
