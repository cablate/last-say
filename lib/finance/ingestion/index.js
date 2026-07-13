const { createHash } = require('node:crypto');
const { FinanceError, assertObject, rejectUnknown, requiredString, enumValue } = require('../contracts');
const { canonicalJson } = require('../../queries/finance/human-confirmations');
const { getDb, stableKey, logChange, withTransaction, requireRow } = require('../../queries/finance/common');
const { createAccount } = require('../../queries/finance/accounts');
const { createSource } = require('../../queries/finance/sources');
const { createBalanceSnapshot } = require('../../queries/finance/balances');
const { normalizeCashActivity, validateCashActivity, createCashActivity } = require('../../queries/finance/cash-activity');
const { validateSchemaShape } = require('../contracts');

const SCHEMA_ID = 'finance.ingestion-bundle/v1';
const SECTION_ORDER = ['accounts', 'sources', 'balance_snapshots', 'cash_transactions'];
const MAX_ITEMS = 500;
const MAX_BYTES = 2 * 1024 * 1024;

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

function ingestionProjection() {
  return `SELECT r.*,s.source_key FROM ingestion_runs r LEFT JOIN sources s ON s.id=r.source_id`;
}

function parseJson(value, fallback) { return value ? JSON.parse(value) : fallback; }

function serializeRun(row, db) {
  const contexts = db.prepare('SELECT context_kind,item_count,status,result_json FROM ingestion_run_contexts WHERE ingestion_run_id=? ORDER BY id').all(row.id).map((item) => ({ ...item, result: parseJson(item.result_json, null), result_json: undefined }));
  return { ...row, warnings: parseJson(row.warnings_json, []), errors: parseJson(row.errors_json, []), result: parseJson(row.result_json, null), contexts, warnings_json: undefined, errors_json: undefined, result_json: undefined };
}

function getIngestionRun(key, db = getDb()) {
  return serializeRun(requireRow(db.prepare(`${ingestionProjection()} WHERE r.run_key=?`).get(key), 'Ingestion run'), db);
}

function cleanupExpiredPreviews(db = getDb(), now = new Date()) {
  return withTransaction(db, () => {
    const rows = db.prepare("SELECT id,run_key FROM ingestion_runs WHERE status='preview_ready' AND expires_at<=?").all(now.toISOString());
    for (const row of rows) {
      db.prepare("UPDATE ingestion_items SET staged_json=NULL,status='expired',expires_at=NULL WHERE ingestion_run_id=?").run(row.id);
      db.prepare("UPDATE ingestion_run_contexts SET status='expired' WHERE ingestion_run_id=?").run(row.id);
      db.prepare("UPDATE ingestion_runs SET status='expired',expires_at=NULL,updated_at=? WHERE id=?").run(now.toISOString(), row.id);
    }
    return { expired_runs: rows.length };
  });
}

function validateBundle(bundle, db) {
  assertObject(bundle); rejectUnknown(bundle, ['schema_id', 'idempotency_key', 'source_key', 'bundle_kind', 'authority', 'reason', 'ai_confidence', 'sections']);
  if (bundle.schema_id !== SCHEMA_ID) throw new FinanceError('UNKNOWN_SCHEMA', `Expected ${SCHEMA_ID}`, { status: 400, field: 'schema_id' });
  const normalized = {
    schema_id: SCHEMA_ID, idempotency_key: requiredString(bundle.idempotency_key, 'idempotency_key', 160),
    source_key: bundle.source_key || null, bundle_kind: enumValue(bundle.bundle_kind, 'ingestion_bundle_kind', 'bundle_kind'),
    authority: enumValue(bundle.authority, 'authority', 'authority'), reason: requiredString(bundle.reason, 'reason', 1000),
    ai_confidence: bundle.ai_confidence === undefined || bundle.ai_confidence === null ? null : Number(bundle.ai_confidence), sections: {},
  };
  if (normalized.ai_confidence !== null && (!Number.isFinite(normalized.ai_confidence) || normalized.ai_confidence < 0 || normalized.ai_confidence > 1)) throw new FinanceError('VALIDATION_ERROR', 'ai_confidence must be between 0 and 1', { field: 'ai_confidence' });
  assertObject(bundle.sections, 'sections'); rejectUnknown(bundle.sections, SECTION_ORDER, 'sections');
  const keys = new Set(); let count = 0;
  for (const context of SECTION_ORDER) {
    const items = bundle.sections[context] || [];
    if (!Array.isArray(items)) throw new FinanceError('VALIDATION_ERROR', `${context} must be an array`, { field: `sections.${context}` });
    normalized.sections[context] = items.map((item) => {
      assertObject(item, context); const clientKey = requiredString(item.client_item_key, 'client_item_key', 160);
      if (keys.has(clientKey)) throw new FinanceError('IDENTITY_CONFLICT', `Duplicate client_item_key: ${clientKey}`, { status: 409 });
      keys.add(clientKey); count += 1;
      return { ...item, client_item_key: clientKey };
    });
  }
  if (!count || count > MAX_ITEMS) throw new FinanceError('VALIDATION_ERROR', `Bundle must contain 1-${MAX_ITEMS} items`, { field: 'sections' });
  if (Buffer.byteLength(canonicalJson(normalized)) > MAX_BYTES) throw new FinanceError('VALIDATION_ERROR', 'Bundle exceeds 2 MiB', { field: 'body' });
  if (normalized.source_key) requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(normalized.source_key), 'Source');
  return normalized;
}

