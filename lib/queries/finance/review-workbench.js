const { getDb } = require('./common');
const { listHumanConfirmations } = require('./human-confirmations');
const { listReviewTasks } = require('./review-tasks');
const { getTransferMatch } = require('./reconciliation');
const { getReimbursementMatch } = require('./reimbursements');
const { getCommitment } = require('./obligations');
const { getSourceConflict } = require('./source-conflicts');
const { activeRecordSql } = require('../../finance/active-records');
const { ownerUnresolvedSql } = require('../../review-policy');

const CONTRACT = 'finance.review-workbench/v1';

function transactionEvidence(db, key) {
  return db.prepare(`SELECT t.id,t.transaction_key,t.transaction_date,t.name,t.currency,t.flow_type,
      CAST(COALESCE(t.inflow_minor,t.inflow,0) AS TEXT) AS inflow_minor,
      CAST(COALESCE(t.outflow_minor,t.outflow,0) AS TEXT) AS outflow_minor,
      a.account_key,COALESCE(a.display_name,a.name) AS account_name
    FROM transactions t JOIN accounts a ON a.id=t.account_id
    WHERE t.transaction_key=?`).get(key) || null;
}

function sourceEvidence(db, key) {
  return db.prepare(`SELECT source_key,source_kind,description,authority,review_state,
      period_start,period_end,as_of_at,observed_at
    FROM sources WHERE source_key=?`).get(key) || null;
}

function action(kind, label, enabled = true) {
  return { kind, label, enabled };
}

function baseItem(task, resource, title, impact = { financial: [], timelines: [] }) {
  return {
    item_key: task.task_key,
    item_kind: task.task_kind,
    task_key: task.task_key,
    priority: task.priority,
    resource,
    title,
    reason: task.reason,
    evidence: [],
    impact,
    missing_evidence: [],
    before: {},
    after_preview: {},
    actions: [],
    recovery: { on_stale: 'refresh', reversible: true },
  };
}

function transferItem(task, db) {
  const match = getTransferMatch(task.resource_key, db);
  const item = baseItem(task, {
    type: 'transfer_match', key: match.match_key, version: match.version,
    status: match.match_status,
  }, match.to_transaction_key ? '確認這組是否為自己的帳戶互轉' : '這筆疑似轉帳缺少另一側', {
    financial: [{ kind: 'internal_transfer_elimination', amount_minor: match.amount_minor, currency: match.currency }],
    timelines: ['cash'],
  });
  item.evidence = [transactionEvidence(db, match.from_transaction_key), transactionEvidence(db, match.to_transaction_key)].filter(Boolean);
  if (!match.to_transaction_key) item.missing_evidence.push('缺少收款帳戶的對應入帳紀錄，不能確認為完整互轉。');
  item.before = { match_status: match.match_status, review_state: match.review_state, note: match.note || null };
  item.after_preview = {
    confirm: { match_status: 'confirmed', cash_effect: 'both legs eliminated when both accounts are in scope' },
    reject: { match_status: 'rejected', cash_effect: 'source cash rows remain independent' },
  };
  item.actions = [action('confirm', '確認互轉', Boolean(match.to_transaction_key)), action('reject', '不是互轉')];
  return item;
}

function reimbursementItem(task, db) {
  const match = getReimbursementMatch(task.resource_key, db);
  const item = baseItem(task, {
    type: 'reimbursement_match', key: match.match_key, version: match.version,
    status: match.match_status,
  }, '確認這筆收入是否為指定支出的報銷', {
    financial: [{
      kind: 'reimbursement_allocation', amount_minor: match.allocated_minor,
      unallocated_minor: match.unallocated_minor, currency: match.currency,
    }],
    timelines: ['economic', 'cash'],
  });
  item.evidence = [
    transactionEvidence(db, match.reimbursement_transaction_key),
    ...match.items.map((entry) => ({
      ...transactionEvidence(db, entry.expense_transaction_key),
      allocated_minor: entry.allocated_minor,
    })),
  ].filter(Boolean);
  if (BigInt(match.unallocated_minor) !== 0n) item.missing_evidence.push('報銷收入仍有未配對金額，確認後報表仍會標示部分覆蓋。');
  item.before = { match_status: match.match_status, review_state: match.review_state, reason: match.reason, note: match.note || null };
  item.after_preview = {
    confirm: { match_status: 'confirmed', economic_effect: 'preserve gross expense and disclose reimbursement match' },
    reject: { match_status: 'rejected', economic_effect: 'income and expenses remain unrelated gross facts' },
  };
  item.actions = [action('confirm', '確認報銷配對'), action('reject', '不是報銷配對')];
  return item;
}

