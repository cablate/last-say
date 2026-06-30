// 交易查詢 + 寫入（patch/batch 包 DB transaction）。跨模組依賴：corrections.logCorrection、rules.incrementRuleStat。
const { getDb, safeInt, directionFromFlow, normalizeForRule } = require('./core');
const { logCorrection } = require('./corrections');
const { incrementRuleStat } = require('./rules');
const { EDITABLE_FIELDS, CLASSIFICATION_FIELDS, DIMENSION_MAP } = require('../constants');

// 「實際消費」認定條件（排除移轉、信用卡繳款、不列入）
const SPEND_WHERE = `
  outflow > 0
  AND owner_primary <> '移轉不算'
  AND flow_type <> '信用卡繳款/移轉'
  AND necessity <> '不列入'
`;

// 排序白名單（getTransactions 用；含 t. 前綴）
const ALLOWED_SORT = {
  date: 't.transaction_date',
  name: 't.name',
  amount: 't.amount',
  outflow: 't.outflow',
  category: 't.category_primary',
  owner: 't.owner_primary',
  necessity: 't.necessity',
};

function buildTransactionWhere(params, tableAlias = '') {
  const where = [];
  const values = {};
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const month = params.get('month');
  if (month) {
    where.push(`${prefix}transaction_month = $month`);
    values.$month = month;
  }

  where.push(`(${prefix}flow_type IS NULL OR (${prefix}flow_type <> '信用卡繳款/移轉' AND ${prefix}flow_type <> '信用卡繳款'))`);

  const view = params.get('view') || 'all';
  const scope = params.get('scope') || 'all';

  if (scope === 'personal') where.push(`${prefix}owner_primary = '個人'`);
  else if (scope === 'business') where.push(`${prefix}owner_primary IN ('事業', '事業候選')`);

  if (view === 'card') where.push(`${prefix}source_type LIKE '%信用卡%'`);
  if (view === 'bank') where.push(`${prefix}source_type LIKE '%帳戶%'`);
  if (view === 'saving') where.push(`(${prefix}necessity IN ('可節省', '可優化') AND ${prefix}owner_primary <> '移轉不算')`);
  if (view === 'review') where.push(`(${prefix}owner_primary = '待確認' OR ${prefix}category_primary = '待確認' OR ${prefix}necessity = '需確認')`);
  if (view === 'unreviewed') where.push(`(${prefix}classification_source = 'pending' OR (${prefix}classification_source = 'rule' AND ${prefix}reviewed = 0))`);

  const owner = params.get('owner');
  if (owner) { where.push(`${prefix}owner_primary = $owner`); values.$owner = owner; }
  const category = params.get('category');
  if (category) { where.push(`${prefix}category_primary = $category`); values.$category = category; }
  const necessity = params.get('necessity');
  if (necessity) { where.push(`${prefix}necessity = $necessity`); values.$necessity = necessity; }
  const source = params.get('source');
  if (source) { where.push(`${prefix}source_type = $source`); values.$source = source; }
  const flow = params.get('flow');
  if (flow) { where.push(`${prefix}flow_type = $flow`); values.$flow = flow; }
  const search = params.get('search');
  if (search) {
    where.push(`(${prefix}name LIKE $search OR ${prefix}raw_info LIKE $search OR ${prefix}memo LIKE $search OR ${prefix}judgment_reason LIKE $search)`);
    values.$search = `%${search}%`;
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', values };
}

function getMeta() {
  const db = getDb();
  const transactionMonths = db.prepare(`
    SELECT transaction_month AS month, COUNT(*) AS rows
    FROM transactions GROUP BY transaction_month ORDER BY transaction_month
  `).all();
  const distinct = (column) => db.prepare(`
    SELECT ${column} AS value, COUNT(*) AS rows
    FROM transactions GROUP BY ${column} ORDER BY rows DESC, value
  `).all();
  return {
    databasePath: require('../db').DB_PATH,
    generatedAt: new Date().toISOString(),
    counts: {
      transactions: db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count,
      sourceLinks: db.prepare('SELECT COUNT(*) AS count FROM transaction_sources').get().count,
      sources: db.prepare('SELECT COUNT(*) AS count FROM sources').get().count,
      accounts: db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count,
    },
    months: { transaction: transactionMonths },
    filters: {
      sources: distinct('source_type'),
      owners: distinct('owner_primary'),
      categories: distinct('category_primary'),
      necessities: distinct('necessity'),
      flows: distinct('flow_type'),
    },
  };
}

function getSummary(params) {
  const db = getDb();
  const { sql, values } = buildTransactionWhere(params);
  const select = (expression) => db.prepare(`SELECT COALESCE(${expression}, 0) AS value FROM transactions ${sql}`).get(values).value || 0;
  const latestBalance = db.prepare(`
    SELECT balance, transaction_date AS date, name
    FROM transactions
    WHERE balance IS NOT NULL AND source_type LIKE '%帳戶%'
    ORDER BY transaction_date DESC, CAST(NULLIF(account_original_order, '') AS INTEGER) DESC, id DESC
    LIMIT 1
  `).get();
  const base = db.prepare(`
    SELECT
      COUNT(*) AS rows,
      COALESCE(SUM(inflow), 0) AS inflow,
      COALESCE(SUM(outflow), 0) AS outflow,
      COALESCE(SUM(amount), 0) AS signedTotal
    FROM transactions ${sql}
  `).get(values);
  const metrics = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} THEN outflow ELSE 0 END), 0) AS actualSpend,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} AND owner_primary = '個人' THEN outflow ELSE 0 END), 0) AS personalSpend,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} AND owner_primary IN ('事業', '事業候選') THEN outflow ELSE 0 END), 0) AS businessSpend,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} AND necessity IN ('必要', '事業必要') THEN outflow ELSE 0 END), 0) AS requiredSpend,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} AND necessity = '可節省' THEN outflow ELSE 0 END), 0) AS saveableSpend,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} AND necessity = '可優化' THEN outflow ELSE 0 END), 0) AS optimizableSpend,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} AND (necessity = '需確認' OR owner_primary = '待確認' OR category_primary = '待確認') THEN outflow ELSE 0 END), 0) AS reviewSpend,
      COALESCE(SUM(CASE WHEN source_type LIKE '%信用卡%' AND flow_type = '信用卡消費' THEN outflow ELSE 0 END), 0) AS cardSpend,
      COALESCE(SUM(CASE WHEN source_type LIKE '%帳戶%' AND outflow > 0 THEN outflow ELSE 0 END), 0) AS bankOutflow,
      COALESCE(SUM(CASE WHEN owner_primary = '移轉不算' OR flow_type = '信用卡繳款/移轉' THEN outflow ELSE 0 END), 0) AS transferOutflow
    FROM transactions ${sql}
  `).get(values);
  return {
    ...base, ...metrics,
    moneyLeftAfterSpend: base.inflow - metrics.actualSpend,
    netCashMovement: base.inflow - base.outflow,
    latestBankBalance: latestBalance || null,
    selectedMonth: params.get('month') || null,
    view: params.get('view') || 'all',
    rawOutflow: select('SUM(outflow)'),
  };
}

function getBreakdown(params) {
  const db = getDb();
  const dimension = params.get('dimension') || 'category';
  const column = DIMENSION_MAP[dimension] || DIMENSION_MAP.category;
  const { sql, values } = buildTransactionWhere(params);
  return db.prepare(`
    SELECT
      ${column} AS label,
      COUNT(*) AS rows,
      COALESCE(SUM(inflow), 0) AS inflow,
      COALESCE(SUM(outflow), 0) AS outflow,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} THEN outflow ELSE 0 END), 0) AS spend,
      COALESCE(SUM(amount), 0) AS signedTotal
    FROM transactions ${sql}
    GROUP BY ${column}
    ORDER BY spend DESC, outflow DESC, rows DESC, label
  `).all(values);
}

function getTrend(params) {
  const db = getDb();
  const { sql, values } = buildTransactionWhere(new URLSearchParams([...params].filter(([key]) => key !== 'month')));
  return db.prepare(`
    SELECT
      transaction_month AS month,
      COUNT(*) AS rows,
      COALESCE(SUM(inflow), 0) AS inflow,
      COALESCE(SUM(outflow), 0) AS outflow,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} THEN outflow ELSE 0 END), 0) AS spend,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} AND owner_primary = '個人' THEN outflow ELSE 0 END), 0) AS personalSpend,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} AND owner_primary IN ('事業', '事業候選') THEN outflow ELSE 0 END), 0) AS businessSpend
    FROM transactions ${sql}
    GROUP BY transaction_month ORDER BY month
  `).all(values);
}

function getTransactions(params) {
  const db = getDb();
  const sort = ALLOWED_SORT[params.get('sort')] || 't.transaction_date';
  const direction = params.get('direction') === 'desc' ? 'DESC' : 'ASC';
  const limit = safeInt(params.get('limit'), 1000, 2000);
  const offset = safeInt(params.get('offset'), 0);
  const filtered = buildTransactionWhere(params, 't');
  const rows = db.prepare(`
    SELECT
      t.*,
      a.name AS account_name,
      s.description AS source_description,
      (SELECT json_group_array(json_object('type', tags.tag_type, 'name', tags.name, 'color', tags.color))
         FROM transaction_tags JOIN tags ON tags.id = transaction_tags.tag_id
         WHERE transaction_tags.transaction_id = t.id) AS tags_json,
      (SELECT COUNT(*) FROM transaction_sources ts WHERE ts.transaction_id = t.id) AS source_link_count,
      (SELECT COUNT(*) FROM correction_log cl WHERE cl.transaction_id = t.id) AS correction_count
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN sources s ON s.id = t.first_source_id
    ${filtered.sql}
    ORDER BY ${sort} ${direction}, t.id ASC
    LIMIT $limit OFFSET $offset
  `).all({ ...filtered.values, $limit: limit, $offset: offset });
  const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions t ${filtered.sql}`).get(filtered.values).count;
  return {
    total, limit, offset,
    rows: rows.map((row) => ({ ...row, tags: JSON.parse(row.tags_json || '[]'), tags_json: undefined })),
  };
}

