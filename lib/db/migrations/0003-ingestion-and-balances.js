const { randomUUID } = require('node:crypto');

const SOURCE = `financial-ingestion-v1:
ingestion_runs,ingestion_run_contexts,ingestion_items,
account_balance_snapshots,transactions-additive-active-state-minor-units`;

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function addColumns(db, table, definitions) {
  const current = columns(db, table);
  for (const [name, definition] of definitions) {
    if (!current.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function apply(db) {
  db.exec(`
    CREATE TABLE ingestion_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_key TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      schema_id TEXT NOT NULL,
      bundle_kind TEXT NOT NULL,
      source_id INTEGER REFERENCES sources(id) ON DELETE RESTRICT,
      authority TEXT NOT NULL,
      reason TEXT NOT NULL,
      ai_confidence REAL,
      status TEXT NOT NULL,
      expires_at TEXT,
      committed_at TEXT,
      reversed_at TEXT,
      reversal_of_run_id INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT,
      result_json TEXT,
      warnings_json TEXT,
      errors_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1))
    ) STRICT;
    CREATE INDEX ingestion_runs_status_idx ON ingestion_runs(status, expires_at);

    CREATE TABLE ingestion_run_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingestion_run_id INTEGER NOT NULL REFERENCES ingestion_runs(id) ON DELETE RESTRICT,
      context_kind TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      result_json TEXT,
      UNIQUE(ingestion_run_id, context_kind)
    ) STRICT;

    CREATE TABLE ingestion_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingestion_run_id INTEGER NOT NULL REFERENCES ingestion_runs(id) ON DELETE RESTRICT,
      context_kind TEXT NOT NULL,
      client_item_key TEXT NOT NULL,
      item_hash TEXT NOT NULL,
      staged_json TEXT,
      canonical_resource_type TEXT,
      canonical_resource_key TEXT,
      status TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ingestion_run_id, client_item_key)
    ) STRICT;
    CREATE INDEX ingestion_items_run_context_idx ON ingestion_items(ingestion_run_id, context_kind);

    CREATE TABLE account_balance_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_key TEXT NOT NULL UNIQUE,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      source_id INTEGER REFERENCES sources(id) ON DELETE RESTRICT,
      ingestion_run_id INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT,
      as_of_date TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      balance_kind TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      authority TEXT NOT NULL,
      review_state TEXT NOT NULL,
      record_status TEXT NOT NULL DEFAULT 'posted',
      duplicate_key TEXT NOT NULL UNIQUE,
      note TEXT,
      supersedes_snapshot_id INTEGER REFERENCES account_balance_snapshots(id) ON DELETE RESTRICT,
      reversed_by_run_id INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
    CREATE INDEX account_balance_lookup_idx ON account_balance_snapshots(account_id, balance_kind, as_of_date DESC);
  `);

  addColumns(db, 'sources', [
    ['ingestion_run_id', 'INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT'],
    ['reversed_by_run_id', 'INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT'],
  ]);
  addColumns(db, 'accounts', [
    ['ingestion_run_id', 'INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT'],
    ['reversed_by_run_id', 'INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT'],
  ]);
  addColumns(db, 'transactions', [
    ['transaction_key', 'TEXT'],
    ['currency', "TEXT NOT NULL DEFAULT 'TWD'"],
    ['amount_minor', 'INTEGER'],
    ['inflow_minor', 'INTEGER'],
    ['outflow_minor', 'INTEGER'],
    ['record_status', "TEXT NOT NULL DEFAULT 'posted'"],
    ['external_id', 'TEXT'],
    ['source_item_key', 'TEXT'],
    ['ingestion_run_id', 'INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT'],
    ['reversed_by_run_id', 'INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT'],
  ]);

  const rows = db.prepare('SELECT id, transaction_key FROM transactions ORDER BY id').all();
  const update = db.prepare('UPDATE transactions SET transaction_key=? WHERE id=?');
  for (const row of rows) if (!row.transaction_key) update.run(randomUUID(), row.id);
  db.exec('UPDATE transactions SET amount_minor=CAST(amount AS INTEGER),inflow_minor=CAST(inflow AS INTEGER),outflow_minor=CAST(outflow AS INTEGER) WHERE amount_minor IS NULL');

  db.exec(`
    CREATE UNIQUE INDEX transactions_transaction_key_uq ON transactions(transaction_key);
    CREATE INDEX transactions_active_status_idx ON transactions(record_status, transaction_month);
    CREATE UNIQUE INDEX transactions_external_identity_uq
      ON transactions(account_id, source_type, external_id)
      WHERE external_id IS NOT NULL;
  `);
}

module.exports = { version: 3, name: 'financial-ingestion-and-balances-v1', source: SOURCE, apply };
