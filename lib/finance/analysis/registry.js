const DATASETS = Object.freeze({
  cash_activity: Object.freeze({ filters: Object.freeze(['from','to','group_by','account_key','direction','limit','offset']), max_limit: 200, group_by: Object.freeze(['none','month']) }),
  account_balances: Object.freeze({ filters: Object.freeze(['account_key','freshness','limit','offset']), max_limit: 200 }),
  debt_obligations: Object.freeze({ filters: Object.freeze(['account_key','limit','offset']), max_limit: 100 }),
  investment_positions: Object.freeze({ filters: Object.freeze(['account_key','valuation','limit','offset']), max_limit: 200 }),
  valued_items: Object.freeze({ filters: Object.freeze(['item_type','limit','offset']), max_limit: 200 }),
  reconciliation: Object.freeze({ filters: Object.freeze([]), max_limit: 1 }),
  net_worth_inventory: Object.freeze({ filters: Object.freeze([]), max_limit: 1 }),
  transfer_candidates: Object.freeze({ filters: Object.freeze(['account_key','direction','limit','offset']), max_limit: 200 }),
  reimbursement_candidates: Object.freeze({ filters: Object.freeze(['status','limit','offset']), max_limit: 100 }),
  recurring_candidates: Object.freeze({ filters: Object.freeze(['direction','limit','offset']), max_limit: 100 }),
  installment_anomalies: Object.freeze({ filters: Object.freeze(['account_key','limit','offset']), max_limit: 100 }),
  statement_blockers: Object.freeze({ filters: Object.freeze(['account_key','limit','offset']), max_limit: 100 }),
});

const MAX_DATASETS = 8;
const MAX_RESPONSE_BYTES = 512 * 1024;

module.exports = { DATASETS, MAX_DATASETS, MAX_RESPONSE_BYTES };
