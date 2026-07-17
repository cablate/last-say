const { createHash } = require('node:crypto');
const { FinanceError, assertObject, rejectUnknown, requiredString, enumValue } = require('../contracts');
const { canonicalJson } = require('../../queries/finance/human-confirmations');
const { getDb, stableKey, logChange, withTransaction, requireRow } = require('../../queries/finance/common');
const { createAccount } = require('../../queries/finance/accounts');
const { createSource } = require('../../queries/finance/sources');
const { createBalanceSnapshot } = require('../../queries/finance/balances');
const { normalizeCashActivity, validateCashActivity, createCashActivity, validateAiClassification, classifyCashActivity } = require('../../queries/finance/cash-activity');
const { validateSchemaShape } = require('../contracts');
const {
  createCreditCardProfile,
  createCardStatement,
  createInstallmentPlan,
  createCardPaymentMatch,
  createLiability,
  createLoanSchedule,
  createLoanAllocation,
  createCommitment,
  createOccurrence,
  preflightObligationPayload,
} = require('../../queries/finance/obligations');
const {
  createInstrument,
  createTrade,
  createHolding,
  createMarketQuote,
  createFxQuote,
  createInvestmentCashMatch,
} = require('../../queries/finance/investments');
const { createReimbursementMatch } = require('../../queries/finance/reimbursements');

const SCHEMA_ID = 'finance.ingestion-bundle/v1';
const SECTION_ORDER = [
  'accounts', 'sources', 'cash_transactions', 'transaction_classifications', 'balance_snapshots',
  'credit_card_profiles', 'credit_card_statements', 'credit_card_installments',
  'credit_card_payment_matches', 'liabilities', 'loan_schedules',
  'loan_allocations', 'commitments', 'commitment_occurrences',
  'instruments', 'investment_trades', 'holding_snapshots', 'market_quotes',
  'fx_quotes', 'investment_cash_matches', 'reimbursement_matches',
];
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
  if (normalized.sections.transaction_classifications.length && !['ai_researched', 'ai_inferred'].includes(normalized.authority)) {
    throw new FinanceError('VALIDATION_ERROR', 'transaction_classifications requires AI authority', { field: 'authority', allowedValues: ['ai_researched', 'ai_inferred'] });
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
  if (context === 'transaction_classifications') validateAiClassification(payload, db);
  if (['credit_card_installments', 'loan_schedules', 'loan_allocations', 'commitments'].includes(context)) preflightObligationPayload(context, payload);
  const refRequirements = {
    credit_card_profiles: ['account_client_ref'],
    credit_card_statements: ['profile_client_ref'],
    credit_card_installments: ['profile_client_ref', 'originating_transaction_client_ref'],
    credit_card_payment_matches: ['statement_client_ref', 'transaction_client_ref'],
    liabilities: ['account_client_ref'],
    loan_schedules: ['liability_client_ref'],
    loan_allocations: ['schedule_client_ref', 'transaction_client_ref'],
    commitment_occurrences: ['commitment_client_ref'],
    investment_trades: ['account_client_ref', 'instrument_client_ref', 'source_client_ref'],
    holding_snapshots: ['account_client_ref', 'instrument_client_ref', 'source_client_ref'],
    market_quotes: ['instrument_client_ref', 'source_client_ref'],
    fx_quotes: ['source_client_ref'],
    investment_cash_matches: ['trade_client_ref', 'transaction_client_ref'],
  };
  const sectionForRef = {
    account_client_ref: 'accounts', source_client_ref: 'sources', profile_client_ref: 'credit_card_profiles',
    statement_client_ref: 'credit_card_statements', originating_transaction_client_ref: 'cash_transactions',
    transaction_client_ref: 'cash_transactions', liability_client_ref: 'liabilities',
    schedule_client_ref: 'loan_schedules', commitment_client_ref: 'commitments',
    instrument_client_ref: 'instruments', trade_client_ref: 'investment_trades',
  };
  for (const ref of refRequirements[context] || []) {
    if (!item[ref] && !payload[ref.replace('_client_ref', '_key')]) {
      throw new FinanceError('VALIDATION_ERROR', `${context} requires ${ref} or a canonical key`, { field: ref });
    }
  }
  for (const [ref, target] of Object.entries(sectionForRef)) {
    if (item[ref] && !knownKeys[target].has(item[ref])) {
      throw new FinanceError('VALIDATION_ERROR', `Unresolved ${ref}: ${item[ref]}`, { field: ref });
    }
  }
  if (context === 'credit_card_statements' && Array.isArray(item.items)) {
    for (const statementItem of item.items) {
      if (statementItem.transaction_client_ref && !knownKeys.cash_transactions.has(statementItem.transaction_client_ref)) {
        throw new FinanceError('VALIDATION_ERROR', `Unresolved transaction_client_ref: ${statementItem.transaction_client_ref}`);
      }
    }
  }
  if (context === 'reimbursement_matches') {
    if (!item.reimbursement_transaction_client_ref && !payload.reimbursement_transaction_key) {
      throw new FinanceError('VALIDATION_ERROR', 'reimbursement_matches requires reimbursement_transaction_client_ref or a canonical key', { field: 'reimbursement_transaction_client_ref' });
    }
    if (item.reimbursement_transaction_client_ref && !knownKeys.cash_transactions.has(item.reimbursement_transaction_client_ref)) {
      throw new FinanceError('VALIDATION_ERROR', `Unresolved reimbursement_transaction_client_ref: ${item.reimbursement_transaction_client_ref}`, { field: 'reimbursement_transaction_client_ref' });
    }
    if (!Array.isArray(item.items) || item.items.length === 0) {
      throw new FinanceError('VALIDATION_ERROR', 'reimbursement_matches requires at least one expense allocation', { field: 'items' });
    }
    for (const [index, expenseItem] of item.items.entries()) {
      if (!expenseItem.expense_transaction_client_ref && !expenseItem.expense_transaction_key) {
        throw new FinanceError('VALIDATION_ERROR', 'Reimbursement item requires expense_transaction_client_ref or a canonical key', { field: `items[${index}]` });
      }
      if (expenseItem.expense_transaction_client_ref && !knownKeys.cash_transactions.has(expenseItem.expense_transaction_client_ref)) {
        throw new FinanceError('VALIDATION_ERROR', `Unresolved expense_transaction_client_ref: ${expenseItem.expense_transaction_client_ref}`, { field: `items[${index}].expense_transaction_client_ref` });
      }
    }
  }
  return payload;
}

