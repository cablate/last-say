const LOW_CONFIDENCE_REVIEW_THRESHOLD = 0.5;

function column(alias, name) {
  return alias ? `${alias}.${name}` : name;
}

// 待審佇列只處理 AI/pending 的不確定判斷。規則來源有自己的規則信心與
// overridden_count，不應因 ledger 的 ai_confidence 空值被誤送進 AI 待審。
function needsReviewSql(alias = '') {
  const reviewed = column(alias, 'reviewed');
  const source = column(alias, 'classification_source');
  const confidence = column(alias, 'ai_confidence');
  return `(${reviewed} = 0 AND (
    ${source} IS NULL
    OR ${source} = 'pending'
    OR (${source} = 'ai' AND (${confidence} < ${LOW_CONFIDENCE_REVIEW_THRESHOLD} OR ${confidence} IS NULL))
  ))`;
}

function needsReviewRow(row) {
  if (Number(row?.reviewed) === 1) return false;
  const source = row?.classification_source;
  if (source === null || source === undefined || source === 'pending') return true;
  if (source !== 'ai') return false;
  return row.ai_confidence === null
    || row.ai_confidence === undefined
    || Number(row.ai_confidence) < LOW_CONFIDENCE_REVIEW_THRESHOLD;
}

module.exports = {
  LOW_CONFIDENCE_REVIEW_THRESHOLD,
  needsReviewSql,
  needsReviewRow,
};
