const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { getFinanceCapabilities } = require('../lib/finance/capabilities');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { createCreditCardProfile, createCommitment } = require('../lib/queries/finance/obligations');
const { analysisContext } = require('../lib/queries/finance/analysis-context');

test('candidate datasets return bounded proposal envelopes and typed owner hints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-analysis-proposals-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try {
    const bank = createAccount({ display_name: 'Synthetic bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const card = createAccount({ display_name: 'Synthetic card', account_kind: 'credit_card', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const cash = createCashActivity({ account_key: bank.account_key, transaction_date: '2026-07-01', name: 'Synthetic transfer', amount_minor: '-100000', currency: 'TWD', flow_type: '信用卡繳款/移轉', category_primary: '轉帳/內部移轉' }, {}, db);
    createCreditCardProfile({ account_key: card.account_key, currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    createCommitment({ entity_key: 'personal', commitment_kind: 'subscription', direction: 'out', amount_kind: 'fixed', amount_minor: '50000', currency: 'TWD', cadence: 'monthly', start_date: '2026-01-01', status: 'provisional', authority: 'ai_inferred', review_state: 'needs_review' }, {}, db);
    const result = analysisContext({ entity: 'personal', as_of: '2026-07-16', datasets: [
      { name: 'transfer_candidates', limit: 10 },
      { name: 'recurring_candidates', limit: 10 },
      { name: 'statement_blockers', limit: 10 },
      { name: 'installment_anomalies', limit: 10 },
    ] }, db);
    assert.equal(result.datasets[0].rows[0].transaction_key, cash.transaction_key);
    assert.equal(result.datasets[0].rows[0].proposal.schema_id, 'finance.proposal-envelope/v1');
    assert.equal(result.datasets[0].rows[0].proposal.target.owner, 'transfer_matches');
    assert.equal(result.datasets[1].rows[0].proposal.target.owner, 'commitment_templates');
    assert.equal(result.datasets[2].rows[0].blocker, 'missing_credit_card_statement');
    assert.equal(result.datasets[3].rows.length, 0);
    assert.ok(result.datasets.every((dataset) => dataset.provenance.source_watermark));
    const capabilities = getFinanceCapabilities();
    assert.equal(capabilities.proposal_envelope.schema_id, 'finance.proposal-envelope/v1');
    for (const name of ['transfer_candidates','reimbursement_candidates','recurring_candidates','installment_anomalies','statement_blockers']) assert.ok(capabilities.analysis_context.datasets[name]);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('candidate datasets reject unregistered filters', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-analysis-proposal-filter-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try {
    assert.throws(() => analysisContext({ datasets: [{ name: 'transfer_candidates', merchant_sql: 'SELECT *' }] }, db), (error) => error.code === 'VALIDATION_ERROR');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
