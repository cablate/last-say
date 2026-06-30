// 分類規則（classification_rules）：AI 產出/維護，本工具匯入時機械套用（getMatchingRule）。
const { getDb, clamp, directionFromFlow, normalizeForRule } = require('./core');

// 匯入套用：給正規化鍵/來源/方向，取最佳啟用規則。特異性優先 → 信心度 → 樣本數。
function getMatchingRule(matchKey, sourceType, direction, db = getDb()) {
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
    $dir: direction || null,
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
    owner_value: row.owner_value, category_value: row.category_value, necessity_value: row.necessity_value,
    confidence: row.confidence, sample_count: row.sample_count, origin: row.origin,
    enabled: row.enabled, note: row.note,
  };
}

// 驗證並清洗規則輸入。至少一個條件欄 + 至少一個結果值。
function validateRule(data) {
  const mk = data.match_key && String(data.match_key).trim() ? String(data.match_key).trim() : null;
  const st = data.source_type && String(data.source_type).trim() ? String(data.source_type).trim() : null;
  const dir = data.direction && ['in', 'out'].includes(data.direction) ? data.direction : null;
  if (mk === null && st === null && dir === null) {
    throw new Error('規則至少需指定一個比對條件（match_key / source_type / direction）');
  }
  const owner = data.owner_value && String(data.owner_value).trim() ? String(data.owner_value).trim() : null;
  const cat = data.category_value && String(data.category_value).trim() ? String(data.category_value).trim() : null;
  const nec = data.necessity_value && String(data.necessity_value).trim() ? String(data.necessity_value).trim() : null;
  if (owner === null && cat === null && nec === null) {
    throw new Error('規則至少需指定一個分類結果（owner_value / category_value / necessity_value）');
  }
  return {
    $mk: mk, $st: st, $dir: dir,
    $owner: owner, $cat: cat, $nec: nec,
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
  const sql = `SELECT * FROM classification_rules
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
      (match_key, source_type, direction, owner_value, category_value, necessity_value,
       confidence, sample_count, origin, enabled, note)
    VALUES ($mk, $st, $dir, $owner, $cat, $nec, $conf, $sc, $origin, $enabled, $note)
  `).run(rule);
  return db.prepare('SELECT * FROM classification_rules WHERE id = last_insert_rowid()').get();
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
      owner_value = $owner, category_value = $cat, necessity_value = $nec,
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

// 冷啟動建議：同 (match_key, source_type, direction) 眾數分類 → 建議清單（供 AI bootstrap）。
function suggestFromHistory() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT name, source_type, inflow, outflow, owner_primary, category_primary, necessity
    FROM transactions
  `).all();
  const groups = new Map();
  for (const r of rows) {
    const mk = normalizeForRule(r.name);
    if (!mk) continue;
    const dir = directionFromFlow(r.inflow, r.outflow);
    const key = `${mk}${r.source_type || ''}${dir || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        match_key: mk, source_type: r.source_type || null, direction: dir,
        counts: { owner_value: {}, category_value: {}, necessity_value: {} },
      });
    }
    const g = groups.get(key);
    const tally = (field, val) => {
      const v = val && String(val) !== '待確認' && String(val) !== '需確認' ? String(val) : null;
      if (v) g.counts[field][v] = (g.counts[field][v] || 0) + 1;
    };
    tally('owner_value', r.owner_primary);
    tally('category_value', r.category_primary);
    tally('necessity_value', r.necessity);
  }
  const pick = (counts) => {
    const entries = Object.entries(counts);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return { value: entries[0][0], count: entries[0][1] };
  };
  const suggestions = [];
  for (const g of groups.values()) {
    const owner = pick(g.counts.owner_value);
    const cat = pick(g.counts.category_value);
    const nec = pick(g.counts.necessity_value);
    const sample = Math.max(owner?.count || 0, cat?.count || 0, nec?.count || 0);
    if (sample < 2) continue;
    suggestions.push({
      match_key: g.match_key,
      source_type: g.source_type,
      direction: g.direction,
      owner_value: owner?.value || null,
      category_value: cat?.value || null,
      necessity_value: nec?.value || null,
      sample_count: sample,
      confidence: Math.min(0.95, 0.5 + sample * 0.1),
    });
  }
  suggestions.sort((a, b) => b.sample_count - a.sample_count);
  return suggestions;
}

module.exports = {
  getMatchingRule, incrementRuleStat, decodeRule, validateRule,
  listRules, getRule, createRule, updateRule, setRuleEnabled, deleteRule, suggestFromHistory,
};