function getBalanceHistory() {
  const db = getDb();
  return db.prepare(`
    SELECT month, balance FROM (
      SELECT
        transaction_month AS month, balance,
        ROW_NUMBER() OVER (PARTITION BY transaction_month ORDER BY transaction_date DESC, id DESC) AS rn
      FROM transactions
      WHERE balance IS NOT NULL AND source_type LIKE '%帳戶%'
    ) WHERE rn = 1 ORDER BY month
  `).all();
}

function getSpending(month, category, scope) {
  const db = getDb();
  const where = ['outflow > 0'];
  const params = {};
  if (month) { where.push('transaction_month = $month'); params.$month = month; }
  if (category) { where.push('category_primary = $category'); params.$category = category; }
  if (scope === 'personal') where.push("owner_primary = '個人'");
  else if (scope === 'business') where.push("owner_primary IN ('事業', '事業候選')");
  const sql = `SELECT
    COALESCE(SUM(outflow), 0) AS total,
    COUNT(*) AS count,
    COALESCE(ROUND(AVG(outflow), 0), 0) AS average
  FROM transactions WHERE ${where.join(' AND ')}`;
  return db.prepare(sql).get(params);
}

// 批次標記交易為「已審」（reviewed=1）。人類認可規則套用 = 隱性正向信號。
function markReviewed(ids, db = getDb()) {
  if (!Array.isArray(ids) || ids.length === 0) return { reviewed: 0 };
  const MAX = 500;
  const work = ids.slice(0, MAX).map((id) => Number(id)).filter((n) => Number.isFinite(n));
  if (work.length === 0) return { reviewed: 0 };
  const placeholders = work.map(() => '?').join(',');
  const r = db.prepare(`UPDATE transactions SET reviewed = 1 WHERE id IN (${placeholders})`).run(...work);
  return { reviewed: r.changes, truncated: ids.length > MAX };
}

