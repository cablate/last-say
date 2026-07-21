const { FinanceError, requiredString, enumValue, currency, isoDate, expectedVersion } = require('../../finance/contracts');
const { parseDecimal, decimalToMinor, minorToDecimal } = require('../../finance/money/decimal');
const { getDb, stableKey, logChange, requireRow, withTransaction, assertVersion } = require('./common');
const { moneyMinor } = require('./balances');
const { createSource } = require('./sources');

function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FinanceError('VALIDATION_ERROR', 'body must be an object'); }
function account(db, key) { const row = requireRow(db.prepare('SELECT * FROM accounts WHERE account_key=?').get(key), 'Account'); if (row.account_kind !== 'investment') throw new FinanceError('VALIDATION_ERROR', 'Account kind must be investment'); return row; }
function instrument(db, key) { return requireRow(db.prepare('SELECT * FROM instruments WHERE instrument_key=?').get(key), 'Instrument'); }
function source(db, key) { if (!key) throw new FinanceError('SOURCE_REQUIRED', 'source_key is required', { field: 'source_key' }); return requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(key), 'Source'); }
function transaction(db, key) { return requireRow(db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(key), 'Transaction'); }
function confidence(value) { if (value == null) return null; const number = Number(value); if (!Number.isFinite(number) || number < 0 || number > 1) throw new FinanceError('VALIDATION_ERROR', 'confidence must be between 0 and 1'); return number; }
function log(db, type, key, after, actor) { logChange(db, { resourceType: type, resourceKey: key, action: 'create', after, actorType: actor.type, actorNote: actor.note }); }

