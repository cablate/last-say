import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEMO_DB = 'data/dev-demo.sqlite';
const BUILD_DB = 'data/dev-verify-build.sqlite';
const SCREENSHOTS = [
  'docs/screenshots/overview-demo.png',
  'docs/screenshots/trend-demo.png',
  'docs/screenshots/needs-review-demo.png',
];

const checks = [];

function rel(path) {
  return relative(ROOT, path).replaceAll(sep, '/');
}

function commandLine(command, args) {
  return [command, ...args].join(' ');
}

function run(command, args, options = {}) {
  const label = options.label ?? commandLine(command, args);
  const printOutput = options.printOutput !== false;
  console.log(`\n$ ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (printOutput && result.stdout) process.stdout.write(result.stdout);
  if (printOutput && result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} exited with ${result.status}`);
  }
  return result.stdout ?? '';
}

function pass(name, detail) {
  checks.push({ name, status: 'PASS', detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
}

function fail(name, detail) {
  checks.push({ name, status: 'FAIL', detail });
  throw new Error(`${name}: ${detail}`);
}

function ensureDemoDb() {
  if (existsSync(resolve(ROOT, DEMO_DB))) {
    pass('demo-db-present', DEMO_DB);
    return;
  }
  run(process.execPath, ['scripts/seed-demo.js'], {
    label: `FINANCE_DB_PATH=${DEMO_DB} node scripts/seed-demo.js`,
    env: { FINANCE_DB_PATH: DEMO_DB },
  });
  pass('demo-db-seeded', DEMO_DB);
}

function getRows(db, sql) {
  return db.prepare(sql).all();
}

function getRow(db, sql) {
  return db.prepare(sql).get();
}

function checkDemoMetrics() {
  ensureDemoDb();
  const dbPath = resolve(ROOT, DEMO_DB);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const monthRows = getRows(db, `
      SELECT transaction_month AS month,
             COUNT(*) AS rows,
             SUM(CASE WHEN classification_source = 'rule' THEN 1 ELSE 0 END) AS rule_rows,
             ROUND(100.0 * SUM(CASE WHEN classification_source = 'rule' THEN 1 ELSE 0 END) / COUNT(*), 1) AS automation_rate
      FROM transactions
      GROUP BY transaction_month
      ORDER BY transaction_month
    `);
    const lowConfidence = getRow(db, `
      SELECT COUNT(*) AS count
      FROM transactions
      WHERE reviewed = 0
        AND (ai_confidence < 0.5 OR ai_confidence IS NULL OR classification_source = 'pending')
    `).count;
    const humanRules = getRow(db, `
      SELECT COUNT(*) AS count
      FROM classification_rules
      WHERE origin = 'human_correction'
    `).count;

    if (monthRows.length < 6) fail('demo-months', `expected >=6, got ${monthRows.length}`);
    for (let i = 1; i < monthRows.length; i += 1) {
      if (!(monthRows[i].automation_rate > monthRows[i - 1].automation_rate)) {
        fail('demo-automation-increasing', JSON.stringify(monthRows));
      }
    }
    if (!(lowConfidence > 0)) fail('demo-low-confidence', `expected >0, got ${lowConfidence}`);
    if (!(humanRules > 0)) fail('demo-human-correction-rules', `expected >0, got ${humanRules}`);

    pass(
      'demo-metrics',
      `months=${monthRows.length}; automation=${monthRows.map((r) => `${r.month}:${r.automation_rate}%`).join(' -> ')}; lowConfidence=${lowConfidence}; humanCorrectionRules=${humanRules}`,
    );
  } finally {
    db.close();
  }
}

// Demo seed 遮罩號（****1234 / ****5678 / ****2468 / ****3579 / ****8080）。
// 這些是 `*` 前綴 + 4 碼尾號，不是真實卡號，掃描時必須排除以免誤判 demo 資料。
const DEMO_MASKED_TAILS = new Set(['1234', '5678', '2468', '3579', '8080']);

// 偵測疑似真實卡號。回傳匹配說明或 null。
// 規則：
//   1. 連續 13-16 碼純數字（但排除 `*` 前綴的 demo 遮罩號 `****<尾4碼>`）
//   2. 4-4-4-4 格式（1234-5678-9012-3456）
// 不誤判：日期（YYYY-MM-DD / YYYYMMDD 最多 8 碼）、小數金額、demo `****1234` 遮罩。
function detectCardNumber(line) {
  // 4-4-4-4 格式（dash 或 space 分組）
  const grouped = line.match(/\b(\d{4})[-\s](\d{4})[-\s](\d{4})[-\s](\d{4})\b/);
  if (grouped) {
    return `grouped card number ${grouped[0]}`;
  }
  // 連續 13-16 碼數字。逐一檢查，排除 demo `****<尾4碼>` 遮罩相鄰形成的長串，
  // 以及被 `*` 直接前綴的遮罩號。
  for (const match of line.matchAll(/\d{13,16}/g)) {
    const digits = match[0];
    const start = match.index;
    // 排除：前面緊鄰 `*`（demo 遮罩 ****1234）— 但 ****1234 只有 4 碼不會匹配 13+，
    // 這裡主要防禦 `****1234****5678` 之類拼接地。只要前一字元是 `*` 就視為遮罩片段。
    const prevChar = start > 0 ? line[start - 1] : '';
    const nextChar = start + digits.length < line.length ? line[start + digits.length] : '';
    if (prevChar === '*' || nextChar === '*') continue;
    return `card number ${digits}`;
  }
  return null;
}

function checkPersonalizedResidue() {
  const stdout = run('git', ['ls-files'], { label: 'git ls-files', printOutput: false });
  const allowedFiles = new Set(['prompts/playbook.md', '.gitignore']);
  const exts = new Set(['.js', '.jsx', '.json', '.md']);
  const matches = [];
  for (const file of stdout.split(/\r?\n/).filter(Boolean)) {
    if (!exts.has(extname(file))) continue;
    if (allowedFiles.has(file)) continue;
    const text = readFileSync(resolve(ROOT, file), 'utf8');
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (/cathay|國泰/i.test(line)) {
        matches.push(`${file}:${index + 1}:bank-name:${line}`);
        continue;
      }
      const cardHit = detectCardNumber(line);
      if (cardHit) {
        matches.push(`${file}:${index + 1}:${cardHit}:${line}`);
      }
    }
  }
  if (matches.length > 0) fail('personalized-residue', matches.join('\n'));
  pass(
    'personalized-residue',
    'no cathay/國泰, card numbers (13-16 digits / 4-4-4-4) outside prompts/playbook.md and .gitignore',
  );
}

