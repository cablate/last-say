const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { previewIngestion, commitIngestion, cleanupExpiredPreviews } = require('../lib/finance/ingestion');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-ingestion-')); const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  return { db, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function bundle(idempotencyKey = 'bundle-one') {
  return { schema_id: 'finance.ingestion-bundle/v1', idempotency_key: idempotencyKey, bundle_kind: 'mixed', authority: 'institution_export', reason: 'Synthetic bank export.', sections: {
    accounts: [{ client_item_key: 'account-1', display_name: 'Synthetic checking', account_kind: 'bank', currency: 'TWD', authority: 'institution_export', review_state: 'reviewed' }],
    sources: [{ client_item_key: 'source-1', account_client_ref: 'account-1', source_kind: 'bank_statement_csv', description: 'Synthetic statement', authority: 'institution_export', review_state: 'reviewed' }],
    balance_snapshots: [{ client_item_key: 'balance-1', account_client_ref: 'account-1', source_client_ref: 'source-1', as_of_date: '2026-06-30', observed_at: '2026-07-01T00:00:00Z', balance_kind: 'statement', amount_minor: '10000000', currency: 'TWD', authority: 'official', review_state: 'confirmed' }],
    cash_transactions: [{ client_item_key: 'cash-1', account_client_ref: 'account-1', source_client_ref: 'source-1', transaction_date: '2026-06-20', external_id: 'synthetic-1', name: 'SYNTHETIC RENT', amount_minor: '-2500000', currency: 'TWD', flow_type: '一般支出', category_primary: '居住', judgment_reason: 'Synthetic fixture.' }],
  } };
}

test('preview writes staging only, commit is atomic and purges staged payload', () => {
  const ctx = fixture(); try {
    const preview = previewIngestion(bundle(), { type: 'external_ai' }, ctx.db);
    assert.equal(preview.status, 'preview_ready'); assert.equal(ctx.db.prepare('SELECT COUNT(*) count FROM accounts').get().count, 0); assert.equal(ctx.db.prepare('SELECT COUNT(*) count FROM transactions').get().count, 0);
    const committed = commitIngestion(preview.run_key, { type: 'external_ai' }, ctx.db);
    assert.equal(committed.status, 'committed'); assert.equal(ctx.db.prepare('SELECT COUNT(*) count FROM accounts').get().count, 1); assert.equal(ctx.db.prepare('SELECT COUNT(*) count FROM account_balance_snapshots').get().count, 1); assert.equal(ctx.db.prepare('SELECT COUNT(*) count FROM transactions').get().count, 1); assert.equal(ctx.db.prepare('SELECT COUNT(*) count FROM ingestion_items WHERE staged_json IS NOT NULL').get().count, 0);
  } finally { ctx.close(); }
});

test('idempotency returns the same run and changed payload conflicts', () => {
  const ctx = fixture(); try {
    const first = previewIngestion(bundle(), {}, ctx.db); const retry = previewIngestion(bundle(), {}, ctx.db); assert.equal(retry.run_key, first.run_key);
    const changed = bundle(); changed.reason = 'Changed'; assert.throws(() => previewIngestion(changed, {}, ctx.db), /different payload/);
  } finally { ctx.close(); }
});

test('uncommitted staging payload expires after 24 hours', () => {
  const ctx = fixture(); try {
    const start = new Date('2026-07-01T00:00:00Z'); const run = previewIngestion(bundle('expiring'), {}, ctx.db, start);
    const result = cleanupExpiredPreviews(ctx.db, new Date('2026-07-02T00:00:01Z'));
    assert.equal(result.expired_runs, 1); assert.equal(ctx.db.prepare('SELECT status FROM ingestion_runs WHERE run_key=?').get(run.run_key).status, 'expired'); assert.equal(ctx.db.prepare('SELECT COUNT(*) count FROM ingestion_items WHERE staged_json IS NOT NULL').get().count, 0);
  } finally { ctx.close(); }
});