function commitmentPayload(commitment, status, reviewState, authority) {
  return {
    expected_version: commitment.version,
    entity_key: commitment.entity_key,
    account_key: commitment.account_key || undefined,
    commitment_kind: commitment.commitment_kind,
    direction: commitment.direction,
    amount_kind: commitment.amount_kind,
    amount_minor: commitment.amount_minor == null ? undefined : String(commitment.amount_minor),
    amount_min_minor: commitment.amount_min_minor == null ? undefined : String(commitment.amount_min_minor),
    amount_max_minor: commitment.amount_max_minor == null ? undefined : String(commitment.amount_max_minor),
    currency: commitment.currency,
    cadence: commitment.cadence,
    start_date: commitment.start_date,
    end_date: commitment.end_date || undefined,
    next_due_date: commitment.next_due_date || undefined,
    status,
    authority,
    review_state: reviewState,
  };
}

function commitmentItem(task, db) {
  const commitment = getCommitment(task.resource_key, db);
  const amount = commitment.amount_kind === 'fixed'
    ? { amount_minor: commitment.amount_minor == null ? null : String(commitment.amount_minor) }
    : {
      amount_min_minor: commitment.amount_min_minor == null ? null : String(commitment.amount_min_minor),
      amount_max_minor: commitment.amount_max_minor == null ? null : String(commitment.amount_max_minor),
    };
  const item = baseItem(task, {
    type: 'commitment', key: commitment.commitment_key, version: commitment.version,
    status: commitment.status,
  }, '確認是否為持續發生的固定收支', {
    financial: [{ kind: 'future_commitment', ...amount, currency: commitment.currency, direction: commitment.direction }],
    timelines: ['obligation'],
  });
  item.evidence = [{
    commitment_kind: commitment.commitment_kind,
    cadence: commitment.cadence,
    start_date: commitment.start_date,
    end_date: commitment.end_date,
    next_due_date: commitment.next_due_date,
    occurrences: commitment.occurrences,
  }];
  item.before = commitment;
  item.after_preview = {
    confirm: commitmentPayload(commitment, 'scheduled', 'confirmed', 'user_confirmed'),
    reject: commitmentPayload(commitment, 'cancelled', 'rejected', 'user_confirmed'),
  };
  item.actions = [action('confirm', '確認固定收支'), action('reject', '不是固定收支')];
  return item;
}

function conflictItem(task, db) {
  const conflict = getSourceConflict(task.resource_key, db);
  const item = baseItem(task, {
    type: 'source_conflict', key: conflict.conflict_key, version: null,
    status: conflict.status,
  }, '選擇較可信的來源證據', { financial: [], timelines: [], notes: conflict.impact_note ? [conflict.impact_note] : [] });
  item.item_kind = 'source_conflict';
  item.reason = conflict.reason || task.reason;
  item.evidence = [sourceEvidence(db, conflict.left_source_key), sourceEvidence(db, conflict.right_source_key)].filter(Boolean);
  item.before = { target_context: conflict.target_context, semantic_key: conflict.semantic_key, status: conflict.status, reason: conflict.reason || null, impact_note: conflict.impact_note || null };
  item.after_preview = { selected_source_key: null, authority: 'user_confirmed', review_state: 'confirmed' };
  item.missing_evidence = ['需要由人選擇兩個既有來源之一；系統不會自動猜測。'];
  item.actions = [action('select_source', '選擇可信來源')];
  return item;
}

function unsupportedItem(task) {
  const item = baseItem(task, {
    type: task.resource_type, key: task.resource_key, version: null, status: 'open',
  }, '這個項目需要人工處理，但尚無安全的快速操作');
  item.item_kind = task.task_kind;
  item.missing_evidence = ['目前沒有可安全套用的 typed action，請到對應資料頁補充證據。'];
  item.actions = [action('open_resource', '前往相關資料', false)];
  item.recovery.reversible = false;
  return item;
}

function hydrateTask(task, db) {
  if (task.task_kind === 'transfer_match') return transferItem(task, db);
  if (task.task_kind === 'reimbursement_match') return reimbursementItem(task, db);
  if (task.task_kind === 'commitment_candidate') return commitmentItem(task, db);
  if (task.task_kind === 'source_conflict') return conflictItem(task, db);
  return unsupportedItem(task);
}

