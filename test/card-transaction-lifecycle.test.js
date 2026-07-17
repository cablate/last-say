const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createSource } = require('../lib/queries/finance/sources');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { createCreditCardProfile, createCardStatement } = require('../lib/queries/finance/obligations');
const { previewIngestion, commitIngestion } = require('../lib/finance/ingestion');
const { reversePreview, reverseIngestion } = require('../lib/finance/ingestion/reversal');
const { createHumanConfirmation, confirmHumanConfirmation, consumeHumanConfirmation } = require('../lib/queries/finance/human-confirmations');

const fixtureSpec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'financial-data', 'source-mappings', 'card-transaction-lifecycle.json'), 'utf8'));

function isolatedDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-card-lifecycle-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function cardAccount(db) {
  return createAccount({
    display_name: 'Synthetic lifecycle card', account_kind: 'credit_card', currency: 'TWD',
    authority: 'user_confirmed', review_state: 'confirmed',
  }, {}, db);
}

function currentSource(db, accountKey, suffix, periodEnd) {
  return createSource({
    source_kind: 'current_transactions_csv', description: `Synthetic current ${suffix}`,
    account_key: accountKey, period_start: '2026-06-20', period_end: periodEnd,
    authority: 'institution_export', review_state: 'reviewed',
  }, {}, db);
}

function provisional(db, accountKey, sourceKey, externalId, name, amount, date = '2026-07-05') {
  return createCashActivity({
    account_key: accountKey, source_key: sourceKey, transaction_date: date,
    external_id: externalId, name, amount_minor: amount, currency: 'TWD',
    flow_type: 'expense', category_primary: 'Synthetic expense', record_status: 'provisional',
  }, {}, db);
}

function lifecyclePayload(accountKey, sources, releaseKeys = [], idempotencyKey = 'card-lifecycle-happy') {
  return {
    schema_id: 'finance.card-transaction-lifecycle/v1',
    idempotency_key: idempotencyKey,
    account_key: accountKey,
    authority: 'official',
    reason: 'Synthetic posted statement replaces complete current evidence.',
    posted_source: {
      source_kind: 'credit_card_statement_csv', description: `Synthetic posted ${idempotencyKey}`,
      period_start: '2026-06-20', period_end: '2026-07-19', is_official: true,
      authority: 'official', review_state: 'confirmed',
    },
    expected_rows_total_minor: '-52500',
    posted_rows: [
      {
        client_item_key: 'posted-row-1', occurrence_ordinal: 1, transaction_date: '2026-07-05',
        external_id: 'AUTH-100', name: 'Synthetic Cafe', amount_minor: '-12500', currency: 'TWD',
        flow_type: 'expense', category_primary: 'Food',
      },
      {
        client_item_key: 'posted-row-2', occurrence_ordinal: 1, transaction_date: '2026-07-10',
        external_id: 'POST-300', name: 'Synthetic Books', amount_minor: '-40000', currency: 'TWD',
        flow_type: 'expense', category_primary: 'Education',
      },
    ],
    supersede_source_keys: sources.map((source) => source.source_key),
    release_transaction_keys: releaseKeys,
  };
}

function confirmedReverse(runKey, db) {
  const impact = reversePreview(runKey, db);
  assert.equal(impact.reversible, true);
  const payload = { reason: 'Synthetic lifecycle reversal.', impact_hash: impact.impact_hash };
  const proposal = createHumanConfirmation({
    action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: runKey,
    payload, expected_version: null,
  }, db);
  const receipt = confirmHumanConfirmation(proposal.proposal_key, { browserConfirmed: true }, db);
  return consumeHumanConfirmation({
    action_kind: 'reverse_ingestion_run', resource_type: 'ingestion_run', resource_key: runKey,
    payload, expected_version: null, proposal_key: proposal.proposal_key,
    confirmation_receipt: receipt.confirmation_receipt,
  }, (authorization) => reverseIngestion(runKey, payload, { type: 'human_ui' }, db, authorization), db);
}

