const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeLedger(filePath, rows) {
  const columns = [
    '來源類型',
    '來源說明',
    '日期',
    '月份',
    '名稱',
    '金額',
    '流入',
    '流出',
    '帳戶餘額',
    '帳戶原始排序',
    '原始交易資訊',
    '這筆是什麼',
    '分類',
    '子類別',
    '信心度',
    '判斷理由',
    '備註',
  ];
  const csv = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
  fs.writeFileSync(filePath, csv, 'utf8');
}

function runNode(args, options = {}) {
  return execFileSync(process.execPath, args, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function runImport({ ledgerPath, sourceIndexPath, dbPath, reset = false }) {
  const stdout = runNode([
    'scripts/seed-from-ledger.js',
    `--ledger=${ledgerPath}`,
    `--source-index=${sourceIndexPath}`,
    ...(reset ? ['--reset'] : []),
  ], {
    env: { ...process.env, FINANCE_DB_PATH: dbPath },
  });
  return JSON.parse(stdout);
}

function queryDb(dbPath, sql) {
  const stdout = runNode(['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    const result = db.prepare(${JSON.stringify(sql)}).get();
    db.close();
    console.log(JSON.stringify(result));
  `]);
  return JSON.parse(stdout);
}

function execDb(dbPath, sql) {
  runNode(['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    db.exec(${JSON.stringify(sql)});
    db.close();
  `]);
}

test('ledger import dedupes repeated rows and does not overwrite human classifications', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  const ledgerPath = path.join(dir, 'ledger.csv');
  const sourceIndexPath = path.join(dir, 'source-index.csv');

  try {
    writeLedger(ledgerPath, [{
      來源類型: '示範信用卡',
      來源說明: 'credit-card-2026-01 posted statement',
      日期: '2026-01-02',
      月份: '2026-01',
      名稱: 'Demo Coffee',
      金額: '-120',
      流入: '0',
      流出: '120',
      帳戶餘額: '',
      帳戶原始排序: '',
      原始交易資訊: '',
      這筆是什麼: '信用卡消費',
      分類: '飲食',
      子類別: '咖啡',
      信心度: '0.82',
      判斷理由: '示範咖啡店，歸為飲食。',
      備註: '',
    }]);
    fs.writeFileSync(
      sourceIndexPath,
      [
        '來源類型,說明,來源檔,筆數',
        '示範信用卡,credit-card-2026-01 posted statement,demo-credit-card-2026-01.csv,1',
      ].join('\n'),
      'utf8',
    );

    const first = runImport({ ledgerPath, sourceIndexPath, dbPath, reset: true });
    assert.equal(first.ledger_rows_seen, 1);
    assert.equal(first.transactions_in_database, 1);

    let row = queryDb(dbPath, 'SELECT category_primary, classification_source FROM transactions');
    assert.deepEqual(row, { category_primary: '飲食', classification_source: 'ai' });
    execDb(dbPath, `
      UPDATE transactions
      SET category_primary = '購物', classification_source = 'human', reviewed = 1
    `);

    const second = runImport({ ledgerPath, sourceIndexPath, dbPath, reset: false });
    assert.equal(second.ledger_rows_seen, 1);
    assert.equal(second.transactions_in_database, 1);

    row = queryDb(dbPath, `
      SELECT COUNT(*) AS count, category_primary, classification_source, reviewed
      FROM transactions
    `);

    assert.equal(row.count, 1);
    assert.equal(row.category_primary, '購物');
    assert.equal(row.classification_source, 'human');
    assert.equal(row.reviewed, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('ledger import preserves repeated identical card transactions within one source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-duplicates-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  const ledgerPath = path.join(dir, 'ledger.csv');
  const sourceIndexPath = path.join(dir, 'source-index.csv');

  try {
    const repeated = {
      來源類型: '示範信用卡',
      來源說明: 'credit-card-2026-07 unbilled details',
      日期: '2026-06-20',
      月份: '2026-06',
      名稱: 'Demo Game',
      金額: '-170',
      流入: '0',
      流出: '170',
      帳戶餘額: '',
      原始交易資訊: '',
      這筆是什麼: '信用卡消費',
      分類: '休閒娛樂',
      子類別: '遊戲',
      信心度: '0.88',
      判斷理由: '遊戲扣款，歸為休閒娛樂。',
      備註: '',
    };
    writeLedger(ledgerPath, [
      { ...repeated, 帳戶原始排序: '1' },
      { ...repeated, 帳戶原始排序: '2' },
      { ...repeated, 帳戶原始排序: '3' },
    ]);
    fs.writeFileSync(
      sourceIndexPath,
      [
        '來源類型,說明,來源檔,筆數',
        '示範信用卡,credit-card-2026-07 unbilled details,demo-credit-card-2026-07.csv,3',
      ].join('\n'),
      'utf8',
    );

    const first = runImport({ ledgerPath, sourceIndexPath, dbPath, reset: true });
    assert.equal(first.ledger_rows_seen, 3);
    assert.equal(first.transactions_in_database, 3);

    const second = runImport({ ledgerPath, sourceIndexPath, dbPath, reset: false });
    assert.equal(second.ledger_rows_seen, 3);
    assert.equal(second.transactions_in_database, 3);

    const row = queryDb(dbPath, `
      SELECT COUNT(*) AS count, COUNT(DISTINCT dedupe_key) AS dedupeKeys
      FROM transactions
      WHERE name = 'Demo Game'
    `);
    assert.deepEqual(row, { count: 3, dedupeKeys: 3 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
