// 交易查詢 + 寫入（patch/batch 包 DB transaction）。跨模組依賴：corrections.logCorrection、rules.incrementRuleStat。
const { getDb, safeInt, directionFromFlow, normalizeForRule } = require('./core');
const { logCorrection } = require('./corrections');
const { incrementRuleStat } = require('./rules');
const {
  EDITABLE_FIELDS,
  CLASSIFICATION_FIELDS,
  DIMENSION_MAP,
  LOW_CONFIDENCE_THRESHOLD,
  CONFIDENCE_TIERS,
} = require('../constants');

// 「實際消費」認定條件（排除信用卡繴款/移轉）
const SPEND_WHERE = `
  outflow > 0
  AND flow_type <> '信用卡繳款/移轉'
`;

const TOP_MOVER_MIN_PREVIOUS_RATIO = 0.2;
const TOP_MOVER_MIN_ABSOLUTE_CENTS = 100000;
const FIXED_BASELINE_MONTHS = 3;
const HIGH_CONFIDENCE_THRESHOLD =
  CONFIDENCE_TIERS.find((tier) => tier.tier === 'high')?.min ?? 0.8;

function selectedMonth(params) {
  const month = params?.get ? params.get('month') : params;
  if (!month || month === 'all') return null;
  return month;
}

// 排序白名單（getTransactions 用；含 t. 前綴）
const ALLOWED_SORT = {
  date: 't.transaction_date',
  name: 't.name',
  amount: 't.amount',
  outflow: 't.outflow',
  category: 't.category_primary',
  confidence: 't.ai_confidence',
};

function buildTransactionWhere(params, tableAlias = '') {
  const where = [];
  const values = {};
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const month = selectedMonth(params);
  if (month) {
    where.push(`${prefix}transaction_month = $month`);
    values.$month = month;
  }

  where.push(`(${prefix}flow_type IS NULL OR (${prefix}flow_type <> '信用卡繳款/移轉' AND ${prefix}flow_type <> '信用卡繳款'))`);

  const view = params.get('view') || 'all';

  if (view === 'card') where.push(`${prefix}source_type LIKE '%信用卡%'`);
  if (view === 'bank') where.push(`${prefix}source_type LIKE '%帳戶%'`);
  if (view === 'review') where.push(`(${prefix}category_primary = '待確認')`);
  if (view === 'unreviewed') where.push(`(${prefix}classification_source = 'pending' OR (${prefix}classification_source = 'rule' AND ${prefix}reviewed = 0))`);
  // needs-review：與 getMeta counts.needsReview 同一判定（單一規則，避免散落）。哨兵留階段2移除。
  if (view === 'needs-review') where.push(`(${prefix}reviewed = 0 AND (${prefix}ai_confidence < 0.5 OR ${prefix}ai_confidence IS NULL OR ${prefix}classification_source = 'pending'))`);

  const category = params.get('category');
  if (category) { where.push(`${prefix}category_primary = $category`); values.$category = category; }
  const source = params.get('source');
  if (source) { where.push(`${prefix}source_type = $source`); values.$source = source; }
  const flow = params.get('flow');
  if (flow) { where.push(`${prefix}flow_type = $flow`); values.$flow = flow; }
  const search = params.get('search');
  if (search) {
    where.push(`(${prefix}name LIKE $search OR ${prefix}raw_info LIKE $search OR ${prefix}memo LIKE $search OR ${prefix}judgment_reason LIKE $search)`);
    values.$search = `%${search}%`;
  }
  const matchKey = params.get('matchKey');
  if (matchKey) {
    where.push(`${prefix}import_match_key = $matchKey`);
    values.$matchKey = matchKey;
  }

  const idsRaw = params.get('ids');
  if (idsRaw) {
    const ids = String(idsRaw)
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 500);
    if (ids.length > 0) {
      const placeholders = ids.map((id, index) => {
        const key = `$id${index}`;
        values[key] = id;
        return key;
      });
      where.push(`${prefix}id IN (${placeholders.join(', ')})`);
    }
  }

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', values };
}

