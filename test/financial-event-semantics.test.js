const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveFinancialEventSemantics, reportExclusionForEventKind } = require('../lib/finance/semantics/financial-events');

function event(event_kind, extra = {}) {
  return deriveFinancialEventSemantics({ event_kind, source_fact_keys: [`source:${event_kind}`], ...extra });
}

test('card charge, payment and installments separate economic, cash and obligation timelines', () => {
  const charge = event('credit_card_charge', { amount_minor: '-1200000', economic_date: '2026-04-01' });
  assert.deepEqual(charge.economic, { role: 'expense', recognition_date: '2026-04-01', amount_minor: '-1200000' });
  assert.equal(charge.cash.role, 'none');
  assert.equal(charge.obligation.role, 'increase_card_liability');

  const plan = event('installment_plan', { amount_minor: '1200000', original_event_key: 'txn:charge', due_date: '2026-05-01' });
  assert.equal(plan.economic.role, 'none');
  assert.equal(plan.obligation.role, 'schedule_installments');

  const payment = event('credit_card_payment', { amount_minor: '-100000', settlement_date: '2026-05-15', statement_match_key: 'statement:may' });
  assert.equal(payment.economic.role, 'none');
  assert.equal(payment.cash.role, 'outflow');
  assert.equal(payment.obligation.role, 'decrease_card_liability');
  assert.equal(payment.readiness.status, 'complete');
});

test('installment settlement recognizes only explicit interest and fee components', () => {
  const settlement = event('installment_settlement', {
    amount_minor: '-10500', settlement_date: '2026-06-01', original_event_key: 'txn:charge',
    components_minor: { principal: '10000', interest: '400', fee: '100' },
  });
  assert.deepEqual(settlement.economic, { role: 'interest_and_fee_expense', recognition_date: '2026-06-01', amount_minor: '-500' });
  assert.equal(settlement.cash.amount_minor, '-10500');
  assert.equal(settlement.obligation.principal_minor, '10000');
});

test('loan payment fails closed without allocation and validates exact components', () => {
  const unknown = event('loan_payment', { amount_minor: '-1100000', settlement_date: '2026-07-01' });
  assert.equal(unknown.economic.role, 'unknown');
  assert.equal(unknown.cash.amount_minor, '-1100000');
  assert.equal(unknown.readiness.status, 'unreconciled');
  assert.deepEqual(unknown.readiness.blockers, ['missing_loan_allocation']);

  const allocated = event('loan_payment', {
    amount_minor: '-1100000', settlement_date: '2026-07-01',
    components_minor: { principal: '950000', interest: '130000', fee: '20000' },
  });
  assert.equal(allocated.economic.amount_minor, '-150000');
  assert.equal(allocated.obligation.principal_minor, '950000');
  assert.throws(() => event('loan_payment', {
    amount_minor: '-1100000', components_minor: { principal: '950000', interest: '130000', fee: '10000' },
  }), /components must equal/);
});

test('own transfers eliminate only confirmed two-sided matches', () => {
  const matched = event('own_transfer', { amount_minor: '-500000', cash_direction: 'out', match_status: 'confirmed', both_sides_in_scope: true });
  assert.equal(matched.cash.role, 'eliminated');
  assert.equal(matched.economic.role, 'none');

  const oneSided = event('own_transfer', { amount_minor: '-500000', cash_direction: 'out', match_status: 'confirmed', both_sides_in_scope: false });
  assert.equal(oneSided.cash.role, 'unresolved_outflow');
  assert.equal(oneSided.readiness.status, 'unreconciled');
  assert.deepEqual(oneSided.readiness.blockers, ['one_sided_transfer']);
});

test('refunds and reimbursements require links before affecting confirmed economic results', () => {
  const refund = event('merchant_refund', { amount_minor: '50000', original_event_key: 'txn:purchase' });
  assert.equal(refund.economic.role, 'expense_reversal');
  const unmatchedRefund = event('merchant_refund', { amount_minor: '50000' });
  assert.equal(unmatchedRefund.economic.role, 'unknown');
  assert.equal(unmatchedRefund.readiness.status, 'partial');

  const reimbursement = event('reimbursement', { amount_minor: '80000', expense_match_keys: ['txn:rail', 'txn:hotel'] });
  assert.equal(reimbursement.economic.role, 'reimbursement_recovery');
  assert.equal(reimbursement.cash.role, 'inflow');
  const unmatched = event('reimbursement', { amount_minor: '80000' });
  assert.equal(unmatched.economic.role, 'unknown');
  assert.deepEqual(unmatched.readiness.blockers, ['missing_reimbursement_match']);
});

test('owner-unresolved keeps the cash leg and blocks complete economic coverage', () => {
  const unresolved = event('owner_unresolved', { amount_minor: '-4497000', cash_direction: 'out', settlement_date: '2026-05-01' });
  assert.equal(unresolved.economic.role, 'unknown');
  assert.equal(unresolved.cash.role, 'unresolved_outflow');
  assert.equal(unresolved.cash.amount_minor, '-4497000');
  assert.equal(unresolved.readiness.status, 'partial');
});

test('commitment patterns remain candidates and occurrences do not duplicate economic or cash events', () => {
  const candidate = event('commitment_candidate', { amount_minor: '1000000', due_date: '2026-08-01' });
  assert.equal(candidate.obligation.role, 'candidate_only');
  assert.equal(candidate.readiness.status, 'partial');

  const occurrence = event('commitment_occurrence', { amount_minor: '1000000', due_date: '2026-08-01' });
  assert.equal(occurrence.economic.role, 'none');
  assert.equal(occurrence.cash.role, 'none');
  assert.equal(occurrence.obligation.role, 'scheduled_commitment');
});

test('report exclusions reuse event semantics instead of redefining accounting meaning', () => {
  assert.equal(reportExclusionForEventKind('credit_card_payment').reportLine, 'excluded:credit_card_payment');
  assert.equal(reportExclusionForEventKind('own_transfer').reportLine, 'excluded:internal_transfer');
  assert.equal(reportExclusionForEventKind('loan_principal').reportLine, 'excluded:loan_principal');
  assert.equal(reportExclusionForEventKind('owner_unresolved', { cash_direction: 'in' }).reportLine, 'excluded:unresolved_inflow');
});
