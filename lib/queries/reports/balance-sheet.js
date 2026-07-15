const { getDb } = require('../core');
const { FinanceError, currency, isoDate } = require('../../finance/contracts');
const { decimalToMinor, minorToDecimal } = require('../../finance/money/decimal');
const { activeRecordSql } = require('../../finance/active-records');
const {
  buildBalanceSheetCoverage,
  makeReportBlocker,
} = require('../../reporting/coverage');

const DEFAULT_ENTITY_ID = 'personal';
const DEFAULT_CURRENCY = 'TWD';
const ACCOUNT_ROLES = Object.freeze({
  cash: 'asset',
  bank: 'asset',
  e_wallet: 'asset',
  investment: 'asset',
  receivable: 'asset',
  fixed_asset: 'asset',
  credit_card: 'liability',
  loan: 'liability',
  payable: 'liability',
  equity: 'equity',
});

function getParam(params, key) {
  if (!params) return null;
  if (typeof params.get === 'function') return params.get(key);
  return params[key] ?? null;
}

function localDate() {
  return new Date().toLocaleDateString('en-CA');
}

function monthStart(date) {
  return `${date.slice(0, 7)}-01`;
}

function minorNumber(value, field = 'amount') {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new FinanceError('UNSUPPORTED_CONTEXT', `${field} exceeds the safe report range`, { status: 422, field });
  }
  return number;
}

function unique(items) {
  return [...new Set(items.filter((item) => item !== null && item !== undefined))];
}

function defaultedFields(params) {
  const fields = [];
  if (!getParam(params, 'entity_id')) fields.push('entity_id');
  if (!getParam(params, 'as_of_date')) fields.push('as_of_date');
  if (!getParam(params, 'currency')) fields.push('currency');
  return fields;
}

function sourceWatermark(row) {
  if (!row.source_key) return null;
  return {
    source_key: row.source_key,
    status: row.source_status,
    statement_month: row.source_statement_month,
    period_start: row.source_period_start,
    period_end: row.source_period_end,
    as_of_at: row.source_as_of_at,
    observed_at: row.source_observed_at,
    imported_at: row.source_imported_at,
    updated_at: row.source_updated_at,
  };
}

function snapshotWatermark(row) {
  return {
    snapshot_key: row.snapshot_key,
    as_of_date: row.as_of_date,
    observed_at: row.observed_at,
    balance_kind: row.balance_kind,
    authority: row.authority,
    review_state: row.review_state,
    record_status: row.record_status,
    updated_at: row.updated_at,
  };
}

function fxWatermark(row) {
  if (!row) return null;
  return {
    fx_key: row.fx_key,
    source_key: row.source_key,
    base_currency: row.base_currency,
    quote_currency: row.quote_currency,
    rate_decimal: row.rate_decimal,
    as_of_date: row.as_of_date,
    provider: row.provider,
    authority: row.authority,
    review_state: row.review_state,
  };
}

function addScopeWarning(warnings, fields) {
  if (fields.length === 0) return;
  warnings.push({
    kind: 'defaulted_scope',
    severity: 'info',
    fields,
    label: `Default report scope was used for: ${fields.join(', ')}.`,
  });
}

function latestFx(db, nativeCurrency, reportCurrency, asOfDate) {
  return db.prepare(`
    SELECT f.*, s.source_key
    FROM fx_quotes f
    JOIN sources s ON s.id = f.source_id
    WHERE f.base_currency = ? AND f.quote_currency = ? AND f.as_of_date <= ?
      AND COALESCE(s.status, 'active') = 'active'
    ORDER BY f.as_of_date DESC,
      CASE f.authority
        WHEN 'official' THEN 6 WHEN 'institution_export' THEN 5
        WHEN 'user_confirmed' THEN 4 WHEN 'ai_researched' THEN 3
        WHEN 'ai_inferred' THEN 2 ELSE 1
      END DESC,
      f.id DESC
    LIMIT 1
  `).get(nativeCurrency, reportCurrency, asOfDate) || null;
}

