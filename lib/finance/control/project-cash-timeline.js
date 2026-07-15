const { SUPPORTED_CURRENCIES } = require('../contracts/enums');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER = /^-?(0|[1-9]\d*)$/;
const COVERAGE = new Set(['empty', 'partial', 'unreconciled', 'complete']);
const RELIABILITY = new Set(['committed', 'dependable', 'uncertain']);

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function dateValue(value, label) {
  if (!ISO_DATE.test(String(value || ''))) throw new TypeError(`${label} must be YYYY-MM-DD`);
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new TypeError(`${label} is not a valid calendar date`);
  return timestamp;
}

function integerMinor(value, label) {
  if (typeof value !== 'string' || !INTEGER.test(value)) throw new TypeError(`${label} must be a canonical integer minor-unit string`);
  return BigInt(value);
}

function dateAt(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }
function dayDiff(later, earlier) { return Math.floor((later - earlier) / 86400000); }

function validateEvent(event, index, currency, seen) {
  plainObject(event, `events[${index}]`);
  const key = String(event.event_key || '').trim();
  if (!key) throw new TypeError(`events[${index}].event_key is required`);
  if (seen.has(key)) throw new TypeError(`Duplicate event_key: ${key}`);
  seen.add(key);
  const timestamp = dateValue(event.date, `events[${index}].date`);
  if (!String(event.kind || '').trim()) throw new TypeError(`events[${index}].kind is required`);
  if (!RELIABILITY.has(event.reliability)) throw new TypeError(`events[${index}].reliability is invalid`);
  if (!Array.isArray(event.source_fact_keys) || event.source_fact_keys.length === 0) throw new TypeError(`events[${index}].source_fact_keys is required`);
  if (event.currency && event.currency !== currency) throw new TypeError(`events[${index}].currency must match forecast currency`);
  const cashEffect = event.cash_effect_minor === null ? null : integerMinor(event.cash_effect_minor, `events[${index}].cash_effect_minor`);
  if (event.kind === 'loan_payment' && event.components_minor) {
    const components = plainObject(event.components_minor, `events[${index}].components_minor`);
    const sum = ['principal', 'interest', 'fee'].reduce((total, name) => total + integerMinor(components[name], `events[${index}].components_minor.${name}`), 0n);
    const absolute = cashEffect === null ? null : (cashEffect < 0n ? -cashEffect : cashEffect);
    if (absolute === null || sum !== absolute) throw new TypeError(`events[${index}] loan components must equal cash effect`);
  }
  return { ...event, event_key: key, timestamp, cashEffect };
}

function projectCashTimeline(input) {
  plainObject(input, 'forecast input');
  const asOf = dateValue(input.as_of_date, 'as_of_date');
  const horizonDays = Number(input.horizon_days);
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 366) throw new TypeError('horizon_days must be an integer from 1 to 366');
  if (!SUPPORTED_CURRENCIES.includes(input.currency)) throw new TypeError('currency is unsupported');
  const opening = integerMinor(input.opening_liquid_cash_minor, 'opening_liquid_cash_minor');
  const reserve = integerMinor(input.reserve_floor_minor, 'reserve_floor_minor');
  const buffer = integerMinor(input.uncertainty_buffer_minor ?? '0', 'uncertainty_buffer_minor');
  const coverageInput = plainObject(input.coverage, 'coverage');
  if (!COVERAGE.has(coverageInput.status)) throw new TypeError('coverage.status is invalid');
  const seen = new Set();
  const endExclusive = asOf + horizonDays * 86400000;
  const events = (input.events || []).map((event, index) => validateEvent(event, index, input.currency, seen));
  const included = [];
  const excluded = [];
  const derivedGaps = [];

  for (const event of events) {
    if (event.timestamp < asOf) { excluded.push({ event_key: event.event_key, reason: 'before_as_of' }); continue; }
    if (event.timestamp >= endExclusive) { excluded.push({ event_key: event.event_key, reason: 'outside_horizon' }); continue; }
    if (event.cashEffect === null) {
      excluded.push({ event_key: event.event_key, reason: 'unknown_amount' });
      if (event.reliability === 'committed') derivedGaps.push({ kind: 'unknown_commitment_amount', event_key: event.event_key });
      continue;
    }
    if (event.reliability === 'uncertain') { excluded.push({ event_key: event.event_key, reason: 'uncertain' }); continue; }
    included.push(event);
  }

  included.sort((a, b) => a.timestamp - b.timestamp || a.event_key.localeCompare(b.event_key));
  const byDate = new Map();
  for (const event of included) {
    const date = dateAt(event.timestamp);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(event);
  }

  const daily = [];
  let current = opening;
  let minimum = opening;
  let minimumDate = dateAt(asOf);
  let firstBreach = null;
  for (let offset = 0; offset < horizonDays; offset += 1) {
    const date = dateAt(asOf + offset * 86400000);
    const dayEvents = byDate.get(date) || [];
    const net = dayEvents.reduce((total, event) => total + event.cashEffect, 0n);
    const dayOpening = current;
    current += net;
    const headroom = current - reserve - buffer;
    if (current < minimum) { minimum = current; minimumDate = date; }
    if (!firstBreach && current < reserve + buffer) firstBreach = date;
    daily.push({
      date,
      opening_cash_minor: dayOpening.toString(),
      event_keys: dayEvents.map((event) => event.event_key),
      net_cash_change_minor: net.toString(),
      closing_projected_cash_minor: current.toString(),
      reserve_floor_minor: reserve.toString(),
      uncertainty_buffer_minor: buffer.toString(),
      headroom_minor: headroom.toString(),
    });
  }

  const coverageStatus = coverageInput.status === 'complete' && derivedGaps.length ? 'partial' : coverageInput.status;
  const gaps = [...(Array.isArray(coverageInput.gaps) ? coverageInput.gaps : []), ...derivedGaps]
    .filter((gap, index, all) => index === all.findIndex((other) => JSON.stringify(other) === JSON.stringify(gap)));
  const safeToSpend = coverageStatus === 'complete'
    ? daily.reduce((minimumHeadroom, row) => {
      const value = BigInt(row.headroom_minor);
      return value < minimumHeadroom ? value : minimumHeadroom;
    }, BigInt(daily[0].headroom_minor))
    : null;

  return {
    as_of_date: input.as_of_date,
    horizon_days: horizonDays,
    currency: input.currency,
    coverage: { status: coverageStatus, gaps },
    daily,
    summary: {
      minimum_projected_cash_minor: minimum.toString(),
      minimum_projected_cash_date: minimumDate,
      first_reserve_breach_date: firstBreach,
      cash_runway_days: firstBreach ? dayDiff(Date.parse(`${firstBreach}T00:00:00Z`), asOf) : null,
      safe_to_spend_minor: safeToSpend === null ? null : (safeToSpend > 0n ? safeToSpend : 0n).toString(),
    },
    included_events: included.map((event) => ({ event_key: event.event_key, date: event.date, kind: event.kind, cash_effect_minor: event.cashEffect.toString(), source_fact_keys: event.source_fact_keys })),
    excluded_events: excluded,
  };
}

module.exports = { projectCashTimeline };
