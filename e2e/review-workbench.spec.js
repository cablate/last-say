import { expect, test } from '@playwright/test';

const generatedAt = '2026-07-16T00:00:00.000Z';
const recovery = { on_stale: 'refresh', reversible: true };

const scopeConfirmation = {
  item_key: 'scope-proposal-synthetic',
  item_kind: 'scope_confirmation',
  task_key: null,
  resource: { type: 'scope_attestation', key: 'scope-synthetic', version: null, status: 'pending' },
  title: '確認合成資料範圍',
  reason: 'Synthetic scope authority requires this browser session.',
  evidence: [{ scope_kind: 'synthetic_scope', as_of_date: '2026-07-16' }],
  impact: { financial: [], timelines: ['scope'] },
  missing_evidence: [],
  before: { status: 'pending' },
  after_preview: { status: 'consumed' },
  actions: [{ kind: 'confirm_scope', label: '確認合成範圍', enabled: true }],
  recovery: { on_stale: 'refresh', reversible: false },
  expires_at: '2026-07-16T00:10:00.000Z',
};

const transferReview = {
  item_key: 'task-transfer-synthetic',
  item_kind: 'transfer_match',
  task_key: 'task-transfer-synthetic',
  resource: { type: 'transfer_match', key: 'transfer-synthetic', version: 7, status: 'proposed' },
  title: '確認合成互轉',
  reason: 'Synthetic transfer needs a human decision.',
  evidence: [
    { transaction_key: 'transaction-synthetic-a', name: 'Synthetic transfer evidence A', amount_minor: '1200', currency: 'TWD' },
    { transaction_key: 'transaction-synthetic-b', name: 'Synthetic transfer evidence B', amount_minor: '1200', currency: 'TWD' },
  ],
  impact: { financial: [{ kind: 'internal_transfer_elimination', amount_minor: '1200', currency: 'TWD' }], timelines: ['cash'] },
  missing_evidence: ['Synthetic transfer caveat.'],
  before: { match_status: 'proposed' },
  after_preview: {
    confirm: { match_status: 'confirmed', cash_effect: 'synthetic confirmed effect' },
    reject: { match_status: 'rejected', cash_effect: 'synthetic rejected effect' },
  },
  actions: [
    { kind: 'confirm', label: '確認合成互轉', enabled: true },
    { kind: 'reject', label: '拒絕合成互轉', enabled: true },
  ],
  recovery,
};

const reimbursementReview = {
  item_key: 'task-reimbursement-synthetic',
  item_kind: 'reimbursement_match',
  task_key: 'task-reimbursement-synthetic',
  resource: { type: 'reimbursement_match', key: 'reimbursement-synthetic', version: 3, status: 'proposed' },
  title: '確認合成報銷',
  reason: 'Synthetic reimbursement needs a human decision.',
  evidence: [{ transaction_key: 'transaction-synthetic-c', name: 'Synthetic reimbursement evidence', allocated_minor: '900', currency: 'TWD' }],
  impact: { financial: [{ kind: 'reimbursement_allocation', allocated_minor: '900', currency: 'TWD' }], timelines: ['economic', 'cash'] },
  missing_evidence: [],
  before: { match_status: 'proposed' },
  after_preview: {
    confirm: { match_status: 'confirmed', economic_effect: 'synthetic confirmed effect' },
    reject: { match_status: 'rejected', economic_effect: 'synthetic rejected effect' },
  },
  actions: [
    { kind: 'confirm', label: '確認合成報銷', enabled: true },
    { kind: 'reject', label: '拒絕合成報銷', enabled: true },
  ],
  recovery,
};

const commitmentConfirmPreview = {
  expected_version: 4,
  entity_key: 'entity-synthetic',
  commitment_kind: 'synthetic_subscription',
  direction: 'out',
  amount_kind: 'fixed',
  amount_minor: '2500',
  currency: 'TWD',
  cadence: 'monthly',
  start_date: '2026-01-01',
  status: 'scheduled',
  authority: 'user_confirmed',
  review_state: 'confirmed',
};

const commitmentReview = {
  item_key: 'task-commitment-synthetic',
  item_kind: 'commitment_candidate',
  task_key: 'task-commitment-synthetic',
  resource: { type: 'commitment', key: 'commitment-synthetic', version: 4, status: 'provisional' },
  title: '確認合成固定收支',
  reason: 'Synthetic commitment needs a human decision.',
  evidence: [{ commitment_kind: 'synthetic_subscription', cadence: 'monthly', start_date: '2026-01-01' }],
  impact: { financial: [{ kind: 'future_commitment', amount_minor: '2500', currency: 'TWD' }], timelines: ['obligation'] },
  missing_evidence: [],
  before: { status: 'provisional' },
  after_preview: {
    confirm: commitmentConfirmPreview,
    reject: { ...commitmentConfirmPreview, status: 'cancelled', review_state: 'rejected' },
  },
  actions: [
    { kind: 'confirm', label: '確認合成固定收支', enabled: true },
    { kind: 'reject', label: '拒絕合成固定收支', enabled: true },
  ],
  recovery,
};

