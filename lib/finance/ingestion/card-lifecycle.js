const { createHash } = require('node:crypto');
const {
  FinanceError,
  assertObject,
  rejectUnknown,
  requiredString,
  optionalString,
  enumValue,
  validateSchemaShape,
} = require('../contracts');
const { canonicalJson } = require('../../queries/finance/human-confirmations');
const {
  getDb,
  stableKey,
  normalizeAlias,
  logChange,
  requireRow,
  withTransaction,
} = require('../../queries/finance/common');
const { moneyMinor } = require('../../queries/finance/balances');
const { normalizeCashActivity, createCashActivity } = require('../../queries/finance/cash-activity');
const { validateSource, createSource } = require('../../queries/finance/sources');

const SCHEMA_ID = 'finance.card-transaction-lifecycle/v1';
const CONTEXT_KIND = 'credit_card_transaction_lifecycle';
const MAX_ITEMS = 500;
const MAX_BYTES = 2 * 1024 * 1024;
const INPUT_FIELDS = [
  'schema_id', 'idempotency_key', 'account_key', 'authority', 'reason',
  'posted_source_key', 'posted_source', 'expected_rows_total_minor', 'posted_rows',
  'supersede_source_keys', 'release_transaction_keys',
];
const ROW_FIELDS = [
  'client_item_key', 'occurrence_ordinal', 'match_transaction_key',
  'transaction_date', 'external_id', 'name', 'amount_minor', 'currency',
  'flow_type', 'category_primary', 'category_sub', 'memo', 'judgment_reason',
  'ai_confidence', 'record_status',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueStrings(value, field, limit) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) {
    throw new FinanceError('VALIDATION_ERROR', `${field} must be an array with at most ${limit} items`, { field });
  }
  const result = value.map((item) => requiredString(item, field, 160));
  if (new Set(result).size !== result.length) {
    throw new FinanceError('IDENTITY_CONFLICT', `${field} contains duplicate keys`, { status: 409, field });
  }
  return result;
}

function sourceInputFromValidated(input, accountKey, value) {
  const result = {
    source_kind: value.source_kind,
    source_file: value.source_file,
    description: value.description,
    account_key: accountKey,
    is_official: Boolean(value.is_official),
    authority: value.authority,
    artifact_status: value.artifact_status,
    review_state: value.review_state,
  };
  for (const field of ['content_sha256', 'period_start', 'period_end', 'as_of_at', 'observed_at', 'institution_key']) {
    const candidate = field === 'institution_key' ? input.institution_key : value[field];
    if (candidate !== null && candidate !== undefined && candidate !== '') result[field] = candidate;
  }
  return result;
}

function validatePostedSource(source, account, field = 'posted_source') {
  if (source.account_id !== account.id) {
    throw new FinanceError('IDENTITY_CONFLICT', `${field} belongs to another account`, { status: 409, field });
  }
  if (source.source_kind !== 'credit_card_statement_csv') {
    throw new FinanceError('VALIDATION_ERROR', `${field} must be credit_card_statement_csv`, { field: `${field}.source_kind` });
  }
  if (!['official', 'institution_export'].includes(source.authority)) {
    throw new FinanceError('VALIDATION_ERROR', `${field} requires official or institution_export authority`, { field: `${field}.authority` });
  }
  if (Number(source.is_official) !== 1) {
    throw new FinanceError('VALIDATION_ERROR', `${field} must be marked official`, { field: `${field}.is_official` });
  }
  if (!source.period_end) {
    throw new FinanceError('VALIDATION_ERROR', `${field}.period_end is required`, { field: `${field}.period_end` });
  }
  if (source.status && source.status !== 'active') {
    throw new FinanceError('VERSION_CONFLICT', `${field} must be active`, { status: 409, field: `${field}.status` });
  }
}

