const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');

test('demo seed covers every foundation context with anonymized review work', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-demo-foundation-'));
  const dbPath = path.join(dir, 'demo.sqlite');
  try {
    const result = spawnSync(process.execPath, ['scripts/seed-demo.js', '--reset'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, FINANCE_DB_PATH: dbPath } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const count = (table, where = '1=1') => db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${where}`).get().count;
      assert.equal(count('transactions'), 180);
      assert.equal(count('accounts', 'account_key IS NOT NULL'), 4);
      assert.ok(count('account_balance_snapshots') >= 3);
      assert.equal(count('credit_card_profiles'), 1);
      assert.equal(count('liability_profiles'), 1);
      assert.equal(count('commitment_templates'), 1);
      assert.equal(count('holding_snapshots'), 1);
      assert.equal(count('market_quotes'), 1);
      assert.equal(count('fx_quotes'), 1);
      assert.equal(count('valued_items'), 1);
      assert.equal(count('scope_attestations'), 5);
      assert.equal(count('review_tasks', "status='open'"), 1);
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fixed operator Skill eval corpus passes all safety scenarios', () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude/skills/last-say-ops/evals/cases.json'), 'utf8'));
  const result = spawnSync(process.execPath, ['scripts/eval-last-say-skill.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, new RegExp(`Skill eval: ${corpus.cases.length}/${corpus.cases.length} passed`));
});