function convertAmount(db, amount, nativeCurrency, reportCurrency, asOfDate) {
  if (nativeCurrency === reportCurrency) {
    return { amount, conversion: null, stale: false, missing: false };
  }
  const fx = latestFx(db, nativeCurrency, reportCurrency, asOfDate);
  if (!fx) return { amount: null, conversion: null, stale: false, missing: true };
  const converted = decimalToMinor([
    minorToDecimal(amount, nativeCurrency),
    fx.rate_decimal,
  ], reportCurrency);
  return {
    amount: converted,
    conversion: fxWatermark(fx),
    stale: fx.as_of_date < monthStart(asOfDate),
    missing: false,
  };
}

function accountDrillback(account, snapshot) {
  return {
    account_ids: [account.id],
    account_keys: [account.account_key],
    balance_snapshot_ids: snapshot ? [snapshot.id] : [],
    balance_snapshot_keys: snapshot ? [snapshot.snapshot_key] : [],
    source_ids: snapshot?.source_id ? [snapshot.source_id] : [],
    source_keys: snapshot?.source_key ? [snapshot.source_key] : [],
    holding_snapshot_ids: [],
    holding_snapshot_keys: [],
    market_quote_ids: [],
    market_quote_keys: [],
    fx_quote_ids: [],
    fx_quote_keys: [],
    valuation_snapshot_ids: [],
    valuation_snapshot_keys: [],
  };
}

function accountSnapshotLine(db, account, snapshot, role, reportCurrency, asOfDate, state) {
  const nativeAmount = BigInt(snapshot.amount_minor_text);
  const converted = convertAmount(db, nativeAmount, snapshot.currency, reportCurrency, asOfDate);
  const details = {
    account_id: account.id,
    account_key: account.account_key,
    resource_key: snapshot.snapshot_key,
  };

  if (converted.missing) {
    state.blockers.push(makeReportBlocker(
      'missing_fx_quote',
      `No ${snapshot.currency}/${reportCurrency} FX quote is available for ${account.label}.`,
      'add_fx_quote',
      { ...details, native_currency: snapshot.currency, currency: reportCurrency },
    ));
    return null;
  }
  if (converted.stale) {
    state.blockers.push(makeReportBlocker(
      'stale_fx_quote',
      `${account.label} uses an FX quote dated ${converted.conversion.as_of_date}.`,
      'refresh_fx_quote',
      { ...details, fx_key: converted.conversion.fx_key },
    ));
  }
  if (snapshot.currency !== account.currency) {
    state.blockers.push(makeReportBlocker(
      'account_snapshot_currency_mismatch',
      `${account.label} is registered in ${account.currency} but its snapshot is in ${snapshot.currency}.`,
      'review_account_currency',
      details,
    ));
  }
  if (snapshot.source_status && snapshot.source_status !== 'active') {
    state.blockers.push(makeReportBlocker(
      'inactive_snapshot_source',
      `${account.label} uses a snapshot whose source is ${snapshot.source_status}.`,
      'review_balance_source',
      details,
    ));
  }

  const drillback = accountDrillback(account, snapshot);
  if (converted.conversion) {
    drillback.fx_quote_keys.push(converted.conversion.fx_key);
  }
  return {
    line: account.account_kind,
    label: account.label,
    role,
    tier: 1,
    account_id: account.id,
    account_key: account.account_key,
    account_kind: account.account_kind,
    normal_balance: account.normal_balance,
    amount_cents: minorNumber(converted.amount, 'amount_cents'),
    base_amount_cents: minorNumber(converted.amount, 'base_amount_cents'),
    base_currency: reportCurrency,
    native_amount_cents: minorNumber(nativeAmount, 'native_amount_cents'),
    native_currency: snapshot.currency,
    resource_type: 'account_balance_snapshot',
    resource_key: snapshot.snapshot_key,
    source_key: snapshot.source_key || null,
    snapshot_date: snapshot.as_of_date,
    snapshot_watermark: snapshotWatermark(snapshot),
    source_watermark: sourceWatermark(snapshot),
    valuation_watermark: null,
    conversion_watermark: converted.conversion,
    drillback_ids: drillback,
  };
}

