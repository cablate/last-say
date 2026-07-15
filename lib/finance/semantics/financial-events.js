const EVENT_KINDS = Object.freeze([
  'cash_purchase',
  'credit_card_charge',
  'credit_card_payment',
  'installment_plan',
  'installment_settlement',
  'loan_proceeds',
  'loan_payment',
  'own_transfer',
  'merchant_refund',
  'reimbursement',
  'investment_purchase',
  'commitment_candidate',
  'commitment_occurrence',
  'owner_unresolved',
]);

const EVENT_KIND_SET = new Set(EVENT_KINDS);
const INTEGER_MINOR = /^-?(0|[1-9]\d*)$/;
const DIRECTIONS = new Set(['in', 'out']);

function objectValue(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function eventKind(value) {
  const kind = String(value || '').trim();
  if (!EVENT_KIND_SET.has(kind)) throw new TypeError(`event_kind must be one of: ${EVENT_KINDS.join(', ')}`);
  return kind;
}

function sourceKeys(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('source_fact_keys must contain at least one key');
  const keys = value.map((item) => String(item || '').trim());
  if (keys.some((item) => !item)) throw new TypeError('source_fact_keys must not contain empty keys');
  return [...new Set(keys)];
}

function optionalMinor(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !INTEGER_MINOR.test(value)) throw new TypeError(`${label} must be a canonical integer minor-unit string`);
  return BigInt(value);
}

function direction(value, label = 'cash_direction') {
  if (!DIRECTIONS.has(value)) throw new TypeError(`${label} must be in or out`);
  return value;
}

function baseResult(kind, keys) {
  return {
    event_kind: kind,
    source_fact_keys: keys,
    economic: { role: 'none', recognition_date: null, amount_minor: null },
    cash: { role: 'none', settlement_date: null, amount_minor: null },
    obligation: { role: 'none', due_date: null, principal_minor: null },
    readiness: { status: 'complete', blockers: [] },
  };
}

function partial(result, blocker, status = 'partial') {
  result.readiness.status = status;
  if (!result.readiness.blockers.includes(blocker)) result.readiness.blockers.push(blocker);
  return result;
}

function signedAmount(input, expectedDirection) {
  const value = optionalMinor(input.amount_minor, 'amount_minor');
  if (value === null) return null;
  if (expectedDirection === 'out' && value > 0n) return -value;
  if (expectedDirection === 'in' && value < 0n) return -value;
  return value;
}

function allocation(input, cashAmount) {
  if (input.components_minor === undefined || input.components_minor === null) return null;
  const components = objectValue(input.components_minor, 'components_minor');
  const principal = optionalMinor(components.principal, 'components_minor.principal');
  const interest = optionalMinor(components.interest, 'components_minor.interest');
  const fee = optionalMinor(components.fee, 'components_minor.fee');
  if ([principal, interest, fee].some((value) => value === null || value < 0n)) {
    throw new TypeError('loan components must be non-negative canonical integer minor-unit strings');
  }
  if (cashAmount === null) throw new TypeError('amount_minor is required when components_minor is present');
  const cashAbsolute = cashAmount < 0n ? -cashAmount : cashAmount;
  if (principal + interest + fee !== cashAbsolute) throw new TypeError('loan components must equal the absolute cash amount');
  return { principal, interest, fee };
}

