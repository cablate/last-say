import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const fixture = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'test', 'fixtures', 'financial-control', 'monthly-financial-pulse.json'),
  'utf8',
));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const completeHealth = {
  coverage: { status: 'complete', blockers: [], warnings: [] },
  facts: {
    position: {
      total_assets_minor: '30000000',
      total_liabilities_minor: '7200000',
      net_worth_minor: '22800000',
    },
    liquidity: { cash_minor: '22800000' },
    investments: {
      balance_sheet_investment_value_minor: '900000',
      factor_exposure_minor: '1800000',
      selected_instrument_keys: ['instrument:synthetic'],
      largest_positions: [{ instrument_key: 'instrument:synthetic', symbol: 'SYNTHETIC' }],
    },
  },
  derived: { stress_tests: [] },
};

const completeSpending = {
  coverage: { status: 'complete', blockers: [], warnings: [] },
  facts: {
    confirmed_commitments: [
      { cadence: 'monthly', amount_kind: 'fixed', amount_minor: '1600000', currency: 'TWD' },
    ],
    proposed_reimbursements: [],
  },
};

const completeHistory = {
  coverage: { status: 'complete', warnings: [], missing_inputs: [] },
  facts: {
    months: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
      .map((month) => ({ month, coverage_status: 'complete' })),
  },
  derived: {
    average_confirmed_revenue_minor: '9000000',
    average_confirmed_expense_minor: '5500000',
    average_net_result_minor: '3500000',
    average_net_cash_change_minor: '2800000',
    sample_counts: { confirmed_revenue: 6, confirmed_expense: 6, net_result: 6, net_cash_change: 6 },
  },
};

async function routeMeta(page) {
  await page.route('**/api/meta', (route) => route.fulfill({
    json: {
      generatedAt: '2026-07-17T00:00:00.000Z',
      counts: { transactions: 2, sourceLinks: 2, sources: 2, accounts: 2, needsReview: 0, ownerUnresolved: 0 },
      months: { transaction: [{ month: '2026-06', rows: 2 }] },
      standardCategories: [],
      filters: { sources: [], categories: [], flows: [] },
    },
  }));
}

test('monthly pulse renders server-computed totals and report drillbacks', async ({ page }) => {
  const pageErrors = [];
  let healthRequestUrl;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await routeMeta(page);
  await page.route('**/api/finance/control/monthly-pulse**', (route) => route.fulfill({ json: fixture.expected }));
  await page.route('**/api/finance/control/financial-health**', (route) => {
    healthRequestUrl = new URL(route.request().url());
    return route.fulfill({ json: completeHealth });
  });
  await page.route('**/api/finance/control/spending-structure**', (route) => route.fulfill({ json: completeSpending }));
  await page.route('**/api/finance/control/history**', (route) => route.fulfill({ json: completeHistory }));

  await page.goto('/control?month=2026-06&taiwan_instrument_keys=instrument%3Asynthetic&taiwan_leverage_factor=2');

  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '財務儀表板', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '資產大於負債，主要資料已可使用' })).toBeVisible();

  const primaryNumbers = page.getByRole('region', { name: '主要財務數字' });
  await expect(primaryNumbers).toContainText('淨資產');
  await expect(primaryNumbers).toContainText('NT$228,000');
  await expect(primaryNumbers).toContainText('確認負債');
  await expect(primaryNumbers).toContainText('NT$72,000');
  await expect(primaryNumbers).toContainText('投資總市值');
  await expect(primaryNumbers).toContainText('NT$9,000');

  const incomePanel = page.getByRole('heading', { name: '每月收支能力' }).locator('xpath=ancestor::section[1]');
  await expect(incomePanel).toContainText('帳戶現金增減');
  await expect(incomePanel).toContainText('+NT$28,000');
  await expect(incomePanel).toContainText('收入 − 支出');
  await expect(incomePanel).toContainText('+NT$35,000');
  await expect(incomePanel).toContainText('已建檔固定生活義務');
  await expect(incomePanel).toContainText('NT$16,000');
  await expect(incomePanel.getByRole('link', { name: '收支明細' })).toHaveAttribute('href', '/reports?statement=income&month=2026-06');

  await expect(page.getByRole('heading', { name: '負債狀況' })).toBeVisible();
  expect(healthRequestUrl.searchParams.get('taiwan_instrument_keys')).toBe('instrument:synthetic');
  expect(healthRequestUrl.searchParams.get('taiwan_leverage_factor')).toBe('2');
  await expect(page.getByText('SYNTHETIC市值 × 2（此頁情境）')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('dashboard preserves loading, error, retry and partial-data states', async ({ page }) => {
  await routeMeta(page);
  const calls = { pulse: 0, health: 0, spending: 0, history: 0 };
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const partial = clone(fixture.expected);
  partial.coverage.status = 'partial';
  partial.coverage.blockers = [{
    kind: 'missing_balance_snapshot',
    source: 'cash_flow',
    resource_key: 'account:synthetic-checking',
    label: 'Synthetic ending balance is missing.',
  }];
  partial.facts.cash_flow.ending_cash_minor = null;
  partial.facts.cash_flow.reconciliation_delta_minor = null;

  await page.route('**/api/finance/control/monthly-pulse**', async (route) => {
    calls.pulse += 1;
    if (calls.pulse === 1) {
      await firstGate;
      await route.fulfill({
        status: 500,
        json: { error: { code: 'DB_UNAVAILABLE', message: 'Synthetic pulse unavailable.', retryable: true } },
      });
      return;
    }
    await route.fulfill({ json: partial });
  });
  await page.route('**/api/finance/control/financial-health**', async (route) => {
    calls.health += 1;
    if (calls.health === 1) await firstGate;
    await route.fulfill({ json: completeHealth });
  });
  await page.route('**/api/finance/control/spending-structure**', async (route) => {
    calls.spending += 1;
    if (calls.spending === 1) await firstGate;
    await route.fulfill({ json: completeSpending });
  });
  await page.route('**/api/finance/control/history**', async (route) => {
    calls.history += 1;
    if (calls.history === 1) await firstGate;
    await route.fulfill({ json: completeHistory });
  });

  await page.goto('/control?month=2026-06');
  await expect(page.getByLabel('正在載入財務儀表板')).toBeVisible();
  releaseFirst();
  await expect(page.getByText('部分資料暫時讀取失敗，畫面只顯示目前取得的內容。')).toBeVisible();
  await page.getByRole('button', { name: '重新整理' }).click();

  await expect(page.getByRole('heading', { name: '資產大於負債，仍有資料待補齊' })).toBeVisible();
  await expect(page.getByText('補齊月份邊界餘額')).toBeVisible();
  expect(calls.pulse).toBe(2);
  expect(calls.history).toBe(2);
});
