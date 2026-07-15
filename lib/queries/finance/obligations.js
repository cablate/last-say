const {
  FinanceError,
  requiredString,
  enumValue,
  currency,
  isoDate,
  expectedVersion,
} = require('../../finance/contracts');
const {
  getDb,
  stableKey,
  logChange,
  requireRow,
  assertVersion,
  withTransaction,
} = require('./common');
const { moneyMinor } = require('./balances');
const { createReviewTask, resolveReviewTask } = require('./review-tasks');

const ACTIVE_TRANSACTION_STATUSES = new Set(['provisional', 'posted', 'confirmed']);

function nonNegativeMinor(value, field) {
  const amount = moneyMinor(value);
  if (amount < 0n) throw new FinanceError('VALIDATION_ERROR', `${field} must be non-negative`, { field });
  return amount;
}

function activeOutflow(tx, field = 'transaction_key') {
  if (!ACTIVE_TRANSACTION_STATUSES.has(tx.record_status || 'posted')) {
    throw new FinanceError('VERSION_CONFLICT', 'Settlement requires an active cash transaction', { status: 409, field });
  }
  const amount = moneyMinor(tx.amount_minor ?? tx.amount);
  if (amount >= 0n) throw new FinanceError('VALIDATION_ERROR', 'Settlement transaction must be an outflow', { field });
  return -amount;
}

function installmentTerms(input) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const count = integer(input.installment_count, 'installment_count');
  const principal = nonNegativeMinor(input.financed_principal_minor, 'financed_principal_minor');
  let principalSum = 0n;
  const sequences = new Set();
  const normalizedEntries = entries.map((entry) => {
    const sequence = integer(entry.sequence, 'sequence');
    if (sequences.has(sequence)) throw new FinanceError('IDENTITY_CONFLICT', `Duplicate installment sequence: ${sequence}`, { status: 409 });
    sequences.add(sequence);
    const componentPrincipal = nonNegativeMinor(entry.principal_minor, 'principal_minor');
    const interest = nonNegativeMinor(entry.interest_minor || '0', 'interest_minor');
    const fee = nonNegativeMinor(entry.fee_minor || '0', 'fee_minor');
    const total = nonNegativeMinor(entry.total_minor, 'total_minor');
    if (total !== componentPrincipal + interest + fee) throw new FinanceError('VALIDATION_ERROR', 'Installment components must equal total_minor');
    principalSum += componentPrincipal;
    return { ...entry, sequence, principal: componentPrincipal, interest, fee, total };
  });
  return { entries: normalizedEntries, count, principal, status: entries.length === count && principalSum === principal ? 'reconciled' : 'unreconciled' };
}

function loanScheduleTerms(input) {
  const authority = enumValue(input.authority, 'authority', 'authority');
  if (!['official', 'user_confirmed'].includes(authority)) throw new FinanceError('REVIEW_REQUIRED', 'Loan schedule requires official or user-confirmed evidence', { status: 409 });
  const entries = Array.isArray(input.entries) ? input.entries : [];
  if (!entries.length) throw new FinanceError('VALIDATION_ERROR', 'Loan schedule needs at least one entry', { field: 'entries' });
  const sequences = new Set();
  const normalizedEntries = entries.map((entry) => {
    const sequence = integer(entry.sequence, 'sequence');
    if (sequences.has(sequence)) throw new FinanceError('IDENTITY_CONFLICT', `Duplicate loan schedule sequence: ${sequence}`, { status: 409 });
    sequences.add(sequence);
    const principal = nonNegativeMinor(entry.principal_minor, 'principal_minor');
    const interest = nonNegativeMinor(entry.interest_minor || '0', 'interest_minor');
    const fee = nonNegativeMinor(entry.fee_minor || '0', 'fee_minor');
    const total = nonNegativeMinor(entry.total_minor, 'total_minor');
    if (total !== principal + interest + fee) throw new FinanceError('VALIDATION_ERROR', 'Loan schedule components must equal total_minor');
    return { ...entry, sequence, principal, interest, fee, total };
  });
  return { authority, entries: normalizedEntries };
}

function loanAllocationTerms(input) {
  const principal = nonNegativeMinor(input.principal_minor, 'principal_minor');
  const interest = nonNegativeMinor(input.interest_minor || '0', 'interest_minor');
  const fee = nonNegativeMinor(input.fee_minor || '0', 'fee_minor');
  return { principal, interest, fee, total: principal + interest + fee };
}

