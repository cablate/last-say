const { FinanceError, assertObject, rejectUnknown, isoDate, enumValue } = require('../../finance/contracts');
const { DATASETS, MAX_DATASETS, MAX_RESPONSE_BYTES } = require('../../finance/analysis/registry');
const { POLICY_VERSION, sourceWatermark } = require('../../finance/readiness/policy');
const { activeRecordSql } = require('../../finance/active-records');
const { listAccounts } = require('./accounts');
const { latestBalanceForAccount } = require('./balances');
const { listCreditCards, listLiabilities, listCommitments } = require('./obligations');
const { investmentPositions } = require('./investments');
const { listValuedItems } = require('./valued-items');
const { listUnmatchedTransferCandidates, reconciliationSummary } = require('./reconciliation');
const { listReimbursementMatches } = require('./reimbursements');
const { proposalEnvelope } = require('../../finance/analysis/proposal-envelope');
const { getDb, requireRow } = require('./common');

function integer(value, field, fallback, max) { const number = value == null ? fallback : Number(value); if (!Number.isInteger(number) || number < 0 || number > max) throw new FinanceError('VALIDATION_ERROR', `${field} must be an integer from 0 to ${max}`, { field }); return number; }
function optionalBoolean(value, field) { if (value === undefined) return undefined; if (typeof value !== 'boolean') throw new FinanceError('VALIDATION_ERROR', `${field} must be true or false`, { field }); return value; }
function page(rows, limit, offset) { return { rows: rows.slice(offset, offset + limit), pagination: { limit, offset, returned: Math.min(limit, Math.max(0, rows.length - offset)), has_more: rows.length > offset + limit } }; }
function provenance(db, watermarks = []) { return { policy_version: POLICY_VERSION, source_watermark: sourceWatermark(db), resource_watermarks: watermarks }; }

function validateSpec(spec) {
  assertObject(spec, 'dataset'); const name = spec.name;
  if (!Object.hasOwn(DATASETS, name)) throw new FinanceError('UNKNOWN_SCHEMA', `Unknown analysis dataset: ${String(name || '')}`, { status: 400, field: 'name', allowedValues: Object.keys(DATASETS) });
  const definition = DATASETS[name]; rejectUnknown(spec, ['name', ...definition.filters]);
  const limit = integer(spec.limit, 'limit', Math.min(100, definition.max_limit), definition.max_limit); const offset = integer(spec.offset, 'offset', 0, 10000);
  return { ...spec, name, limit, offset };
}

