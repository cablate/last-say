const test = require('node:test');
const assert = require('node:assert/strict');
const { projectObligations } = require('../lib/finance/control/project-obligations');

test('FC-2A projects known, ranged and unknown obligation events without floats', () => {
  const result = projectObligations({
    as_of_date: '2026-07-17', horizon_days: 90, currency: 'TWD',
    events: [
      { event_key: 'loan:1', kind: 'loan_payment', due_date: '2026-07-20', amount_minor: '25000', reliability: 'committed', source_fact_keys: ['schedule:1'], components_minor: { principal: '20000', interest: '5000', fee: '0' } },
      { event_key: 'rent:1', kind: 'commitment', due_date: '2026-08-01', amount_min_minor: '700000', amount_max_minor: '800000', reliability: 'committed', source_fact_keys: ['commitment:1'] },
      { event_key: 'unknown:1', kind: 'commitment', due_date: '2026-08-02', amount_minor: null, reliability: 'uncertain', source_fact_keys: ['commitment:2'] },
      { event_key: 'outside:1', kind: 'commitment', due_date: '2026-10-20', amount_minor: '100', reliability: 'committed', source_fact_keys: ['commitment:3'] },
    ],
  });
  assert.equal(result.events.length, 3);
  assert.deepEqual(result.counts, { total: 3, known: 1, range: 1, unknown: 1 });
  assert.deepEqual(result.windows[0], { days: 7, event_count: 1, known_amount_minor: '25000', range_min_minor: '0', range_max_minor: '0', unknown_amount_count: 0 });
  assert.equal(result.windows[2].unknown_amount_count, 1);
});

test('FC-2A fails closed on duplicate events, bad ranges and invalid components', () => {
  assert.throws(() => projectObligations({ as_of_date: '2026-07-17', horizon_days: 90, currency: 'TWD', events: [
    { event_key: 'same', kind: 'loan_payment', due_date: '2026-07-20', amount_minor: '1', reliability: 'committed', source_fact_keys: ['a'] },
    { event_key: 'same', kind: 'loan_payment', due_date: '2026-07-21', amount_minor: '1', reliability: 'committed', source_fact_keys: ['b'] },
  ] }), /Duplicate obligation event_key/);
  assert.throws(() => projectObligations({ as_of_date: '2026-07-17', horizon_days: 90, currency: 'TWD', events: [
    { event_key: 'range', kind: 'commitment', due_date: '2026-07-20', amount_min_minor: '2', amount_max_minor: '1', reliability: 'committed', source_fact_keys: ['a'] },
  ] }), /amount range is invalid/);
  assert.throws(() => projectObligations({ as_of_date: '2026-07-17', horizon_days: 90, currency: 'TWD', events: [
    { event_key: 'loan', kind: 'loan_payment', due_date: '2026-07-20', amount_minor: '25000', reliability: 'committed', source_fact_keys: ['a'], components_minor: { principal: '20000', interest: '4000', fee: '0' } },
  ] }), /components must equal amount/);
});