test('current card facts promote, release, supersede and reverse without duplicate economic rows', () => isolatedDb((db) => {
  const account = cardAccount(db);
  const oldSource = currentSource(db, account.account_key, '07-08', '2026-07-08');
  const latestSource = currentSource(db, account.account_key, '07-16', '2026-07-16');
  const matched = provisional(db, account.account_key, latestSource.source_key, 'AUTH-100', 'SYNTHETIC CAFE', '-12500');
  const released = provisional(db, account.account_key, latestSource.source_key, 'AUTH-200', 'SYNTHETIC HOLD', '-30000', '2026-07-06');
  const matchedId = db.prepare('SELECT id FROM transactions WHERE transaction_key=?').get(matched.transaction_key).id;
  db.prepare('INSERT INTO transaction_sources(transaction_id,source_id,source_row_id,source_description,raw_info) VALUES(?,?,?,?,?)')
    .run(matchedId, oldSource.id, 'old-row-1', oldSource.description, '');
  const beforeCount = db.prepare('SELECT COUNT(*) count FROM transactions').get().count;
  const payload = lifecyclePayload(account.account_key, [oldSource, latestSource], [released.transaction_key]);

  const preview = previewIngestion(payload, { type: 'external_ai' }, db);
  assert.equal(preview.result.committable, fixtureSpec.expected_happy_path.committable);
  assert.deepEqual(preview.result.counts, fixtureSpec.expected_happy_path.counts);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM transactions').get().count, beforeCount);
  assert.equal(previewIngestion(payload, {}, db).run_key, preview.run_key);

  const committed = commitIngestion(preview.run_key, { type: 'external_ai' }, db);
  assert.equal(committed.status, 'committed');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM transactions').get().count - beforeCount, fixtureSpec.expected_happy_path.transaction_count_delta);
  assert.equal(db.prepare('SELECT record_status FROM transactions WHERE transaction_key=?').get(matched.transaction_key).record_status, 'posted');
  assert.equal(db.prepare('SELECT record_status FROM transactions WHERE transaction_key=?').get(released.transaction_key).record_status, 'superseded');
  assert.deepEqual(db.prepare('SELECT status FROM sources WHERE source_key IN (?,?) ORDER BY source_key').all(oldSource.source_key, latestSource.source_key).map((row) => row.status), ['superseded', 'superseded']);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM ingestion_items WHERE ingestion_run_id=(SELECT id FROM ingestion_runs WHERE run_key=?) AND staged_json IS NOT NULL').get(committed.run_key).count, 0);
  assert.equal(commitIngestion(preview.run_key, {}, db).run_key, committed.run_key);

  const postedSourceKey = committed.result.posted_source_key;
  const postedSourceId = db.prepare('SELECT id FROM sources WHERE source_key=?').get(postedSourceKey).id;
  assert.equal(db.prepare('SELECT COUNT(*) count FROM transaction_sources WHERE transaction_id=? AND source_id=?').get(matchedId, postedSourceId).count, 1);
  const reverseResult = confirmedReverse(committed.run_key, db);
  assert.equal(reverseResult.reversed_items, 6);
  assert.equal(db.prepare('SELECT record_status FROM transactions WHERE transaction_key=?').get(matched.transaction_key).record_status, 'provisional');
  assert.equal(db.prepare('SELECT record_status FROM transactions WHERE transaction_key=?').get(released.transaction_key).record_status, 'provisional');
  assert.deepEqual(db.prepare('SELECT status FROM sources WHERE source_key IN (?,?) ORDER BY source_key').all(oldSource.source_key, latestSource.source_key).map((row) => row.status), ['active', 'active']);
  assert.equal(db.prepare('SELECT status FROM sources WHERE source_key=?').get(postedSourceKey).status, 'reversed');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM transaction_sources WHERE transaction_id=? AND source_id=?').get(matchedId, postedSourceId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM transactions WHERE ingestion_run_id=(SELECT id FROM ingestion_runs WHERE run_key=?) AND record_status='reversed'").get(committed.run_key).count, 1);
}));

test('ambiguous strong identity and unresolved release candidates fail closed', () => isolatedDb((db) => {
  const account = cardAccount(db);
  const source = currentSource(db, account.account_key, 'ambiguous', '2026-07-16');
  const first = provisional(db, account.account_key, source.source_key, null, 'SAME MERCHANT', '-10000');
  const second = provisional(db, account.account_key, source.source_key, null, 'same merchant', '-10000');
  const payload = {
    schema_id: 'finance.card-transaction-lifecycle/v1', idempotency_key: 'ambiguous-lifecycle',
    account_key: account.account_key, authority: 'official', reason: 'Synthetic ambiguity.',
    posted_source: {
      source_kind: 'credit_card_statement_csv', description: 'Synthetic ambiguous posted',
      period_start: '2026-06-20', period_end: '2026-07-19', is_official: true,
      authority: 'official', review_state: 'confirmed',
    },
    expected_rows_total_minor: '-10000',
    posted_rows: [{
      client_item_key: 'posted-ambiguous', occurrence_ordinal: 1, transaction_date: '2026-07-05',
      name: 'Same Merchant', amount_minor: '-10000', currency: 'TWD', flow_type: 'expense', category_primary: 'Synthetic expense',
    }],
    supersede_source_keys: [source.source_key], release_transaction_keys: [],
  };
  const preview = previewIngestion(payload, {}, db);
  assert.equal(preview.result.committable, false);
  assert.equal(preview.result.counts.ambiguous, 1);
  assert.equal(preview.result.counts.unresolved_release_candidates, 2);
  assert.deepEqual(new Set(preview.result.ambiguous[0].candidate_transaction_keys), new Set([first.transaction_key, second.transaction_key]));
  assert.throws(() => commitIngestion(preview.run_key, {}, db), (error) => error.code === 'REVIEW_REQUIRED');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM sources WHERE source_kind=?').get('credit_card_statement_csv').count, 0);
}));