function deriveFinancialEventSemantics(input) {
  objectValue(input, 'financial event');
  const kind = eventKind(input.event_kind);
  const result = baseResult(kind, sourceKeys(input.source_fact_keys));

  if (kind === 'cash_purchase') {
    const amount = signedAmount(input, 'out');
    result.economic = { role: 'expense', recognition_date: input.economic_date || null, amount_minor: amount?.toString() ?? null };
    result.cash = { role: 'outflow', settlement_date: input.settlement_date || input.economic_date || null, amount_minor: amount?.toString() ?? null };
  } else if (kind === 'credit_card_charge') {
    const amount = signedAmount(input, 'out');
    result.economic = { role: 'expense', recognition_date: input.economic_date || null, amount_minor: amount?.toString() ?? null };
    result.obligation = { role: 'increase_card_liability', due_date: input.due_date || null, principal_minor: amount === null ? null : (-amount).toString() };
  } else if (kind === 'credit_card_payment') {
    const amount = signedAmount(input, 'out');
    result.cash = { role: 'outflow', settlement_date: input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    result.obligation = { role: 'decrease_card_liability', due_date: null, principal_minor: amount === null ? null : (-amount).toString() };
    if (!input.statement_match_key) partial(result, 'missing_card_statement_match', 'unreconciled');
  } else if (kind === 'installment_plan') {
    result.obligation = { role: 'schedule_installments', due_date: input.due_date || null, principal_minor: optionalMinor(input.amount_minor, 'amount_minor')?.toString() ?? null };
    if (!input.original_event_key) partial(result, 'missing_original_purchase_link');
  } else if (kind === 'installment_settlement') {
    const amount = signedAmount(input, 'out');
    const components = allocation(input, amount);
    result.cash = { role: 'outflow', settlement_date: input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    result.obligation = { role: 'settle_installment', due_date: input.due_date || null, principal_minor: components?.principal.toString() ?? null };
    if (components && components.interest + components.fee > 0n) {
      result.economic = { role: 'interest_and_fee_expense', recognition_date: input.settlement_date || null, amount_minor: (-(components.interest + components.fee)).toString() };
    }
    if (!input.original_event_key) partial(result, 'missing_original_purchase_link');
  } else if (kind === 'loan_proceeds') {
    const amount = signedAmount(input, 'in');
    result.cash = { role: 'inflow', settlement_date: input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    result.obligation = { role: 'increase_loan_liability', due_date: null, principal_minor: amount?.toString() ?? null };
  } else if (kind === 'loan_payment') {
    const amount = signedAmount(input, 'out');
    const components = allocation(input, amount);
    result.cash = { role: 'outflow', settlement_date: input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    if (!components) {
      result.economic = { role: 'unknown', recognition_date: input.settlement_date || null, amount_minor: null };
      result.obligation = { role: 'unknown', due_date: input.due_date || null, principal_minor: null };
      partial(result, 'missing_loan_allocation', 'unreconciled');
    } else {
      const expense = components.interest + components.fee;
      result.economic = { role: expense === 0n ? 'none' : 'interest_and_fee_expense', recognition_date: input.settlement_date || null, amount_minor: expense === 0n ? null : (-expense).toString() };
      result.obligation = { role: 'reduce_loan_principal', due_date: input.due_date || null, principal_minor: components.principal.toString() };
    }
  } else if (kind === 'own_transfer') {
    const cashDirection = direction(input.cash_direction);
    const amount = signedAmount(input, cashDirection);
    const confirmed = input.match_status === 'confirmed';
    if (confirmed && input.both_sides_in_scope === true) {
      result.cash = { role: 'eliminated', settlement_date: input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    } else {
      result.cash = { role: cashDirection === 'in' ? 'unresolved_inflow' : 'unresolved_outflow', settlement_date: input.settlement_date || null, amount_minor: amount?.toString() ?? null };
      partial(result, confirmed ? 'one_sided_transfer' : 'unconfirmed_transfer_match', 'unreconciled');
    }
  } else if (kind === 'merchant_refund') {
    const amount = signedAmount(input, 'in');
    result.cash = { role: 'inflow', settlement_date: input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    if (input.original_event_key) {
      result.economic = { role: 'expense_reversal', recognition_date: input.economic_date || input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    } else {
      result.economic = { role: 'unknown', recognition_date: input.economic_date || input.settlement_date || null, amount_minor: null };
      partial(result, 'missing_refund_origin');
    }
  } else if (kind === 'reimbursement') {
    const amount = signedAmount(input, 'in');
    result.cash = { role: 'inflow', settlement_date: input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    if (input.expense_match_keys?.length) {
      result.economic = { role: 'reimbursement_recovery', recognition_date: input.economic_date || input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    } else {
      result.economic = { role: 'unknown', recognition_date: input.economic_date || input.settlement_date || null, amount_minor: null };
      partial(result, 'missing_reimbursement_match');
    }
  } else if (kind === 'investment_purchase') {
    const amount = signedAmount(input, 'out');
    result.cash = { role: input.internal_transfer_confirmed ? 'eliminated' : 'outflow', settlement_date: input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    result.obligation = { role: 'increase_investment_asset', due_date: null, principal_minor: amount === null ? null : (-amount).toString() };
  } else if (kind === 'commitment_candidate') {
    result.obligation = { role: 'candidate_only', due_date: input.due_date || null, principal_minor: optionalMinor(input.amount_minor, 'amount_minor')?.toString() ?? null };
    partial(result, 'commitment_not_confirmed');
  } else if (kind === 'commitment_occurrence') {
    result.obligation = { role: input.settled ? 'settled_commitment' : 'scheduled_commitment', due_date: input.due_date || null, principal_minor: optionalMinor(input.amount_minor, 'amount_minor')?.toString() ?? null };
  } else if (kind === 'owner_unresolved') {
    const cashDirection = direction(input.cash_direction);
    const amount = signedAmount(input, cashDirection);
    result.economic = { role: 'unknown', recognition_date: input.economic_date || null, amount_minor: null };
    result.cash = { role: cashDirection === 'in' ? 'unresolved_inflow' : 'unresolved_outflow', settlement_date: input.settlement_date || null, amount_minor: amount?.toString() ?? null };
    partial(result, 'owner_unresolved_purpose');
  }

  return result;
}

function reportExclusionForEventKind(kind, options = {}) {
  if (kind === 'credit_card_payment') return { reportLine: 'excluded:credit_card_payment', reason: 'card payment is a cash settlement, not a second expense' };
  if (kind === 'own_transfer') return { reportLine: 'excluded:internal_transfer', reason: 'own-account transfer is not income or expense' };
  if (kind === 'investment_purchase') return { reportLine: 'excluded:investment_purchase', reason: 'investment purchase is an asset movement, not an ordinary expense' };
  if (kind === 'loan_principal') return { reportLine: 'excluded:loan_principal', reason: 'loan principal reduces a liability, not profit or loss' };
  if (kind === 'owner_unresolved') {
    if (options.cash_direction === 'in') return { reportLine: 'excluded:unresolved_inflow', reason: 'owner confirmed purpose cannot be recovered' };
    if (options.cash_direction === 'out') return { reportLine: 'excluded:unresolved_outflow', reason: 'owner confirmed purpose cannot be recovered' };
  }
  return null;
}

module.exports = { EVENT_KINDS, deriveFinancialEventSemantics, reportExclusionForEventKind };
