const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function runFixture(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-learning-'));
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
  const {
    patchTransaction,
    createRule,
    getLearningOverview,
    getMerchantLearningContext,
  } = require('./lib/queries');
  const db = getDb();
  const accountId = db.prepare("INSERT INTO accounts (name, account_type) VALUES ('Learning Test', 'card')").run().lastInsertRowid;
  const insert = db.prepare(\`
    INSERT INTO transactions (
      dedupe_key, import_match_key, transaction_date, transaction_month,
      source_type, flow_type, name, amount, inflow, outflow,
      category_primary, category_sub, ai_confidence, judgment_reason,
      account_id, classification_source, reviewed
    ) VALUES (?, ?, '2026-06-01', '2026-06', 'test card', 'card spend',
      ?, -10000, 0, 10000, ?, '', ?, ?, ?, 'ai', ?)
  \`);
`;

test('learning context retrieves similar human evidence and excludes unreviewed AI guesses', () => {
  const result = runFixture(`
    ${setup}
    const correctedId = insert.run(
      'corrected', 'corrected', 'OPENAI *CHATGPT SUBSCR', '購物', 0.4,
      '名稱被截斷，初判不確定。', accountId, 0,
    ).lastInsertRowid;
    patchTransaction(correctedId, { category_primary: '訂閱服務' });

    insert.run(
      'unreviewed', 'unreviewed', 'OPENAI CHATGPT OTHER', '休閒娛樂', 0.3,
      '未覆核的猜測，不可成為學習證據。', accountId, 0,
    );

    const context = getMerchantLearningContext({
      name: 'OPENAI CHATGPT SUBSCRIPTION',
      sourceType: 'test card',
      direction: 'out',
    });
    const overview = getLearningOverview();
    closeDb();
    console.log(JSON.stringify({ context, overview }));
  `);

  assert.equal(result.context.matched_rule, null);
  assert.equal(result.context.consensus.suggested_category, '訂閱服務');
  assert.equal(result.context.consensus.status, 'historical_consensus');
  assert.equal(result.context.consensus.conflict, false);
  assert.equal(result.context.consensus.confidence_ceiling, 0.76);
  assert.equal(result.context.may_create_alias_rule, true);
  assert.equal(result.context.similar_cases.length, 1);
  assert.equal(result.context.similar_cases[0].evidence_type, 'human_correction');
  assert.equal(result.context.similar_cases[0].category_primary, '訂閱服務');
  assert.equal(result.overview.counts.corrections, 1);
  assert.equal(result.overview.counts.latest_correction_id, 1);
  assert.equal(result.overview.correction_candidates[0].covered_by_rule, false);
});

test('conflicting similar human evidence stays below the rule creation threshold', () => {
  const result = runFixture(`
    ${setup}
    const foodId = insert.run(
      'food', 'food', 'GLOBAL MALL FOOD', '購物', 0.4,
      '初判。', accountId, 0,
    ).lastInsertRowid;
    const shopId = insert.run(
      'shop', 'shop', 'GLOBAL MALL SHOP', '飲食', 0.4,
      '初判。', accountId, 0,
    ).lastInsertRowid;
    patchTransaction(foodId, { category_primary: '飲食' });
    patchTransaction(shopId, { category_primary: '購物' });

    const context = getMerchantLearningContext({
      name: 'GLOBAL MALL',
      sourceType: 'test card',
      direction: 'out',
    });
    closeDb();
    console.log(JSON.stringify(context));
  `);

  assert.equal(result.consensus.status, 'conflicting_history');
  assert.equal(result.consensus.conflict, true);
  assert.equal(result.consensus.confidence_ceiling, 0.55);
  assert.equal(result.may_create_alias_rule, false);
  assert.equal(result.should_web_search, true);
  assert.deepEqual(
    result.consensus.categories.map((item) => item.category).sort(),
    ['購物', '飲食'],
  );
});

test('an existing matching rule remains authoritative in learning context', () => {
  const result = runFixture(`
    ${setup}
    const rule = createRule({
      match_key: normalizeForRule('NETFLIX'),
      source_type: 'test card',
      direction: 'out',
      category_value: '訂閱服務',
      confidence: 0.9,
      origin: 'human_correction',
      note: '人工確認的串流訂閱規則。',
    });
    const context = getMerchantLearningContext({
      name: 'Netflix',
      sourceType: 'test card',
      direction: 'out',
    });
    closeDb();
    console.log(JSON.stringify({ rule, context }));
  `);

  assert.equal(result.context.matched_rule.id, result.rule.id);
  assert.equal(result.context.consensus.status, 'matched_rule');
  assert.equal(result.context.consensus.suggested_category, '訂閱服務');
  assert.equal(result.context.consensus.confidence_ceiling, 0.9);
  assert.equal(result.context.should_web_search, false);
  assert.equal(result.context.may_create_alias_rule, false);
});
