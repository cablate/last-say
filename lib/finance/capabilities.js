const { ENUMS, SUPPORTED_CURRENCIES, SCHEMAS } = require('./contracts');
const { DATASETS, MAX_DATASETS, MAX_RESPONSE_BYTES } = require('./analysis/registry');
const { POLICY_VERSION } = require('./readiness/policy');
const { PROPOSAL_SCHEMA_ID } = require('./analysis/proposal-envelope');

function getFinanceCapabilities() {
  return {
    api_version: 'finance/v1',
    schema_version: 1,
    schemas: Object.fromEntries(Object.entries(SCHEMAS).map(([name, schema]) => [name, schema.$id])),
    enums: ENUMS,
    currencies: SUPPORTED_CURRENCIES,
    representation: {
      money: 'integer minor units; JSON integer string when unsafe for JavaScript Number',
      decimal: 'canonical decimal string; never binary float',
      date: 'YYYY-MM-DD',
      optimistic_version: true,
    },
    supported_contexts: [
      'shared_kernel', 'identity', 'source_evidence', 'scope', 'source_expectation',
      'account_balance', 'cash_activity', 'credit_card', 'credit_card_statement',
      'credit_card_installment', 'credit_card_payment_match', 'liability',
      'loan_schedule', 'loan_payment_allocation', 'commitment',
      'instrument', 'investment_trade', 'holding_snapshot', 'market_quote',
      'fx_quote', 'investment_cash_match', 'deterministic_valuation',
      'valued_item', 'valuation_snapshot', 'transfer_match', 'source_conflict',
      'reimbursement_match', 'review_task', 'typed_identity_merge', 'identity_redirect',
    ],
    mutations: {
      typed_only: true,
      optimistic_version: true,
      preview_commit_available: true,
      high_risk_confirmation_required: ENUMS.high_risk_action,
    },
    limits: { text: 1000, batch_items: 500, page_size: 200, decimal_characters: 80 },
    readiness_goals: ENUMS.analysis_goal,
    readiness_policy_version: POLICY_VERSION,
    analysis_context: { datasets: DATASETS, max_datasets: MAX_DATASETS, max_response_bytes: MAX_RESPONSE_BYTES, arbitrary_sql: false },
    proposal_envelope: { schema_id: PROPOSAL_SCHEMA_ID, canonical_write: false, typed_owner_required: true },
    reports: {
      management_pl: { route: '/api/reports/income-statement', basis: ['card_accrual_management'] },
      balance_sheet: { route: '/api/reports/balance-sheet', basis: ['management_snapshot'] },
      cash_flow: { route: '/api/reports/cash-flow', basis: ['direct_method'] },
      coverage_contract: 'finance.report-coverage/v1',
    },
    unsupported: ['options', 'futures', 'margin', 'defi', 'tax_lots', 'business_consolidation', 'arbitrary_sql', 'generic_records', 'server_side_url_fetch'],
  };
}

module.exports = { getFinanceCapabilities };
