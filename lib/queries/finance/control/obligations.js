const { createHash } = require('node:crypto');

const { FinanceError, currency: validateCurrency, isoDate } = require('../../../finance/contracts');
const { POLICY_VERSION, sourceWatermark } = require('../../../finance/readiness/policy');
const { getDb } = require('../common');
const { listCreditCards, listLiabilities, listCommitments } = require('../obligations');
const { projectObligations } = require('../../../finance/control/project-obligations');

const ANALYSIS_ID = 'obligation_timeline';
const FORMULA_VERSION = 'obligation-timeline/1';

function getParam(params, key) {
  if (!params) return null;
  if (typeof params.get === 'function') return params.get(key);
  return params[key] ?? null;
}

function localDate() { return new Date().toLocaleDateString('en-CA'); }
function unique(values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }
function confirmed(row) { return ['official', 'user_confirmed'].includes(row.authority) && row.review_state === 'confirmed'; }
function nonNegative(value) { return value === null || value === undefined ? null : (BigInt(value) < 0n ? '0' : BigInt(value).toString()); }
function sum(values) { return values.filter((value) => value !== null && value !== undefined).reduce((total, value) => total + BigInt(value), 0n).toString(); }

function scope(params) {
  const asOf = isoDate(getParam(params, 'as_of_date') || localDate(), 'as_of_date');
  const entityId = getParam(params, 'entity_id') || 'personal';
  const currency = validateCurrency(getParam(params, 'currency') || 'TWD');
  const horizonDays = Number(getParam(params, 'horizon_days') || 90);
  if (horizonDays !== 90) throw new FinanceError('VALIDATION_ERROR', 'horizon_days must be 90 for the obligation timeline', { field: 'horizon_days' });
  const defaultedFields = [];
  if (!getParam(params, 'as_of_date')) defaultedFields.push('as_of_date');
  if (!getParam(params, 'entity_id')) defaultedFields.push('entity_id');
  if (!getParam(params, 'currency')) defaultedFields.push('currency');
  return { asOf, entityId, currency, horizonDays, defaultedFields };
}

function pushEvent(events, event) {
  if (!event.source_fact_keys?.length) return;
  events.push({ currency: event.currency, direction: 'out', ...event });
}

function cardEvents(cards, target, events, blockers) {
  for (const card of cards.filter((item) => item.entity_key === target.entityId && item.currency === target.currency)) {
    const statements = card.statements || [];
    const statementDueDates = statements.map((statement) => statement.due_date).filter(Boolean).sort();
    for (const statement of statements) {
      const due = statement.full_due_minor ?? statement.statement_balance_minor ?? null;
      const paid = sum((statement.payment_matches || []).map((match) => match.amount_minor));
      const remaining = due === null ? null : nonNegative(BigInt(due) - BigInt(paid));
      if (!statement.due_date) {
        blockers.push({ kind: 'missing_card_due_date', resource_key: statement.statement_key, label: `${card.display_name} 缺少帳單到期日。` });
        continue;
      }
      pushEvent(events, {
        event_key: `card_statement:${statement.statement_key}`,
        kind: 'card_statement_due',
        due_date: statement.due_date,
        amount_minor: remaining,
        status: remaining === '0' ? 'settled' : ((statement.payment_matches || []).length ? 'partial' : 'scheduled'),
        reliability: confirmed(statement) && remaining !== null ? 'committed' : 'uncertain',
        display_name: card.display_name,
        source_fact_keys: [statement.statement_key, card.profile_key],
      });
    }
    const latestStatementDue = statementDueDates.at(-1) || null;
    for (const plan of card.installments || []) {
      const planConfirmed = confirmed(plan);
      for (const entry of plan.entries || []) {
        if (!entry.due_date || (latestStatementDue && entry.due_date <= latestStatementDue)) continue;
        pushEvent(events, {
          event_key: `card_installment:${entry.entry_key}`,
          kind: 'card_installment_due',
          due_date: entry.due_date,
          amount_minor: entry.total_minor ?? null,
          status: entry.entry_status || 'scheduled',
          reliability: planConfirmed && entry.total_minor !== null ? 'committed' : 'uncertain',
          display_name: card.display_name,
          source_fact_keys: [plan.plan_key, entry.entry_key],
          components_minor: { principal: entry.principal_minor, interest: entry.interest_minor, fee: entry.fee_minor },
        });
      }
      if (plan.reconciliation_status !== 'reconciled') blockers.push({ kind: 'incomplete_card_installment_schedule', resource_key: plan.plan_key, label: `${card.display_name} 的分期排程尚未完整對帳。` });
    }
    if (!statements.length && !(card.installments || []).length) blockers.push({ kind: 'missing_credit_card_schedule', resource_key: card.profile_key, label: `${card.display_name} 缺少可用帳單或分期排程。` });
  }
}

