const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, initializeDatabase } = require('../lib/db');
const { createInstrument, updateInstrument } = require('../lib/queries/finance/investments');

test('typed instrument metadata correction preserves identity and uses optimistic versioning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-instrument-update-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  try {
    initializeDatabase(db);
    const created = createInstrument({ instrument_type: 'etf', name: 'Synthetic ETF', symbol: 'SYN-ETF', exchange: 'TEST', quote_currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, { type: 'test' }, db);
    const updated = updateInstrument(created.instrument_key, { expected_version: 1, name: 'Synthetic ETF corrected' }, { type: 'test' }, db);
    assert.equal(updated.name, 'Synthetic ETF corrected');
    assert.equal(updated.symbol, 'SYN-ETF');
    assert.equal(updated.version, 2);
    assert.throws(() => updateInstrument(created.instrument_key, { expected_version: 1, name: 'Stale' }, { type: 'test' }, db), /Expected version 1/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
