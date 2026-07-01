// 前後端共用常數。純資料、無副作用，client component 可直接 import。

// 人工可編輯欄位白名單（金額/日期/來源完全不在內 →「不改金額」硬保證）。
// 同時套用於 PATCH 與 batch，是 SQL injection 防線（動態欄位名只來自此陣列）。
const EDITABLE_FIELDS = ['owner_primary', 'category_primary', 'necessity', 'memo'];

// EDITABLE_FIELDS 當中「屬於分類」的子集——改這些才算「人類覆寫分類」：
// 清 rule_id + 標 classification_source='human' + 規則 overridden+1。
// memo（備註）不算分類：只改 memo 不會污染規則準確率統計、不跳 SourceBadge。
const CLASSIFICATION_FIELDS = ['owner_primary', 'category_primary', 'necessity'];

// EDITABLE_FIELDS 的中文顯示（前端 BATCH_FIELDS / FIELD_LABEL 共用，消除重複宣告）
const EDITABLE_LABELS = {
  owner_primary: '歸屬',
  category_primary: '分類',
  necessity: '必要性',
  memo: '備註',
};

// breakdown 維度 → 欄位對應
const DIMENSION_MAP = {
  category: 'category_primary',
  owner: 'owner_primary',
  necessity: 'necessity',
  source: 'source_type',
  flow: 'flow_type',
};

// 表單選項（combobox/批次 UI 用）。值域規則在此體現（DB 端 CHECK 留待階段 2b 補）。
const OWNER_OPTIONS = ['個人', '事業', '事業候選', '移轉不算'];
const NECESSITY_OPTIONS = ['必要', '事業必要', '可節省', '可優化', '不列入'];

// 標準主類別白名單（題二發散度控制）：AI 分類的 category_main 須對應其一（只能選、不能造）。
// 無法對應 → 歸「其他收入與收益」並標 pending。owner 可自行擴充。13 個（業界 6-8 + 台灣 + 現代訂閱/金融）。
const STANDARD_CATEGORIES = [
  '飲食', '居家', '交通', '購物', '休閒娛樂', '訂閱服務',
  '醫療保健', '保險', '教育學習', '金融手續與稅費',
  '轉帳/內部移轉', '薪資收入', '其他收入與收益',
];

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
  OWNER_OPTIONS,
  NECESSITY_OPTIONS,
  STANDARD_CATEGORIES,
  LOW_CONFIDENCE_THRESHOLD,
  CONFIDENCE_TIERS,
  confidenceTier,
};
