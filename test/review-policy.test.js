const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { needsReviewRow } = require('../lib/review-policy');

test('review policy separates AI uncertainty from rule performance', () => {
  assert.equal(needsReviewRow({ reviewed: 0, classification_source: 'ai', ai_confidence: null }), true);
  assert.equal(needsReviewRow({ reviewed: 0, classification_source: 'ai', ai_confidence: 0.49 }), true);
  assert.equal(needsReviewRow({ reviewed: 0, classification_source: 'ai', ai_confidence: 0.5 }), false);
  assert.equal(needsReviewRow({ reviewed: 0, classification_source: 'pending', ai_confidence: 0.9 }), true);
  assert.equal(needsReviewRow({ reviewed: 0, classification_source: 'rule', ai_confidence: null }), false);
  assert.equal(needsReviewRow({ reviewed: 1, classification_source: 'ai', ai_confidence: 0.2 }), false);
});

test('meta, summary, and needs-review list use the same review policy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-review-policy-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  try {
    const stdout = execFileSync(process.execPath, ['-e', `
      const { getDb, closeDb } = require('./lib/db');
      const { getMeta, getSummary, getTransactions } = require('./lib/queries');
      const db = getDb();
      const accountId = db.prepare("INSERT INTO accounts (name, account_type) VALUES ('Review Test', 'card')").run().lastInsertRowid;
      const insert = db.prepare(\`
        INSERT INTO transactions (
          dedupe_key, import_match_key, transaction_date, transaction_month,
          source_type, flow_type, name, amount, inflow, outflow,
          category_primary, ai_confidence, account_id, classification_source, reviewed
        ) VALUES (?, ?, '2026-06-01', '2026-06', 'card', 'spend', ?, -100, 0, 100, '飲食', ?, ?, ?, ?)
      \`);
      insert.run('rule-null', 'rule-null', 'Rule Null', null, accountId, 'rule', 0);
      insert.run('ai-null', 'ai-null', 'AI Null', null, accountId, 'ai', 0);
      insert.run('pending', 'pending', 'Pending', 0.9, accountId, 'pending', 0);
      insert.run('ai-high', 'ai-high', 'AI High', 0.9, accountId, 'ai', 0);
      insert.run('reviewed-low', 'reviewed-low', 'Reviewed Low', 0.2, accountId, 'ai', 1);

      const params = new URLSearchParams('month=2026-06&view=needs-review');
      const result = {
        meta: getMeta().counts.needsReview,
        summary: getSummary(new URLSearchParams('month=2026-06')).classification.needsReview,
        list: getTransactions(params),
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
    assert.equal(result.meta, 2);
    assert.equal(result.summary, 2);
    assert.equal(result.list.total, 2);
    assert.deepEqual(result.list.rows.map((row) => row.name).sort(), ['AI Null', 'Pending']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
