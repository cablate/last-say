// WP7a — Query Performance Benchmark
// spec SPIKE: Query Performance 要求 100k 列基準（過去未交付）。
//
// 本腳本：
//   1. 產生 100k 匿名 fixture DB（data/benchmark.sqlite，無真實個資，金額 INTEGER cents）。
//   2. 計時核心查詢在 100k 列的耗時：getIncomeStatement（單月 + all）、getSummary、getTransactions。
//   3. 輸出可讀 console 報告。
//
// 純全新檔，不改 lib/ 業務程式碼。fixture DB 留在 data/（已被 .gitignore data/* 覆蓋）。
//
// 用法：node scripts/benchmark-report.mjs [--rows=N] [--keep-db]
//   --rows=N    產生列數（預設 100000）
//   --keep-db   不刪既有 benchmark DB（預設每次重建，確保基準可重現）

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

// === FINANCE_DB_PATH 必須在 require('../lib/db') 之前設定 ===
// lib/db.js 在 module load 時讀 process.env.FINANCE_DB_PATH 決定 DEFAULT_DB_PATH，
// 故需先指到 benchmark DB，再 require 業務模組。
const PROJECT_ROOT = process.cwd();
const BENCHMARK_DB_PATH = path.join(PROJECT_ROOT, 'data', 'benchmark.sqlite');
process.env.FINANCE_DB_PATH = BENCHMARK_DB_PATH;

const require = createRequire(import.meta.url);
const {
  openDatabase,
  initializeDatabase,
  ensureReportingSchema,
} = require('../lib/db.js');
const queries = require('../lib/queries/index.js');

// === CLI 參數 ===
const args = process.argv.slice(2);
const rowsArg = args.find((a) => a.startsWith('--rows='));
const TARGET_ROWS = rowsArg ? Math.max(1000, Number(rowsArg.split('=')[1]) || 100000) : 100000;
const KEEP_DB = args.includes('--keep-db');

// === 匿名 fixture 類別池（涵蓋 revenue / expense / excluded，讓報表分類真實運作） ===
// 名稱刻意匿名（無真實商家），但分類命中 CATEGORY_REPORT_LINES / built-in keyword，
// 讓 getIncomeStatement 走 mapped 路徑而非全 unmapped（更貼近真實負載）。
const EXPENSE_PROFILES = [
  { name: 'restaurant meal', category: '飲食', flow: '信用卡消費' },
  { name: 'coffee shop', category: '飲食', flow: '信用卡消費' },
  { name: 'daily living store', category: '日常開銷', flow: '信用卡消費' },
  { name: 'rent payment', category: '居住', flow: '銀行轉帳' },
  { name: 'transport metro', category: '交通', flow: '信用卡消費' },
  { name: 'shopping store', category: '購物', flow: '信用卡消費' },
  { name: 'subscription software', category: '訂閱服務', flow: '信用卡消費' },
  { name: 'medical clinic', category: '醫療保健', flow: '信用卡消費' },
  { name: 'insurance premium', category: '保險', flow: '信用卡消費' },
  { name: 'education course', category: '教育學習', flow: '信用卡消費' },
  { name: 'bank fee tax', category: '金融手續與稅費', flow: '信用卡消費' },
];
const REVENUE_PROFILES = [
  { name: 'salary payroll', category: '薪資收入', flow: '銀行轉帳' },
  { name: 'business revenue client', category: '其他收入與收益', flow: '銀行轉帳' },
  { name: 'interest income bank', category: '其他收入與收益', flow: '銀行轉帳' },
];
const EXCLUDED_PROFILES = [
  { name: 'internal transfer', category: '轉帳/內部移轉', flow: '信用卡繳款/移轉' },
];

const ACCOUNTS = [
  { name: '示範信用卡 *1234', sourceType: '信用卡 *1234', type: 'credit_card', masked: '1234' },
  { name: '示範信用卡 *5678', sourceType: '信用卡 *5678', type: 'credit_card', masked: '5678' },
  { name: '示範帳戶 ****1490', sourceType: '示範帳戶 ****1490', type: 'bank_account', masked: '1490' },
  { name: '示範帳戶 ****2233', sourceType: '示範帳戶 ****2233', type: 'bank_account', masked: '2233' },
];

// 決定性 PRNG（seed 固定），讓基準可重現。
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rng, profiles, totalWeight) {
  let r = rng() * totalWeight;
  for (const p of profiles) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return profiles[profiles.length - 1];
}

