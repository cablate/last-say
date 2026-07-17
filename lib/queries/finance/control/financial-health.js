const { createHash } = require('node:crypto');

const { FinanceError, currency: validateCurrency, isoDate } = require('../../../finance/contracts');
const {
  decimalToMinor,
  minorToDecimal,
  parseDecimal,
  roundHalfEven,
} = require('../../../finance/money/decimal');
const { POLICY_VERSION, sourceWatermark } = require('../../../finance/readiness/policy');
const { getDb } = require('../common');
const { getBalanceSheet } = require('../../reports/balance-sheet');
const { listCreditCards, listLiabilities } = require('../obligations');
const { investmentPositions } = require('../investments');

const ANALYSIS_ID = 'financial_health_review';
const FORMULA_VERSION = 'financial-health-review/1';
const SCHEMA_VERSION = 'finance.analysis-read-model/v1';
const CASH_ACCOUNT_KINDS = new Set(['cash', 'bank', 'e_wallet']);
const INVESTMENT_ACCOUNT_KINDS = new Set(['investment']);
const LIABILITY_ACCOUNT_KINDS = new Set(['credit_card', 'loan', 'payable']);
const MAX_EXPOSURE_KEYS = 20;
const MAX_LARGEST_POSITIONS = 20;

function getParam(params, key) {
  if (!params) return null;
  if (typeof params.get === 'function') return params.get(key);
  return params[key] ?? null;
}