function latestHoldingRows(db, accountId, asOfDate) {
  return db.prepare(`
    SELECT h.*, CAST(h.reported_market_value_minor AS TEXT) AS reported_market_value_minor_text,
      i.instrument_key, i.name AS instrument_name, i.quote_currency, i.active AS instrument_active,
      s.source_key, s.status AS source_status, s.statement_month AS source_statement_month,
      s.period_start AS source_period_start, s.period_end AS source_period_end,
      s.as_of_at AS source_as_of_at, s.observed_at AS source_observed_at,
      s.imported_at AS source_imported_at, s.updated_at AS source_updated_at
    FROM holding_snapshots h
    JOIN instruments i ON i.id = h.instrument_id
    JOIN sources s ON s.id = h.source_id
    WHERE h.account_id = ? AND h.as_of_date <= ? AND ${activeRecordSql('h')}
      AND NOT EXISTS (
        SELECT 1 FROM holding_snapshots newer
        WHERE newer.account_id = h.account_id AND newer.instrument_id = h.instrument_id
          AND newer.as_of_date <= ? AND ${activeRecordSql('newer')}
          AND (newer.as_of_date > h.as_of_date OR (newer.as_of_date = h.as_of_date AND newer.id > h.id))
      )
    ORDER BY i.name ASC, h.id ASC
  `).all(accountId, asOfDate, asOfDate);
}

function latestMarketQuote(db, instrumentId, asOfDate) {
  return db.prepare(`
    SELECT q.*, s.source_key
    FROM market_quotes q
    JOIN sources s ON s.id = q.source_id
    WHERE q.instrument_id = ? AND q.as_of_date <= ? AND COALESCE(s.status, 'active') = 'active'
    ORDER BY q.as_of_date DESC,
      CASE q.authority
        WHEN 'official' THEN 6 WHEN 'institution_export' THEN 5
        WHEN 'user_confirmed' THEN 4 WHEN 'ai_researched' THEN 3
        WHEN 'ai_inferred' THEN 2 ELSE 1
      END DESC,
      q.id DESC
    LIMIT 1
  `).get(instrumentId, asOfDate) || null;
}

