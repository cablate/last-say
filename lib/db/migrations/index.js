const legacyBaseline = require('./0001-legacy-baseline');
const financialSharedKernel = require('./0002-financial-shared-kernel');
const ingestionAndBalances = require('./0003-ingestion-and-balances');
const obligations = require('./0004-obligations');

const MIGRATIONS = Object.freeze([legacyBaseline, financialSharedKernel, ingestionAndBalances, obligations]);

module.exports = { MIGRATIONS };
