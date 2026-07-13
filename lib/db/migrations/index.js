const legacyBaseline = require('./0001-legacy-baseline');
const financialSharedKernel = require('./0002-financial-shared-kernel');
const ingestionAndBalances = require('./0003-ingestion-and-balances');

const MIGRATIONS = Object.freeze([legacyBaseline, financialSharedKernel, ingestionAndBalances]);

module.exports = { MIGRATIONS };
