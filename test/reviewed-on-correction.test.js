const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function runFixture(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-reviewed-'));
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

const setup = `
  const { getDb, closeDb } = require('./lib/db');
  const { patchTransaction, batchCorrection } = require('./lib/queries/transactions');
  const db = getDb();
  const accountId = db.prepare("INSERT INTO accounts (name, account_type) VALUES ('Test Account', 'card')").run().lastInsertRowid;
  const insert = db.prepare(\`
    INSERT INTO transactions (
      dedupe_key, import_match_key, transaction_date, transaction_month,
      source_type, flow_type, name, amount, inflow, outflow,
      category_primary, ai_confidence, account_id, classification_source, reviewed
    ) VALUES (?, ?, '2026-01-01', '2026-01', 'test card', 'card spend',
      ?, 100, 0, 100, 'Needs review', 0.3, ?, 'ai', 0)
  \`);
`;

test('single transaction correction marks the row reviewed', () => {
  const result = runFixture(`
    ${setup}
    const id = insert.run('one', 'merchant-one', 'Merchant One', accountId).lastInsertRowid;
    patchTransaction(id, { category_primary: 'Food' });
    const row = db.prepare('SELECT classification_source, reviewed FROM transactions WHERE id = ?').get(id);
    const needsReview = db.prepare(\`
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE reviewed = 0 AND (ai_confidence < 0.5 OR ai_confidence IS NULL OR classification_source = 'pending')
    \`).get().count;
    closeDb();
    console.log(JSON.stringify({ row, needsReview }));
  `);

  assert.deepEqual(result.row, { classification_source: 'human', reviewed: 1 });
  assert.equal(result.needsReview, 0);
});

test('batch correction marks corrected rows reviewed', () => {
  const result = runFixture(`
    ${setup}
    const first = insert.run('one', 'merchant-one', 'Merchant One', accountId).lastInsertRowid;
    const second = insert.run('two', 'merchant-two', 'Merchant Two', accountId).lastInsertRowid;
    const outcome = batchCorrection([
      { id: first, category_primary: 'Food' },
      { id: second, memo: 'checked' },
    ]);
    const rows = db.prepare('SELECT classification_source, reviewed FROM transactions ORDER BY id').all();
    const needsReview = db.prepare(\`
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE reviewed = 0 AND (ai_confidence < 0.5 OR ai_confidence IS NULL OR classification_source = 'pending')
    \`).get().count;
    closeDb();
    console.log(JSON.stringify({ outcome, rows, needsReview }));
  `);

  assert.equal(result.outcome.updated, 2);
  assert.deepEqual(result.rows, [
    { classification_source: 'human', reviewed: 1 },
    { classification_source: 'ai', reviewed: 1 },
  ]);
  assert.equal(result.needsReview, 0);
});