function listInstruments(db = getDb()) { return db.prepare('SELECT * FROM instruments ORDER BY active DESC,name').all(); }
function createInstrument(input, actor = {}, db = getDb()) {
  object(input); const type = enumValue(input.instrument_type, 'instrument_type', 'instrument_type'); const key = stableKey();
  return withTransaction(db, () => {
    try { db.prepare(`INSERT INTO instruments(instrument_key,instrument_type,name,symbol,exchange,isin,quote_currency,active,authority,review_state)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(key, type, requiredString(input.name, 'name', 200), input.symbol || null, input.exchange || null, input.isin || null, currency(input.quote_currency), input.active === false ? 0 : 1, enumValue(input.authority, 'authority', 'authority'), enumValue(input.review_state, 'review_state', 'review_state', 'needs_review')); }
    catch (error) { if (String(error.message).includes('UNIQUE')) throw new FinanceError('IDENTITY_CONFLICT', 'Instrument identity already exists', { status: 409 }); throw error; }
    const row = db.prepare('SELECT * FROM instruments WHERE instrument_key=?').get(key); log(db, 'instrument', key, row, actor); return row;
  });
}

function updateInstrument(key, input, actor = {}, db = getDb()) {
  object(input);
  const version = expectedVersion(input.expected_version);
  return withTransaction(db, () => {
    const before = requireRow(db.prepare('SELECT * FROM instruments WHERE instrument_key=?').get(key), 'Instrument');
    assertVersion(before, version);
    const name = requiredString(input.name ?? before.name, 'name', 200);
    const symbol = input.symbol === undefined ? before.symbol : (input.symbol || null);
    const exchange = input.exchange === undefined ? before.exchange : (input.exchange || null);
    const isin = input.isin === undefined ? before.isin : (input.isin || null);
    const quoteCurrency = currency(input.quote_currency ?? before.quote_currency);
    const type = enumValue(input.instrument_type ?? before.instrument_type, 'instrument_type', 'instrument_type');
    const active = input.active === undefined ? before.active : (input.active === false ? 0 : 1);
    const authority = enumValue(input.authority ?? before.authority, 'authority', 'authority');
    const review = enumValue(input.review_state ?? before.review_state, 'review_state', 'review_state');
    try {
      db.prepare(`UPDATE instruments SET instrument_type=?,name=?,symbol=?,exchange=?,isin=?,quote_currency=?,active=?,authority=?,review_state=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE instrument_key=?`)
        .run(type, name, symbol, exchange, isin, quoteCurrency, active, authority, review, key);
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) throw new FinanceError('IDENTITY_CONFLICT', 'Instrument identity already exists', { status: 409 });
      throw error;
    }
    const after = requireRow(db.prepare('SELECT * FROM instruments WHERE instrument_key=?').get(key), 'Instrument');
    logChange(db, { resourceType: 'instrument', resourceKey: key, action: 'update', before, after, actorType: actor.type, actorNote: actor.note });
    return after;
  });
}

function createTrade(input, actor = {}, db = getDb()) {
  object(input); const target = account(db, input.account_key); const security = instrument(db, input.instrument_key); const evidence = source(db, input.source_key); const key = stableKey();
  if (input.quantity_decimal != null) parseDecimal(input.quantity_decimal, 'quantity_decimal');
  if (input.unit_price_decimal != null) parseDecimal(input.unit_price_decimal, 'unit_price_decimal');
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO investment_trades(trade_key,account_id,instrument_id,source_id,trade_date,settle_date,activity_type,quantity_decimal,unit_price_decimal,gross_minor,net_minor,fee_minor,tax_minor,currency,external_id,record_status,authority,review_state)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(key, target.id, security.id, evidence.id, isoDate(input.trade_date, 'trade_date'), input.settle_date ? isoDate(input.settle_date, 'settle_date') : null, enumValue(input.activity_type, 'investment_activity', 'activity_type'), input.quantity_decimal || null, input.unit_price_decimal || null, input.gross_minor == null ? null : moneyMinor(input.gross_minor), input.net_minor == null ? null : moneyMinor(input.net_minor), moneyMinor(input.fee_minor || '0'), moneyMinor(input.tax_minor || '0'), currency(input.currency), input.external_id || null, enumValue(input.record_status, 'record_status', 'record_status', 'posted'), enumValue(input.authority, 'authority', 'authority'), enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'));
    const row = db.prepare('SELECT * FROM investment_trades WHERE trade_key=?').get(key); log(db, 'investment_trade', key, row, actor); return row;
  });
}

function createHolding(input, actor = {}, db = getDb()) {
  object(input); const target = account(db, input.account_key); const security = instrument(db, input.instrument_key); const evidence = source(db, input.source_key); const key = stableKey(); parseDecimal(input.quantity_decimal, 'quantity_decimal');
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO holding_snapshots(holding_key,account_id,instrument_id,source_id,as_of_date,quantity_decimal,reported_cost_basis_minor,reported_market_value_minor,currency,authority,review_state,record_status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(key, target.id, security.id, evidence.id, isoDate(input.as_of_date, 'as_of_date'), input.quantity_decimal, input.reported_cost_basis_minor == null ? null : moneyMinor(input.reported_cost_basis_minor), input.reported_market_value_minor == null ? null : moneyMinor(input.reported_market_value_minor), currency(input.currency), enumValue(input.authority, 'authority', 'authority'), enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'), enumValue(input.record_status, 'record_status', 'record_status', 'posted'));
    const row = db.prepare('SELECT * FROM holding_snapshots WHERE holding_key=?').get(key); log(db, 'holding_snapshot', key, row, actor); return row;
  });
}

function createMarketQuote(input, actor = {}, db = getDb()) {
  object(input); const security = instrument(db, input.instrument_key); const evidence = source(db, input.source_key); parseDecimal(input.price_decimal, 'price_decimal'); const quoteCurrency = currency(input.quote_currency); const key = stableKey();
  if (quoteCurrency !== security.quote_currency) throw new FinanceError('VALIDATION_ERROR', 'Quote currency does not match instrument identity', { field: 'quote_currency' });
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO market_quotes(quote_key,instrument_id,source_id,price_decimal,quote_currency,as_of_date,quote_type,provider,authority,confidence,review_state)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(key, security.id, evidence.id, input.price_decimal, quoteCurrency, isoDate(input.as_of_date, 'as_of_date'), enumValue(input.quote_type, 'quote_type', 'quote_type'), requiredString(input.provider, 'provider', 120), enumValue(input.authority, 'authority', 'authority'), confidence(input.confidence), enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'));
    const row = db.prepare('SELECT * FROM market_quotes WHERE quote_key=?').get(key); log(db, 'market_quote', key, row, actor); return row;
  });
}

function createFxQuote(input, actor = {}, db = getDb()) {
  object(input); const evidence = source(db, input.source_key); parseDecimal(input.rate_decimal, 'rate_decimal'); const base = currency(input.base_currency); const quote = currency(input.quote_currency); if (base === quote) throw new FinanceError('VALIDATION_ERROR', 'FX currencies must differ'); const key = stableKey();
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO fx_quotes(fx_key,source_id,base_currency,quote_currency,rate_decimal,as_of_date,provider,authority,confidence,review_state)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(key, evidence.id, base, quote, input.rate_decimal, isoDate(input.as_of_date, 'as_of_date'), requiredString(input.provider, 'provider', 120), enumValue(input.authority, 'authority', 'authority'), confidence(input.confidence), enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'));
    const row = db.prepare('SELECT * FROM fx_quotes WHERE fx_key=?').get(key); log(db, 'fx_quote', key, row, actor); return row;
  });
}

function manualSource(input, description, actor, db) {
  return createSource({
    source_kind: 'manual_note',
    description: input.source_description || description,
    account_key: input.account_key,
    as_of_at: input.as_of_date,
    observed_at: input.observed_at || new Date().toISOString(),
    is_official: false,
    authority: 'user_confirmed',
    artifact_status: 'external-only',
    review_state: 'confirmed',
  }, actor, db);
}

function createManualHolding(input, actor = {}, db = getDb()) {
  object(input);
  const target = account(db, input.account_key);
  const security = instrument(db, input.instrument_key);
  if (input.currency && currency(input.currency) !== security.quote_currency) {
    throw new FinanceError('VALIDATION_ERROR', 'Holding currency must match instrument quote currency', { field: 'currency' });
  }
  return withTransaction(db, () => {
    const evidence = manualSource(input, `Data Center manual holding snapshot for ${security.name} on ${input.as_of_date}`, actor, db);
    const holding = createHolding({
      account_key: target.account_key,
      instrument_key: security.instrument_key,
      source_key: evidence.source_key,
      as_of_date: input.as_of_date,
      quantity_decimal: input.quantity_decimal,
      reported_cost_basis_minor: input.reported_cost_basis_minor,
      reported_market_value_minor: input.reported_market_value_minor,
      currency: security.quote_currency,
      authority: 'user_confirmed',
      review_state: 'confirmed',
      record_status: 'confirmed',
    }, actor, db);
    return { source: evidence, holding };
  });
}

function createManualMarketQuote(input, actor = {}, db = getDb()) {
  object(input);
  const security = instrument(db, input.instrument_key);
  return withTransaction(db, () => {
    const evidence = manualSource(input, `Data Center manual market quote for ${security.name} on ${input.as_of_date}`, actor, db);
    const quote = createMarketQuote({
      instrument_key: security.instrument_key,
      source_key: evidence.source_key,
      price_decimal: input.price_decimal,
      quote_currency: security.quote_currency,
      as_of_date: input.as_of_date,
      quote_type: 'manual_estimate',
      provider: input.provider || 'Data Center manual input',
      authority: 'user_confirmed',
      confidence: 1,
      review_state: 'confirmed',
    }, actor, db);
    return { source: evidence, quote };
  });
}

function createManualFxQuote(input, actor = {}, db = getDb()) {
  object(input);
  return withTransaction(db, () => {
    const evidence = manualSource(input, `Data Center manual FX quote ${input.base_currency}/${input.quote_currency} on ${input.as_of_date}`, actor, db);
    const fxQuote = createFxQuote({
      source_key: evidence.source_key,
      base_currency: input.base_currency,
      quote_currency: input.quote_currency,
      rate_decimal: input.rate_decimal,
      as_of_date: input.as_of_date,
      provider: input.provider || 'Data Center manual input',
      authority: 'user_confirmed',
      confidence: 1,
      review_state: 'confirmed',
    }, actor, db);
    return { source: evidence, fx_quote: fxQuote };
  });
}

function createInvestmentCashMatch(input, actor = {}, db = getDb()) {
  object(input); const trade = requireRow(db.prepare('SELECT * FROM investment_trades WHERE trade_key=?').get(input.trade_key), 'Investment trade'); const tx = transaction(db, input.transaction_key); const amount = moneyMinor(input.amount_minor); const cash = moneyMinor(tx.amount_minor); const status = (cash < 0n ? -cash : cash) === (amount < 0n ? -amount : amount) ? 'reconciled' : 'unreconciled'; const key = stableKey();
  return withTransaction(db, () => { db.prepare(`INSERT INTO investment_cash_matches(match_key,trade_id,transaction_id,amount_minor,reconciliation_status,authority,review_state) VALUES(?,?,?,?,?,?,?)`).run(key, trade.id, tx.id, amount, status, enumValue(input.authority, 'authority', 'authority'), enumValue(input.review_state, 'review_state', 'review_state', 'needs_review')); const row = db.prepare('SELECT * FROM investment_cash_matches WHERE match_key=?').get(key); log(db, 'investment_cash_match', key, row, actor); return row; });
}

function dayDiff(later, earlier) { return Math.floor((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86400000); }
function investmentPositions({ entityKey = 'personal', asOfDate, baseCurrency = 'TWD', staleDays = 7 } = {}, db = getDb()) {
  isoDate(asOfDate, 'as_of_date'); const base = currency(baseCurrency);
  const holdings = db.prepare(`SELECT h.*,a.account_key,i.instrument_key,i.name AS instrument_name,i.symbol,i.instrument_type,i.quote_currency,s.source_key
    FROM holding_snapshots h JOIN accounts a ON a.id=h.account_id JOIN reporting_entities e ON e.id=a.entity_id
    JOIN instruments i ON i.id=h.instrument_id JOIN sources s ON s.id=h.source_id
    WHERE e.entity_key=? AND h.record_status IN ('provisional','posted','confirmed') AND h.as_of_date<=?
    AND NOT EXISTS(SELECT 1 FROM holding_snapshots newer WHERE newer.account_id=h.account_id AND newer.instrument_id=h.instrument_id AND newer.record_status IN ('provisional','posted','confirmed') AND newer.as_of_date<=? AND (newer.as_of_date>h.as_of_date OR (newer.as_of_date=h.as_of_date AND newer.id>h.id)))
    ORDER BY a.display_name,i.name`).all(entityKey, asOfDate, asOfDate);
  return holdings.map((holding) => {
    const quote = db.prepare(`SELECT q.*,s.source_key FROM market_quotes q JOIN sources s ON s.id=q.source_id WHERE q.instrument_id=? AND q.as_of_date<=? ORDER BY q.as_of_date DESC,CASE q.authority WHEN 'official' THEN 6 WHEN 'institution_export' THEN 5 WHEN 'user_confirmed' THEN 4 WHEN 'ai_researched' THEN 3 WHEN 'ai_inferred' THEN 2 ELSE 1 END DESC,q.provider ASC,q.id ASC LIMIT 1`).get(holding.instrument_id, asOfDate);
    if (!quote) return { ...holding, valuation_status: 'missing_quote', derived_value_minor: null, base_value_minor: null, watermark: { holding_key: holding.holding_key } };
    if (quote.quote_currency !== holding.quote_currency || holding.currency !== holding.quote_currency) return { ...holding, quote, valuation_status: 'currency_mismatch', derived_value_minor: null, base_value_minor: null, base_currency: base, watermark: { holding_key: holding.holding_key, quote_key: quote.quote_key } };
    const derived = decimalToMinor([holding.quantity_decimal, quote.price_decimal], quote.quote_currency);
    const stale = dayDiff(asOfDate, quote.as_of_date) > staleDays;
    if (holding.quote_currency === base) return { ...holding, quote, valuation_status: stale ? 'stale' : 'current', derived_value_minor: derived.toString(), base_value_minor: derived.toString(), base_currency: base, watermark: { holding_key: holding.holding_key, quote_key: quote.quote_key, fx_key: null } };
    const fx = db.prepare(`SELECT f.*,s.source_key FROM fx_quotes f JOIN sources s ON s.id=f.source_id WHERE f.base_currency=? AND f.quote_currency=? AND f.as_of_date<=? ORDER BY f.as_of_date DESC,CASE f.authority WHEN 'official' THEN 6 WHEN 'institution_export' THEN 5 WHEN 'user_confirmed' THEN 4 WHEN 'ai_researched' THEN 3 WHEN 'ai_inferred' THEN 2 ELSE 1 END DESC,f.provider ASC,f.id ASC LIMIT 1`).get(holding.quote_currency, base, asOfDate);
    if (!fx) return { ...holding, quote, valuation_status: 'missing_fx', derived_value_minor: derived.toString(), base_value_minor: null, base_currency: base, watermark: { holding_key: holding.holding_key, quote_key: quote.quote_key, fx_key: null } };
    const baseValue = decimalToMinor([minorToDecimal(derived, quote.quote_currency), fx.rate_decimal], base);
    const fxStale = dayDiff(asOfDate, fx.as_of_date) > staleDays;
    return { ...holding, quote, fx, valuation_status: stale || fxStale ? 'stale' : 'current', derived_value_minor: derived.toString(), base_value_minor: baseValue.toString(), base_currency: base, watermark: { holding_key: holding.holding_key, quote_key: quote.quote_key, fx_key: fx.fx_key } };
  });
}

module.exports = {
  listInstruments,
  createInstrument,
  updateInstrument,
  createTrade,
  createHolding,
  createMarketQuote,
  createFxQuote,
  createManualHolding,
  createManualMarketQuote,
  createManualFxQuote,
  createInvestmentCashMatch,
  investmentPositions,
};
