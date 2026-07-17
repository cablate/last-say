const { validateSchemaShape, requiredString, optionalString, enumValue, isoDate, booleanInt, expectedVersion, FinanceError } = require('../../finance/contracts');
const { getDb, stableKey, logChange, requireRow, assertVersion, withTransaction } = require('./common');

function sourceProjection() {
  return `SELECT s.*, i.institution_key, a.account_key
    FROM sources s LEFT JOIN institutions i ON i.id=s.institution_id
    LEFT JOIN accounts a ON a.id=s.account_id`;
}

function listSources(filters = {}, db = getDb()) {
  const where=[]; const params=[];
  if (filters.account_key) { where.push('a.account_key=?'); params.push(filters.account_key); }
  if (filters.source_kind) { where.push('s.source_kind=?'); params.push(filters.source_kind); }
  return db.prepare(`${sourceProjection()} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(s.as_of_at,s.period_end,s.imported_at) DESC,s.id DESC`).all(...params);
}

function getSource(key, db = getDb()) {
  return requireRow(db.prepare(`${sourceProjection()} WHERE s.source_key=?`).get(key), 'Source');
}

function resolveOptional(db, table, keyColumn, key, label) {
  if (!key) return null;
  return requireRow(db.prepare(`SELECT * FROM ${table} WHERE ${keyColumn}=?`).get(key), label);
}

function safeSourceFile(value) {
  const file = optionalString(value, 'source_file', 500) || '';
  if (!file) return '';
  const normalized = file.replaceAll('\\', '/');
  if (pathIsAbsolute(normalized) || normalized.split('/').includes('..') || !/^(uploads|data|outputs)\//.test(normalized)) {
    throw new FinanceError('VALIDATION_ERROR', 'source_file must be a relative path under uploads/, data/, or outputs/', { field: 'source_file' });
  }
  return normalized;
}

function pathIsAbsolute(value) {
  return /^(?:[A-Za-z]:|\/)/.test(value);
}

function normalizedSource(input, db, before = null) {
  validateSchemaShape('source', input);
  const institution = resolveOptional(db, 'institutions', 'institution_key', input.institution_key ?? before?.institution_key, 'Institution');
  const account = resolveOptional(db, 'accounts', 'account_key', input.account_key ?? before?.account_key, 'Account');
  const digest = optionalString(input.content_sha256, 'content_sha256', 64);
  if (digest && !/^[a-fA-F0-9]{64}$/.test(digest)) throw new FinanceError('VALIDATION_ERROR', 'content_sha256 must contain 64 hexadecimal characters', { field: 'content_sha256' });
  return {
    source_kind: enumValue(input.source_kind, 'source_kind', 'source_kind'),
    source_file: safeSourceFile(input.source_file),
    description: requiredString(input.description, 'description', 500),
    authority: enumValue(input.authority, 'authority', 'authority'),
    artifact_status: enumValue(input.artifact_status, 'artifact_status', 'artifact_status', input.source_file ? 'available' : 'external-only'),
    content_sha256: digest?.toLowerCase() || null,
    period_start: input.period_start ? isoDate(input.period_start, 'period_start') : null, period_end: input.period_end ? isoDate(input.period_end, 'period_end') : null,
    as_of_at: optionalString(input.as_of_at, 'as_of_at', 40), observed_at: optionalString(input.observed_at, 'observed_at', 40),
    institution_id: institution?.id || null, account_id: account?.id || null,
    is_official: booleanInt(input.is_official, false),
    review_state: enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'),
  };
}

function createSource(input, actor = {}, db = getDb()) {
  const value = normalizedSource(input, db); const key = stableKey();
  return withTransaction(db, () => {
    try {
      db.prepare(`INSERT INTO sources (source_type,source_file,description,source_key,source_kind,authority,status,artifact_status,content_sha256,period_start,period_end,as_of_at,observed_at,institution_id,account_id,is_official,created_by,review_state,version,updated_at)
        VALUES (?,?,?,?,?,?, 'active',?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP)`)
        .run(value.source_kind, value.source_file, value.description, key, value.source_kind, value.authority, value.artifact_status, value.content_sha256, value.period_start, value.period_end, value.as_of_at, value.observed_at, value.institution_id, value.account_id, value.is_official, actor.type || 'human', value.review_state);
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) throw new FinanceError('DUPLICATE', 'Equivalent source metadata already exists', { status: 409 });
      throw error;
    }
    const row=getSource(key,db); logChange(db,{resourceType:'source',resourceKey:key,action:'create',after:row,actorType:actor.type,actorNote:actor.note}); return row;
  });
}

function validateSource(input, db = getDb()) {
  return normalizedSource(input, db);
}

function updateSource(key, input, actor = {}, db = getDb()) {
  const version=expectedVersion(input.expected_version);
  return withTransaction(db,()=>{
    const before=getSource(key,db); assertVersion(before,version); const value=normalizedSource(input,db,before);
    db.prepare(`UPDATE sources SET source_type=?,source_file=?,description=?,source_kind=?,authority=?,artifact_status=?,content_sha256=?,period_start=?,period_end=?,as_of_at=?,observed_at=?,institution_id=?,account_id=?,is_official=?,review_state=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE source_key=?`)
      .run(value.source_kind,value.source_file,value.description,value.source_kind,value.authority,value.artifact_status,value.content_sha256,value.period_start,value.period_end,value.as_of_at,value.observed_at,value.institution_id,value.account_id,value.is_official,value.review_state,key);
    const after=getSource(key,db); logChange(db,{resourceType:'source',resourceKey:key,action:'update',before,after,actorType:actor.type,actorNote:actor.note}); return after;
  });
}

module.exports={listSources,getSource,validateSource,createSource,updateSource};
