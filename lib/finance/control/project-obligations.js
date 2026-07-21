const { SUPPORTED_CURRENCIES } = require('../contracts/enums');

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const INTEGER = /^-?(0|[1-9]\d*)$/;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function date(value, label) {
  if (!ISO_DATE.test(String(value || ''))) throw new TypeError(`${label} must be YYYY-MM-DD`);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new TypeError(`${label} is not a valid date`);
  return parsed;
}

function minor(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  if (!INTEGER.test(text)) throw new TypeError(`${label} must be a canonical integer minor-unit string`);
  return BigInt(text).toString();
}

function addEvent(events, event, index) {
  object(event, `events[${index}]`);
  const eventKey = String(event.event_key || '').trim();
  if (!eventKey) throw new TypeError(`events[${index}].event_key is required`);
  if (!event.kind) throw new TypeError(`events[${index}].kind is required`);
  if (!Array.isArray(event.source_fact_keys) || event.source_fact_keys.length === 0) throw new TypeError(`events[${index}].source_fact_keys is required`);
  if (events.some((item) => item.event_key === eventKey)) throw new TypeError(`Duplicate obligation event_key: ${eventKey}`);
  const dueDate = event.due_date === null ? null : String(event.due_date || '');
  if (dueDate) date(dueDate, `events[${index}].due_date`);
  if (!['committed', 'dependable', 'uncertain'].includes(event.reliability)) throw new TypeError(`events[${index}].reliability is invalid`);
  const amount = minor(event.amount_minor, `events[${index}].amount_minor`);
  const minimum = minor(event.amount_min_minor, `events[${index}].amount_min_minor`);
  const maximum = minor(event.amount_max_minor, `events[${index}].amount_max_minor`);
  if (minimum !== null && maximum !== null && BigInt(minimum) > BigInt(maximum)) throw new TypeError(`events[${index}] amount range is invalid`);
  if (event.components_minor !== undefined) {
    object(event.components_minor, `events[${index}].components_minor`);
    const components = ['principal', 'interest', 'fee'].map((name) => minor(event.components_minor[name], `events[${index}].components_minor.${name}`));
    if (components.some((value) => value === null)) throw new TypeError(`events[${index}].components_minor must include principal, interest and fee`);
    if (amount === null || components.reduce((total, value) => total + BigInt(value), 0n) !== (BigInt(amount) < 0n ? -BigInt(amount) : BigInt(amount))) {
      throw new TypeError(`events[${index}] components must equal amount`);
    }
  }
  events.push({
    ...event,
    event_key: eventKey,
    due_date: dueDate || null,
    amount_minor: amount,
    amount_min_minor: minimum,
    amount_max_minor: maximum,
  });
}

function projectObligations(input) {
  object(input, 'obligation projection input');
  const asOf = date(input.as_of_date, 'as_of_date');
  const horizonDays = Number(input.horizon_days);
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 366) throw new TypeError('horizon_days must be an integer from 1 to 366');
  if (!SUPPORTED_CURRENCIES.includes(input.currency)) throw new TypeError('currency is unsupported');
  const events = [];
  (input.events || []).forEach((event, index) => addEvent(events, event, index));
  const endExclusive = asOf + horizonDays * 86400000;
  const inWindow = events.filter((event) => event.due_date && date(event.due_date, 'due_date') >= asOf && date(event.due_date, 'due_date') < endExclusive);
  inWindow.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.event_key.localeCompare(b.event_key));
  const known = inWindow.filter((event) => event.amount_minor !== null);
  const range = inWindow.filter((event) => event.amount_minor === null && event.amount_min_minor !== null);
  const unknown = inWindow.filter((event) => event.amount_minor === null && event.amount_min_minor === null);
  const windows = [7, 30, 90].filter((days) => days <= horizonDays).map((days) => {
    const end = asOf + days * 86400000;
    const selected = inWindow.filter((event) => date(event.due_date, 'due_date') < end);
    return {
      days,
      event_count: selected.length,
      known_amount_minor: selected.filter((event) => event.amount_minor !== null).reduce((total, event) => total + BigInt(event.amount_minor), 0n).toString(),
      range_min_minor: selected.filter((event) => event.amount_minor === null && event.amount_min_minor !== null).reduce((total, event) => total + BigInt(event.amount_min_minor), 0n).toString(),
      range_max_minor: selected.filter((event) => event.amount_minor === null && event.amount_max_minor !== null).reduce((total, event) => total + BigInt(event.amount_max_minor), 0n).toString(),
      unknown_amount_count: selected.filter((event) => event.amount_minor === null && event.amount_min_minor === null).length,
    };
  });
  return {
    schema_version: 'finance.control.obligation-events/v1',
    as_of_date: input.as_of_date,
    horizon_days: horizonDays,
    currency: input.currency,
    events: inWindow,
    windows,
    counts: { total: inWindow.length, known: known.length, range: range.length, unknown: unknown.length },
  };
}

module.exports = { projectObligations };
