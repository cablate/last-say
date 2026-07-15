const { createHash } = require('node:crypto');
const { FinanceError, requiredString } = require('../contracts');
const { canonicalJson } = require('../../queries/finance/human-confirmations');
const { getDb, stableKey, logChange, requireRow, withTransaction } = require('../../queries/finance/common');
const { isConfirmationAuthorization } = require('../../queries/finance/authorization');
const { classificationSnapshot } = require('../../queries/finance/cash-activity');

const SAFE_REVERSAL_TYPES = new Set([
  'cash_transaction_classification', 'cash_transaction', 'balance_snapshot',
  'source', 'account', 'reimbursement_match',
  'credit_card_profile', 'credit_card_statement', 'credit_card_installment_plan',
  'credit_card_payment_match', 'liability_profile', 'loan_schedule_batch',
  'loan_payment_allocation', 'commitment', 'commitment_occurrence',
]);
const ACTIVE_SQL = "NOT IN ('reversed','superseded','archived')";

function addBlocker(blockers, item, reason) {
  blockers.push({ resource_type: item.canonical_resource_type, resource_key: item.canonical_resource_key, reason });
}

function obligationReversalBlockers(item, run, db, blockers) {
  const key = item.canonical_resource_key;
  if (item.canonical_resource_type === 'credit_card_profile') {
    const row = db.prepare('SELECT * FROM credit_card_profiles WHERE profile_key=?').get(key);
    if (!row || row.record_status !== 'posted' || row.ingestion_run_id !== run.id) return addBlocker(blockers, item, 'obligation_lifecycle_evidence_missing');
    if (row.version > 1) addBlocker(blockers, item, 'obligation_changed_after_run');
    if (!db.prepare('SELECT 1 FROM accounts WHERE id=? AND ingestion_run_id=?').get(row.account_id, run.id)) addBlocker(blockers, item, 'reversal_would_strand_unique_identity');
    if (db.prepare(`SELECT 1 FROM credit_card_statements WHERE profile_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(row.id, run.id)
      || db.prepare(`SELECT 1 FROM credit_card_installment_plans WHERE profile_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(row.id, run.id)) addBlocker(blockers, item, 'obligation_has_facts_outside_run');
  }
  if (item.canonical_resource_type === 'credit_card_statement') {
    const row = db.prepare('SELECT * FROM credit_card_statements WHERE statement_key=?').get(key);
    if (!row || row.record_status !== 'posted' || row.ingestion_run_id !== run.id) return addBlocker(blockers, item, 'obligation_lifecycle_evidence_missing');
    const profileOwned = db.prepare('SELECT 1 FROM credit_card_profiles WHERE id=? AND ingestion_run_id=?').get(row.profile_id, run.id);
    const sourceOwned = db.prepare('SELECT 1 FROM sources WHERE id=? AND ingestion_run_id=?').get(row.source_id, run.id);
    if (!profileOwned && !sourceOwned) addBlocker(blockers, item, 'reversal_would_strand_unique_identity');
    if (db.prepare(`SELECT 1 FROM credit_card_payment_matches WHERE statement_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(row.id, run.id)) addBlocker(blockers, item, 'obligation_has_facts_outside_run');
  }
  if (item.canonical_resource_type === 'credit_card_installment_plan') {
    const row = db.prepare('SELECT * FROM credit_card_installment_plans WHERE plan_key=?').get(key);
    if (!row || row.record_status !== 'posted' || row.ingestion_run_id !== run.id) addBlocker(blockers, item, 'obligation_lifecycle_evidence_missing');
  }
  if (item.canonical_resource_type === 'credit_card_payment_match') {
    const row = db.prepare('SELECT * FROM credit_card_payment_matches WHERE match_key=?').get(key);
    if (!row || row.record_status !== 'posted' || row.ingestion_run_id !== run.id) return addBlocker(blockers, item, 'obligation_lifecycle_evidence_missing');
    const statementOwned = db.prepare('SELECT 1 FROM credit_card_statements WHERE id=? AND ingestion_run_id=?').get(row.statement_id, run.id);
    const transactionOwned = db.prepare('SELECT 1 FROM transactions WHERE id=? AND ingestion_run_id=?').get(row.transaction_id, run.id);
    if (!statementOwned && !transactionOwned) addBlocker(blockers, item, 'reversal_would_strand_unique_identity');
  }
  if (item.canonical_resource_type === 'liability_profile') {
    const row = db.prepare('SELECT * FROM liability_profiles WHERE liability_key=?').get(key);
    if (!row || row.record_status !== 'posted' || row.ingestion_run_id !== run.id) return addBlocker(blockers, item, 'obligation_lifecycle_evidence_missing');
    if (row.version > 1) addBlocker(blockers, item, 'obligation_changed_after_run');
    if (!db.prepare('SELECT 1 FROM accounts WHERE id=? AND ingestion_run_id=?').get(row.account_id, run.id)) addBlocker(blockers, item, 'reversal_would_strand_unique_identity');
    if (db.prepare(`SELECT 1 FROM loan_schedule_entries WHERE liability_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(row.id, run.id)) addBlocker(blockers, item, 'obligation_has_facts_outside_run');
  }
  if (item.canonical_resource_type === 'loan_schedule_batch') {
    const rows = db.prepare(`SELECT s.*,l.ingestion_run_id liability_run_id FROM loan_schedule_entries s JOIN liability_profiles l ON l.id=s.liability_id
      WHERE s.ingestion_run_id=? AND s.record_status ${ACTIVE_SQL}`).all(run.id);
    if (!rows.length) return addBlocker(blockers, item, 'obligation_lifecycle_evidence_missing');
    if (rows.some((row) => row.liability_run_id !== run.id)) addBlocker(blockers, item, 'reversal_would_strand_unique_identity');
    if (rows.some((row) => db.prepare(`SELECT 1 FROM loan_payment_allocations WHERE schedule_entry_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(row.id, run.id))) addBlocker(blockers, item, 'obligation_has_facts_outside_run');
  }
  if (item.canonical_resource_type === 'loan_payment_allocation') {
    const row = db.prepare('SELECT * FROM loan_payment_allocations WHERE allocation_key=?').get(key);
    if (!row || row.record_status !== 'posted' || row.ingestion_run_id !== run.id) return addBlocker(blockers, item, 'obligation_lifecycle_evidence_missing');
    const scheduleOwned = db.prepare('SELECT 1 FROM loan_schedule_entries WHERE id=? AND ingestion_run_id=?').get(row.schedule_entry_id, run.id);
    const transactionOwned = db.prepare('SELECT 1 FROM transactions WHERE id=? AND ingestion_run_id=?').get(row.transaction_id, run.id);
    if (!scheduleOwned && !transactionOwned) addBlocker(blockers, item, 'reversal_would_strand_unique_identity');
  }
  if (item.canonical_resource_type === 'commitment') {
    const row = db.prepare('SELECT * FROM commitment_templates WHERE commitment_key=?').get(key);
    if (!row || row.record_status !== 'posted' || row.ingestion_run_id !== run.id) return addBlocker(blockers, item, 'obligation_lifecycle_evidence_missing');
    if (row.version > 1) addBlocker(blockers, item, 'obligation_changed_after_run');
    if (db.prepare(`SELECT 1 FROM commitment_occurrences WHERE commitment_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(row.id, run.id)) addBlocker(blockers, item, 'obligation_has_facts_outside_run');
  }
  if (item.canonical_resource_type === 'commitment_occurrence') {
    const row = db.prepare('SELECT * FROM commitment_occurrences WHERE occurrence_key=?').get(key);
    if (!row || row.record_status !== 'posted' || row.ingestion_run_id !== run.id) return addBlocker(blockers, item, 'obligation_lifecycle_evidence_missing');
    if (!db.prepare('SELECT 1 FROM commitment_templates WHERE id=? AND ingestion_run_id=?').get(row.commitment_id, run.id)) addBlocker(blockers, item, 'reversal_would_strand_unique_identity');
  }
}

function impactHash(impact) { return createHash('sha256').update(canonicalJson(impact)).digest('hex'); }

function classificationChange(runKey, transactionKey, db) {
  return db.prepare(`SELECT * FROM data_change_log
    WHERE resource_type='cash_transaction_classification' AND resource_key=? AND action='ai_classify'
      AND json_extract(after_json, '$.ingestion_run_key')=?
    ORDER BY id DESC LIMIT 1`).get(transactionKey, runKey);
}

function comparableClassification(value) {
  if (!value) return null;
  const { ingestion_run_key: _runKey, ...classification } = value;
  return classification;
}

function currentComparableClassification(transaction, expected) {
  const current = { ...classificationSnapshot(transaction), flow_type: transaction.flow_type };
  return Object.fromEntries(Object.keys(expected).map((key) => [key, current[key]]));
}

function reversePreview(runKey, db = getDb()) {
  const run = requireRow(db.prepare('SELECT * FROM ingestion_runs WHERE run_key=?').get(runKey), 'Ingestion run');
  if (run.status !== 'committed') throw new FinanceError('VERSION_CONFLICT', 'Only committed runs can be reversed', { status: 409 });
  const items = db.prepare('SELECT canonical_resource_type,canonical_resource_key FROM ingestion_items WHERE ingestion_run_id=? AND status=? ORDER BY id').all(run.id, 'committed');
  const blockers = [];
  for (const item of items) {
    if (!SAFE_REVERSAL_TYPES.has(item.canonical_resource_type)) {
      blockers.push({ resource_type: item.canonical_resource_type, resource_key: item.canonical_resource_key, reason: 'typed_reversal_owner_missing' });
      continue;
    }
    obligationReversalBlockers(item, run, db, blockers);
    if (item.canonical_resource_type === 'cash_transaction_classification') {
      const transaction = db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(item.canonical_resource_key);
      const change = classificationChange(runKey, item.canonical_resource_key, db);
      if (!transaction || !change) {
        blockers.push({ resource_type: item.canonical_resource_type, resource_key: item.canonical_resource_key, reason: 'classification_audit_evidence_missing' });
      } else {
        const expected = comparableClassification(JSON.parse(change.after_json));
        const current = currentComparableClassification(transaction, expected);
        if (canonicalJson(current) !== canonicalJson(expected)) blockers.push({ resource_type: item.canonical_resource_type, resource_key: item.canonical_resource_key, reason: 'classification_changed_after_run' });
      }
    }
    if (item.canonical_resource_type === 'cash_transaction') {
      const transaction = db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(item.canonical_resource_key);
      if (transaction && (transaction.reviewed || transaction.classification_source === 'human' || db.prepare('SELECT 1 FROM correction_log WHERE transaction_id=? LIMIT 1').get(transaction.id))) blockers.push({ resource_type: item.canonical_resource_type, resource_key: item.canonical_resource_key, reason: 'human_evidence_requires_manual_resolution' });
    }
    if (item.canonical_resource_type === 'account') {
      const account = db.prepare('SELECT * FROM accounts WHERE account_key=?').get(item.canonical_resource_key);
      if (account && db.prepare("SELECT 1 FROM transactions WHERE account_id=? AND COALESCE(ingestion_run_id,0)<>? AND COALESCE(record_status,'posted') NOT IN ('reversed','superseded','archived') LIMIT 1").get(account.id, run.id)) blockers.push({ resource_type: 'account', resource_key: item.canonical_resource_key, reason: 'account_has_facts_outside_run' });
      if (account && db.prepare("SELECT 1 FROM account_balance_snapshots WHERE account_id=? AND COALESCE(ingestion_run_id,0)<>? AND record_status NOT IN ('reversed','superseded','archived') LIMIT 1").get(account.id, run.id)) blockers.push({ resource_type: 'account', resource_key: item.canonical_resource_key, reason: 'account_has_balances_outside_run' });
      if (account && db.prepare("SELECT 1 FROM sources WHERE account_id=? AND COALESCE(ingestion_run_id,0)<>? AND status='active' LIMIT 1").get(account.id, run.id)) blockers.push({ resource_type: 'account', resource_key: item.canonical_resource_key, reason: 'account_has_sources_outside_run' });
      if (account && db.prepare(`SELECT 1 FROM credit_card_profiles WHERE account_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(account.id, run.id)) blockers.push({ resource_type: 'account', resource_key: item.canonical_resource_key, reason: 'account_has_obligations_outside_run' });
      if (account && db.prepare(`SELECT 1 FROM liability_profiles WHERE account_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(account.id, run.id)) blockers.push({ resource_type: 'account', resource_key: item.canonical_resource_key, reason: 'account_has_obligations_outside_run' });
      if (account && db.prepare(`SELECT 1 FROM commitment_templates WHERE account_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(account.id, run.id)) blockers.push({ resource_type: 'account', resource_key: item.canonical_resource_key, reason: 'account_has_obligations_outside_run' });
    }
    if (item.canonical_resource_type === 'source') {
      const source = db.prepare('SELECT * FROM sources WHERE source_key=?').get(item.canonical_resource_key);
      if (source && db.prepare('SELECT 1 FROM transaction_sources ts JOIN transactions t ON t.id=ts.transaction_id WHERE ts.source_id=? AND COALESCE(t.ingestion_run_id,0)<>? LIMIT 1').get(source.id, run.id)) blockers.push({ resource_type: 'source', resource_key: item.canonical_resource_key, reason: 'source_has_facts_outside_run' });
      if (source && db.prepare("SELECT 1 FROM account_balance_snapshots WHERE source_id=? AND COALESCE(ingestion_run_id,0)<>? AND record_status NOT IN ('reversed','superseded','archived') LIMIT 1").get(source.id, run.id)) blockers.push({ resource_type: 'source', resource_key: item.canonical_resource_key, reason: 'source_has_balances_outside_run' });
      if (source && db.prepare(`SELECT 1 FROM credit_card_statements WHERE source_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(source.id, run.id)) blockers.push({ resource_type: 'source', resource_key: item.canonical_resource_key, reason: 'source_has_obligations_outside_run' });
      if (source && db.prepare(`SELECT 1 FROM credit_card_installment_plans WHERE source_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(source.id, run.id)) blockers.push({ resource_type: 'source', resource_key: item.canonical_resource_key, reason: 'source_has_obligations_outside_run' });
      if (source && db.prepare(`SELECT 1 FROM liability_profiles WHERE source_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(source.id, run.id)) blockers.push({ resource_type: 'source', resource_key: item.canonical_resource_key, reason: 'source_has_obligations_outside_run' });
      if (source && db.prepare(`SELECT 1 FROM loan_schedule_entries WHERE source_id=? AND record_status ${ACTIVE_SQL} AND COALESCE(ingestion_run_id,0)<>? LIMIT 1`).get(source.id, run.id)) blockers.push({ resource_type: 'source', resource_key: item.canonical_resource_key, reason: 'source_has_obligations_outside_run' });
    }
    if (item.canonical_resource_type === 'reimbursement_match') {
      const match = db.prepare('SELECT match_status FROM reimbursement_matches WHERE match_key=?').get(item.canonical_resource_key);
      if (!match) blockers.push({ resource_type: item.canonical_resource_type, resource_key: item.canonical_resource_key, reason: 'reimbursement_match_missing' });
      if (match && match.match_status !== 'proposed') blockers.push({ resource_type: item.canonical_resource_type, resource_key: item.canonical_resource_key, reason: 'reimbursement_match_changed_after_run' });
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
      if (item.canonical_resource_type === 'cash_transaction_classification') {
        const change = classificationChange(runKey, item.canonical_resource_key, db);
        const before = JSON.parse(change.before_json);
        const transaction = requireRow(db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(item.canonical_resource_key), 'Transaction');
        const current = { ...classificationSnapshot(transaction), ...(Object.hasOwn(before, 'flow_type') ? { flow_type: transaction.flow_type } : {}) };
        db.prepare(`UPDATE transactions SET category_primary=?,category_sub=?,flow_type=?,ai_confidence=?,judgment_reason=?,classification_source=?,rule_id=?,reviewed=?,updated_at=? WHERE transaction_key=?`).run(
          before.category_primary, before.category_sub, Object.hasOwn(before, 'flow_type') ? before.flow_type : transaction.flow_type, before.ai_confidence, before.judgment_reason, before.classification_source,
          before.rule_id, before.reviewed, now.toISOString(), item.canonical_resource_key,
        );
        const restored = requireRow(db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(item.canonical_resource_key), 'Transaction');
        logChange(db, {
          resourceType: 'cash_transaction_classification', resourceKey: item.canonical_resource_key, action: 'reverse_ai_classify',
          before: current, after: { ...classificationSnapshot(restored), ...(Object.hasOwn(before, 'flow_type') ? { flow_type: restored.flow_type } : {}), reversed_ingestion_run_key: runKey },
          actorType: actor.type, actorNote: actor.note,
        });
      }
      if (item.canonical_resource_type === 'cash_transaction') db.prepare("UPDATE transactions SET record_status='reversed',reversed_by_run_id=?,updated_at=? WHERE transaction_key=?").run(reversalId, now.toISOString(), item.canonical_resource_key);
      if (item.canonical_resource_type === 'balance_snapshot') db.prepare("UPDATE account_balance_snapshots SET record_status='reversed',reversed_by_run_id=?,version=version+1,updated_at=? WHERE snapshot_key=?").run(reversalId, now.toISOString(), item.canonical_resource_key);
      if (item.canonical_resource_type === 'source') db.prepare("UPDATE sources SET status='reversed',reversed_by_run_id=?,version=version+1,updated_at=? WHERE source_key=?").run(reversalId, now.toISOString(), item.canonical_resource_key);
      if (item.canonical_resource_type === 'account') db.prepare("UPDATE accounts SET active=0,included_in_analysis=0,review_state='rejected',reversed_by_run_id=?,version=version+1,updated_at=? WHERE account_key=?").run(reversalId, now.toISOString(), item.canonical_resource_key);
      if (item.canonical_resource_type === 'credit_card_profile') db.prepare("UPDATE credit_card_profiles SET record_status='reversed',reversed_by_run_id=?,version=version+1,updated_at=? WHERE profile_key=? AND ingestion_run_id=?").run(reversalId, now.toISOString(), item.canonical_resource_key, original.id);
      if (item.canonical_resource_type === 'credit_card_statement') db.prepare("UPDATE credit_card_statements SET record_status='reversed',reversed_by_run_id=?,version=version+1,updated_at=? WHERE statement_key=? AND ingestion_run_id=?").run(reversalId, now.toISOString(), item.canonical_resource_key, original.id);
      if (item.canonical_resource_type === 'credit_card_installment_plan') db.prepare("UPDATE credit_card_installment_plans SET record_status='reversed',reversed_by_run_id=?,version=version+1,updated_at=? WHERE plan_key=? AND ingestion_run_id=?").run(reversalId, now.toISOString(), item.canonical_resource_key, original.id);
      if (item.canonical_resource_type === 'credit_card_payment_match') db.prepare("UPDATE credit_card_payment_matches SET record_status='reversed',reversed_by_run_id=? WHERE match_key=? AND ingestion_run_id=?").run(reversalId, item.canonical_resource_key, original.id);
      if (item.canonical_resource_type === 'liability_profile') db.prepare("UPDATE liability_profiles SET record_status='reversed',reversed_by_run_id=?,version=version+1,updated_at=? WHERE liability_key=? AND ingestion_run_id=?").run(reversalId, now.toISOString(), item.canonical_resource_key, original.id);
      if (item.canonical_resource_type === 'loan_schedule_batch') db.prepare("UPDATE loan_schedule_entries SET record_status='reversed',reversed_by_run_id=? WHERE ingestion_run_id=? AND record_status NOT IN ('reversed','superseded','archived')").run(reversalId, original.id);
      if (item.canonical_resource_type === 'loan_payment_allocation') db.prepare("UPDATE loan_payment_allocations SET record_status='reversed',reversed_by_run_id=? WHERE allocation_key=? AND ingestion_run_id=?").run(reversalId, item.canonical_resource_key, original.id);
      if (item.canonical_resource_type === 'commitment') db.prepare("UPDATE commitment_templates SET record_status='reversed',reversed_by_run_id=?,version=version+1,updated_at=? WHERE commitment_key=? AND ingestion_run_id=?").run(reversalId, now.toISOString(), item.canonical_resource_key, original.id);
      if (item.canonical_resource_type === 'commitment_occurrence') db.prepare("UPDATE commitment_occurrences SET record_status='reversed',reversed_by_run_id=? WHERE occurrence_key=? AND ingestion_run_id=?").run(reversalId, item.canonical_resource_key, original.id);
      if (item.canonical_resource_type === 'reimbursement_match') {
        db.prepare("UPDATE reimbursement_matches SET match_status='rejected',review_state='rejected',version=version+1,updated_at=? WHERE match_key=?").run(now.toISOString(), item.canonical_resource_key);
        db.prepare("UPDATE review_tasks SET status='dismissed',resolution_note=?,resolved_at=?,updated_at=? WHERE task_kind='reimbursement_match' AND resource_key=? AND status='open'")
          .run(`Reversed with ingestion run ${runKey}: ${reason}`, now.toISOString(), now.toISOString(), item.canonical_resource_key);
      }
      db.prepare("UPDATE ingestion_items SET status='reversed' WHERE id=?").run(item.id);
    }
    db.prepare("UPDATE ingestion_run_contexts SET status='reversed' WHERE ingestion_run_id=?").run(original.id);
    db.prepare("UPDATE ingestion_runs SET status='reversed',reversed_at=?,updated_at=? WHERE id=?").run(now.toISOString(), now.toISOString(), original.id);
    logChange(db, { resourceType: 'ingestion_run', resourceKey: runKey, action: 'reverse', before: { status: original.status }, after: { status: 'reversed', reversal_run_key: reversalKey, reason }, actorType: actor.type, actorNote: actor.note });
    return { reversed_run_key: runKey, reversal_run_key: reversalKey, reversed_items: items.length };
  });
}

module.exports = { reversePreview, reverseIngestion };
