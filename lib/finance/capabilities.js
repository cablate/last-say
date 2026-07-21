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
      'credit_card_installment', 'credit_card_payment_match', 'credit_card_transaction_lifecycle', 'liability',
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
    analysis_read_models: {
      financial_health_review: {
        route: '/api/finance/control/financial-health',
        schema_version: 'finance.analysis-read-model/v1',
        formula_version: 'financial-health-review/1',
        inputs: ['entity_id', 'as_of_date', 'currency', 'taiwan_instrument_keys', 'taiwan_leverage_factor'],
        read_only: true,
        ai_math: false,
      },
      spending_structure: {
        route: '/api/finance/control/spending-structure',
        schema_version: 'finance.analysis-read-model/v1',
        formula_version: 'spending-structure/1',
        inputs: ['month', 'entity_id', 'currency', 'basis'],
        read_only: true,
        ai_math: false,
      },
      financial_dashboard_history: {
        route: '/api/finance/control/history',
        schema_version: 'finance.analysis-read-model/v1',
        formula_version: 'financial-dashboard-history/1',
        inputs: ['month', 'entity_id', 'currency', 'basis'],
        completed_months: 6,
        read_only: true,
        ai_math: false,
      },
      obligation_timeline: {
        route: '/api/finance/control/obligations',
        schema_version: 'finance.analysis-read-model/v1',
        formula_version: 'obligation-timeline/1',
        inputs: ['as_of_date', 'entity_id', 'currency', 'horizon_days'],
        read_only: true,
        ai_math: false,
      },
      cash_forecast: {
        route: '/api/finance/control/forecast',
        schema_version: 'finance.analysis-read-model/v1',
        formula_version: 'cash-forecast/1',
        inputs: ['as_of_date', 'entity_id', 'currency', 'horizon_days'],
        read_only: true,
        ai_math: false,
      },
    },
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