function localDate() {
  return new Date().toLocaleDateString('en-CA');
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function toMinor(value) {
  if (value === null || value === undefined) return null;
  return BigInt(value).toString();
}

function sumMinor(values) {
  const known = values.filter((value) => value !== null && value !== undefined);
  if (!known.length) return null;
  return known.reduce((sum, value) => sum + BigInt(value), 0n).toString();
}

function sumLineMinor(lines) {
  return sumMinor(lines.map((line) => line.amount_cents));
}

function ratioBps(numerator, denominator) {
  if (numerator === null || denominator === null) return null;
  const numeratorValue = BigInt(numerator);
  const denominatorValue = BigInt(denominator);
  if (denominatorValue <= 0n) return null;
  return roundHalfEven(numeratorValue * 10000n, denominatorValue).toString();
}

function scaledMinor(amountMinor, decimal, reportCurrency) {
  if (amountMinor === null || decimal === null) return null;
  return decimalToMinor([
    minorToDecimal(BigInt(amountMinor), reportCurrency),
    decimal,
  ], reportCurrency).toString();
}

function normalizeExposureKeys(params) {
  const raw = getParam(params, 'taiwan_instrument_keys');
  if (raw === null || raw === undefined || raw === '') return [];
  const keys = uniqueSorted(String(raw).split(',').map((value) => value.trim()));
  if (!keys.length || keys.length > MAX_EXPOSURE_KEYS) {
    throw new FinanceError('VALIDATION_ERROR', `taiwan_instrument_keys must contain 1 to ${MAX_EXPOSURE_KEYS} keys`, {
      field: 'taiwan_instrument_keys',
    });
  }
  return keys;
}

function normalizeLeverageFactor(params, exposureKeys) {
  const raw = getParam(params, 'taiwan_leverage_factor');
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  if (!exposureKeys.length) {
    throw new FinanceError('VALIDATION_ERROR', 'taiwan_leverage_factor requires taiwan_instrument_keys', {
      field: 'taiwan_instrument_keys',
    });
  }
  const parsed = parseDecimal(String(raw), 'taiwan_leverage_factor');
  const factor = Number(parsed.text);
  if (!Number.isFinite(factor) || factor <= 0 || factor > 10) {
    throw new FinanceError('VALIDATION_ERROR', 'taiwan_leverage_factor must be greater than 0 and no more than 10', {
      field: 'taiwan_leverage_factor',
    });
  }
  return parsed.text;
}

function normalizeScope(params) {
  const exposureKeys = normalizeExposureKeys(params);
  const leverageFactor = normalizeLeverageFactor(params, exposureKeys);
  const entityId = getParam(params, 'entity_id') || 'personal';
  const asOfDate = isoDate(getParam(params, 'as_of_date') || localDate(), 'as_of_date');
  const reportCurrency = validateCurrency(getParam(params, 'currency') || 'TWD');
  const defaultedFields = [];
  if (!getParam(params, 'entity_id')) defaultedFields.push('entity_id');
  if (!getParam(params, 'as_of_date')) defaultedFields.push('as_of_date');
  if (!getParam(params, 'currency')) defaultedFields.push('currency');
  return {
    entityId,
    asOfDate,
    currency: reportCurrency,
    defaultedFields,
    exposureKeys,
    leverageFactor,
  };
}

function balanceLineMap(balanceSheet) {
  const map = new Map();
  for (const line of [...balanceSheet.assets, ...balanceSheet.liabilities]) {
    if (!line.account_key) continue;
    const before = map.get(line.account_key) || 0n;
    map.set(line.account_key, before + BigInt(line.amount_cents));
  }
  return map;
}

function accountLines(balanceSheet, predicate) {
  return [...balanceSheet.assets, ...balanceSheet.liabilities].filter((line) => predicate(line));
}

function latestStatement(card, asOfDate) {
  return card.statements
    .filter((statement) => (statement.close_date || statement.period_end || '') <= asOfDate)
    .sort((a, b) => String(b.close_date || b.period_end).localeCompare(String(a.close_date || a.period_end)))[0] || null;
}

function cardSummary(card, asOfDate) {
  const statement = latestStatement(card, asOfDate);
  if (!statement) {
    return {
      profile_key: card.profile_key,
      account_key: card.account_key,
      display_name: card.display_name,
      statement: null,
      unpaid_due_minor: null,
    };
  }
  const due = BigInt(statement.full_due_minor ?? statement.statement_balance_minor ?? 0);
  const paid = (statement.payment_matches || []).reduce((sum, match) => sum + BigInt(match.amount_minor || 0), 0n);
  const unpaid = due - paid;
  return {
    profile_key: card.profile_key,
    account_key: card.account_key,
    display_name: card.display_name,
    statement: {
      statement_key: statement.statement_key,
      period_start: statement.period_start,
      period_end: statement.period_end,
      close_date: statement.close_date,
      due_date: statement.due_date,
      statement_balance_minor: toMinor(statement.statement_balance_minor),
      minimum_due_minor: toMinor(statement.minimum_due_minor),
      full_due_minor: toMinor(statement.full_due_minor ?? statement.statement_balance_minor),
      paid_minor: paid.toString(),
    },
    unpaid_due_minor: (unpaid < 0n ? 0n : unpaid).toString(),
  };
}

function nextScheduledPayment(schedule, asOfDate) {
  const future = (schedule || [])
    .filter((entry) => entry.due_date && entry.due_date >= asOfDate)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  if (!future.length) return null;
  const month = future[0].due_date.slice(0, 7);
  const monthEntries = future.filter((entry) => entry.due_date.slice(0, 7) === month);
  return {
    due_date: future[0].due_date,
    month,
    amount_minor: sumMinor(monthEntries.map((entry) => entry.total_minor)) || '0',
    entry_count: monthEntries.length,
  };
}

function compactLiability(profile, currentByAccount, asOfDate, reportCurrency) {
  const current = currentByAccount.get(profile.account_key);
  const nextPayment = nextScheduledPayment(profile.schedule, asOfDate);
  const annualizedInterest = current !== undefined && current > 0n && profile.apr_decimal
    ? decimalToMinor([minorToDecimal(current, reportCurrency), profile.apr_decimal], reportCurrency).toString()
    : null;
  return {
    liability_key: profile.liability_key,
    account_key: profile.account_key,
    display_name: profile.display_name,
    liability_kind: profile.liability_kind,
    currency: profile.currency,
    original_principal_minor: toMinor(profile.original_principal_minor),
    current_balance_minor: current === undefined ? null : current.toString(),
    rate_type: profile.rate_type,
    apr_decimal: profile.apr_decimal || null,
    apr_as_of: profile.apr_as_of || null,
    annualized_interest_estimate_minor: annualizedInterest,
    payment_frequency: profile.payment_frequency,
    next_scheduled_payment: nextPayment,
    schedule_entry_count: profile.schedule.length,
    source_key: profile.source_key || null,
  };
}

function compactPosition(position) {
  return {
    account_key: position.account_key,
    instrument_key: position.instrument_key,
    instrument_name: position.instrument_name,
    symbol: position.symbol || null,
    quantity_decimal: position.quantity_decimal,
    native_value_minor: position.derived_value_minor,
    native_currency: position.currency,
    base_value_minor: position.base_value_minor,
    base_currency: position.base_currency || null,
    valuation_status: position.valuation_status,
    snapshot_date: position.as_of_date,
    watermark: position.watermark || null,
  };
}

function buildPositionFacts(positions, balanceSheet, scope) {
  const investmentLines = accountLines(
    balanceSheet,
    (line) => INVESTMENT_ACCOUNT_KINDS.has(line.account_kind),
  );
  const valuedPositions = positions.filter((position) => position.base_value_minor !== null);
  const selectedPositions = scope.exposureKeys.length
    ? positions.filter((position) => scope.exposureKeys.includes(position.instrument_key))
    : [];
  const selectedValuedPositions = selectedPositions.filter((position) => position.base_value_minor !== null);
  const selectedMarketValue = sumMinor(selectedValuedPositions.map((position) => position.base_value_minor));
  const factorExposure = scope.leverageFactor && selectedMarketValue !== null
    ? decimalToMinor([
      minorToDecimal(BigInt(selectedMarketValue), scope.currency),
      scope.leverageFactor,
    ], scope.currency).toString()
    : null;
  const sorted = [...valuedPositions].sort((a, b) => {
    const amount = BigInt(b.base_value_minor) - BigInt(a.base_value_minor);
    return amount === 0n ? String(a.instrument_key).localeCompare(String(b.instrument_key)) : (amount > 0n ? 1 : -1);
  });
  const assumptions = scope.exposureKeys.length || scope.leverageFactor ? [{
    kind: 'instrument_factor_exposure',
    status: 'request_assumption',
    source: 'owner_supplied_request',
    instrument_keys: scope.exposureKeys,
    leverage_factor_decimal: scope.leverageFactor,
  }] : [];
  return {
    balance_sheet_investment_value_minor: sumLineMinor(investmentLines),
    valued_position_value_minor: sumMinor(valuedPositions.map((position) => position.base_value_minor)),
    position_count: positions.length,
    valued_position_count: valuedPositions.length,
    largest_positions: sorted.slice(0, MAX_LARGEST_POSITIONS).map(compactPosition),
    omitted_position_count: Math.max(0, sorted.length - MAX_LARGEST_POSITIONS),
    selected_instrument_keys: scope.exposureKeys,
    selected_market_value_minor: selectedMarketValue,
    selected_position_count: selectedPositions.length,
    factor_exposure_minor: factorExposure,
    analysis_assumptions: assumptions,
  };
}

function healthCoverage(balanceSheet, facts, debtProfiles, cardFacts, positions, scope) {
  const blockers = (balanceSheet.coverage?.blockers || []).map((item) => ({ ...item, source: 'balance_sheet' }));
  const warnings = (balanceSheet.coverage?.warnings || []).map((item) => ({ ...item, source: 'balance_sheet' }));
  const missingInputs = [];
  if (facts.liquidity.cash_minor === null) {
    missingInputs.push('current_cash');
    warnings.push({ kind: 'missing_cash_position', severity: 'warning', label: 'No current cash balance is available.' });
  }
  if (facts.investments.balance_sheet_investment_value_minor !== null && !positions.length) {
    missingInputs.push('investment_position_detail');
    warnings.push({ kind: 'missing_investment_position_detail', severity: 'warning', label: 'Investment value exists, but instrument-level positions are unavailable.' });
  }
  if (!scope.exposureKeys.length) {
    missingInputs.push('investment_exposure_mapping');
    warnings.push({ kind: 'missing_exposure_mapping', severity: 'warning', label: 'No investment instrument scope was supplied for factor exposure analysis.' });
  } else if (!scope.leverageFactor) {
    missingInputs.push('taiwan_leverage_factor');
    warnings.push({ kind: 'missing_leverage_factor', severity: 'warning', label: 'Selected instrument market value is known, but leverage factor is not supplied.' });
  } else if (facts.investments.selected_market_value_minor === null) {
    missingInputs.push('selected_investment_valuation');
    warnings.push({ kind: 'selected_investment_unvalued', severity: 'warning', label: 'The selected exposure has no usable base-currency valuation.' });
  }
  if (debtProfiles.some((profile) => profile.current_balance_minor === null)) {
    missingInputs.push('current_liability_balance');
    warnings.push({ kind: 'missing_liability_balance', severity: 'warning', label: 'At least one liability profile has no matching current balance snapshot.' });
  }
  if (debtProfiles.some((profile) => !profile.next_scheduled_payment)) {
    missingInputs.push('debt_service_schedule');
    warnings.push({ kind: 'incomplete_debt_service_schedule', severity: 'warning', label: 'At least one liability has no usable next scheduled payment in the supplied schedule.' });
  }
  if (cardFacts.some((card) => card.unpaid_due_minor !== null)) {
    warnings.push({ kind: 'card_statement_due_not_added_to_confirmed_total', severity: 'warning', label: 'Card statement due is shown separately until the balance-sheet liability owner is confirmed.' });
  }
  missingInputs.push('essential_monthly_spend', 'reliable_income');
  warnings.push({ kind: 'runway_inputs_missing', severity: 'info', label: 'Essential monthly spend and reliable income are not part of this v0 context.' });
  const status = blockers.length
    ? (balanceSheet.coverage?.status === 'unreconciled' ? 'unreconciled' : 'partial')
    : (warnings.length ? 'partial' : 'complete');
  return {
    status,
    blockers,
    warnings,
    missing_inputs: uniqueSorted(missingInputs),
    components: {
      balance_sheet: balanceSheet.coverage?.status || 'unknown',
      liquidity: facts.liquidity.cash_minor === null ? 'missing' : 'known',
      debt: debtProfiles.length || cardFacts.length
        ? (debtProfiles.some((profile) => profile.current_balance_minor === null || !profile.next_scheduled_payment) ? 'partial' : 'known')
        : 'empty',
      investments: positions.length ? (facts.investments.valued_position_count === positions.length ? 'known' : 'partial') : 'empty',
    },
  };
}

function buildResponse(params, db) {
  const scope = normalizeScope(params);
  const reportParams = new URLSearchParams({
    entity_id: scope.entityId,
    as_of_date: scope.asOfDate,
    currency: scope.currency,
  });
  const balanceSheet = getBalanceSheet(reportParams, db);
  const positions = investmentPositions({
    entityKey: scope.entityId,
    asOfDate: scope.asOfDate,
    baseCurrency: scope.currency,
  }, db);
  const currentByAccount = balanceLineMap(balanceSheet);
  const liabilityProfiles = listLiabilities(db)
    .filter((profile) => profile.entity_key === scope.entityId)
    .map((profile) => compactLiability(profile, currentByAccount, scope.asOfDate, scope.currency));
  const cards = listCreditCards(db)
    .filter((card) => card.entity_key === scope.entityId)
    .map((card) => cardSummary(card, scope.asOfDate))
    .filter((card) => card.statement);
  const cashLines = accountLines(balanceSheet, (line) => CASH_ACCOUNT_KINDS.has(line.account_kind));
  const liabilityLines = accountLines(balanceSheet, (line) => LIABILITY_ACCOUNT_KINDS.has(line.account_kind));
  const facts = {
    position: {
      total_assets_minor: toMinor(balanceSheet.total_assets_cents),
      total_liabilities_minor: toMinor(balanceSheet.total_liabilities_cents),
      net_worth_minor: toMinor(balanceSheet.net_worth_cents),
      equation_delta_minor: toMinor(balanceSheet.equation_delta_cents),
      as_of_date: scope.asOfDate,
      source_report: 'balance_sheet',
    },
    liquidity: {
      cash_minor: sumLineMinor(cashLines),
      cash_line_count: cashLines.length,
      cash_minus_confirmed_liabilities_minor: sumLineMinor(cashLines) === null
        ? null
        : (BigInt(sumLineMinor(cashLines)) - BigInt(balanceSheet.total_liabilities_cents)).toString(),
      known_monthly_debt_service_minor: sumMinor([
        ...liabilityProfiles.map((profile) => profile.next_scheduled_payment?.amount_minor || null),
        ...cards.map((card) => card.statement.minimum_due_minor),
      ]),
      known_monthly_debt_service_status: liabilityProfiles.some((profile) => !profile.next_scheduled_payment) ? 'partial' : 'known',
      runway_months_without_income_bps: null,
      runway_status: 'unavailable_missing_essential_spend_and_reliable_income',
    },
    debt: {
      confirmed_balance_minor: toMinor(balanceSheet.total_liabilities_cents),
      liability_lines: liabilityLines.map((line) => ({
        account_key: line.account_key,
        account_kind: line.account_kind,
        label: line.label,
        balance_minor: toMinor(line.amount_cents),
        snapshot_date: line.snapshot_date,
        resource_key: line.resource_key,
      })),
      liability_profiles: liabilityProfiles,
      credit_cards: cards,
      unresolved_obligations: balanceSheet.unsupported_obligations || [],
    },
    investments: buildPositionFacts(positions, balanceSheet, scope),
  };
  const coverage = healthCoverage(balanceSheet, facts, liabilityProfiles, cards, positions, scope);
  const factorExposure = facts.investments.factor_exposure_minor;
  const netWorth = facts.position.net_worth_minor;
  const stressTests = ['0.10', '0.20'].map((drop) => {
    const loss = factorExposure === null ? null : scaledMinor(factorExposure, drop, scope.currency);
    return {
      scenario: `taiwan_underlying_down_${Number(drop) * 100}pct`,
      underlying_change_decimal: `-${drop}`,
      stress_loss_minor: loss,
      net_worth_after_loss_minor: loss === null || netWorth === null ? null : (BigInt(netWorth) - BigInt(loss)).toString(),
      loss_to_net_worth_bps: ratioBps(loss, netWorth),
    };
  });
  const derived = {
    liability_to_assets_bps: ratioBps(facts.position.total_liabilities_minor, facts.position.total_assets_minor),
    cash_to_confirmed_liabilities_bps: ratioBps(facts.liquidity.cash_minor, facts.position.total_liabilities_minor),
    factor_exposure_to_net_worth_bps: ratioBps(factorExposure, netWorth),
    factor_exposure_to_assets_bps: ratioBps(factorExposure, facts.position.total_assets_minor),
    known_debt_service_coverage_months_bps: ratioBps(facts.liquidity.cash_minor, facts.liquidity.known_monthly_debt_service_minor),
    stress_tests: stressTests,
    formulas: {
      liability_to_assets_bps: 'confirmed liabilities / total assets * 10,000',
      factor_exposure_to_net_worth_bps: 'factor exposure / net worth * 10,000; null when net worth is not positive',
      stress_loss_minor: 'factor exposure * absolute underlying decline',
      runway_months_without_income_bps: 'reserved for a later policy-aware slice; never inferred in v0',
    },
  };
  const allLines = [...balanceSheet.assets, ...balanceSheet.liabilities, ...balanceSheet.equity];
  const drillback = {
    balance_snapshot_keys: uniqueSorted(allLines.filter((line) => line.resource_type === 'account_balance_snapshot').map((line) => line.resource_key)),
    holding_keys: uniqueSorted(positions.map((position) => position.watermark?.holding_key)),
    quote_keys: uniqueSorted(positions.map((position) => position.watermark?.quote_key)),
    fx_keys: uniqueSorted(positions.map((position) => position.watermark?.fx_key)),
    liability_keys: uniqueSorted(liabilityProfiles.map((profile) => profile.liability_key)),
    card_profile_keys: uniqueSorted(cards.map((card) => card.profile_key)),
    card_statement_keys: uniqueSorted(cards.map((card) => card.statement.statement_key)),
    source_keys: uniqueSorted([
      ...allLines.map((line) => line.source_key),
      ...positions.map((position) => position.source_key),
      ...positions.map((position) => position.quote?.source_key),
      ...positions.map((position) => position.fx?.source_key),
      ...liabilityProfiles.map((profile) => profile.source_key),
    ]),
  };
  const globalWatermark = sourceWatermark(db);
  const semanticPayload = { scope, facts, coverage, derived, drillback };
  const semanticHash = createHash('sha256').update(JSON.stringify(semanticPayload)).digest('hex');
  const responseWatermark = {
    ...globalWatermark,
    policy_version: POLICY_VERSION,
    source_keys: drillback.source_keys,
    resource_keys: uniqueSorted([
      ...drillback.balance_snapshot_keys,
      ...drillback.holding_keys,
      ...drillback.quote_keys,
      ...drillback.fx_keys,
      ...drillback.liability_keys,
      ...drillback.card_profile_keys,
      ...drillback.card_statement_keys,
    ]),
    semantic_hash: semanticHash,
    change_sequence: semanticHash.slice(0, 16),
  };
  return {
    schema_version: SCHEMA_VERSION,
    analysis_id: ANALYSIS_ID,
    formula_version: FORMULA_VERSION,
    scope: {
      entity_id: scope.entityId,
      period_start: null,
      period_end: null,
      as_of_date: scope.asOfDate,
      currency: scope.currency,
      defaulted_fields: scope.defaultedFields,
    },
    source_watermark: responseWatermark,
    coverage,
    facts,
    derived,
    candidates: [],
    drillback,
  };
}

function getFinancialHealthReview(params, db = getDb()) {
  return buildResponse(params, db);
}

module.exports = {
  ANALYSIS_ID,
  FORMULA_VERSION,
  getFinancialHealthReview,
};
