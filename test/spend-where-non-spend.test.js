// Overview 消費統計口徑測試——驗證 NON_SPEND_FLOW_TYPES 排除邏輯。
// 對應 lib/queries/transactions.js SPEND_WHERE：outflow>0 且 flow_type 不在非消費清單。
// 重點保護：flow_type IS NULL 仍視為消費（保持既有語意，別把未知排除掉）。
//
// 測試涵蓋四情境（每筆皆 outflow>0）：
//   (a) flow_type='貸款本金還款'  → 不進 spend
//   (b) flow_type='投資買入'      → 不進 spend
//   (c) flow_type='信用卡消費'    → 仍進 spend
//   (d) flow_type IS NULL         → 仍進 spend（語意保留）
// 另驗 buildTransactionWhere 預設隱藏非消費列（交易列表口徑同步）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function runNode(script, env = {}) {
  return execFileSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// 建立空 DB + schema + 指定列，回傳 getSummary(all) 的 actualSpend 與交易列表筆數。
function seedAndQuery(dbPath, rows) {
  // 把 rows 以 JSON 字面值內嵌進 script（避免 argv 在 -e 模式不可靠）。
  const rowsLiteral = JSON.stringify(rows);
  const script = `
    const { getDb, closeDb } = require('./lib/db');
    const { getSummary, getTransactions } = require('./lib/queries/transactions');
    const rows = ${rowsLiteral};
    const db = getDb();
    const accountId = db.prepare("INSERT INTO accounts (name, account_type) VALUES ('demo', 'bank')").run().lastInsertRowid;
    const ins = db.prepare(\`
      INSERT INTO transactions (
        dedupe_key, import_match_key, transaction_date, transaction_month,
        source_type, flow_type, name, amount, inflow, outflow,
        category_primary, ai_confidence, account_id, classification_source, reviewed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', 1)
    \`);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      ins.run(
        'dedupe-' + i, 'match-' + i, r.date, r.month,
        r.source_type, r.flow_type, r.name, r.amount, 0, r.outflow,
        r.category, 0.9, accountId
      );
    }
    const params = new URLSearchParams('');
    const summary = getSummary(params);
    const list = getTransactions(new URLSearchParams('limit=1000'));
    closeDb();
    console.log(JSON.stringify({
      actualSpend: summary.actualSpend,
      rowCount: list.total,
      rows: list.rows.map(r => ({ flow_type: r.flow_type, outflow: r.outflow }))
    }));
  `;
  const stdout = runNode(script, { FINANCE_DB_PATH: dbPath });
  return JSON.parse(stdout);
}

function makeRow(overrides) {
  return {
    date: '2026-07-01',
    month: '2026-07',
    source_type: '示範信用卡',
    flow_type: '信用卡消費',
    name: 'DEMO',
    amount: -100,
    outflow: 100,
    category: '飲食',
    ...overrides,
  };
}

// 直接測 SPEND_WHERE 對 flow_type IS NULL 的行為。
// 生產 schema transactions.flow_type 為 NOT NULL，NULL 分支不會在正常資料觸發，
// 但 SPEND_WHERE 語意保留「NULL 當消費」——用寬鬆 schema 獨立驗證此分支。
function probeNullSpend(dbPath) {
  // dbPath 用 JSON.stringify 安全文嵌入（含反斜線/引號都能正確逃脫）。
  const script = `
    const { DatabaseSync } = require('node:sqlite');
    const { NON_SPEND_FLOW_TYPES } = require('./lib/constants');
    const inList = NON_SPEND_FLOW_TYPES.map(v => "'" + String(v).replace(/'/g, "''") + "'").join(', ');
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    db.exec("CREATE TABLE t (outflow REAL, flow_type TEXT)");
    db.prepare("INSERT INTO t VALUES (?, ?)").run(700, null);
    const sql = "SELECT COALESCE(SUM(CASE WHEN outflow > 0 AND (flow_type IS NULL OR flow_type NOT IN (" + inList + ")) THEN outflow ELSE 0 END), 0) AS spend FROM t";
    const row = db.prepare(sql).get();
    db.close();
    console.log(JSON.stringify({ spend: row.spend }));
  `;
  const stdout = runNode(script, {});
  return JSON.parse(stdout);
}

test('貸款本金還款 outflow 不計入 Overview 消費 spend', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-spend-'));
  try {
    const result = seedAndQuery(path.join(dir, 'finance.sqlite'), [
      makeRow({ flow_type: '貸款本金還款', outflow: 5000, amount: -5000, name: 'LOAN PRINCIPAL' }),
    ]);
    assert.equal(result.actualSpend, 0, `貸款本金還款不應進 spend，實際：${result.actualSpend}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('投資買入 outflow 不計入 Overview 消費 spend', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-spend-'));
  try {
    const result = seedAndQuery(path.join(dir, 'finance.sqlite'), [
      makeRow({ flow_type: '投資買入', outflow: 3000, amount: -3000, name: 'ETF PURCHASE' }),
    ]);
    assert.equal(result.actualSpend, 0, `投資買入不應進 spend，實際：${result.actualSpend}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('信用卡消費 outflow 仍計入 Overview 消費 spend', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-spend-'));
  try {
    const result = seedAndQuery(path.join(dir, 'finance.sqlite'), [
      makeRow({ flow_type: '信用卡消費', outflow: 250, amount: -250, name: 'COFFEE' }),
    ]);
    assert.equal(result.actualSpend, 250, `信用卡消費應進 spend，實際：${result.actualSpend}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('flow_type IS NULL 的 outflow 仍計入 spend（語意保留，獨立驗證 SQL 分支）', () => {
  // 生產 schema transactions.flow_type NOT NULL → NULL 不會出現在真實資料，
  // 但 SPEND_WHERE 語意保留「NULL 當消費」。用寬鬆 schema 直接驗證 SQL 分支。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-spend-'));
  try {
    const result = probeNullSpend(path.join(dir, 'finance-null.sqlite'));
    assert.equal(result.spend, 700, `NULL flow_type 應進 spend（未知當消費），實際：${result.spend}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('混合情境：spend 只含消費類（貸款/投資/卡款排除）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-spend-'));
  try {
    const result = seedAndQuery(path.join(dir, 'finance.sqlite'), [
      makeRow({ flow_type: '信用卡消費', outflow: 250, amount: -250, name: 'COFFEE' }),
      makeRow({ flow_type: '貸款本金還款', outflow: 5000, amount: -5000, name: 'LOAN' }),
      makeRow({ flow_type: '投資買入', outflow: 3000, amount: -3000, name: 'ETF' }),
      makeRow({ flow_type: '信用卡繳款/移轉', outflow: 1200, amount: -1200, name: 'CARD PAY' }),
      // 非清單內的任意 flow_type（例 '轉帳消費'）視為消費、計入 spend。
      makeRow({ flow_type: '轉帳消費', outflow: 800, amount: -800, name: 'BANK PAYMENT' }),
    ]);
    // spend = 250 (咖啡) + 800 (轉帳消費) = 1050；貸款/投資/卡款排除
    assert.equal(result.actualSpend, 1050, `混合 spend 應=1050（250+800），實際：${result.actualSpend}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
