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
  createInstrument,
  createHolding,
  createMarketQuote,
} = require('../lib/queries/finance/investments');
const {
  createLiability,
  createLoanSchedule,
} = require('../lib/queries/finance/obligations');
const { getFinancialHealthReview } = require('../lib/queries/finance/control/financial-health');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-financial-health-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try {
    return run(db);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function account(db, displayName, accountKind) {
  return createAccount({
    display_name: displayName,
    account_kind: accountKind,
    currency: 'TWD',
    authority: 'user_confirmed',
    review_state: 'confirmed',
  }, {}, db);
}

function source(db, description, sourceKind, accountKey) {
  return createSource({
    source_kind: sourceKind,
    description,
    account_key: accountKey,
    authority: 'official',
    review_state: 'confirmed',
    is_official: true,
  }, {}, db);
}

function buildScenario(db) {
  const bank = account(db, 'Synthetic bank', 'bank');
  const loanAccount = account(db, 'Synthetic personal loan', 'loan');
  const broker = account(db, 'Synthetic brokerage', 'investment');
  const bankSource = source(db, 'Synthetic bank balance', 'bank_statement_csv', bank.account_key);
  const loanSource = source(db, 'Synthetic loan balance and terms', 'loan_statement', loanAccount.account_key);
  const brokerSource = source(db, 'Synthetic brokerage holding', 'brokerage_statement', broker.account_key);
  const quoteSource = source(db, 'Synthetic market quote', 'market_quote_evidence', broker.account_key);

  createBalanceSnapshot({
    account_key: bank.account_key,
    source_key: bankSource.source_key,
    as_of_date: '2026-07-17',
    observed_at: '2026-07-17T00:00:00Z',
    balance_kind: 'ledger',
    amount_minor: '1000000',
    currency: 'TWD',
    authority: 'official',
    review_state: 'confirmed',
    record_status: 'confirmed',
  }, {}, db);
  createBalanceSnapshot({
    account_key: loanAccount.account_key,
    source_key: loanSource.source_key,
    as_of_date: '2026-07-17',
    observed_at: '2026-07-17T00:00:00Z',
    balance_kind: 'principal',
    amount_minor: '500000',
    currency: 'TWD',
    authority: 'official',
    review_state: 'confirmed',
    record_status: 'confirmed',
  }, {}, db);

  const liability = createLiability({
    account_key: loanAccount.account_key,
    source_key: loanSource.source_key,
    liability_kind: 'personal_loan',
    original_principal_minor: '1000000',
    currency: 'TWD',
    rate_type: 'fixed',
    apr_decimal: '0.065',
    apr_as_of: '2026-07-17',
    start_date: '2026-01-01',
    payment_frequency: 'monthly',
    authority: 'official',
    review_state: 'confirmed',
  }, {}, db);
  createLoanSchedule(liability.liability_key, {
    source_key: loanSource.source_key,
    authority: 'official',
    review_state: 'confirmed',
    entries: [{
      sequence: 1,
      due_date: '2026-07-20',
      principal_minor: '20000',
      interest_minor: '5000',
      fee_minor: '0',
      total_minor: '25000',
      entry_status: 'scheduled',
    }],
  }, {}, db);

  const instrument = createInstrument({
    instrument_type: 'etf',
    name: 'Synthetic Taiwan leveraged ETF',
    symbol: '00675L',
    exchange: 'TWSE',
    quote_currency: 'TWD',
    authority: 'official',
    review_state: 'confirmed',
  }, {}, db);
  createHolding({
    account_key: broker.account_key,
    instrument_key: instrument.instrument_key,
    source_key: brokerSource.source_key,
    as_of_date: '2026-07-17',
    quantity_decimal: '20',
    reported_market_value_minor: '200000',
    currency: 'TWD',
    authority: 'official',
    review_state: 'confirmed',
    record_status: 'confirmed',
  }, {}, db);
  createMarketQuote({
    instrument_key: instrument.instrument_key,
    source_key: quoteSource.source_key,
    price_decimal: '100',
    quote_currency: 'TWD',
    as_of_date: '2026-07-17',
    quote_type: 'close',
    provider: 'Synthetic quote provider',
    authority: 'official',
    confidence: 1,
    review_state: 'confirmed',
  }, {}, db);

  return { instrument };
}

function query(db, instrumentKey) {
  return getFinancialHealthReview(new URLSearchParams({
    as_of_date: '2026-07-17',
    entity_id: 'personal',
    currency: 'TWD',
    taiwan_instrument_keys: instrumentKey,
    taiwan_leverage_factor: '2',
  }), db);
}

test('FA-0 produces one deterministic compact context pack from canonical facts', () => fixture((db) => {
  const scenario = buildScenario(db);
  const response = query(db, scenario.instrument.instrument_key);

  assert.equal(response.schema_version, 'finance.analysis-read-model/v1');
  assert.equal(response.analysis_id, 'financial_health_review');
  assert.equal(response.formula_version, 'financial-health-review/1');
  assert.equal(response.scope.as_of_date, '2026-07-17');
  assert.deepEqual(response.scope.defaulted_fields, []);
  assert.equal(response.facts.position.total_assets_minor, '1200000');
  assert.equal(response.facts.position.total_liabilities_minor, '500000');
  assert.equal(response.facts.position.net_worth_minor, '700000');
  assert.equal(response.facts.liquidity.cash_minor, '1000000');
  assert.equal(response.facts.debt.liability_profiles[0].current_balance_minor, '500000');
  assert.equal(response.facts.debt.liability_profiles[0].next_scheduled_payment.amount_minor, '25000');
  assert.equal(response.facts.investments.selected_market_value_minor, '200000');
  assert.equal(response.facts.investments.factor_exposure_minor, '400000');
  assert.equal(response.derived.factor_exposure_to_net_worth_bps, '5714');
  assert.equal(response.derived.stress_tests[0].stress_loss_minor, '40000');
  assert.equal(response.derived.stress_tests[1].stress_loss_minor, '80000');
  assert.equal(response.coverage.status, 'partial');
  assert.ok(response.coverage.missing_inputs.includes('essential_monthly_spend'));
  assert.ok(response.drillback.holding_keys.length === 1);
  assert.ok(response.source_watermark.semantic_hash);
  assert.equal(JSON.stringify(response).includes('ai_answer'), false);
  assert.deepEqual(query(db, scenario.instrument.instrument_key), response, 'same DB state and request must replay exactly');
}));

test('FA-0 never guesses leverage exposure without an explicit instrument scope and factor', () => fixture((db) => {
  const scenario = buildScenario(db);
  const response = getFinancialHealthReview(new URLSearchParams({
    as_of_date: '2026-07-17',
    entity_id: 'personal',
    currency: 'TWD',
    taiwan_instrument_keys: scenario.instrument.instrument_key,
  }), db);
  assert.equal(response.facts.investments.selected_market_value_minor, '200000');
  assert.equal(response.facts.investments.factor_exposure_minor, null);
  assert.equal(response.derived.stress_tests[0].stress_loss_minor, null);
  assert.ok(response.coverage.missing_inputs.includes('taiwan_leverage_factor'));
  assert.ok(response.coverage.warnings.some((item) => item.kind === 'missing_leverage_factor'));
}));

test('FA-0 rejects an unscoped leverage assumption', () => fixture((db) => {
  assert.throws(
    () => getFinancialHealthReview(new URLSearchParams({
      as_of_date: '2026-07-17',
      taiwan_leverage_factor: '2',
    }), db),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'taiwan_instrument_keys',
  );
}));
