const { createHash } = require('node:crypto');

const { FinanceError, currency: validateCurrency, isoDate } = require('../../../finance/contracts');
const { POLICY_VERSION, sourceWatermark } = require('../../../finance/readiness/policy');
const { getDb } = require('../common');
const { listAccounts } = require('../accounts');
const { latestBalanceForAccount } = require('../balances');
const { getObligationTimeline } = require('./obligations');
const { projectCashTimeline } = require('../../../finance/control/project-cash-timeline');

const ANALYSIS_ID = 'cash_forecast';
const FORMULA_VERSION = 'cash-forecast/1';
const CASH_ACCOUNT_KINDS = new Set(['cash', 'bank', 'e_wallet']);

function getParam(params, key) {
  if (!params) return null;
  if (typeof params.get === 'function') return params.get(key);
  return params[key] ?? null;
}

function localDate() { return new Date().toLocaleDateString('en-CA'); }
function unique(values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }
function asMinor(value) { return value === null || value === undefined ? null : BigInt(value).toString(); }

function scope(params) {
  const asOfDate = isoDate(getParam(params, 'as_of_date') || localDate(), 'as_of_date');
  const entityId = getParam(params, 'entity_id') || 'personal';
  const reportCurrency = validateCurrency(getParam(params, 'currency') || 'TWD');
  const horizonDays = Number(getParam(params, 'horizon_days') || 90);
  if (horizonDays !== 90) throw new FinanceError('VALIDATION_ERROR', 'horizon_days must be 90 for the cash forecast', { field: 'horizon_days' });
  return { asOfDate, entityId, currency: reportCurrency, horizonDays };
}

function openingCash(target, db) {
  const accounts = listAccounts({ entity_key: target.entityId, active: true }, db)
    .filter((account) => account.included_in_analysis && CASH_ACCOUNT_KINDS.has(account.account_kind));
  const sameCurrency = accounts.filter((account) => account.currency === target.currency);
  const blockers = [];
  const warnings = accounts.filter((account) => account.currency !== target.currency).map((account) => ({
    kind: 'foreign_currency_cash_excluded', resource_key: account.account_key,
    label: `${account.display_name} 是 ${account.currency}，未在 ${target.currency} raw forecast 中換算。`,
  }));
  const lines = sameCurrency.map((account) => {
    const balance = latestBalanceForAccount(account.account_key, { asOfDate: target.asOfDate }, db);
    if (balance.status !== 'current' || !balance.selected) {
      blockers.push({
        kind: balance.status === 'missing' ? 'missing_opening_cash_snapshot' : 'untrusted_opening_cash_snapshot',
        resource_key: account.account_key,
        label: `${account.display_name} 沒有可作為期初的 current balance snapshot（目前為 ${balance.status}）。`,
      });
      return null;
    }
    if (balance.selected.currency !== target.currency) {
      blockers.push({ kind: 'opening_cash_currency_mismatch', resource_key: balance.selected.snapshot_key, label: `${account.display_name} 的 snapshot 幣別與 forecast 不一致。` });
      return null;
    }
    return {
      account_key: account.account_key,
      display_name: account.display_name,
      account_kind: account.account_kind,
      amount_minor: asMinor(balance.selected.amount_minor),
      snapshot_key: balance.selected.snapshot_key,
      source_key: balance.selected.source_key || null,
      as_of_date: balance.selected.as_of_date,
      status: balance.status,
    };
  }).filter(Boolean);
  if (!sameCurrency.length) blockers.push({ kind: 'missing_opening_cash', resource_key: null, label: `沒有納入分析且幣別為 ${target.currency} 的流動現金帳戶。` });
  if (blockers.length) return { amount_minor: null, lines, blockers, warnings };
  return { amount_minor: lines.reduce((total, line) => total + BigInt(line.amount_minor), 0n).toString(), lines, blockers, warnings };
}