function previewValidateItem(context, item, db, knownKeys) {
  const { client_item_key: _clientKey, account_client_ref, source_client_ref, ...payload } = item;
  if (account_client_ref && !knownKeys.accounts.has(account_client_ref)) throw new FinanceError('VALIDATION_ERROR', `Unresolved account_client_ref: ${account_client_ref}`);
  if (source_client_ref && !knownKeys.sources.has(source_client_ref)) throw new FinanceError('VALIDATION_ERROR', `Unresolved source_client_ref: ${source_client_ref}`);
  if (context === 'accounts') validateSchemaShape('account', payload);
  if (context === 'sources') validateSchemaShape('source', payload);
  if (context === 'balance_snapshots') {
    const candidate = { ...payload, account_key: payload.account_key || (account_client_ref ? '__client_ref__' : null), source_key: payload.source_key || (source_client_ref ? '__client_ref__' : undefined) };
    validateSchemaShape('balance_snapshot', candidate);
  }
  if (context === 'cash_transactions') {
    normalizeCashActivity({ ...payload, account_key: payload.account_key || '__client_ref__', source_key: payload.source_key || (source_client_ref ? '__client_ref__' : undefined) });
    if (!account_client_ref) validateCashActivity(payload, db);
  }
  return payload;
}

function previewIngestion(input, actor = {}, db = getDb(), now = new Date()) {
  cleanupExpiredPreviews(db, now);
  const normalized = validateBundle(input, db); const canonical = canonicalJson(normalized); const hash = sha256(canonical);
  const existing = db.prepare('SELECT * FROM ingestion_runs WHERE idempotency_key=?').get(normalized.idempotency_key);
  if (existing) {
    if (existing.payload_hash !== hash) throw new FinanceError('DUPLICATE', 'Idempotency key was already used with a different payload', { status: 409 });
    return getIngestionRun(existing.run_key, db);
  }
  const runKey = stableKey(); const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const knownKeys = { accounts: new Set(normalized.sections.accounts.map((item) => item.client_item_key)), sources: new Set(normalized.sections.sources.map((item) => item.client_item_key)) };
  const validated = [];
  for (const context of SECTION_ORDER) for (const item of normalized.sections[context]) {
    previewValidateItem(context, item, db, knownKeys); validated.push({ context, item });
  }
  return withTransaction(db, () => {
    const source = normalized.source_key ? db.prepare('SELECT * FROM sources WHERE source_key=?').get(normalized.source_key) : null;
    const result = db.prepare(`INSERT INTO ingestion_runs(run_key,idempotency_key,payload_hash,schema_id,bundle_kind,source_id,authority,reason,ai_confidence,status,expires_at,warnings_json,errors_json)
      VALUES(?,?,?,?,?,?,?,?,?,'preview_ready',?,'[]','[]')`).run(runKey, normalized.idempotency_key, hash, SCHEMA_ID, normalized.bundle_kind, source?.id || null, normalized.authority, normalized.reason, normalized.ai_confidence, expiresAt);
    const runId = Number(result.lastInsertRowid);
    const insertContext = db.prepare("INSERT INTO ingestion_run_contexts(ingestion_run_id,context_kind,item_count,status) VALUES(?,?,?,'preview_ready')");
    const insertItem = db.prepare("INSERT INTO ingestion_items(ingestion_run_id,context_kind,client_item_key,item_hash,staged_json,status,expires_at) VALUES(?,?,?,?,?,'staged',?)");
    for (const context of SECTION_ORDER) if (normalized.sections[context].length) insertContext.run(runId, context, normalized.sections[context].length);
    for (const { context, item } of validated) insertItem.run(runId, context, item.client_item_key, sha256(canonicalJson(item)), canonicalJson(item), expiresAt);
    logChange(db, { resourceType: 'ingestion_run', resourceKey: runKey, action: 'preview', after: { schema_id: SCHEMA_ID, bundle_kind: normalized.bundle_kind, item_count: validated.length }, actorType: actor.type, actorNote: actor.note });
    return getIngestionRun(runKey, db);
  });
}