function enforceCandidateCommitment(authority, status, review) {
  if (['ai_researched', 'ai_inferred', 'estimated'].includes(authority) && (status !== 'provisional' || review !== 'needs_review')) {
    throw new FinanceError('REVIEW_REQUIRED', 'AI or estimated commitment patterns must remain provisional and need review', { status: 409 });
  }
}

function preflightObligationPayload(context, input) {
  object(input, context);
  if (context === 'credit_card_installments') installmentTerms(input);
  if (context === 'loan_schedules') loanScheduleTerms(input);
  if (context === 'loan_allocations') loanAllocationTerms(input);
  if (context === 'commitments') {
    const authority = enumValue(input.authority, 'authority', 'authority');
    const status = enumValue(input.status, 'obligation_status', 'status', 'scheduled');
    const review = enumValue(input.review_state, 'review_state', 'review_state', 'needs_review');
    enforceCandidateCommitment(authority, status, review);
  }
}

function object(value, label = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FinanceError('VALIDATION_ERROR', `${label} must be an object`);
  }
  return value;
}

function integer(value, field, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new FinanceError('VALIDATION_ERROR', `${field} must be an integer between ${minimum} and ${maximum}`, { field });
  }
  return number;
}

function decimal(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(text)) {
    throw new FinanceError('VALIDATION_ERROR', `${field} must be a non-negative decimal string`, { field });
  }
  return text;
}

function account(db, key, kinds) {
  const row = requireRow(db.prepare('SELECT * FROM accounts WHERE account_key=?').get(key), 'Account');
  if (kinds && !kinds.includes(row.account_kind)) {
    throw new FinanceError('VALIDATION_ERROR', `Account kind must be ${kinds.join(' or ')}`, { field: 'account_key' });
  }
  return row;
}

function source(db, key, required = false) {
  if (!key && !required) return null;
  return requireRow(db.prepare('SELECT * FROM sources WHERE source_key=?').get(key), 'Source');
}

function transaction(db, key) {
  return requireRow(db.prepare('SELECT * FROM transactions WHERE transaction_key=?').get(key), 'Transaction');
}

function actorLog(db, type, key, action, after, actor) {
  logChange(db, {
    resourceType: type,
    resourceKey: key,
    action,
    after,
    actorType: actor.type,
    actorNote: actor.note,
  });
}

function cardProfile(db, key) {
  return requireRow(db.prepare("SELECT * FROM credit_card_profiles WHERE profile_key=? AND record_status NOT IN ('reversed','superseded','archived')").get(key), 'Credit-card profile');
}

function cardProjection() {
  return `SELECT p.*,a.account_key,a.display_name,e.entity_key
    FROM credit_card_profiles p JOIN accounts a ON a.id=p.account_id
    JOIN reporting_entities e ON e.id=a.entity_id`;
}

function hydrateStatement(statement, db) {
  return {
    ...statement,
    items: db.prepare(`SELECT i.item_role,t.transaction_key,t.name,t.transaction_date,
      CAST(t.amount_minor AS TEXT) AS amount_minor
      FROM credit_card_statement_items i JOIN transactions t ON t.id=i.transaction_id
      WHERE i.statement_id=? ORDER BY t.transaction_date,t.id`).all(statement.id),
    payment_matches: db.prepare(`SELECT m.*,t.transaction_key,t.transaction_date,t.name,
      CAST(t.amount_minor AS TEXT) AS transaction_amount_minor,
      CAST(m.amount_minor AS TEXT) AS amount_minor
      FROM credit_card_payment_matches m JOIN transactions t ON t.id=m.transaction_id
      WHERE m.statement_id=? AND m.record_status NOT IN ('reversed','superseded','archived') ORDER BY t.transaction_date,t.id`).all(statement.id),
  };
}