function liabilityEvents(liabilities, target, events, blockers) {
  for (const liability of liabilities.filter((item) => item.entity_key === target.entityId && item.currency === target.currency)) {
    if (!liability.schedule.length) {
      blockers.push({ kind: 'missing_loan_schedule', resource_key: liability.liability_key, label: `${liability.display_name} 缺少官方或使用者確認的還款排程。` });
      continue;
    }
    for (const entry of liability.schedule) {
      pushEvent(events, {
        event_key: `loan_schedule:${entry.schedule_key}`,
        kind: 'loan_payment',
        due_date: entry.due_date || null,
        amount_minor: entry.total_minor ?? null,
        status: entry.entry_status || 'scheduled',
        reliability: confirmed(entry) && entry.total_minor !== null ? 'committed' : 'uncertain',
        display_name: liability.display_name,
        source_fact_keys: [liability.liability_key, entry.schedule_key, liability.source_key].filter(Boolean),
        components_minor: { principal: entry.principal_minor, interest: entry.interest_minor, fee: entry.fee_minor },
      });
    }
  }
}

function commitmentEvents(commitments, target, events, blockers) {
  for (const commitment of commitments.filter((item) => item.entity_key === target.entityId && item.direction === 'out' && item.currency === target.currency)) {
    if (!confirmed(commitment)) {
      blockers.push({ kind: 'provisional_commitment_excluded', resource_key: commitment.commitment_key, label: `${commitment.commitment_kind} 尚未由 owner 確認，不納入已知義務。` });
      continue;
    }
    const occurrences = commitment.occurrences || [];
    if (occurrences.length) {
      for (const occurrence of occurrences) {
        pushEvent(events, {
          event_key: `commitment_occurrence:${occurrence.occurrence_key}`,
          kind: 'commitment_occurrence',
          due_date: occurrence.due_date || null,
          amount_minor: occurrence.amount_minor ?? null,
          amount_min_minor: occurrence.amount_minor === null ? commitment.amount_min_minor : null,
          amount_max_minor: occurrence.amount_minor === null ? commitment.amount_max_minor : null,
          status: occurrence.occurrence_status || commitment.status,
          reliability: occurrence.amount_minor === null ? 'uncertain' : 'committed',
          display_name: commitment.commitment_kind,
          source_fact_keys: [commitment.commitment_key, occurrence.occurrence_key],
        });
      }
      continue;
    }
    if (!commitment.next_due_date) {
      blockers.push({ kind: 'missing_commitment_due_date', resource_key: commitment.commitment_key, label: `${commitment.commitment_kind} 缺少下一次到期日。` });
      continue;
    }
    pushEvent(events, {
      event_key: `commitment_template:${commitment.commitment_key}:next`,
      kind: 'commitment_template',
      due_date: commitment.next_due_date,
      amount_minor: commitment.amount_kind === 'fixed' ? commitment.amount_minor : null,
      amount_min_minor: commitment.amount_min_minor,
      amount_max_minor: commitment.amount_max_minor,
      status: commitment.status,
      reliability: commitment.amount_kind === 'fixed' ? 'committed' : 'uncertain',
      display_name: commitment.commitment_kind,
      source_fact_keys: [commitment.commitment_key],
    });
  }
}

function getObligationTimeline(params, db = getDb()) {
  const target = scope(params);
  const events = [];
  const blockers = [];
  cardEvents(listCreditCards(db), target, events, blockers);
  liabilityEvents(listLiabilities(db), target, events, blockers);
  commitmentEvents(listCommitments(db), target, events, blockers);
  const projected = projectObligations({ as_of_date: target.asOf, horizon_days: target.horizonDays, currency: target.currency, events });
  const warnings = [];
  if (projected.counts.range || projected.counts.unknown) warnings.push({ kind: 'uncertain_amounts', label: '部分義務只有金額範圍或沒有金額，未被假裝成精確總額。' });
  const coverageStatus = blockers.length ? 'partial' : projected.events.length ? 'complete' : 'empty';
  const drillback = {
    event_keys: projected.events.map((event) => event.event_key),
    source_fact_keys: unique(projected.events.flatMap((event) => event.source_fact_keys)),
    blocker_resource_keys: unique(blockers.map((item) => item.resource_key)),
  };
  const semanticPayload = { target, projected, blockers, warnings, drillback };
  const semanticHash = createHash('sha256').update(JSON.stringify(semanticPayload)).digest('hex');
  return {
    schema_version: 'finance.analysis-read-model/v1',
    analysis_id: ANALYSIS_ID,
    formula_version: FORMULA_VERSION,
    scope: { entity_id: target.entityId, as_of_date: target.asOf, period_start: target.asOf, period_end: null, currency: target.currency, horizon_days: target.horizonDays, defaulted_fields: target.defaultedFields },
    coverage: { status: coverageStatus, blockers, warnings, missing_inputs: unique(blockers.map((item) => item.kind)) },
    facts: { events: projected.events, windows: projected.windows, counts: projected.counts },
    derived: { known_90_day_obligation_minor: sum(projected.events.filter((event) => event.amount_minor !== null).map((event) => event.amount_minor)), formulas: { known_90_day_obligation: 'sum of in-window events with exact amount_minor; ranges and unknowns remain separate' } },
    source_watermark: { ...sourceWatermark(db), policy_version: POLICY_VERSION, resource_keys: unique([...drillback.source_fact_keys, ...drillback.blocker_resource_keys]), semantic_hash: semanticHash, change_sequence: semanticHash.slice(0, 16) },
    drillback,
  };
}

module.exports = { ANALYSIS_ID, FORMULA_VERSION, getObligationTimeline };
