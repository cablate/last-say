const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createSource } = require('../lib/queries/finance/sources');
const { createLiability, createLoanSchedule, createCommitment } = require('../lib/queries/finance/obligations');
const { getObligationTimeline } = require('../lib/queries/finance/control/obligations');
const { analysisContext } = require('../lib/queries/finance/analysis-context');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-obligations-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function account(db, name, kind) {
  return createAccount({ display_name: name, account_kind: kind, currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
}

function source(db, accountKey) {
  return createSource({ source_kind: 'loan_statement', description: 'Synthetic obligation evidence', account_key: accountKey, authority: 'official', review_state: 'confirmed', is_official: true }, {}, db);
}

test('FC-2B returns one deterministic timeline with windows and blockers', () => fixture((db) => {
  const loanAccount = account(db, 'Synthetic loan', 'loan');
  const bank = account(db, 'Synthetic bank', 'bank');
  const loanSource = source(db, loanAccount.account_key);
  const liability = createLiability({ account_key: loanAccount.account_key, source_key: loanSource.source_key, liability_kind: 'personal_loan', original_principal_minor: '500000', currency: 'TWD', rate_type: 'fixed', apr_decimal: '0.05', start_date: '2026-01-01', payment_frequency: 'monthly', authority: 'official', review_state: 'confirmed' }, {}, db);
  createLoanSchedule(liability.liability_key, { source_key: loanSource.source_key, authority: 'official', review_state: 'confirmed', entries: [{ sequence: 1, due_date: '2026-07-20', principal_minor: '20000', interest_minor: '5000', fee_minor: '0', total_minor: '25000' }] }, {}, db);
  createCommitment({ entity_id: 'personal', account_key: bank.account_key, commitment_kind: 'rent', direction: 'out', amount_kind: 'fixed', amount_minor: '700000', currency: 'TWD', cadence: 'monthly', start_date: '2026-01-01', next_due_date: '2026-08-01', status: 'scheduled', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);

  const response = getObligationTimeline(new URLSearchParams('as_of_date=2026-07-17&entity_id=personal&currency=TWD'), db);
  assert.equal(response.analysis_id, 'obligation_timeline');
  assert.equal(response.facts.counts.total, 2);
  assert.equal(response.derived.known_90_day_obligation_minor, '725000');
  assert.equal(response.facts.windows[0].known_amount_minor, '25000');
  assert.equal(response.coverage.status, 'complete');
  assert.deepEqual(getObligationTimeline(new URLSearchParams('as_of_date=2026-07-17&entity_id=personal&currency=TWD'), db), response);
  const context = analysisContext({ entity: 'personal', as_of: '2026-07-17', datasets: [{ name: 'obligation_timeline', as_of_date: '2026-07-17', currency: 'TWD', horizon_days: 90 }] }, db);
  assert.equal(context.datasets[0].data.analysis_id, 'obligation_timeline');
  assert.equal(context.datasets[0].data.derived.known_90_day_obligation_minor, '725000');
}));

test('FC-2B keeps missing loan schedules as blockers instead of inventing payments', () => fixture((db) => {
  const loanAccount = account(db, 'Synthetic missing schedule loan', 'loan');
  const loanSource = source(db, loanAccount.account_key);
  createLiability({ account_key: loanAccount.account_key, source_key: loanSource.source_key, liability_kind: 'personal_loan', original_principal_minor: '500000', currency: 'TWD', rate_type: 'fixed', apr_decimal: '0.05', start_date: '2026-01-01', payment_frequency: 'monthly', authority: 'official', review_state: 'confirmed' }, {}, db);
  const response = getObligationTimeline(new URLSearchParams('as_of_date=2026-07-17&entity_id=personal&currency=TWD'), db);
  assert.equal(response.facts.counts.total, 0);
  assert.equal(response.coverage.status, 'partial');
  assert.ok(response.coverage.missing_inputs.includes('missing_loan_schedule'));
}));
