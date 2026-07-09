// 前後端共用常數。純資料、無副作用，client component 可直接 import。

// 人工可編輯欄位白名單（金額/日期/來源完全不在內 →「不改金額」硬保證）。
// 同時套用於 PATCH 與 batch，是 SQL injection 防線（動態欄位名只來自此陣列）。
const EDITABLE_FIELDS = ['category_primary', 'memo'];

// EDITABLE_FIELDS 當中「屬於分類」的子集——改這些才算「人類覆寫分類」：
// 清 rule_id + 標 classification_source='human' + 規則 overridden+1。
// memo（備註）不算分類：只改 memo 不會污染規則準確率統計、不跳 SourceBadge。
const CLASSIFICATION_FIELDS = ['category_primary'];

// EDITABLE_FIELDS 的中文顯示（前端 BATCH_FIELDS / FIELD_LABEL 共用，消除重複宣告）
const EDITABLE_LABELS = {
  category_primary: '分類',
  memo: '備註',
};

// breakdown 維度 → 欄位對應
const DIMENSION_MAP = {
  category: 'category_primary',
  source: 'source_type',
  flow: 'flow_type',
};

// 標準主類別白名單（題二發散度控制）：AI 分類的 category_main 須對應其一（只能選、不能造）。
// 無法對應 → 用決策樹歸日常開銷/購物並標低信心。14 個（粗主類 + 子類別下鑽）。
const STANDARD_CATEGORIES = [
  '飲食', '日常開銷', '居住', '交通', '購物', '休閒娛樂', '訂閱服務',
  '醫療保健', '保險', '教育學習', '金融手續與稅費',
  '轉帳/內部移轉', '薪資收入', '其他收入與收益',
];

// 「非消費 outflow」flow_type 權威清單——Overview 消費統計與 reports excluded 共用同一語意。
// 對齊 lib/reporting/report-lines.js builtInReportLine 的排除對象：
//   信用卡繳款/移轉 → excluded:credit_card_payment / excluded:internal_transfer
//   貸款本金還款   → excluded:loan_principal
//   投資買入       → excluded:investment_purchase
// 注意：flow_type IS NULL（未知）視為消費、仍進 spend（保持既有語意）。
const NON_SPEND_FLOW_TYPES = ['信用卡繳款/移轉', '貸款本金還款', '投資買入'];

// 規則信心度門檻與色彩（RulesManager 的 Confidence 數值與「低信心」篩選共用同一組定義，
// 避免門檻散落、視覺與篩選不一致）。紅綠燈語意：high ≥0.8 綠 / mid 0.5~0.8 琥珀 / low <0.5 紅。
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const CONFIDENCE_TIERS = [
  { min: 0.8, tier: 'high', label: '高', className: 'border-success/40 bg-success/10 text-success' },
  { min: LOW_CONFIDENCE_THRESHOLD, tier: 'mid', label: '中', className: 'border-warning/40 bg-warning/10 text-warning' },
  { min: 0, tier: 'low', label: '低', className: 'border-danger/40 bg-danger/10 text-danger' },
];
function confidenceTier(c) {
  const v = Number(c);
  for (const t of CONFIDENCE_TIERS) { if (v >= t.min) return t; }
  return CONFIDENCE_TIERS[CONFIDENCE_TIERS.length - 1];
}

module.exports = {
  EDITABLE_FIELDS,
  CLASSIFICATION_FIELDS,
  EDITABLE_LABELS,
  DIMENSION_MAP,
  STANDARD_CATEGORIES,
  NON_SPEND_FLOW_TYPES,
  LOW_CONFIDENCE_THRESHOLD,
  CONFIDENCE_TIERS,
  confidenceTier,
};
