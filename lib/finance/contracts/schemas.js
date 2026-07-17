const { ENUMS, SUPPORTED_CURRENCIES } = require('./enums');

const string = (options = {}) => ({ type: 'string', ...options });
const enumString = (name) => ({ type: 'string', enum: ENUMS[name] });

const SHARED_DEFINITIONS = Object.freeze({
  stable_key: string({ minLength: 1, maxLength: 100 }),
  date: string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  date_time: string({ format: 'date-time' }),
  currency: { type: 'string', enum: SUPPORTED_CURRENCIES },
  money_minor: { type: 'string', pattern: '^-?(0|[1-9]\\d*)$', maxLength: 40 },
  decimal: { type: 'string', pattern: '^-?(0|[1-9]\\d*)(\\.\\d+)?$', maxLength: 80 },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  authority: enumString('authority'),
  review_state: enumString('review_state'),
  version: { type: 'integer', minimum: 1 },
});

const SCHEMAS = Object.freeze({
  entity: {
    $id: 'finance.entity/v1', type: 'object', additionalProperties: false,
    required: ['name', 'entity_type', 'base_currency'],
    properties: { name: string({ minLength: 1, maxLength: 120 }), entity_type: enumString('entity_type'), base_currency: SHARED_DEFINITIONS.currency, active: { type: 'boolean' }, expected_version: SHARED_DEFINITIONS.version },
  },
  institution: {
    $id: 'finance.institution/v1', type: 'object', additionalProperties: false,
    required: ['display_name', 'institution_type', 'country_code'],
    properties: { display_name: string({ minLength: 1, maxLength: 160 }), institution_type: enumString('institution_type'), country_code: string({ pattern: '^[A-Z]{2}$' }), active: { type: 'boolean' }, expected_version: SHARED_DEFINITIONS.version },
  },
  institution_alias: {
    $id: 'finance.institution-alias/v1', type: 'object', additionalProperties: false,
    required: ['source_system', 'alias_value'],
    properties: { source_system: string({ minLength: 1, maxLength: 80 }), alias_value: string({ minLength: 1, maxLength: 200 }), country_hint: string({ pattern: '^[A-Z]{2}$' }), authority: SHARED_DEFINITIONS.authority, review_state: SHARED_DEFINITIONS.review_state },
  },
  account: {
    $id: 'finance.account/v1', type: 'object', additionalProperties: false,
    required: ['display_name', 'account_kind', 'currency'],
    properties: { display_name: string({ minLength: 1, maxLength: 160 }), entity_key: SHARED_DEFINITIONS.stable_key, institution_key: SHARED_DEFINITIONS.stable_key, account_kind: enumString('account_kind'), currency: SHARED_DEFINITIONS.currency, normal_balance: enumString('normal_balance'), liquidity_class: enumString('liquidity_class'), masked_number: string({ maxLength: 32 }), active: { type: 'boolean' }, included_in_analysis: { type: 'boolean' }, authority: SHARED_DEFINITIONS.authority, review_state: SHARED_DEFINITIONS.review_state, expected_version: SHARED_DEFINITIONS.version },
  },
  account_alias: {
    $id: 'finance.account-alias/v1', type: 'object', additionalProperties: false,
    required: ['source_system', 'alias_type', 'alias_value'],
    properties: { source_system: string({ minLength: 1, maxLength: 80 }), alias_type: enumString('alias_type'), alias_value: string({ minLength: 1, maxLength: 200 }), masked_hint: string({ maxLength: 32 }), confidence: SHARED_DEFINITIONS.confidence, authority: SHARED_DEFINITIONS.authority, review_state: SHARED_DEFINITIONS.review_state },
  },
  source: {
    $id: 'finance.source/v1', type: 'object', additionalProperties: false,
    required: ['source_kind', 'description', 'authority'],
    properties: { source_kind: enumString('source_kind'), source_file: string({ maxLength: 500 }), description: string({ minLength: 1, maxLength: 500 }), content_sha256: string({ pattern: '^[a-fA-F0-9]{64}$' }), period_start: SHARED_DEFINITIONS.date, period_end: SHARED_DEFINITIONS.date, as_of_at: string({ maxLength: 40 }), observed_at: string({ maxLength: 40 }), institution_key: SHARED_DEFINITIONS.stable_key, account_key: SHARED_DEFINITIONS.stable_key, is_official: { type: 'boolean' }, authority: SHARED_DEFINITIONS.authority, artifact_status: enumString('artifact_status'), review_state: SHARED_DEFINITIONS.review_state, expected_version: SHARED_DEFINITIONS.version },
  },
  scope_attestation: {
    $id: 'finance.scope-attestation/v1', type: 'object', additionalProperties: false,
    required: ['entity_key', 'scope_kind', 'as_of_date', 'coverage_state', 'authority'],
    properties: { entity_key: SHARED_DEFINITIONS.stable_key, scope_kind: enumString('scope_kind'), as_of_date: SHARED_DEFINITIONS.date, coverage_state: enumString('coverage_state'), included_note: string({ maxLength: 1000 }), excluded_note: string({ maxLength: 1000 }), valid_until: SHARED_DEFINITIONS.date, source_key: SHARED_DEFINITIONS.stable_key, authority: SHARED_DEFINITIONS.authority, review_state: SHARED_DEFINITIONS.review_state, proposal_key: SHARED_DEFINITIONS.stable_key, confirmation_receipt: string({ maxLength: 200 }) },
  },
  source_expectation: {
    $id: 'finance.source-expectation/v1', type: 'object', additionalProperties: false,
    required: ['entity_key', 'target_context', 'expected_source_kind', 'cadence', 'authority', 'goals'],
    properties: { entity_key: SHARED_DEFINITIONS.stable_key, account_key: SHARED_DEFINITIONS.stable_key, target_context: enumString('target_context'), expected_source_kind: enumString('source_kind'), cadence: enumString('cadence'), grace_days: { type: 'integer', minimum: 0, maximum: 366 }, period_anchor: string({ maxLength: 40 }), active: { type: 'boolean' }, authority: SHARED_DEFINITIONS.authority, review_state: SHARED_DEFINITIONS.review_state, goals: { type: 'array', minItems: 1, uniqueItems: true, items: enumString('analysis_goal') }, expected_version: SHARED_DEFINITIONS.version },
  },
  balance_snapshot: {
    $id: 'finance.balance-snapshot/v1', type: 'object', additionalProperties: false,
    required: ['account_key', 'as_of_date', 'observed_at', 'balance_kind', 'amount_minor', 'currency', 'authority'],
    properties: { account_key: SHARED_DEFINITIONS.stable_key, source_key: SHARED_DEFINITIONS.stable_key, as_of_date: SHARED_DEFINITIONS.date, observed_at: string({ minLength: 1, maxLength: 40 }), balance_kind: enumString('balance_kind'), amount_minor: SHARED_DEFINITIONS.money_minor, currency: SHARED_DEFINITIONS.currency, authority: SHARED_DEFINITIONS.authority, review_state: SHARED_DEFINITIONS.review_state, record_status: enumString('record_status'), note: string({ maxLength: 1000 }), supersedes_snapshot_key: SHARED_DEFINITIONS.stable_key },
  },
  cash_transaction: {
    $id: 'finance.cash-transaction/v1', type: 'object', additionalProperties: false,
    required: ['account_key', 'transaction_date', 'name', 'amount_minor', 'currency', 'flow_type', 'category_primary'],
    properties: { account_key: SHARED_DEFINITIONS.stable_key, source_key: SHARED_DEFINITIONS.stable_key, transaction_date: SHARED_DEFINITIONS.date, external_id: string({ maxLength: 200 }), name: string({ minLength: 1, maxLength: 300 }), amount_minor: SHARED_DEFINITIONS.money_minor, currency: SHARED_DEFINITIONS.currency, flow_type: string({ minLength: 1, maxLength: 100 }), category_primary: string({ minLength: 1, maxLength: 100 }), category_sub: string({ maxLength: 100 }), memo: string({ maxLength: 1000 }), judgment_reason: string({ maxLength: 1000 }), ai_confidence: SHARED_DEFINITIONS.confidence, record_status: enumString('record_status') },
  },
  ingestion_bundle: {
    $id: 'finance.ingestion-bundle/v1', type: 'object', additionalProperties: false,
    required: ['schema_id', 'idempotency_key', 'bundle_kind', 'authority', 'reason', 'sections'],
    properties: { schema_id: { const: 'finance.ingestion-bundle/v1' }, idempotency_key: string({ minLength: 1, maxLength: 160 }), source_key: SHARED_DEFINITIONS.stable_key, bundle_kind: enumString('ingestion_bundle_kind'), authority: SHARED_DEFINITIONS.authority, reason: string({ minLength: 1, maxLength: 1000 }), ai_confidence: SHARED_DEFINITIONS.confidence, sections: { type: 'object', additionalProperties: false, properties: Object.fromEntries(ENUMS.ingestion_context.map((name) => [name, { type: 'array', maxItems: 500, items: { type: 'object' } }])) } },
  },
  card_transaction_lifecycle: {
    $id: 'finance.card-transaction-lifecycle/v1', type: 'object', additionalProperties: false,
    required: ['schema_id', 'idempotency_key', 'account_key', 'authority', 'reason', 'expected_rows_total_minor', 'posted_rows'],
    properties: {
      schema_id: { const: 'finance.card-transaction-lifecycle/v1' },
      idempotency_key: string({ minLength: 1, maxLength: 160 }),
      account_key: SHARED_DEFINITIONS.stable_key,
      authority: SHARED_DEFINITIONS.authority,
      reason: string({ minLength: 1, maxLength: 1000 }),
      posted_source_key: SHARED_DEFINITIONS.stable_key,
      posted_source: { type: 'object' },
      expected_rows_total_minor: SHARED_DEFINITIONS.money_minor,
      posted_rows: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object' } },
      supersede_source_keys: { type: 'array', maxItems: 100, uniqueItems: true, items: SHARED_DEFINITIONS.stable_key },
      release_transaction_keys: { type: 'array', maxItems: 500, uniqueItems: true, items: SHARED_DEFINITIONS.stable_key },
    },
  },
  error: {
    $id: 'finance.error/v1', type: 'object', additionalProperties: false,
    required: ['error'], properties: { error: { type: 'object', additionalProperties: false, required: ['code', 'message', 'retryable'], properties: { code: enumString('error_code'), message: string({ minLength: 1, maxLength: 500 }), field: string({ maxLength: 200 }), allowed_values: { type: 'array', items: string() }, retryable: { type: 'boolean' } } } },
  },
});

module.exports = { SHARED_DEFINITIONS, SCHEMAS };