function holdingValue(db, holding, reportCurrency, asOfDate, state, account) {
  let nativeValue = holding.reported_market_value_minor_text === null
    ? null
    : BigInt(holding.reported_market_value_minor_text);
  let quote = null;
  let method = 'reported_market_value';

  if (nativeValue === null) {
    quote = latestMarketQuote(db, holding.instrument_id, asOfDate);
    method = 'quantity_times_market_quote';
    if (!quote) {
      state.blockers.push(makeReportBlocker(
        'missing_holding_valuation',
        `No current value or market quote is available for ${holding.instrument_name}.`,
        'add_market_quote',
        {
          account_id: account.id,
          account_key: account.account_key,
          resource_key: holding.holding_key,
          holding_key: holding.holding_key,
          instrument_key: holding.instrument_key,
        },
      ));
      return null;
    }
    if (quote.quote_currency !== holding.currency || holding.quote_currency !== holding.currency) {
      state.blockers.push(makeReportBlocker(
        'holding_currency_mismatch',
        `${holding.instrument_name} holding and quote currencies do not agree.`,
        'review_investment_currency',
        {
          account_id: account.id,
          account_key: account.account_key,
          resource_key: holding.holding_key,
          holding_key: holding.holding_key,
          quote_key: quote.quote_key,
        },
      ));
      return null;
    }
    nativeValue = decimalToMinor([holding.quantity_decimal, quote.price_decimal], holding.currency);
    if (quote.as_of_date < monthStart(asOfDate)) {
      state.blockers.push(makeReportBlocker(
        'stale_market_quote',
        `${holding.instrument_name} uses a market quote dated ${quote.as_of_date}.`,
        'refresh_market_quote',
        {
          account_id: account.id,
          account_key: account.account_key,
          resource_key: quote.quote_key,
          quote_key: quote.quote_key,
        },
      ));
    }
  }

  const converted = convertAmount(db, nativeValue, holding.currency, reportCurrency, asOfDate);
  if (converted.missing) {
    state.blockers.push(makeReportBlocker(
      'missing_fx_quote',
      `No ${holding.currency}/${reportCurrency} FX quote is available for ${holding.instrument_name}.`,
      'add_fx_quote',
      {
        account_id: account.id,
        account_key: account.account_key,
        resource_key: holding.holding_key,
        holding_key: holding.holding_key,
      },
    ));
    return null;
  }
  if (converted.stale) {
    state.blockers.push(makeReportBlocker(
      'stale_fx_quote',
      `${holding.instrument_name} uses an FX quote dated ${converted.conversion.as_of_date}.`,
      'refresh_fx_quote',
      {
        account_id: account.id,
        account_key: account.account_key,
        resource_key: converted.conversion.fx_key,
        fx_key: converted.conversion.fx_key,
      },
    ));
  }

  return {
    holding_id: holding.id,
    holding_key: holding.holding_key,
    instrument_id: holding.instrument_id,
    instrument_key: holding.instrument_key,
    instrument_name: holding.instrument_name,
    snapshot_date: holding.as_of_date,
    quantity_decimal: holding.quantity_decimal,
    valuation_method: method,
    native_amount: nativeValue,
    native_amount_cents: minorNumber(nativeValue, 'native_amount_cents'),
    native_currency: holding.currency,
    base_amount: converted.amount,
    base_amount_cents: minorNumber(converted.amount, 'base_amount_cents'),
    base_currency: reportCurrency,
    holding_watermark: {
      holding_key: holding.holding_key,
      as_of_date: holding.as_of_date,
      authority: holding.authority,
      review_state: holding.review_state,
      record_status: holding.record_status,
      source_key: holding.source_key,
    },
    quote_watermark: quote ? {
      quote_key: quote.quote_key,
      source_key: quote.source_key,
      as_of_date: quote.as_of_date,
      price_decimal: quote.price_decimal,
      quote_currency: quote.quote_currency,
      provider: quote.provider,
      authority: quote.authority,
      review_state: quote.review_state,
    } : null,
    conversion_watermark: converted.conversion,
    source_id: holding.source_id,
    source_key: holding.source_key,
    quote_id: quote?.id || null,
    quote_key: quote?.quote_key || null,
    fx_key: converted.conversion?.fx_key || null,
  };
}

function holdingsLine(db, account, reportCurrency, asOfDate, state) {
  const holdings = latestHoldingRows(db, account.id, asOfDate);
  if (holdings.length === 0) return null;

  let stale = false;
  const values = holdings.map((holding) => {
    if (holding.as_of_date < monthStart(asOfDate)) stale = true;
    return holdingValue(db, holding, reportCurrency, asOfDate, state, account);
  });
  if (stale) {
    state.staleBalanceSnapshots.push({
      account_id: account.id,
      account_key: account.account_key,
      label: account.label,
      snapshot_date: holdings.map((item) => item.as_of_date).sort()[0],
      resource_type: 'holding_snapshot',
      resource_key: account.account_key,
    });
  }
  if (values.some((value) => value === null)) return null;

  const baseAmount = values.reduce((sum, value) => sum + value.base_amount, 0n);
  const nativeCurrencies = unique(values.map((value) => value.native_currency));
  const nativeAmount = nativeCurrencies.length === 1
    ? values.reduce((sum, value) => sum + value.native_amount, 0n)
    : null;
  const drillback = accountDrillback(account, null);
  drillback.holding_snapshot_ids = values.map((value) => value.holding_id);
  drillback.holding_snapshot_keys = values.map((value) => value.holding_key);
  drillback.source_ids = unique(values.map((value) => value.source_id));
  drillback.source_keys = unique(values.map((value) => value.source_key));
  drillback.market_quote_ids = unique(values.map((value) => value.quote_id));
  drillback.market_quote_keys = unique(values.map((value) => value.quote_key));
  drillback.fx_quote_keys = unique(values.map((value) => value.fx_key));

  return {
    line: 'investment',
    label: account.label,
    role: 'asset',
    tier: 1,
    account_id: account.id,
    account_key: account.account_key,
    account_kind: account.account_kind,
    normal_balance: account.normal_balance,
    amount_cents: minorNumber(baseAmount, 'amount_cents'),
    base_amount_cents: minorNumber(baseAmount, 'base_amount_cents'),
    base_currency: reportCurrency,
    native_amount_cents: nativeAmount === null ? null : minorNumber(nativeAmount, 'native_amount_cents'),
    native_currency: nativeCurrencies.length === 1 ? nativeCurrencies[0] : null,
    native_amounts: nativeCurrencies.map((nativeCurrency) => ({
      currency: nativeCurrency,
      amount_cents: minorNumber(
        values.filter((value) => value.native_currency === nativeCurrency)
          .reduce((sum, value) => sum + value.native_amount, 0n),
        'native_amount_cents',
      ),
    })),
    resource_type: 'investment_holding_valuation',
    resource_key: account.account_key,
    source_key: values.length === 1 ? values[0].source_key : null,
    source_keys: unique(values.map((value) => value.source_key)),
    snapshot_date: values.map((value) => value.snapshot_date).sort()[0],
    snapshot_dates: unique(values.map((value) => value.snapshot_date)).sort(),
    snapshot_watermark: null,
    source_watermark: null,
    valuation_watermark: {
      method: 'complete_holding_valuations',
      holdings: values.map(({ native_amount, base_amount, ...value }) => value),
    },
    conversion_watermark: unique(values.map((value) => value.fx_key)).map((key) => (
      values.find((value) => value.fx_key === key)?.conversion_watermark
    )),
    drillback_ids: drillback,
  };
}