function cashActivity(spec, entity, asOfDate, db) {
  const from = isoDate(spec.from || `${asOfDate.slice(0,4)}-01-01`, 'from'); const to = isoDate(spec.to || asOfDate, 'to'); if (from > to) throw new FinanceError('VALIDATION_ERROR', 'from must not be after to', { field: 'from' });
  const group = spec.group_by || 'none'; if (!DATASETS.cash_activity.group_by.includes(group)) throw new FinanceError('VALIDATION_ERROR', 'Unsupported cash_activity grouping', { field: 'group_by', allowedValues: DATASETS.cash_activity.group_by });
  if (spec.direction && !['in','out'].includes(spec.direction)) throw new FinanceError('VALIDATION_ERROR', 'direction must be in or out', { field: 'direction' });
  // Pre-foundation accounts have no entity metadata; they belong to the
  // legacy personal ledger until a human maps them to a typed account.
  const where = [`(e.entity_key=? OR (e.id IS NULL AND ?='personal'))`, `t.transaction_date>=?`, `t.transaction_date<=?`, activeRecordSql('t')]; const params = [entity, entity, from, to];
  if (spec.account_key) { where.push('a.account_key=?'); params.push(spec.account_key); }
  if (spec.direction === 'in') where.push('t.amount_minor>0'); if (spec.direction === 'out') where.push('t.amount_minor<0');
  if (group === 'month') {
    const rows = db.prepare(`SELECT t.transaction_month AS month,CAST(SUM(t.inflow_minor) AS TEXT) inflow_minor,CAST(SUM(t.outflow_minor) AS TEXT) outflow_minor,CAST(SUM(t.amount_minor) AS TEXT) net_minor,COUNT(*) transaction_count FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN reporting_entities e ON e.id=a.entity_id WHERE ${where.join(' AND ')} GROUP BY t.transaction_month ORDER BY t.transaction_month`).all(...params);
    if (rows.length > 120) throw new FinanceError('VALIDATION_ERROR', 'cash_activity aggregation exceeds 120 groups', { field: 'from' }); const result = page(rows, spec.limit, spec.offset); return { ...result, provenance: provenance(db, rows.map((row) => row.month)) };
  }
  const rows = db.prepare(`SELECT t.transaction_key,t.transaction_date,t.name,CAST(t.amount_minor AS TEXT) amount_minor,t.currency,t.flow_type,t.category_primary,t.category_sub,t.classification_source,t.reviewed,a.account_key,s.source_key FROM transactions t LEFT JOIN accounts a ON a.id=t.account_id LEFT JOIN reporting_entities e ON e.id=a.entity_id LEFT JOIN sources s ON s.id=t.first_source_id WHERE ${where.join(' AND ')} ORDER BY t.transaction_date DESC,t.id DESC LIMIT ? OFFSET ?`).all(...params, spec.limit + 1, spec.offset);
  return { rows: rows.slice(0, spec.limit), pagination: { limit: spec.limit, offset: spec.offset, returned: Math.min(rows.length, spec.limit), has_more: rows.length > spec.limit }, provenance: provenance(db, rows.slice(0, spec.limit).map((row) => row.transaction_key)) };
}

function accountBalances(spec, entity, asOfDate, db) {
  optionalBoolean(spec.freshness, 'freshness');
  let rows = listAccounts({ entity_key: entity, active: true }, db).filter((account) => !spec.account_key || account.account_key === spec.account_key).map((account) => ({ account_key: account.account_key, display_name: account.display_name, account_kind: account.account_kind, currency: account.currency, balance: latestBalanceForAccount(account.account_key, { asOfDate }, db) }));
  if (spec.freshness === true) rows = rows.map((row) => ({ ...row, freshness: { status: row.balance.status, age_days: row.balance.age_days ?? null, stale_after_days: row.balance.stale_after_days ?? null } }));
  const result = page(rows, spec.limit, spec.offset); return { ...result, provenance: provenance(db, result.rows.flatMap((row) => row.balance.selected ? [row.balance.selected.snapshot_key, row.balance.selected.source_key].filter(Boolean) : [])) };
}

function debtObligations(spec, entity, db) { const rows = [...listCreditCards(db).filter((item) => item.entity_key === entity && (!spec.account_key || item.account_key === spec.account_key)).map((item) => ({ context: 'credit_card', ...item })), ...listLiabilities(db).filter((item) => item.entity_key === entity && (!spec.account_key || item.account_key === spec.account_key)).map((item) => ({ context: 'liability', ...item }))]; const result = page(rows, spec.limit, spec.offset); return { ...result, provenance: provenance(db, result.rows.map((row) => row.profile_key || row.liability_key)) }; }
function investments(spec, entity, asOfDate, baseCurrency, db) { if (spec.valuation && spec.valuation !== 'latest_available') throw new FinanceError('VALIDATION_ERROR', 'valuation must be latest_available', { field: 'valuation' }); const rows = investmentPositions({ entityKey: entity, asOfDate, baseCurrency }, db).filter((row) => !spec.account_key || row.account_key === spec.account_key); const result = page(rows, spec.limit, spec.offset); return { ...result, provenance: provenance(db, result.rows.flatMap((row) => Object.values(row.watermark || {}).filter(Boolean))) }; }
function valued(spec, entity, asOfDate, db) { const itemType = spec.item_type ? enumValue(spec.item_type, 'valued_item_type', 'item_type') : null; const rows = listValuedItems({ entityKey: entity, asOfDate }, db).filter((row) => !itemType || row.item_type === itemType); const result = page(rows, spec.limit, spec.offset); return { ...result, provenance: provenance(db, result.rows.flatMap((row) => [row.item_key, row.latest_valuation?.valuation_key].filter(Boolean))) }; }

