const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createSource } = require('../lib/queries/finance/sources');
const { createBalanceSnapshot } = require('../lib/queries/finance/balances');
const {
  createCreditCardProfile,
  createCardStatement,
  createCardPaymentMatch,
  createLiability,
  createLoanSchedule,
  createLoanAllocation,
} = require('../lib/queries/finance/obligations');
const {
  createInstrument,
  createTrade,
  createInvestmentCashMatch,
} = require('../lib/queries/finance/investments');
const {
  createReimbursementMatch,
  updateReimbursementMatch,
} = require('../lib/queries/finance/reimbursements');
const { getMonthlyFinancialPulse } = require('../lib/queries/finance/control/monthly-pulse');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-monthly-pulse-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function account(db, name, kind) {
  return createAccount({
    display_name: name,
    account_kind: kind,
    currency: 'TWD',
    authority: 'user_confirmed',
    review_state: 'confirmed',
  }, {}, db);
}

function source(db, description, kind, accountKey) {
  return createSource({
    source_kind: kind,
    description,
    account_key: accountKey,
    authority: 'official',
    review_state: 'confirmed',
    is_official: true,
  }, {}, db);
}

function transaction(db, target, evidence, key, date, amount, name, category) {
  const value = BigInt(amount);
  const inflow = value > 0n ? value : 0n;
  const outflow = value < 0n ? -value : 0n;
  const inserted = db.prepare(`
    INSERT INTO transactions (
      dedupe_key,import_match_key,transaction_date,transaction_month,source_type,flow_type,
      name,amount,inflow,outflow,category_primary,ai_confidence,judgment_reason,account_id,
      first_source_id,classification_source,reviewed,transaction_key,currency,
      amount_minor,inflow_minor,outflow_minor,record_status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `dedupe:${key}`, key, date, date.slice(0, 7), target.account_kind, 'synthetic',
    name, value, inflow, outflow, category, 1, 'Synthetic FC-A2 fixture', target.id,
    evidence.id, 'human', 1, key, 'TWD', value, inflow, outflow, 'confirmed',
  );
  return { id: Number(inserted.lastInsertRowid), transaction_key: key };
}

function buildScenario(db) {
  const bank = account(db, 'Synthetic checking', 'bank');
  const card = account(db, 'Synthetic card', 'credit_card');
  const loan = account(db, 'Synthetic loan', 'loan');
  const broker = account(db, 'Synthetic brokerage', 'investment');
  const bankSource = source(db, 'Synthetic June bank statement', 'bank_statement_csv', bank.account_key);
  const cardSource = source(db, 'Synthetic June card statement', 'credit_card_statement_csv', card.account_key);
  const loanSource = source(db, 'Synthetic loan schedule', 'loan_statement', loan.account_key);
  const brokerSource = source(db, 'Synthetic trade statement', 'brokerage_statement', broker.account_key);

  createBalanceSnapshot({
    account_key: bank.account_key, source_key: bankSource.source_key,
    as_of_date: '2026-06-01', observed_at: '2026-06-01T00:00:00Z',
    balance_kind: 'ledger', amount_minor: '1000000', currency: 'TWD',
    authority: 'official', review_state: 'confirmed', record_status: 'confirmed',
  }, {}, db);
  createBalanceSnapshot({
    account_key: bank.account_key, source_key: bankSource.source_key,
    as_of_date: '2026-06-30', observed_at: '2026-06-30T00:00:00Z',
    balance_kind: 'ledger', amount_minor: '1450000', currency: 'TWD',
    authority: 'official', review_state: 'confirmed', record_status: 'confirmed',
  }, {}, db);

  transaction(db, bank, bankSource, 'transaction:salary', '2026-06-03', '800000', 'Synthetic salary', 'Salary');
  const cardCharge = transaction(db, card, cardSource, 'transaction:card-charge', '2026-06-05', '-30000', 'Synthetic restaurant', 'Food');
  const cardPayment = transaction(db, bank, bankSource, 'transaction:card-payment', '2026-06-20', '-30000', 'Synthetic card payment', 'Transfer');
  const loanPayment = transaction(db, bank, bankSource, 'transaction:loan-payment', '2026-06-10', '-120000', 'Synthetic loan debit', 'Mystery');
  const investmentPayment = transaction(db, bank, bankSource, 'transaction:investment', '2026-06-12', '-200000', 'Synthetic broker debit', 'Mystery');
  const workExpense = transaction(db, bank, bankSource, 'transaction:work-expense', '2026-06-14', '-50000', 'Synthetic work meal', 'Food');
  const reimbursement = transaction(db, bank, bankSource, 'transaction:reimbursement', '2026-06-18', '50000', 'Synthetic reimbursement', 'Income');

  const cardProfile = createCreditCardProfile({
    account_key: card.account_key, currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed',
  }, {}, db);
  const statement = createCardStatement({
    profile_key: cardProfile.profile_key, source_key: cardSource.source_key,
    period_start: '2026-06-01', period_end: '2026-06-15', close_date: '2026-06-15', due_date: '2026-06-20',
    statement_balance_minor: '30000', full_due_minor: '30000', currency: 'TWD',
    authority: 'official', review_state: 'confirmed',
    items: [{ transaction_key: cardCharge.transaction_key, item_role: 'charge' }],
  }, {}, db);
  const cardMatch = createCardPaymentMatch({
    statement_key: statement.statement_key, transaction_key: cardPayment.transaction_key,
    amount_minor: '30000', authority: 'user_confirmed', review_state: 'confirmed',
  }, {}, db);
  assert.equal(cardMatch.match_status, 'settled');

  const liability = createLiability({
    account_key: loan.account_key, source_key: loanSource.source_key,
    liability_kind: 'personal_loan', original_principal_minor: '1000000', currency: 'TWD',
    rate_type: 'fixed', apr_decimal: '0.05', start_date: '2026-01-01',
    payment_frequency: 'monthly', authority: 'official', review_state: 'confirmed',
  }, {}, db);
  const scheduled = createLoanSchedule(liability.liability_key, {
    source_key: loanSource.source_key, authority: 'official', review_state: 'confirmed',
    entries: [{
      sequence: 1, due_date: '2026-06-10', principal_minor: '100000',
      interest_minor: '20000', fee_minor: '0', total_minor: '120000', entry_status: 'settled',
    }],
  }, {}, db);
  const allocation = createLoanAllocation({
    schedule_key: scheduled.created_schedule_keys[0], transaction_key: loanPayment.transaction_key,
    principal_minor: '100000', interest_minor: '20000', fee_minor: '0',
    authority: 'official', review_state: 'confirmed',
  }, {}, db);
  assert.equal(allocation.reconciliation_status, 'reconciled');

  const instrument = createInstrument({
    instrument_type: 'etf', name: 'Synthetic fund', symbol: 'SYN', exchange: 'TEST',
    quote_currency: 'TWD', authority: 'official', review_state: 'confirmed',
  }, {}, db);
  const trade = createTrade({
    account_key: broker.account_key, instrument_key: instrument.instrument_key,
    source_key: brokerSource.source_key, trade_date: '2026-06-12', activity_type: 'buy',
    net_minor: '-200000', currency: 'TWD', authority: 'official', review_state: 'confirmed',
  }, {}, db);
  createInvestmentCashMatch({
    trade_key: trade.trade_key, transaction_key: investmentPayment.transaction_key,
    amount_minor: '200000', authority: 'official', review_state: 'confirmed',
  }, {}, db);

  const reimbursementMatch = createReimbursementMatch({
    reimbursement_transaction_key: reimbursement.transaction_key,
    currency: 'TWD', match_status: 'confirmed', confidence: 1,
    authority: 'user_confirmed', review_state: 'confirmed', reason: 'Synthetic receipt checked.',
    items: [{ expense_transaction_key: workExpense.transaction_key, allocated_minor: '50000' }],
  }, {}, db);

  return { bank, bankSource, reimbursementMatch };
}

function query(db) {
  return getMonthlyFinancialPulse(new URLSearchParams(
    'month=2026-06&entity_id=personal&currency=TWD&basis=card_accrual_management',
  ), db);
}

test('FC-A2 composes P&L, cash flow and typed owners without double counting', () => fixture((db) => {
  buildScenario(db);
  const response = query(db);

  assert.equal(response.schema_version, 'finance.analysis-read-model/v1');
  assert.equal(response.analysis_id, 'monthly_financial_pulse');
  assert.equal(response.formula_version, 'monthly-financial-pulse/1');
  assert.equal(response.coverage.status, 'complete');
  assert.deepEqual(response.scope.defaulted_fields, []);
  assert.deepEqual(response.facts.management_pl, {
    confirmed_revenue_minor: '850000',
    confirmed_expense_minor: '100000',
    net_result_minor: '750000',
    owner_unresolved_inflow_minor: '0',
    owner_unresolved_outflow_minor: '0',
  });
  assert.deepEqual(response.facts.cash_flow, {
    beginning_cash_minor: '1000000',
    ending_cash_minor: '1450000',
    operating_cash_minor: '750000',
    investing_cash_minor: '-200000',
    financing_cash_minor: '-100000',
    unresolved_cash_minor: '0',
    net_cash_change_minor: '450000',
    reconciliation_delta_minor: '0',
  });
  assert.deepEqual(response.facts.typed_cash_movements, {
    confirmed_card_settlement_cash_minor: '-30000',
    confirmed_loan_principal_cash_minor: '-100000',
    confirmed_loan_interest_fee_cash_minor: '-20000',
    confirmed_investment_cash_minor: '-200000',
    confirmed_reimbursement_cash_minor: '50000',
  });
  assert.equal(response.derived.economic_to_cash_gap_minor, '-300000');
  assert.equal(response.derived.confirmed_obligation_settlement_cash_minor, '-150000');
  assert.ok(response.drillback.card_settlement_transaction_keys.includes('transaction:card-payment'));
  assert.ok(response.drillback.loan_transaction_keys.includes('transaction:loan-payment'));
  assert.ok(response.drillback.investment_transaction_keys.includes('transaction:investment'));
  assert.ok(response.drillback.reimbursement_transaction_keys.includes('transaction:reimbursement'));
  assert.ok(response.source_watermark.match_keys.length >= 4);
  assert.equal(response.generated_at, undefined);
  assert.deepEqual(query(db), response, 'same DB state and request must replay exactly');
}));

test('proposed reimbursement stays outside confirmed recovery until the typed owner confirms it', () => fixture((db) => {
  const scenario = buildScenario(db);
  const expense = transaction(db, scenario.bank, scenario.bankSource, 'transaction:proposed-expense', '2026-06-22', '-20000', 'Synthetic proposed expense', 'Food');
  const receipt = transaction(db, scenario.bank, scenario.bankSource, 'transaction:proposed-receipt', '2026-06-24', '20000', 'Synthetic proposed receipt', 'Income');
  const proposal = createReimbursementMatch({
    reimbursement_transaction_key: receipt.transaction_key,
    currency: 'TWD', match_status: 'proposed', confidence: 0.9,
    authority: 'ai_inferred', review_state: 'needs_review', reason: 'Synthetic candidate only.',
    items: [{ expense_transaction_key: expense.transaction_key, allocated_minor: '20000' }],
  }, {}, db);

  const before = query(db);
  assert.equal(before.coverage.status, 'partial');
  assert.equal(before.facts.typed_cash_movements.confirmed_reimbursement_cash_minor, '50000');
  assert.equal(before.candidates.length, 1);
  assert.equal(before.candidates[0].resource_key, proposal.match_key);
  assert.equal(before.candidates[0].included_in_confirmed_totals, false);

  updateReimbursementMatch(proposal.match_key, {
    expected_version: proposal.version,
    match_status: 'confirmed',
    resolution_note: 'Synthetic owner confirmed the allocation.',
  }, { type: 'human_ui' }, db);
  const after = query(db);
  assert.equal(after.coverage.status, 'complete');
  assert.equal(after.facts.typed_cash_movements.confirmed_reimbursement_cash_minor, '70000');
  assert.equal(after.candidates.length, 0);
  assert.notEqual(after.source_watermark.semantic_hash, before.source_watermark.semantic_hash);
}));

test('monthly pulse validates single-month scope and discloses defaults', () => fixture((db) => {
  buildScenario(db);
  assert.throws(
    () => getMonthlyFinancialPulse(new URLSearchParams('month=all'), db),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'month',
  );
  const response = getMonthlyFinancialPulse(new URLSearchParams('month=2026-06'), db);
  assert.deepEqual(response.scope.defaulted_fields, ['entity_id', 'currency', 'basis']);
  assert.ok(response.coverage.warnings.some((item) => item.kind === 'defaulted_scope'));
}));
