// scripts/migrate-amount-to-cents.js
//
// 金額 cents migration（方案3 最小改動）。
// 將 transactions.amount / inflow / outflow / balance 從「元（REAL）」改存「cents（REAL 存整數）」。
// schema 型別不變（仍是 REAL），只改「值」與「顯示」。
// 顯示端在 lib/format.js 的 formatTWD 統一除 100。
//
// 冪等：若 MAX(amount) 已 > 1000000，視為已經是 cents，印 skipped 並 exit 0。
// 跑前後各印 COUNT 與固定 5 筆抽樣（取前 5 筆 id）對帳。
//
// 用法：node scripts/migrate-amount-to-cents.js

'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(process.cwd(), 'data', 'finance.sqlite');

// 已是 cents 的閾值。原始資料最大約 10 萬元，乘 100 後 > 1000 萬，
// 故 MAX(amount) > 1_000_000 表示資料已遷移過。
const ALREADY_CENTS_THRESHOLD = 1_000_000;
const SAMPLE_LIMIT = 5;

function dump(db, label) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count;
  const sample = db.prepare(
    'SELECT id, amount, inflow, outflow, balance FROM transactions ORDER BY id LIMIT ?',
  ).all(SAMPLE_LIMIT);
  console.log(`[${label}] COUNT = ${count}`);
  for (const row of sample) {
    console.log(
      `  id=${row.id} amount=${row.amount} inflow=${row.inflow} outflow=${row.outflow} balance=${row.balance}`,
    );
  }
}

function main() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON;');

  // 冪等檢查：MAX(amount) 若已 > 閾值，視為已遷移。
  const maxRow = db.prepare('SELECT MAX(amount) AS maxAmount FROM transactions').get();
  const maxAmount = Number(maxRow?.maxAmount ?? 0);
  if (maxAmount > ALREADY_CENTS_THRESHOLD) {
    console.log(
      `skipped: MAX(amount)=${maxAmount} > ${ALREADY_CENTS_THRESHOLD}, transactions already in cents.`,
    );
    dump(db, 'current');
    db.close();
    process.exit(0);
  }

  console.log(`DB: ${DB_PATH}`);
  console.log(`MAX(amount) before = ${maxAmount} (<= ${ALREADY_CENTS_THRESHOLD}), proceeding with migration.`);
  dump(db, 'before');

  // 同一 transaction 內一次 UPDATE 四個金額欄位。
  // ROUND 確保 REAL 浮點乘 100 後轉成整數值（仍以 REAL 型別存放，精確到 2^53）。
  db.exec('BEGIN');
  try {
    db.exec(`
      UPDATE transactions
      SET
        amount   = ROUND(amount * 100),
        inflow   = ROUND(inflow * 100),
        outflow  = ROUND(outflow * 100),
        balance  = CASE WHEN balance IS NULL THEN NULL ELSE ROUND(balance * 100) END
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  console.log('migration applied.');
  dump(db, 'after');

  db.close();
}

main();