// PATCH /api/transactions/:id — 單筆修正。UPDATE + log + 統計包在同一 transaction。
// 標 classification_source='human' + 清 rule_id + 覆寫規則統計 + correction 自帶 match_key 脈絡。
function patchTransaction(txnId, body) {
  const db = getDb();
  const current = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txnId);
  if (!current) return { status: 404, body: { error: 'Transaction not found' } };

  const updates = [];
  const logEntries = [];
  let touchedClassification = false;
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined && String(body[field]) !== String(current[field] ?? '')) {
      updates.push(`${field} = ?`);
      logEntries.push({ field, oldValue: current[field], newValue: body[field] });
      if (CLASSIFICATION_FIELDS.includes(field)) touchedClassification = true;
    }
  }
  if (updates.length === 0) return { status: 200, body: { ok: true, message: '無變更', transaction: current } };

  db.exec('BEGIN');
  try {
    const setClause = updates.join(', ');
    const updateValues = logEntries.map((e) => e.newValue);
    // 只有動到分類欄（owner/category/necessity）才視為「人類覆寫分類」：
    // 清 rule_id + 標 classification_source='human' + 規則 overridden+1。
    // 只改 memo 不算覆寫（不污染規則準確率統計、不跳 SourceBadge）。
    if (touchedClassification) {
      db.prepare(`UPDATE transactions SET ${setClause}, classification_source = 'human', rule_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...updateValues, txnId);
      if (current.rule_id) incrementRuleStat(db, current.rule_id, 'overridden');
    } else {
      db.prepare(`UPDATE transactions SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...updateValues, txnId);
    }
    const logCtx = {
      match_key: normalizeForRule(current.name),
      source_type: current.source_type || null,
      direction: directionFromFlow(current.inflow, current.outflow),
      rule_id: current.rule_id ?? null,
    };
    for (const entry of logEntries) logCorrection(db, txnId, entry.field, entry.oldValue, entry.newValue, logCtx);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txnId);
  return { status: 200, body: { ok: true, message: `已更新 ${updates.length} 個欄位`, transaction: updated } };
}

