const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { previewIngestion } = require('../lib/finance/ingestion');

test('a late section failure rolls back every canonical section', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-compound-')); const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const input = { schema_id: 'finance.ingestion-bundle/v1', idempotency_key: 'atomic-failure', bundle_kind: 'mixed', authority: 'ai_inferred', reason: 'Synthetic atomicity test.', sections: {
      accounts: [{ client_item_key: 'a', display_name: 'Rollback account', account_kind: 'bank', currency: 'TWD' }],
      sources: [], balance_snapshots: [],
      cash_transactions: [{ client_item_key: 't', account_client_ref: 'a', transaction_date: '2026-06-01', name: 'INVALID', amount_minor: '1.5', currency: 'TWD', flow_type: '一般支出', category_primary: '待確認' }],
    } };
    assert.throws(() => previewIngestion(input, {}, db), /integer minor-unit/);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM accounts').get().count, 0); assert.equal(db.prepare('SELECT COUNT(*) count FROM transactions').get().count, 0); assert.equal(db.prepare('SELECT COUNT(*) count FROM ingestion_runs').get().count, 0);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('unresolved cross-section references are rejected before staging', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-refs-')); const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const input = { schema_id: 'finance.ingestion-bundle/v1', idempotency_key: 'bad-ref', bundle_kind: 'account_snapshot', authority: 'ai_inferred', reason: 'Synthetic.', sections: { accounts: [], sources: [], balance_snapshots: [{ client_item_key: 'b', account_client_ref: 'missing', as_of_date: '2026-06-30', observed_at: '2026-06-30T00:00:00Z', balance_kind: 'ledger', amount_minor: '1', currency: 'TWD', authority: 'ai_inferred' }], cash_transactions: [] } };
    assert.throws(() => previewIngestion(input, {}, db), /Unresolved account_client_ref/); assert.equal(db.prepare('SELECT COUNT(*) count FROM ingestion_runs').get().count, 0);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
