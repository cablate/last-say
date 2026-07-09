const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// WP1 — POST /api/reports/mapping-rules 寫入層測試。
// 直接測 queries/reports/mappings 的 createReportMappingRule（route 只是薄殼）。
// 覆蓋：白名單校驗、至少一個比對條件、direction 校驗、回 {id}、enabled 預設、confidence 範圍。

function runFixture(setup, op) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-mr-q-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  const script = `
    const { getDb } = require('./lib/db');
    const { createReportMappingRule } = require('./lib/queries');
    const db = getDb();
    ${setup}
    let result;
    try {
      result = { ok: true, value: ${op} };
    } catch (e) {
      result = { ok: false, message: e.message };
    }
    process.stdout.write(JSON.stringify(result));
  `;
  let output;
  try {
    output = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, FINANCE_DB_PATH: dbPath, NODE_ENV: 'development' },
      timeout: 30000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return JSON.parse(output);
}

test('mapping-rules: inserts a valid rule and returns {id}', () => {
  const r = runFixture(
    ``,
    "createReportMappingRule({ match_key: 'starbucks', report_line: 'expense:food', confidence: 0.9, reason: 'coffee' })",
  );
  assert.equal(r.ok, true);
  assert.ok(Number.isInteger(r.value.id));
  assert.ok(r.value.id > 0);
});

test('mapping-rules: rejects unknown report_line (whitelist)', () => {
  const r = runFixture(
    ``,
    "createReportMappingRule({ match_key: 'x', report_line: 'bogus:line' })",
  );
  assert.equal(r.ok, false);
  assert.match(r.message, /白名單/);
});

test('mapping-rules: requires at least one match condition', () => {
  const r = runFixture(
    ``,
    "createReportMappingRule({ report_line: 'expense:food' })",
  );
  assert.equal(r.ok, false);
  assert.match(r.message, /至少需指定一個比對條件/);
});

test('mapping-rules: rejects invalid direction', () => {
  const r = runFixture(
    ``,
    "createReportMappingRule({ match_key: 'x', report_line: 'expense:food', direction: 'sideways' })",
  );
  assert.equal(r.ok, false);
  assert.match(r.message, /direction/);
});

test('mapping-rules: accepts direction in/out and source_type', () => {
  const r = runFixture(
    ``,
    "createReportMappingRule({ match_key: 'uber', source_type: 'card', direction: 'out', report_line: 'expense:transportation' })",
  );
  assert.equal(r.ok, true);
  assert.ok(r.value.id > 0);
});

test('mapping-rules: defaults enabled to true (1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-mr-enabled-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  const script = `
    const { getDb } = require('./lib/db');
    const { createReportMappingRule } = require('./lib/queries');
    const db = getDb();
    const { id } = createReportMappingRule({ match_key: 'x', report_line: 'expense:food' });
    const row = db.prepare('SELECT enabled, confidence FROM report_mapping_rules WHERE id = ?').get(id);
    process.stdout.write(JSON.stringify(row));
  `;
  let output;
  try {
    output = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, FINANCE_DB_PATH: dbPath, NODE_ENV: 'development' },
      timeout: 30000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const row = JSON.parse(output);
  assert.equal(row.enabled, 1);
  assert.equal(row.confidence, 0);
});

test('mapping-rules: enabled=false stores 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-mr-disabled-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  const script = `
    const { getDb } = require('./lib/db');
    const { createReportMappingRule } = require('./lib/queries');
    const db = getDb();
    const { id } = createReportMappingRule({ match_key: 'x', report_line: 'expense:food', enabled: false });
    const row = db.prepare('SELECT enabled FROM report_mapping_rules WHERE id = ?').get(id);
    process.stdout.write(JSON.stringify(row));
  `;
  let output;
  try {
    output = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, FINANCE_DB_PATH: dbPath, NODE_ENV: 'development' },
      timeout: 30000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const row = JSON.parse(output);
  assert.equal(row.enabled, 0);
});

test('mapping-rules: rejects invalid confidence range', () => {
  const r = runFixture(
    ``,
    "createReportMappingRule({ match_key: 'x', report_line: 'expense:food', confidence: 2 })",
  );
  assert.equal(r.ok, false);
  assert.match(r.message, /confidence/);
});

// ── Unit A：reason / note 獨立寫入（不再合併進 note）─────────────────

test('mapping-rules: writes reason and note into separate columns (Unit A)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-mr-rn-sep-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  const script = `
    const { getDb } = require('./lib/db');
    const { createReportMappingRule } = require('./lib/queries');
    const db = getDb();
    const { id } = createReportMappingRule({ match_key: 'starbucks', report_line: 'expense:food', reason: 'AI judgment', note: 'source: receipt' });
    const row = db.prepare('SELECT reason, note FROM report_mapping_rules WHERE id = ?').get(id);
    process.stdout.write(JSON.stringify(row));
  `;
  let output;
  try {
    output = execFileSync(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, FINANCE_DB_PATH: dbPath, NODE_ENV: 'development' },
      timeout: 30000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const row = JSON.parse(output);
  assert.equal(row.reason, 'AI judgment', 'reason in its own column');
  assert.equal(row.note, 'source: receipt', 'note in its own column, not merged with reason');
});