function resolveRefs(item, maps) {
  const value = { ...item }; delete value.client_item_key;
  if (value.account_client_ref) { value.account_key = maps.accounts.get(value.account_client_ref); delete value.account_client_ref; }
  if (value.source_client_ref) { value.source_key = maps.sources.get(value.source_client_ref); delete value.source_client_ref; }
  return value;
}

function commitIngestion(runKey, actor = {}, db = getDb(), now = new Date()) {
  return withTransaction(db, () => {
    const run = requireRow(db.prepare('SELECT * FROM ingestion_runs WHERE run_key=?').get(runKey), 'Ingestion run');
    if (run.status === 'committed') return getIngestionRun(runKey, db);
    if (run.status !== 'preview_ready' || Date.parse(run.expires_at) <= now.getTime()) throw new FinanceError('VERSION_CONFLICT', 'Preview is not active; create a new preview', { status: 409 });
    const items = db.prepare('SELECT * FROM ingestion_items WHERE ingestion_run_id=? ORDER BY id').all(run.id);
    if (items.some((item) => !item.staged_json)) throw new FinanceError('VERSION_CONFLICT', 'Staged payload is unavailable', { status: 409 });
    const maps = { accounts: new Map(), sources: new Map() }; const result = { created: {}, duplicates: 0 };
    for (const context of SECTION_ORDER) {
      const contextItems = items.filter((item) => item.context_kind === context);
      result.created[context] = [];
      for (const staged of contextItems) {
        const raw = JSON.parse(staged.staged_json); const value = resolveRefs(raw, maps); let row; let resourceType; let resourceKey;
        if (context === 'accounts') { row = createAccount(value, actor, db); db.prepare('UPDATE accounts SET ingestion_run_id=? WHERE account_key=?').run(run.id, row.account_key); resourceType = 'account'; resourceKey = row.account_key; maps.accounts.set(raw.client_item_key, resourceKey); }
        if (context === 'sources') { row = createSource(value, actor, db); db.prepare('UPDATE sources SET ingestion_run_id=? WHERE source_key=?').run(run.id, row.source_key); resourceType = 'source'; resourceKey = row.source_key; maps.sources.set(raw.client_item_key, resourceKey); }
        if (context === 'balance_snapshots') { row = createBalanceSnapshot(value, actor, db, run.id); resourceType = 'balance_snapshot'; resourceKey = row.snapshot_key; }
        if (context === 'cash_transactions') { row = createCashActivity(value, actor, db, run.id, raw.client_item_key); resourceType = 'cash_transaction'; resourceKey = row.transaction_key; }
        result.created[context].push(resourceKey);
        db.prepare("UPDATE ingestion_items SET canonical_resource_type=?,canonical_resource_key=?,status='committed',staged_json=NULL,expires_at=NULL WHERE id=?").run(resourceType, resourceKey, staged.id);
      }
      if (contextItems.length) db.prepare("UPDATE ingestion_run_contexts SET status='committed',result_json=? WHERE ingestion_run_id=? AND context_kind=?").run(JSON.stringify({ created: result.created[context].length }), run.id, context);
    }
    db.prepare("UPDATE ingestion_runs SET status='committed',committed_at=?,expires_at=NULL,result_json=?,updated_at=? WHERE id=?").run(now.toISOString(), JSON.stringify(result), now.toISOString(), run.id);
    logChange(db, { resourceType: 'ingestion_run', resourceKey: runKey, action: 'commit', after: result, actorType: actor.type, actorNote: actor.note });
    return getIngestionRun(runKey, db);
  });
}

module.exports = { SCHEMA_ID, SECTION_ORDER, previewIngestion, commitIngestion, getIngestionRun, cleanupExpiredPreviews };