function normalizePostedRow(input, accountKey) {
  assertObject(input, 'posted row');
  rejectUnknown(input, ROW_FIELDS, 'posted row');
  const clientItemKey = requiredString(input.client_item_key, 'client_item_key', 160);
  const occurrenceOrdinal = Number(input.occurrence_ordinal);
  if (!Number.isInteger(occurrenceOrdinal) || occurrenceOrdinal < 1) {
    throw new FinanceError('VALIDATION_ERROR', 'occurrence_ordinal must be a positive integer', { field: 'occurrence_ordinal' });
  }
  if (input.record_status !== undefined && input.record_status !== 'posted') {
    throw new FinanceError('VALIDATION_ERROR', 'Lifecycle posted rows must use record_status=posted', { field: 'record_status' });
  }
  const { client_item_key: _clientKey, occurrence_ordinal: _ordinal, match_transaction_key: _match, ...cash } = input;
  const value = normalizeCashActivity({ ...cash, account_key: accountKey, record_status: 'posted' });
  return {
    client_item_key: clientItemKey,
    occurrence_ordinal: occurrenceOrdinal,
    match_transaction_key: optionalString(input.match_transaction_key, 'match_transaction_key', 100),
    transaction_date: value.transaction_date,
    external_id: value.external_id,
    name: value.name,
    normalized_name: normalizeAlias(value.name),
    amount_minor: value.amount.toString(),
    currency: value.currency,
    flow_type: value.flow_type,
    category_primary: value.category_primary,
    category_sub: value.category_sub,
    memo: value.memo,
    judgment_reason: value.judgment_reason,
    ai_confidence: value.ai_confidence,
    record_status: 'posted',
  };
}

function validateSupersededSources(keys, account, postedPeriodEnd, db) {
  return keys.map((key) => {
    const source = requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(key), 'Superseded source');
    if (source.account_id !== account.id) {
      throw new FinanceError('IDENTITY_CONFLICT', 'Superseded source belongs to another account', { status: 409, field: 'supersede_source_keys' });
    }
    if (source.source_kind !== 'current_transactions_csv') {
      throw new FinanceError('VALIDATION_ERROR', 'Only current_transactions_csv can be superseded by this lifecycle', { field: 'supersede_source_keys' });
    }
    if (source.status !== 'active') {
      throw new FinanceError('VERSION_CONFLICT', `Source ${key} is not active`, { status: 409, field: 'supersede_source_keys' });
    }
    if (!source.period_end || source.period_end > postedPeriodEnd) {
      throw new FinanceError('VALIDATION_ERROR', `Source ${key} is outside the posted statement boundary`, { field: 'supersede_source_keys' });
    }
    return source;
  });
}

