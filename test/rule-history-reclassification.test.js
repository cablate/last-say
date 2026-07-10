const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function runFixture(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-rule-history-'));
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
  const { normalizeForRule } = require('./lib/normalize');
  const { createRule, updateRule, setRuleEnabled, reclassifyRuleHistory, deleteRule, listRules } = require('./lib/queries');
  const db = getDb();
  const accountId = db.prepare("INSERT INTO accounts (name, account_type) VALUES ('Rule History Test', 'card')").run().lastInsertRowid;
  const insert = db.prepare(\`
    INSERT INTO transactions (
      dedupe_key, import_match_key, transaction_date, transaction_month,
      source_type, flow_type, name, amount, inflow, outflow,
      category_primary, category_sub, ai_confidence, judgment_reason,
      account_id, classification_source, rule_id, reviewed
    ) VALUES (?, ?, '2026-06-01', '2026-06', 'test card', 'card spend',
      ?, -10000, 0, 10000, ?, ?, 0.8, 'fixture', ?, ?, ?, ?)
  \`);
`;

test('disabling a rule reclassifies unreviewed rows, returns unmatched rows to pending, and preserves reviewed decisions', () => {
  const result = runFixture(`
    ${setup}
    const broad = createRule({
      source_type: 'test card', direction: 'out', category_value: '飲食',
      confidence: 0.8, note: 'broad fixture',
    });
    const exact = createRule({
      match_key: normalizeForRule('STREAMING APP'), source_type: 'test card', direction: 'out',
      category_value: '訂閱服務', confidence: 0.9, note: 'exact fixture',
    });

    insert.run('unmatched', 'unmatched', 'UNMATCHED SHOP', '飲食', '舊子類別', accountId, 'rule', broad.id, 0);
    insert.run('replacement', 'replacement', 'STREAMING APP', '飲食', '軟體服務', accountId, 'rule', broad.id, 0);
    insert.run('reviewed', 'reviewed', 'CONFIRMED FOOD', '飲食', '正餐', accountId, 'rule', broad.id, 1);
    insert.run('human', 'human', 'HUMAN SHOP', '購物', '人工', accountId, 'human', null, 1);

    const mutation = setRuleEnabled(broad.id, false);
    const rows = db.prepare('SELECT dedupe_key, category_primary, category_sub, classification_source, rule_id, reviewed FROM transactions ORDER BY id').all();
    const audit = db.prepare('SELECT action, impacted_count, reclassified_count, pending_count, preserved_reviewed_count FROM rule_change_log').all();
    const correctionCount = db.prepare('SELECT COUNT(*) n FROM correction_log').get().n;
    closeDb();
    console.log(JSON.stringify({ mutation, rows, audit, correctionCount, exactId: exact.id }));
  `);

  assert.equal(result.mutation.rule.enabled, 0);
  assert.deepEqual(result.mutation.impact, {
    linked_rows: 3,
    reclassified_rows: 1,
    pending_rows: 1,
    preserved_reviewed_rows: 1,
  });
  assert.deepEqual(result.rows, [
    { dedupe_key: 'unmatched', category_primary: '飲食', category_sub: '舊子類別', classification_source: 'pending', rule_id: null, reviewed: 0 },
    { dedupe_key: 'replacement', category_primary: '訂閱服務', category_sub: '軟體服務', classification_source: 'rule', rule_id: result.exactId, reviewed: 0 },
    { dedupe_key: 'reviewed', category_primary: '飲食', category_sub: '正餐', classification_source: 'human', rule_id: null, reviewed: 1 },
    { dedupe_key: 'human', category_primary: '購物', category_sub: '人工', classification_source: 'human', rule_id: null, reviewed: 1 },
  ]);
  assert.deepEqual(result.audit, [{
    action: 'disable', impacted_count: 3, reclassified_count: 1, pending_count: 1, preserved_reviewed_count: 1,
  }]);
  assert.equal(result.correctionCount, 0);
});

test('changing rule classification updates linked unreviewed rows while metadata-only edits do not reclassify', () => {
  const result = runFixture(`
    ${setup}
    const rule = createRule({
      match_key: normalizeForRule('COFFEE SHOP'), source_type: 'test card', direction: 'out',
      category_value: '日常開銷', confidence: 0.8, note: 'old note',
    });
    insert.run('coffee', 'coffee', 'COFFEE SHOP', '日常開銷', '飲料', accountId, 'rule', rule.id, 0);

    const categoryMutation = updateRule(rule.id, { category_value: '飲食' });
    const afterCategory = db.prepare('SELECT category_primary, classification_source, rule_id, reviewed FROM transactions WHERE dedupe_key = ?').get('coffee');
    const metadataMutation = updateRule(rule.id, { note: 'new note', confidence: 0.95 });
    const auditCount = db.prepare('SELECT COUNT(*) n FROM rule_change_log').get().n;
    closeDb();
    console.log(JSON.stringify({ categoryMutation, afterCategory, metadataMutation, auditCount }));
  `);

  assert.equal(result.categoryMutation.rule.category_value, '飲食');
  assert.deepEqual(result.categoryMutation.impact, {
    linked_rows: 1,
    reclassified_rows: 1,
    pending_rows: 0,
    preserved_reviewed_rows: 0,
  });
  assert.deepEqual(result.afterCategory, {
    category_primary: '飲食', classification_source: 'rule', rule_id: result.categoryMutation.rule.id, reviewed: 0,
  });
  assert.deepEqual(result.metadataMutation.impact, {
    linked_rows: 1,
    reclassified_rows: 0,
    pending_rows: 0,
    preserved_reviewed_rows: 0,
  });
  assert.equal(result.auditCount, 1);
});

test('deleting a rule reclassifies history before removal and rule impact counts expose current dependencies', () => {
  const result = runFixture(`
    ${setup}
    const rule = createRule({
      match_key: normalizeForRule('OLD MERCHANT'), source_type: 'test card', direction: 'out',
      category_value: '購物', confidence: 0.8, note: 'delete fixture',
    });
    insert.run('old-1', 'old-1', 'OLD MERCHANT', '購物', '商品', accountId, 'rule', rule.id, 0);
    insert.run('old-2', 'old-2', 'OLD MERCHANT', '購物', '商品', accountId, 'rule', rule.id, 1);
    const before = listRules({ enabled: 'all' }).find((item) => item.id === rule.id);
    const mutation = deleteRule(rule.id);
    const rows = db.prepare('SELECT classification_source, rule_id, reviewed FROM transactions ORDER BY id').all();
    const audit = db.prepare('SELECT action, before_rule_json, after_rule_json FROM rule_change_log').get();
    let updateBlocked = false;
    let deleteBlocked = false;
    try { db.prepare("UPDATE rule_change_log SET action = 'tampered'").run(); } catch { updateBlocked = true; }
    try { db.prepare('DELETE FROM rule_change_log').run(); } catch { deleteBlocked = true; }
    closeDb();
    console.log(JSON.stringify({ before, mutation, rows, audit, updateBlocked, deleteBlocked }));
  `);

  assert.equal(result.before.linked_rows, 2);
  assert.equal(result.before.unreviewed_rows, 1);
  assert.equal(result.before.reviewed_rows, 1);
  assert.deepEqual(result.mutation.impact, {
    linked_rows: 2,
    reclassified_rows: 0,
    pending_rows: 1,
    preserved_reviewed_rows: 1,
  });
  assert.deepEqual(result.rows, [
    { classification_source: 'pending', rule_id: null, reviewed: 0 },
    { classification_source: 'human', rule_id: null, reviewed: 1 },
  ]);
  assert.equal(result.audit.action, 'delete');
  assert.match(result.audit.before_rule_json, /OLD MERCHANT|old merchant/i);
  assert.equal(result.audit.after_rule_json, null);
  assert.equal(result.updateBlocked, true);
  assert.equal(result.deleteBlocked, true);
});

test('explicit history reclassification cleans legacy links without enabling the rule and string zero disables safely', () => {
  const result = runFixture(`
    ${setup}
    const legacy = createRule({
      match_key: normalizeForRule('LEGACY FOOD'), source_type: 'test card', direction: 'out',
      category_value: '飲食', confidence: 0.8, note: 'legacy fixture', enabled: false,
    });
    const replacement = createRule({
      match_key: normalizeForRule('STREAMING APP'), source_type: 'test card', direction: 'out',
      category_value: '訂閱服務', confidence: 0.9, note: 'replacement fixture',
    });
    insert.run('legacy-unmatched', 'legacy-unmatched', 'LEGACY FOOD', '飲食', '其他飲食', accountId, 'rule', legacy.id, 0);
    insert.run('legacy-replacement', 'legacy-replacement', 'STREAMING APP', '飲食', '其他飲食', accountId, 'rule', legacy.id, 0);

    const mutation = reclassifyRuleHistory(legacy.id);
    const disabled = setRuleEnabled(replacement.id, '0');
    const rows = db.prepare('SELECT dedupe_key, classification_source, rule_id FROM transactions ORDER BY id').all();
    const audit = db.prepare('SELECT action, impacted_count, pending_count, reclassified_count FROM rule_change_log ORDER BY id').all();
    closeDb();
    console.log(JSON.stringify({ mutation, disabled, rows, audit, legacyId: legacy.id, replacementId: replacement.id }));
  `);

  assert.equal(result.mutation.rule.enabled, 0);
  assert.equal(result.mutation.rule.linked_rows, 0);
  assert.deepEqual(result.mutation.impact, {
    linked_rows: 2,
    reclassified_rows: 1,
    pending_rows: 1,
    preserved_reviewed_rows: 0,
  });
  assert.equal(result.disabled.rule.enabled, 0);
  assert.deepEqual(result.rows, [
    { dedupe_key: 'legacy-unmatched', classification_source: 'pending', rule_id: null },
    { dedupe_key: 'legacy-replacement', classification_source: 'pending', rule_id: null },
  ]);
  assert.deepEqual(result.audit, [
    { action: 'reclassify', impacted_count: 2, pending_count: 1, reclassified_count: 1 },
    { action: 'disable', impacted_count: 1, pending_count: 1, reclassified_count: 0 },
  ]);
});