function previewIngestion(input, actor = {}, db = getDb(), now = new Date()) {
  cleanupExpiredPreviews(db, now);
  if (input?.schema_id === 'finance.card-transaction-lifecycle/v1') {
    return require('./card-lifecycle').previewCardLifecycle(input, actor, db, now);
  }
  const normalized = validateBundle(input, db); const canonical = canonicalJson(normalized); const hash = sha256(canonical);
  const existing = db.prepare('SELECT * FROM ingestion_runs WHERE idempotency_key=?').get(normalized.idempotency_key);
  if (existing) {
    if (existing.payload_hash !== hash) throw new FinanceError('DUPLICATE', 'Idempotency key was already used with a different payload', { status: 409 });
    return getIngestionRun(existing.run_key, db);
  }
  const runKey = stableKey(); const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const knownKeys = Object.fromEntries(SECTION_ORDER.map((context) => [context, new Set(normalized.sections[context].map((item) => item.client_item_key))]));
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
  const refs = {
    account_client_ref: ['account_key', 'accounts'], source_client_ref: ['source_key', 'sources'],
    profile_client_ref: ['profile_key', 'credit_card_profiles'], statement_client_ref: ['statement_key', 'credit_card_statements'],
    originating_transaction_client_ref: ['originating_transaction_key', 'cash_transactions'],
    transaction_client_ref: ['transaction_key', 'cash_transactions'], liability_client_ref: ['liability_key', 'liabilities'],
    schedule_client_ref: ['schedule_key', 'loan_schedules'], commitment_client_ref: ['commitment_key', 'commitments'],
    instrument_client_ref: ['instrument_key', 'instruments'], trade_client_ref: ['trade_key', 'investment_trades'],
  };
  for (const [ref, [key, context]] of Object.entries(refs)) {
    if (value[ref]) { value[key] = maps[context].get(value[ref]); delete value[ref]; }
  }
  if (value.reimbursement_transaction_client_ref) {
    value.reimbursement_transaction_key = maps.cash_transactions.get(value.reimbursement_transaction_client_ref);
    delete value.reimbursement_transaction_client_ref;
  }
  if (Array.isArray(value.items)) {
    value.items = value.items.map((itemValue) => {
      const resolved = { ...itemValue };
      if (itemValue.transaction_client_ref) {
        resolved.transaction_key = maps.cash_transactions.get(itemValue.transaction_client_ref);
        delete resolved.transaction_client_ref;
      }
      if (itemValue.expense_transaction_client_ref) {
        resolved.expense_transaction_key = maps.cash_transactions.get(itemValue.expense_transaction_client_ref);
        delete resolved.expense_transaction_client_ref;
      }
      return resolved;
    });
  }
  return value;
}

