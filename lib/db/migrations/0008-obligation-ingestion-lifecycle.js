const SOURCE = `obligation-ingestion-lifecycle-v1:
credit_card_profiles,credit_card_statements,credit_card_payment_matches,
credit_card_installment_plans,liability_profiles,loan_schedule_entries,
loan_payment_allocations,commitment_templates,commitment_occurrences`;

const TABLES_WITH_NEW_STATUS = [
  'credit_card_profiles',
  'credit_card_payment_matches',
  'credit_card_installment_plans',
  'liability_profiles',
  'loan_schedule_entries',
  'loan_payment_allocations',
  'commitment_templates',
  'commitment_occurrences',
];

const ALL_LIFECYCLE_TABLES = ['credit_card_statements', ...TABLES_WITH_NEW_STATUS];

function apply(db) {
  for (const table of TABLES_WITH_NEW_STATUS) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN record_status TEXT NOT NULL DEFAULT 'posted'`);
  }
  for (const table of ALL_LIFECYCLE_TABLES) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ingestion_run_id INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT`);
    db.exec(`ALTER TABLE ${table} ADD COLUMN reversed_by_run_id INTEGER REFERENCES ingestion_runs(id) ON DELETE RESTRICT`);
    db.exec(`CREATE INDEX ${table}_lifecycle_idx ON ${table}(record_status,ingestion_run_id)`);
  }
}

module.exports = { version: 8, name: 'obligation-ingestion-lifecycle-v1', source: SOURCE, apply };
