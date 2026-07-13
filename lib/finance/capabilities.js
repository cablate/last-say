const { ENUMS, SUPPORTED_CURRENCIES, SCHEMAS } = require('./contracts');

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
    supported_contexts: ['shared_kernel', 'identity', 'source_evidence', 'scope', 'source_expectation', 'account_balance', 'cash_activity'],
    mutations: {
      typed_only: true,
      optimistic_version: true,
      preview_commit_available: true,
      high_risk_confirmation_required: ENUMS.high_risk_action,
    },
    limits: { text: 1000, batch_items: 500, page_size: 200, decimal_characters: 80 },
    readiness_goals: ENUMS.analysis_goal,
    unsupported: ['options', 'futures', 'margin', 'defi', 'tax_lots', 'business_consolidation', 'arbitrary_sql', 'generic_records', 'server_side_url_fetch'],
  };
}

module.exports = { getFinanceCapabilities };
