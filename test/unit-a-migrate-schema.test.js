const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Unit A — migrateSchema 公開 export + 極舊 DB 存在性守護。
// 覆蓋：
// 1. lib/db module.exports 含 migrateSchema（文件承諾的公開 API）
// 2. migrateSchema 對缺表的極舊 DB 不崩（skip ALTER 而非拋「no such table」）
// 3. reporting 欄位統一：升級既有 DB 後兩表皆具 reason + note

function runScript(script, dbPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-unitA-migrate-'));
  const resolvedDb = dbPath || path.join(dir, 'finance.sqlite');
  let output;
  try {
    output = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, FINANCE_DB_PATH: resolvedDb, NODE_ENV: 'development' },
      timeout: 30000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return output;
}

test('Unit A: migrateSchema is exported from lib/db', () => {
  const script = `
    const db = require('./lib/db');
    process.stdout.write(JSON.stringify({ exported: typeof db.migrateSchema === 'function' }));
  `;
  const out = runScript(script);
  assert.equal(JSON.parse(out).exported, true, 'migrateSchema must be a public export');
});

test('Unit A: migrateSchema does not crash on a DB missing core tables', () => {
  // 建一個幾乎空的 DB（只有 accounts，缺 transactions / correction_log / classification_rules /
  // reporting 表），模擬極舊或部分匯出。migrateSchema 應以存在性守護 skip ALTER，不拋錯。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-unitA-old-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  try {
    const script = `
      const { openDatabase, migrateSchema } = require('./lib/db');
      const db = openDatabase(process.env.FINANCE_DB_PATH);
      db.exec("CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT)");
      let crashed = false;
      let msg = '';
      try {
        migrateSchema(db);
      } catch (e) {
        crashed = true;
        msg = e.message;
      }
      process.stdout.write(JSON.stringify({ crashed, msg }));
    `;
    const out = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, FINANCE_DB_PATH: dbPath, NODE_ENV: 'development' },
      timeout: 30000,
    });
    const r = JSON.parse(out);
    assert.equal(r.crashed, false, `migrateSchema should not crash on missing-table DB (got: ${r.msg})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Unit A: migrateSchema adds note to transaction_report_mappings and reason to report_mapping_rules on upgrade', () => {
  // 模擬舊版 DB：手動建 reporting 兩表（舊欄位，無 note/reason），跑 migrateSchema 後補欄。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-unitA-upgrade-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  try {
    const script = `
      const { openDatabase, migrateSchema } = require('./lib/db');
      const db = openDatabase(process.env.FINANCE_DB_PATH);
      // 舊版 reporting 表（migrate 前的欄位結構）
      db.exec("CREATE TABLE report_mapping_rules (id INTEGER PRIMARY KEY, note TEXT)");
      db.exec("CREATE TABLE transaction_report_mappings (transaction_id INTEGER PRIMARY KEY, reason TEXT)");
      migrateSchema(db);
      const rmCols = db.prepare('PRAGMA table_info(report_mapping_rules)').all().map(c => c.name);
      const tmCols = db.prepare('PRAGMA table_info(transaction_report_mappings)').all().map(c => c.name);
      process.stdout.write(JSON.stringify({
        rmHasReason: rmCols.includes('reason'),
        rmHasNote: rmCols.includes('note'),
        tmHasReason: tmCols.includes('reason'),
        tmHasNote: tmCols.includes('note'),
      }));
    `;
    const out = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, FINANCE_DB_PATH: dbPath, NODE_ENV: 'development' },
      timeout: 30000,
    });
    const r = JSON.parse(out);
    assert.equal(r.rmHasReason, true, 'report_mapping_rules.reason added on upgrade');
    assert.equal(r.rmHasNote, true, 'report_mapping_rules.note preserved');
    assert.equal(r.tmHasReason, true, 'transaction_report_mappings.reason preserved');
    assert.equal(r.tmHasNote, true, 'transaction_report_mappings.note added on upgrade');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