const ownerUnresolved = {
  item_key: 'transaction-owner-synthetic',
  item_kind: 'owner_unresolved_transaction',
  transaction_id: 321,
  task_key: null,
  resource: { type: 'transaction', key: 'transaction-owner-synthetic', version: null, status: 'owner_unresolved' },
  title: 'Synthetic unresolved cash row',
  reason: 'Synthetic evidence is insufficient to determine a purpose.',
  evidence: [{ transaction_key: 'transaction-owner-synthetic', name: 'Synthetic unresolved evidence', outflow_minor: '450', currency: 'TWD' }],
  impact: { financial: [{ kind: 'unresolved_cash_movement', outflow_minor: '450', currency: 'TWD' }], timelines: ['cash'] },
  missing_evidence: ['Synthetic owner memory or source document is missing.'],
  before: { category_primary: 'synthetic_unresolved' },
  after_preview: {},
  actions: [{ kind: 'open_transaction_correction', label: '開啟合成交易修正', enabled: true }],
  recovery,
};

const sourceConflict = {
  item_key: 'task-conflict-synthetic',
  item_kind: 'source_conflict',
  task_key: 'task-conflict-synthetic',
  resource: { type: 'source_conflict', key: 'conflict-synthetic', version: null, status: 'open' },
  title: '選擇合成來源證據',
  reason: 'Synthetic sources disagree.',
  evidence: [
    { source_key: 'source-synthetic-a', source_kind: 'manual_note', description: 'Synthetic evidence A' },
    { source_key: 'source-synthetic-b', source_kind: 'official', description: 'Synthetic evidence B' },
  ],
  impact: { financial: [], timelines: [] },
  missing_evidence: ['Synthetic human source choice is required.'],
  before: { status: 'open' },
  after_preview: { selected_source_key: null, authority: 'user_confirmed', review_state: 'confirmed' },
  actions: [{ kind: 'select_source', label: '選擇合成來源', enabled: true }],
  recovery,
};

function workbench({ human = [], actionable = [], owner = [], conflicts = [], partialErrors = [] } = {}) {
  const sections = {
    human_confirmations: human,
    actionable_reviews: actionable,
    owner_unresolved: owner,
    conflicts,
  };
  const counts = Object.fromEntries(Object.entries(sections).map(([key, rows]) => [key, rows.length]));
  counts.total_attention = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    contract: 'finance.review-workbench/v1',
    generated_at: generatedAt,
    counts,
    sections,
    partial_errors: partialErrors,
  };
}

function withoutItem(current, section, itemKey) {
  return workbench({
    human: current.sections.human_confirmations.filter((item) => section !== 'human_confirmations' || item.item_key !== itemKey),
    actionable: current.sections.actionable_reviews.filter((item) => section !== 'actionable_reviews' || item.item_key !== itemKey),
    owner: current.sections.owner_unresolved.filter((item) => section !== 'owner_unresolved' || item.item_key !== itemKey),
    conflicts: current.sections.conflicts.filter((item) => section !== 'conflicts' || item.item_key !== itemKey),
    partialErrors: current.partial_errors,
  });
}

async function jsonBody(route) {
  return JSON.parse(route.request().postData() || '{}');
}

