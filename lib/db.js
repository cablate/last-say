// node:sqlite 連線 + schema 初始化。
// 共用於 Next.js API route（getDb 單例）與 CLI 腳本（openDatabase/initializeDatabase）。
// getDb 完全 lazy + globalThis 快取，避免 next build / dev hot-reload 開多條連線。
const path = require('node:path');
const fs = require('node:fs');

// Node 版本守門：node:sqlite 是 Node 22+ 內建。在 require 前擋，給清楚繁中錯誤，
// 而不是 Node<22 那個難懂的 ERR_UNKNOWN_BUILTIN_MODULE / Cannot find module 'node:sqlite'。
const _NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (_NODE_MAJOR < 22) {
  throw new Error(`需要 Node.js ≥ 22（本工具使用內建 node:sqlite）。目前版本：${process.version}，請先升級 Node。`);
}
const { DatabaseSync } = require('node:sqlite');

// 注意：必須用 process.cwd()，不能用 __dirname。
// next dev 會把 lib/db.js bundle 到 .next/server/...，此時 __dirname 指向 .next 內，
// 會讓 DB_PATH 誤指到 .next/.../data/finance.sqlite（空 DB）。npm scripts 永遠從專案根執行。
const PROJECT_ROOT = process.cwd();
// DB 路徑可由 FINANCE_DB_PATH 覆寫（絕對路徑或相對專案根）；預設 data/finance.sqlite。
// data/ 已 gitignore，真實 DB 不會進 repo。
const DB_PATH = process.env.FINANCE_DB_PATH
  ? (path.isAbsolute(process.env.FINANCE_DB_PATH) ? process.env.FINANCE_DB_PATH : path.join(PROJECT_ROOT, process.env.FINANCE_DB_PATH))
  : path.join(PROJECT_ROOT, 'data', 'finance.sqlite');
const DEFAULT_DB_PATH = DB_PATH;

