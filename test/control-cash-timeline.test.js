const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { projectCashTimeline } = require('../lib/finance/control/project-cash-timeline');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'financial-control', 'post-style-pressure.json'), 'utf8'));

test('post-style fixture produces deterministic conservative timeline and expected pressure point', () => {
  const result = projectCashTimeline(fixture.forecast_input);
  assert.equal(result.daily.length, 90);
  assert.equal(result.coverage.status, fixture.expected.coverage_status);
  assert.equal(result.summary.minimum_projected_cash_minor, fixture.expected.minimum_projected_cash_minor);
  assert.equal(result.summary.minimum_projected_cash_date, fixture.expected.minimum_projected_cash_date);
  assert.equal(result.summary.first_reserve_breach_date, fixture.expected.first_reserve_breach_date);
  assert.equal(result.summary.cash_runway_days, fixture.expected.cash_runway_days);
  assert.equal(result.summary.safe_to_spend_minor, fixture.expected.safe_to_spend_minor);
  assert.deepEqual(result.excluded_events.map((event) => event.event_key), fixture.expected.excluded_event_keys);
});
test('card charge does not move cash and loan components equal one cash payment', () => {
  const result = projectCashTimeline(fixture.forecast_input);
  const charge = result.included_events.find((event) => event.event_key === 'card-charge-jul');
  const loan = result.included_events.find((event) => event.event_key === 'loan-jul');
  assert.equal(charge.cash_effect_minor, fixture.expected.included_card_charge_cash_effect_minor);
  assert.equal(loan.cash_effect_minor, fixture.expected.loan_july_cash_effect_minor);
  assert.equal(result.daily.find((day) => day.date === '2026-07-16').net_cash_change_minor, '0');
});

test('projector fails closed on duplicate events, non-integer money and mismatched loan split', () => {
  const duplicate = structuredClone(fixture.forecast_input);
  duplicate.events.push(structuredClone(duplicate.events[0]));
  assert.throws(() => projectCashTimeline(duplicate), /Duplicate event_key/);

  const floatMoney = structuredClone(fixture.forecast_input);
  floatMoney.opening_liquid_cash_minor = 120000;
  assert.throws(() => projectCashTimeline(floatMoney), /integer minor-unit string/);

  const mismatch = structuredClone(fixture.forecast_input);
  mismatch.events.find((event) => event.event_key === 'loan-jul').components_minor.interest = '99999';
  assert.throws(() => projectCashTimeline(mismatch), /components must equal cash effect/);
});