test('unified workbench renders server context and sends every decision to its typed owner', async ({ page }) => {
  let current = workbench({
    human: [scopeConfirmation],
    actionable: [transferReview, reimbursementReview, commitmentReview],
    owner: [ownerUnresolved],
    conflicts: [sourceConflict],
  });
  let releaseTransfer;
  const transferGate = new Promise((resolve) => { releaseTransfer = resolve; });
  let transferBody;
  let reimbursementBody;
  let commitmentBody;
  let conflictBody;
  let confirmationBody;
  const requestedUrls = [];
  page.on('request', (request) => requestedUrls.push(request.url()));

  await page.route('**/api/finance/review-workbench', (route) => route.fulfill({ json: current }));
  await page.route('**/api/finance/reconciliation/transfers/transfer-synthetic', async (route) => {
    transferBody = await jsonBody(route);
    await transferGate;
    current = withoutItem(current, 'actionable_reviews', transferReview.item_key);
    await route.fulfill({ json: { match: { match_status: 'confirmed' } } });
  });
  await page.route('**/api/finance/reimbursements/reimbursement-synthetic', async (route) => {
    reimbursementBody = await jsonBody(route);
    current = withoutItem(current, 'actionable_reviews', reimbursementReview.item_key);
    await route.fulfill({ json: { match: { match_status: 'rejected' } } });
  });
  await page.route('**/api/finance/commitments/commitment-synthetic', async (route) => {
    commitmentBody = await jsonBody(route);
    current = withoutItem(current, 'actionable_reviews', commitmentReview.item_key);
    await route.fulfill({ json: { commitment: { status: 'scheduled' } } });
  });
  await page.route('**/api/finance/source-conflicts/conflict-synthetic/resolve', async (route) => {
    conflictBody = await jsonBody(route);
    current = withoutItem(current, 'conflicts', sourceConflict.item_key);
    await route.fulfill({ json: { conflict: { status: 'resolved' } } });
  });
  await page.route('**/api/finance/human-confirmations/browser-session', (route) => route.fulfill({
    json: { browser_nonce: 'synthetic-browser-nonce' },
    headers: { 'set-cookie': 'last_say_confirmation_session=synthetic-browser-nonce; Path=/api/finance/human-confirmations; HttpOnly; SameSite=Strict' },
  }));
  await page.route('**/api/finance/human-confirmations/scope-proposal-synthetic/confirm', async (route) => {
    confirmationBody = await jsonBody(route);
    current = withoutItem(current, 'human_confirmations', scopeConfirmation.item_key);
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto('/confirmations');

  const transferCard = page.getByRole('article', { name: transferReview.title });
  await expect(transferCard).toContainText(transferReview.reason);
  await expect(transferCard).toContainText('Synthetic transfer evidence A');
  await expect(transferCard).toContainText('internal_transfer_elimination');
  await expect(transferCard).toContainText('Synthetic transfer caveat.');

  const ownerCard = page.getByRole('article', { name: ownerUnresolved.title });
  await expect(ownerCard.getByRole('link', { name: new RegExp(ownerUnresolved.title) })).toHaveAttribute('href', '/transactions?ids=321');
  await expect(ownerCard.getByRole('button')).toHaveCount(0);

  const transferNote = transferCard.getByLabel('決議備註（必填，可修改）');
  await expect(transferNote).toHaveValue('已檢視工作台提供的證據、缺漏資訊與影響，依目前資料做成決議。');
  await transferNote.fill('Synthetic human transfer decision.');
  const transferConfirm = transferCard.getByRole('button', { name: `${transferReview.actions[0].label}：${transferReview.title}` });
  await transferConfirm.focus();
  await expect(transferConfirm).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => transferBody).toEqual({
    expected_version: 7,
    match_status: 'confirmed',
    resolution_note: 'Synthetic human transfer decision.',
  });
  await expect(transferCard).toContainText('處理中');
  await expect(page.getByRole('article', { name: commitmentReview.title }).getByRole('button', {
    name: `${commitmentReview.actions[0].label}：${commitmentReview.title}`,
  })).toBeEnabled();
  releaseTransfer();
  await expect(transferCard).toBeHidden();

  const reimbursementCard = page.getByRole('article', { name: reimbursementReview.title });
  await reimbursementCard.getByLabel('決議備註（必填，可修改）').fill('Synthetic human reimbursement rejection.');
  await reimbursementCard.getByRole('button', { name: `${reimbursementReview.actions[1].label}：${reimbursementReview.title}` }).click();
  await expect(reimbursementCard).toBeHidden();
  expect(reimbursementBody).toEqual({
    expected_version: 3,
    match_status: 'rejected',
    resolution_note: 'Synthetic human reimbursement rejection.',
  });

  const commitmentCard = page.getByRole('article', { name: commitmentReview.title });
  await commitmentCard.getByRole('button', { name: `${commitmentReview.actions[0].label}：${commitmentReview.title}` }).click();
  await expect(commitmentCard).toBeHidden();
  expect(commitmentBody).toEqual(commitmentConfirmPreview);

  const conflictCard = page.getByRole('article', { name: sourceConflict.title });
  await conflictCard.getByRole('radio', { name: /Synthetic evidence B/ }).check();
  await conflictCard.getByLabel('來源選擇備註（必填）').fill('Synthetic source B has the stronger provenance.');
  await conflictCard.getByRole('button', { name: `${sourceConflict.actions[0].label}：${sourceConflict.title}` }).click();
  await expect(conflictCard).toBeHidden();
  expect(conflictBody).toEqual({
    selected_source_key: 'source-synthetic-b',
    resolution_note: 'Synthetic source B has the stronger provenance.',
  });

  const scopeCard = page.getByRole('article', { name: scopeConfirmation.title });
  await scopeCard.getByRole('button', { name: `${scopeConfirmation.actions[0].label}：${scopeConfirmation.title}` }).click();
  await expect(scopeCard).toBeHidden();
  expect(confirmationBody).toEqual({ browser_nonce: 'synthetic-browser-nonce' });
  await expect(page.getByText('需要你決定：').locator('..')).toContainText('1 項');
  expect(requestedUrls.some((url) => url.includes('/api/finance/review-tasks'))).toBe(false);
});

test('stale typed decision shows the server reason, refreshes fully, and preserves the edited note', async ({ page }) => {
  const current = workbench({ actionable: [transferReview] });
  let getCalls = 0;
  let staleBody;

  await page.route('**/api/finance/review-workbench', async (route) => {
    getCalls += 1;
    await route.fulfill({ json: current });
  });
  await page.route('**/api/finance/reconciliation/transfers/transfer-synthetic', async (route) => {
    staleBody = await jsonBody(route);
    await route.fulfill({
      status: 409,
      json: { error: { code: 'VERSION_CONFLICT', message: 'Synthetic version changed on server.', retryable: false } },
    });
  });

  await page.goto('/confirmations');
  const card = page.getByRole('article', { name: transferReview.title });
  const note = card.getByLabel('決議備註（必填，可修改）');
  await note.fill('Preserve this synthetic note after refresh.');
  await card.getByRole('button', { name: `${transferReview.actions[1].label}：${transferReview.title}` }).click();

  await expect.poll(() => getCalls).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('資料已更新')).toBeVisible();
  await expect(page.getByText(/Synthetic version changed on server\. 工作台已完整重新載入/)).toBeVisible();
  await expect(card.getByText('Synthetic version changed on server.')).toBeVisible();
  await expect(note).toHaveValue('Preserve this synthetic note after refresh.');
  await expect(card.getByRole('button', { name: `${transferReview.actions[1].label}：${transferReview.title}` })).toBeEnabled();
  expect(staleBody).toEqual({
    expected_version: 7,
    match_status: 'rejected',
    resolution_note: 'Preserve this synthetic note after refresh.',
  });
});