function hydrateCard(profile, db) {
  const statements = db.prepare(`SELECT s.*,src.source_key,
      CAST(s.statement_balance_minor AS TEXT) AS statement_balance_minor,
      CAST(s.minimum_due_minor AS TEXT) AS minimum_due_minor,
      CAST(s.full_due_minor AS TEXT) AS full_due_minor
    FROM credit_card_statements s JOIN sources src ON src.id=s.source_id
    WHERE s.profile_id=? AND s.record_status NOT IN ('reversed','superseded','archived') ORDER BY s.close_date DESC`).all(profile.id).map((row) => hydrateStatement(row, db));
  const installments = db.prepare(`SELECT p.*,t.transaction_key AS originating_transaction_key,
      CAST(p.financed_principal_minor AS TEXT) AS financed_principal_minor,
      CAST(p.fee_minor AS TEXT) AS fee_minor
    FROM credit_card_installment_plans p JOIN transactions t ON t.id=p.originating_transaction_id
    WHERE p.profile_id=? AND p.record_status NOT IN ('reversed','superseded','archived') ORDER BY p.start_date DESC`).all(profile.id).map((plan) => ({
      ...plan,
      entries: db.prepare(`SELECT *,CAST(principal_minor AS TEXT) AS principal_minor,
        CAST(interest_minor AS TEXT) AS interest_minor,CAST(fee_minor AS TEXT) AS fee_minor,
        CAST(total_minor AS TEXT) AS total_minor
        FROM credit_card_installment_entries WHERE plan_id=? ORDER BY sequence`).all(plan.id),
    }));
  return { ...profile, statements, installments };
}

function listCreditCards(db = getDb()) {
  return db.prepare(`${cardProjection()} WHERE p.record_status NOT IN ('reversed','superseded','archived') ORDER BY a.display_name`).all().map((profile) => hydrateCard(profile, db));
}

function getCreditCard(key, db = getDb()) {
  return hydrateCard(requireRow(db.prepare(`${cardProjection()} WHERE p.profile_key=? AND p.record_status NOT IN ('reversed','superseded','archived')`).get(key), 'Credit-card profile'), db);
}

function normalizeCardProfile(input, db, before = null) {
  const card = account(db, input.account_key || before?.account_key, ['credit_card']);
  return {
    card,
    closeDay: input.statement_close_day == null ? null : integer(input.statement_close_day, 'statement_close_day', 1, 31),
    dueDay: input.payment_due_day == null ? null : integer(input.payment_due_day, 'payment_due_day', 1, 31),
    limit: input.credit_limit_minor == null ? null : moneyMinor(input.credit_limit_minor),
    currency: currency(input.currency || before?.currency),
    authority: enumValue(input.authority, 'authority', 'authority', before?.authority),
    review: enumValue(input.review_state, 'review_state', 'review_state', before?.review_state || 'needs_review'),
  };
}

function createCreditCardProfile(input, actor = {}, db = getDb()) {
  object(input);
  const value = normalizeCardProfile(input, db);
  const key = stableKey();
  return withTransaction(db, () => {
    try {
      db.prepare(`INSERT INTO credit_card_profiles(profile_key,account_id,statement_close_day,payment_due_day,
        credit_limit_minor,currency,authority,review_state) VALUES(?,?,?,?,?,?,?,?)`).run(
        key, value.card.id, value.closeDay, value.dueDay, value.limit,
        value.currency, value.authority, value.review,
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        throw new FinanceError('DUPLICATE', 'Credit-card profile already exists', { status: 409 });
      }
      throw error;
    }
    const row = getCreditCard(key, db);
    actorLog(db, 'credit_card_profile', key, 'create', row, actor);
    return row;
  });
}

function updateCreditCardProfile(key, input, actor = {}, db = getDb()) {
  object(input);
  return withTransaction(db, () => {
    const before = getCreditCard(key, db);
    assertVersion(before, expectedVersion(input.expected_version));
    const value = normalizeCardProfile(input, db, before);
    db.prepare(`UPDATE credit_card_profiles SET account_id=?,statement_close_day=?,payment_due_day=?,
      credit_limit_minor=?,currency=?,authority=?,review_state=?,version=version+1,updated_at=CURRENT_TIMESTAMP
      WHERE profile_key=?`).run(value.card.id, value.closeDay, value.dueDay, value.limit, value.currency, value.authority, value.review, key);
    const after = getCreditCard(key, db);
    logChange(db, { resourceType: 'credit_card_profile', resourceKey: key, action: 'update', before, after, actorType: actor.type, actorNote: actor.note });
    return after;
  });
}