// POST /api/transactions/batch — 批次修正。整批包一個 transaction。
function batchCorrection(corrections) {
  const db = getDb();
  const results = { updated: 0, errors: 0, details: [] };
  if (!Array.isArray(corrections) || corrections.length === 0) {
    return { ...results, error: 'corrections array required' };
  }
  const MAX_BATCH = 500;
  const work = corrections.slice(0, MAX_BATCH);
  if (corrections.length > MAX_BATCH) results.truncated = true;

  db.exec('BEGIN');
  try {
    for (const item of work) {
      try {
        const current = db.prepare('SELECT * FROM transactions WHERE id = ?').get(item.id);
        if (!current) { results.errors++; results.details.push({ id: item.id, error: 'not found' }); continue; }
        const logCtx = {
          match_key: normalizeForRule(current.name),
          source_type: current.source_type || null,
          direction: directionFromFlow(current.inflow, current.outflow),
          rule_id: current.rule_id ?? null,
        };
        // 蒐集此筆變更欄位；只有動到分類欄才算覆寫規則（與 patchTransaction 一致）。
        const changes = [];
        let touchedClassification = false;
        for (const field of EDITABLE_FIELDS) {
          if (item[field] !== undefined && String(item[field]) !== String(current[field] ?? '')) {
            changes.push({ field, value: item[field], oldValue: current[field] });
            if (CLASSIFICATION_FIELDS.includes(field)) touchedClassification = true;
          }
        }
        if (changes.length === 0) { results.details.push({ id: item.id, status: 'no change' }); continue; }
        const setParts = changes.map((c) => `${c.field} = ?`);
        const setValues = changes.map((c) => c.value);
        if (touchedClassification) {
          setParts.push("classification_source = 'human'", "rule_id = NULL");
          if (current.rule_id) incrementRuleStat(db, current.rule_id, 'overridden');
        }
        setParts.push("updated_at = CURRENT_TIMESTAMP");
        db.prepare(`UPDATE transactions SET ${setParts.join(', ')} WHERE id = ?`).run(...setValues, item.id);
        for (const c of changes) logCorrection(db, item.id, c.field, c.oldValue, c.value, logCtx);
        results.updated++;
        results.details.push({ id: item.id, status: 'updated' });
      } catch (err) {
        results.errors++;
        results.details.push({ id: item.id, error: err.message });
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return results;
}

module.exports = {
  buildTransactionWhere, getMeta, getSummary, getBreakdown, getTrend,
  getTransactions, getBalanceHistory, getSpending, markReviewed,
  patchTransaction, batchCorrection,
};