function toCashEvents(obligationModel) {
  return obligationModel.facts.events.map((event) => ({
    event_key: event.event_key,
    date: event.due_date,
    kind: event.kind,
    currency: event.currency,
    cash_effect_minor: event.amount_minor === null ? null : (-BigInt(event.amount_minor)).toString(),
    reliability: event.reliability,
    source_fact_keys: event.source_fact_keys,
    ...(event.kind === 'loan_payment' && event.components_minor ? { components_minor: event.components_minor } : {}),
  }));
}

function getCashForecast(params, db = getDb()) {
  const target = scope(params);
  const opening = openingCash(target, db);
  const obligationParams = new URLSearchParams({ as_of_date: target.asOfDate, entity_id: target.entityId, currency: target.currency, horizon_days: String(target.horizonDays) });
  const obligations = getObligationTimeline(obligationParams, db);
  const events = toCashEvents(obligations);
  const blockers = [
    ...opening.blockers,
    ...(obligations.coverage.blockers || []),
  ];
  const warnings = [
    ...opening.warnings,
    ...(obligations.coverage.warnings || []),
  ];
  const missingInputs = unique([
    ...blockers.map((item) => item.kind),
    ...(obligations.facts.counts.range || obligations.facts.counts.unknown ? ['uncertain_future_obligation_amounts'] : []),
    ...(obligations.coverage.status === 'empty' ? ['future_obligations_not_present'] : []),
  ]);
  const coverageStatus = blockers.length || obligations.facts.counts.range || obligations.facts.counts.unknown
    ? 'partial'
    : obligations.coverage.status === 'empty' ? 'empty' : 'complete';
  const coverage = { status: coverageStatus, gaps: missingInputs.map((kind) => ({ kind })), missing_inputs: missingInputs, blockers, warnings };
  const rawForecast = opening.amount_minor === null ? null : projectCashTimeline({
    as_of_date: target.asOfDate,
    horizon_days: target.horizonDays,
    currency: target.currency,
    opening_liquid_cash_minor: opening.amount_minor,
    policy: { status: 'unavailable', reason: 'owner_policy_not_configured' },
    coverage,
    events,
  });
  const resourceKeys = unique([
    ...opening.lines.flatMap((line) => [line.account_key, line.snapshot_key, line.source_key]),
    ...(obligations.source_watermark.resource_keys || []),
  ]);
  const semanticPayload = { target, opening, obligations, coverage, rawForecast };
  const semanticHash = createHash('sha256').update(JSON.stringify(semanticPayload)).digest('hex');
  return {
    schema_version: 'finance.analysis-read-model/v1',
    analysis_id: ANALYSIS_ID,
    formula_version: FORMULA_VERSION,
    scope: { entity_id: target.entityId, as_of_date: target.asOfDate, period_start: target.asOfDate, period_end: null, currency: target.currency, horizon_days: target.horizonDays, defaulted_fields: [] },
    coverage,
    facts: {
      opening_liquid_cash: opening,
      obligations: { events: obligations.facts.events, windows: obligations.facts.windows, counts: obligations.facts.counts },
      forecast: rawForecast,
    },
    derived: {
      mode: 'raw_known_obligations',
      minimum_projected_cash_minor: rawForecast?.summary.minimum_projected_cash_minor || null,
      minimum_projected_cash_date: rawForecast?.summary.minimum_projected_cash_date || null,
      safe_to_spend_minor: null,
      excluded_income: true,
      excluded_uncertain_events: rawForecast?.excluded_events?.filter((event) => event.reason === 'uncertain' || event.reason === 'unknown_amount').map((event) => event.event_key) || [],
    },
    source_watermark: { ...sourceWatermark(db), policy_version: POLICY_VERSION, resource_keys: resourceKeys, semantic_hash: semanticHash, change_sequence: semanticHash.slice(0, 16) },
    drillback: { event_keys: obligations.drillback.event_keys, source_fact_keys: resourceKeys, blocker_resource_keys: unique(blockers.map((item) => item.resource_key)) },
  };
}

module.exports = { ANALYSIS_ID, FORMULA_VERSION, getCashForecast };
