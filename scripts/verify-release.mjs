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
        matches.push(`${file}:${index + 1}:${line}`);
      }
    }
  }
  if (matches.length > 0) fail('personalized-residue', matches.join('\n'));
  pass('personalized-residue', 'no cathay/國泰 outside prompts/playbook.md and .gitignore');
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