function valuedItemLines(db, entityId, reportCurrency, asOfDate, state) {
  const items = db.prepare(`
    SELECT v.*
    FROM valued_items v
    WHERE v.entity_id = ? AND v.active = 1
    ORDER BY v.display_name ASC, v.id ASC
  `).all(entityId);

  return items.map((item) => {
    const valuation = db.prepare(`
      SELECT x.*, CAST(x.value_minor AS TEXT) AS value_minor_text,
        s.source_key, s.status AS source_status, s.statement_month AS source_statement_month,
        s.period_start AS source_period_start, s.period_end AS source_period_end,
        s.as_of_at AS source_as_of_at, s.observed_at AS source_observed_at,
        s.imported_at AS source_imported_at, s.updated_at AS source_updated_at
      FROM valuation_snapshots x
      JOIN sources s ON s.id = x.source_id
      WHERE x.item_id = ? AND x.as_of_date <= ? AND ${activeRecordSql('x')}
      ORDER BY x.as_of_date DESC,
        CASE x.authority
          WHEN 'official' THEN 6 WHEN 'institution_export' THEN 5
          WHEN 'user_confirmed' THEN 4 WHEN 'ai_researched' THEN 3
          WHEN 'ai_inferred' THEN 2 ELSE 1
        END DESC,
        x.id DESC
      LIMIT 1
    `).get(item.id, asOfDate);
    if (!valuation) {
      state.blockers.push(makeReportBlocker(
        'missing_valuation_snapshot',
        `No valuation is available for ${item.display_name}.`,
        'add_valuation_snapshot',
        { resource_type: 'valued_item', resource_key: item.item_key, item_key: item.item_key },
      ));
      return null;
    }
    if (!['asset', 'liability'].includes(item.position)) {
      state.blockers.push(makeReportBlocker(
        'unsupported_valued_item_position',
        `${item.display_name} has an unsupported balance-sheet position.`,
        'review_valued_item',
        { resource_type: 'valued_item', resource_key: item.item_key, item_key: item.item_key },
      ));
      return null;
    }

    const nativeAmount = BigInt(valuation.value_minor_text);
    const converted = convertAmount(db, nativeAmount, valuation.currency, reportCurrency, asOfDate);
    if (converted.missing) {
      state.blockers.push(makeReportBlocker(
        'missing_fx_quote',
        `No ${valuation.currency}/${reportCurrency} FX quote is available for ${item.display_name}.`,
        'add_fx_quote',
        { resource_type: 'valuation_snapshot', resource_key: valuation.valuation_key, item_key: item.item_key },
      ));
      return null;
    }
    if (valuation.as_of_date < monthStart(asOfDate)) {
      state.blockers.push(makeReportBlocker(
        'stale_valuation_snapshot',
        `${item.display_name} uses a valuation dated ${valuation.as_of_date}.`,
        'refresh_valuation_snapshot',
        { resource_type: 'valuation_snapshot', resource_key: valuation.valuation_key, item_key: item.item_key },
      ));
    }
    if (converted.stale) {
      state.blockers.push(makeReportBlocker(
        'stale_fx_quote',
        `${item.display_name} uses an FX quote dated ${converted.conversion.as_of_date}.`,
        'refresh_fx_quote',
        { resource_type: 'valuation_snapshot', resource_key: valuation.valuation_key, item_key: item.item_key },
      ));
    }

    return {
      line: `valued_item:${item.item_type}`,
      label: item.display_name,
      role: item.position,
      tier: 2,
      item_id: item.id,
      item_key: item.item_key,
      item_type: item.item_type,
      amount_cents: minorNumber(converted.amount, 'amount_cents'),
      base_amount_cents: minorNumber(converted.amount, 'base_amount_cents'),
      base_currency: reportCurrency,
      native_amount_cents: minorNumber(nativeAmount, 'native_amount_cents'),
      native_currency: valuation.currency,
      resource_type: 'valuation_snapshot',
      resource_key: valuation.valuation_key,
      source_key: valuation.source_key,
      snapshot_date: valuation.as_of_date,
      snapshot_watermark: null,
      source_watermark: sourceWatermark(valuation),
      valuation_watermark: {
        valuation_key: valuation.valuation_key,
        as_of_date: valuation.as_of_date,
        valuation_method: valuation.valuation_method,
        confidence: valuation.confidence,
        authority: valuation.authority,
        review_state: valuation.review_state,
        record_status: valuation.record_status,
      },
      conversion_watermark: converted.conversion,
      drillback_ids: {
        valued_item_ids: [item.id],
        valued_item_keys: [item.item_key],
        valuation_snapshot_ids: [valuation.id],
        valuation_snapshot_keys: [valuation.valuation_key],
        source_ids: [valuation.source_id],
        source_keys: [valuation.source_key],
        fx_quote_keys: converted.conversion ? [converted.conversion.fx_key] : [],
      },
    };
  }).filter(Boolean);
}

