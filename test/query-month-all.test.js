const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function runFixture(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-month-all-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  try {
    const stdout = execFileSync(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, FINANCE_DB_PATH: dbPath },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('month=all means no month filter across summary, list, breakdown, and spending', () => {
  const result = runFixture(`
    const { getDb, closeDb } = require('./lib/db');
    const {
      getSummary,
      getTransactions,
      getBreakdown,
      getSpending,
    } = require('./lib/queries/transactions');

    const db = getDb();
    const accountId = db.prepare("INSERT INTO accounts (name, account_type) VALUES ('Test Account', 'card')").run().lastInsertRowid;
    const insert = db.prepare(\`
      INSERT INTO transactions (
        dedupe_key, import_match_key, transaction_date, transaction_month,
        source_type, flow_type, name, amount, inflow, outflow,
        category_primary, ai_confidence, account_id, classification_source, reviewed
      ) VALUES (?, ?, ?, ?, 'test card', '信用卡消費',
        ?, ?, 0, ?, ?, 0.8, ?, 'ai', 1)
    \`);

    insert.run('jan', 'merchant-jan', '2026-01-10', '2026-01', 'January Merchant', -1000, 1000, '飲食', accountId);
    insert.run('feb', 'merchant-feb', '2026-02-10', '2026-02', 'February Merchant', -2000, 2000, '交通', accountId);

    const allParams = new URLSearchParams('month=all');
    const janParams = new URLSearchParams('month=2026-01');
    const result = {
      allSummary: getSummary(allParams),
      janSummary: getSummary(janParams),
      allTransactions: getTransactions(allParams),
      janTransactions: getTransactions(janParams),
      allBreakdown: getBreakdown(new URLSearchParams('month=all&dimension=category')),
      allSpending: getSpending('all'),
      janSpending: getSpending('2026-01'),
    };
    closeDb();
    console.log(JSON.stringify(result));
  `);

  assert.equal(result.allSummary.rows, 2);
  assert.equal(result.allSummary.outflow, 3000);
  assert.equal(result.allSummary.selectedMonth, null);
  assert.equal(result.allSummary.monthlyReport, null);
  assert.equal(result.janSummary.rows, 1);
  assert.equal(result.janSummary.outflow, 1000);
  assert.equal(result.janSummary.selectedMonth, '2026-01');
  assert.equal(result.allTransactions.total, 2);
  assert.equal(result.janTransactions.total, 1);
  assert.deepEqual(
    result.allBreakdown.map((row) => [row.label, row.spend]).sort(),
    [['交通', 2000], ['飲食', 1000]],
  );
  assert.deepEqual(result.allSpending, { total: 3000, count: 2, average: 1500 });
  assert.deepEqual(result.janSpending, { total: 1000, count: 1, average: 1000 });
});