function normalizeLifecycleInput(input, db) {
  assertObject(input);
  rejectUnknown(input, INPUT_FIELDS);
  validateSchemaShape('card_transaction_lifecycle', input);
  if (input.schema_id !== SCHEMA_ID) {
    throw new FinanceError('UNKNOWN_SCHEMA', `Expected ${SCHEMA_ID}`, { status: 400, field: 'schema_id' });
  }
  const accountKey = requiredString(input.account_key, 'account_key', 100);
  const account = requireRow(db.prepare('SELECT * FROM accounts WHERE account_key=?').get(accountKey), 'Account');
  if (account.account_kind !== 'credit_card' || Number(account.active) !== 1) {
    throw new FinanceError('IDENTITY_CONFLICT', 'account_key must reference an active credit-card account', { status: 409, field: 'account_key' });
  }
  const authority = enumValue(input.authority, 'authority', 'authority');
  if (!['official', 'institution_export'].includes(authority)) {
    throw new FinanceError('VALIDATION_ERROR', 'Card lifecycle requires official or institution_export authority', { field: 'authority' });
  }
  const hasSourceKey = Boolean(input.posted_source_key);
  const hasSourceInput = Boolean(input.posted_source);
  if (hasSourceKey === hasSourceInput) {
    throw new FinanceError('VALIDATION_ERROR', 'Provide exactly one of posted_source_key or posted_source', { field: 'posted_source_key' });
  }

  let postedSourceKey = null;
  let postedSourceInput = null;
  let postedSource;
  if (hasSourceKey) {
    postedSourceKey = requiredString(input.posted_source_key, 'posted_source_key', 100);
    postedSource = requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(postedSourceKey), 'Posted source');
    validatePostedSource(postedSource, account, 'posted_source_key');
  } else {
    assertObject(input.posted_source, 'posted_source');
    if (input.posted_source.account_key && input.posted_source.account_key !== accountKey) {
      throw new FinanceError('IDENTITY_CONFLICT', 'posted_source belongs to another account', { status: 409, field: 'posted_source.account_key' });
    }
    const sourceValue = validateSource({ ...input.posted_source, account_key: accountKey }, db);
    postedSourceInput = sourceInputFromValidated(input.posted_source, accountKey, sourceValue);
    postedSource = { ...sourceValue, account_id: account.id, status: 'active' };
    validatePostedSource(postedSource, account);
  }

  if (!Array.isArray(input.posted_rows) || input.posted_rows.length < 1 || input.posted_rows.length > MAX_ITEMS) {
    throw new FinanceError('VALIDATION_ERROR', `posted_rows must contain 1-${MAX_ITEMS} rows`, { field: 'posted_rows' });
  }
  const postedRows = input.posted_rows.map((row) => normalizePostedRow(row, accountKey));
  const rowKeys = postedRows.map((row) => row.client_item_key);
  if (new Set(rowKeys).size !== rowKeys.length) {
    throw new FinanceError('IDENTITY_CONFLICT', 'posted_rows contains duplicate client_item_key values', { status: 409, field: 'posted_rows' });
  }
  const ordinalKeys = postedRows.map((row) => [row.transaction_date, row.currency, row.amount_minor, row.normalized_name, row.occurrence_ordinal].join('\u001f'));
  if (new Set(ordinalKeys).size !== ordinalKeys.length) {
    throw new FinanceError('IDENTITY_CONFLICT', 'posted_rows contains duplicate occurrence identity', { status: 409, field: 'posted_rows' });
  }
  if (postedRows.some((row) => row.transaction_date > postedSource.period_end)) {
    throw new FinanceError('VALIDATION_ERROR', 'posted row falls after posted_source.period_end', { field: 'posted_rows' });
  }
  const expectedTotal = moneyMinor(input.expected_rows_total_minor);
  const actualTotal = postedRows.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n);
  if (expectedTotal !== actualTotal) {
    throw new FinanceError('VALIDATION_ERROR', `expected_rows_total_minor does not equal posted row total ${actualTotal}`, { field: 'expected_rows_total_minor' });
  }

  const supersedeSourceKeys = uniqueStrings(input.supersede_source_keys, 'supersede_source_keys', 100);
  if (postedSourceKey && supersedeSourceKeys.includes(postedSourceKey)) {
    throw new FinanceError('IDENTITY_CONFLICT', 'Posted source cannot supersede itself', { status: 409, field: 'supersede_source_keys' });
  }
  const supersedeSources = validateSupersededSources(supersedeSourceKeys, account, postedSource.period_end, db);
  const releaseTransactionKeys = uniqueStrings(input.release_transaction_keys, 'release_transaction_keys', MAX_ITEMS);
  const normalized = {
    schema_id: SCHEMA_ID,
    idempotency_key: requiredString(input.idempotency_key, 'idempotency_key', 160),
    account_key: accountKey,
    authority,
    reason: requiredString(input.reason, 'reason', 1000),
    posted_source_key: postedSourceKey,
    posted_source: postedSourceInput,
    expected_rows_total_minor: expectedTotal.toString(),
    posted_rows: postedRows,
    supersede_source_keys: supersedeSourceKeys,
    release_transaction_keys: releaseTransactionKeys,
  };
  if (Buffer.byteLength(canonicalJson(normalized)) > MAX_BYTES) {
    throw new FinanceError('VALIDATION_ERROR', 'Lifecycle payload exceeds 2 MiB', { field: 'body' });
  }
  return { normalized, account, postedSource, supersedeSources };
}

function provisionalCandidates(row, context, db) {
  const params = [context.account.id, row.transaction_date, row.currency, row.amount_minor];
  let sourceClause = '';
  if (context.supersedeSources.length) {
    sourceClause = `AND EXISTS (SELECT 1 FROM transaction_sources ts WHERE ts.transaction_id=t.id AND ts.source_id IN (${context.supersedeSources.map(() => '?').join(',')}))`;
    params.push(...context.supersedeSources.map((source) => source.id));
  }
  return db.prepare(`SELECT t.*,CAST(t.amount_minor AS TEXT) AS amount_minor
    FROM transactions t
    WHERE t.account_id=? AND t.transaction_date=? AND t.currency=? AND CAST(t.amount_minor AS TEXT)=?
      AND t.record_status='provisional' ${sourceClause}
    ORDER BY t.id`).all(...params);
}

