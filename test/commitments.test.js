const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { createCommitment, createOccurrence, updateCommitment, getCommitment } = require('../lib/queries/finance/obligations');

test('editing a commitment template does not rewrite settled occurrences', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-commitment-'));
  const db = openDatabase(path.join(dir, 'test.sqlite')); initializeDatabase(db);
  try {
    const commitment = createCommitment({ entity_key: 'personal', commitment_kind: 'rent', direction: 'out', amount_kind: 'fixed', amount_minor: '1800000', currency: 'TWD', cadence: 'monthly', start_date: '2026-01-01', next_due_date: '2026-07-01', status: 'scheduled', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
    const occurrence = createOccurrence(commitment.commitment_key, { due_date: '2026-06-01', amount_minor: '1800000', occurrence_status: 'settled' }, {}, db);
    const updated = updateCommitment(commitment.commitment_key, { entity_key: 'personal', commitment_kind: 'rent', direction: 'out', amount_kind: 'fixed', amount_minor: '1900000', currency: 'TWD', cadence: 'monthly', start_date: '2026-01-01', next_due_date: '2026-08-01', status: 'scheduled', authority: 'user_confirmed', review_state: 'confirmed', expected_version: 1 }, {}, db);
    assert.equal(updated.amount_minor, 1900000);
    const stored = getCommitment(commitment.commitment_key, db);
    assert.equal(stored.occurrences[0].occurrence_key, occurrence.occurrence_key);
    assert.equal(stored.occurrences[0].amount_minor, '1800000');
    assert.equal(stored.occurrences[0].occurrence_status, 'settled');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
