const { FinanceError, enumValue, isoDate } = require('../../finance/contracts');
const { getDb, requireRow } = require('./common');
const { listAccounts } = require('./accounts');
const { listSources } = require('./sources');
const { latestBalanceForAccount } = require('./balances');
const { coarseScopeStatus } = require('./scope');
const { activeRecordSql } = require('../../finance/active-records');

function localDate() { return new Date().toLocaleDateString('en-CA'); }

function dayDiff(later, earlier) {
  return Math.floor((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86400000);
}

function expectationGaps(goal, entityKey, asOfDate, db) {
  const rows = db.prepare(`SELECT x.*,a.account_key FROM source_expectations x
    JOIN reporting_entities e ON e.id=x.entity_id LEFT JOIN accounts a ON a.id=x.account_id
    JOIN source_expectation_goals g ON g.expectation_id=x.id
    WHERE e.entity_key=? AND g.goal_key=? AND x.active=1`).all(entityKey, goal);
  const hard = []; const candidates = [];
  for (const expectation of rows) {
    const latest = db.prepare(`SELECT source_key,COALESCE(period_end,substr(as_of_at,1,10),substr(observed_at,1,10),substr(imported_at,1,10)) AS evidence_date
      FROM sources WHERE status='active' AND source_kind=? AND (? IS NULL OR account_id=?) ORDER BY evidence_date DESC,id DESC LIMIT 1`).get(expectation.expected_source_kind, expectation.account_id, expectation.account_id);
    let gap = null;
    if (!latest?.evidence_date) gap = 'missing_expected_source';
    else if (expectation.cadence === 'monthly' && dayDiff(asOfDate, latest.evidence_date) > 31 + Number(expectation.grace_days || 0)) gap = 'expected_source_overdue';
    if (!gap) continue;
    const item = { expectation_key: expectation.expectation_key, account_key: expectation.account_key, expected_source_kind: expectation.expected_source_kind, gap, latest_evidence_date: latest?.evidence_date || null };
    if (['official', 'user_confirmed'].includes(expectation.authority) && expectation.review_state === 'confirmed') hard.push(item); else candidates.push(item);
  }
  return { hard, candidates };
}

function readinessForGoal(goal, { entityKey = 'personal', asOfDate = localDate() } = {}, db = getDb()) {
  enumValue(goal, 'analysis_goal', 'goal'); isoDate(asOfDate, 'as_of');
  requireRow(db.prepare('SELECT * FROM reporting_entities WHERE entity_key=?').get(entityKey), 'Entity');
  const expectations = expectationGaps(goal, entityKey, asOfDate, db);
  if (goal === 'spending_history') {
    const coverage = db.prepare(`SELECT COUNT(*) AS rows,MIN(transaction_date) AS period_start,MAX(transaction_date) AS period_end FROM transactions WHERE ${activeRecordSql()}`).get();
    const gaps = [...expectations.hard];
    if (!coverage.rows) gaps.unshift({ gap: 'no_cash_activity' });
    return { goal, status: gaps.length ? (coverage.rows ? 'partial' : 'empty') : 'complete', as_of_date: asOfDate, gaps, candidate_gaps: expectations.candidates, evidence: { transaction_rows: coverage.rows, period_start: coverage.period_start, period_end: coverage.period_end } };
  }
  if (goal === 'cash_position') {
    const accounts = listAccounts({ entity_key: entityKey, active: true }, db).filter((account) => account.included_in_analysis && ['cash', 'bank', 'e_wallet'].includes(account.account_kind));
    const balances = accounts.map((account) => ({ account_key: account.account_key, display_name: account.display_name, ...latestBalanceForAccount(account.account_key, { asOfDate }, db) }));
    const scope = coarseScopeStatus({ entityKey, scopeKind: 'cash_accounts' }, db); const gaps = [...expectations.hard];
    if (!accounts.length) gaps.push({ gap: 'no_cash_accounts' });
    if (scope.status !== 'complete') gaps.push({ gap: scope.gap, attestation_key: scope.attestation_key || null });
    for (const balance of balances) if (balance.status !== 'current') gaps.push({ gap: `balance_${balance.status}`, account_key: balance.account_key });
    const hasConflict = balances.some((balance) => balance.status === 'conflicted'); const hasStale = balances.some((balance) => balance.status === 'stale');
    return { goal, status: hasConflict ? 'conflicted' : (hasStale ? 'stale' : (gaps.length ? (accounts.length ? 'partial' : 'empty') : 'complete')), as_of_date: asOfDate, gaps, candidate_gaps: expectations.candidates, scope, accounts: balances };
  }
  return { goal, status: 'unsupported', as_of_date: asOfDate, gaps: [{ gap: 'goal_not_available_until_later_phase' }], candidate_gaps: expectations.candidates };
}

function getFinanceInventory({ entityKey = 'personal', asOfDate = localDate() } = {}, db = getDb()) {
  isoDate(asOfDate, 'as_of');
  const entity = requireRow(db.prepare('SELECT * FROM reporting_entities WHERE entity_key=?').get(entityKey), 'Entity');
  const accounts = listAccounts({ entity_key: entityKey }, db).map((account) => ({ ...account, balance: account.active && account.included_in_analysis ? latestBalanceForAccount(account.account_key, { asOfDate }, db) : null }));
  const transactionCoverage = db.prepare(`SELECT COUNT(*) AS rows,MIN(transaction_date) AS period_start,MAX(transaction_date) AS period_end,COUNT(DISTINCT transaction_month) AS months FROM transactions WHERE ${activeRecordSql()}`).get();
  return { api_version: 'finance/v1', as_of_date: asOfDate, entity, accounts, sources: listSources({}, db), transaction_coverage: transactionCoverage, readiness: { spending_history: readinessForGoal('spending_history', { entityKey, asOfDate }, db), cash_position: readinessForGoal('cash_position', { entityKey, asOfDate }, db) } };
}

module.exports = { expectationGaps, readinessForGoal, getFinanceInventory };
