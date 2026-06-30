// 審查佇列：待確認/未審交易（機械查詢，供使用者審查）。
const { getDb, safeInt } = require('./core');

function getReviewQueue(limit = 20) {
  const db = getDb();
  const safeLimit = safeInt(limit, 20, 100);
  const uncertain = db.prepare(`
    SELECT COUNT(*) AS count FROM transactions
    WHERE owner_primary = '待確認' OR category_primary = '待確認' OR necessity = '需確認'
  `).get().count;
  // unreviewed 只算 pending（沒規則沒 AI）；規則套用視為已完成、不進審查佇列。
  const unreviewed = db.prepare(`
    SELECT COUNT(*) AS count FROM transactions
    WHERE classification_source = 'pending'
  `).get().count;
  const samples = db.prepare(`
    SELECT id, transaction_date, name, owner_primary, category_primary, necessity, amount, ai_confidence
    FROM transactions
    WHERE owner_primary = '待確認' OR category_primary = '待確認' OR necessity = '需確認'
    ORDER BY ai_confidence ASC, transaction_date DESC LIMIT ?
  `).all(safeLimit);
  return { uncertain_count: uncertain, unreviewed_count: unreviewed, samples };
}

module.exports = { getReviewQueue };
