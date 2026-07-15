const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('owner-unresolved cash stays visible and is separate from actionable review', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-owner-unresolved-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  try {
    const stdout = execFileSync(process.execPath, ['-e', `
      const { getDb, closeDb } = require('./lib/db');
      const { getMeta, getSummary, getTransactions, getBreakdown, createRule } = require('./lib/queries');
      const db = getDb();
      const accountId = db.prepare("INSERT INTO accounts (name, account_type) VALUES ('Unresolved Test', 'bank')").run().lastInsertRowid;
      const insert = db.prepare(\`
        INSERT INTO transactions (
          dedupe_key, import_match_key, transaction_date, transaction_month,
          source_type, flow_type, name, amount, inflow, outflow,
          category_primary, ai_confidence, account_id, classification_source, reviewed
        ) VALUES (?, ?, '2026-06-01', '2026-06', 'bank', '信用卡繳款/移轉', ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      \`);
      insert.run('unresolved-in', 'unresolved-in', 'Unresolved inflow', 40000, 40000, 0, '無法確認', accountId, 'human', 1);
      insert.run('unresolved-out', 'unresolved-out', 'Unresolved outflow', -150000, 0, 150000, '無法確認', accountId, 'human', 1);
      insert.run('pending-transfer', 'pending-transfer', 'Pending transfer', -25000, 0, 25000, '轉帳/內部移轉', accountId, 'pending', 0);

      let reusableRuleRejected = false;
      try {
        createRule({ match_key: 'synthetic-unresolved', direction: 'out', category_value: '無法確認', confidence: 0.9, note: 'must be rejected' });
      } catch (error) {
        reusableRuleRejected = /不能建立/.test(String(error.message));
      }

      const result = {
        meta: getMeta().counts,
        summary: getSummary(new URLSearchParams('month=2026-06')).classification,
        unresolved: getTransactions(new URLSearchParams('month=2026-06&view=unresolved')),
        unresolvedCategory: getTransactions(new URLSearchParams('month=2026-06&category=無法確認')),
        categoryBreakdown: getBreakdown(new URLSearchParams('month=2026-06&dimension=category')),
        filteredCategoryBreakdown: getBreakdown(new URLSearchParams('month=2026-06&dimension=category&category=轉帳/內部移轉')),
        needsReview: getTransactions(new URLSearchParams('month=2026-06&view=needs-review')),
        byIds: getTransactions(new URLSearchParams('ids=2')),
        defaultView: getTransactions(new URLSearchParams('month=2026-06')),
        reusableRuleRejected,
      };
      closeDb();
      console.log(JSON.stringify(result));
    `], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, FINANCE_DB_PATH: dbPath },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = JSON.parse(stdout);

    assert.equal(result.meta.needsReview, 1);
    assert.equal(result.meta.ownerUnresolved, 2);
    assert.equal(result.summary.needsReview, 1);
    assert.equal(result.summary.ownerUnresolved, 2);
    assert.equal(result.summary.ownerUnresolvedInflow, 40000);
    assert.equal(result.summary.ownerUnresolvedOutflow, 150000);
    assert.equal(result.summary.ownerUnresolvedNet, -110000);
    assert.equal(result.unresolved.total, 2);
    assert.deepEqual(result.unresolved.rows.map((row) => row.name).sort(), ['Unresolved inflow', 'Unresolved outflow']);
    assert.equal(result.unresolvedCategory.total, 2, 'category link must include transfer-shaped unresolved cash');
    const unresolvedBreakdown = result.categoryBreakdown.find((row) => row.label === '無法確認');
    assert.equal(unresolvedBreakdown.rows, 2);
    assert.equal(unresolvedBreakdown.inflow, 40000);
    assert.equal(unresolvedBreakdown.outflow, 150000);
    assert.equal(result.filteredCategoryBreakdown.some((row) => row.label === '無法確認'), false);
    assert.equal(result.needsReview.total, 1);
    assert.equal(result.needsReview.rows[0].name, 'Pending transfer');
    assert.equal(result.byIds.total, 1);
    assert.equal(result.byIds.rows[0].name, 'Unresolved outflow');
    assert.equal(result.defaultView.total, 0, 'default view keeps the existing settlement/transfer suppression');
    assert.equal(result.reusableRuleRejected, true, 'owner-unresolved must never become a reusable classification rule');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
