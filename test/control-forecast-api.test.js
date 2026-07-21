const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createSource } = require('../lib/queries/finance/sources');
const { createBalanceSnapshot } = require('../lib/queries/finance/balances');
const { createLiability, createLoanSchedule } = require('../lib/queries/finance/obligations');
const { getCashForecast } = require('../lib/queries/finance/control/forecast');
const { analysisContext } = require('../lib/queries/finance/analysis-context');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-forecast-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function account(db, name, kind) {
  return createAccount({ display_name: name, account_kind: kind, currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
}

test('FC-3B composes trusted opening cash and FC-2 events without policy conclusions', () => fixture((db) => {
  const bank = account(db, 'Synthetic forecast bank', 'bank');
  const loanAccount = account(db, 'Synthetic forecast loan', 'loan');
  const bankSource = createSource({ source_kind: 'bank_statement_csv', description: 'Synthetic current cash', account_key: bank.account_key, authority: 'official', review_state: 'confirmed', is_official: true }, {}, db);
  const loanSource = createSource({ source_kind: 'loan_statement', description: 'Synthetic loan schedule', account_key: loanAccount.account_key, authority: 'official', review_state: 'confirmed', is_official: true }, {}, db);
  createBalanceSnapshot({ account_key: bank.account_key, source_key: bankSource.source_key, as_of_date: '2026-07-17', observed_at: '2026-07-17T12:00:00Z', balance_kind: 'ledger', amount_minor: '100000', currency: 'TWD', authority: 'official', review_state: 'confirmed' }, {}, db);
  const liability = createLiability({ account_key: loanAccount.account_key, source_key: loanSource.source_key, liability_kind: 'personal_loan', original_principal_minor: '500000', currency: 'TWD', rate_type: 'fixed', apr_decimal: '0.05', start_date: '2026-01-01', payment_frequency: 'monthly', authority: 'official', review_state: 'confirmed' }, {}, db);
  createLoanSchedule(liability.liability_key, { source_key: loanSource.source_key, authority: 'official', review_state: 'confirmed', entries: [{ sequence: 1, due_date: '2026-07-18', principal_minor: '70000', interest_minor: '0', fee_minor: '0', total_minor: '70000' }] }, {}, db);

  const result = getCashForecast(new URLSearchParams('as_of_date=2026-07-17&entity_id=personal&currency=TWD&horizon_days=90'), db);
  assert.equal(result.analysis_id, 'cash_forecast');
  assert.equal(result.coverage.status, 'complete');
  assert.equal(result.facts.forecast.daily.length, 90);
  assert.equal(result.derived.minimum_projected_cash_minor, '30000');
  assert.equal(result.derived.safe_to_spend_minor, null);
  assert.equal(result.facts.forecast.policy.status, 'unavailable');
  assert.deepEqual(getCashForecast(new URLSearchParams('as_of_date=2026-07-17&entity_id=personal&currency=TWD&horizon_days=90'), db), result);
  const context = analysisContext({ entity: 'personal', as_of: '2026-07-17', datasets: [{ name: 'cash_forecast', as_of_date: '2026-07-17', currency: 'TWD', horizon_days: 90 }] }, db);
  assert.equal(context.datasets[0].data.analysis_id, 'cash_forecast');
}));

test('FC-3B does not invent an opening cash balance when the snapshot is missing', () => fixture((db) => {
  account(db, 'Synthetic missing forecast cash', 'bank');
  const result = getCashForecast(new URLSearchParams('as_of_date=2026-07-17&entity_id=personal&currency=TWD&horizon_days=90'), db);
  assert.equal(result.facts.forecast, null);
  assert.equal(result.coverage.status, 'partial');
  assert.ok(result.coverage.missing_inputs.includes('missing_opening_cash_snapshot'));
}));
