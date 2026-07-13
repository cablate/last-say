const ENUMS = Object.freeze({
  authority: Object.freeze(['official', 'institution_export', 'user_confirmed', 'ai_researched', 'ai_inferred', 'estimated']),
  review_state: Object.freeze(['needs_review', 'reviewed', 'confirmed', 'rejected']),
  record_status: Object.freeze(['provisional', 'posted', 'confirmed', 'superseded', 'reversed', 'archived']),
  entity_type: Object.freeze(['personal', 'business', 'household', 'other']),
  institution_type: Object.freeze(['bank', 'credit_union', 'card_issuer', 'brokerage', 'lender', 'wallet_provider', 'other']),
  account_kind: Object.freeze(['cash', 'bank', 'credit_card', 'loan', 'investment', 'e_wallet', 'receivable', 'payable', 'fixed_asset', 'equity', 'other']),
  normal_balance: Object.freeze(['debit', 'credit']),
  liquidity_class: Object.freeze(['liquid', 'near_liquid', 'non_liquid', 'not_applicable']),
  alias_type: Object.freeze(['source_account_id', 'masked_number', 'statement_label', 'legacy_name', 'other']),
  source_kind: Object.freeze(['bank_statement_csv', 'credit_card_statement_csv', 'current_transactions_csv', 'loan_contract', 'loan_statement', 'brokerage_statement', 'market_quote_evidence', 'fx_quote_evidence', 'manual_note', 'legacy_import', 'other']),
  source_status: Object.freeze(['active', 'superseded', 'reversed', 'archived']),
  artifact_status: Object.freeze(['available', 'missing', 'purged', 'external-only']),
  scope_kind: Object.freeze(['cash_accounts', 'credit_cards', 'liabilities', 'investments', 'valued_items']),
  coverage_state: Object.freeze(['declared_complete', 'declared_partial', 'unknown']),
  target_context: Object.freeze(['cash_activity', 'account_balance', 'credit_card', 'liability', 'commitment', 'investment', 'valuation', 'valued_item']),
  cadence: Object.freeze(['one_time', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom_dates']),
  analysis_goal: Object.freeze(['spending_history', 'cash_position', 'net_worth', 'debt_obligations', 'investment_value', 'cash_flow_statement', 'liquidity_forecast_90d', 'tax_or_derivatives']),
  readiness_status: Object.freeze(['empty', 'partial', 'stale', 'conflicted', 'unreconciled', 'complete', 'unsupported']),
  error_code: Object.freeze(['VALIDATION_ERROR', 'UNKNOWN_SCHEMA', 'IDENTITY_CONFLICT', 'VERSION_CONFLICT', 'DUPLICATE', 'SOURCE_REQUIRED', 'REVIEW_REQUIRED', 'HUMAN_CONFIRMATION_REQUIRED', 'UNSUPPORTED_CONTEXT', 'NOT_FOUND', 'DB_UNAVAILABLE']),
  high_risk_action: Object.freeze(['declare_scope_complete', 'merge_institution', 'merge_account', 'merge_instrument', 'reverse_ingestion_run', 'replace_active_database']),
  balance_kind: Object.freeze(['ledger', 'available', 'statement', 'unbilled', 'principal', 'cash', 'market_value', 'other']),
  ingestion_bundle_kind: Object.freeze(['account_snapshot', 'cash_activity', 'card_statement', 'liability_context', 'commitment_context', 'mixed']),
  ingestion_context: Object.freeze([
    'accounts', 'sources', 'balance_snapshots', 'cash_transactions',
    'credit_card_profiles', 'credit_card_statements', 'credit_card_installments',
    'credit_card_payment_matches', 'liabilities', 'loan_schedules',
    'loan_allocations', 'commitments', 'commitment_occurrences',
  ]),
  rate_type: Object.freeze(['fixed', 'variable_reported', 'unknown']),
  payment_frequency: Object.freeze(['weekly', 'monthly', 'quarterly', 'yearly', 'irregular']),
  amount_kind: Object.freeze(['fixed', 'range', 'unknown']),
  obligation_status: Object.freeze(['provisional', 'scheduled', 'due', 'settled', 'cancelled', 'unreconciled']),
});

const SUPPORTED_CURRENCIES = Object.freeze(['TWD', 'USD', 'JPY', 'EUR', 'GBP', 'CNY', 'HKD']);

module.exports = { ENUMS, SUPPORTED_CURRENCIES };