function matchPostedRow(row, context, db) {
  const candidates = provisionalCandidates(row, context, db);
  const externalMatches = row.external_id
    ? candidates.filter((candidate) => candidate.external_id === row.external_id)
    : [];
  const merchantMatches = candidates.filter((candidate) => normalizeAlias(candidate.name) === row.normalized_name);
  const strongCandidates = externalMatches.length ? externalMatches : merchantMatches;
  if (row.match_transaction_key) {
    const selected = candidates.find((candidate) => candidate.transaction_key === row.match_transaction_key);
    if (!selected || (!externalMatches.includes(selected) && !merchantMatches.includes(selected))) {
      return {
        outcome: 'ambiguous', client_item_key: row.client_item_key,
        reason: 'invalid_explicit_match', candidate_transaction_keys: strongCandidates.map((candidate) => candidate.transaction_key),
      };
    }
    return { outcome: 'matched', client_item_key: row.client_item_key, transaction_key: selected.transaction_key, match_basis: 'explicit_strong_identity' };
  }
  if (strongCandidates.length === 1) {
    return {
      outcome: 'matched', client_item_key: row.client_item_key,
      transaction_key: strongCandidates[0].transaction_key,
      match_basis: externalMatches.length ? 'external_id_exact' : 'merchant_signature_exact',
    };
  }
  if (strongCandidates.length > 1) {
    return {
      outcome: 'ambiguous', client_item_key: row.client_item_key,
      reason: 'multiple_strong_candidates', candidate_transaction_keys: strongCandidates.map((candidate) => candidate.transaction_key),
    };
  }
  return { outcome: 'new', client_item_key: row.client_item_key };
}

function releaseScope(context, db) {
  if (!context.supersedeSources.length) return [];
  const ids = context.supersedeSources.map((source) => source.id);
  return db.prepare(`SELECT DISTINCT t.transaction_key,t.transaction_date
    FROM transactions t JOIN transaction_sources ts ON ts.transaction_id=t.id
    WHERE t.account_id=? AND t.record_status='provisional'
      AND ts.source_id IN (${ids.map(() => '?').join(',')})
    ORDER BY t.transaction_date,t.id`).all(context.account.id, ...ids);
}

function planImpact(plan) {
  return {
    schema_id: SCHEMA_ID,
    account_key: plan.account_key,
    posted_source_key: plan.posted_source_key,
    posted_source_period_end: plan.posted_source_period_end,
    committable: plan.committable,
    counts: plan.counts,
    matched: plan.matched,
    new: plan.new,
    ambiguous: plan.ambiguous,
    released: plan.released,
    unresolved_release_candidates: plan.unresolved_release_candidates,
    invalid_release_transaction_keys: plan.invalid_release_transaction_keys,
    source_supersessions: plan.source_supersessions,
    expected_rows_total_minor: plan.expected_rows_total_minor,
  };
}

