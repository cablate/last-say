const { FinanceError, requiredString, enumValue, optionalString } = require('../../finance/contracts');
const { getDb, stableKey, logChange, requireRow, withTransaction } = require('./common');

function projection() {
  return `SELECT t.*,c.conflict_key,s.source_key AS resolution_source_key
    FROM review_tasks t LEFT JOIN source_conflicts c ON c.id=t.source_conflict_id
    LEFT JOIN sources s ON s.id=t.resolution_source_id`;
}

function getReviewTask(key, db = getDb()) {
  return requireRow(db.prepare(`${projection()} WHERE t.task_key=?`).get(key), 'Review task');
}

function listReviewTasks({ status = 'open' } = {}, db = getDb()) {
  enumValue(status, 'review_task_status', 'status');
  return db.prepare(`${projection()} WHERE t.status=? ORDER BY t.priority DESC,t.created_at,t.id`).all(status);
}

function createReviewTask(input, db = getDb()) {
  const kind = enumValue(input.task_kind, 'review_task_kind', 'task_kind');
  const resourceType = requiredString(input.resource_type, 'resource_type', 80);
  const resourceKey = requiredString(input.resource_key, 'resource_key', 160);
  const reason = requiredString(input.reason, 'reason', 1000);
  const priority = Number(input.priority ?? 50);
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new FinanceError('VALIDATION_ERROR', 'priority must be an integer from 0 to 100', { field: 'priority' });
  const existing = db.prepare('SELECT * FROM review_tasks WHERE task_kind=? AND resource_type=? AND resource_key=?').get(kind, resourceType, resourceKey);
  if (existing) return getReviewTask(existing.task_key, db);
  const key = stableKey();
  db.prepare(`INSERT INTO review_tasks(task_key,task_kind,resource_type,resource_key,source_conflict_id,status,priority,reason)
    VALUES(?,?,?,?,?,'open',?,?)`).run(key, kind, resourceType, resourceKey, input.source_conflict_id || null, priority, reason);
  return getReviewTask(key, db);
}

const TYPED_OWNER_TASKS = new Set([
  'source_conflict',
  'transfer_match',
  'reimbursement_match',
  'commitment_candidate',
  'valuation',
  'identity_conflict',
]);

function resolveReviewTask(key, input, actor = {}, db = getDb(), options = {}) {
  return withTransaction(db, () => {
    const before = getReviewTask(key, db);
    if (before.status !== 'open') throw new FinanceError('VERSION_CONFLICT', 'Review task is no longer open', { status: 409 });
    if (TYPED_OWNER_TASKS.has(before.task_kind) && options.typedOwner !== true) {
      throw new FinanceError('REVIEW_REQUIRED', 'This review must be resolved through its typed resource owner', {
        status: 409,
        task_kind: before.task_kind,
        resource_type: before.resource_type,
        resource_key: before.resource_key,
      });
    }
    const status = enumValue(input.status, 'review_task_status', 'status');
    if (status === 'open') throw new FinanceError('VALIDATION_ERROR', 'Resolution status must close the task', { field: 'status' });
    let source = null;
    if (input.resolution_source_key) source = requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(input.resolution_source_key), 'Resolution source');
    if (before.task_kind === 'source_conflict' && status === 'resolved' && !source) throw new FinanceError('SOURCE_REQUIRED', 'Source conflict resolution requires human evidence', { field: 'resolution_source_key' });
    const note = optionalString(input.resolution_note, 'resolution_note', 1000);
    if (!note) throw new FinanceError('VALIDATION_ERROR', 'resolution_note is required', { field: 'resolution_note' });
    db.prepare(`UPDATE review_tasks SET status=?,resolution_source_id=?,resolution_note=?,resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status, source?.id || null, note, before.id);
    const after = getReviewTask(key, db);
    logChange(db, { resourceType: 'review_task', resourceKey: key, action: status, before, after, actorType: actor.type, actorNote: actor.note });
    return after;
  });
}

module.exports = { getReviewTask, listReviewTasks, createReviewTask, resolveReviewTask };
