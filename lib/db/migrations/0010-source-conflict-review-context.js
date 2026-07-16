const SOURCE = 'source-conflict-review-context-v1:source_conflicts.reason,source_conflicts.impact_note';

function apply(db) {
  db.exec(`
    ALTER TABLE source_conflicts ADD COLUMN reason TEXT;
    ALTER TABLE source_conflicts ADD COLUMN impact_note TEXT;
  `);
}

module.exports = { version: 10, name: 'source-conflict-review-context-v1', source: SOURCE, apply };