function buildLifecyclePlan(context, db) {
  const preliminary = context.normalized.posted_rows.map((row) => matchPostedRow(row, context, db));
  const selectedCounts = new Map();
  for (const item of preliminary.filter((candidate) => candidate.outcome === 'matched')) {
    selectedCounts.set(item.transaction_key, (selectedCounts.get(item.transaction_key) || 0) + 1);
  }
  const outcomes = preliminary.map((item) => {
    if (item.outcome !== 'matched' || selectedCounts.get(item.transaction_key) === 1) return item;
    return {
      outcome: 'ambiguous', client_item_key: item.client_item_key,
      reason: 'candidate_claimed_by_multiple_rows', candidate_transaction_keys: [item.transaction_key],
    };
  });
  const matched = outcomes.filter((item) => item.outcome === 'matched').map(({ outcome: _outcome, ...item }) => item);
  const created = outcomes.filter((item) => item.outcome === 'new').map(({ outcome: _outcome, ...item }) => item);
  const ambiguous = outcomes.filter((item) => item.outcome === 'ambiguous').map(({ outcome: _outcome, ...item }) => item);
  const matchedKeys = new Set(matched.map((item) => item.transaction_key));
  const ambiguousKeys = new Set(ambiguous.flatMap((item) => item.candidate_transaction_keys));
  const releaseCandidates = releaseScope(context, db).filter((item) => !matchedKeys.has(item.transaction_key));
  const eligibleRelease = releaseCandidates.filter((item) => item.transaction_date <= context.postedSource.period_end);
  const eligibleKeys = new Set(eligibleRelease.map((item) => item.transaction_key));
  const invalidRelease = context.normalized.release_transaction_keys.filter((key) => !eligibleKeys.has(key) || ambiguousKeys.has(key));
  const explicitRelease = new Set(context.normalized.release_transaction_keys.filter((key) => eligibleKeys.has(key) && !ambiguousKeys.has(key)));
  const released = eligibleRelease.filter((item) => explicitRelease.has(item.transaction_key)).map((item) => ({ transaction_key: item.transaction_key }));
  const unresolved = releaseCandidates.filter((item) => !explicitRelease.has(item.transaction_key)).map((item) => ({
    transaction_key: item.transaction_key,
    ...(item.transaction_date > context.postedSource.period_end ? { reason: 'outside_posted_boundary' } : {}),
  }));
  const sourceSupersessions = context.supersedeSources.map((source) => ({ source_key: source.source_key, expected_version: source.version }));
  const committable = ambiguous.length === 0 && invalidRelease.length === 0 && unresolved.length === 0;
  const plan = {
    account_key: context.normalized.account_key,
    posted_source_key: context.normalized.posted_source_key,
    posted_source_period_end: context.postedSource.period_end,
    committable,
    counts: {
      matched: matched.length,
      new: created.length,
      ambiguous: ambiguous.length,
      released: released.length,
      unresolved_release_candidates: unresolved.length,
      source_supersessions: sourceSupersessions.length,
    },
    matched,
    new: created,
    ambiguous,
    released,
    unresolved_release_candidates: unresolved,
    invalid_release_transaction_keys: invalidRelease,
    source_supersessions: sourceSupersessions,
    expected_rows_total_minor: context.normalized.expected_rows_total_minor,
  };
  const impact = planImpact(plan);
  return { ...impact, impact_hash: sha256(canonicalJson(impact)) };
}

function ingestionRun(runKey, db) {
  return require('./index').getIngestionRun(runKey, db);
}

