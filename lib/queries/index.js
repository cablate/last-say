// queries 匯整：re-export 所有子模組，維持 `@/lib/queries` / `require('../lib/queries')` 相容。
// 外部（api routes / scripts / components）import 路徑不變，只重構內部分檔。
const core = require('./core');
const transactions = require('./transactions');
const rules = require('./rules');
const corrections = require('./corrections');
const learning = require('./learning');
const incomeStatement = require('./reports/income-statement');
const balanceSheet = require('./reports/balance-sheet');
const cashFlow = require('./reports/cash-flow');
const reportMappings = require('./reports/mappings');
const monthlyFinancialPulse = require('./finance/control/monthly-pulse');
const financialHealthReview = require('./finance/control/financial-health');

module.exports = {
  // core（共用 helper）
  safeInt: core.safeInt,
  clamp: core.clamp,
  directionFromFlow: core.directionFromFlow,
  // transactions
  ...transactions,
  // rules
  ...rules,
  // corrections
  ...corrections,
  // learning（外部 AI 的唯讀經驗檢索）
  ...learning,
  // reports
  ...incomeStatement,
  ...balanceSheet,
  ...cashFlow,
  ...reportMappings,
  ...monthlyFinancialPulse,
  ...financialHealthReview,
};