function buildProfiles() {
  // 權重：expense 85% / revenue 10% / excluded 5%
  const expense = EXPENSE_PROFILES.map((p) => ({ ...p, weight: 85 / EXPENSE_PROFILES.length }));
  const revenue = REVENUE_PROFILES.map((p) => ({ ...p, weight: 10 / REVENUE_PROFILES.length }));
  const excluded = EXCLUDED_PROFILES.map((p) => ({ ...p, weight: 5 / EXCLUDED_PROFILES.length }));
  const all = [...expense, ...revenue, ...excluded];
  const total = all.reduce((s, p) => s + p.weight, 0);
  return { all, total };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 產生 100k 列匿名 transactions + 對應 accounts。
function buildFixtureDb(dbPath, targetRows) {
  // 清掉舊 DB + sidecar，確保乾淨基準。
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }

  const db = openDatabase(dbPath);
  initializeDatabase(db);
  ensureReportingSchema(db);

  // accounts + sources（sources 為 FK 必填，最少 1 筆）
  const insertAccount = db.prepare(`
    INSERT INTO accounts (name, institution, account_type, masked_number)
    VALUES (?, 'Benchmark Fixture', ?, ?)
  `);
  const getAccountId = db.prepare('SELECT id FROM accounts WHERE name = ?');
  const insertSource = db.prepare(`
    INSERT INTO sources (source_type, source_file, description, statement_month, row_count)
    VALUES (?, '', ?, ?, ?)
  `);
  const getSourceId = db.prepare('SELECT id FROM sources WHERE source_type = ? AND source_file = ? AND description = ?');

  const accountIds = [];
  const sourceIds = [];
  db.exec('BEGIN');
  try {
    for (const acc of ACCOUNTS) {
      insertSource.run(acc.sourceType, `benchmark ${acc.sourceType}`, '2025-06', 25000);
      sourceIds.push(getSourceId.get(acc.sourceType, '', `benchmark ${acc.sourceType}`).id);
    }
    for (const acc of ACCOUNTS) {
      insertAccount.run(acc.name, acc.type, acc.masked);
      accountIds.push(getAccountId.get(acc.name).id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const { all: profiles, total } = buildProfiles();
  const rng = mulberry32(20260709);

  // 月份池：12 個月（2024-07 ~ 2025-06），分散資料以測單月 vs all。
  const months = [];
  for (let m = 0; m < 12; m++) {
    const year = 2024 + Math.floor((7 + m - 1) / 12);
    const mon = ((7 + m - 1) % 12) + 1;
    months.push(`${year}-${pad2(mon)}`);
  }

  // 24 欄：judgment_reason/memo/raw_info=''（空字串）、rule_id=NULL（fixed），
  // 其餘 20 欄走 ?。VALUES 的 ? 數必須與 .run() 引數數一致。
  const insertTxn = db.prepare(`
    INSERT INTO transactions (
      dedupe_key, import_match_key, transaction_date, transaction_month, statement_month,
      source_type, flow_type, name, amount, inflow, outflow,
      category_primary, category_sub, judgment_reason, memo, raw_info, balance,
      account_original_order, account_id, first_source_id, classification_source, rule_id, ai_confidence, reviewed
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', ?, ?, ?, ?, ?, NULL, ?, ?)
  `);

  const BATCH = 5000;
  let inserted = 0;
  const t0 = process.hrtime.bigint();

  while (inserted < targetRows) {
    const chunk = Math.min(BATCH, targetRows - inserted);
    db.exec('BEGIN');
    try {
      for (let i = 0; i < chunk; i++) {
        const idx = inserted + i;
        const profile = pickWeighted(rng, profiles, total);
        const accountIdx = Math.floor(rng() * ACCOUNTS.length);
        const sourceIdx = Math.floor(rng() * sourceIds.length);
        const monthIdx = Math.floor(rng() * months.length);
        const month = months[monthIdx];
        const day = 1 + Math.floor(rng() * 28); // 1-28，避免月底邊界
        const date = `${month}-${pad2(day)}`;

        // 金額：expense/excluded 50~5000 元（cents 5000~500000），revenue 1000~80000 元
        let inflowCents = 0;
        let outflowCents = 0;
        if (profile.category === '薪資收入' || profile.category === '其他收入與收益') {
          inflowCents = (1000 + Math.floor(rng() * 79000)) * 100;
        } else {
          outflowCents = (50 + Math.floor(rng() * 4950)) * 100;
        }
        const signedAmount = inflowCents - outflowCents;

        // dedupe_key：用 idx 保證唯一（匿名 fixture 無業務語意，只求不撞 UNIQUE）。
        const dedupeKey = crypto.createHash('sha1').update(`bench-${idx}`).digest('hex');
        const importMatchKey = crypto.createHash('sha1').update(`bench-imk-${idx}`).digest('hex');

        // 銀行帳戶才有 balance；隨機漸進讓 getSummary 的 latestBalance query 有資料。
        const isBank = ACCOUNTS[accountIdx].type === 'bank_account';
        const balance = isBank ? (1000000 + idx * 37) * 100 : null;

        const order = isBank ? String(idx) : '';

        // classification_source / ai_confidence / reviewed 混合分布（貼近真實 DB）
        const sourceRoll = rng();
        let classSource;
        let aiConf;
        let reviewed;
        if (sourceRoll < 0.6) {
          classSource = 'rule';
          aiConf = 0.7 + rng() * 0.3;
          reviewed = rng() < 0.5 ? 1 : 0;
        } else if (sourceRoll < 0.9) {
          classSource = 'ai';
          aiConf = 0.4 + rng() * 0.5;
          reviewed = 0;
        } else {
          classSource = 'human';
          aiConf = null;
          reviewed = 1;
        }

        insertTxn.run(
          dedupeKey,
          importMatchKey,
          date,
          month,
          month, // statement_month = transaction_month（簡化）
          ACCOUNTS[accountIdx].sourceType,
          profile.flow,
          profile.name,
          signedAmount,
          inflowCents,
          outflowCents,
          profile.category,
          null, // category_sub（judgment_reason/memo/raw_info 為 '' 字面值，不占 ?）
          balance,
          order,
          accountIds[accountIdx],
          sourceIds[sourceIdx],
          classSource,
          aiConf,
          reviewed
        );
      }
      db.exec('COMMIT');
      inserted += chunk;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;

  const counts = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
  const monthCount = db.prepare('SELECT COUNT(DISTINCT transaction_month) AS c FROM transactions').get().c;
  db.close();

  return { rows: counts, months: monthCount, buildMs: Math.round(elapsed) };
}

// === 計時工具 ===
function msFromHrtime(ns) {
  return Number(ns) / 1e6;
}

function timeOnce(fn) {
  const t0 = process.hrtime.bigint();
  const result = fn();
  const elapsed = process.hrtime.bigint() - t0;
  return { ms: Math.round(msFromHrtime(elapsed) * 1000) / 1000, result };
}

// 跑 N 次取中位數（去掉第一次 warm-up 的純 JS 編譯成本）。
function timeMedian(label, fn, runs = 5) {
  const samples = [];
  let lastResult = null;
  for (let i = 0; i < runs; i++) {
    const { ms, result } = timeOnce(fn);
    samples.push(ms);
    lastResult = result;
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const min = samples[0];
  const max = samples[samples.length - 1];
  return { label, median, min, max, runs, samples, lastResult };
}

function fmtMs(ms) {
  if (ms < 10) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// === 主流程 ===
function main() {
  console.log('=== Last Say — Query Performance Benchmark ===\n');
  console.log(`Target rows: ${TARGET_ROWS.toLocaleString()}`);
  console.log(`DB path:     ${BENCHMARK_DB_PATH}`);
  console.log(`Keep DB:     ${KEEP_DB}\n`);

  // 1. 產生 fixture
  if (!KEEP_DB) {
    console.log('Building fixture DB (anonymous, no real PII)...');
  } else {
    console.log('Building fixture DB (--keep-db ignored: always rebuilds for reproducible baseline)...');
  }
  const build = buildFixtureDb(BENCHMARK_DB_PATH, TARGET_ROWS);
  console.log(`  inserted ${build.rows.toLocaleString()} transactions across ${build.months} months in ${fmtMs(build.buildMs)}\n`);

  if (build.rows < TARGET_ROWS) {
    console.warn(`  WARN: expected ${TARGET_ROWS} rows, got ${build.rows}`);
  }

  // 2. 開連線做基準（用 openDatabase 指同一個 DB）
  const db = openDatabase(BENCHMARK_DB_PATH);

  // getIncomeStatement(params, db) — params 用 plain object with .get
  // 取一個資料量中位的月份做「單月」基準
  const monthRow = db.prepare(`
    SELECT transaction_month AS m, COUNT(*) AS c
    FROM transactions GROUP BY transaction_month ORDER BY c DESC LIMIT 1
  `).get();
  const sampleMonth = monthRow?.m;
  const sampleMonthCount = monthRow?.c;
  console.log(`Sample month for single-month benchmarks: ${sampleMonth} (${sampleMonthCount?.toLocaleString()} rows)\n`);

  const allCount = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
  console.log(`Total rows (all-time): ${allCount.toLocaleString()}\n`);

  // params helper：getIncomeStatement 用 {get(key)}，getSummary/getTransactions 用 URLSearchParams
  const incomeParamsMonth = { get: (k) => (k === 'month' ? sampleMonth : null) };
  const incomeParamsAll = { get: () => null };
  const summaryParamsMonth = new URLSearchParams({ month: sampleMonth });
  const summaryParamsAll = new URLSearchParams({});
  const txnParamsMonth = new URLSearchParams({ month: sampleMonth, limit: '1000' });
  const txnParamsAll = new URLSearchParams({ limit: '1000' });

  const RUNS = 5;
  console.log(`Running ${RUNS} iterations per query (reporting median)...\n`);

  const benchmarks = [
    timeMedian(
      `getIncomeStatement(month=${sampleMonth})`,
      () => queries.getIncomeStatement(incomeParamsMonth, db),
      RUNS
    ),
    timeMedian(
      'getIncomeStatement(all)',
      () => queries.getIncomeStatement(incomeParamsAll, db),
      RUNS
    ),
    timeMedian(
      `getSummary(month=${sampleMonth})`,
      () => queries.getSummary(summaryParamsMonth),
      RUNS
    ),
    timeMedian(
      'getSummary(all)',
      () => queries.getSummary(summaryParamsAll),
      RUNS
    ),
    timeMedian(
      `getTransactions(month=${sampleMonth}, limit=1000)`,
      () => queries.getTransactions(txnParamsMonth),
      RUNS
    ),
    timeMedian(
      'getTransactions(all, limit=1000)',
      () => queries.getTransactions(txnParamsAll),
      RUNS
    ),
  ];

  db.close();

  // 3. 報告
  console.log('=== Benchmark Results ===\n');
  const rowsLabel = `${build.rows.toLocaleString()} rows`;
  console.log(`Dataset: ${rowsLabel} across ${build.months} months (sample month ${sampleMonth}: ${sampleMonthCount?.toLocaleString()} rows)\n`);

  const labelWidth = Math.max(...benchmarks.map((b) => b.label.length));
  console.log(
    `${'Query'.padEnd(labelWidth)}  ${'median'.padStart(10)}  ${'min'.padStart(10)}  ${'max'.padStart(10)}  runs`
  );
  console.log(`${'─'.repeat(labelWidth)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}  ${'─'.repeat(10)}  ${'─'.repeat(4)}`);
  for (const b of benchmarks) {
    console.log(
      `${b.label.padEnd(labelWidth)}  ${fmtMs(b.median).padStart(10)}  ${fmtMs(b.min).padStart(10)}  ${fmtMs(b.max).padStart(10)}  ${b.runs}`
    );
  }

  // 簡易判定：參考 spec SPIKE「100k 列下核心查詢應在合理互動時間內」
  // （spec 未定硬門檻，這裡只標 >1s 為觀察點）
  console.log('\n=== Notes ===');
  const slow = benchmarks.filter((b) => b.median > 1000);
  if (slow.length > 0) {
    console.log(`>1s observed on: ${slow.map((b) => b.label).join(', ')}`);
  } else {
    console.log('All queries under 1s median at this dataset size.');
  }
  console.log(`\nFixture DB retained at ${BENCHMARK_DB_PATH} (gitignored under data/*).`);

  // 4. JSON summary（方便 CI / 後續 parse）
  const summary = {
    spec: 'WP7a / SPIKE: Query Performance',
    dataset: { rows: build.rows, months: build.months, sampleMonth, sampleMonthCount, buildMs: build.buildMs },
    runs: RUNS,
    results: benchmarks.map((b) => ({
      query: b.label,
      median_ms: b.median,
      min_ms: b.min,
      max_ms: b.max,
      samples_ms: b.samples,
    })),
    dbPath: BENCHMARK_DB_PATH,
    timestamp: new Date().toISOString(),
  };
  return summary;
}

const summary = main();
console.log('\n--- JSON ---');
console.log(JSON.stringify(summary, null, 2));