function createCardStatement(input, actor = {}, db = getDb()) {
  object(input);
  const profile = cardProfile(db, input.profile_key);
  const evidence = source(db, input.source_key, true);
  const key = stableKey();
  const items = Array.isArray(input.items) ? input.items : [];
  return withTransaction(db, () => {
    const result = db.prepare(`INSERT INTO credit_card_statements(statement_key,profile_id,source_id,
      period_start,period_end,close_date,due_date,statement_balance_minor,minimum_due_minor,full_due_minor,
      currency,authority,review_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        key, profile.id, evidence.id, isoDate(input.period_start, 'period_start'), isoDate(input.period_end, 'period_end'),
        isoDate(input.close_date, 'close_date'), isoDate(input.due_date, 'due_date'), moneyMinor(input.statement_balance_minor),
        input.minimum_due_minor == null ? null : moneyMinor(input.minimum_due_minor),
        input.full_due_minor == null ? null : moneyMinor(input.full_due_minor), currency(input.currency),
        enumValue(input.authority, 'authority', 'authority'), enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'),
      );
    const statementId = Number(result.lastInsertRowid);
    const insert = db.prepare('INSERT INTO credit_card_statement_items(statement_id,transaction_id,item_role) VALUES(?,?,?)');
    for (const item of items) {
      const tx = transaction(db, item.transaction_key);
      if (tx.account_id !== profile.account_id) {
        throw new FinanceError('IDENTITY_CONFLICT', 'Statement item belongs to another account', { status: 409 });
      }
      const role = requiredString(item.item_role, 'item_role', 40);
      if (!['charge', 'refund', 'fee', 'interest'].includes(role)) {
        throw new FinanceError('VALIDATION_ERROR', 'Unsupported statement item role', { field: 'item_role' });
      }
      insert.run(statementId, tx.id, role);
    }
    const row = hydrateStatement(db.prepare('SELECT * FROM credit_card_statements WHERE id=?').get(statementId), db);
    actorLog(db, 'credit_card_statement', key, 'create', row, actor);
    return row;
  });
}

function createCardPaymentMatch(input, actor = {}, db = getDb()) {
  object(input);
  const statement = requireRow(db.prepare(`SELECT s.*,a.entity_id FROM credit_card_statements s
    JOIN credit_card_profiles p ON p.id=s.profile_id JOIN accounts a ON a.id=p.account_id
    WHERE s.statement_key=? AND s.record_status NOT IN ('reversed','superseded','archived')
      AND p.record_status NOT IN ('reversed','superseded','archived')`).get(input.statement_key), 'Credit-card statement');
  const tx = transaction(db, input.transaction_key);
  const cashAmount = activeOutflow(tx);
  const cashAccount = requireRow(db.prepare('SELECT entity_id FROM accounts WHERE id=?').get(tx.account_id), 'Cash account');
  if (cashAccount.entity_id !== statement.entity_id) throw new FinanceError('REVIEW_REQUIRED', 'Cross-entity card payment matching requires owner review', { status: 409 });
  if (tx.currency !== statement.currency) throw new FinanceError('VALIDATION_ERROR', 'Card payment and statement currency must match', { field: 'transaction_key' });
  const amount = moneyMinor(input.amount_minor);
  if (amount <= 0n) throw new FinanceError('VALIDATION_ERROR', 'amount_minor must be a positive allocation', { field: 'amount_minor' });
  const allocatedCash = BigInt(db.prepare("SELECT COALESCE(SUM(amount_minor),0) total FROM credit_card_payment_matches WHERE transaction_id=? AND record_status NOT IN ('reversed','superseded','archived')").get(tx.id).total);
  if (allocatedCash + amount > cashAmount) {
    throw new FinanceError('VALIDATION_ERROR', 'Payment allocation exceeds the cash transaction amount', { field: 'amount_minor' });
  }
  const existing = db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS total FROM credit_card_payment_matches WHERE statement_id=? AND record_status NOT IN ('reversed','superseded','archived')").get(statement.id);
  const afterTotal = BigInt(existing.total) + amount;
  const due = moneyMinor(statement.full_due_minor ?? statement.statement_balance_minor);
  const dueAmount = due < 0n ? -due : due;
  if (afterTotal > dueAmount) throw new FinanceError('VALIDATION_ERROR', 'Payment allocation exceeds the statement amount due', { field: 'amount_minor' });
  const status = afterTotal === dueAmount ? 'settled' : 'partial';
  const key = stableKey();
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO credit_card_payment_matches(match_key,statement_id,transaction_id,amount_minor,
      match_status,authority,review_state) VALUES(?,?,?,?,?,?,?)`).run(
        key, statement.id, tx.id, amount, status,
        enumValue(input.authority, 'authority', 'authority'),
        enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'),
      );
    const row = db.prepare(`SELECT *,CAST(amount_minor AS TEXT) AS amount_minor
      FROM credit_card_payment_matches WHERE match_key=?`).get(key);
    actorLog(db, 'credit_card_payment_match', key, 'create', row, actor);
    return row;
  });
}

