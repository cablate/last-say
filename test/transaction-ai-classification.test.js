const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { previewIngestion, commitIngestion } = require('../lib/finance/ingestion');
const { reversePreview, reverseIngestion } = require('../lib/finance/ingestion/reversal');
const { createHumanConfirmation, confirmHumanConfirmation, consumeHumanConfirmation } = require('../lib/queries/finance/human-confirmations');
const { STANDARD_CATEGORIES, OWNER_UNRESOLVED_CATEGORY } = require('../lib/constants');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-ai-classification-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  return { db, close() { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function seedTransaction(db, suffix = 'base') {
  const input = {
    schema_id: 'finance.ingestion-bundle/v1', idempotency_key: `seed-${suffix}`, bundle_kind: 'mixed',
    authority: 'ai_inferred', reason: 'Synthetic transaction fixture.', sections: {
      accounts: [{ client_item_key: 'account', display_name: 'Test bank', account_kind: 'bank', currency: 'TWD' }],
      cash_transactions: [{ client_item_key: 'transaction', account_client_ref: 'account', transaction_date: '2026-07-01', name: 'TEST MERCHANT', amount_minor: '-12300', currency: 'TWD', flow_type: 'general', category_primary: STANDARD_CATEGORIES[0] }],
    },
  };
  const run = commitIngestion(previewIngestion(input, { type: 'test' }, db).run_key, { type: 'test' }, db);
  return db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(run.result.created.cash_transactions[0]);
}

function classificationInput(transaction, suffix = 'classify') {
  return {
    schema_id: 'finance.ingestion-bundle/v1', idempotency_key: suffix, bundle_kind: 'mixed',
    authority: 'ai_inferred', reason: 'Classify a synthetic transaction with explicit AI evidence.', sections: {
      transaction_classifications: [{
        client_item_key: 'classification', transaction_key: transaction.transaction_key,
        category_primary: STANDARD_CATEGORIES[1], category_sub: 'Synthetic subtype', flow_type: '一般支出', ai_confidence: 0.91,
        judgment_reason: 'The synthetic merchant fixture explicitly identifies the test category.', expected_updated_at: transaction.updated_at,
      }],
    },
  };
}

test('AI classification is previewed, audited, and does not mutate transaction facts', () => {
  const f = fixture();
  try {
    const before = seedTransaction(f.db, 'audited');
    const preview = previewIngestion(classificationInput(before, 'classify-audited'), { type: 'ai_agent' }, f.db);
    assert.equal(f.db.prepare('SELECT category_primary FROM transactions WHERE id=?').get(before.id).category_primary, before.category_primary);
    commitIngestion(preview.run_key, { type: 'ai_agent', note: 'Test classification.' }, f.db, new Date('2026-07-15T12:00:00Z'));
    const after = f.db.prepare('SELECT * FROM transactions WHERE id=?').get(before.id);
    assert.equal(after.transaction_date, before.transaction_date);
    assert.equal(after.amount_minor, before.amount_minor);
    assert.equal(after.name, before.name);
    assert.equal(after.account_id, before.account_id);
    assert.equal(after.category_primary, STANDARD_CATEGORIES[1]);
    assert.equal(after.flow_type, '一般支出');
    assert.equal(after.classification_source, 'ai');
    assert.equal(after.reviewed, 0);
    assert.equal(after.ai_confidence, 0.91);
    assert.match(after.judgment_reason, /synthetic merchant/i);
    assert.equal(f.db.prepare('SELECT COUNT(*) count FROM correction_log WHERE transaction_id=?').get(before.id).count, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) count FROM data_change_log WHERE resource_type='cash_transaction_classification' AND resource_key=? AND action='ai_classify'").get(before.transaction_key).count, 1);
  } finally { f.close(); }
});

test('AI classification rejects human-owned or reviewed transactions', () => {
  const f = fixture();
  try {
    const transaction = seedTransaction(f.db, 'human-owned');
    f.db.prepare("UPDATE transactions SET classification_source='human',reviewed=1 WHERE id=?").run(transaction.id);
    const current = f.db.prepare('SELECT * FROM transactions WHERE id=?').get(transaction.id);
    assert.throws(() => previewIngestion(classificationInput(current, 'classify-human-owned'), {}, f.db), (error) => error.code === 'REVIEW_REQUIRED');
  } finally { f.close(); }
});

test('AI classification cannot choose the owner-only unresolved outcome', () => {
  const f = fixture();
  try {
    const transaction = seedTransaction(f.db, 'owner-only-unresolved');
    const beforeRuns = f.db.prepare('SELECT COUNT(*) AS count FROM ingestion_runs').get().count;
    const input = classificationInput(transaction, 'classify-owner-only-unresolved');
    input.sections.transaction_classifications[0].category_primary = OWNER_UNRESOLVED_CATEGORY;
    assert.throws(
      () => previewIngestion(input, { type: 'ai_agent' }, f.db),
      (error) => error.code === 'REVIEW_REQUIRED' && error.field === 'category_primary',
    );
    const after = f.db.prepare('SELECT category_primary,classification_source,reviewed FROM transactions WHERE id=?').get(transaction.id);
    assert.equal(after.category_primary, transaction.category_primary);
    assert.equal(after.classification_source, transaction.classification_source);
    assert.equal(after.reviewed, transaction.reviewed);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM ingestion_runs').get().count, beforeRuns);
  } finally { f.close(); }
});

test('AI classification commit fails atomically after a stale preview', () => {
  const f = fixture();
  try {
    const before = seedTransaction(f.db, 'stale');
    const preview = previewIngestion(classificationInput(before, 'classify-stale'), {}, f.db);
    f.db.prepare("UPDATE transactions SET updated_at='2026-07-15T13:00:00.000Z' WHERE id=?").run(before.id);
    assert.throws(() => commitIngestion(preview.run_key, {}, f.db), (error) => error.code === 'VERSION_CONFLICT');
    const after = f.db.prepare('SELECT * FROM transactions WHERE id=?').get(before.id);
    assert.equal(after.category_primary, before.category_primary);
    assert.equal(after.classification_source, before.classification_source);
    assert.equal(f.db.prepare('SELECT status FROM ingestion_runs WHERE run_key=?').get(preview.run_key).status, 'preview_ready');
  } finally { f.close(); }
});

test('confirmed ingestion reversal restores the prior classification', () => {
  const f = fixture();
  try {
    const before = seedTransaction(f.db, 'reversible');
    const run = commitIngestion(previewIngestion(classificationInput(before, 'classify-reversible'), {}, f.db).run_key, {}, f.db, new Date('2026-07-15T12:00:00Z'));
    const impact = reversePreview(run.run_key, f.db);
    assert.equal(impact.reversible, true);
    const payload = { reason: 'Undo the synthetic AI classification.', impact_hash: impact.impact_hash };
    const proposal = createHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: run.run_key, payload, expected_version: null }, f.db);
    const receipt = confirmHumanConfirmation(proposal.proposal_key, { browserConfirmed: true }, f.db);
    consumeHumanConfirmation({ action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: run.run_key, payload, expected_version: null, proposal_key: proposal.proposal_key, confirmation_receipt: receipt.confirmation_receipt }, (authorization) => reverseIngestion(run.run_key, payload, { type: 'human_ui' }, f.db, authorization, new Date('2026-07-15T14:00:00Z')), f.db);
    const restored = f.db.prepare('SELECT * FROM transactions WHERE id=?').get(before.id);
    assert.equal(restored.category_primary, before.category_primary);
    assert.equal(restored.flow_type, before.flow_type);
    assert.equal(restored.classification_source, before.classification_source);
    assert.equal(restored.reviewed, before.reviewed);
    assert.equal(f.db.prepare("SELECT COUNT(*) count FROM data_change_log WHERE resource_type='cash_transaction_classification' AND action='reverse_ai_classify'").get().count, 1);
  } finally { f.close(); }
});
