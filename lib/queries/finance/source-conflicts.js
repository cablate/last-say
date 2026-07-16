const { FinanceError, requiredString, enumValue, optionalString } = require('../../finance/contracts');
const { createReviewTask, resolveReviewTask } = require('./review-tasks');
const { getDb, stableKey, logChange, requireRow, withTransaction } = require('./common');

function projection() {
  return `SELECT c.*,l.source_key AS left_source_key,r.source_key AS right_source_key,s.source_key AS selected_source_key
    FROM source_conflicts c JOIN sources l ON l.id=c.left_source_id JOIN sources r ON r.id=c.right_source_id
    LEFT JOIN sources s ON s.id=c.selected_source_id`;
}

function getSourceConflict(key, db = getDb()) { return requireRow(db.prepare(`${projection()} WHERE c.conflict_key=?`).get(key), 'Source conflict'); }
function listSourceConflicts({ status = 'open' } = {}, db = getDb()) { enumValue(status, 'source_conflict_status', 'status'); return db.prepare(`${projection()} WHERE c.status=? ORDER BY c.created_at,c.id`).all(status); }

function createSourceConflict(input, actor = {}, db = getDb()) {
  const left = requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(input.left_source_key), 'Left source');
  const right = requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(input.right_source_key), 'Right source');
  if (left.id === right.id) throw new FinanceError('VALIDATION_ERROR', 'Conflict sources must differ');
  const reason = requiredString(input.reason, 'reason', 1000);
  const impactNote = optionalString(input.impact_note, 'impact_note', 1000);
  const [first, second] = left.id < right.id ? [left, right] : [right, left]; const key = stableKey();
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO source_conflicts(conflict_key,target_context,semantic_key,left_source_id,right_source_id,authority,review_state,reason,impact_note)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(key, enumValue(input.target_context, 'target_context', 'target_context'), requiredString(input.semantic_key, 'semantic_key', 300), first.id, second.id, enumValue(input.authority, 'authority', 'authority'), enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'), reason, impactNote);
    const row = getSourceConflict(key, db);
    createReviewTask({ task_kind: 'source_conflict', resource_type: 'source_conflict', resource_key: key, source_conflict_id: row.id, priority: 90, reason }, db);
    logChange(db, { resourceType: 'source_conflict', resourceKey: key, action: 'create', after: row, actorType: actor.type, actorNote: actor.note }); return row;
  });
}

function resolveSourceConflict(key, input, actor = {}, db = getDb()) {
  return withTransaction(db, () => {
    const before = getSourceConflict(key, db); if (before.status !== 'open') throw new FinanceError('VERSION_CONFLICT', 'Source conflict is no longer open', { status: 409 });
    const selected = requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(input.selected_source_key), 'Selected source');
    if (![before.left_source_id, before.right_source_id].includes(selected.id)) throw new FinanceError('VALIDATION_ERROR', 'Selected source must be one of the conflict candidates', { field: 'selected_source_key' });
    const note = optionalString(input.resolution_note, 'resolution_note', 1000); if (!note) throw new FinanceError('VALIDATION_ERROR', 'resolution_note is required', { field: 'resolution_note' });
    db.prepare(`UPDATE source_conflicts SET status='resolved',selected_source_id=?,resolution_note=?,resolved_at=CURRENT_TIMESTAMP,authority='user_confirmed',review_state='confirmed' WHERE id=?`).run(selected.id, note, before.id);
    const task = db.prepare("SELECT task_key FROM review_tasks WHERE source_conflict_id=? AND status='open'").get(before.id);
    if (!task) throw new FinanceError('REVIEW_REQUIRED', 'Source conflict has no open review task', { status: 409 });
    resolveReviewTask(task.task_key, { status: 'resolved', resolution_source_key: selected.source_key, resolution_note: note }, actor, db, { typedOwner: true });
    const after = getSourceConflict(key, db); logChange(db, { resourceType: 'source_conflict', resourceKey: key, action: 'resolve', before, after, actorType: actor.type, actorNote: actor.note }); return after;
  });
}

module.exports = { getSourceConflict, listSourceConflicts, createSourceConflict, resolveSourceConflict };
