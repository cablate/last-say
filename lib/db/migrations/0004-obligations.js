const SOURCE = `financial-obligations-v1:
credit_card_profiles,credit_card_statements,credit_card_statement_items,
credit_card_payment_matches,credit_card_installment_plans,credit_card_installment_entries,
liability_profiles,loan_schedule_entries,loan_payment_allocations,
commitment_templates,commitment_occurrences`;

function apply(db) {
  db.exec(`
    CREATE TABLE credit_card_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, profile_key TEXT NOT NULL UNIQUE,
      account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
      statement_close_day INTEGER, payment_due_day INTEGER, credit_limit_minor INTEGER,
      currency TEXT NOT NULL, authority TEXT NOT NULL, review_state TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(statement_close_day IS NULL OR statement_close_day BETWEEN 1 AND 31),
      CHECK(payment_due_day IS NULL OR payment_due_day BETWEEN 1 AND 31)
    ) STRICT;
    CREATE TABLE credit_card_statements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, statement_key TEXT NOT NULL UNIQUE,
      profile_id INTEGER NOT NULL REFERENCES credit_card_profiles(id) ON DELETE RESTRICT,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
      period_start TEXT NOT NULL, period_end TEXT NOT NULL, close_date TEXT NOT NULL, due_date TEXT NOT NULL,
      statement_balance_minor INTEGER NOT NULL, minimum_due_minor INTEGER, full_due_minor INTEGER,
      currency TEXT NOT NULL, record_status TEXT NOT NULL DEFAULT 'posted', authority TEXT NOT NULL,
      review_state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, close_date, source_id)
    ) STRICT;
    CREATE TABLE credit_card_statement_items (
      statement_id INTEGER NOT NULL REFERENCES credit_card_statements(id) ON DELETE RESTRICT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      item_role TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(statement_id, transaction_id)
    ) STRICT;
    CREATE TABLE credit_card_payment_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, match_key TEXT NOT NULL UNIQUE,
      statement_id INTEGER NOT NULL REFERENCES credit_card_statements(id) ON DELETE RESTRICT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      amount_minor INTEGER NOT NULL, match_status TEXT NOT NULL, authority TEXT NOT NULL,
      review_state TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(statement_id, transaction_id)
    ) STRICT;
    CREATE TABLE credit_card_installment_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, plan_key TEXT NOT NULL UNIQUE,
      profile_id INTEGER NOT NULL REFERENCES credit_card_profiles(id) ON DELETE RESTRICT,
      originating_transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      source_id INTEGER REFERENCES sources(id) ON DELETE RESTRICT,
      financed_principal_minor INTEGER NOT NULL, installment_count INTEGER NOT NULL CHECK(installment_count>0),
      start_date TEXT NOT NULL, apr_decimal TEXT, fee_minor INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL, authority TEXT NOT NULL, review_state TEXT NOT NULL,
      reconciliation_status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
    CREATE TABLE credit_card_installment_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entry_key TEXT NOT NULL UNIQUE,
      plan_id INTEGER NOT NULL REFERENCES credit_card_installment_plans(id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL CHECK(sequence>0), due_date TEXT NOT NULL,
      principal_minor INTEGER NOT NULL, interest_minor INTEGER NOT NULL DEFAULT 0,
      fee_minor INTEGER NOT NULL DEFAULT 0, total_minor INTEGER NOT NULL,
      entry_status TEXT NOT NULL, settled_transaction_id INTEGER REFERENCES transactions(id) ON DELETE RESTRICT,
      UNIQUE(plan_id, sequence), CHECK(total_minor=principal_minor+interest_minor+fee_minor)
    ) STRICT;
    CREATE TABLE liability_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, liability_key TEXT NOT NULL UNIQUE,
      account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
      source_id INTEGER REFERENCES sources(id) ON DELETE RESTRICT,
      liability_kind TEXT NOT NULL, original_principal_minor INTEGER NOT NULL, currency TEXT NOT NULL,
      rate_type TEXT NOT NULL, apr_decimal TEXT, apr_as_of TEXT, start_date TEXT NOT NULL,
      maturity_date TEXT, payment_frequency TEXT NOT NULL, authority TEXT NOT NULL,
      review_state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
    CREATE TABLE loan_schedule_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_key TEXT NOT NULL UNIQUE,
      liability_id INTEGER NOT NULL REFERENCES liability_profiles(id) ON DELETE RESTRICT,
      source_id INTEGER REFERENCES sources(id) ON DELETE RESTRICT, sequence INTEGER NOT NULL,
      due_date TEXT NOT NULL, principal_minor INTEGER NOT NULL, interest_minor INTEGER NOT NULL DEFAULT 0,
      fee_minor INTEGER NOT NULL DEFAULT 0, total_minor INTEGER NOT NULL, entry_status TEXT NOT NULL,
      authority TEXT NOT NULL, review_state TEXT NOT NULL,
      UNIQUE(liability_id, sequence), CHECK(total_minor=principal_minor+interest_minor+fee_minor)
    ) STRICT;
    CREATE TABLE loan_payment_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, allocation_key TEXT NOT NULL UNIQUE,
      schedule_entry_id INTEGER NOT NULL REFERENCES loan_schedule_entries(id) ON DELETE RESTRICT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      principal_minor INTEGER NOT NULL, interest_minor INTEGER NOT NULL DEFAULT 0,
      fee_minor INTEGER NOT NULL DEFAULT 0, total_minor INTEGER NOT NULL,
      reconciliation_status TEXT NOT NULL, authority TEXT NOT NULL, review_state TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(schedule_entry_id, transaction_id), CHECK(total_minor=principal_minor+interest_minor+fee_minor)
    ) STRICT;
    CREATE TABLE commitment_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, commitment_key TEXT NOT NULL UNIQUE,
      entity_id INTEGER NOT NULL REFERENCES reporting_entities(id) ON DELETE RESTRICT,
      account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
      commitment_kind TEXT NOT NULL, direction TEXT NOT NULL, amount_kind TEXT NOT NULL,
      amount_minor INTEGER, amount_min_minor INTEGER, amount_max_minor INTEGER, currency TEXT NOT NULL,
      cadence TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT, next_due_date TEXT,
      status TEXT NOT NULL, authority TEXT NOT NULL, review_state TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
    CREATE TABLE commitment_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, occurrence_key TEXT NOT NULL UNIQUE,
      commitment_id INTEGER NOT NULL REFERENCES commitment_templates(id) ON DELETE RESTRICT,
      due_date TEXT NOT NULL, amount_minor INTEGER, occurrence_status TEXT NOT NULL,
      transaction_id INTEGER REFERENCES transactions(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(commitment_id, due_date)
    ) STRICT;
  `);
}

module.exports = { version: 4, name: 'financial-obligations-v1', source: SOURCE, apply };