function unsupportedObligation(db, account) {
  if (account.account_kind === 'credit_card') {
    const row = db.prepare(`
      SELECT p.profile_key, s.statement_key
      FROM credit_card_profiles p
      LEFT JOIN credit_card_statements s ON s.profile_id = p.id AND ${activeRecordSql('s')}
      WHERE p.account_id = ? AND ${activeRecordSql('p')}
      ORDER BY s.close_date DESC, s.id DESC
      LIMIT 1
    `).get(account.id);
    if (row) return {
      account_id: account.id,
      account_key: account.account_key,
      account_kind: account.account_kind,
      resource_type: row.statement_key ? 'credit_card_statement' : 'credit_card_profile',
      resource_key: row.statement_key || row.profile_key,
      reason: 'current_balance_snapshot_required',
    };
  }
  if (account.account_kind === 'loan') {
    const row = db.prepare(`
      SELECT liability_key FROM liability_profiles
      WHERE account_id = ? AND ${activeRecordSql()}
      LIMIT 1
    `).get(account.id);
    if (row) return {
      account_id: account.id,
      account_key: account.account_key,
      account_kind: account.account_kind,
      resource_type: 'liability_profile',
      resource_key: row.liability_key,
      reason: 'current_balance_snapshot_required',
    };
  }
  return null;
}

