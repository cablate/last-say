const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createSource } = require('../lib/queries/finance/sources');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { previewIngestion, commitIngestion } = require('../lib/finance/ingestion');
const { reversePreview, reverseIngestion } = require('../lib/finance/ingestion/reversal');
const { createHumanConfirmation, confirmHumanConfirmation, consumeHumanConfirmation } = require('../lib/queries/finance/human-confirmations');
const { reconciliationSummary } = require('../lib/queries/finance/reconciliation');
const {
  createCreditCardProfile, updateCreditCardProfile, createCardStatement, createCardPaymentMatch,
  createLiability, createLoanSchedule, createLoanAllocation,
  createCommitment, createOccurrence, listCreditCards, listLiabilities, listCommitments,
} = require('../lib/queries/finance/obligations');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-obligation-closure-'));
  const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try { return run(db); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function cash(db, accountKey, amount, currency = 'TWD', name = 'Settlement') {
  return createCashActivity({ account_key: accountKey, transaction_date: '2026-07-01', name, amount_minor: String(amount), currency, flow_type: 'settlement', category_primary: 'settlement' }, {}, db);
}

test('card payment matches require same-entity currency outflow and bounded allocation', () => fixture((db) => {
  const card = createAccount({ display_name: 'Card', account_kind: 'credit_card', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
  const bank = createAccount({ display_name: 'Bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
  const usdBank = createAccount({ display_name: 'USD bank', account_kind: 'bank', currency: 'USD', authority: 'user_confirmed' }, {}, db);
  const source = createSource({ source_kind: 'credit_card_statement_csv', description: 'Statement', account_key: card.account_key, authority: 'official' }, {}, db);
  const profile = createCreditCardProfile({ account_key: card.account_key, currency: 'TWD', authority: 'official', review_state: 'confirmed' }, {}, db);
  const statement = createCardStatement({ profile_key: profile.profile_key, source_key: source.source_key, period_start: '2026-06-01', period_end: '2026-06-30', close_date: '2026-06-30', due_date: '2026-07-10', statement_balance_minor: '1000', currency: 'TWD', authority: 'official', review_state: 'confirmed' }, {}, db);
  const inflow = cash(db, bank.account_key, 1000, 'TWD', 'Wrong direction');
  const usd = cash(db, usdBank.account_key, -1000, 'USD', 'Wrong currency');
  const payment = cash(db, bank.account_key, -1000);
  assert.throws(() => createCardPaymentMatch({ statement_key: statement.statement_key, transaction_key: inflow.transaction_key, amount_minor: '1000', authority: 'ai_inferred' }, {}, db), /must be an outflow/i);
  assert.throws(() => createCardPaymentMatch({ statement_key: statement.statement_key, transaction_key: usd.transaction_key, amount_minor: '1000', authority: 'ai_inferred' }, {}, db), /currency must match/i);
  assert.throws(() => createCardPaymentMatch({ statement_key: statement.statement_key, transaction_key: payment.transaction_key, amount_minor: '1001', authority: 'ai_inferred' }, {}, db), /exceeds the cash transaction/i);
  const match = createCardPaymentMatch({ statement_key: statement.statement_key, transaction_key: payment.transaction_key, amount_minor: '1000', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  assert.equal(match.match_status, 'settled');
}));

test('loan allocation rejects negative, inflow, currency and over-allocation inputs', () => fixture((db) => {
  const loan = createAccount({ display_name: 'Loan', account_kind: 'loan', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
  const bank = createAccount({ display_name: 'Bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
  const usdBank = createAccount({ display_name: 'USD bank', account_kind: 'bank', currency: 'USD', authority: 'user_confirmed' }, {}, db);
  const source = createSource({ source_kind: 'loan_contract', description: 'Loan contract', account_key: loan.account_key, authority: 'official' }, {}, db);
  const liability = createLiability({ account_key: loan.account_key, source_key: source.source_key, liability_kind: 'amortizing_loan', original_principal_minor: '10000', currency: 'TWD', rate_type: 'fixed', apr_decimal: '0.02', start_date: '2026-01-01', payment_frequency: 'monthly', authority: 'official', review_state: 'confirmed' }, {}, db);
  const scheduled = createLoanSchedule(liability.liability_key, { source_key: source.source_key, authority: 'official', entries: [{ sequence: 1, due_date: '2026-07-01', principal_minor: '800', interest_minor: '200', fee_minor: '0', total_minor: '1000' }] }, {}, db).schedule[0];
  const payment = cash(db, bank.account_key, -1000);
  const inflow = cash(db, bank.account_key, 1000, 'TWD', 'Wrong direction');
  const usd = cash(db, usdBank.account_key, -1000, 'USD', 'Wrong currency');
  const base = { schedule_key: scheduled.schedule_key, transaction_key: payment.transaction_key, principal_minor: '800', interest_minor: '200', fee_minor: '0', authority: 'user_confirmed' };
  assert.throws(() => createLoanAllocation({ ...base, principal_minor: '-1' }, {}, db), /non-negative/i);
  assert.throws(() => createLoanAllocation({ ...base, transaction_key: inflow.transaction_key }, {}, db), /must be an outflow/i);
  assert.throws(() => createLoanAllocation({ ...base, transaction_key: usd.transaction_key }, {}, db), /currency must match/i);
  assert.throws(() => createLoanAllocation({ ...base, principal_minor: '801', interest_minor: '199' }, {}, db), /schedule components/i);
  const allocation = createLoanAllocation(base, {}, db);
  assert.equal(allocation.reconciliation_status, 'reconciled');
}));

test('AI recurring patterns remain provisional until owner confirmation', () => fixture((db) => {
  const candidate = { entity_key: 'personal', commitment_kind: 'subscription', direction: 'out', amount_kind: 'fixed', amount_minor: '500', currency: 'TWD', cadence: 'monthly', start_date: '2026-01-01', authority: 'ai_inferred' };
  assert.throws(() => createCommitment({ ...candidate, status: 'scheduled', review_state: 'needs_review' }, {}, db), /must remain provisional/i);
  assert.throws(() => createCommitment({ ...candidate, status: 'provisional', review_state: 'confirmed' }, {}, db), /must remain provisional/i);
  const commitment = createCommitment({ ...candidate, status: 'provisional', review_state: 'needs_review' }, {}, db);
  assert.throws(() => createOccurrence(commitment.commitment_key, { due_date: '2026-08-01', amount_minor: '500', occurrence_status: 'scheduled' }, {}, db), /must remain provisional/i);
  const occurrence = createOccurrence(commitment.commitment_key, { due_date: '2026-08-01', amount_minor: '500', occurrence_status: 'provisional' }, {}, db);
  assert.equal(occurrence.occurrence_status, 'provisional');
}));

test('run-owned obligation identities reverse softly and can be reimported', () => fixture((db) => {
  const bundle = {
    schema_id: 'finance.ingestion-bundle/v1', idempotency_key: 'obligation-reversal-gate', bundle_kind: 'card_statement', authority: 'official', reason: 'Synthetic reversal gate.',
    sections: {
      accounts: [{ client_item_key: 'card', display_name: 'Imported card', account_kind: 'credit_card', currency: 'TWD', authority: 'official' }],
      credit_card_profiles: [{ client_item_key: 'profile', account_client_ref: 'card', currency: 'TWD', authority: 'official', review_state: 'confirmed' }],
    },
  };
  const run = commitIngestion(previewIngestion(bundle, {}, db).run_key, {}, db);
  const impact = reversePreview(run.run_key, db);
  assert.equal(impact.reversible, true);
  const payload = { reason: 'Synthetic correction.', impact_hash: impact.impact_hash };
  const proposal = createHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: run.run_key, payload, expected_version: null }, db);
  const receipt = confirmHumanConfirmation(proposal.proposal_key, { browserConfirmed: true }, db);
  consumeHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: run.run_key, payload, expected_version: null, proposal_key: proposal.proposal_key, confirmation_receipt: receipt.confirmation_receipt }, (authorization) => reverseIngestion(run.run_key, payload, { type: 'human_ui' }, db, authorization), db);
  assert.equal(db.prepare('SELECT record_status FROM credit_card_profiles').get().record_status, 'reversed');
  assert.equal(db.prepare("SELECT COUNT(*) count FROM credit_card_profiles WHERE record_status='posted'").get().count, 0);
  const corrected = structuredClone(bundle); corrected.idempotency_key = 'obligation-reimport'; corrected.sections.accounts[0].display_name = 'Corrected card';
  commitIngestion(previewIngestion(corrected, {}, db).run_key, {}, db);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM credit_card_profiles WHERE record_status='posted'").get().count, 1);
}));

test('existing-owner unique identities block reversal before state changes', () => fixture((db) => {
  const loan = createAccount({ display_name: 'Existing loan', account_kind: 'loan', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
  const source = createSource({ source_kind: 'loan_contract', description: 'Existing contract', account_key: loan.account_key, authority: 'official' }, {}, db);
  const liability = createLiability({ account_key: loan.account_key, source_key: source.source_key, liability_kind: 'amortizing_loan', original_principal_minor: '10000', currency: 'TWD', rate_type: 'fixed', apr_decimal: '0.02', start_date: '2026-01-01', payment_frequency: 'monthly', authority: 'official', review_state: 'confirmed' }, {}, db);
  const bundle = {
    schema_id: 'finance.ingestion-bundle/v1', idempotency_key: 'existing-liability-schedule', bundle_kind: 'liability_context', authority: 'official', reason: 'Synthetic unique identity gate.',
    sections: {
      loan_schedules: [{ client_item_key: 'schedule', liability_key: liability.liability_key, source_key: source.source_key, authority: 'official', entries: [{ sequence: 1, due_date: '2026-08-01', principal_minor: '800', interest_minor: '200', fee_minor: '0', total_minor: '1000' }] }],
    },
  };
  const run = commitIngestion(previewIngestion(bundle, {}, db).run_key, {}, db);
  const impact = reversePreview(run.run_key, db);
  assert.equal(impact.reversible, false);
  assert.ok(impact.blockers.some((item) => item.resource_type === 'loan_schedule_batch' && item.reason === 'reversal_would_strand_unique_identity'));
  assert.equal(db.prepare('SELECT status FROM ingestion_runs WHERE run_key=?').get(run.run_key).status, 'committed');
  assert.equal(db.prepare('SELECT record_status FROM loan_schedule_entries').get().record_status, 'posted');
}));

test('later obligation edits block reversal instead of erasing newer evidence', () => fixture((db) => {
  const bundle = {
    schema_id: 'finance.ingestion-bundle/v1', idempotency_key: 'later-profile-edit', bundle_kind: 'card_statement', authority: 'official', reason: 'Synthetic later edit gate.',
    sections: {
      accounts: [{ client_item_key: 'card', display_name: 'Imported card', account_kind: 'credit_card', currency: 'TWD', authority: 'official' }],
      credit_card_profiles: [{ client_item_key: 'profile', account_client_ref: 'card', currency: 'TWD', authority: 'official', review_state: 'confirmed' }],
    },
  };
  const run = commitIngestion(previewIngestion(bundle, {}, db).run_key, {}, db);
  const profileKey = run.result.created.credit_card_profiles[0];
  updateCreditCardProfile(profileKey, { account_key: run.result.created.accounts[0], statement_close_day: 20, payment_due_day: 8, currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed', expected_version: 1 }, { type: 'human_ui' }, db);
  const impact = reversePreview(run.run_key, db);
  assert.equal(impact.reversible, false);
  assert.ok(impact.blockers.some((item) => item.resource_type === 'credit_card_profile' && item.reason === 'obligation_changed_after_run'));
}));

test('compound card loan and commitment lifecycle reverses without deleting evidence', () => fixture((db) => {
  const bundle = {
    schema_id: 'finance.ingestion-bundle/v1', idempotency_key: 'all-obligations', bundle_kind: 'mixed', authority: 'official', reason: 'Synthetic obligation lifecycle.',
    sections: {
      accounts: [
        { client_item_key: 'card', display_name: 'Card', account_kind: 'credit_card', currency: 'TWD', authority: 'official' },
        { client_item_key: 'bank', display_name: 'Bank', account_kind: 'bank', currency: 'TWD', authority: 'official' },
        { client_item_key: 'loan', display_name: 'Loan', account_kind: 'loan', currency: 'TWD', authority: 'official' },
      ],
      sources: [
        { client_item_key: 'card-source', account_client_ref: 'card', source_kind: 'credit_card_statement_csv', description: 'Card source', authority: 'official' },
        { client_item_key: 'loan-source', account_client_ref: 'loan', source_kind: 'loan_contract', description: 'Loan source', authority: 'official' },
      ],
      cash_transactions: [
        { client_item_key: 'charge', account_client_ref: 'card', source_client_ref: 'card-source', transaction_date: '2026-06-01', name: 'Charge', amount_minor: '-1200', currency: 'TWD', flow_type: 'expense', category_primary: 'purchase' },
        { client_item_key: 'card-payment', account_client_ref: 'bank', transaction_date: '2026-07-01', name: 'Card payment', amount_minor: '-1200', currency: 'TWD', flow_type: 'settlement', category_primary: 'card payment' },
        { client_item_key: 'loan-payment', account_client_ref: 'bank', transaction_date: '2026-07-02', name: 'Loan payment', amount_minor: '-1000', currency: 'TWD', flow_type: 'settlement', category_primary: 'loan payment' },
      ],
      credit_card_profiles: [{ client_item_key: 'profile', account_client_ref: 'card', currency: 'TWD', authority: 'official', review_state: 'confirmed' }],
      credit_card_statements: [{ client_item_key: 'statement', profile_client_ref: 'profile', source_client_ref: 'card-source', period_start: '2026-06-01', period_end: '2026-06-30', close_date: '2026-06-30', due_date: '2026-07-10', statement_balance_minor: '1200', currency: 'TWD', authority: 'official', review_state: 'confirmed', items: [{ transaction_client_ref: 'charge', item_role: 'charge' }] }],
      credit_card_installments: [{ client_item_key: 'installment', profile_client_ref: 'profile', originating_transaction_client_ref: 'charge', source_client_ref: 'card-source', financed_principal_minor: '1200', installment_count: 1, start_date: '2026-07-10', currency: 'TWD', authority: 'official', entries: [{ sequence: 1, due_date: '2026-07-10', principal_minor: '1200', interest_minor: '0', fee_minor: '0', total_minor: '1200' }] }],
      credit_card_payment_matches: [{ client_item_key: 'card-match', statement_client_ref: 'statement', transaction_client_ref: 'card-payment', amount_minor: '1200', authority: 'official', review_state: 'confirmed' }],
      liabilities: [{ client_item_key: 'liability', account_client_ref: 'loan', source_client_ref: 'loan-source', liability_kind: 'amortizing_loan', original_principal_minor: '10000', currency: 'TWD', rate_type: 'fixed', apr_decimal: '0.02', start_date: '2026-01-01', payment_frequency: 'monthly', authority: 'official', review_state: 'confirmed' }],
      loan_schedules: [{ client_item_key: 'schedule', liability_client_ref: 'liability', source_client_ref: 'loan-source', authority: 'official', entries: [{ sequence: 1, due_date: '2026-07-02', principal_minor: '800', interest_minor: '200', fee_minor: '0', total_minor: '1000' }] }],
      loan_allocations: [{ client_item_key: 'allocation', schedule_client_ref: 'schedule', transaction_client_ref: 'loan-payment', principal_minor: '800', interest_minor: '200', fee_minor: '0', authority: 'official', review_state: 'confirmed' }],
      commitments: [{ client_item_key: 'commitment', commitment_kind: 'rent', direction: 'out', amount_kind: 'fixed', amount_minor: '7000', currency: 'TWD', cadence: 'monthly', start_date: '2026-01-01', status: 'scheduled', authority: 'official', review_state: 'confirmed' }],
      commitment_occurrences: [{ client_item_key: 'occurrence', commitment_client_ref: 'commitment', due_date: '2026-08-01', amount_minor: '7000', occurrence_status: 'scheduled' }],
    },
  };
  const run = commitIngestion(previewIngestion(bundle, {}, db).run_key, {}, db);
  assert.equal(listCreditCards(db).length, 1); assert.equal(listLiabilities(db).length, 1); assert.equal(listCommitments(db).length, 1);
  const impact = reversePreview(run.run_key, db); assert.equal(impact.reversible, true);
  const payload = { reason: 'Synthetic all-obligation reversal.', impact_hash: impact.impact_hash };
  const proposal = createHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: run.run_key, payload, expected_version: null }, db);
  const receipt = confirmHumanConfirmation(proposal.proposal_key, { browserConfirmed: true }, db);
  consumeHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: run.run_key, payload, expected_version: null, proposal_key: proposal.proposal_key, confirmation_receipt: receipt.confirmation_receipt }, (authorization) => reverseIngestion(run.run_key, payload, { type: 'human_ui' }, db, authorization), db);
  assert.equal(listCreditCards(db).length, 0); assert.equal(listLiabilities(db).length, 0); assert.equal(listCommitments(db).length, 0);
  assert.equal(reconciliationSummary(db).typed_legs.some((leg) => ['card_settlement', 'loan_allocation'].includes(leg.context)), false);
  for (const table of ['credit_card_statement_items', 'credit_card_installment_entries', 'loan_schedule_entries', 'commitment_occurrences']) {
    assert.ok(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count > 0, `${table} evidence should remain`);
  }
}));
