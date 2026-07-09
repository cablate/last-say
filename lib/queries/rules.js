// 分類規則（classification_rules）：AI 產出/維護，本工具匯入時機械套用（getMatchingRule）。
const { getDb, clamp, directionFromFlow, normalizeForRule } = require('./core');
const { STANDARD_CATEGORIES } = require('../constants');

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
      ORDER BY t.transaction_date DESC LIMIT 1) AS sample_name
    FROM classification_rules
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY enabled DESC, confidence ASC, sample_count DESC, id DESC`;
  return db.prepare(sql).all(values);
}

function getRule(id) {
  return getDb().prepare('SELECT * FROM classification_rules WHERE id = ?').get(id);
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
  const cur = getRule(id);
  if (!cur) return null;
  const rule = validateRule({ ...decodeRule(cur), ...data });
  db.prepare(`
    UPDATE classification_rules SET
      match_key = $mk, source_type = $st, direction = $dir,
      category_value = $cat,
      confidence = $conf, sample_count = $sc, origin = $origin, enabled = $enabled, note = $note,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $id
  `).run({ ...rule, $id: id });
  return getRule(id);
}

function setRuleEnabled(id, enabled) {
  const db = getDb();
  const r = db.prepare('UPDATE classification_rules SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(enabled ? 1 : 0, id);
  return r.changes > 0 ? getRule(id) : null;
}

// 刪除規則。transactions.rule_id 因 ON DELETE SET NULL 自動清空。
function deleteRule(id) {
  const db = getDb();
  const r = db.prepare('DELETE FROM classification_rules WHERE id = ?').run(id);
  return r.changes > 0;
}

// （已移除 suggestFromHistory：工具端歷史聚合與「AI 當次建規則」流程重疊，規則改由 AI 第一環建立）

module.exports = {
  getMatchingRule, incrementRuleStat, decodeRule, validateRule,
  listRules, getRule, createRule, updateRule, setRuleEnabled, deleteRule,
};