function createInstallmentPlan(input, actor = {}, db = getDb()) {
  object(input);
  const profile = cardProfile(db, input.profile_key);
  const origin = transaction(db, input.originating_transaction_key);
  if (origin.account_id !== profile.account_id) {
    throw new FinanceError('IDENTITY_CONFLICT', 'Installment origin belongs to another account', { status: 409 });
  }
  const evidence = source(db, input.source_key);
  const terms = installmentTerms(input);
  const originAmount = activeOutflow(origin, 'originating_transaction_key');
  if (origin.currency !== currency(input.currency)) throw new FinanceError('VALIDATION_ERROR', 'Installment and origin currency must match', { field: 'currency' });
  if (terms.principal > originAmount) throw new FinanceError('VALIDATION_ERROR', 'Financed principal cannot exceed the originating charge', { field: 'financed_principal_minor' });
  const key = stableKey();
  return withTransaction(db, () => {
    const result = db.prepare(`INSERT INTO credit_card_installment_plans(plan_key,profile_id,
      originating_transaction_id,source_id,financed_principal_minor,installment_count,start_date,apr_decimal,
      fee_minor,currency,authority,review_state,reconciliation_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        key, profile.id, origin.id, evidence?.id || null, terms.principal, terms.count, isoDate(input.start_date, 'start_date'),
        decimal(input.apr_decimal, 'apr_decimal'), moneyMinor(input.fee_minor || '0'), currency(input.currency),
        enumValue(input.authority, 'authority', 'authority'),
        enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'), terms.status,
      );
    const planId = Number(result.lastInsertRowid);
    const insert = db.prepare(`INSERT INTO credit_card_installment_entries(entry_key,plan_id,sequence,
      due_date,principal_minor,interest_minor,fee_minor,total_minor,entry_status) VALUES(?,?,?,?,?,?,?,?,?)`);
    for (const entry of terms.entries) {
      insert.run(stableKey(), planId, entry.sequence, isoDate(entry.due_date, 'due_date'),
        entry.principal, entry.interest, entry.fee, entry.total, entry.entry_status || 'scheduled');
    }
    const row = getCreditCard(profile.profile_key, db).installments.find((plan) => plan.plan_key === key);
    actorLog(db, 'credit_card_installment_plan', key, 'create', row, actor);
    return row;
  });
}

function liabilityProjection() {
  return `SELECT l.*,a.account_key,a.display_name,e.entity_key,s.source_key
    FROM liability_profiles l JOIN accounts a ON a.id=l.account_id
    JOIN reporting_entities e ON e.id=a.entity_id LEFT JOIN sources s ON s.id=l.source_id`;
}

function hydrateLiability(profile, db) {
  return {
    ...profile,
    schedule: db.prepare(`SELECT *,CAST(principal_minor AS TEXT) AS principal_minor,
      CAST(interest_minor AS TEXT) AS interest_minor,CAST(fee_minor AS TEXT) AS fee_minor,
      CAST(total_minor AS TEXT) AS total_minor FROM loan_schedule_entries
      WHERE liability_id=? AND record_status NOT IN ('reversed','superseded','archived') ORDER BY sequence`).all(profile.id),
  };
}

function listLiabilities(db = getDb()) {
  return db.prepare(`${liabilityProjection()} WHERE l.record_status NOT IN ('reversed','superseded','archived') ORDER BY a.display_name`).all().map((profile) => hydrateLiability(profile, db));
}

function getLiability(key, db = getDb()) {
  return hydrateLiability(requireRow(db.prepare(`${liabilityProjection()} WHERE l.liability_key=? AND l.record_status NOT IN ('reversed','superseded','archived')`).get(key), 'Liability'), db);
}

function createLiability(input, actor = {}, db = getDb()) {
  object(input);
  const loan = account(db, input.account_key, ['loan', 'payable']);
  const evidence = source(db, input.source_key);
  const key = stableKey();
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO liability_profiles(liability_key,account_id,source_id,liability_kind,
      original_principal_minor,currency,rate_type,apr_decimal,apr_as_of,start_date,maturity_date,
      payment_frequency,authority,review_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        key, loan.id, evidence?.id || null, requiredString(input.liability_kind, 'liability_kind', 60),
        moneyMinor(input.original_principal_minor), currency(input.currency),
        enumValue(input.rate_type, 'rate_type', 'rate_type'), decimal(input.apr_decimal, 'apr_decimal'),
        input.apr_as_of ? isoDate(input.apr_as_of, 'apr_as_of') : null, isoDate(input.start_date, 'start_date'),
        input.maturity_date ? isoDate(input.maturity_date, 'maturity_date') : null,
        enumValue(input.payment_frequency, 'payment_frequency', 'payment_frequency'),
        enumValue(input.authority, 'authority', 'authority'),
        enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'),
      );
    const row = getLiability(key, db);
    actorLog(db, 'liability_profile', key, 'create', row, actor);
    return row;
  });
}

function createLoanSchedule(key, input, actor = {}, db = getDb()) {
  object(input);
  const liability = requireRow(db.prepare("SELECT * FROM liability_profiles WHERE liability_key=? AND record_status NOT IN ('reversed','superseded','archived')").get(key), 'Liability');
  const terms = loanScheduleTerms(input);
  const evidence = source(db, input.source_key, true);
  return withTransaction(db, () => {
    const insert = db.prepare(`INSERT INTO loan_schedule_entries(schedule_key,liability_id,source_id,
      sequence,due_date,principal_minor,interest_minor,fee_minor,total_minor,entry_status,authority,review_state)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    const keys = [];
    for (const entry of terms.entries) {
      const scheduleKey = stableKey();
      insert.run(scheduleKey, liability.id, evidence.id, entry.sequence,
        isoDate(entry.due_date, 'due_date'), entry.principal, entry.interest, entry.fee, entry.total, entry.entry_status || 'scheduled',
        terms.authority, enumValue(input.review_state, 'review_state', 'review_state', 'confirmed'));
      keys.push(scheduleKey);
    }
    actorLog(db, 'liability_schedule', key, 'create', { entries: keys }, actor);
    return { ...getLiability(key, db), created_schedule_keys: keys };
  });
}

function createLoanAllocation(input, actor = {}, db = getDb()) {
  object(input);
  const schedule = requireRow(db.prepare(`SELECT s.*,l.currency,a.entity_id FROM loan_schedule_entries s
    JOIN liability_profiles l ON l.id=s.liability_id JOIN accounts a ON a.id=l.account_id
    WHERE s.schedule_key=? AND s.record_status NOT IN ('reversed','superseded','archived')
      AND l.record_status NOT IN ('reversed','superseded','archived')`).get(input.schedule_key), 'Schedule entry');
  const tx = transaction(db, input.transaction_key);
  const cash = activeOutflow(tx);
  const cashAccount = requireRow(db.prepare('SELECT entity_id FROM accounts WHERE id=?').get(tx.account_id), 'Cash account');
  if (cashAccount.entity_id !== schedule.entity_id) throw new FinanceError('REVIEW_REQUIRED', 'Cross-entity loan allocation requires owner review', { status: 409 });
  if (tx.currency !== schedule.currency) throw new FinanceError('VALIDATION_ERROR', 'Loan payment and liability currency must match', { field: 'transaction_key' });
  const terms = loanAllocationTerms(input);
  const cashAllocated = BigInt(db.prepare("SELECT COALESCE(SUM(total_minor),0) total FROM loan_payment_allocations WHERE transaction_id=? AND record_status NOT IN ('reversed','superseded','archived')").get(tx.id).total);
  if (cashAllocated + terms.total > cash) throw new FinanceError('VALIDATION_ERROR', 'Loan allocation exceeds the cash transaction amount', { field: 'transaction_key' });
  const allocated = db.prepare(`SELECT COALESCE(SUM(principal_minor),0) principal,COALESCE(SUM(interest_minor),0) interest,
    COALESCE(SUM(fee_minor),0) fee FROM loan_payment_allocations WHERE schedule_entry_id=? AND record_status NOT IN ('reversed','superseded','archived')`).get(schedule.id);
  if (BigInt(allocated.principal) + terms.principal > BigInt(schedule.principal_minor)
    || BigInt(allocated.interest) + terms.interest > BigInt(schedule.interest_minor)
    || BigInt(allocated.fee) + terms.fee > BigInt(schedule.fee_minor)) {
    throw new FinanceError('VALIDATION_ERROR', 'Loan allocation exceeds the schedule components', { field: 'schedule_key' });
  }
  const status = cashAllocated + terms.total === cash ? 'reconciled' : 'unreconciled';
  const key = stableKey();
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO loan_payment_allocations(allocation_key,schedule_entry_id,transaction_id,
      principal_minor,interest_minor,fee_minor,total_minor,reconciliation_status,authority,review_state)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        key, schedule.id, tx.id, terms.principal, terms.interest, terms.fee, terms.total, status,
        enumValue(input.authority, 'authority', 'authority'),
        enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'),
      );
    const row = db.prepare(`SELECT *,CAST(principal_minor AS TEXT) AS principal_minor,
      CAST(interest_minor AS TEXT) AS interest_minor,CAST(fee_minor AS TEXT) AS fee_minor,
      CAST(total_minor AS TEXT) AS total_minor FROM loan_payment_allocations WHERE allocation_key=?`).get(key);
    actorLog(db, 'loan_payment_allocation', key, 'create', row, actor);
    return row;
  });
}