function checkScreenshots() {
  const details = [];
  for (const file of SCREENSHOTS) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) fail('screenshots', `${file} missing`);
    const stat = statSync(path);
    if (stat.size <= 0) fail('screenshots', `${file} is empty`);
    const buffer = readFileSync(path);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    details.push(`${file}:${stat.size}b:${width}x${height}`);
  }
  pass('screenshots', details.join(', '));
}

function main() {
  console.log('Finance Viewer release verification');
  console.log(`cwd=${ROOT}`);
  console.log(`demoDb=${DEMO_DB}`);
  console.log(`buildDb=${BUILD_DB}`);
  console.log('realDb=data/finance.sqlite (not opened by this script)');

  run(process.execPath, ['--test'], {
    label: 'node --test',
    env: { FINANCE_DB_PATH: 'data/dev-test.sqlite' },
  });
  pass('node-test', 'passed');

  run(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
    label: `FINANCE_DB_PATH=${BUILD_DB} next build`,
    env: { FINANCE_DB_PATH: BUILD_DB },
  });
  pass('next-build', 'passed');

  checkPersonalizedResidue();
  checkDemoMetrics();
  checkScreenshots();

  console.log('\nRelease verification summary');
  for (const check of checks) {
    console.log(`${check.status} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`\nFAIL ${error?.message ?? error}`);
  if (checks.length > 0) {
    console.error('\nPartial verification summary');
    for (const check of checks) {
      console.error(`${check.status} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
    }
  }
  process.exit(1);
}