function candidateResult(rows, spec, db) {
  const result = page(rows, spec.limit, spec.offset);
  return { ...result, provenance: provenance(db, result.rows.flatMap((row) => row.proposal?.evidence?.resource_keys || [])) };
}

function transferCandidates(spec, entity, db) {
  const rows = listUnmatchedTransferCandidates(db).filter((row) => (!spec.account_key || row.account_key === spec.account_key) && (!spec.direction || row.direction === spec.direction)).map((row) => ({ ...row, proposal: proposalEnvelope({ kind: 'transfer_match_candidate', owner: 'transfer_matches', action: 'create_transfer_match', resourceKeys: [row.transaction_key], timelines: ['cash_settlement'], impact: 'May eliminate an own-account cash movement only after both legs are proven.', missingEvidence: ['opposite_cash_leg', 'owned_account_identity'] }) }));
  return candidateResult(rows, spec, db);
}

function reimbursementCandidates(spec, entity, db) {
  if (spec.status && !['proposed','confirmed','rejected'].includes(spec.status)) throw new FinanceError('VALIDATION_ERROR', 'Unsupported reimbursement candidate status', { field: 'status' });
  const rows = listReimbursementMatches({ status: spec.status || 'proposed' }, db).filter((row) => row.entity_key === entity).map((row) => ({ ...row, proposal: proposalEnvelope({ kind: 'reimbursement_match_candidate', owner: 'reimbursement_matches', action: 'resolve_reimbursement_match', resourceKeys: [row.match_key, row.reimbursement_transaction_key, ...row.items.map((item) => item.expense_transaction_key)], timelines: ['economic_recognition','cash_settlement'], impact: 'Explains gross expense recovery without rewriting either cash fact.', missingEvidence: row.match_status === 'proposed' ? ['owner_allocation_confirmation'] : [] }) }));
  return candidateResult(rows, spec, db);
}

function recurringCandidates(spec, entity, db) {
  if (spec.direction && !['in','out'].includes(spec.direction)) throw new FinanceError('VALIDATION_ERROR', 'direction must be in or out', { field: 'direction' });
  const rows = listCommitments(db).filter((row) => row.entity_key === entity && row.status === 'provisional' && (!spec.direction || row.direction === spec.direction)).map((row) => ({ ...row, proposal: proposalEnvelope({ kind: 'recurring_commitment_candidate', owner: 'commitment_templates', action: 'review_commitment', resourceKeys: [row.commitment_key], timelines: ['obligation_due'], impact: 'Would add a future obligation pattern only after owner confirmation.', missingEvidence: ['owner_cadence_and_amount_confirmation'] }) }));
  return candidateResult(rows, spec, db);
}

function installmentAnomalies(spec, entity, db) {
  const rows = listCreditCards(db).filter((card) => card.entity_key === entity && (!spec.account_key || card.account_key === spec.account_key)).flatMap((card) => card.installments.filter((plan) => plan.reconciliation_status !== 'reconciled' || plan.entries.length !== plan.installment_count).map((plan) => ({ profile_key: card.profile_key, account_key: card.account_key, plan, proposal: proposalEnvelope({ kind: 'installment_anomaly', owner: 'credit_card_installment_plans', action: 'request_installment_evidence', resourceKeys: [card.profile_key, plan.plan_key], timelines: ['obligation_due'], impact: 'Schedule cannot be treated as complete.', missingEvidence: ['complete_installment_schedule'], reversible: false }) })));
  return candidateResult(rows, spec, db);
}

