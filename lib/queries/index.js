// queries 匯整：re-export 所有子模組，維持 `@/lib/queries` / `require('../lib/queries')` 相容。
// 外部（api routes / scripts / components）import 路徑不變，只重構內部分檔。
const core = require('./core');
const transactions = require('./transactions');
const rules = require('./rules');
const corrections = require('./corrections');
const review = require('./review');

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
  // review
  ...review,
};