test('loading and partial errors keep usable blocker items visible with retry', async ({ page }) => {
  const blocker = {
    ...transferReview,
    item_key: 'task-blocker-synthetic',
    item_kind: 'unsupported_synthetic_review',
    resource: { type: 'unsupported_synthetic_resource', key: 'resource-blocker-synthetic', version: null, status: 'open' },
    title: 'Synthetic unsupported blocker',
    actions: [{ kind: 'open_resource', label: '前往合成資源', enabled: false }],
  };
  const partial = workbench({
    actionable: [blocker],
    partialErrors: [{
      kind: 'review_resource_hydration_failed',
      task_key: blocker.item_key,
      resource_type: blocker.resource.type,
      resource_key: blocker.resource.key,
      message: 'Synthetic hydration failed for one source.',
    }],
  });
  let getCalls = 0;
  let releaseInitial;
  const initialGate = new Promise((resolve) => { releaseInitial = resolve; });

  await page.route('**/api/finance/review-workbench', async (route) => {
    getCalls += 1;
    if (getCalls === 1) await initialGate;
    await route.fulfill({ json: partial });
  });

  await page.goto('/confirmations');
  await expect(page.getByLabel('正在載入待確認工作台')).toBeVisible();
  releaseInitial();
  await expect(page.getByText('部分來源暫時無法載入')).toBeVisible();
  await expect(page.getByText('Synthetic hydration failed for one source.')).toBeVisible();
  const blockerCard = page.getByRole('article', { name: blocker.title });
  await expect(blockerCard).toBeVisible();
  await expect(blockerCard.getByRole('button', { name: `${blocker.actions[0].label}：${blocker.title}` })).toBeDisabled();
  await page.getByRole('button', { name: '重試全部來源' }).click();
  await expect.poll(() => getCalls).toBe(2);
});

test('full load failure retries into the explicit no-decisions state', async ({ page }) => {
  let getCalls = 0;
  await page.route('**/api/finance/review-workbench', async (route) => {
    getCalls += 1;
    if (getCalls === 1) {
      await route.fulfill({
        status: 500,
        json: { error: { code: 'DB_UNAVAILABLE', message: 'Synthetic workbench unavailable.', retryable: true } },
      });
      return;
    }
    await route.fulfill({ json: workbench() });
  });

  await page.goto('/confirmations');
  await expect(page.getByText('工作台載入失敗')).toBeVisible();
  await expect(page.getByText('Synthetic workbench unavailable.')).toBeVisible();
  await page.getByRole('button', { name: '重新整理', exact: true }).click();
  await expect(page.getByText('目前沒有需要由你決定的項目')).toBeVisible();
  await expect(page.getByText('這只代表工作台目前沒有待處理決議，不代表財務資料已完整。')).toBeVisible();
});
