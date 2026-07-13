const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { previewIngestion, commitIngestion } = require('../lib/finance/ingestion');
const { reversePreview, reverseIngestion } = require('../lib/finance/ingestion/reversal');
const { createHumanConfirmation, confirmHumanConfirmation, consumeHumanConfirmation } = require('../lib/queries/finance/human-confirmations');
const { getSummary } = require('../lib/queries/transactions');
const { getIncomeStatement } = require('../lib/queries/reports/income-statement');
const { createBalanceSnapshot } = require('../lib/queries/finance/balances');

test('confirmed reversal preserves facts and audit while excluding them from active state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-reversal-')); const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const input = { schema_id: 'finance.ingestion-bundle/v1', idempotency_key: 'reverse-me', bundle_kind: 'mixed', authority: 'ai_inferred', reason: 'Synthetic.', sections: { accounts: [{ client_item_key: 'a', display_name: 'Wrong account', account_kind: 'bank', currency: 'TWD' }], sources: [], balance_snapshots: [{ client_item_key: 'b', account_client_ref: 'a', as_of_date: '2026-06-30', observed_at: '2026-06-30T00:00:00Z', balance_kind: 'ledger', amount_minor: '100', currency: 'TWD', authority: 'ai_inferred' }], cash_transactions: [{ client_item_key: 't', account_client_ref: 'a', transaction_date: '2026-06-20', name: 'WRONG ROW', amount_minor: '-100', currency: 'TWD', flow_type: '一般支出', category_primary: '待確認' }] } };
    const run = commitIngestion(previewIngestion(input, {}, db).run_key, {}, db); const impact = reversePreview(run.run_key, db); assert.equal(impact.reversible, true);
    const payload = { reason: 'Imported to the wrong account.', impact_hash: impact.impact_hash };
    const proposal = createHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: run.run_key, payload, expected_version: null }, db); const receipt = confirmHumanConfirmation(proposal.proposal_key, { browserConfirmed: true }, db);
    const result = consumeHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: run.run_key, payload, expected_version: null, proposal_key: proposal.proposal_key, confirmation_receipt: receipt.confirmation_receipt }, (authorization) => reverseIngestion(run.run_key, payload, { type: 'human_ui' }, db, authorization), db);
    assert.equal(result.reversed_items, 3); assert.equal(db.prepare('SELECT status FROM ingestion_runs WHERE run_key=?').get(run.run_key).status, 'reversed'); assert.equal(db.prepare('SELECT record_status FROM account_balance_snapshots').get().record_status, 'reversed'); assert.equal(db.prepare('SELECT record_status FROM transactions').get().record_status, 'reversed'); assert.equal(getSummary(new URLSearchParams('month=2026-06'), db).rows, 0); assert.equal(getIncomeStatement({ month: '2026-06' }, db).total_expense_cents, 0); assert.equal(db.prepare('SELECT COUNT(*) count FROM data_change_log WHERE resource_type=? AND action=?').get('ingestion_run', 'reverse').count, 1);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reversal fails closed when a run-created account has later facts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-reversal-blocked-')); const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const input = { schema_id: 'finance.ingestion-bundle/v1', idempotency_key: 'reverse-blocked', bundle_kind: 'account_snapshot', authority: 'ai_inferred', reason: 'Synthetic.', sections: { accounts: [{ client_item_key: 'a', display_name: 'Shared later', account_kind: 'bank', currency: 'TWD' }], sources: [], balance_snapshots: [], cash_transactions: [] } };
    const run = commitIngestion(previewIngestion(input, {}, db).run_key, {}, db); const accountKey = run.result.created.accounts[0];
    createBalanceSnapshot({ account_key: accountKey, as_of_date: '2026-07-01', observed_at: '2026-07-01T00:00:00Z', balance_kind: 'ledger', amount_minor: '100', currency: 'TWD', authority: 'ai_inferred' }, {}, db);
    const impact = reversePreview(run.run_key, db); assert.equal(impact.reversible, false); assert.ok(impact.blockers.some((item) => item.reason === 'account_has_balances_outside_run'));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