function previewCardLifecycle(input, actor = {}, db = getDb(), now = new Date()) {
  const context = normalizeLifecycleInput(input, db);
  const canonical = canonicalJson(context.normalized);
  const payloadHash = sha256(canonical);
  const existing = db.prepare('SELECT * FROM ingestion_runs WHERE idempotency_key=?').get(context.normalized.idempotency_key);
  if (existing) {
    if (existing.payload_hash !== payloadHash) {
      throw new FinanceError('DUPLICATE', 'Idempotency key was already used with a different payload', { status: 409 });
    }
    return ingestionRun(existing.run_key, db);
  }
  const plan = buildLifecyclePlan(context, db);
  const runKey = stableKey();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const staged = [
    {
      client_item_key: 'lifecycle:header',
      value: {
        item_kind: 'header', account_key: context.normalized.account_key,
        posted_source_key: context.normalized.posted_source_key,
        posted_source: context.normalized.posted_source,
        expected_rows_total_minor: context.normalized.expected_rows_total_minor,
      },
    },
    ...context.normalized.posted_rows.map((row) => ({ client_item_key: `lifecycle:row:${row.client_item_key}`, value: { item_kind: 'posted_row', ...row } })),
    ...context.normalized.release_transaction_keys.map((key) => ({ client_item_key: `lifecycle:release:${key}`, value: { item_kind: 'release', transaction_key: key } })),
    ...context.normalized.supersede_source_keys.map((key) => ({ client_item_key: `lifecycle:supersede:${key}`, value: { item_kind: 'supersede_source', source_key: key } })),
  ];
  return withTransaction(db, () => {
    const sourceId = context.normalized.posted_source_key ? context.postedSource.id : null;
    const result = db.prepare(`INSERT INTO ingestion_runs(
      run_key,idempotency_key,payload_hash,schema_id,bundle_kind,source_id,authority,reason,status,expires_at,result_json,warnings_json,errors_json
    ) VALUES(?,?,?,?, 'card_statement',?,?,?,'preview_ready',?,?,?,?)`).run(
      runKey, context.normalized.idempotency_key, payloadHash, SCHEMA_ID, sourceId,
      context.normalized.authority, context.normalized.reason, expiresAt, JSON.stringify(plan),
      JSON.stringify(plan.unresolved_release_candidates), JSON.stringify(plan.ambiguous),
    );
    const runId = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO ingestion_run_contexts(ingestion_run_id,context_kind,item_count,status,result_json) VALUES(?,?,?,'preview_ready',?)")
      .run(runId, CONTEXT_KIND, staged.length, JSON.stringify(plan));
    const insert = db.prepare("INSERT INTO ingestion_items(ingestion_run_id,context_kind,client_item_key,item_hash,staged_json,status,expires_at) VALUES(?,?,?,?,?,'staged',?)");
    for (const item of staged) insert.run(runId, CONTEXT_KIND, item.client_item_key, sha256(canonicalJson(item.value)), canonicalJson(item.value), expiresAt);
    logChange(db, {
      resourceType: 'ingestion_run', resourceKey: runKey, action: 'preview',
      after: { schema_id: SCHEMA_ID, impact_hash: plan.impact_hash, counts: plan.counts, committable: plan.committable },
      actorType: actor.type, actorNote: actor.note,
    });
    return ingestionRun(runKey, db);
  });
}

function reconstructInput(run, items) {
  const values = items.map((item) => ({ item, value: JSON.parse(item.staged_json) }));
  const header = values.find(({ value }) => value.item_kind === 'header')?.value;
  if (!header) throw new FinanceError('VERSION_CONFLICT', 'Lifecycle staging header is unavailable', { status: 409 });
  const postedRows = values.filter(({ value }) => value.item_kind === 'posted_row').map(({ value }) => {
    const { item_kind: _kind, normalized_name: _normalized, ...row } = value;
    return row;
  });
  return {
    schema_id: SCHEMA_ID,
    idempotency_key: run.idempotency_key,
    account_key: header.account_key,
    authority: run.authority,
    reason: run.reason,
    posted_source_key: header.posted_source_key,
    posted_source: header.posted_source,
    expected_rows_total_minor: header.expected_rows_total_minor,
    posted_rows: postedRows,
    release_transaction_keys: values.filter(({ value }) => value.item_kind === 'release').map(({ value }) => value.transaction_key),
    supersede_source_keys: values.filter(({ value }) => value.item_kind === 'supersede_source').map(({ value }) => value.source_key),
  };
}

function rowAsCashInput(row, accountKey, sourceKey) {
  return {
    account_key: accountKey,
    source_key: sourceKey,
    transaction_date: row.transaction_date,
    external_id: row.external_id,
    name: row.name,
    amount_minor: row.amount_minor,
    currency: row.currency,
    flow_type: row.flow_type,
    category_primary: row.category_primary,
    category_sub: row.category_sub,
    memo: row.memo,
    judgment_reason: row.judgment_reason,
    ai_confidence: row.ai_confidence,
    record_status: 'posted',
  };
}

function updateItem(db, runId, clientItemKey, resourceType, resourceKey) {
  db.prepare(`UPDATE ingestion_items SET canonical_resource_type=?,canonical_resource_key=?,status='committed',
    staged_json=NULL,expires_at=NULL WHERE ingestion_run_id=? AND client_item_key=?`)
    .run(resourceType, resourceKey, runId, clientItemKey);
}