// schema（CREATE TABLE IF NOT EXISTS，冪等）。
// 金額欄位 DDL 仍為 REAL，但自 cents migration 起值為「整數 cents（元×100）」。
// correction_log 為 append-only：FK ON DELETE RESTRICT + trigger 阻擋 UPDATE/DELETE。
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    institution TEXT NOT NULL DEFAULT 'Imported Source',
    account_type TEXT NOT NULL,
    masked_number TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,
    source_file TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    statement_month TEXT,
    row_count INTEGER,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_type, source_file, description)
  );

  CREATE TABLE IF NOT EXISTS classification_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_key TEXT,
    source_type TEXT,
    direction TEXT,
    category_value TEXT,
    confidence REAL NOT NULL DEFAULT 0,
    sample_count INTEGER NOT NULL DEFAULT 0,
    applied_count INTEGER NOT NULL DEFAULT 0,
    overridden_count INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'ai_analysis',
    enabled INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_rules_match_key ON classification_rules(match_key);
  CREATE INDEX IF NOT EXISTS idx_rules_enabled ON classification_rules(enabled);

  CREATE TABLE IF NOT EXISTS report_mapping_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_key TEXT,
    source_type TEXT,
    direction TEXT,
    report_line TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    sample_count INTEGER NOT NULL DEFAULT 0,
    applied_count INTEGER NOT NULL DEFAULT 0,
    overridden_count INTEGER NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT 'ai_analysis',
    enabled INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_report_mapping_rules_match_key ON report_mapping_rules(match_key);
  CREATE INDEX IF NOT EXISTS idx_report_mapping_rules_enabled ON report_mapping_rules(enabled);
  CREATE INDEX IF NOT EXISTS idx_report_mapping_rules_line ON report_mapping_rules(report_line);

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_key TEXT NOT NULL UNIQUE,
    import_match_key TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    transaction_month TEXT NOT NULL,
    statement_month TEXT,
    source_type TEXT NOT NULL,
    flow_type TEXT NOT NULL,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    inflow REAL NOT NULL DEFAULT 0,
    outflow REAL NOT NULL DEFAULT 0,
    category_primary TEXT NOT NULL,
    category_sub TEXT,
    ai_confidence REAL,
    judgment_reason TEXT,
    memo TEXT,
    raw_info TEXT,
    balance REAL,
    account_original_order TEXT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    first_source_id INTEGER REFERENCES sources(id),
    classification_source TEXT NOT NULL DEFAULT 'ai',
    rule_id INTEGER REFERENCES classification_rules(id) ON DELETE SET NULL,
    reviewed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transaction_sources (
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    source_row_id TEXT NOT NULL,
    source_description TEXT,
    raw_info TEXT,
    linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (transaction_id, source_id, source_row_id)
  );

  CREATE TABLE IF NOT EXISTS transaction_report_mappings (
    transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
    report_line TEXT NOT NULL,
    mapping_source TEXT NOT NULL DEFAULT 'human',
    confidence REAL,
    reason TEXT,
    note TEXT,
    reviewed INTEGER NOT NULL DEFAULT 1,
    rule_id INTEGER REFERENCES report_mapping_rules(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_transaction_report_mappings_line ON transaction_report_mappings(report_line);
  CREATE INDEX IF NOT EXISTS idx_trm_transaction_id ON transaction_report_mappings(transaction_id);

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_type TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    UNIQUE(tag_type, name)
  );

  CREATE TABLE IF NOT EXISTS transaction_tags (
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (transaction_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
  CREATE INDEX IF NOT EXISTS idx_transactions_month ON transactions(transaction_month);
  CREATE INDEX IF NOT EXISTS idx_transactions_statement_month ON transactions(statement_month);
  CREATE INDEX IF NOT EXISTS idx_transactions_source_type ON transactions(source_type);
  CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_primary);
  CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
  CREATE INDEX IF NOT EXISTS idx_tags_type_name ON tags(tag_type, name);

  CREATE TABLE IF NOT EXISTS correction_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    match_key TEXT,
    source_type TEXT,
    direction TEXT,
    rule_id INTEGER,
    corrected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_correction_log_txn ON correction_log(transaction_id);

  -- correction_log 為 append-only：log 應存活比源資料久，故 FK 改 ON DELETE RESTRICT。
  -- 僅允許 INSERT（logCorrection / batchCorrection 都是 INSERT），阻擋 UPDATE 與 DELETE。
  -- 髒資料清理（如雙重編碼亂碼）：需在單一交易內暫時 DROP 本 trigger → 變更 → 重建 → COMMIT。
  CREATE TRIGGER IF NOT EXISTS correction_log_no_update
  BEFORE UPDATE ON correction_log
  BEGIN
    SELECT RAISE(ABORT, 'correction_log is append-only');
  END;
  CREATE TRIGGER IF NOT EXISTS correction_log_no_delete
  BEFORE DELETE ON correction_log
  BEGIN
    SELECT RAISE(ABORT, 'correction_log is append-only');
  END;
`;

const g = globalThis;

// openDatabase：開啟（或建立）連線 + PRAGMA；不初始化 schema（由呼叫端決定，CLI 腳本用）。
function openDatabase(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

// initializeDatabase：執行 schema（含 correction_log append-only trigger）。
function initializeDatabase(db) {
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
}

function ensureReportingSchema(db) {
  // 守護：reporting 表的 FK 指向 transactions(id)。若 transactions 尚未建立（極舊 /
  // 部分匯出 DB），建立 referencing 表會在 foreign_keys=ON 下失敗。此時 skip——
  // 後續由 initializeDatabase 走完整 SCHEMA_SQL 補齊所有表後再 migrate。
  if (!tableExists(db, 'transactions')) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_mapping_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_key TEXT,
      source_type TEXT,
      direction TEXT,
      report_line TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      sample_count INTEGER NOT NULL DEFAULT 0,
      applied_count INTEGER NOT NULL DEFAULT 0,
      overridden_count INTEGER NOT NULL DEFAULT 0,
      origin TEXT NOT NULL DEFAULT 'ai_analysis',
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_report_mapping_rules_match_key ON report_mapping_rules(match_key);
    CREATE INDEX IF NOT EXISTS idx_report_mapping_rules_enabled ON report_mapping_rules(enabled);
    CREATE INDEX IF NOT EXISTS idx_report_mapping_rules_line ON report_mapping_rules(report_line);

    CREATE TABLE IF NOT EXISTS transaction_report_mappings (
      transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
      report_line TEXT NOT NULL,
      mapping_source TEXT NOT NULL DEFAULT 'human',
      confidence REAL,
      reason TEXT,
      note TEXT,
      reviewed INTEGER NOT NULL DEFAULT 1,
      rule_id INTEGER REFERENCES report_mapping_rules(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_transaction_report_mappings_line ON transaction_report_mappings(report_line);
    CREATE INDEX IF NOT EXISTS idx_trm_transaction_id ON transaction_report_mappings(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
  `);
}

// migration：為既有 DB 補新欄。CREATE TABLE IF NOT EXISTS 不會把欄加到已存在的表，
// 故對升級中的既有 DB 需 ALTER ADD。PRAGMA table_info 判斷欄是否存在 → 冪等。
//
// 極舊 DB 存在性守護：migrateSchema 可能被指向缺表的極舊 DB（例如只含 transactions 的早期匯出）。
// 直接 PRAGMA table_info(<缺表>) 會拋「no such table」而崩。故對 correction_log /
// classification_rules / transactions 先以 sqlite_master 查表存在性，缺表時跳過該段 ALTER
// （後續若需該表會由 SCHEMA_SQL / ensureReportingSchema 在 initializeDatabase 補建）。
function tableExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return Boolean(row);
}

