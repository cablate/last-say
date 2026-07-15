const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, initializeDatabase } = require('../lib/db');
const { createAccount } = require('../lib/queries/finance/accounts');
const {
  createInstrument,
  createManualHolding,
  createManualMarketQuote,
  createManualFxQuote,
  investmentPositions,
} = require('../lib/queries/finance/investments');

function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'last-say-manual-invest-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  initializeDatabase(db);
  try { return run(db); }
  finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('manual holding, quote and FX entries create source evidence atomically', () => fixture((db) => {
  const account = createAccount({ display_name: 'Synthetic broker', account_kind: 'investment', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  const instrument = createInstrument({ instrument_type: 'etf', name: 'Synthetic USD Fund', symbol: 'SUF', quote_currency: 'USD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);

  const holding = createManualHolding({ account_key: account.account_key, instrument_key: instrument.instrument_key, as_of_date: '2026-07-15', quantity_decimal: '2.5', reported_market_value_minor: '25000' }, {}, db);
  const quote = createManualMarketQuote({ instrument_key: instrument.instrument_key, as_of_date: '2026-07-15', price_decimal: '100' }, {}, db);
  const fx = createManualFxQuote({ base_currency: 'USD', quote_currency: 'TWD', as_of_date: '2026-07-15', rate_decimal: '32.5' }, {}, db);

  assert.equal(holding.source.source_kind, 'manual_note');
  assert.equal(holding.holding.currency, 'USD');
  assert.equal(quote.quote.quote_currency, 'USD');
  assert.equal(fx.fx_quote.rate_decimal, '32.5');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM sources').get().count, 3);
  assert.equal(investmentPositions({ entityKey: 'personal', asOfDate: '2026-07-15', baseCurrency: 'TWD' }, db)[0].base_value_minor, '812500');
}));
test('manual investment composite write rolls back source evidence when typed fact validation fails', () => fixture((db) => {
  const account = createAccount({ display_name: 'Synthetic broker', account_kind: 'investment', currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  const instrument = createInstrument({ instrument_type: 'stock', name: 'Synthetic stock', quote_currency: 'JPY', authority: 'user_confirmed', review_state: 'confirmed' }, {}, db);
  assert.throws(() => createManualHolding({ account_key: account.account_key, instrument_key: instrument.instrument_key, as_of_date: '2026-07-15', quantity_decimal: 'not-a-number' }, {}, db), /quantity_decimal/);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM sources').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM holding_snapshots').get().count, 0);
}));
