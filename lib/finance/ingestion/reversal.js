const { createHash } = require('node:crypto');
const { FinanceError, requiredString } = require('../contracts');
const { canonicalJson } = require('../../queries/finance/human-confirmations');
const { getDb, stableKey, logChange, requireRow, withTransaction } = require('../../queries/finance/common');
const { isConfirmationAuthorization } = require('../../queries/finance/authorization');

function impactHash(impact) { return createHash('sha256').update(canonicalJson(impact)).digest('hex'); }

function reversePreview(runKey, db = getDb()) {
  const run = requireRow(db.prepare('SELECT * FROM ingestion_runs WHERE run_key=?').get(runKey), 'Ingestion run');
  if (run.status !== 'committed') throw new FinanceError('VERSION_CONFLICT', 'Only committed runs can be reversed', { status: 409 });
  const items = db.prepare('SELECT canonical_resource_type,canonical_resource_key FROM ingestion_items WHERE ingestion_run_id=? AND status=? ORDER BY id').all(run.id, 'committed');
  const blockers = [];
  for (const item of items) {
    if (item.canonical_resource_type === 'cash_transaction') {
      const transaction = db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(item.canonical_resource_key);
      if (transaction && (transaction.reviewed || transaction.classification_source === 'human' || db.prepare('SELECT 1 FROM correction_log WHERE transaction_id=? LIMIT 1').get(transaction.id))) blockers.push({ resource_type: item.canonical_resource_type, resource_key: item.canonical_resource_key, reason: 'human_evidence_requires_manual_resolution' });
    }
    if (item.canonical_resource_type === 'account') {
      const account = db.prepare('SELECT * FROM accounts WHERE account_key=?').get(item.canonical_resource_key);
      if (account && db.prepare("SELECT 1 FROM transactions WHERE account_id=? AND COALESCE(ingestion_run_id,0)<>? AND COALESCE(record_status,'posted') NOT IN ('reversed','superseded','archived') LIMIT 1").get(account.id, run.id)) blockers.push({ resource_type: 'account', resource_key: item.canonical_resource_key, reason: 'account_has_facts_outside_run' });
      if (account && db.prepare("SELECT 1 FROM account_balance_snapshots WHERE account_id=? AND COALESCE(ingestion_run_id,0)<>? AND record_status NOT IN ('reversed','superseded','archived') LIMIT 1").get(account.id, run.id)) blockers.push({ resource_type: 'account', resource_key: item.canonical_resource_key, reason: 'account_has_balances_outside_run' });
      if (account && db.prepare("SELECT 1 FROM sources WHERE account_id=? AND COALESCE(ingestion_run_id,0)<>? AND status='active' LIMIT 1").get(account.id, run.id)) blockers.push({ resource_type: 'account', resource_key: item.canonical_resource_key, reason: 'account_has_sources_outside_run' });
    }
    if (item.canonical_resource_type === 'source') {
      const source = db.prepare('SELECT * FROM sources WHERE source_key=?').get(item.canonical_resource_key);
      if (source && db.prepare('SELECT 1 FROM transaction_sources ts JOIN transactions t ON t.id=ts.transaction_id WHERE ts.source_id=? AND COALESCE(t.ingestion_run_id,0)<>? LIMIT 1').get(source.id, run.id)) blockers.push({ resource_type: 'source', resource_key: item.canonical_resource_key, reason: 'source_has_facts_outside_run' });
      if (source && db.prepare("SELECT 1 FROM account_balance_snapshots WHERE source_id=? AND COALESCE(ingestion_run_id,0)<>? AND record_status NOT IN ('reversed','superseded','archived') LIMIT 1").get(source.id, run.id)) blockers.push({ resource_type: 'source', resource_key: item.canonical_resource_key, reason: 'source_has_balances_outside_run' });
    }
  }
  const impact = { run_key: runKey, item_count: items.length, resources: items, blockers };
  return { ...impact, reversible: blockers.length === 0, impact_hash: impactHash(impact) };
}

function reverseIngestion(runKey, payload, actor = {}, db = getDb(), authorization = null, now = new Date()) {
  if (!isConfirmationAuthorization(authorization, 'reverse_ingestion_run')) throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'A confirmed one-time receipt is required', { status: 403 });
  const reason = requiredString(payload.reason, 'reason', 1000); const preview = reversePreview(runKey, db);
  if (!preview.reversible) throw new FinanceError('REVIEW_REQUIRED', 'Reversal has unresolved blockers', { status: 409 });
  if (payload.impact_hash !== preview.impact_hash) throw new FinanceError('VERSION_CONFLICT', 'Reversal impact changed; preview again', { status: 409 });
  return withTransaction(db, () => {
    const original = requireRow(db.prepare('SELECT * FROM ingestion_runs WHERE run_key=?').get(runKey), 'Ingestion run');
    const reversalKey = stableKey();
    const result = db.prepare(`INSERT INTO ingestion_runs(run_key,idempotency_key,payload_hash,schema_id,bundle_kind,authority,reason,status,committed_at,reversal_of_run_id,result_json)
      VALUES(?,?,?,?,?,?,?,'committed',?,?,?)`).run(reversalKey, `reverse:${runKey}:${payload.impact_hash}`, payload.impact_hash, original.schema_id, original.bundle_kind, 'user_confirmed', reason, now.toISOString(), original.id, JSON.stringify({ reversed_run_key: runKey, item_count: preview.item_count }));
    const reversalId = Number(result.lastInsertRowid);
    const items = db.prepare('SELECT * FROM ingestion_items WHERE ingestion_run_id=? AND status=? ORDER BY id DESC').all(original.id, 'committed');
    for (const item of items) {
      if (item.canonical_resource_type === 'cash_transaction') db.prepare("UPDATE transactions SET record_status='reversed',reversed_by_run_id=?,updated_at=? WHERE transaction_key=?").run(reversalId, now.toISOString(), item.canonical_resource_key);
      if (item.canonical_resource_type === 'balance_snapshot') db.prepare("UPDATE account_balance_snapshots SET record_status='reversed',reversed_by_run_id=?,version=version+1,updated_at=? WHERE snapshot_key=?").run(reversalId, now.toISOString(), item.canonical_resource_key);
      if (item.canonical_resource_type === 'source') db.prepare("UPDATE sources SET status='reversed',reversed_by_run_id=?,version=version+1,updated_at=? WHERE source_key=?").run(reversalId, now.toISOString(), item.canonical_resource_key);
      if (item.canonical_resource_type === 'account') db.prepare("UPDATE accounts SET active=0,included_in_analysis=0,review_state='rejected',reversed_by_run_id=?,version=version+1,updated_at=? WHERE account_key=?").run(reversalId, now.toISOString(), item.canonical_resource_key);
      db.prepare("UPDATE ingestion_items SET status='reversed' WHERE id=?").run(item.id);
    }
    db.prepare("UPDATE ingestion_run_contexts SET status='reversed' WHERE ingestion_run_id=?").run(original.id);
    db.prepare("UPDATE ingestion_runs SET status='reversed',reversed_at=?,updated_at=? WHERE id=?").run(now.toISOString(), now.toISOString(), original.id);
    logChange(db, { resourceType: 'ingestion_run', resourceKey: runKey, action: 'reverse', before: { status: original.status }, after: { status: 'reversed', reversal_run_key: reversalKey, reason }, actorType: actor.type, actorNote: actor.note });
    return { reversed_run_key: runKey, reversal_run_key: reversalKey, reversed_items: items.length };
  });
}

module.exports = { reversePreview, reverseIngestion };
