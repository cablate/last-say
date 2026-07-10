// 分類規則（classification_rules）：AI 產出/維護，本工具匯入時機械套用（getMatchingRule）。
const { getDb, clamp, directionFromFlow, normalizeForRule } = require('./core');
const { STANDARD_CATEGORIES } = require('../constants');

const CLASSIFICATION_SEMANTIC_FIELDS = [
  'match_key', 'source_type', 'direction', 'category_value', 'enabled',
];

// 匯入套用：給正規化鍵/來源/方向，取最佳啟用規則。特異性優先 → 信心度 → 樣本數。
// direction 容忍大小寫（'IN'/'OUT' 與 'in'/'out' 視為相同）——兩端點一致、AI 友善。
function getMatchingRule(matchKey, sourceType, direction, db = getDb()) {
  const dir = direction ? String(direction).toLowerCase() : null;
  return db.prepare(`
    SELECT * FROM classification_rules
    WHERE enabled = 1
      AND (match_key IS NULL OR match_key = $mk)
      AND (source_type IS NULL OR source_type = $st)
      AND (direction IS NULL OR direction = $dir)
    ORDER BY ((match_key IS NOT NULL) + (source_type IS NOT NULL) + (direction IS NOT NULL)) DESC,
             confidence DESC, sample_count DESC, id ASC
    LIMIT 1
  `).get({
    $mk: matchKey || null,
    $st: sourceType || null,
    $dir: dir,
  }) || null;
}

// 覆寫率統計：套用 +applied、人類覆寫 +overridden。col 來自白名單，安全。
function incrementRuleStat(db, ruleId, field) {
  if (!ruleId) return;
  const col = field === 'overridden' ? 'overridden_count' : 'applied_count';
  db.prepare(`UPDATE classification_rules SET ${col} = ${col} + 1 WHERE id = ?`).run(ruleId);
}

function getRawRule(id, db = getDb()) {
  return db.prepare('SELECT * FROM classification_rules WHERE id = ?').get(id) || null;
}

function getRuleImpactCounts(id, db = getDb()) {
  return db.prepare(`
    SELECT
      COUNT(*) AS linked_rows,
      COALESCE(SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END), 0) AS unreviewed_rows,
      COALESCE(SUM(CASE WHEN reviewed = 1 THEN 1 ELSE 0 END), 0) AS reviewed_rows
    FROM transactions
    WHERE classification_source = 'rule' AND rule_id = ?
  `).get(id);
}

function withRuleImpact(rule, db = getDb()) {
  if (!rule) return null;
  return { ...rule, ...getRuleImpactCounts(rule.id, db) };
}

function emptyImpact(linkedRows = 0) {
  return {
    linked_rows: Number(linkedRows) || 0,
    reclassified_rows: 0,
    pending_rows: 0,
    preserved_reviewed_rows: 0,
  };
}

function classificationSemanticsChanged(before, after) {
  return CLASSIFICATION_SEMANTIC_FIELDS.some((field) =>
    String(before?.[field] ?? '') !== String(after?.[field] ?? '')
  );
}

function ruleChangeAction(before, after) {
  if (Number(before.enabled) === 1 && Number(after.enabled) === 0) return 'disable';
  if (Number(before.enabled) === 0 && Number(after.enabled) === 1) return 'enable';
  return 'update';
}

