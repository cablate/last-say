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
    institution TEXT NOT NULL DEFAULT '國泰',
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
    owner_value TEXT,
    category_value TEXT,
    necessity_value TEXT,
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
    owner_primary TEXT NOT NULL,
    category_primary TEXT NOT NULL,
    category_sub TEXT,
    necessity TEXT NOT NULL,
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
  CREATE INDEX IF NOT EXISTS idx_transactions_owner ON transactions(owner_primary);
  CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_primary);
  CREATE INDEX IF NOT EXISTS idx_transactions_necessity ON transactions(necessity);
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

// migration：為既有 DB 補新欄。CREATE TABLE IF NOT EXISTS 不會把欄加到已存在的表，
// 故對升級中的既有 DB 需 ALTER ADD。PRAGMA table_info 判斷欄是否存在 → 冪等。
function migrateSchema(db) {
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
  // correction_log 升級（像規則一樣自帶脈絡）：為既有 DB 補 match_key/source_type/direction/rule_id。
  const ccols = db.prepare('PRAGMA table_info(correction_log)').all().map((c) => c.name);
  if (!ccols.includes('match_key')) db.exec('ALTER TABLE correction_log ADD COLUMN match_key TEXT');
  if (!ccols.includes('source_type')) db.exec('ALTER TABLE correction_log ADD COLUMN source_type TEXT');
  if (!ccols.includes('direction')) db.exec('ALTER TABLE correction_log ADD COLUMN direction TEXT');
  if (!ccols.includes('rule_id')) db.exec('ALTER TABLE correction_log ADD COLUMN rule_id INTEGER');
  // classification_rules 覆寫率統計（客觀指標，補 AI 主觀信心度）
  const rcols = db.prepare('PRAGMA table_info(classification_rules)').all().map((c) => c.name);
  if (!rcols.includes('applied_count')) db.exec('ALTER TABLE classification_rules ADD COLUMN applied_count INTEGER NOT NULL DEFAULT 0');
  if (!rcols.includes('overridden_count')) db.exec('ALTER TABLE classification_rules ADD COLUMN overridden_count INTEGER NOT NULL DEFAULT 0');
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
  DB_PATH,
  DEFAULT_DB_PATH,
  PROJECT_ROOT,
};
