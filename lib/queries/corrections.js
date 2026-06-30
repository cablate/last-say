// correction_log 查詢/寫入。append-only（trigger 擋 UPDATE/DELETE），只能 INSERT。
const { getDb, safeInt } = require('./core');
const { EDITABLE_FIELDS } = require('../constants');

// logCorrection：寫入一筆校正。ctx 自帶規則脈絡（match_key/source_type/direction/rule_id），
// 讓 AI 第二環可直接 GROUP BY match_key 整理成規則，不必 join transactions。
function logCorrection(db, transactionId, fieldName, oldValue, newValue, ctx = {}) {
  db.prepare(`INSERT INTO correction_log (transaction_id, field_name, old_value, new_value, match_key, source_type, direction, rule_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(transactionId, fieldName, String(oldValue ?? ''), String(newValue ?? ''), ctx.match_key ?? null, ctx.source_type ?? null, ctx.direction ?? null, ctx.rule_id ?? null);
}

// 以 match_key + 欄位 + 新值聚合 = 規則候選清單（哪個比對鍵被一致校正成什麼）。
function getCorrectionSummary() {
  const db = getDb();
  return db.prepare(`
    SELECT cl.match_key, cl.field_name, cl.new_value, COUNT(*) AS count
    FROM correction_log cl
    WHERE cl.match_key IS NOT NULL
    GROUP BY cl.match_key, cl.field_name, cl.new_value
    ORDER BY count DESC, cl.match_key
  `).all();
}

function getCorrections({ limit = 200, field = '', matchKey = '' } = {}) {
  const db = getDb();
  const safeLimit = safeInt(limit, 200, 1000);
  const conds = [];
  const params = {};
  if (field) {
    // 白名單校驗：field 必須 ∈ EDITABLE_FIELDS，否則前端誤傳時早失敗。
    if (!EDITABLE_FIELDS.includes(field)) return { rows: [], summary: getCorrectionSummary(), total: 0 };
    conds.push('cl.field_name = $field');
    params.$field = field;
  }
  if (matchKey) { conds.push('cl.match_key = $matchKey'); params.$matchKey = matchKey; }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  // 真實總數（不含 LIMIT）：分頁與「共 N 筆」才正確，不會因 limit 截斷而少報。
  const total = db.prepare(`SELECT COUNT(*) AS c FROM correction_log cl${where}`).get(params).c;
  const rows = db.prepare(
    `SELECT cl.*, t.name AS transaction_name, t.transaction_date FROM correction_log cl JOIN transactions t ON t.id = cl.transaction_id${where} ORDER BY cl.corrected_at DESC, cl.id DESC LIMIT $limit`
  ).all({ ...params, $limit: safeLimit });
  const summary = getCorrectionSummary();
  return { rows, summary, total };
}

module.exports = { logCorrection, getCorrectionSummary, getCorrections };