function statementBlockers(spec, entity, db) {
  const rows = listCreditCards(db).filter((card) => card.entity_key === entity && (!spec.account_key || card.account_key === spec.account_key)).flatMap((card) => {
    if (!card.statements.length) return [{ profile_key: card.profile_key, account_key: card.account_key, blocker: 'missing_credit_card_statement' }];
    return card.statements.filter((statement) => statement.payment_matches.reduce((sum, match) => sum + BigInt(match.amount_minor), 0n) < BigInt(statement.full_due_minor || statement.statement_balance_minor || 0)).map((statement) => ({ profile_key: card.profile_key, account_key: card.account_key, statement_key: statement.statement_key, blocker: 'statement_payment_not_fully_matched' }));
  }).map((row) => ({ ...row, proposal: proposalEnvelope({ kind: 'statement_blocker', owner: 'credit_card_statements', action: 'request_statement_or_payment_evidence', resourceKeys: [row.profile_key, row.statement_key].filter(Boolean), timelines: ['cash_settlement','obligation_due'], impact: 'Debt and cash-flow readiness remain partial.', missingEvidence: [row.blocker], reversible: false }) }));
  return candidateResult(rows, spec, db);
}

function withResponseSize(output) {
  let responseBytes = 0;
  while (true) {
    const candidate = { ...output, response_bytes: responseBytes };
    const measured = Buffer.byteLength(JSON.stringify(candidate));
    if (measured === responseBytes) return candidate;
    responseBytes = measured;
  }
}

function analysisContext(input, db = getDb()) {
  assertObject(input); rejectUnknown(input, ['entity','as_of','datasets']); const entityKey = input.entity || 'personal'; const entity = requireRow(db.prepare('SELECT * FROM reporting_entities WHERE entity_key=?').get(entityKey), 'Entity'); const asOfDate = isoDate(input.as_of || new Date().toLocaleDateString('en-CA'), 'as_of');
  if (!Array.isArray(input.datasets) || !input.datasets.length || input.datasets.length > MAX_DATASETS) throw new FinanceError('VALIDATION_ERROR', `datasets must contain 1 to ${MAX_DATASETS} entries`, { field: 'datasets' });
  const datasets = input.datasets.map(validateSpec).map((spec) => {
    let result; if (spec.name === 'cash_activity') result = cashActivity(spec, entityKey, asOfDate, db);
    if (spec.name === 'account_balances') result = accountBalances(spec, entityKey, asOfDate, db);
    if (spec.name === 'debt_obligations') result = debtObligations(spec, entityKey, db);
    if (spec.name === 'investment_positions') result = investments(spec, entityKey, asOfDate, entity.base_currency, db);
    if (spec.name === 'valued_items') result = valued(spec, entityKey, asOfDate, db);
    if (spec.name === 'reconciliation') result = { data: reconciliationSummary(db), provenance: provenance(db) };
    if (spec.name === 'transfer_candidates') result = transferCandidates(spec, entityKey, db);
    if (spec.name === 'reimbursement_candidates') result = reimbursementCandidates(spec, entityKey, db);
    if (spec.name === 'recurring_candidates') result = recurringCandidates(spec, entityKey, db);
    if (spec.name === 'installment_anomalies') result = installmentAnomalies(spec, entityKey, db);
    if (spec.name === 'statement_blockers') result = statementBlockers(spec, entityKey, db);
    if (spec.name === 'net_worth_inventory') { const accounts = accountBalances({ name: 'account_balances', limit: 200, offset: 0 }, entityKey, asOfDate, db).rows; result = { data: { tier_1: { accounts, debt: debtObligations({ name: 'debt_obligations', limit: 100, offset: 0 }, entityKey, db).rows, investments: investmentPositions({ entityKey, asOfDate, baseCurrency: entity.base_currency }, db) }, tier_2: { valued_items: listValuedItems({ entityKey, asOfDate }, db) }, reconciliation: reconciliationSummary(db) }, provenance: provenance(db) }; }
    return { name: spec.name, ...result };
  });
  const output = withResponseSize({ api_version: 'finance/v1', policy_version: POLICY_VERSION, entity: entityKey, as_of: asOfDate, datasets });
  if (output.response_bytes > MAX_RESPONSE_BYTES) throw new FinanceError('VALIDATION_ERROR', 'Analysis context response exceeds 512 KiB; narrow filters or limits', { status: 413 });
  return output;
}

module.exports = { analysisContext, validateSpec };
