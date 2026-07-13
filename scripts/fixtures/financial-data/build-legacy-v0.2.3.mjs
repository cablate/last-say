import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '../../..');

function parseOutput(argv) {
  const index = argv.indexOf('--output');
  if (index === -1 || !argv[index + 1]) {
    throw new Error('Usage: build-legacy-v0.2.3.mjs --output <explicit-temp-path>');
  }
  const output = path.resolve(argv[index + 1]);
  const relative = path.relative(repoRoot, output);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Legacy fixture output must be outside the repository. Use an explicit temporary path.');
  }
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing target: ${output}`);
  return output;
}

const output = parseOutput(process.argv.slice(2));
fs.mkdirSync(path.dirname(output), { recursive: true });
process.env.FINANCE_DB_PATH = output;

const { getDb, closeDb, getSchemaVersion } = require('../../../lib/db');
const db = getDb();

try {
  const accountId = db.prepare(`
    INSERT INTO accounts (name, institution, account_type, masked_number)
    VALUES (?, ?, ?, ?)
  `).run('Synthetic Legacy Card', 'Example Card Union', 'card', '1001').lastInsertRowid;

  const sourceId = db.prepare(`
    INSERT INTO sources (source_type, source_file, description, statement_month, row_count)
    VALUES (?, ?, ?, ?, ?)
  `).run('synthetic_card', 'synthetic/legacy-card.csv', 'Synthetic v0.2.3 fixture', '2026-06', 2).lastInsertRowid;

  const ruleId = db.prepare(`
    INSERT INTO classification_rules (
      match_key, source_type, direction, category_value, confidence, sample_count,
      applied_count, overridden_count, origin, enabled, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('EXAMPLE MARKET', 'synthetic_card', 'out', '日常開銷', 0.88, 2, 2, 1, 'ai_analysis', 1, 'Synthetic legacy rule with evidence note').lastInsertRowid;

  const insertTransaction = db.prepare(`
    INSERT INTO transactions (
      dedupe_key, import_match_key, transaction_date, transaction_month, statement_month,
      source_type, flow_type, name, amount, inflow, outflow, category_primary,
      category_sub, ai_confidence, judgment_reason, account_id, first_source_id,
      classification_source, rule_id, reviewed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const reviewedId = insertTransaction.run(
    'synthetic-legacy-reviewed', 'synthetic-match-reviewed', '2026-06-02', '2026-06', '2026-06',
    'synthetic_card', 'card_spend', 'EXAMPLE MARKET', -123400, 0, 123400,
    '飲食', '外食', 0.88, 'Synthetic AI classification later corrected by a person.',
    accountId, sourceId, 'human', null, 1,
  ).lastInsertRowid;
  insertTransaction.run(
    'synthetic-legacy-rule', 'synthetic-match-rule', '2026-06-03', '2026-06', '2026-06',
    'synthetic_card', 'card_spend', 'EXAMPLE MARKET BRANCH', -45600, 0, 45600,
    '日常開銷', '一般', 0.88, 'Synthetic rule classification.',
    accountId, sourceId, 'rule', ruleId, 0,
  );

  db.prepare(`
    INSERT INTO correction_log (
      transaction_id, field_name, old_value, new_value, match_key, source_type, direction, rule_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(reviewedId, 'category_primary', '日常開銷', '飲食', 'EXAMPLE MARKET', 'synthetic_card', 'out', ruleId);

  db.prepare(`
    INSERT INTO rule_change_log (
      rule_id, action, before_rule_json, after_rule_json, impacted_count,
      reclassified_count, pending_count, preserved_reviewed_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ruleId, 'update', '{"category_value":"一般"}', '{"category_value":"日常開銷"}', 2, 1, 0, 1);

  const summary = {
    fixture: 'legacy-v0.2.3',
    app_version: '0.2.3',
    schema_version: getSchemaVersion(db),
    tables: Object.fromEntries(['accounts', 'sources', 'transactions', 'classification_rules', 'correction_log', 'rule_change_log'].map((table) => [
      table,
      Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
    ])),
    output,
    host_tmp: path.resolve(os.tmpdir()),
  };
  console.log(JSON.stringify(summary));
} finally {
  closeDb();
}
