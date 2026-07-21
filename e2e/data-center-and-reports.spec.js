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

  await createAccount(page, { name: '日圓現金測試', kind: '現金', currency: '日圓' });
  const jpyAccount = page.getByRole('article').filter({ hasText: '日圓現金測試' });
  await jpyAccount.getByRole('button', { name: '更新餘額' }).click();
  const balanceDialog = page.getByRole('dialog', { name: '更新餘額' });
  await balanceDialog.getByLabel('餘額（日圓）').fill('123456');
  await balanceDialog.getByRole('button', { name: '新增餘額快照' }).click();
  await expect(balanceDialog).toBeHidden();
  await expect(jpyAccount).toContainText('123,456');
  await expect(jpyAccount).not.toContainText('1,234.56');

  await createAccount(page, { name: '貸款測試', kind: '貸款', currency: '新台幣' });
  await createAccount(page, { name: '券商測試', kind: '投資帳戶', currency: '新台幣' });

  await page.getByRole('tab', { name: '投資估值' }).click();
  await page.getByRole('button', { name: '投資工具' }).click();
  let dialog = page.getByRole('dialog', { name: '新增投資工具' });
  await dialog.getByLabel('工具名稱').fill('日本基金測試');
  await choose(page, dialog, '報價幣別', '日圓');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '持倉快照' }).click();
  dialog = page.getByRole('dialog', { name: '新增持倉快照' });
  await choose(page, dialog, '投資帳戶', '券商測試 · 新台幣');
  await choose(page, dialog, '投資工具', '日本基金測試 · 日圓');
  await dialog.getByLabel('持有數量').fill('2');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('article').filter({ hasText: '日本基金測試' })).toContainText('缺報價');

  await page.getByRole('button', { name: '市場報價' }).click();
  dialog = page.getByRole('dialog', { name: '新增市場報價' });
  await choose(page, dialog, '投資工具', '日本基金測試 · 日圓');
  await dialog.getByLabel('每單位價格（日圓）').fill('1000');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '匯率' }).click();
  dialog = page.getByRole('dialog', { name: '新增匯率' });
  await choose(page, dialog, '基準幣', '日圓');
  await dialog.getByLabel('匯率', { exact: true }).fill('0.22');
  await dialog.getByRole('button', { name: '儲存', exact: true }).click();
  await expect(dialog).toBeHidden();
  const position = page.getByRole('article').filter({ hasText: '日本基金測試' });
  await expect(position).toContainText('估值可用');
  await expect(position).toContainText('440.00');

  await page.goto('/reports?statement=balance');
  await expect(page.getByText('資產合計', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: /日圓現金測試/ })).toBeVisible();
  await expect(page.getByText('這張報表可預覽，但仍不完整')).toBeVisible();
  await page.getByRole('tab', { name: '現金流量表' }).click();
  await expect(page.getByText('這個期間沒有可列入現金流量表的活動')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
