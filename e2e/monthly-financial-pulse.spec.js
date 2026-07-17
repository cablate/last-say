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
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await routeMeta(page);
  await page.route('**/api/finance/control/monthly-pulse**', (route) => route.fulfill({ json: fixture.expected }));

  await page.goto('/control?month=2026-06');

  await expect(page.getByRole('heading', { name: '月度財務脈搏', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: '管理淨收支' })).toContainText('35,000');
  await expect(page.getByRole('article', { name: '現金淨變動' })).toContainText('28,000');
  await expect(page.getByRole('article', { name: '期末現金' })).toContainText('228,000');
  await expect(page.getByRole('article', { name: '已確認義務清償' })).toContainText('30,800');
  await expect(page.getByText('差額為')).toContainText('7,000');
  await expect(page.getByRole('link', { name: '查看損益表' })).toHaveAttribute('href', '/reports?month=2026-06&statement=income');
  await expect(page.getByRole('link', { name: '查看現金流量表' })).toHaveAttribute('href', '/reports?month=2026-06&statement=cash');
  expect(pageErrors).toEqual([]);
});

test('monthly pulse preserves loading, error, retry and partial unknown states', async ({ page }) => {
  await routeMeta(page);
  let calls = 0;
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
    calls += 1;
    if (calls === 1) {
      await firstGate;
      await route.fulfill({
        status: 500,
        json: { error: { code: 'DB_UNAVAILABLE', message: 'Synthetic pulse unavailable.', retryable: true } },
      });
      return;
    }
    await route.fulfill({ json: partial });
  });

  await page.goto('/control?month=2026-06');
  await expect(page.getByLabel('正在載入月度財務脈搏')).toBeVisible();
  releaseFirst();
  await expect(page.getByText('月度財務脈搏載入失敗')).toBeVisible();
  await expect(page.getByText('Synthetic pulse unavailable.')).toBeVisible();
  await page.getByRole('button', { name: '重新整理' }).click();

  await expect(page.getByText('資料仍不完整，但已知數字可以先看')).toBeVisible();
  await expect(page.getByText('Synthetic ending balance is missing.')).toBeVisible();
  await expect(page.getByRole('article', { name: '期末現金' })).toContainText('未知');
  expect(calls).toBe(2);
});