function getBalanceSheet(params, db = getDb()) {
  const entityId = getParam(params, 'entity_id') || DEFAULT_ENTITY_ID;
  const asOfDate = isoDate(getParam(params, 'as_of_date') || localDate(), 'as_of_date');
  const reportCurrency = currency(getParam(params, 'currency') || DEFAULT_CURRENCY);
  const defaulted = defaultedFields(params);
  const entity = db.prepare(`
    SELECT * FROM reporting_entities WHERE entity_key = ? AND active = 1
  `).get(entityId);
  if (!entity) throw new FinanceError('NOT_FOUND', `Reporting entity not found: ${entityId}`, { status: 404, field: 'entity_id' });

  const accounts = db.prepare(`
    SELECT a.*, COALESCE(a.display_name, a.name) AS label
    FROM accounts a
    WHERE a.entity_id = ? AND a.active = 1 AND a.included_in_analysis = 1
      AND a.merged_into_account_id IS NULL AND a.reversed_by_run_id IS NULL
    ORDER BY a.account_kind ASC, label ASC, a.id ASC
  `).all(entity.id);
  const includedAccountIds = accounts.map((account) => account.id);
  const state = {
    blockers: [],
    warnings: [],
    missingBalanceSnapshots: [],
    staleBalanceSnapshots: [],
  };
  addScopeWarning(state.warnings, defaulted);

  const latestSnapshot = db.prepare(`
    SELECT b.*, CAST(b.amount_minor AS TEXT) AS amount_minor_text,
      s.source_key, s.status AS source_status, s.statement_month AS source_statement_month,
      s.period_start AS source_period_start, s.period_end AS source_period_end,
      s.as_of_at AS source_as_of_at, s.observed_at AS source_observed_at,
      s.imported_at AS source_imported_at, s.updated_at AS source_updated_at
    FROM account_balance_snapshots b
    LEFT JOIN sources s ON s.id = b.source_id
    WHERE b.account_id = ? AND b.as_of_date <= ? AND ${activeRecordSql('b')}
    ORDER BY b.as_of_date DESC,
      CASE b.authority
        WHEN 'official' THEN 6 WHEN 'institution_export' THEN 5
        WHEN 'user_confirmed' THEN 4 WHEN 'ai_researched' THEN 3
        WHEN 'ai_inferred' THEN 2 ELSE 1
      END DESC,
      b.id DESC
    LIMIT 1
  `);

  const assets = [];
  const liabilities = [];
  const explicitEquity = [];
  const excludedAccounts = [];
  const unsupportedObligations = [];
  let explicitEquityAccountCount = 0;

  for (const account of accounts) {
    const role = ACCOUNT_ROLES[account.account_kind] || null;
    if (!role) {
      excludedAccounts.push({
        account_id: account.id,
        account_key: account.account_key,
        account_kind: account.account_kind,
        label: account.label,
        reason: 'typed_account_kind_required',
      });
      state.blockers.push(makeReportBlocker(
        'unsupported_account_kind',
        `${account.label} must be assigned a typed account kind before it can enter the balance sheet.`,
        'review_account_kind',
        { account_id: account.id, account_key: account.account_key, resource_key: account.account_key },
      ));
      continue;
    }
    if (role === 'equity') explicitEquityAccountCount += 1;

    const snapshot = latestSnapshot.get(account.id, asOfDate) || null;
    let line = null;
    if (snapshot) {
      if (snapshot.as_of_date < monthStart(asOfDate)) {
        state.staleBalanceSnapshots.push({
          account_id: account.id,
          account_key: account.account_key,
          label: account.label,
          snapshot_date: snapshot.as_of_date,
          resource_type: 'account_balance_snapshot',
          resource_key: snapshot.snapshot_key,
        });
      } else if (snapshot.as_of_date < asOfDate) {
        state.warnings.push({
          kind: 'prior_date_balance_snapshot',
          severity: 'warning',
          account_id: account.id,
          account_key: account.account_key,
          resource_key: snapshot.snapshot_key,
          snapshot_date: snapshot.as_of_date,
          label: `${account.label} uses the latest in-period balance dated ${snapshot.as_of_date}.`,
        });
      }
      line = accountSnapshotLine(db, account, snapshot, role, reportCurrency, asOfDate, state);
    } else if (account.account_kind === 'investment') {
      line = holdingsLine(db, account, reportCurrency, asOfDate, state);
    }

    if (!line) {
      state.missingBalanceSnapshots.push({
        account_id: account.id,
        account_key: account.account_key,
        account_kind: account.account_kind,
        label: account.label,
        resource_type: 'account',
        resource_key: account.account_key,
      });
      const unsupported = unsupportedObligation(db, account);
      if (unsupported) unsupportedObligations.push(unsupported);
      continue;
    }
    if (role === 'asset') assets.push(line);
    else if (role === 'liability') liabilities.push(line);
    else explicitEquity.push(line);
  }

  const valuedItems = valuedItemLines(db, entity.id, reportCurrency, asOfDate, state);
  for (const line of valuedItems) {
    if (line.role === 'asset') assets.push(line);
    else liabilities.push(line);
  }

  const totalAssets = assets.reduce((sum, line) => sum + BigInt(line.amount_cents), 0n);
  const totalLiabilities = liabilities.reduce((sum, line) => sum + BigInt(line.amount_cents), 0n);
  const netWorth = totalAssets - totalLiabilities;
  const totalExplicitEquity = explicitEquity.reduce((sum, line) => sum + BigInt(line.amount_cents), 0n);
  const reconciliationAvailable = explicitEquityAccountCount > 0
    && explicitEquity.length === explicitEquityAccountCount;
  const equationDelta = reconciliationAvailable ? netWorth - totalExplicitEquity : 0n;
  if (reconciliationAvailable && equationDelta !== 0n) {
    state.blockers.push(makeReportBlocker(
      'balance_equation_mismatch',
      `Assets, liabilities, and explicit equity differ by ${equationDelta.toString()} ${reportCurrency} cents.`,
      'review_balance_equation',
      { reconciliation_delta_cents: minorNumber(equationDelta, 'equation_delta_cents') },
    ));
  }

  const equity = explicitEquityAccountCount === 0 ? [{
    line: 'derived_net_worth',
    label: 'Derived net worth',
    role: 'equity',
    tier: 1,
    amount_cents: minorNumber(netWorth, 'net_worth_cents'),
    base_amount_cents: minorNumber(netWorth, 'net_worth_cents'),
    base_currency: reportCurrency,
    native_amount_cents: minorNumber(netWorth, 'net_worth_cents'),
    native_currency: reportCurrency,
    resource_type: 'derived_report_line',
    resource_key: 'derived_net_worth',
    source_key: null,
    snapshot_date: asOfDate,
    snapshot_watermark: null,
    source_watermark: null,
    valuation_watermark: null,
    conversion_watermark: null,
    drillback_ids: {
      account_ids: includedAccountIds,
      account_keys: accounts.map((account) => account.account_key),
    },
  }] : explicitEquity;

  const missing = [...new Map(state.missingBalanceSnapshots.map((item) => [item.account_id, item])).values()];
  const stale = [...new Map(state.staleBalanceSnapshots.map((item) => [item.account_id ?? item.resource_key, item])).values()];
  const coverage = buildBalanceSheetCoverage({
    entityId,
    asOfDate,
    currency: reportCurrency,
    includedAccountIds,
    defaultedFields: defaulted,
    usableLineCount: assets.length + liabilities.length + explicitEquity.length,
    missingBalanceSnapshots: missing,
    staleBalanceSnapshots: stale,
    reconciliationDeltaCents: minorNumber(equationDelta, 'equation_delta_cents'),
    reconciliationAvailable,
    blockers: state.blockers,
    warnings: state.warnings,
  });

  return {
    report: 'balance_sheet',
    entity_id: entityId,
    as_of_date: asOfDate,
    currency: reportCurrency,
    assets,
    liabilities,
    equity,
    valued_items: valuedItems,
    excluded_accounts: excludedAccounts,
    unsupported_obligations: unsupportedObligations,
    total_assets_cents: minorNumber(totalAssets, 'total_assets_cents'),
    total_liabilities_cents: minorNumber(totalLiabilities, 'total_liabilities_cents'),
    total_equity_cents: explicitEquityAccountCount === 0
      ? minorNumber(netWorth, 'total_equity_cents')
      : minorNumber(totalExplicitEquity, 'total_equity_cents'),
    net_worth_cents: minorNumber(netWorth, 'net_worth_cents'),
    equation_delta_cents: reconciliationAvailable
      ? minorNumber(equationDelta, 'equation_delta_cents')
      : (explicitEquityAccountCount === 0 ? 0 : null),
    coverage,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  ACCOUNT_ROLES,
  getBalanceSheet,
};
