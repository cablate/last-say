const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, initializeDatabase } = require('../lib/db');
const { analysisContext } = require('../lib/queries/finance/analysis-context');
const { getFinanceCapabilities } = require('../lib/finance/capabilities');
const {
  aggregateHistory,
  completedMonthKeys,
  getFinancialDashboardHistory,
} = require('../lib/queries/finance/control/history');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-dashboard-history-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('dashboard history excludes the current partial month', () => {
  assert.deepEqual(
    completedMonthKeys('2026-07', '2026-07'),
    ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
  );
  assert.deepEqual(
    completedMonthKeys('2026-04', '2026-07'),
    ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'],
  );
});

test('dashboard history averages non-null facts and keeps per-metric sample counts', () => {
  const result = aggregateHistory([
    { confirmed_revenue_minor: '100', confirmed_expense_minor: '60', net_result_minor: '40', net_cash_change_minor: null },
    { confirmed_revenue_minor: '200', confirmed_expense_minor: '80', net_result_minor: '120', net_cash_change_minor: '110' },
    { confirmed_revenue_minor: null, confirmed_expense_minor: '100', net_result_minor: null, net_cash_change_minor: '90' },
  ]);

  assert.equal(result.average_confirmed_revenue_minor, '150');
  assert.equal(result.average_confirmed_expense_minor, '80');
  assert.equal(result.average_net_result_minor, '80');
  assert.equal(result.average_net_cash_change_minor, '100');
  assert.deepEqual(result.sample_counts, {
    confirmed_revenue: 2,
    confirmed_expense: 3,
    net_result: 2,
    net_cash_change: 2,
  });
});

test('dashboard history is deterministic and available to bounded AI analysis context', () => fixture((db) => {
  const query = new URLSearchParams({ month: '2026-07', entity_id: 'personal', currency: 'TWD' });
  const first = getFinancialDashboardHistory(query, db, { currentMonth: '2026-07' });
  const second = getFinancialDashboardHistory(query, db, { currentMonth: '2026-07' });
  assert.deepEqual(second, first);
  assert.equal(first.analysis_id, 'financial_dashboard_history');
  assert.equal(first.facts.months.length, 6);
  assert.equal(first.coverage.status, 'empty');

  const context = analysisContext({
    entity: 'personal',
    as_of: '2026-07-21',
    datasets: [{ name: 'financial_dashboard_history', month: '2026-07', currency: 'TWD' }],
  }, db);
  assert.equal(context.datasets[0].data.analysis_id, 'financial_dashboard_history');
  assert.ok(getFinanceCapabilities().analysis_context.datasets.financial_dashboard_history);
  assert.equal(getFinanceCapabilities().analysis_read_models.financial_dashboard_history.ai_math, false);
}));