function listCommitments(db = getDb()) {
  return db.prepare(`SELECT c.*,e.entity_key,a.account_key FROM commitment_templates c
    JOIN reporting_entities e ON e.id=c.entity_id LEFT JOIN accounts a ON a.id=c.account_id
    WHERE c.record_status NOT IN ('reversed','superseded','archived') ORDER BY c.status,c.next_due_date`).all().map((item) => ({
      ...item,
      occurrences: db.prepare(`SELECT *,CAST(amount_minor AS TEXT) AS amount_minor
        FROM commitment_occurrences WHERE commitment_id=? AND record_status NOT IN ('reversed','superseded','archived') ORDER BY due_date`).all(item.id),
    }));
}

function getCommitment(key, db = getDb()) {
  return requireRow(listCommitments(db).find((item) => item.commitment_key === key), 'Commitment');
}

function commitmentValue(input, db, before = null) {
  const entity = requireRow(db.prepare('SELECT * FROM reporting_entities WHERE entity_key=?').get(input.entity_key || before?.entity_key || 'personal'), 'Entity');
  const target = input.account_key ? account(db, input.account_key) : null;
  const amountKind = enumValue(input.amount_kind, 'amount_kind', 'amount_kind');
  const minimum = amountKind === 'range' ? moneyMinor(input.amount_min_minor) : null;
  const maximum = amountKind === 'range' ? moneyMinor(input.amount_max_minor) : null;
  if (minimum !== null && maximum !== null && minimum > maximum) {
    throw new FinanceError('VALIDATION_ERROR', 'amount_min_minor cannot exceed amount_max_minor');
  }
  const direction = input.direction;
  if (!['in', 'out'].includes(direction)) throw new FinanceError('VALIDATION_ERROR', 'direction must be in or out');
  const value = {
    entity,
    target,
    kind: requiredString(input.commitment_kind, 'commitment_kind', 60),
    direction,
    amountKind,
    amount: amountKind === 'fixed' ? moneyMinor(input.amount_minor) : null,
    min: minimum,
    max: maximum,
    currency: currency(input.currency),
    cadence: enumValue(input.cadence, 'cadence', 'cadence'),
    start: isoDate(input.start_date, 'start_date'),
    end: input.end_date ? isoDate(input.end_date, 'end_date') : null,
    next: input.next_due_date ? isoDate(input.next_due_date, 'next_due_date') : null,
    status: enumValue(input.status, 'obligation_status', 'status', 'scheduled'),
    authority: enumValue(input.authority, 'authority', 'authority'),
    review: enumValue(input.review_state, 'review_state', 'review_state', 'needs_review'),
  };
  enforceCandidateCommitment(value.authority, value.status, value.review);
  return value;
}

