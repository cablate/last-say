const { FinanceError, enumValue, isoDate } = require('../../finance/contracts');
const { getDb, requireRow } = require('./common');
const { listAccounts } = require('./accounts');
const { listSources } = require('./sources');
const { latestBalanceForAccount } = require('./balances');
const { coarseScopeStatus } = require('./scope');
const { activeRecordSql } = require('../../finance/active-records');
const { listCreditCards, listLiabilities, listCommitments } = require('./obligations');

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
  if (goal === 'debt_obligations') {
    const cards = listCreditCards(db).filter((item) => item.entity_key === entityKey);
    const liabilities = listLiabilities(db).filter((item) => item.entity_key === entityKey);
    const cardScope = coarseScopeStatus({ entityKey, scopeKind: 'credit_cards' }, db);
    const liabilityScope = coarseScopeStatus({ entityKey, scopeKind: 'liabilities' }, db);
    const gaps = [...expectations.hard];
    if (cardScope.status !== 'complete') gaps.push({ gap: cardScope.gap, scope_kind: 'credit_cards' });
    if (liabilityScope.status !== 'complete') gaps.push({ gap: liabilityScope.gap, scope_kind: 'liabilities' });
    for (const card of cards) {
      if (!card.statements.length) gaps.push({ gap: 'missing_credit_card_statement', account_key: card.account_key, next_action: 'import_credit_card_statement' });
    }
    for (const liability of liabilities) {
      const principal = db.prepare(`SELECT snapshot_key,as_of_date,review_state FROM account_balance_snapshots
        WHERE account_id=? AND balance_kind='principal' AND record_status IN ('provisional','posted','confirmed')
        AND as_of_date<=? ORDER BY as_of_date DESC,id DESC LIMIT 1`).get(liability.account_id, asOfDate);
      if (!principal) gaps.push({ gap: 'missing_loan_principal_balance', account_key: liability.account_key, liability_key: liability.liability_key, next_action: 'add_principal_balance_snapshot' });
    }
    const hasAnyDebt = cards.length || liabilities.length;
    return {
      goal,
      status: gaps.length ? (hasAnyDebt ? 'partial' : 'empty') : 'complete',
      as_of_date: asOfDate,
      gaps,
      candidate_gaps: expectations.candidates,
      scopes: { credit_cards: cardScope, liabilities: liabilityScope },
      evidence: { credit_card_profiles: cards.length, liability_profiles: liabilities.length },
    };
  }
  if (goal === 'liquidity_forecast_90d') {
    const cash = readinessForGoal('cash_position', { entityKey, asOfDate }, db);
    const debt = readinessForGoal('debt_obligations', { entityKey, asOfDate }, db);
    const commitments = listCommitments(db).filter((item) => item.entity_key === entityKey && item.status === 'scheduled');
    const gaps = [
      ...(cash.status === 'complete' ? [] : [{ gap: 'cash_position_not_ready', status: cash.status }]),
      ...(debt.status === 'complete' ? [] : [{ gap: 'debt_obligations_not_ready', status: debt.status }]),
      ...(!commitments.length ? [{ gap: 'no_confirmed_commitments', next_action: 'add_recurring_cash_commitments' }] : []),
    ];
    return {
      goal,
      status: 'partial',
      as_of_date: asOfDate,
      gaps,
      candidate_gaps: expectations.candidates,
      prerequisites_ready: gaps.length === 0,
      forecast_available: false,
      evidence: { cash_position: cash.status, debt_obligations: debt.status, scheduled_commitments: commitments.length },
    };
  }
  return { goal, status: 'unsupported', as_of_date: asOfDate, gaps: [{ gap: 'goal_not_available_until_later_phase' }], candidate_gaps: expectations.candidates };
}

function getFinanceInventory({ entityKey = 'personal', asOfDate = localDate() } = {}, db = getDb()) {
  isoDate(asOfDate, 'as_of');
  const entity = requireRow(db.prepare('SELECT * FROM reporting_entities WHERE entity_key=?').get(entityKey), 'Entity');
  const accounts = listAccounts({ entity_key: entityKey }, db).map((account) => ({ ...account, balance: account.active && account.included_in_analysis ? latestBalanceForAccount(account.account_key, { asOfDate }, db) : null }));
  const transactionCoverage = db.prepare(`SELECT COUNT(*) AS rows,MIN(transaction_date) AS period_start,MAX(transaction_date) AS period_end,COUNT(DISTINCT transaction_month) AS months FROM transactions WHERE ${activeRecordSql()}`).get();
  const creditCards = listCreditCards(db).filter((item) => accounts.some((account) => account.account_key === item.account_key));
  const liabilities = listLiabilities(db).filter((item) => accounts.some((account) => account.account_key === item.account_key));
  const commitments = listCommitments(db).filter((item) => item.entity_key === entityKey);
  return {
    api_version: 'finance/v1', as_of_date: asOfDate, entity, accounts, sources: listSources({}, db),
    credit_cards: creditCards, liabilities, commitments, transaction_coverage: transactionCoverage,
    readiness: {
      spending_history: readinessForGoal('spending_history', { entityKey, asOfDate }, db),
      cash_position: readinessForGoal('cash_position', { entityKey, asOfDate }, db),
      debt_obligations: readinessForGoal('debt_obligations', { entityKey, asOfDate }, db),
      liquidity_forecast_90d: readinessForGoal('liquidity_forecast_90d', { entityKey, asOfDate }, db),
    },
  };
}

module.exports = { expectationGaps, readinessForGoal, getFinanceInventory };
