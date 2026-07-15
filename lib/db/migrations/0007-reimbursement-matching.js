const SOURCE = `reimbursement-matching-v1:
reimbursement_matches,reimbursement_match_items`;

function apply(db) {
  db.exec(`
    CREATE TABLE reimbursement_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_key TEXT NOT NULL UNIQUE,
      reimbursement_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      currency TEXT NOT NULL,
      match_status TEXT NOT NULL,
      confidence REAL,
      authority TEXT NOT NULL,
      review_state TEXT NOT NULL,
      reason TEXT NOT NULL,
      note TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
    ) STRICT;
    CREATE UNIQUE INDEX reimbursement_active_inflow_uq
      ON reimbursement_matches(reimbursement_transaction_id)
      WHERE match_status <> 'rejected';
    CREATE INDEX reimbursement_match_status_idx
      ON reimbursement_matches(match_status,review_state,created_at);

    CREATE TABLE reimbursement_match_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES reimbursement_matches(id) ON DELETE RESTRICT,
      expense_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      allocated_minor INTEGER NOT NULL CHECK(allocated_minor > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(match_id,expense_transaction_id)
    ) STRICT;
    CREATE INDEX reimbursement_item_expense_idx
      ON reimbursement_match_items(expense_transaction_id,match_id);
  `);
}

module.exports = { version: 7, name: 'reimbursement-matching-v1', source: SOURCE, apply };