function promoteMatchedRow(db, run, row, match, source, actor, now) {
  const transaction = requireRow(db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(match.transaction_key), 'Transaction');
  if (transaction.record_status !== 'provisional') {
    throw new FinanceError('VERSION_CONFLICT', 'Matched transaction is no longer provisional', { status: 409 });
  }
  const sourceRowId = row.client_item_key;
  const existingLink = db.prepare('SELECT 1 FROM transaction_sources WHERE transaction_id=? AND source_id=? AND source_row_id=?')
    .get(transaction.id, source.id, sourceRowId);
  if (!existingLink) {
    db.prepare('INSERT INTO transaction_sources(transaction_id,source_id,source_row_id,source_description,raw_info) VALUES(?,?,?,?,?)')
      .run(transaction.id, source.id, sourceRowId, source.description, '');
  }
  db.prepare("UPDATE transactions SET record_status='posted',updated_at=? WHERE id=?").run(now.toISOString(), transaction.id);
  const after = requireRow(db.prepare('SELECT * FROM transactions WHERE id=?').get(transaction.id), 'Transaction');
  logChange(db, {
    resourceType: 'credit_card_lifecycle_match', resourceKey: transaction.transaction_key, action: 'promote_to_posted',
    before: { record_status: transaction.record_status, updated_at: transaction.updated_at },
    after: {
      record_status: after.record_status, updated_at: after.updated_at, source_key: source.source_key,
      source_row_id: sourceRowId, link_created: !existingLink, ingestion_run_key: run.run_key,
    },
    actorType: actor.type, actorNote: actor.note,
  });
}

function releaseAuthorization(db, run, transactionKey, actor, now) {
  const transaction = requireRow(db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(transactionKey), 'Transaction');
  if (transaction.record_status !== 'provisional') {
    throw new FinanceError('VERSION_CONFLICT', 'Released transaction is no longer provisional', { status: 409 });
  }
  db.prepare("UPDATE transactions SET record_status='superseded',updated_at=? WHERE id=?").run(now.toISOString(), transaction.id);
  const after = requireRow(db.prepare('SELECT * FROM transactions WHERE id=?').get(transaction.id), 'Transaction');
  logChange(db, {
    resourceType: 'credit_card_lifecycle_release', resourceKey: transaction.transaction_key, action: 'release_authorization',
    before: { record_status: transaction.record_status, updated_at: transaction.updated_at },
    after: { record_status: after.record_status, updated_at: after.updated_at, ingestion_run_key: run.run_key },
    actorType: actor.type, actorNote: actor.note,
  });
}

function supersedeSource(db, run, sourceKey, actor, now) {
  const source = requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(sourceKey), 'Source');
  if (source.status !== 'active') {
    throw new FinanceError('VERSION_CONFLICT', 'Source is no longer active', { status: 409 });
  }
  db.prepare("UPDATE sources SET status='superseded',version=version+1,updated_at=? WHERE id=?").run(now.toISOString(), source.id);
  const after = requireRow(db.prepare('SELECT * FROM sources WHERE id=?').get(source.id), 'Source');
  logChange(db, {
    resourceType: 'credit_card_source_supersession', resourceKey: source.source_key, action: 'supersede_current_source',
    before: { status: source.status, version: source.version, updated_at: source.updated_at },
    after: { status: after.status, version: after.version, updated_at: after.updated_at, ingestion_run_key: run.run_key },
    actorType: actor.type, actorNote: actor.note,
  });
}

