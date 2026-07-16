const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createBalanceSnapshot } = require('../lib/queries/finance/balances');
const { createSource } = require('../lib/queries/finance/sources');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { createLiability, createLoanSchedule, createLoanAllocation } = require('../lib/queries/finance/obligations');
const { readinessForGoal } = require('../lib/queries/finance/inventory');

test('official loan schedule and allocation retain principal, interest and fee reconciliation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-loan-'));
  const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const loanAccount = createAccount({ display_name: 'Synthetic loan', account_kind: 'loan', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const bankAccount = createAccount({ display_name: 'Synthetic bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const contract = createSource({ source_kind: 'loan_contract', description: 'Synthetic official contract', account_key: loanAccount.account_key, authority: 'official', is_official: true }, {}, db);
    const liability = createLiability({ account_key: loanAccount.account_key, source_key: contract.source_key, liability_kind: 'amortizing_loan', original_principal_minor: '150000000', currency: 'TWD', rate_type: 'fixed', apr_decimal: '0.021', apr_as_of: '2026-06-30', start_date: '2026-01-01', maturity_date: '2032-12-31', payment_frequency: 'monthly', authority: 'official', review_state: 'confirmed' }, {}, db);
    assert.throws(() => createLoanSchedule(liability.liability_key, { source_key: contract.source_key, authority: 'ai_inferred', entries: [{ sequence: 1, due_date: '2026-07-05', principal_minor: '1750000', interest_minor: '247188', total_minor: '1997188' }] }, {}, db), (error) => error.code === 'REVIEW_REQUIRED');
    const stored = createLoanSchedule(liability.liability_key, { source_key: contract.source_key, authority: 'official', review_state: 'confirmed', entries: [{ sequence: 1, due_date: '2026-07-05', principal_minor: '1750000', interest_minor: '247188', fee_minor: '0', total_minor: '1997188' }] }, {}, db);
    const payment = createCashActivity({ account_key: bankAccount.account_key, transaction_date: '2026-07-05', name: 'Synthetic loan payment', amount_minor: '-1997188', currency: 'TWD', flow_type: '貸款還款', category_primary: '貸款' }, {}, db);
    const allocation = createLoanAllocation({ schedule_key: stored.schedule[0].schedule_key, transaction_key: payment.transaction_key, principal_minor: '1750000', interest_minor: '247188', fee_minor: '0', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    assert.equal(allocation.reconciliation_status, 'reconciled');
    const readiness = readinessForGoal('debt_obligations', { asOfDate: '2026-07-14' }, db);
    assert.ok(readiness.gaps.some((gap) => gap.gap === 'missing_loan_principal_balance'));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('known loan facts can be stored without inventing an unknown start date', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-loan-unknown-start-'));
  const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const loanAccount = createAccount({ display_name: 'Loan with unknown start', account_kind: 'loan', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    createBalanceSnapshot({ account_key: loanAccount.account_key, as_of_date: '2026-07-15', observed_at: '2026-07-15T00:00:00Z', balance_kind: 'principal', amount_minor: '36936700', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const liability = createLiability({ account_key: loanAccount.account_key, liability_kind: 'amortizing_loan', original_principal_minor: '50000000', currency: 'TWD', rate_type: 'fixed', apr_decimal: '0.0513', apr_as_of: '2026-07-15', payment_frequency: 'monthly', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);

    assert.equal(liability.start_date, null);
    const readiness = readinessForGoal('debt_obligations', { asOfDate: '2026-07-16', accountKey: loanAccount.account_key }, db);
    assert.equal(readiness.status, 'partial');
    assert.ok(readiness.gaps.some((gap) => gap.gap === 'missing_loan_start_date'));
    assert.equal(readiness.gaps.some((gap) => gap.gap === 'missing_loan_principal_balance'), false);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('estimated current principal remains an explicit debt-readiness blocker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-loan-estimated-principal-'));
  const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const loanAccount = createAccount({ display_name: 'Estimated student loan', account_kind: 'loan', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    createBalanceSnapshot({ account_key: loanAccount.account_key, as_of_date: '2026-07-15', observed_at: '2026-07-15T00:00:00Z', balance_kind: 'principal', amount_minor: '14000000', currency: 'TWD', authority: 'estimated', review_state: 'needs_review' }, {}, db);
    createLiability({ account_key: loanAccount.account_key, liability_kind: 'amortizing_loan', original_principal_minor: '27081400', currency: 'TWD', rate_type: 'unknown', payment_frequency: 'monthly', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);

    const readiness = readinessForGoal('debt_obligations', { asOfDate: '2026-07-16', accountKey: loanAccount.account_key }, db);
    assert.ok(readiness.gaps.some((gap) => gap.gap === 'loan_principal_needs_review'));
    assert.equal(readiness.gaps.some((gap) => gap.gap === 'missing_loan_principal_balance'), false);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
