import { test, expect } from '@playwright/test';

async function choose(page, scope, label, option) {
  await scope.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function createAccount(page, { name, kind, currency }) {
  await page.getByRole('button', { name: '新增帳戶' }).click();
  const dialog = page.getByRole('dialog', { name: '新增帳戶' });
  await dialog.getByLabel('帳戶名稱').fill(name);
  await choose(page, dialog, '帳戶類型', kind);
  await choose(page, dialog, '幣別', currency);
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('article').filter({ hasText: name })).toBeVisible();
}

test('critical Data Center inputs and report availability are browser-verifiable', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/data');
  await expect(page.getByRole('heading', { name: '帳戶與餘額', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '帳戶與餘額' }).click();

  await createAccount(page, { name: 'E2E JPY Cash', kind: '現金', currency: 'JPY' });
  const jpyAccount = page.getByRole('article').filter({ hasText: 'E2E JPY Cash' });
  await jpyAccount.getByRole('button', { name: '更新餘額' }).click();
  const balanceDialog = page.getByRole('dialog', { name: '更新餘額' });
  await balanceDialog.getByLabel('餘額（JPY）').fill('123456');
  await balanceDialog.getByRole('button', { name: '新增 snapshot' }).click();
  await expect(balanceDialog).toBeHidden();
  await expect(jpyAccount).toContainText('123,456');
  await expect(jpyAccount).not.toContainText('1,234.56');

  await createAccount(page, { name: 'E2E Loan', kind: '貸款', currency: 'TWD' });
  await createAccount(page, { name: 'E2E Brokerage', kind: '投資帳戶', currency: 'TWD' });

  await page.getByRole('tab', { name: '投資估值' }).click();
  await page.getByRole('button', { name: '投資工具' }).click();
  let dialog = page.getByRole('dialog', { name: '新增投資工具' });
  await dialog.getByLabel('工具名稱').fill('E2E Japan Fund');
  await choose(page, dialog, '報價幣別', 'JPY');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '持倉快照' }).click();
  dialog = page.getByRole('dialog', { name: '新增持倉快照' });
  await choose(page, dialog, '投資帳戶', 'E2E Brokerage · TWD');
  await choose(page, dialog, '投資工具', 'E2E Japan Fund · JPY');
  await dialog.getByLabel('持有數量').fill('2');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('article').filter({ hasText: 'E2E Japan Fund' })).toContainText('缺報價');

  await page.getByRole('button', { name: '市場報價' }).click();
  dialog = page.getByRole('dialog', { name: '新增市場報價' });
  await choose(page, dialog, '投資工具', 'E2E Japan Fund · JPY');
  await dialog.getByLabel('每單位價格（JPY）').fill('1000');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '匯率' }).click();
  dialog = page.getByRole('dialog', { name: '新增匯率' });
  await choose(page, dialog, '基準幣', 'JPY');
  await dialog.getByLabel('匯率', { exact: true }).fill('0.22');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toBeHidden();
  const position = page.getByRole('article').filter({ hasText: 'E2E Japan Fund' });
  await expect(position).toContainText('估值可用');
  await expect(position).toContainText('440.00');

  await page.goto('/reports?statement=balance');
  await expect(page.getByText('資產負債表正式報表尚未實作')).toBeVisible();
  await expect(page.getByRole('link', { name: /前往財務資料中心/ })).toHaveAttribute('href', '/data');
  await page.getByRole('tab', { name: '現金流量表' }).click();
  await expect(page.getByText('現金流量表正式報表尚未實作')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
