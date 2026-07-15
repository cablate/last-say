const { getDb } = require('../core');
const { FinanceError, currency, isoDate } = require('../../finance/contracts');
const { activeRecordSql } = require('../../finance/active-records');
const {
  classifyTransactionForReport,
} = require('../../reporting/report-lines');
const {
  buildCashFlowCoverage,
  makeReportBlocker,
} = require('../../reporting/coverage');
const { isOwnerUnresolvedRow, needsReviewRow } = require('../../review-policy');

const DEFAULT_ENTITY_ID = 'personal';
const DEFAULT_CURRENCY = 'TWD';
const CASH_ACCOUNT_KINDS = Object.freeze(['cash', 'bank', 'e_wallet']);

function getParam(params, key) {
  if (!params) return null;
  if (typeof params.get === 'function') return params.get(key);
  return params[key] ?? null;
}

function localMonth() {
  return new Date().toLocaleDateString('en-CA').slice(0, 7);
}

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new FinanceError('VALIDATION_ERROR', 'month must use YYYY-MM', { field: 'month' });
  }
  const [year, monthNumber] = month.split('-').map(Number);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new FinanceError('VALIDATION_ERROR', 'month must be a real calendar month', { field: 'month' });
  }
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { month, periodStart: `${month}-01`, periodEnd: end, defaulted: false };
}

function selectedPeriod(params) {
  const month = getParam(params, 'month');
  const start = getParam(params, 'period_start');
  const end = getParam(params, 'period_end');
  if (month) return monthRange(month);
  if (start || end) {
    if (!start || !end) {
      throw new FinanceError(
        'VALIDATION_ERROR',
        'period_start and period_end must be provided together',
        { field: start ? 'period_end' : 'period_start' },
      );
    }
    const periodStart = isoDate(start, 'period_start');
    const periodEnd = isoDate(end, 'period_end');
    if (periodStart > periodEnd) {
      throw new FinanceError('VALIDATION_ERROR', 'period_start must not be after period_end', { field: 'period_start' });
    }
    return {
      month: periodStart.slice(0, 7) === periodEnd.slice(0, 7) ? periodStart.slice(0, 7) : null,
      periodStart,
      periodEnd,
      defaulted: false,
    };
  }
  return { ...monthRange(localMonth()), defaulted: true };
}

function monthStart(date) {
  return `${date.slice(0, 7)}-01`;
}

function previousDay(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function minorNumber(value, field = 'amount') {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new FinanceError('UNSUPPORTED_CONTEXT', `${field} exceeds the safe report range`, { status: 422, field });
  }
  return number;
}

function unique(items) {
  return [...new Set(items.filter((item) => item !== null && item !== undefined))];
}

function absolute(value) {
  return value < 0n ? -value : value;
}

function rowAmounts(row) {
  const inflow = BigInt(row.inflow_minor_text);
  const outflow = BigInt(row.outflow_minor_text);
  let signed = inflow - outflow;
  if (inflow === 0n && outflow === 0n) signed = BigInt(row.amount_minor_text);
  return { inflow, outflow, signed, absolute: absolute(signed) };
}

function rowKey(row) {
  return row.transaction_key || `transaction:${row.id}`;
}

function transactionDetail(row, amount, extra = {}) {
  return {
    transaction_id: row.id,
    transaction_key: rowKey(row),
    transaction_date: row.transaction_date,
    account_id: row.account_id,
    account_key: row.account_key,
    account_kind: row.account_kind,
    amount_cents: amount === null ? null : minorNumber(amount, 'transaction_amount_cents'),
    native_amount_cents: amount === null ? minorNumber(rowAmounts(row).signed, 'native_amount_cents') : minorNumber(amount, 'native_amount_cents'),
    native_currency: row.currency,
    ...extra,
  };
}

function addLine(lines, line, label, amount, row, extra = {}) {
  if (amount === 0n) return;
  if (!lines.has(line)) {
    lines.set(line, {
      line,
      label,
      amount: 0n,
      transaction_ids: [],
      transaction_keys: [],
      details: [],
    });
  }
  const target = lines.get(line);
  target.amount += amount;
  if (!target.transaction_ids.includes(row.id)) target.transaction_ids.push(row.id);
  const key = rowKey(row);
  if (!target.transaction_keys.includes(key)) target.transaction_keys.push(key);
  target.details.push(transactionDetail(row, amount, extra));
}