function humanConfirmationItem(proposal) {
  const payload = proposal.payload || {};
  return {
    item_key: proposal.proposal_key,
    item_kind: 'scope_confirmation',
    task_key: null,
    priority: 100,
    resource: {
      type: proposal.resource_type, key: proposal.resource_key, version: proposal.expected_version,
      status: proposal.status,
    },
    title: proposal.action_kind === 'declare_scope_complete' ? '確認這次資料範圍是否完整' : proposal.action_kind,
    reason: '這個動作會提高資料完整度權威，必須由目前的瀏覽器工作階段確認。',
    evidence: [{
      scope_kind: payload.scope_kind || proposal.resource_type,
      as_of_date: payload.as_of_date || null,
      included_note: payload.included_note || null,
      excluded_note: payload.excluded_note || null,
    }],
    impact: { financial: [], timelines: ['scope'] },
    missing_evidence: [],
    before: { status: proposal.status },
    after_preview: { status: 'consumed', scope_kind: payload.scope_kind || proposal.resource_type },
    actions: [action('confirm_scope', '確認並套用')],
    recovery: { on_stale: 'refresh', reversible: false },
    expires_at: proposal.expires_at,
  };
}

function ownerUnresolvedItems(db, month = null) {
  const monthClause = month ? ' AND t.transaction_month = ?' : '';
  const values = month ? [month] : [];
  return db.prepare(`SELECT t.id,t.transaction_key,t.transaction_date,t.name,t.currency,t.flow_type,
      t.category_primary,t.memo,t.classification_source,t.reviewed,
      CAST(COALESCE(t.inflow_minor,t.inflow,0) AS TEXT) AS inflow_minor,
      CAST(COALESCE(t.outflow_minor,t.outflow,0) AS TEXT) AS outflow_minor,
      a.account_key,COALESCE(a.display_name,a.name) AS account_name
    FROM transactions t JOIN accounts a ON a.id=t.account_id
    WHERE ${activeRecordSql('t')} AND ${ownerUnresolvedSql('t')}${monthClause}
    ORDER BY t.transaction_date DESC,t.id DESC LIMIT 200`).all(...values).map((row) => ({
      item_key: row.transaction_key,
      item_kind: 'owner_unresolved_transaction',
      task_key: null,
      priority: 0,
      resource: { type: 'transaction', key: row.transaction_key, version: null, status: 'owner_unresolved' },
      title: row.name || '用途未確認的現金移動',
      reason: '現金確實有移動，但現有證據不足以判斷用途；不會自動計入損益或建立規則。',
      evidence: [row],
      impact: {
        financial: [{ kind: 'unresolved_cash_movement', inflow_minor: row.inflow_minor, outflow_minor: row.outflow_minor, currency: row.currency }],
        timelines: ['cash'],
      },
      missing_evidence: ['需要更完整的對手方、用途、來源文件或使用者記憶才可重新分類。'],
      before: { category_primary: row.category_primary, classification_source: row.classification_source, reviewed: row.reviewed },
      after_preview: {},
      actions: [action('open_transaction_correction', '開啟交易修正')],
      recovery: { on_stale: 'refresh', reversible: true },
      transaction_id: row.id,
    }));
}

function normalizeReviewWorkbenchArgs(first, second, third) {
  // Keep reviewWorkbench(db, now) stable for direct callers while allowing
  // the API/UI to pass an explicit transaction-month scope.
  if (first && typeof first.prepare === 'function') {
    return { params: new URLSearchParams(), db: first, now: second || new Date() };
  }
  return { params: first || new URLSearchParams(), db: second || getDb(), now: third || new Date() };
}

function reviewWorkbench(first, second, third) {
  const { params, db, now } = normalizeReviewWorkbenchArgs(first, second, third);
  const requestedMonth = typeof params.get === 'function' ? params.get('month') : null;
  const month = requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? requestedMonth
    : null;
  const sections = {
    human_confirmations: listHumanConfirmations({ status: 'pending', now }, db).map(humanConfirmationItem),
    actionable_reviews: [],
    owner_unresolved: ownerUnresolvedItems(db, month),
    conflicts: [],
  };
  const partialErrors = [];
  for (const task of listReviewTasks({ status: 'open' }, db)) {
    try {
      const item = hydrateTask(task, db);
      if (task.task_kind === 'source_conflict') sections.conflicts.push(item);
      else sections.actionable_reviews.push(item);
    } catch (error) {
      partialErrors.push({
        kind: 'review_resource_hydration_failed', task_key: task.task_key,
        resource_type: task.resource_type, resource_key: task.resource_key,
        message: error.message,
      });
      sections.actionable_reviews.push(unsupportedItem(task));
    }
  }
  const counts = Object.fromEntries(Object.entries(sections).map(([key, rows]) => [key, rows.length]));
  counts.total_attention = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    contract: CONTRACT,
    generated_at: now.toISOString(),
    scope: {
      month,
      kind: month ? 'transaction_month' : 'global',
      note: month
        ? `目前只列出 ${month} 的待釐清交易；確認提案與 typed review 仍依其自身證據範圍顯示。`
        : '目前列出所有期間的待釐清項目。',
    },
    counts,
    sections,
    partial_errors: partialErrors,
  };
}

module.exports = { CONTRACT, reviewWorkbench };
