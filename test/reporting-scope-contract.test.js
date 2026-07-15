const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, initializeDatabase } = require('../lib/db');
const { createEntity } = require('../lib/queries/finance/entities');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createCashActivity } = require('../lib/queries/finance/cash-activity');
const { createTransferMatch } = require('../lib/queries/finance/reconciliation');
const { getIncomeStatement } = require('../lib/queries/reports/income-statement');

function isolated(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-report-scope-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function cash(db, target, amount, currency, name) {
  return createCashActivity({
    account_key: target.account_key,
    transaction_date: '2026-06-10',
    name,
    amount_minor: String(amount),
    currency,
    flow_type: amount > 0 ? '收入' : '支出',
    category_primary: amount > 0 ? '薪資/固定收入' : '餐飲',
    ai_confidence: 0.9,
    judgment_reason: 'Synthetic report scope fixture.',
  }, {}, db);
}

test('management P&L enforces entity and currency scope in the query', () => isolated((db) => {
  const personal = createAccount({
    display_name: 'Synthetic personal TWD', account_kind: 'bank', currency: 'TWD',
    authority: 'user_confirmed', review_state: 'confirmed',
  }, {}, db);
  const businessEntity = createEntity({ name: 'Synthetic business', entity_type: 'business', base_currency: 'USD' }, {}, db);
  const business = createAccount({
    entity_key: businessEntity.entity_key,
    display_name: 'Synthetic business USD', account_kind: 'bank', currency: 'USD',
    authority: 'user_confirmed', review_state: 'confirmed',
  }, {}, db);
  cash(db, personal, 100000, 'TWD', 'Synthetic personal income');
  cash(db, business, 900000, 'USD', 'Synthetic business income');

  const report = getIncomeStatement(new URLSearchParams('month=2026-06&entity_id=personal&currency=TWD'), db);
  assert.equal(report.transaction_count, 1);
  assert.equal(report.total_revenue_cents, 100000);
  assert.equal(report.entity_id, 'personal');
  assert.equal(report.currency, 'TWD');
}));

test('management P&L fails closed for a basis that is only a label, not implemented semantics', () => isolated((db) => {
  assert.throws(
    () => getIncomeStatement(new URLSearchParams('month=2026-06&basis=cash'), db),
    (error) => error.code === 'UNSUPPORTED_REPORT_BASIS',
  );
}));

test('confirmed typed transfer overrides opaque merchant categories and carries match drillback', () => isolated((db) => {
  const from = createAccount({ display_name: 'Synthetic from', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
  const to = createAccount({ display_name: 'Synthetic to', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed' }, {}, db);
  const out = createCashActivity({
    account_key: from.account_key, transaction_date: '2026-06-10', name: 'Opaque A',
    amount_minor: '-5000', currency: 'TWD', flow_type: '支出', category_primary: '餐飲',
    ai_confidence: 0.9, judgment_reason: 'Synthetic opaque leg.',
  }, {}, db);
  const incoming = createCashActivity({
    account_key: to.account_key, transaction_date: '2026-06-10', name: 'Opaque B',
    amount_minor: '5000', currency: 'TWD', flow_type: '收入', category_primary: '其他收入',
    ai_confidence: 0.9, judgment_reason: 'Synthetic opaque leg.',
  }, {}, db);
  const match = createTransferMatch({
    from_transaction_key: out.transaction_key,
    to_transaction_key: incoming.transaction_key,
    amount_minor: '5000', currency: 'TWD', match_status: 'confirmed',
    confidence: 1, authority: 'user_confirmed', review_state: 'confirmed',
  }, {}, db);

  const report = getIncomeStatement(new URLSearchParams('month=2026-06&entity_id=personal&currency=TWD'), db);
  assert.equal(report.total_expense_cents, 0);
  assert.equal(report.total_revenue_cents, 0);
  const transfer = report.excluded.find((line) => line.line === 'excluded:internal_transfer');
  assert.equal(transfer.amount_cents, 10000);
  assert.ok(report.source_watermark.match_keys.includes(match.match_key));
}));
