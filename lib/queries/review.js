// 審查佇列：待確認交易 + 規則套用 + 歷史建議（機械查詢非 AI，供使用者一鍵採納）。
const { getDb, safeInt, normalizeForRule } = require('./core');

// 同名（normalizeForRule）歷史已分類交易的眾數 → 「歷史建議」。只比對名稱，sample>=2 才建議。
function buildHistorySuggestionMap(db) {
  const rows = db.prepare(`SELECT name, owner_primary, category_primary, necessity FROM transactions WHERE owner_primary <> '待確認' AND category_primary <> '待確認' AND necessity <> '需確認'`).all();
  const groups = new Map();
  for (const r of rows) {
    const mk = normalizeForRule(r.name);
    if (!mk) continue;
    if (!groups.has(mk)) groups.set(mk, { owner: {}, category: {}, necessity: {} });
    const g = groups.get(mk);
    if (r.owner_primary) g.owner[r.owner_primary] = (g.owner[r.owner_primary] || 0) + 1;
    if (r.category_primary) g.category[r.category_primary] = (g.category[r.category_primary] || 0) + 1;
    if (r.necessity) g.necessity[r.necessity] = (g.necessity[r.necessity] || 0) + 1;
  }
  const pick = (counts) => {
    const e = Object.entries(counts);
    if (e.length === 0) return null;
    e.sort((a, b) => b[1] - a[1]);
    return { value: e[0][0], count: e[0][1] };
  };
  const result = new Map();
  for (const [mk, g] of groups) {
    const owner = pick(g.owner);
    const category = pick(g.category);
    const necessity = pick(g.necessity);
    const sample = Math.max(owner?.count || 0, category?.count || 0, necessity?.count || 0);
    if (sample < 2) continue;
    result.set(mk, {
      owner_value: owner?.value || null,
      category_value: category?.value || null,
      necessity_value: necessity?.value || null,
      sample_count: sample,
    });
  }
  return result;
}

function getReviewQueue(limit = 20) {
  const db = getDb();
  const safeLimit = safeInt(limit, 20, 100);
  const uncertain = db.prepare(`
    SELECT COUNT(*) AS count FROM transactions
    WHERE owner_primary = '待確認' OR category_primary = '待確認' OR necessity = '需確認'
  `).get().count;
  const unreviewed = db.prepare(`
    SELECT COUNT(*) AS count FROM transactions
    WHERE classification_source = 'pending'
       OR (classification_source = 'rule' AND reviewed = 0)
  `).get().count;
  const samples = db.prepare(`
    SELECT id, transaction_date, name, owner_primary, category_primary, necessity, amount
    FROM transactions
    WHERE owner_primary = '待確認' OR category_primary = '待確認' OR necessity = '需確認'
    ORDER BY transaction_date DESC LIMIT ?
  `).all(safeLimit);
  // 對 samples 附加「歷史建議」→ UI 一鍵採納
  const sugMap = buildHistorySuggestionMap(db);
  for (const s of samples) {
    const mk = normalizeForRule(s.name);
    s.suggestion = (mk && sugMap.get(mk)) || null;
  }
  const ruleAppliedCount = db.prepare(`SELECT COUNT(*) AS count FROM transactions WHERE classification_source = 'rule' AND reviewed = 0`).get().count;
  const ruleApplied = db.prepare(`
    SELECT id, transaction_date, name, owner_primary, category_primary, necessity, amount
    FROM transactions
    WHERE classification_source = 'rule' AND reviewed = 0
    ORDER BY transaction_date DESC LIMIT ?
  `).all(safeLimit);
  return { uncertain_count: uncertain, unreviewed_count: unreviewed, samples, rule_applied_count: ruleAppliedCount, rule_applied: ruleApplied };
}

module.exports = { buildHistorySuggestionMap, getReviewQueue };
