import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync, backup } from 'node:sqlite';

const fixtureDir = import.meta.dirname;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-phase0-spikes-'));

function percentile(samples, fraction) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function timed(run, iterations = 20) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  return {
    iterations,
    p50_ms: Number(percentile(samples, 0.5).toFixed(3)),
    p95_ms: Number(percentile(samples, 0.95).toFixed(3)),
  };
}

function runBigIntSpike() {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE facts (amount_minor INTEGER NOT NULL) STRICT');
    const value = 9_007_199_254_740_993n;
    db.prepare('INSERT INTO facts (amount_minor) VALUES (?)').run(value);
    const statement = db.prepare('SELECT amount_minor FROM facts');
    statement.setReadBigInts(true);
    const result = statement.get().amount_minor;
    assert.equal(result, value);
    return { input: value.toString(), output: result.toString(), type: typeof result, exact: true };
  } finally {
    db.close();
  }
}

async function runBackupSpike() {
  const sourcePath = path.join(tempDir, 'wal-source.sqlite');
  const backupPath = path.join(tempDir, 'wal-backup.sqlite');
  const source = new DatabaseSync(sourcePath);
  try {
    const journalMode = source.prepare('PRAGMA journal_mode = WAL').get().journal_mode;
    source.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE resources (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        resource_id INTEGER NOT NULL REFERENCES resources(id),
        action TEXT NOT NULL
      );
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'append-only'); END;
      INSERT INTO resources (value) VALUES ('committed-in-wal');
      INSERT INTO audit_log (resource_id, action) VALUES (1, 'create');
      PRAGMA user_version = 23;
    `);

    await backup(source, backupPath, { rate: 32 });
    const restored = new DatabaseSync(backupPath);
    try {
      restored.exec('PRAGMA foreign_keys = ON');
      const integrity = restored.prepare('PRAGMA integrity_check').get().integrity_check;
      const foreignKeys = restored.prepare('PRAGMA foreign_key_check').all();
      const value = restored.prepare('SELECT value FROM resources WHERE id = 1').get().value;
      const auditCount = Number(restored.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count);
      const userVersion = restored.prepare('PRAGMA user_version').get().user_version;
      assert.deepEqual({ integrity, foreignKeys, value, auditCount, userVersion }, {
        integrity: 'ok', foreignKeys: [], value: 'committed-in-wal', auditCount: 1, userVersion: 23,
      });
      return {
        journal_mode: journalMode,
        mechanism: 'node:sqlite backup(sourceDb, destinationPath)',
        integrity_check: integrity,
        foreign_key_violations: foreignKeys.length,
        restored_value: value,
        append_only_log_rows: auditCount,
        schema_version: userVersion,
      };
    } finally {
      restored.close();
    }
  } finally {
    source.close();
  }
}

function runAccountsMigrationSpike() {
  const legacyPath = path.join(tempDir, 'legacy-v0.2.3.sqlite');
  const builderOutput = JSON.parse(execFileSync(process.execPath, [
    path.join(fixtureDir, 'build-legacy-v0.2.3.mjs'), '--output', legacyPath,
  ], { encoding: 'utf8' }).trim());
  const db = new DatabaseSync(legacyPath);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE accounts ADD COLUMN account_key TEXT;
        ALTER TABLE accounts ADD COLUMN display_name TEXT;
        ALTER TABLE accounts ADD COLUMN currency TEXT;
        ALTER TABLE accounts ADD COLUMN account_kind TEXT;
        ALTER TABLE accounts ADD COLUMN authority TEXT;
        ALTER TABLE accounts ADD COLUMN review_state TEXT;
        ALTER TABLE accounts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      `);
      db.prepare(`
        UPDATE accounts
        SET account_key = 'acct_legacy_' || id,
            display_name = name,
            currency = 'TWD',
            account_kind = CASE account_type WHEN 'card' THEN 'credit_card' ELSE 'other' END,
            authority = 'ai_inferred',
            review_state = 'needs_review'
      `).run();
      db.exec(`
        CREATE UNIQUE INDEX accounts_account_key_uq ON accounts(account_key);
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    const account = db.prepare('SELECT name, account_key, display_name, currency, account_kind, authority, review_state, version FROM accounts').get();
    const counts = Object.fromEntries(['transactions', 'classification_rules', 'correction_log', 'rule_change_log'].map((table) => [
      table,
      Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ]));
    assert.deepEqual(counts, {
      transactions: 2, classification_rules: 1, correction_log: 1, rule_change_log: 1,
    });
    assert.equal(account.display_name, account.name);
    return { legacy: builderOutput.tables, after: counts, account, rebuild_required: false };
  } finally {
    db.close();
  }
}

function runBenchmarkSpike() {
  const db = new DatabaseSync(path.join(tempDir, 'benchmark.sqlite'));
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE benchmark_transactions (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL,
        transaction_date TEXT NOT NULL,
        transaction_month TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE benchmark_holdings (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL,
        instrument_id INTEGER NOT NULL,
        as_of_date TEXT NOT NULL,
        quantity_decimal TEXT NOT NULL
      );
      CREATE TABLE benchmark_quotes (
        id INTEGER PRIMARY KEY,
        instrument_id INTEGER NOT NULL,
        as_of_date TEXT NOT NULL,
        price_decimal TEXT NOT NULL
      );
    `);
    const tx = db.prepare('INSERT INTO benchmark_transactions (account_id, transaction_date, transaction_month, amount_minor, status) VALUES (?, ?, ?, ?, ?)');
    const holding = db.prepare('INSERT INTO benchmark_holdings (account_id, instrument_id, as_of_date, quantity_decimal) VALUES (?, ?, ?, ?)');
    const quote = db.prepare('INSERT INTO benchmark_quotes (instrument_id, as_of_date, price_decimal) VALUES (?, ?, ?)');
    db.exec('BEGIN');
    for (let index = 0; index < 100_000; index += 1) {
      const month = String((index % 12) + 1).padStart(2, '0');
      const day = String((index % 28) + 1).padStart(2, '0');
      tx.run((index % 12) + 1, `2026-${month}-${day}`, `2026-${month}`, BigInt((index % 50_000) - 25_000), 'posted');
    }
    for (let index = 0; index < 10_000; index += 1) {
      const instrumentId = (index % 2_000) + 1;
      holding.run((index % 20) + 1, instrumentId, '2026-06-30', `${(index % 1000) + 1}.25`);
      quote.run(instrumentId, '2026-07-14', `${(index % 500) + 10}.125`);
    }
    db.exec(`
      COMMIT;
      CREATE INDEX benchmark_tx_month_account ON benchmark_transactions(transaction_month, account_id, status);
      CREATE INDEX benchmark_holdings_account_date ON benchmark_holdings(account_id, as_of_date, instrument_id);
      CREATE INDEX benchmark_quotes_instrument_date ON benchmark_quotes(instrument_id, as_of_date DESC);
      ANALYZE;
    `);

    const txSummary = db.prepare(`
      SELECT account_id, SUM(amount_minor) AS total_minor, COUNT(*) AS row_count
      FROM benchmark_transactions
      WHERE transaction_month BETWEEN '2026-01' AND '2026-12' AND status = 'posted'
      GROUP BY account_id
    `);
    const positions = db.prepare(`
      SELECT h.account_id, h.instrument_id, h.quantity_decimal, q.price_decimal
      FROM benchmark_holdings h
      JOIN benchmark_quotes q ON q.id = (
        SELECT q2.id FROM benchmark_quotes q2
        WHERE q2.instrument_id = h.instrument_id
        ORDER BY q2.as_of_date DESC, q2.id DESC LIMIT 1
      )
      WHERE h.account_id = 1 AND h.as_of_date = '2026-06-30'
    `);
    txSummary.all();
    positions.all();
    const results = {
      transaction_summary: timed(() => txSummary.all()),
      investment_positions: timed(() => positions.all()),
    };
    const plans = {
      transaction_summary: db.prepare(`EXPLAIN QUERY PLAN
        SELECT account_id, SUM(amount_minor), COUNT(*) FROM benchmark_transactions
        WHERE transaction_month BETWEEN '2026-01' AND '2026-12' AND status = 'posted'
        GROUP BY account_id`).all().map((row) => row.detail),
      investment_positions: db.prepare(`EXPLAIN QUERY PLAN
        SELECT h.account_id, h.instrument_id, h.quantity_decimal, q.price_decimal
        FROM benchmark_holdings h JOIN benchmark_quotes q ON q.id = (
          SELECT q2.id FROM benchmark_quotes q2 WHERE q2.instrument_id = h.instrument_id
          ORDER BY q2.as_of_date DESC, q2.id DESC LIMIT 1)
        WHERE h.account_id = 1 AND h.as_of_date = '2026-06-30'`).all().map((row) => row.detail),
    };
    return { rows: { transactions: 100_000, holdings: 10_000, quotes: 10_000 }, results, plans };
  } finally {
    db.close();
  }
}

try {
  const environmentDb = new DatabaseSync(':memory:');
  const sqliteVersion = environmentDb.prepare('SELECT sqlite_version() AS version').get().version;
  environmentDb.close();
  const evidence = {
    environment: {
      node: process.version,
      sqlite: sqliteVersion,
      platform: `${process.platform}-${process.arch}`,
    },
    bigint: runBigIntSpike(),
    wal_backup_restore: await runBackupSpike(),
    accounts_additive_migration: runAccountsMigrationSpike(),
    benchmark: runBenchmarkSpike(),
  };
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