function commitIngestion(runKey, actor = {}, db = getDb(), now = new Date()) {
  const target = requireRow(db.prepare('SELECT schema_id FROM ingestion_runs WHERE run_key=?').get(runKey), 'Ingestion run');
  if (target.schema_id === 'finance.card-transaction-lifecycle/v1') {
    return require('./card-lifecycle').commitCardLifecycle(runKey, actor, db, now);
  }
  return withTransaction(db, () => {
    const run = requireRow(db.prepare('SELECT * FROM ingestion_runs WHERE run_key=?').get(runKey), 'Ingestion run');
    if (run.status === 'committed') return getIngestionRun(runKey, db);
    if (run.status !== 'preview_ready' || Date.parse(run.expires_at) <= now.getTime()) throw new FinanceError('VERSION_CONFLICT', 'Preview is not active; create a new preview', { status: 409 });
    const items = db.prepare('SELECT * FROM ingestion_items WHERE ingestion_run_id=? ORDER BY id').all(run.id);
    if (items.some((item) => !item.staged_json)) throw new FinanceError('VERSION_CONFLICT', 'Staged payload is unavailable', { status: 409 });
    const maps = Object.fromEntries(SECTION_ORDER.map((context) => [context, new Map()])); const result = { created: {}, duplicates: 0 };
    for (const context of SECTION_ORDER) {
      const contextItems = items.filter((item) => item.context_kind === context);
      result.created[context] = [];
      for (const staged of contextItems) {
        const raw = JSON.parse(staged.staged_json); const value = resolveRefs(raw, maps); let row; let resourceType; let resourceKey;
        if (context === 'accounts') { row = createAccount(value, actor, db); db.prepare('UPDATE accounts SET ingestion_run_id=? WHERE account_key=?').run(run.id, row.account_key); resourceType = 'account'; resourceKey = row.account_key; maps.accounts.set(raw.client_item_key, resourceKey); }
        if (context === 'sources') { row = createSource(value, actor, db); db.prepare('UPDATE sources SET ingestion_run_id=? WHERE source_key=?').run(run.id, row.source_key); resourceType = 'source'; resourceKey = row.source_key; maps.sources.set(raw.client_item_key, resourceKey); }
        if (context === 'balance_snapshots') { row = createBalanceSnapshot(value, actor, db, run.id); resourceType = 'balance_snapshot'; resourceKey = row.snapshot_key; }
        if (context === 'cash_transactions') { row = createCashActivity(value, actor, db, run.id, raw.client_item_key); resourceType = 'cash_transaction'; resourceKey = row.transaction_key; }
        if (context === 'transaction_classifications') { row = classifyCashActivity(value, actor, db, run.run_key, now); resourceType = 'cash_transaction_classification'; resourceKey = row.transaction_key; }
        if (context === 'credit_card_profiles') { row = createCreditCardProfile(value, actor, db); db.prepare('UPDATE credit_card_profiles SET ingestion_run_id=? WHERE profile_key=?').run(run.id, row.profile_key); resourceType = 'credit_card_profile'; resourceKey = row.profile_key; }
        if (context === 'credit_card_statements') { row = createCardStatement(value, actor, db); db.prepare('UPDATE credit_card_statements SET ingestion_run_id=? WHERE statement_key=?').run(run.id, row.statement_key); resourceType = 'credit_card_statement'; resourceKey = row.statement_key; }
        if (context === 'credit_card_installments') { row = createInstallmentPlan(value, actor, db); db.prepare('UPDATE credit_card_installment_plans SET ingestion_run_id=? WHERE plan_key=?').run(run.id, row.plan_key); resourceType = 'credit_card_installment_plan'; resourceKey = row.plan_key; }
        if (context === 'credit_card_payment_matches') { row = createCardPaymentMatch(value, actor, db); db.prepare('UPDATE credit_card_payment_matches SET ingestion_run_id=? WHERE match_key=?').run(run.id, row.match_key); resourceType = 'credit_card_payment_match'; resourceKey = row.match_key; }
        if (context === 'liabilities') { row = createLiability(value, actor, db); db.prepare('UPDATE liability_profiles SET ingestion_run_id=? WHERE liability_key=?').run(run.id, row.liability_key); resourceType = 'liability_profile'; resourceKey = row.liability_key; }
        if (context === 'loan_schedules') {
          row = createLoanSchedule(value.liability_key, value, actor, db);
          for (const scheduleKey of row.created_schedule_keys) db.prepare('UPDATE loan_schedule_entries SET ingestion_run_id=? WHERE schedule_key=?').run(run.id, scheduleKey);
          resourceType = 'loan_schedule_batch'; resourceKey = row.created_schedule_keys.at(-1);
        }
        if (context === 'loan_allocations') { row = createLoanAllocation(value, actor, db); db.prepare('UPDATE loan_payment_allocations SET ingestion_run_id=? WHERE allocation_key=?').run(run.id, row.allocation_key); resourceType = 'loan_payment_allocation'; resourceKey = row.allocation_key; }
        if (context === 'commitments') { row = createCommitment(value, actor, db); db.prepare('UPDATE commitment_templates SET ingestion_run_id=? WHERE commitment_key=?').run(run.id, row.commitment_key); resourceType = 'commitment'; resourceKey = row.commitment_key; }
        if (context === 'commitment_occurrences') { row = createOccurrence(value.commitment_key, value, actor, db); db.prepare('UPDATE commitment_occurrences SET ingestion_run_id=? WHERE occurrence_key=?').run(run.id, row.occurrence_key); resourceType = 'commitment_occurrence'; resourceKey = row.occurrence_key; }
        if (context === 'instruments') { row = createInstrument(value, actor, db); resourceType = 'instrument'; resourceKey = row.instrument_key; }
        if (context === 'investment_trades') { row = createTrade(value, actor, db); resourceType = 'investment_trade'; resourceKey = row.trade_key; }
        if (context === 'holding_snapshots') { row = createHolding(value, actor, db); resourceType = 'holding_snapshot'; resourceKey = row.holding_key; }
        if (context === 'market_quotes') { row = createMarketQuote(value, actor, db); resourceType = 'market_quote'; resourceKey = row.quote_key; }
        if (context === 'fx_quotes') { row = createFxQuote(value, actor, db); resourceType = 'fx_quote'; resourceKey = row.fx_key; }
        if (context === 'investment_cash_matches') { row = createInvestmentCashMatch(value, actor, db); resourceType = 'investment_cash_match'; resourceKey = row.match_key; }
        if (context === 'reimbursement_matches') { row = createReimbursementMatch(value, actor, db); resourceType = 'reimbursement_match'; resourceKey = row.match_key; }
        maps[context].set(raw.client_item_key, resourceKey);
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