test('explicit strong match plus explicit release resolves ambiguity in a new preview', () => isolatedDb((db) => {
  const account = cardAccount(db);
  const source = currentSource(db, account.account_key, 'explicit', '2026-07-16');
  const selected = provisional(db, account.account_key, source.source_key, null, 'SAME MERCHANT', '-10000');
  const released = provisional(db, account.account_key, source.source_key, null, 'same merchant', '-10000');
  const payload = {
    schema_id: 'finance.card-transaction-lifecycle/v1', idempotency_key: 'explicit-lifecycle',
    account_key: account.account_key, authority: 'official', reason: 'Synthetic explicit resolution.',
    posted_source: {
      source_kind: 'credit_card_statement_csv', description: 'Synthetic explicit posted',
      period_start: '2026-06-20', period_end: '2026-07-19', is_official: true,
      authority: 'official', review_state: 'confirmed',
    },
    expected_rows_total_minor: '-10000',
    posted_rows: [{
      client_item_key: 'posted-explicit', occurrence_ordinal: 1, match_transaction_key: selected.transaction_key,
      transaction_date: '2026-07-05', name: 'Same Merchant', amount_minor: '-10000', currency: 'TWD',
      flow_type: 'expense', category_primary: 'Synthetic expense',
    }],
    supersede_source_keys: [source.source_key], release_transaction_keys: [released.transaction_key],
  };
  const preview = previewIngestion(payload, {}, db);
  assert.equal(preview.result.committable, true);
  assert.equal(preview.result.matched[0].match_basis, 'explicit_strong_identity');
  const committed = commitIngestion(preview.run_key, {}, db);
  assert.equal(committed.result.counts.matched, 1);
  assert.equal(committed.result.counts.released, 1);
  assert.equal(db.prepare('SELECT record_status FROM transactions WHERE transaction_key=?').get(selected.transaction_key).record_status, 'posted');
  assert.equal(db.prepare('SELECT record_status FROM transactions WHERE transaction_key=?').get(released.transaction_key).record_status, 'superseded');
}));

test('an existing official posted source is referenced, and downstream statement ownership blocks reversal', () => isolatedDb((db) => {
  const account = cardAccount(db);
  const current = currentSource(db, account.account_key, 'existing-source', '2026-07-16');
  const transaction = provisional(db, account.account_key, current.source_key, 'AUTH-EXISTING', 'EXISTING SOURCE ROW', '-12500');
  const posted = createSource({
    source_kind: 'credit_card_statement_csv', description: 'Existing official posted source',
    account_key: account.account_key, period_start: '2026-06-20', period_end: '2026-07-19',
    is_official: true, authority: 'official', review_state: 'confirmed',
  }, {}, db);
  const payload = {
    schema_id: 'finance.card-transaction-lifecycle/v1', idempotency_key: 'existing-posted-source',
    account_key: account.account_key, authority: 'official', reason: 'Synthetic existing source.',
    posted_source_key: posted.source_key, expected_rows_total_minor: '-12500',
    posted_rows: [{
      client_item_key: 'existing-posted-row', occurrence_ordinal: 1, transaction_date: '2026-07-05',
      external_id: 'AUTH-EXISTING', name: 'Existing Source Row', amount_minor: '-12500', currency: 'TWD',
      flow_type: 'expense', category_primary: 'Synthetic expense',
    }],
    supersede_source_keys: [current.source_key], release_transaction_keys: [],
  };
  const committed = commitIngestion(previewIngestion(payload, {}, db).run_key, {}, db);
  assert.equal(committed.result.posted_source_key, posted.source_key);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM sources WHERE source_kind=?').get('credit_card_statement_csv').count, 1);
  assert.equal(db.prepare("SELECT canonical_resource_type FROM ingestion_items WHERE ingestion_run_id=(SELECT id FROM ingestion_runs WHERE run_key=?) AND client_item_key='lifecycle:header'").get(committed.run_key).canonical_resource_type, 'credit_card_lifecycle_source_reference');

  const profile = createCreditCardProfile({
    account_key: account.account_key, currency: 'TWD', authority: 'official', review_state: 'confirmed',
  }, {}, db);
  createCardStatement({
    profile_key: profile.profile_key, source_key: posted.source_key,
    period_start: '2026-06-20', period_end: '2026-07-19', close_date: '2026-07-19', due_date: '2026-08-08',
    statement_balance_minor: '12500', currency: 'TWD', authority: 'official', review_state: 'confirmed',
    items: [{ transaction_key: transaction.transaction_key, item_role: 'charge' }],
  }, {}, db);
  const impact = reversePreview(committed.run_key, db);
  assert.equal(impact.reversible, false);
  assert.ok(impact.blockers.some((item) => item.reason === 'lifecycle_match_has_downstream_statement_owner'));
  assert.equal(db.prepare('SELECT status FROM sources WHERE source_key=?').get(posted.source_key).status, 'active');
}));
