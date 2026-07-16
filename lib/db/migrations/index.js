const legacyBaseline = require('./0001-legacy-baseline');
const financialSharedKernel = require('./0002-financial-shared-kernel');
const ingestionAndBalances = require('./0003-ingestion-and-balances');
const obligations = require('./0004-obligations');
const investments = require('./0005-investments');
const reconciliation = require('./0006-reconciliation');
const reimbursementMatching = require('./0007-reimbursement-matching');
const obligationIngestionLifecycle = require('./0008-obligation-ingestion-lifecycle');
const transferMatchLifecycle = require('./0009-transfer-match-lifecycle');
const sourceConflictReviewContext = require('./0010-source-conflict-review-context');

const MIGRATIONS = Object.freeze([legacyBaseline, financialSharedKernel, ingestionAndBalances, obligations, investments, reconciliation, reimbursementMatching, obligationIngestionLifecycle, transferMatchLifecycle, sourceConflictReviewContext]);

module.exports = { MIGRATIONS };
