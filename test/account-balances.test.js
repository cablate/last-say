const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const { createSource } = require('../lib/queries/finance/sources');
const { createBalanceSnapshot, latestBalanceForAccount } = require('../lib/queries/finance/balances');
const { readinessForGoal } = require('../lib/queries/finance/inventory');
const { createSourceExpectation } = require('../lib/queries/finance/scope');

test('official and inferred balances coexist; conflict and missing scope remain visible', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-balance-')); const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const account = createAccount({ display_name: 'Synthetic bank', account_kind: 'bank', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const inferred = createSource({ source_kind: 'manual_note', description: 'Synthetic running balance', authority: 'ai_inferred', account_key: account.account_key }, {}, db);
    const official = createSource({ source_kind: 'bank_statement_csv', description: 'Synthetic official balance', authority: 'institution_export', account_key: account.account_key, is_official: true }, {}, db);
    createBalanceSnapshot({ account_key: account.account_key, source_key: inferred.source_key, as_of_date: '2026-06-30', observed_at: '2026-07-01T00:00:00Z', balance_kind: 'ledger', amount_minor: '9000000', currency: 'TWD', authority: 'ai_inferred' }, {}, db);
    createBalanceSnapshot({ account_key: account.account_key, source_key: official.source_key, as_of_date: '2026-06-30', observed_at: '2026-07-01T01:00:00Z', balance_kind: 'ledger', amount_minor: '10000000', currency: 'TWD', authority: 'official', review_state: 'confirmed' }, {}, db);
    const latest = latestBalanceForAccount(account.account_key, { asOfDate: '2026-07-01' }, db); assert.equal(latest.selected.amount_minor, '10000000'); assert.equal(latest.status, 'conflicted'); assert.equal(latest.conflicts.length, 1);
    const readiness = readinessForGoal('cash_position', { asOfDate: '2026-07-01' }, db); assert.equal(readiness.status, 'conflicted'); assert.ok(readiness.gaps.some((gap) => gap.gap === 'missing_scope_attestation'));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('AI source expectations remain candidate gaps; confirmed expectations are hard gaps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-expectation-')); const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    createSourceExpectation({ entity_key: 'personal', target_context: 'cash_activity', expected_source_kind: 'bank_statement_csv', cadence: 'monthly', authority: 'ai_inferred', review_state: 'needs_review', goals: ['spending_history'] }, {}, db);
    let result = readinessForGoal('spending_history', { asOfDate: '2026-07-14' }, db); assert.ok(result.candidate_gaps.some((gap) => gap.gap === 'missing_expected_source')); assert.ok(!result.gaps.some((gap) => gap.gap === 'missing_expected_source'));
    createSourceExpectation({ entity_key: 'personal', target_context: 'cash_activity', expected_source_kind: 'current_transactions_csv', cadence: 'monthly', authority: 'user_confirmed', review_state: 'confirmed', goals: ['spending_history'] }, {}, db);
    result = readinessForGoal('spending_history', { asOfDate: '2026-07-14' }, db); assert.ok(result.gaps.some((gap) => gap.gap === 'missing_expected_source'));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