function createCommitment(input, actor = {}, db = getDb()) {
  object(input);
  const value = commitmentValue(input, db);
  const key = stableKey();
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO commitment_templates(commitment_key,entity_id,account_id,commitment_kind,
      direction,amount_kind,amount_minor,amount_min_minor,amount_max_minor,currency,cadence,start_date,
      end_date,next_due_date,status,authority,review_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        key, value.entity.id, value.target?.id || null, value.kind, value.direction, value.amountKind,
        value.amount, value.min, value.max, value.currency, value.cadence, value.start, value.end, value.next,
        value.status, value.authority, value.review,
      );
    const row = getCommitment(key, db);
    if (row.status === 'provisional') {
      createReviewTask({
        task_kind: 'commitment_candidate',
        resource_type: 'commitment',
        resource_key: key,
        priority: 60,
        reason: 'Confirm or reject the provisional recurring commitment candidate',
      }, db);
    }
    actorLog(db, 'commitment', key, 'create', row, actor);
    return row;
  });
}

function updateCommitment(key, input, actor = {}, db = getDb()) {
  object(input);
  return withTransaction(db, () => {
    const before = getCommitment(key, db);
    assertVersion(before, expectedVersion(input.expected_version));
    const value = commitmentValue(input, db, before);
    db.prepare(`UPDATE commitment_templates SET entity_id=?,account_id=?,commitment_kind=?,direction=?,
      amount_kind=?,amount_minor=?,amount_min_minor=?,amount_max_minor=?,currency=?,cadence=?,start_date=?,
      end_date=?,next_due_date=?,status=?,authority=?,review_state=?,version=version+1,updated_at=CURRENT_TIMESTAMP
      WHERE commitment_key=?`).run(
        value.entity.id, value.target?.id || null, value.kind, value.direction, value.amountKind, value.amount,
        value.min, value.max, value.currency, value.cadence, value.start, value.end, value.next, value.status,
        value.authority, value.review, key,
      );
    const after = getCommitment(key, db);
    const task = db.prepare("SELECT task_key FROM review_tasks WHERE task_kind='commitment_candidate' AND resource_key=? AND status='open'").get(key);
    if (task && after.status !== 'provisional') {
      const rejected = after.status === 'cancelled' || after.review_state === 'rejected';
      resolveReviewTask(task.task_key, {
        status: rejected ? 'dismissed' : 'resolved',
        resolution_note: rejected ? 'Commitment candidate rejected through typed update.' : 'Commitment candidate confirmed through typed update.',
      }, actor, db, { typedOwner: true });
    }
    logChange(db, { resourceType: 'commitment', resourceKey: key, action: 'update', before, after, actorType: actor.type, actorNote: actor.note });
    return after;
  });
}

