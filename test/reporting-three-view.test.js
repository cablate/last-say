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
  createFxQuote,
  createHolding,
  createInstrument,
  createInvestmentCashMatch,
} = require('../lib/queries/finance/investments');
const { createTransferMatch } = require('../lib/queries/finance/reconciliation');
const { createValuedItem, createValuation } = require('../lib/queries/finance/valued-items');
const { getIncomeStatement } = require('../lib/queries/reports/income-statement');
const { getBalanceSheet } = require('../lib/queries/reports/balance-sheet');
const { getCashFlow } = require('../lib/queries/reports/cash-flow');
const { buildIncomeStatementCoverage } = require('../lib/reporting/coverage');

function withSyntheticDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-three-view-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try {
    return run(db);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function account(db, displayName, accountKind, currency = 'TWD') {
  return createAccount({
    display_name: displayName,
    account_kind: accountKind,
    currency,
    authority: 'user_confirmed',
    review_state: 'confirmed',
  }, {}, db);
}

function source(db, description, sourceKind = 'manual_note', accountKey = null) {
  return createSource({
    source_kind: sourceKind,
    description,
    account_key: accountKey || undefined,
    authority: 'official',
    review_state: 'confirmed',
    is_official: true,
  }, {}, db);
}

function snapshot(db, target, evidence, date, amount, balanceKind = 'ledger') {
  return createBalanceSnapshot({
    account_key: target.account_key,
    source_key: evidence.source_key,
    as_of_date: date,
    observed_at: `${date}T12:00:00Z`,
    balance_kind: balanceKind,
    amount_minor: String(amount),
    currency: target.currency,
    authority: 'official',
    review_state: 'confirmed',
    record_status: 'confirmed',
  }, {}, db);
}

function transaction(db, target, {
  key,
  date,
  amount,
  name,
  category = 'Food',
  flowType = 'purchase',
  currency = target.currency,
}) {
  const value = BigInt(amount);
  const inflow = value > 0n ? value : 0n;
  const outflow = value < 0n ? -value : 0n;
  const result = db.prepare(`
    INSERT INTO transactions (
      dedupe_key, import_match_key, transaction_date, transaction_month,
      source_type, flow_type, name, amount, inflow, outflow,
      category_primary, ai_confidence, judgment_reason, account_id,
      classification_source, reviewed, transaction_key, currency,
      amount_minor, inflow_minor, outflow_minor, record_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `dedupe:${key}`, key, date, date.slice(0, 7), target.account_kind,
    flowType, name, value, inflow, outflow, category, 1, 'synthetic MP-05 fixture',
    target.id, 'human', 1, key, currency, value, inflow, outflow, 'confirmed',
  );
  return { id: Number(result.lastInsertRowid), key };
}

function blockerKinds(report) {
  return new Set(report.coverage.blockers.map((blocker) => blocker.kind));
}

test('balance sheet honors account snapshot precedence, complete holding fallback, valued items, and watermarks', () => withSyntheticDb((db) => {
  const bank = account(db, 'Checking', 'bank');
  const snapshotBroker = account(db, 'Snapshot Broker', 'investment');
  const holdingBroker = account(db, 'Holding Broker', 'investment', 'USD');
  const card = account(db, 'Rewards Card', 'credit_card');
  const bankSource = source(db, 'June bank statement', 'bank_statement_csv', bank.account_key);
  const brokerSource = source(db, 'June brokerage statement', 'brokerage_statement', snapshotBroker.account_key);
  const usdBrokerSource = source(db, 'June USD brokerage statement', 'brokerage_statement', holdingBroker.account_key);
  const cardSource = source(db, 'June card statement', 'credit_card_statement_csv', card.account_key);

  snapshot(db, bank, bankSource, '2026-06-30', 100000);
  const winningSnapshot = snapshot(db, snapshotBroker, brokerSource, '2026-06-30', 50000, 'market_value');
  snapshot(db, card, cardSource, '2026-06-30', 30000, 'statement');

  const ignoredInstrument = createInstrument({
    instrument_type: 'etf', name: 'Ignored Holding', symbol: 'IGN', exchange: 'TEST',
    quote_currency: 'TWD', authority: 'official', review_state: 'confirmed',
  }, {}, db);
  createHolding({
    account_key: snapshotBroker.account_key,
    instrument_key: ignoredInstrument.instrument_key,
    source_key: brokerSource.source_key,
    as_of_date: '2026-06-30', quantity_decimal: '1',
    reported_market_value_minor: '70000', currency: 'TWD',
    authority: 'official', review_state: 'confirmed', record_status: 'confirmed',
  }, {}, db);

  const usdInstrument = createInstrument({
    instrument_type: 'etf', name: 'USD Holding', symbol: 'USDH', exchange: 'TEST',
    quote_currency: 'USD', authority: 'official', review_state: 'confirmed',
  }, {}, db);
  const usdHolding = createHolding({
    account_key: holdingBroker.account_key,
    instrument_key: usdInstrument.instrument_key,
    source_key: usdBrokerSource.source_key,
    as_of_date: '2026-06-30', quantity_decimal: '1',
    reported_market_value_minor: '10000', currency: 'USD',
    authority: 'official', review_state: 'confirmed', record_status: 'confirmed',
  }, {}, db);
  const fxSource = source(db, 'June official FX', 'fx_quote_evidence');
  const fx = createFxQuote({
    source_key: fxSource.source_key,
    base_currency: 'USD', quote_currency: 'TWD', rate_decimal: '32',
    as_of_date: '2026-06-30', provider: 'Synthetic official FX',
    authority: 'official', review_state: 'confirmed',
  }, {}, db);

  const property = createValuedItem({
    entity_key: 'personal', item_type: 'real_estate', display_name: 'Synthetic property',
    position: 'asset', authority: 'user_confirmed', review_state: 'confirmed',
  }, {}, db);
  const propertySource = source(db, 'June property valuation');
  createValuation(property.item_key, {
    source_key: propertySource.source_key, as_of_date: '2026-06-30', value_minor: '200000',
    currency: 'TWD', valuation_method: 'appraisal', authority: 'official',
    review_state: 'confirmed', record_status: 'confirmed',
  }, {}, db);

  const report = getBalanceSheet(new URLSearchParams('entity_id=personal&as_of_date=2026-06-30&currency=TWD'), db);
  assert.equal(report.coverage.status, 'complete');
  assert.equal(report.total_assets_cents, 670000);
  assert.equal(report.total_liabilities_cents, 30000);
  assert.equal(report.net_worth_cents, 640000);
  assert.equal(report.equation_delta_cents, 0);

  const snapshotLine = report.assets.find((line) => line.account_key === snapshotBroker.account_key);
  assert.equal(snapshotLine.amount_cents, 50000, 'account snapshot wins over the 70000 holding value');
  assert.equal(snapshotLine.resource_key, winningSnapshot.snapshot_key);
  assert.equal(snapshotLine.valuation_watermark, null);

  const holdingLine = report.assets.find((line) => line.account_key === holdingBroker.account_key);
  assert.equal(holdingLine.amount_cents, 320000);
  assert.equal(holdingLine.resource_type, 'investment_holding_valuation');
  assert.ok(holdingLine.drillback_ids.holding_snapshot_keys.includes(usdHolding.holding_key));
  assert.ok(holdingLine.drillback_ids.fx_quote_keys.includes(fx.fx_key));
  assert.equal(holdingLine.valuation_watermark.method, 'complete_holding_valuations');
  assert.equal(report.valued_items[0].tier, 2);
}));

test('balance sheet blocks stale, missing, FX-less, and other-kind accounts without inventing debt or zero lines', () => withSyntheticDb((db) => {
  const staleBank = account(db, 'Stale Bank', 'bank');
  const usdBank = account(db, 'USD Bank', 'bank', 'USD');
  const loan = account(db, 'Mortgage', 'loan');
  const untyped = account(db, 'Mystery Position', 'other');
  const staleSource = source(db, 'May bank statement', 'bank_statement_csv', staleBank.account_key);
  const usdSource = source(db, 'June USD statement', 'bank_statement_csv', usdBank.account_key);
  snapshot(db, staleBank, staleSource, '2026-05-31', 90000);
  snapshot(db, usdBank, usdSource, '2026-06-30', 10000);
  db.prepare(`
    INSERT INTO liability_profiles (
      liability_key, account_id, liability_kind, original_principal_minor, currency,
      rate_type, start_date, payment_frequency, authority, review_state, record_status
    ) VALUES ('loan:synthetic', ?, 'mortgage', 9000000, 'TWD', 'fixed', '2020-01-01',
      'monthly', 'official', 'confirmed', 'confirmed')
  `).run(loan.id);

  const report = getBalanceSheet(new URLSearchParams('entity_id=personal&as_of_date=2026-06-30&currency=TWD'), db);
  assert.equal(report.coverage.status, 'partial');
  assert.equal(report.total_assets_cents, 90000);
  assert.equal(report.total_liabilities_cents, 0, 'original principal is not a current balance');
  assert.equal(report.liabilities.length, 0);
  assert.ok(report.unsupported_obligations.some((item) => item.resource_key === 'loan:synthetic'));
  assert.ok(report.excluded_accounts.some((item) => item.account_key === untyped.account_key));
  assert.ok(report.coverage.stale_balance_snapshots.some((item) => item.account_id === staleBank.id));
  assert.ok(report.coverage.missing_balance_snapshots.some((item) => item.account_id === loan.id));
  assert.ok(blockerKinds(report).has('missing_fx_quote'));
  assert.ok(blockerKinds(report).has('unsupported_account_kind'));
  assert.equal(report.assets.some((line) => line.account_key === usdBank.account_key), false);
}));

test('card purchase is recognized once in P&L while settlement is cash and current card debt stays snapshot-owned', () => withSyntheticDb((db) => {
  const bank = account(db, 'Checking', 'bank');
  const card = account(db, 'Rewards Card', 'credit_card');
  const bankSource = source(db, 'June checking statement', 'bank_statement_csv', bank.account_key);
  const cardSource = source(db, 'June card statement', 'credit_card_statement_csv', card.account_key);
  snapshot(db, bank, bankSource, '2026-06-01', 100000);
  snapshot(db, bank, bankSource, '2026-06-30', 90000);
  snapshot(db, card, cardSource, '2026-06-30', 0, 'statement');
  transaction(db, card, {
    key: 'card:purchase', date: '2026-06-05', amount: '-10000',
    name: 'Card restaurant charge', category: 'Food',
  });
  const payment = transaction(db, bank, {
    key: 'bank:card-payment', date: '2026-06-20', amount: '-10000',
    name: 'Credit card payment from checking', category: 'Transfer',
    flowType: 'credit_card_payment',
  });

  const profileId = db.prepare(`
    INSERT INTO credit_card_profiles (
      profile_key, account_id, currency, authority, review_state, record_status
    ) VALUES ('card:profile', ?, 'TWD', 'official', 'confirmed', 'confirmed')
  `).run(card.id).lastInsertRowid;
  const statementId = db.prepare(`
    INSERT INTO credit_card_statements (
      statement_key, profile_id, source_id, period_start, period_end, close_date, due_date,
      statement_balance_minor, currency, record_status, authority, review_state
    ) VALUES ('card:statement:june', ?, ?, '2026-06-01', '2026-06-15', '2026-06-15',
      '2026-06-20', 10000, 'TWD', 'confirmed', 'official', 'confirmed')
  `).run(profileId, cardSource.id).lastInsertRowid;
  db.prepare(`
    INSERT INTO credit_card_payment_matches (
      match_key, statement_id, transaction_id, amount_minor, match_status,
      authority, review_state, record_status
    ) VALUES ('card:payment-match', ?, ?, 10000, 'confirmed', 'official', 'confirmed', 'confirmed')
  `).run(statementId, payment.id);

  const income = getIncomeStatement(new URLSearchParams('month=2026-06'), db);
  const cash = getCashFlow(new URLSearchParams('entity_id=personal&month=2026-06&currency=TWD'), db);
  const balance = getBalanceSheet(new URLSearchParams('entity_id=personal&as_of_date=2026-06-30&currency=TWD'), db);

  assert.equal(income.total_expense_cents, 10000);
  assert.equal(income.excluded.find((line) => line.line === 'excluded:credit_card_payment').amount_cents, 10000);
  assert.equal(cash.coverage.status, 'complete');
  assert.equal(cash.operating_cash_flow_cents, -10000);
  assert.equal(cash.operating.find((line) => line.line === 'credit_card_settlement').amount_cents, -10000);
  assert.deepEqual(cash.operating[0].transaction_drillback_keys, ['bank:card-payment']);
  assert.equal(cash.reconciliation_delta_cents, 0);
  assert.equal(balance.total_liabilities_cents, 0);
  assert.equal(balance.coverage.status, 'complete');
}));

test('cash flow honors confirmed transfer, loan, investment, and reimbursement owners before text mappings', () => withSyntheticDb((db) => {
  const checking = account(db, 'Checking', 'bank');
  const savings = account(db, 'Savings', 'bank');
  const loanAccount = account(db, 'Loan', 'loan');
  const broker = account(db, 'Broker', 'investment');
  const checkingSource = source(db, 'June checking statement', 'bank_statement_csv', checking.account_key);
  const savingsSource = source(db, 'June savings statement', 'bank_statement_csv', savings.account_key);
  snapshot(db, checking, checkingSource, '2026-06-01', 100000);
  snapshot(db, savings, savingsSource, '2026-06-01', 100000);
  snapshot(db, checking, checkingSource, '2026-06-30', 19000);
  snapshot(db, savings, savingsSource, '2026-06-30', 150000);

  const transferOut = transaction(db, checking, {
    key: 'transfer:out', date: '2026-06-02', amount: '-50000',
    name: 'Opaque movement A', category: 'Mystery',
  });
  const transferIn = transaction(db, savings, {
    key: 'transfer:in', date: '2026-06-02', amount: '50000',
    name: 'Opaque movement B', category: 'Mystery',
  });
  createTransferMatch({
    from_transaction_key: transferOut.key, to_transaction_key: transferIn.key,
    amount_minor: '50000', currency: 'TWD', match_status: 'confirmed',
    confidence: 1, authority: 'user_confirmed', review_state: 'confirmed',
  }, {}, db);

  const loanPayment = transaction(db, checking, {
    key: 'loan:payment', date: '2026-06-10', amount: '-11000',
    name: 'Opaque loan debit', category: 'Mystery',
  });
  const liabilityId = db.prepare(`
    INSERT INTO liability_profiles (
      liability_key, account_id, liability_kind, original_principal_minor, currency,
      rate_type, start_date, payment_frequency, authority, review_state, record_status
    ) VALUES ('liability:loan', ?, 'personal_loan', 100000, 'TWD', 'fixed', '2026-01-01',
      'monthly', 'official', 'confirmed', 'confirmed')
  `).run(loanAccount.id).lastInsertRowid;
  const scheduleId = db.prepare(`
    INSERT INTO loan_schedule_entries (
      schedule_key, liability_id, sequence, due_date, principal_minor, interest_minor,
      fee_minor, total_minor, entry_status, authority, review_state, record_status
    ) VALUES ('schedule:june', ?, 1, '2026-06-10', 9000, 1500, 500, 11000,
      'settled', 'official', 'confirmed', 'confirmed')
  `).run(liabilityId).lastInsertRowid;
  db.prepare(`
    INSERT INTO loan_payment_allocations (
      allocation_key, schedule_entry_id, transaction_id, principal_minor, interest_minor,
      fee_minor, total_minor, reconciliation_status, authority, review_state, record_status
    ) VALUES ('allocation:june', ?, ?, 9000, 1500, 500, 11000,
      'reconciled', 'official', 'confirmed', 'confirmed')
  `).run(scheduleId, loanPayment.id);

  const investmentPayment = transaction(db, checking, {
    key: 'investment:cash', date: '2026-06-12', amount: '-20000',
    name: 'Opaque broker debit', category: 'Mystery',
  });
  const brokerSource = source(db, 'June broker trade', 'brokerage_statement', broker.account_key);
  const instrument = createInstrument({
    instrument_type: 'etf', name: 'Synthetic Fund', symbol: 'SYN', exchange: 'TEST',
    quote_currency: 'TWD', authority: 'official', review_state: 'confirmed',
  }, {}, db);
  const tradeId = db.prepare(`
    INSERT INTO investment_trades (
      trade_key, account_id, instrument_id, source_id, trade_date, activity_type,
      net_minor, currency, record_status, authority, review_state
    ) VALUES ('trade:june', ?, ?, ?, '2026-06-12', 'buy', -20000,
      'TWD', 'confirmed', 'official', 'confirmed')
  `).run(broker.id, instrument.id, brokerSource.id).lastInsertRowid;
  assert.ok(tradeId);
  createInvestmentCashMatch({
    trade_key: 'trade:june', transaction_key: investmentPayment.key,
    amount_minor: '-20000', authority: 'official', review_state: 'confirmed',
  }, {}, db);

  const expense = transaction(db, checking, {
    key: 'work:expense', date: '2026-06-15', amount: '-8000',
    name: 'Work meal', category: 'Food',
  });
  const reimbursement = transaction(db, checking, {
    key: 'work:reimbursement', date: '2026-06-20', amount: '8000',
    name: 'Opaque recovery', category: 'Mystery',
  });
  const reimbursementId = db.prepare(`
    INSERT INTO reimbursement_matches (
      match_key, reimbursement_transaction_id, currency, match_status, confidence,
      authority, review_state, reason
    ) VALUES ('reimbursement:june', ?, 'TWD', 'confirmed', 1,
      'user_confirmed', 'confirmed', 'Synthetic gross reimbursement')
  `).run(reimbursement.id).lastInsertRowid;
  db.prepare(`
    INSERT INTO reimbursement_match_items (match_id, expense_transaction_id, allocated_minor)
    VALUES (?, ?, 8000)
  `).run(reimbursementId, expense.id);

  const report = getCashFlow(new URLSearchParams('entity_id=personal&month=2026-06&currency=TWD'), db);
  assert.equal(report.coverage.status, 'complete');
  assert.equal(report.internal_transfers_eliminated_cents, 50000);
  assert.equal(report.operating_cash_flow_cents, -2000);
  assert.equal(report.investing_cash_flow_cents, -20000);
  assert.equal(report.financing_cash_flow_cents, -9000);
  assert.equal(report.net_cash_flow_cents, -31000);
  assert.equal(report.ending_cash_cents, 169000);
  assert.equal(report.reconciliation_delta_cents, 0);
  assert.equal(report.unresolved_cash_flow_cents, 0);
  assert.equal(report.operating.find((line) => line.line === 'reimbursement_receipt').details[0].gross_source_cash_preserved, true);
  assert.equal(report.operating.find((line) => line.line === 'expense:food').details[0].gross_source_cash_preserved, true);
}));

test('unmatched transfers stay disclosed and produce unreconciled coverage when boundary cash disagrees', () => withSyntheticDb((db) => {
  const bank = account(db, 'Checking', 'bank');
  const evidence = source(db, 'June bank statement', 'bank_statement_csv', bank.account_key);
  snapshot(db, bank, evidence, '2026-06-01', 100000);
  snapshot(db, bank, evidence, '2026-06-30', 95000);
  const outflow = transaction(db, bank, {
    key: 'one-sided:transfer', date: '2026-06-10', amount: '-10000',
    name: 'Own transfer pending match', category: 'Transfer',
  });
  createTransferMatch({
    from_transaction_key: outflow.key, amount_minor: '10000', currency: 'TWD',
    match_status: 'proposed', confidence: 0.7, authority: 'ai_inferred',
    review_state: 'needs_review',
  }, {}, db);

  const report = getCashFlow(new URLSearchParams('entity_id=personal&period_start=2026-06-01&period_end=2026-06-30&currency=TWD'), db);
  assert.equal(report.unresolved_cash_flow_cents, -10000);
  assert.equal(report.unmatched_transfer_count, 1);
  assert.equal(report.reconciliation_delta_cents, -5000);
  assert.equal(report.coverage.status, 'unreconciled');
  assert.ok(blockerKinds(report).has('unconfirmed_transfer_match'));
}));

test('partial reimbursement evidence cannot claim the whole receipt', () => withSyntheticDb((db) => {
  const bank = account(db, 'Checking', 'bank');
  const evidence = source(db, 'June bank statement', 'bank_statement_csv', bank.account_key);
  snapshot(db, bank, evidence, '2026-06-01', 100000);
  snapshot(db, bank, evidence, '2026-06-30', 107000);
  const expense = transaction(db, bank, {
    key: 'partial:expense', date: '2026-06-05', amount: '-8000',
    name: 'Work expense', category: 'Food',
  });
  const receipt = transaction(db, bank, {
    key: 'partial:receipt', date: '2026-06-10', amount: '15000',
    name: 'Mixed receipt', category: 'Mystery',
  });
  const matchId = db.prepare(`
    INSERT INTO reimbursement_matches (
      match_key, reimbursement_transaction_id, currency, match_status, confidence,
      authority, review_state, reason
    ) VALUES ('reimbursement:partial', ?, 'TWD', 'confirmed', 1,
      'user_confirmed', 'confirmed', 'Only part of this receipt is reimbursement')
  `).run(receipt.id).lastInsertRowid;
  db.prepare(`
    INSERT INTO reimbursement_match_items (match_id, expense_transaction_id, allocated_minor)
    VALUES (?, ?, 8000)
  `).run(matchId, expense.id);

  const report = getCashFlow(new URLSearchParams('entity_id=personal&month=2026-06&currency=TWD'), db);
  assert.equal(report.coverage.status, 'partial');
  assert.equal(report.unresolved_cash_flow_cents, 15000);
  assert.equal(report.operating.some((line) => line.line === 'reimbursement_receipt'), false);
  assert.ok(blockerKinds(report).has('unconfirmed_reimbursement'));
  assert.equal(report.reconciliation_delta_cents, 0);
}));

test('cash-flow currency scope excludes other-currency cash accounts instead of permanently blocking the selected currency', () => withSyntheticDb((db) => {
  const twd = account(db, 'TWD Checking', 'bank', 'TWD');
  const usd = account(db, 'USD Checking', 'bank', 'USD');
  const twdSource = source(db, 'June TWD statement', 'bank_statement_csv', twd.account_key);
  const usdSource = source(db, 'June USD statement', 'bank_statement_csv', usd.account_key);
  snapshot(db, twd, twdSource, '2026-06-01', 100000);
  snapshot(db, twd, twdSource, '2026-06-30', 90000);
  snapshot(db, usd, usdSource, '2026-06-01', 10000);
  snapshot(db, usd, usdSource, '2026-06-30', 20000);
  transaction(db, twd, {
    key: 'twd:expense', date: '2026-06-10', amount: '-10000',
    name: 'TWD expense', category: 'Food',
  });
  transaction(db, usd, {
    key: 'usd:income', date: '2026-06-10', amount: '10000',
    name: 'USD income', category: 'Income', currency: 'USD',
  });

  const report = getCashFlow(new URLSearchParams('entity_id=personal&month=2026-06&currency=TWD'), db);
  assert.deepEqual(report.included_account_ids, [twd.id]);
  assert.equal(report.transaction_count, 1);
  assert.equal(report.foreign_currency_transaction_count, 0);
  assert.equal(report.coverage.status, 'complete');
  assert.equal(report.reconciliation_delta_cents, 0);
  assert.equal(blockerKinds(report).has('cash_boundary_currency_mismatch'), false);
}));

test('shared coverage retains the public P&L unmapped state', () => {
  const coverage = buildIncomeStatementCoverage({ transactionCount: 1, unmappedTransactionCount: 1 });
  assert.equal(coverage.status, 'unmapped');
  assert.equal(coverage.blockers[0].kind, 'unmapped_report_line');
});