function logRuleChange(db, { ruleId, action, before, after, impact }) {
  db.prepare(`
    INSERT INTO rule_change_log (
      rule_id, action, before_rule_json, after_rule_json,
      impacted_count, reclassified_count, pending_count, preserved_reviewed_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ruleId,
    action,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    impact.linked_rows,
    impact.reclassified_rows,
    impact.pending_rows,
    impact.preserved_reviewed_rows,
  );
}

function getRuleDependents(db, ruleId) {
  return db.prepare(`
    SELECT id, name, source_type, inflow, outflow, category_primary, reviewed
    FROM transactions
    WHERE classification_source = 'rule' AND rule_id = ?
    ORDER BY id
  `).all(ruleId);
}

// 規則分類語意改變後，只重算仍由該規則負責的交易。
// 已確認結果視為人工權威；未確認結果重新跑完整規則優先序，無命中則回 pending。
function reclassifyRuleDependents(db, dependents) {
  const impact = emptyImpact(dependents.length);
  const preserveReviewed = db.prepare(`
    UPDATE transactions
    SET classification_source = 'human', rule_id = NULL, reviewed = 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const applyReplacement = db.prepare(`
    UPDATE transactions
    SET category_primary = ?, classification_source = 'rule', rule_id = ?, reviewed = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const returnToPending = db.prepare(`
    UPDATE transactions
    SET classification_source = 'pending', rule_id = NULL, reviewed = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  for (const transaction of dependents) {
    if (Number(transaction.reviewed) === 1) {
      preserveReviewed.run(transaction.id);
      impact.preserved_reviewed_rows += 1;
      continue;
    }

    const matchKey = normalizeForRule(transaction.name);
    const direction = directionFromFlow(transaction.inflow, transaction.outflow);
    const replacement = getMatchingRule(matchKey, transaction.source_type, direction, db);
    if (replacement) {
      applyReplacement.run(replacement.category_value, replacement.id, transaction.id);
      impact.reclassified_rows += 1;
    } else {
      returnToPending.run(transaction.id);
      impact.pending_rows += 1;
    }
  }

  return impact;
}

// 把「規則列」轉成 validateRule 期望的輸入格式，供 PATCH 合併用。
function decodeRule(row) {
  if (!row) return {};
  return {
    match_key: row.match_key, source_type: row.source_type, direction: row.direction,
    category_value: row.category_value,
    confidence: row.confidence, sample_count: row.sample_count, origin: row.origin,
    enabled: row.enabled, note: row.note,
  };
}

// 驗證並清洗規則輸入。至少一個條件欄 + 至少一個結果值。
function validateRule(data) {
  // match_key：null/undefined（未指定）屬合法 source_type-only 規則，保留 null。
  // 但「有傳入卻 trim 後為空字串」（如 ''、'  '、或正規化後為空的 '7-11'）必須拒絕——
  // 因為它存成 NULL 後會在 getMatchingRule 變成萬用比對（match_key IS NULL OR ...），
  // 污染所有同 direction/source_type 的交易。
  if (data.match_key !== null && data.match_key !== undefined
      && !String(data.match_key).trim()) {
    throw new Error('match_key 正規化後為空（如 7-11／純數字／純符號），無法建立唯一比對規則；請改用 source_type+direction 條件，或在 CSV 匯入時直接分類');
  }
  const mk = data.match_key && String(data.match_key).trim() ? String(data.match_key).trim() : null;
  const st = data.source_type && String(data.source_type).trim() ? String(data.source_type).trim() : null;
  const dir = data.direction && ['in', 'out'].includes(String(data.direction).toLowerCase())
    ? String(data.direction).toLowerCase() : null;
  if (mk === null && st === null && dir === null) {
    throw new Error('規則至少需指定一個比對條件（match_key / source_type / direction）');
  }
  const cat = data.category_value && String(data.category_value).trim() ? String(data.category_value).trim() : null;
  if (cat === null) {
    throw new Error('規則至少需指定一個分類結果（category_value）');
  }
  return {
    $mk: mk, $st: st, $dir: dir,
    $cat: cat,
    $conf: clamp(Number(data.confidence), 0, 1) || 0,
    $sc: Math.max(0, parseInt(data.sample_count, 10) || 0),
    $origin: ['ai_analysis', 'human_correction', 'bootstrap'].includes(data.origin) ? data.origin : 'ai_analysis',
    $enabled: data.enabled === false || data.enabled === 0 || data.enabled === '0' ? 0 : 1,
    $note: data.note ? String(data.note) : null,
  };
}

// listRules：UI 列規則。啟用在前 → 低信心在前 → 樣本數多在前。
function listRules(filter = {}) {
  const db = getDb();
  const where = [];
  const values = {};
  const { enabled, maxConfidence, origin, q } = filter;
  if (enabled !== undefined && enabled !== null && enabled !== '' && enabled !== 'all') {
    where.push('enabled = $enabled');
    values.$enabled = enabled === true || enabled === 1 || enabled === '1' ? 1 : 0;
  }
  if (maxConfidence !== undefined && maxConfidence !== null && maxConfidence !== '') {
    where.push('confidence <= $maxc');
    values.$maxc = Number(maxConfidence);
  }
  if (origin) { where.push('origin = $origin'); values.$origin = origin; }
  if (q) {
    where.push('(match_key LIKE $q OR note LIKE $q)');
    values.$q = `%${q}%`;
  }
  const sql = `SELECT *,
    (SELECT t.name FROM transactions t
      WHERE t.rule_id = classification_rules.id
      ORDER BY t.transaction_date DESC LIMIT 1) AS sample_name,
    (SELECT COUNT(*) FROM transactions t
      WHERE t.classification_source = 'rule' AND t.rule_id = classification_rules.id) AS linked_rows,
    (SELECT COUNT(*) FROM transactions t
      WHERE t.classification_source = 'rule' AND t.rule_id = classification_rules.id AND t.reviewed = 0) AS unreviewed_rows,
    (SELECT COUNT(*) FROM transactions t
      WHERE t.classification_source = 'rule' AND t.rule_id = classification_rules.id AND t.reviewed = 1) AS reviewed_rows
    FROM classification_rules
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY enabled DESC, confidence ASC, sample_count DESC, id DESC`;
  return db.prepare(sql).all(values);
}

function getRule(id) {
  const db = getDb();
  return withRuleImpact(getRawRule(id, db), db);
}

function createRule(data) {
  const db = getDb();
  const rule = validateRule(data);
  db.prepare(`
    INSERT INTO classification_rules
      (match_key, source_type, direction, category_value,
       confidence, sample_count, origin, enabled, note)
    VALUES ($mk, $st, $dir, $cat, $conf, $sc, $origin, $enabled, $note)
  `).run(rule);
  const created = db.prepare('SELECT * FROM classification_rules WHERE id = last_insert_rowid()').get();
  // category_value 軟校驗：非標準 14 類仍接受（不破壞彈性），但附 warning 提示對齊。
  // 不硬擋——AI 可能有特殊情境需要自訂類別，但偏離標準會讓報表映射/統計彙總失效。
  if (!STANDARD_CATEGORIES.includes(rule.$cat)) {
    created.warning = `category_value「${rule.$cat}」非標準類別，建議對齊 14 類（見 GET /api/meta 回應 standardCategories）以利報表映射與統計彙總。`;
  }
  return created;
}

// PATCH：以現有值為底合併輸入後整體重驗證（避免漏欄導致無條件規則）。
function updateRule(id, data) {
  const db = getDb();
  const cur = getRawRule(id, db);
  if (!cur) return null;
  const rule = validateRule({ ...decodeRule(cur), ...data });
  const dependents = getRuleDependents(db, id);

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE classification_rules SET
        match_key = $mk, source_type = $st, direction = $dir,
        category_value = $cat,
        confidence = $conf, sample_count = $sc, origin = $origin, enabled = $enabled, note = $note,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $id
    `).run({ ...rule, $id: id });

    const updated = getRawRule(id, db);
    let impact = emptyImpact(dependents.length);
    if (classificationSemanticsChanged(cur, updated)) {
      impact = reclassifyRuleDependents(db, dependents);
      logRuleChange(db, {
        ruleId: id,
        action: ruleChangeAction(cur, updated),
        before: cur,
        after: updated,
        impact,
      });
    }
    db.exec('COMMIT');
    return { rule: withRuleImpact(updated, db), impact };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function setRuleEnabled(id, enabled) {
  const parsedEnabled = !(enabled === false || enabled === 0 || enabled === '0');
  return updateRule(id, { enabled: parsedEnabled });
}

// 清理舊版曾留下的規則連結。這不改規則本身，只把目前仍指向該規則的交易
// 依現行啟用規則重新評估，讓已停用規則不再污染分類與待審狀態。
function reclassifyRuleHistory(id) {
  const db = getDb();
  const cur = getRawRule(id, db);
  if (!cur) return null;
  const dependents = getRuleDependents(db, id);

  db.exec('BEGIN');
  try {
    const impact = reclassifyRuleDependents(db, dependents);
    logRuleChange(db, {
      ruleId: id,
      action: 'reclassify',
      before: cur,
      after: cur,
      impact,
    });
    db.exec('COMMIT');
    return { rule: withRuleImpact(cur, db), impact };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// 刪除前保存目前 dependents；刪除後讓未確認交易重新命中其他規則，否則送回 pending。
function deleteRule(id) {
  const db = getDb();
  const cur = getRawRule(id, db);
  if (!cur) return null;
  const dependents = getRuleDependents(db, id);

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM classification_rules WHERE id = ?').run(id);
    const impact = reclassifyRuleDependents(db, dependents);
    logRuleChange(db, {
      ruleId: id,
      action: 'delete',
      before: cur,
      after: null,
      impact,
    });
    db.exec('COMMIT');
    return { deleted: true, impact };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// （已移除 suggestFromHistory：工具端歷史聚合與「AI 當次建規則」流程重疊，規則改由 AI 第一環建立）

module.exports = {
  getMatchingRule, incrementRuleStat, decodeRule, validateRule,
  listRules, getRule, getRuleImpactCounts, createRule,
  updateRule, setRuleEnabled, reclassifyRuleHistory, deleteRule,
};
