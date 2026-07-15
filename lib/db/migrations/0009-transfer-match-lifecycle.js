const SOURCE = `transfer-match-lifecycle-v1:
transfer_matches-version-and-updated-at`;

function apply(db) {
  db.exec("ALTER TABLE transfer_matches ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  db.exec("ALTER TABLE transfer_matches ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE transfer_matches SET updated_at=created_at WHERE updated_at=''");
}

module.exports = { version: 9, name: 'transfer-match-lifecycle-v1', source: SOURCE, apply };