function migrateSchema(db) {
  // transactions 升級（主表，正常情況下必存在；仍加守護以應付極舊 / 部分匯出 DB）
  if (tableExists(db, 'transactions')) {
    const cols = db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name);
    if (!cols.includes('classification_source')) {
      db.exec("ALTER TABLE transactions ADD COLUMN classification_source TEXT NOT NULL DEFAULT 'ai'");
    }
    if (!cols.includes('rule_id')) {
      db.exec('ALTER TABLE transactions ADD COLUMN rule_id INTEGER REFERENCES classification_rules(id) ON DELETE SET NULL');
    }
    if (!cols.includes('reviewed')) {
      db.exec('ALTER TABLE transactions ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0');
    }
    if (!cols.includes('ai_confidence')) {
      db.exec('ALTER TABLE transactions ADD COLUMN ai_confidence REAL');
    }
    if (!cols.includes('category_sub')) {
      db.exec('ALTER TABLE transactions ADD COLUMN category_sub TEXT');
    }
  }
  // correction_log 升級（像規則一樣自帶脈絡）：為既有 DB 補 match_key/source_type/direction/rule_id。
  if (tableExists(db, 'correction_log')) {
    const ccols = db.prepare('PRAGMA table_info(correction_log)').all().map((c) => c.name);
    if (!ccols.includes('match_key')) db.exec('ALTER TABLE correction_log ADD COLUMN match_key TEXT');
    if (!ccols.includes('source_type')) db.exec('ALTER TABLE correction_log ADD COLUMN source_type TEXT');
    if (!ccols.includes('direction')) db.exec('ALTER TABLE correction_log ADD COLUMN direction TEXT');
    if (!ccols.includes('rule_id')) db.exec('ALTER TABLE correction_log ADD COLUMN rule_id INTEGER');
  }
  // classification_rules 覆寫率統計（客觀指標，補 AI 主觀信心度）
  if (tableExists(db, 'classification_rules')) {
    const rcols = db.prepare('PRAGMA table_info(classification_rules)').all().map((c) => c.name);
    if (!rcols.includes('applied_count')) db.exec('ALTER TABLE classification_rules ADD COLUMN applied_count INTEGER NOT NULL DEFAULT 0');
    if (!rcols.includes('overridden_count')) db.exec('ALTER TABLE classification_rules ADD COLUMN overridden_count INTEGER NOT NULL DEFAULT 0');
  }

  // reporting 表（report_mapping_rules / transaction_report_mappings）建表責任統一在此，
  // 透過 ensureReportingSchema 冪等補表 + 補索引。新建 DB 由 SCHEMA_SQL 建立、migrateSchema
  // 再 ensure 一次（IF NOT EXISTS 冪等）；升級舊 DB 則靠此處補回缺失的 reporting 表。
  ensureReportingSchema(db);

  // reporting 欄位統一：兩表從此都具備 reason（AI 判斷理由）+ note（證據／出處）。
  // transaction_report_mappings 補 note；report_mapping_rules 補 reason。
  if (tableExists(db, 'transaction_report_mappings')) {
    const tmcols = db.prepare('PRAGMA table_info(transaction_report_mappings)').all().map((c) => c.name);
    if (!tmcols.includes('note')) db.exec('ALTER TABLE transaction_report_mappings ADD COLUMN note TEXT');
  }
  if (tableExists(db, 'report_mapping_rules')) {
    const rmcols = db.prepare('PRAGMA table_info(report_mapping_rules)').all().map((c) => c.name);
    if (!rmcols.includes('reason')) db.exec('ALTER TABLE report_mapping_rules ADD COLUMN reason TEXT');
  }

  // Data repair: a human classification is already a completed review.
  if (tableExists(db, 'transactions')) {
    db.exec("UPDATE transactions SET reviewed = 1 WHERE reviewed = 0 AND classification_source = 'human'");
  }
}

function createDb() {
  const db = openDatabase(DEFAULT_DB_PATH);
  initializeDatabase(db);
  return db;
}

function getDb() {
  if (!g.__financeDb) {
    g.__financeDb = createDb();
  }
  return g.__financeDb;
}

function closeDb() {
  if (g.__financeDb) {
    try { g.__financeDb.close(); } catch { /* already closed */ }
    delete g.__financeDb;
  }
}

module.exports = {
  getDb,
  closeDb,
  openDatabase,
  initializeDatabase,
  migrateSchema,
  ensureReportingSchema,
  DB_PATH,
  DEFAULT_DB_PATH,
  PROJECT_ROOT,
};