function serializeLines(lines) {
  return [...lines.values()]
    .sort((left, right) => left.line.localeCompare(right.line))
    .map((line) => ({
      line: line.line,
      label: line.label,
      amount_cents: minorNumber(line.amount, 'amount_cents'),
      transaction_count: line.transaction_ids.length,
      transaction_ids: line.transaction_ids,
      transaction_keys: line.transaction_keys,
      transaction_drillback_keys: line.transaction_keys,
      resource_type: 'cash_transactions',
      resource_keys: line.transaction_keys,
      drillback_ids: {
        transaction_ids: line.transaction_ids,
        transaction_keys: line.transaction_keys,
      },
      details: line.details,
    }));
}

function sumLines(lines) {
  return lines.reduce((sum, line) => sum + BigInt(line.amount_cents), 0n);
}

function addScopeWarning(warnings, fields) {
  if (fields.length === 0) return;
  warnings.push({
    kind: 'defaulted_scope',
    severity: 'info',
    fields,
    label: `Default report scope was used for: ${fields.join(', ')}.`,
  });
}

function loadRules(db) {
  return db.prepare(`
    SELECT * FROM report_mapping_rules
    WHERE enabled = 1
    ORDER BY confidence DESC, id ASC
  `).all();
}

function loadTransactions(db, accountIds, periodStart, periodEnd) {
  if (accountIds.length === 0) return [];
  const placeholders = accountIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT t.id, t.transaction_key, t.import_match_key, t.transaction_date, t.transaction_month,
      t.source_type, t.flow_type, t.name, t.amount, t.inflow, t.outflow,
      CAST(COALESCE(t.amount_minor, t.amount, 0) AS TEXT) AS amount_minor_text,
      CAST(COALESCE(t.inflow_minor, t.inflow, 0) AS TEXT) AS inflow_minor_text,
      CAST(COALESCE(t.outflow_minor, t.outflow, 0) AS TEXT) AS outflow_minor_text,
      t.currency, t.category_primary, t.category_sub, t.memo, t.raw_info,
      t.ai_confidence, t.classification_source, t.reviewed, t.account_id,
      a.account_key, a.account_kind, COALESCE(a.display_name, a.name) AS account_name,
      a.account_type,
      trm.report_line AS mapping_report_line, trm.mapping_source,
      trm.confidence AS mapping_confidence, trm.reason AS mapping_reason,
      trm.rule_id AS mapping_rule_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN transaction_report_mappings trm ON trm.transaction_id = t.id
    WHERE t.account_id IN (${placeholders}) AND t.transaction_date BETWEEN ? AND ?
      AND ${activeRecordSql('t')}
    ORDER BY t.transaction_date ASC, t.id ASC
  `).all(...accountIds, periodStart, periodEnd);
}

function boundarySnapshot(db, account, boundaryDate) {
  return db.prepare(`
    SELECT b.*, CAST(b.amount_minor AS TEXT) AS amount_minor_text,
      s.source_key, s.status AS source_status
    FROM account_balance_snapshots b
    LEFT JOIN sources s ON s.id = b.source_id
    WHERE b.account_id = ? AND b.as_of_date <= ? AND ${activeRecordSql('b')}
    ORDER BY b.as_of_date DESC,
      CASE b.authority
        WHEN 'official' THEN 6 WHEN 'institution_export' THEN 5
        WHEN 'user_confirmed' THEN 4 WHEN 'ai_researched' THEN 3
        WHEN 'ai_inferred' THEN 2 ELSE 1
      END DESC,
      b.id DESC
    LIMIT 1
  `).get(account.id, boundaryDate) || null;
}

function boundaryTotals(db, accounts, boundary, boundaryDate, reportCurrency, state, periodStart) {
  const snapshots = [];
  let total = 0n;
  let available = true;
  const acceptableMonthStart = boundary === 'beginning'
    ? monthStart(previousDay(periodStart))
    : monthStart(boundaryDate);

  for (const account of accounts) {
    const snapshot = boundarySnapshot(db, account, boundaryDate);
    if (!snapshot) {
      available = false;
      state.missingBalanceSnapshots.push({
        boundary,
        account_id: account.id,
        account_key: account.account_key,
        label: account.label,
        resource_type: 'account',
        resource_key: account.account_key,
      });
      continue;
    }
    const amount = BigInt(snapshot.amount_minor_text);
    const detail = {
      boundary,
      account_id: account.id,
      account_key: account.account_key,
      label: account.label,
      snapshot_id: snapshot.id,
      snapshot_key: snapshot.snapshot_key,
      snapshot_date: snapshot.as_of_date,
      requested_boundary_date: boundaryDate,
      amount_cents: snapshot.currency === reportCurrency ? minorNumber(amount, 'boundary_amount_cents') : null,
      native_amount_cents: minorNumber(amount, 'native_amount_cents'),
      native_currency: snapshot.currency,
      currency: reportCurrency,
      balance_kind: snapshot.balance_kind,
      resource_type: 'account_balance_snapshot',
      resource_key: snapshot.snapshot_key,
      source_key: snapshot.source_key || null,
      source_status: snapshot.source_status || null,
      drillback_ids: {
        account_ids: [account.id],
        account_keys: [account.account_key],
        balance_snapshot_ids: [snapshot.id],
        balance_snapshot_keys: [snapshot.snapshot_key],
        source_ids: snapshot.source_id ? [snapshot.source_id] : [],
        source_keys: snapshot.source_key ? [snapshot.source_key] : [],
      },
    };
    snapshots.push(detail);
    if (snapshot.currency !== reportCurrency || account.currency !== reportCurrency) {
      available = false;
      state.blockers.push(makeReportBlocker(
        'cash_boundary_currency_mismatch',
        `${account.label} ${boundary} balance is not in ${reportCurrency}; cash-flow FX is not guessed.`,
        'select_single_currency_scope',
        {
          boundary,
          account_id: account.id,
          account_key: account.account_key,
          resource_key: snapshot.snapshot_key,
          native_currency: snapshot.currency,
          currency: reportCurrency,
        },
      ));
    } else {
      total += amount;
    }
    if (snapshot.as_of_date < acceptableMonthStart && snapshot.as_of_date !== periodStart) {
      state.staleBalanceSnapshots.push({
        boundary,
        account_id: account.id,
        account_key: account.account_key,
        label: account.label,
        snapshot_date: snapshot.as_of_date,
        resource_type: 'account_balance_snapshot',
        resource_key: snapshot.snapshot_key,
      });
    } else if (snapshot.as_of_date < boundaryDate) {
      state.warnings.push({
        kind: 'prior_date_boundary_snapshot',
        severity: 'warning',
        boundary,
        account_id: account.id,
        account_key: account.account_key,
        resource_key: snapshot.snapshot_key,
        snapshot_date: snapshot.as_of_date,
        label: `${account.label} uses the latest ${boundary} balance dated ${snapshot.as_of_date}.`,
      });
    }
    if (snapshot.source_status && snapshot.source_status !== 'active') {
      state.blockers.push(makeReportBlocker(
        'inactive_snapshot_source',
        `${account.label} ${boundary} balance uses a ${snapshot.source_status} source.`,
        'review_balance_source',
        {
          boundary,
          account_id: account.id,
          account_key: account.account_key,
          resource_key: snapshot.snapshot_key,
        },
      ));
    }
  }
  return {
    available: accounts.length > 0 && available && snapshots.length === accounts.length,
    total,
    snapshots,
  };
}

function pushMap(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function typedEvidence(db) {
  return {
    transfers: db.prepare(`
      SELECT m.*, f.transaction_key AS from_transaction_key, t.transaction_key AS to_transaction_key
      FROM transfer_matches m
      JOIN transactions f ON f.id = m.from_transaction_id
      LEFT JOIN transactions t ON t.id = m.to_transaction_id
      WHERE m.match_status <> 'rejected'
      ORDER BY m.id ASC
    `).all(),
    cards: db.prepare(`
      SELECT m.*, s.statement_key, s.currency AS statement_currency, p.profile_key
      FROM credit_card_payment_matches m
      JOIN credit_card_statements s ON s.id = m.statement_id
      JOIN credit_card_profiles p ON p.id = s.profile_id
      WHERE m.match_status <> 'rejected' AND ${activeRecordSql('m')} AND ${activeRecordSql('s')}
      ORDER BY m.id ASC
    `).all(),
    loans: db.prepare(`
      SELECT a.*, e.schedule_key, l.liability_key, l.currency AS liability_currency
      FROM loan_payment_allocations a
      JOIN loan_schedule_entries e ON e.id = a.schedule_entry_id
      JOIN liability_profiles l ON l.id = e.liability_id
      WHERE ${activeRecordSql('a')} AND ${activeRecordSql('e')} AND ${activeRecordSql('l')}
      ORDER BY a.id ASC
    `).all(),
    investments: db.prepare(`
      SELECT m.*, t.trade_key, t.activity_type, t.currency AS trade_currency
      FROM investment_cash_matches m
      JOIN investment_trades t ON t.id = m.trade_id
      WHERE ${activeRecordSql('t')}
      ORDER BY m.id ASC
    `).all(),
    reimbursements: db.prepare(`
      SELECT m.*, CAST(COALESCE(SUM(i.allocated_minor), 0) AS TEXT) AS allocated_minor_text
      FROM reimbursement_matches m
      LEFT JOIN reimbursement_match_items i ON i.match_id = m.id
      WHERE m.match_status <> 'rejected'
      GROUP BY m.id
      ORDER BY m.id ASC
    `).all(),
    reimbursementItems: db.prepare(`
      SELECT i.*, m.match_key, m.match_status, m.reimbursement_transaction_id
      FROM reimbursement_match_items i
      JOIN reimbursement_matches m ON m.id = i.match_id
      WHERE m.match_status <> 'rejected'
      ORDER BY i.id ASC
    `).all(),
  };
}

function evidenceMaps(evidence, scopedIds) {
  const owners = new Map();
  const transfers = new Map();
  const cards = new Map();
  const loans = new Map();
  const investments = new Map();
  const reimbursements = new Map();
  const reimbursementContext = new Map();
  function owner(transactionId, kind) {
    if (!scopedIds.has(transactionId)) return;
    if (!owners.has(transactionId)) owners.set(transactionId, new Set());
    owners.get(transactionId).add(kind);
  }
  for (const match of evidence.transfers) {
    if (scopedIds.has(match.from_transaction_id)) pushMap(transfers, match.from_transaction_id, match);
    if (scopedIds.has(match.to_transaction_id)) pushMap(transfers, match.to_transaction_id, match);
    owner(match.from_transaction_id, 'transfer');
    owner(match.to_transaction_id, 'transfer');
  }
  for (const match of evidence.cards) {
    pushMap(cards, match.transaction_id, match);
    owner(match.transaction_id, 'card_settlement');
  }
  for (const allocation of evidence.loans) {
    pushMap(loans, allocation.transaction_id, allocation);
    owner(allocation.transaction_id, 'loan_payment');
  }
  for (const match of evidence.investments) {
    pushMap(investments, match.transaction_id, match);
    owner(match.transaction_id, 'investment_cash');
  }
  for (const match of evidence.reimbursements) {
    pushMap(reimbursements, match.reimbursement_transaction_id, match);
    owner(match.reimbursement_transaction_id, 'reimbursement');
  }
  for (const item of evidence.reimbursementItems) {
    pushMap(reimbursementContext, item.expense_transaction_id, item);
  }
  return { owners, transfers, cards, loans, investments, reimbursements, reimbursementContext };
}

function ownerKinds(maps, transactionId) {
  return [...(maps.owners.get(transactionId) || [])];
}

function unresolvedLine(lines, row, reason, extra = {}) {
  addLine(lines, `unresolved:${reason}`, extra.label || 'Unresolved cash movement', rowAmounts(row).signed, row, {
    cash_flow_role: 'unresolved',
    unresolved_reason: reason,
    ...extra,
  });
}

function blockerForRow(state, kind, label, action, row, details = {}) {
  state.blockers.push(makeReportBlocker(kind, label, action, {
    transaction_id: row.id,
    transaction_key: rowKey(row),
    resource_type: 'transaction',
    resource_key: rowKey(row),
    ...details,
  }));
}

function transferEliminations(evidence, maps, rowsById, reportCurrency, state) {
  const eliminatedIds = new Set();
  const lines = [];
  let total = 0n;
  for (const match of evidence.transfers) {
    const from = rowsById.get(match.from_transaction_id);
    const to = rowsById.get(match.to_transaction_id);
    const inScope = from && to;
    const exclusiveOwners = inScope
      && ownerKinds(maps, from.id).length === 1
      && ownerKinds(maps, to.id).length === 1;
    const amount = BigInt(match.amount_minor);
    const exact = inScope
      && rowAmounts(from).outflow === amount
      && rowAmounts(to).inflow === amount;
    const currencyMatches = inScope
      && match.currency === reportCurrency
      && from.currency === reportCurrency
      && to.currency === reportCurrency;

    if (match.match_status === 'confirmed' && inScope && exclusiveOwners && exact && currencyMatches) {
      eliminatedIds.add(from.id);
      eliminatedIds.add(to.id);
      total += amount;
      lines.push({
        line: 'internal_transfer',
        label: 'Confirmed own-account transfer',
        amount_cents: minorNumber(amount, 'internal_transfer_amount_cents'),
        resource_type: 'transfer_match',
        resource_key: match.match_key,
        match_key: match.match_key,
        from_transaction_id: from.id,
        from_transaction_key: rowKey(from),
        to_transaction_id: to.id,
        to_transaction_key: rowKey(to),
        transaction_ids: [from.id, to.id],
        transaction_keys: [rowKey(from), rowKey(to)],
        transaction_drillback_keys: [rowKey(from), rowKey(to)],
        drillback_ids: {
          transfer_match_ids: [match.id],
          transfer_match_keys: [match.match_key],
          transaction_ids: [from.id, to.id],
          transaction_keys: [rowKey(from), rowKey(to)],
        },
      });
      continue;
    }

    const scopedRow = from || to;
    if (!scopedRow) continue;
    state.unmatchedTransferKeys.add(match.match_key);
    const kind = match.match_status === 'confirmed'
      ? (exact ? 'one_sided_transfer' : 'partial_transfer_allocation')
      : 'unconfirmed_transfer_match';
    blockerForRow(
      state,
      kind,
      match.match_status === 'confirmed'
        ? 'A confirmed transfer is not fully represented by two exact in-scope cash legs.'
        : 'An internal-transfer candidate still requires confirmation.',
      'review_transfers',
      scopedRow,
      { resource_type: 'transfer_match', resource_key: match.match_key, match_key: match.match_key },
    );
  }
  return { eliminatedIds, lines, total };
}

function classifyTypedOwner(kind, row, maps, reportCurrency, sections, state) {
  const amounts = rowAmounts(row);
  if (kind === 'transfer') {
    const matches = maps.transfers.get(row.id) || [];
    unresolvedLine(sections.unresolved, row, 'unmatched_transfer', {
      transfer_match_keys: matches.map((item) => item.match_key),
    });
    if (matches.length === 0) state.unmatchedTransferKeys.add(`transaction:${row.id}`);
    return;
  }
  if (kind === 'card_settlement') {
    const matches = maps.cards.get(row.id) || [];
    const confirmed = matches.filter((match) => match.match_status === 'confirmed');
    const matched = confirmed.reduce((sum, match) => sum + BigInt(match.amount_minor), 0n);
    if (amounts.outflow > 0n && matched === amounts.outflow
      && confirmed.length === matches.length
      && confirmed.every((match) => match.statement_currency === reportCurrency)) {
      addLine(sections.operating, 'credit_card_settlement', 'Credit-card settlement', -matched, row, {
        cash_flow_role: 'operating',
        typed_owner: 'credit_card_payment_match',
        match_keys: confirmed.map((match) => match.match_key),
        statement_keys: confirmed.map((match) => match.statement_key),
      });
      return;
    }
    unresolvedLine(sections.unresolved, row, 'unconfirmed_card_settlement', {
      match_keys: matches.map((match) => match.match_key),
    });
    blockerForRow(state, 'unmatched_card_settlement', 'Credit-card settlement evidence is missing, unconfirmed, or does not equal the cash leg.', 'review_card_payment_match', row);
    return;
  }
  if (kind === 'loan_payment') {
    const allocations = maps.loans.get(row.id) || [];
    const reconciled = allocations.filter((item) => item.reconciliation_status === 'reconciled');
    const principal = reconciled.reduce((sum, item) => sum + BigInt(item.principal_minor), 0n);
    const interest = reconciled.reduce((sum, item) => sum + BigInt(item.interest_minor), 0n);
    const fee = reconciled.reduce((sum, item) => sum + BigInt(item.fee_minor), 0n);
    const allocated = principal + interest + fee;
    if (amounts.outflow > 0n && allocated === amounts.outflow
      && reconciled.length === allocations.length
      && reconciled.every((item) => item.liability_currency === reportCurrency)) {
      const keys = reconciled.map((item) => item.allocation_key);
      addLine(sections.financing, 'loan_principal', 'Loan principal repayment', -principal, row, {
        cash_flow_role: 'financing', typed_owner: 'loan_payment_allocation', allocation_keys: keys,
      });
      addLine(sections.operating, 'loan_interest', 'Loan interest payment', -interest, row, {
        cash_flow_role: 'operating', typed_owner: 'loan_payment_allocation', allocation_keys: keys,
      });
      addLine(sections.operating, 'loan_fee', 'Loan fee payment', -fee, row, {
        cash_flow_role: 'operating', typed_owner: 'loan_payment_allocation', allocation_keys: keys,
      });
      return;
    }
    unresolvedLine(sections.unresolved, row, 'missing_loan_allocation', {
      allocation_keys: allocations.map((item) => item.allocation_key),
    });
    blockerForRow(state, 'missing_loan_allocation', 'Loan cash cannot be split until principal, interest, and fee exactly reconcile.', 'review_loan_allocation', row);
    return;
  }
  if (kind === 'investment_cash') {
    const matches = maps.investments.get(row.id) || [];
    const reconciled = matches.filter((item) => item.reconciliation_status === 'reconciled');
    const matched = reconciled.reduce((sum, item) => sum + absolute(BigInt(item.amount_minor)), 0n);
    if (matched === amounts.absolute && reconciled.length === matches.length
      && reconciled.every((item) => item.trade_currency === reportCurrency)) {
      const activities = unique(reconciled.map((item) => item.activity_type));
      const line = activities.length === 1 && activities[0] === 'buy'
        ? 'investment_purchase'
        : (activities.length === 1 && activities[0] === 'sell' ? 'investment_sale' : 'investment_cash_activity');
      addLine(sections.investing, line, 'Matched investment cash', amounts.signed, row, {
        cash_flow_role: 'investing',
        typed_owner: 'investment_cash_match',
        match_keys: reconciled.map((item) => item.match_key),
        trade_keys: reconciled.map((item) => item.trade_key),
        investment_activities: activities,
      });
      return;
    }
    unresolvedLine(sections.unresolved, row, 'unmatched_investment_cash', {
      match_keys: matches.map((item) => item.match_key),
    });
    blockerForRow(state, 'unmatched_investment_cash', 'Investment cash evidence is missing or does not reconcile to the cash leg.', 'review_investment_cash_match', row);
    return;
  }
  if (kind === 'reimbursement') {
    const matches = maps.reimbursements.get(row.id) || [];
    const confirmed = matches.filter((match) => match.match_status === 'confirmed');
    const allocated = confirmed.reduce(
      (sum, match) => sum + BigInt(match.allocated_minor_text),
      0n,
    );
    if (amounts.inflow > 0n && allocated === amounts.inflow
      && confirmed.length === matches.length
      && confirmed.every((match) => match.currency === reportCurrency)) {
      addLine(sections.operating, 'reimbursement_receipt', 'Reimbursement receipt', amounts.signed, row, {
        cash_flow_role: 'operating',
        typed_owner: 'reimbursement_match',
        match_keys: confirmed.map((match) => match.match_key),
        allocated_cents: minorNumber(allocated, 'allocated_cents'),
        gross_source_cash_preserved: true,
      });
      return;
    }
    unresolvedLine(sections.unresolved, row, 'unconfirmed_reimbursement', {
      match_keys: matches.map((match) => match.match_key),
    });
    blockerForRow(state, 'unconfirmed_reimbursement', 'Reimbursement context remains unconfirmed.', 'review_reimbursement_match', row);
  }
}

function fallbackClassification(row, rules, maps, sections, state) {
  const amounts = rowAmounts(row);
  if (isOwnerUnresolvedRow(row)) {
    unresolvedLine(sections.unresolved, row, 'owner_unresolved');
    blockerForRow(state, 'owner_unresolved_transaction', 'The cash movement is confirmed but its purpose remains owner-unresolved.', 'review_owner_unresolved', row);
    return;
  }

  const classification = classifyTransactionForReport(row, rules);
  if (classification.status !== 'mapped') {
    state.unmappedTransactionIds.add(row.id);
    unresolvedLine(sections.unresolved, row, 'unmapped_cash_flow');
    blockerForRow(state, 'unmapped_cash_flow', 'This cash movement has no usable report-line mapping.', 'review_report_mappings', row);
    return;
  }

  const reimbursementContext = maps.reimbursementContext.get(row.id) || [];
  const context = reimbursementContext.length ? {
    reimbursement_context: reimbursementContext.map((item) => ({
      match_key: item.match_key,
      match_status: item.match_status,
      reimbursement_transaction_id: item.reimbursement_transaction_id,
      allocated_cents: minorNumber(BigInt(item.allocated_minor), 'allocated_cents'),
    })),
    gross_source_cash_preserved: true,
  } : {};

  if (classification.definition.group === 'revenue' || classification.definition.group === 'expense') {
    addLine(sections.operating, classification.reportLine, classification.definition.label, amounts.signed, row, {
      cash_flow_role: 'operating',
      mapping_source: classification.mappingSource,
      ...context,
    });
    return;
  }
  if (classification.reportLine === 'excluded:owner_equity') {
    addLine(sections.financing, 'owner_equity', classification.definition.label, amounts.signed, row, {
      cash_flow_role: 'financing', mapping_source: classification.mappingSource,
    });
    return;
  }

  const unresolvedKinds = {
    'excluded:internal_transfer': ['unmatched_transfer', 'unmatched_transfer', 'review_transfers'],
    'excluded:credit_card_payment': ['unmatched_card_settlement', 'unmatched_card_settlement', 'review_card_payment_match'],
    'excluded:loan_principal': ['missing_loan_allocation', 'missing_loan_allocation', 'review_loan_allocation'],
    'excluded:investment_purchase': ['unmatched_investment_cash', 'unmatched_investment_cash', 'review_investment_cash_match'],
  };
  const unresolved = unresolvedKinds[classification.reportLine];
  if (unresolved) {
    unresolvedLine(sections.unresolved, row, unresolved[0]);
    blockerForRow(state, unresolved[1], 'A typed cash-flow owner is required before this movement can be classified.', unresolved[2], row);
    if (classification.reportLine === 'excluded:internal_transfer') {
      state.unmatchedTransferKeys.add(`transaction:${row.id}`);
    }
    return;
  }

  unresolvedLine(sections.unresolved, row, 'unsupported_cash_flow_mapping');
  blockerForRow(state, 'unsupported_cash_flow_mapping', 'This mapped report line has no confirmed cash-flow treatment.', 'review_cash_flow_mapping', row);
}

function getCashFlow(params, db = getDb()) {
  const entityId = getParam(params, 'entity_id') || DEFAULT_ENTITY_ID;
  const reportCurrency = currency(getParam(params, 'currency') || DEFAULT_CURRENCY);
  const period = selectedPeriod(params);
  const defaulted = [];
  if (!getParam(params, 'entity_id')) defaulted.push('entity_id');
  if (!getParam(params, 'currency')) defaulted.push('currency');
  if (period.defaulted) defaulted.push('period_start', 'period_end');

  const entity = db.prepare('SELECT * FROM reporting_entities WHERE entity_key = ? AND active = 1').get(entityId);
  if (!entity) throw new FinanceError('NOT_FOUND', `Reporting entity not found: ${entityId}`, { status: 404, field: 'entity_id' });
  const placeholders = CASH_ACCOUNT_KINDS.map(() => '?').join(',');
  const accounts = db.prepare(`
    SELECT a.*, COALESCE(a.display_name, a.name) AS label
    FROM accounts a
    WHERE a.entity_id = ? AND a.active = 1 AND a.included_in_analysis = 1
      AND a.account_kind IN (${placeholders})
      AND a.currency = ?
      AND a.merged_into_account_id IS NULL AND a.reversed_by_run_id IS NULL
    ORDER BY label ASC, a.id ASC
  `).all(entity.id, ...CASH_ACCOUNT_KINDS, reportCurrency);
  const includedAccountIds = accounts.map((account) => account.id);
  const state = {
    blockers: [],
    warnings: [],
    missingBalanceSnapshots: [],
    staleBalanceSnapshots: [],
    unmatchedTransferKeys: new Set(),
    unmappedTransactionIds: new Set(),
  };
  addScopeWarning(state.warnings, defaulted);

  const beginning = boundaryTotals(db, accounts, 'beginning', period.periodStart, reportCurrency, state, period.periodStart);
  const ending = boundaryTotals(db, accounts, 'ending', period.periodEnd, reportCurrency, state, period.periodStart);
  const rows = loadTransactions(db, includedAccountIds, period.periodStart, period.periodEnd);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const evidence = typedEvidence(db);
  const maps = evidenceMaps(evidence, new Set(rowsById.keys()));
  const transfers = transferEliminations(evidence, maps, rowsById, reportCurrency, state);
  const rules = loadRules(db);
  const sections = {
    operating: new Map(),
    investing: new Map(),
    financing: new Map(),
    unresolved: new Map(),
  };
  let unreviewedTransactionCount = 0;
  let foreignCurrencyTransactionCount = 0;

  for (const row of rows) {
    if (needsReviewRow(row)) unreviewedTransactionCount += 1;
    if (transfers.eliminatedIds.has(row.id)) continue;
    if (row.currency !== reportCurrency) {
      foreignCurrencyTransactionCount += 1;
      blockerForRow(
        state,
        'cash_transaction_currency_mismatch',
        `Transaction ${rowKey(row)} is in ${row.currency}; cash-flow FX is not guessed.`,
        'select_single_currency_scope',
        row,
        { native_currency: row.currency, currency: reportCurrency },
      );
      continue;
    }
    const kinds = ownerKinds(maps, row.id);
    if (kinds.length > 1) {
      unresolvedLine(sections.unresolved, row, 'conflicting_typed_cash_owner', { typed_owners: kinds });
      blockerForRow(
        state,
        'conflicting_typed_cash_owner',
        `Transaction ${rowKey(row)} has conflicting typed cash owners: ${kinds.join(', ')}.`,
        'review_cash_owner_conflict',
        row,
        { typed_owners: kinds },
      );
      continue;
    }
    if (kinds.length === 1) {
      classifyTypedOwner(kinds[0], row, maps, reportCurrency, sections, state);
    } else {
      fallbackClassification(row, rules, maps, sections, state);
    }
  }

  const operating = serializeLines(sections.operating);
  const investing = serializeLines(sections.investing);
  const financing = serializeLines(sections.financing);
  const unresolved = serializeLines(sections.unresolved);
  const operatingTotal = sumLines(operating);
  const investingTotal = sumLines(investing);
  const financingTotal = sumLines(financing);
  const unresolvedTotal = sumLines(unresolved);
  const netCashFlow = operatingTotal + investingTotal + financingTotal + unresolvedTotal;
  const boundaryTotalsAvailable = beginning.available && ending.available;
  const reconciliationAvailable = boundaryTotalsAvailable && foreignCurrencyTransactionCount === 0;
  const expectedEnding = reconciliationAvailable ? beginning.total + netCashFlow : null;
  const reconciliationDelta = reconciliationAvailable ? expectedEnding - ending.total : null;

  const missing = state.missingBalanceSnapshots;
  const stale = state.staleBalanceSnapshots;
  const coverage = buildCashFlowCoverage({
    entityId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    currency: reportCurrency,
    includedAccountIds,
    defaultedFields: defaulted,
    transactionCount: rows.length,
    missingBalanceSnapshots: missing,
    staleBalanceSnapshots: stale,
    unreviewedTransactionCount,
    unmappedTransactionCount: state.unmappedTransactionIds.size,
    unmatchedTransferCount: state.unmatchedTransferKeys.size,
    reconciliationDeltaCents: reconciliationDelta === null
      ? null
      : minorNumber(reconciliationDelta, 'reconciliation_delta_cents'),
    boundariesAvailable: reconciliationAvailable,
    blockers: state.blockers,
    warnings: state.warnings,
  });

  return {
    report: 'cash_flow',
    entity_id: entityId,
    month: period.month,
    period_start: period.periodStart,
    period_end: period.periodEnd,
    currency: reportCurrency,
    included_account_ids: includedAccountIds,
    beginning_cash_cents: beginning.available ? minorNumber(beginning.total, 'beginning_cash_cents') : null,
    beginning_cash_available_cents: minorNumber(beginning.total, 'beginning_cash_available_cents'),
    beginning_snapshot_date: beginning.available && unique(beginning.snapshots.map((item) => item.snapshot_date)).length === 1
      ? beginning.snapshots[0].snapshot_date
      : null,
    beginning_snapshot_dates: unique(beginning.snapshots.map((item) => item.snapshot_date)).sort(),
    beginning_cash_snapshots: beginning.snapshots,
    operating,
    investing,
    financing,
    internal_transfers_eliminated: transfers.lines,
    unresolved,
    operating_cash_flow_cents: minorNumber(operatingTotal, 'operating_cash_flow_cents'),
    investing_cash_flow_cents: minorNumber(investingTotal, 'investing_cash_flow_cents'),
    financing_cash_flow_cents: minorNumber(financingTotal, 'financing_cash_flow_cents'),
    internal_transfers_eliminated_cents: minorNumber(transfers.total, 'internal_transfers_eliminated_cents'),
    unresolved_cash_flow_cents: minorNumber(unresolvedTotal, 'unresolved_cash_flow_cents'),
    net_cash_flow_cents: minorNumber(netCashFlow, 'net_cash_flow_cents'),
    expected_ending_cash_cents: expectedEnding === null ? null : minorNumber(expectedEnding, 'expected_ending_cash_cents'),
    ending_cash_cents: ending.available ? minorNumber(ending.total, 'ending_cash_cents') : null,
    ending_cash_available_cents: minorNumber(ending.total, 'ending_cash_available_cents'),
    ending_snapshot_date: ending.available && unique(ending.snapshots.map((item) => item.snapshot_date)).length === 1
      ? ending.snapshots[0].snapshot_date
      : null,
    ending_snapshot_dates: unique(ending.snapshots.map((item) => item.snapshot_date)).sort(),
    ending_cash_snapshots: ending.snapshots,
    boundary_totals_available: boundaryTotalsAvailable,
    reconciliation_available: reconciliationAvailable,
    reconciliation_delta_cents: reconciliationDelta === null
      ? null
      : minorNumber(reconciliationDelta, 'reconciliation_delta_cents'),
    transaction_count: rows.length,
    unreviewed_transaction_count: unreviewedTransactionCount,
    unmapped_transaction_count: state.unmappedTransactionIds.size,
    unmatched_transfer_count: state.unmatchedTransferKeys.size,
    foreign_currency_transaction_count: foreignCurrencyTransactionCount,
    coverage,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  CASH_ACCOUNT_KINDS,
  getCashFlow,
};