function commitCardLifecycle(runKey, actor = {}, db = getDb(), now = new Date()) {
  return withTransaction(db, () => {
    const run = requireRow(db.prepare('SELECT * FROM ingestion_runs WHERE run_key=?').get(runKey), 'Ingestion run');
    if (run.schema_id !== SCHEMA_ID) throw new FinanceError('UNKNOWN_SCHEMA', `Expected ${SCHEMA_ID}`, { status: 400 });
    if (run.status === 'committed') return ingestionRun(runKey, db);
    if (run.status !== 'preview_ready' || Date.parse(run.expires_at) <= now.getTime()) {
      throw new FinanceError('VERSION_CONFLICT', 'Preview is not active; create a new preview', { status: 409 });
    }
    const items = db.prepare('SELECT * FROM ingestion_items WHERE ingestion_run_id=? ORDER BY id').all(run.id);
    if (items.some((item) => !item.staged_json)) {
      throw new FinanceError('VERSION_CONFLICT', 'Staged lifecycle payload is unavailable', { status: 409 });
    }
    const reconstructed = reconstructInput(run, items);
    const context = normalizeLifecycleInput(reconstructed, db);
    const currentPlan = buildLifecyclePlan(context, db);
    const previewPlan = JSON.parse(run.result_json);
    if (currentPlan.impact_hash !== previewPlan.impact_hash) {
      throw new FinanceError('VERSION_CONFLICT', 'Lifecycle impact changed; preview again', { status: 409, retryable: true });
    }
    if (!currentPlan.committable) {
      throw new FinanceError('REVIEW_REQUIRED', 'Lifecycle preview has ambiguous or unresolved rows', { status: 409 });
    }

    let source;
    if (context.normalized.posted_source_key) {
      source = context.postedSource;
      updateItem(db, run.id, 'lifecycle:header', 'credit_card_lifecycle_source_reference', source.source_key);
    } else {
      source = createSource(context.normalized.posted_source, actor, db);
      db.prepare('UPDATE sources SET ingestion_run_id=? WHERE source_key=?').run(run.id, source.source_key);
      db.prepare('UPDATE ingestion_runs SET source_id=? WHERE id=?').run(source.id, run.id);
      updateItem(db, run.id, 'lifecycle:header', 'source', source.source_key);
    }

    const rowsByKey = new Map(context.normalized.posted_rows.map((row) => [row.client_item_key, row]));
    const matchedByRow = new Map(currentPlan.matched.map((item) => [item.client_item_key, item]));
    const newRows = new Set(currentPlan.new.map((item) => item.client_item_key));
    const committedRows = [];
    for (const [clientItemKey, row] of rowsByKey) {
      const match = matchedByRow.get(clientItemKey);
      if (match) {
        promoteMatchedRow(db, run, row, match, source, actor, now);
        updateItem(db, run.id, `lifecycle:row:${clientItemKey}`, 'credit_card_lifecycle_match', match.transaction_key);
        committedRows.push({ client_item_key: clientItemKey, transaction_key: match.transaction_key, outcome: 'matched', match_basis: match.match_basis });
      } else if (newRows.has(clientItemKey)) {
        const created = createCashActivity(rowAsCashInput(row, context.normalized.account_key, source.source_key), actor, db, run.id, clientItemKey);
        updateItem(db, run.id, `lifecycle:row:${clientItemKey}`, 'cash_transaction', created.transaction_key);
        committedRows.push({ client_item_key: clientItemKey, transaction_key: created.transaction_key, outcome: 'new' });
      }
    }

    for (const item of currentPlan.released) {
      releaseAuthorization(db, run, item.transaction_key, actor, now);
      updateItem(db, run.id, `lifecycle:release:${item.transaction_key}`, 'credit_card_lifecycle_release', item.transaction_key);
    }
    for (const item of currentPlan.source_supersessions) {
      supersedeSource(db, run, item.source_key, actor, now);
      updateItem(db, run.id, `lifecycle:supersede:${item.source_key}`, 'credit_card_source_supersession', item.source_key);
    }

    const result = {
      schema_id: SCHEMA_ID,
      impact_hash: currentPlan.impact_hash,
      counts: currentPlan.counts,
      posted_source_key: source.source_key,
      rows: committedRows,
      released_transaction_keys: currentPlan.released.map((item) => item.transaction_key),
      superseded_source_keys: currentPlan.source_supersessions.map((item) => item.source_key),
    };
    db.prepare("UPDATE ingestion_run_contexts SET status='committed',result_json=? WHERE ingestion_run_id=? AND context_kind=?")
      .run(JSON.stringify(result), run.id, CONTEXT_KIND);
    db.prepare("UPDATE ingestion_runs SET status='committed',committed_at=?,expires_at=NULL,result_json=?,warnings_json='[]',errors_json='[]',updated_at=? WHERE id=?")
      .run(now.toISOString(), JSON.stringify(result), now.toISOString(), run.id);
    logChange(db, {
      resourceType: 'ingestion_run', resourceKey: runKey, action: 'commit', after: result,
      actorType: actor.type, actorNote: actor.note,
    });
    return ingestionRun(runKey, db);
  });
}

module.exports = { SCHEMA_ID, CONTEXT_KIND, previewCardLifecycle, commitCardLifecycle, buildLifecyclePlan };