function createOccurrence(key, input, actor = {}, db = getDb()) {
  object(input);
  const template = requireRow(db.prepare("SELECT * FROM commitment_templates WHERE commitment_key=? AND record_status NOT IN ('reversed','superseded','archived')").get(key), 'Commitment');
  const occurrenceKey = stableKey();
  const tx = input.transaction_key ? transaction(db, input.transaction_key) : null;
  const status = enumValue(input.occurrence_status, 'obligation_status', 'occurrence_status', 'scheduled');
  if (['ai_researched', 'ai_inferred', 'estimated'].includes(template.authority) && status !== 'provisional') {
    throw new FinanceError('REVIEW_REQUIRED', 'Occurrences from an unconfirmed commitment must remain provisional', { status: 409 });
  }
  return withTransaction(db, () => {
    db.prepare(`INSERT INTO commitment_occurrences(occurrence_key,commitment_id,due_date,amount_minor,
      occurrence_status,transaction_id) VALUES(?,?,?,?,?,?)`).run(
        occurrenceKey, template.id, isoDate(input.due_date, 'due_date'),
        input.amount_minor == null ? null : moneyMinor(input.amount_minor), status, tx?.id || null,
      );
    const row = db.prepare(`SELECT *,CAST(amount_minor AS TEXT) AS amount_minor
      FROM commitment_occurrences WHERE occurrence_key=?`).get(occurrenceKey);
    actorLog(db, 'commitment_occurrence', occurrenceKey, 'create', row, actor);
    return row;
  });
}

module.exports = {
  listCreditCards,
  getCreditCard,
  createCreditCardProfile,
  updateCreditCardProfile,
  createCardStatement,
  createCardPaymentMatch,
  createInstallmentPlan,
  listLiabilities,
  getLiability,
  createLiability,
  createLoanSchedule,
  createLoanAllocation,
  listCommitments,
  getCommitment,
  createCommitment,
  updateCommitment,
  createOccurrence,
  preflightObligationPayload,
};