function getMonthlyReport(db, selectedMonth) {
  if (!selectedMonth) return null;

  const currentSpend = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN ${SPEND_WHERE} THEN outflow ELSE 0 END), 0) AS spend
    FROM transactions
    WHERE transaction_month = $month
  `).get({ $month: selectedMonth }).spend || 0;

  const previousMonths = db.prepare(`
    SELECT
      transaction_month AS month,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} THEN outflow ELSE 0 END), 0) AS spend
    FROM transactions
    WHERE transaction_month < $month
    GROUP BY transaction_month
    ORDER BY transaction_month DESC
    LIMIT 3
  `).all({ $month: selectedMonth }).reverse();

  const previousAverageSpend = previousMonths.length > 0
    ? Math.round(previousMonths.reduce((sum, row) => sum + Number(row.spend || 0), 0) / previousMonths.length)
    : 0;

  const previousMonth = previousMonths.length > 0
    ? previousMonths[previousMonths.length - 1].month
    : null;

  let topMovers = [];
  if (previousMonth) {
    const moverRows = db.prepare(`
      WITH categories AS (
        SELECT category_primary AS label
        FROM transactions
        WHERE transaction_month IN ($currentMonth, $previousMonth)
          AND ${SPEND_WHERE}
        GROUP BY category_primary
      ),
      current_spend AS (
        SELECT category_primary AS label, COALESCE(SUM(outflow), 0) AS spend
        FROM transactions
        WHERE transaction_month = $currentMonth
          AND ${SPEND_WHERE}
        GROUP BY category_primary
      ),
      previous_spend AS (
        SELECT category_primary AS label, COALESCE(SUM(outflow), 0) AS spend
        FROM transactions
        WHERE transaction_month = $previousMonth
          AND ${SPEND_WHERE}
        GROUP BY category_primary
      )
      SELECT
        categories.label,
        COALESCE(current_spend.spend, 0) AS currentSpend,
        COALESCE(previous_spend.spend, 0) AS previousSpend
      FROM categories
      LEFT JOIN current_spend ON current_spend.label = categories.label
      LEFT JOIN previous_spend ON previous_spend.label = categories.label
    `).all({ $currentMonth: selectedMonth, $previousMonth: previousMonth });

    topMovers = moverRows
      .map((row) => {
        const previousSpend = Number(row.previousSpend || 0);
        const current = Number(row.currentSpend || 0);
        const delta = current - previousSpend;
        // Significant movers must clear both a relative bar (20% of previous-month category spend)
        // and a practical NT$1,000 floor, so tiny categories do not dominate the answer card.
        const threshold = Math.max(
          Math.round(previousSpend * TOP_MOVER_MIN_PREVIOUS_RATIO),
          TOP_MOVER_MIN_ABSOLUTE_CENTS,
        );
        return {
          label: row.label || '未分類',
          currentSpend: current,
          previousSpend,
          delta,
          threshold,
        };
      })
      .filter((row) => Math.abs(row.delta) >= row.threshold)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 3);
  }

  const baselineMonths = db.prepare(`
    SELECT DISTINCT transaction_month AS month
    FROM transactions
    WHERE transaction_month <= $month
    ORDER BY transaction_month DESC
    LIMIT ${FIXED_BASELINE_MONTHS}
  `).all({ $month: selectedMonth }).map((row) => row.month);

  let fixedBaseline = [];
  if (baselineMonths.length === FIXED_BASELINE_MONTHS) {
    const monthParams = Object.fromEntries(
      baselineMonths.map((month, index) => [`$month${index}`, month]),
    );
    const monthList = baselineMonths.map((_, index) => `$month${index}`).join(', ');
    const baselineRows = db.prepare(`
      SELECT transaction_month, import_match_key, name, outflow
      FROM transactions
      WHERE transaction_month IN (${monthList})
        AND ${SPEND_WHERE}
    `).all({
      ...monthParams,
    });

    const groups = new Map();
    for (const row of baselineRows) {
      const normalizedName = normalizeForRule(row.name);
      const stableImportKey = row.import_match_key && String(row.import_match_key).trim();
      const matchKey = normalizedName || stableImportKey;
      if (!matchKey) continue;
      const item = groups.get(matchKey) || {
        matchKey,
        matchKeySource: normalizedName ? 'normalized_name' : 'import_match_key',
        sampleName: row.name || matchKey,
        activeMonthsSet: new Set(),
        currentRows: 0,
        currentTotal: 0,
      };
      item.activeMonthsSet.add(row.transaction_month);
      if (row.transaction_month === selectedMonth) {
        item.sampleName = row.name || item.sampleName;
        item.currentRows += 1;
        item.currentTotal += Number(row.outflow || 0);
      }
      groups.set(matchKey, item);
    }

    // Fixed baseline uses the latest 3 transaction months ending at the selected month.
    // Requiring all 3 months catches recurring spend while excluding one-off purchases.
    fixedBaseline = [...groups.values()]
      .map((item) => ({
        matchKey: item.matchKey,
        matchKeySource: item.matchKeySource,
        sampleName: item.sampleName,
        activeMonths: item.activeMonthsSet.size,
        currentRows: item.currentRows,
        currentTotal: item.currentTotal,
      }))
      .filter((item) =>
        item.activeMonths === FIXED_BASELINE_MONTHS && item.currentTotal > 0
      )
      .sort((a, b) => b.currentTotal - a.currentTotal || a.matchKey.localeCompare(b.matchKey))
      .slice(0, 8);
  }

  return {
    comparison: {
      currentSpend,
      previousAverageSpend,
      previousMonths,
      delta: currentSpend - previousAverageSpend,
      percentDelta: previousAverageSpend > 0
        ? (currentSpend - previousAverageSpend) / previousAverageSpend
        : null,
    },
    topMovers,
    fixedBaseline: {
      months: baselineMonths.slice().reverse(),
      monthsRequired: FIXED_BASELINE_MONTHS,
      items: fixedBaseline,
    },
    parameters: {
      topMoverMinPreviousRatio: TOP_MOVER_MIN_PREVIOUS_RATIO,
      topMoverMinAbsoluteCents: TOP_MOVER_MIN_ABSOLUTE_CENTS,
      fixedBaselineMonths: FIXED_BASELINE_MONTHS,
    },
  };
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
      // 待人類處理：未審 + AI 沒把握（低信心/null/pending/哨兵）。哨兵留階段2移除。
      needsReview: db.prepare(`SELECT COUNT(*) AS count FROM transactions WHERE reviewed = 0 AND (ai_confidence < 0.5 OR ai_confidence IS NULL OR classification_source = 'pending')`).get().count,
    },
    months: { transaction: transactionMonths },
    filters: {
      sources: distinct('source_type'),
      categories: distinct('category_primary'),
      flows: distinct('flow_type'),
    },
  };
}

function getSummary(params) {
  const db = getDb();
  const { sql, values } = buildTransactionWhere(params);
  const month = selectedMonth(params);
  const select = (expression) => db.prepare(`SELECT COALESCE(${expression}, 0) AS value FROM transactions ${sql}`).get(values).value || 0;
  // Overview 月結卡與既有 summary 同步載入，避免為同一篩選狀態多打一支 meta request。
  const classification = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN classification_source = 'rule' THEN 1 ELSE 0 END), 0) AS rule,
      COALESCE(SUM(CASE WHEN classification_source = 'ai' THEN 1 ELSE 0 END), 0) AS ai,
      COALESCE(SUM(CASE WHEN classification_source = 'human' THEN 1 ELSE 0 END), 0) AS human,
      COALESCE(SUM(CASE WHEN classification_source = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN reviewed = 1 THEN 1 ELSE 0 END), 0) AS reviewed,
      COALESCE(SUM(CASE WHEN ai_confidence >= ${HIGH_CONFIDENCE_THRESHOLD} THEN 1 ELSE 0 END), 0) AS highConfidence,
      COALESCE(SUM(CASE WHEN ai_confidence < ${LOW_CONFIDENCE_THRESHOLD} OR ai_confidence IS NULL OR classification_source = 'pending' THEN 1 ELSE 0 END), 0) AS lowConfidence,
      COALESCE(SUM(CASE WHEN reviewed = 0 AND (ai_confidence < 0.5 OR ai_confidence IS NULL OR classification_source = 'pending') THEN 1 ELSE 0 END), 0) AS needsReview
    FROM transactions ${sql}
  `).get(values);
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
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} AND (ai_confidence < 0.5 OR ai_confidence IS NULL) THEN outflow ELSE 0 END), 0) AS reviewSpend,
      COALESCE(SUM(CASE WHEN source_type LIKE '%信用卡%' AND flow_type = '信用卡消費' THEN outflow ELSE 0 END), 0) AS cardSpend,
      COALESCE(SUM(CASE WHEN source_type LIKE '%帳戶%' AND outflow > 0 THEN outflow ELSE 0 END), 0) AS bankOutflow,
      COALESCE(SUM(CASE WHEN flow_type = '信用卡繳款/移轉' THEN outflow ELSE 0 END), 0) AS transferOutflow
    FROM transactions ${sql}
  `).get(values);
  return {
    ...base, ...metrics,
    moneyLeftAfterSpend: base.inflow - metrics.actualSpend,
    netCashMovement: base.inflow - base.outflow,
    latestBankBalance: latestBalance || null,
    selectedMonth: month,
    view: params.get('view') || 'all',
    rawOutflow: select('SUM(outflow)'),
    monthlyReport: getMonthlyReport(db, month),
    classification: {
      ...classification,
      automationRate: classification.total > 0 ? classification.rule / classification.total : 0,
      reviewedRate: classification.total > 0 ? classification.reviewed / classification.total : 0,
      highConfidenceRate: classification.total > 0 ? classification.highConfidence / classification.total : 0,
      lowConfidenceRate: classification.total > 0 ? classification.lowConfidence / classification.total : 0,
    },
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
      COALESCE(SUM(CASE WHEN classification_source = 'rule' THEN 1 ELSE 0 END), 0) AS ruleRows,
      CASE WHEN COUNT(*) > 0
        THEN ROUND(100.0 * COALESCE(SUM(CASE WHEN classification_source = 'rule' THEN 1 ELSE 0 END), 0) / COUNT(*), 1)
        ELSE 0
      END AS automationRate,
      COALESCE(SUM(inflow), 0) AS inflow,
      COALESCE(SUM(outflow), 0) AS outflow,
      COALESCE(SUM(CASE WHEN ${SPEND_WHERE} THEN outflow ELSE 0 END), 0) AS spend
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

function getSpending(month, category) {
  const db = getDb();
  const where = ['outflow > 0'];
  const params = {};
  const normalizedMonth = selectedMonth(month);
  if (normalizedMonth) { where.push('transaction_month = $month'); params.$month = normalizedMonth; }
  if (category) { where.push('category_primary = $category'); params.$category = category; }
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
  if (updates.length === 0) {
    if (current.reviewed !== 1) {
      db.prepare('UPDATE transactions SET reviewed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(txnId);
      const reviewed = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txnId);
      return { status: 200, body: { ok: true, message: '已標記為已審', transaction: reviewed } };
    }
    return { status: 200, body: { ok: true, message: '無變更', transaction: current } };
  }

  db.exec('BEGIN');
  try {
    const setClause = updates.join(', ');
    const updateValues = logEntries.map((e) => e.newValue);
    // 只有動到分類欄（category_primary）才視為「人類覆寫分類」：
    // 清 rule_id + 標 classification_source='human' + 規則 overridden+1。
    // 只改 memo 不算覆寫（不污染規則準確率統計、不跳 SourceBadge）。
    if (touchedClassification) {
      db.prepare(`UPDATE transactions SET ${setClause}, classification_source = 'human', rule_id = NULL, reviewed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...updateValues, txnId);
      if (current.rule_id) incrementRuleStat(db, current.rule_id, 'overridden');
    } else {
      db.prepare(`UPDATE transactions SET ${setClause}, reviewed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...updateValues, txnId);
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
        setParts.push("reviewed = 1");
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
