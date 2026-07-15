function makeBlocker(kind, count, label, recommendedAction) {
  return {
    kind,
    severity: 'blocks_complete',
    count,
    label,
    recommended_action: recommendedAction,
  };
}

function makeReportBlocker(kind, label, recommendedAction, details = {}) {
  return {
    ...details,
    kind,
    severity: 'blocks_complete',
    label,
    recommended_action: recommendedAction,
  };
}

function uniqueBy(items, keyForItem) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyForItem(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function coverageBase({
  entityId = 'personal',
  periodStart = null,
  periodEnd = null,
  asOfDate = null,
  basis = null,
  currency = 'TWD',
  includedAccountIds = [],
  defaultedFields = [],
  missingBalanceSnapshots = [],
  staleBalanceSnapshots = [],
  unreviewedTransactionCount = 0,
  unmappedTransactionCount = 0,
  unmatchedTransferCount = 0,
  reconciliationDeltaCents = null,
  blockers = [],
  warnings = [],
}) {
  return {
    entity_id: entityId,
    period_start: periodStart,
    period_end: periodEnd,
    as_of_date: asOfDate,
    basis,
    currency,
    included_account_ids: [...includedAccountIds],
    defaulted_fields: [...defaultedFields],
    missing_required_accounts: [],
    missing_balance_snapshots: [...missingBalanceSnapshots],
    stale_balance_snapshots: [...staleBalanceSnapshots],
    unreviewed_transaction_count: unreviewedTransactionCount,
    unmapped_transaction_count: unmappedTransactionCount,
    unmatched_transfer_count: unmatchedTransferCount,
    reconciliation_delta_cents: reconciliationDeltaCents,
    blockers: uniqueBy(blockers, (item) => [
      item.kind,
      item.account_id ?? '',
      item.transaction_id ?? '',
      item.resource_key ?? '',
      item.boundary ?? '',
    ].join(':')),
    warnings: uniqueBy(warnings, (item) => [
      item.kind,
      item.account_id ?? '',
      item.resource_key ?? '',
      item.boundary ?? '',
    ].join(':')),
  };
}

function buildBalanceSheetCoverage({
  entityId = 'personal',
  asOfDate = null,
  currency = 'TWD',
  includedAccountIds = [],
  defaultedFields = [],
  usableLineCount = 0,
  missingBalanceSnapshots = [],
  staleBalanceSnapshots = [],
  reconciliationDeltaCents = 0,
  reconciliationAvailable = false,
  blockers = [],
  warnings = [],
}) {
  const allBlockers = [...blockers];
  for (const item of missingBalanceSnapshots) {
    allBlockers.push(makeReportBlocker(
      'missing_balance_snapshot',
      `No current balance evidence is available for ${item.label || `account ${item.account_id}`}.`,
      'add_balance_snapshot',
      item,
    ));
  }
  for (const item of staleBalanceSnapshots) {
    allBlockers.push(makeReportBlocker(
      'stale_balance_snapshot',
      `${item.label || `Account ${item.account_id}`} uses a balance dated ${item.snapshot_date}.`,
      'refresh_balance_snapshot',
      item,
    ));
  }

  let status = 'complete';
  if (includedAccountIds.length === 0 || usableLineCount === 0) status = 'empty';
  else if (reconciliationAvailable && reconciliationDeltaCents !== 0) status = 'unreconciled';
  else if (allBlockers.length > 0) status = 'partial';

  return {
    status,
    ...coverageBase({
      entityId,
      asOfDate,
      currency,
      includedAccountIds,
      defaultedFields,
      missingBalanceSnapshots,
      staleBalanceSnapshots,
      reconciliationDeltaCents: reconciliationAvailable ? reconciliationDeltaCents : null,
      blockers: allBlockers,
      warnings,
    }),
  };
}

function buildCashFlowCoverage({
  entityId = 'personal',
  periodStart = null,
  periodEnd = null,
  currency = 'TWD',
  includedAccountIds = [],
  defaultedFields = [],
  transactionCount = 0,
  missingBalanceSnapshots = [],
  staleBalanceSnapshots = [],
  unreviewedTransactionCount = 0,
  unmappedTransactionCount = 0,
  unmatchedTransferCount = 0,
  reconciliationDeltaCents = null,
  boundariesAvailable = false,
  blockers = [],
  warnings = [],
}) {
  const allBlockers = [...blockers];
  for (const item of missingBalanceSnapshots) {
    allBlockers.push(makeReportBlocker(
      'missing_balance_snapshot',
      `No ${item.boundary || 'boundary'} cash balance is available for ${item.label || `account ${item.account_id}`}.`,
      'add_balance_snapshot',
      item,
    ));
  }
  for (const item of staleBalanceSnapshots) {
    allBlockers.push(makeReportBlocker(
      'stale_balance_snapshot',
      `${item.label || `Account ${item.account_id}`} uses a stale ${item.boundary || 'boundary'} balance dated ${item.snapshot_date}.`,
      'refresh_balance_snapshot',
      item,
    ));
  }

  let status = 'complete';
  if (includedAccountIds.length === 0 || transactionCount === 0) status = 'empty';
  else if (boundariesAvailable && reconciliationDeltaCents !== 0) status = 'unreconciled';
  else if (allBlockers.length > 0 || unreviewedTransactionCount > 0 || unmappedTransactionCount > 0 || unmatchedTransferCount > 0) status = 'partial';

  return {
    status,
    ...coverageBase({
      entityId,
      periodStart,
      periodEnd,
      asOfDate: periodEnd,
      basis: 'cash',
      currency,
      includedAccountIds,
      defaultedFields,
      missingBalanceSnapshots,
      staleBalanceSnapshots,
      unreviewedTransactionCount,
      unmappedTransactionCount,
      unmatchedTransferCount,
      reconciliationDeltaCents: boundariesAvailable ? reconciliationDeltaCents : null,
      blockers: allBlockers,
      warnings,
    }),
  };
}

function buildIncomeStatementCoverage({
  entityId = 'personal',
  periodStart = null,
  periodEnd = null,
  basis = 'card_accrual_management',
  currency = 'TWD',
  includedAccountIds = [],
  defaultedFields = [],
  transactionCount = 0,
  unmappedTransactionCount = 0,
  unreviewedTransactionCount = 0,
  ownerUnresolvedTransactionCount = 0,
  ownerUnresolvedInflowCents = 0,
  ownerUnresolvedOutflowCents = 0,
  unmatchedTransferCount = 0,
}) {
  const blockers = [];
  const warnings = [];

  if (unmappedTransactionCount > 0) {
    blockers.push(makeBlocker(
      'unmapped_report_line',
      unmappedTransactionCount,
      `${unmappedTransactionCount} 筆交易需要指定報表科目。`,
      'review_report_mappings',
    ));
  }

  if (unreviewedTransactionCount > 0) {
    blockers.push(makeBlocker(
      'unreviewed_transaction',
      unreviewedTransactionCount,
      `${unreviewedTransactionCount} 筆交易尚未審核。`,
      'review_transactions',
    ));
  }

  if (ownerUnresolvedTransactionCount > 0) {
    blockers.push(makeBlocker(
      'owner_unresolved_transaction',
      ownerUnresolvedTransactionCount,
      `${ownerUnresolvedTransactionCount} 筆交易的現金移動已確認，但用途無法確認；流入與流出金額已另行揭露。`,
      'review_owner_unresolved',
    ));
  }

  if (unmatchedTransferCount > 0) {
    blockers.push(makeBlocker(
      'unmatched_transfer',
      unmatchedTransferCount,
      `${unmatchedTransferCount} 筆疑似轉帳交易需要審核。`,
      'review_transfers',
    ));
  }

  if (defaultedFields.length > 0) {
    warnings.push({
      kind: 'defaulted_scope',
      severity: 'info',
      fields: defaultedFields,
      label: `使用預設報表範圍：${defaultedFields.join(', ')}`,
    });
  }

  let status = 'complete';
  if (transactionCount === 0) status = 'empty';
  else if (unreviewedTransactionCount > 0 || ownerUnresolvedTransactionCount > 0 || unmatchedTransferCount > 0) status = 'partial';
  else if (unmappedTransactionCount > 0) status = 'unmapped';

  return {
    status,
    entity_id: entityId,
    period_start: periodStart,
    period_end: periodEnd,
    as_of_date: periodEnd,
    basis,
    currency,
    included_account_ids: includedAccountIds,
    defaulted_fields: defaultedFields,
    missing_required_accounts: [],
    missing_balance_snapshots: [],
    stale_balance_snapshots: [],
    unreviewed_transaction_count: unreviewedTransactionCount,
    owner_unresolved_transaction_count: ownerUnresolvedTransactionCount,
    owner_unresolved_inflow_cents: ownerUnresolvedInflowCents,
    owner_unresolved_outflow_cents: ownerUnresolvedOutflowCents,
    unmapped_transaction_count: unmappedTransactionCount,
    unmatched_transfer_count: unmatchedTransferCount,
    reconciliation_delta_cents: 0,
    blockers,
    warnings,
  };
}

module.exports = {
  buildIncomeStatementCoverage,
  buildBalanceSheetCoverage,
  buildCashFlowCoverage,
  makeReportBlocker,
};
