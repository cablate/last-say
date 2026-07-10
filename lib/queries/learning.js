// 外部 AI 的唯讀經驗檢索層。只整理既有規則、人工修正與已覆核案例，
// 不呼叫 LLM、不寫 DB，也不改變 normalizeForRule / 規則命中語意。
const { getDb, safeInt, normalizeForRule } = require('./core');
const { getMatchingRule } = require('./rules');

const MAX_LEARNING_BATCH = 200;
const DEFAULT_CASE_LIMIT = 6;
const MAX_CASE_LIMIT = 12;
const MIN_SIMILARITY = 0.42;

function normalizeDirection(value) {
  if (value === null || value === undefined || value === '') return null;
  const direction = String(value).toLowerCase();
  return direction === 'in' || direction === 'out' ? direction : null;
}

// 僅供相似案例檢索，不作為規則 match_key，避免破壞既有規則。
function similarityKey(value) {
  if (value === null || value === undefined) return '';
  const normalized = String(value)
    .normalize('NFKC')
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, ' ')
    .split(/\s+/)
    // 檢索比正式 match_key 保守：只移除明確的長數字識別碼，保留 CHATGPT
    // 這類母音少但有語意的品牌字，避免相似案例被 normalizeForRule 過度降維。
    .filter((token) => !(token.length >= 4 && /\d/.test(token)))
    .join(' ');
  return normalized
    .replace(/[\p{P}\p{S}\s_]+/gu, '')
    .toLowerCase();
}

function bigrams(value) {
  const chars = Array.from(value);
  if (chars.length < 2) return chars;
  return chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
}

function diceCoefficient(left, right) {
  if (left === right) return left ? 1 : 0;
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  if (leftPairs.length === 0 || rightPairs.length === 0) return 0;
  const counts = new Map();
  for (const pair of leftPairs) counts.set(pair, (counts.get(pair) || 0) + 1);
  let overlap = 0;
  for (const pair of rightPairs) {
    const available = counts.get(pair) || 0;
    if (available > 0) {
      overlap += 1;
      counts.set(pair, available - 1);
    }
  }
  return (2 * overlap) / (leftPairs.length + rightPairs.length);
}

function merchantSimilarity(leftName, rightName) {
  const left = similarityKey(leftName);
  const right = similarityKey(rightName);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftLength = Array.from(left).length;
  const rightLength = Array.from(right).length;
  const shorter = leftLength <= rightLength ? left : right;
  const longer = leftLength <= rightLength ? right : left;
  const shorterLength = Math.min(leftLength, rightLength);
  const longerLength = Math.max(leftLength, rightLength);
  const containment = shorterLength >= 4 && longer.includes(shorter)
    ? 0.78 + 0.2 * (shorterLength / longerLength)
    : 0;

  return Math.max(containment, diceCoefficient(left, right));
}

function evidenceTier(row) {
  if (row.classification_source === 'human' || Number(row.correction_count) > 0) {
    return { type: 'human_correction', weight: 4 };
  }
  if (row.classification_source === 'rule') {
    return { type: 'rule_application', weight: 3 };
  }
  return { type: 'human_confirmed', weight: 2 };
}

function publicRule(rule) {
  if (!rule) return null;
  return {
    id: rule.id,
    match_key: rule.match_key,
    source_type: rule.source_type,
    direction: rule.direction,
    category_value: rule.category_value,
    confidence: Number(rule.confidence) || 0,
    sample_count: Number(rule.sample_count) || 0,
    applied_count: Number(rule.applied_count) || 0,
    overridden_count: Number(rule.overridden_count) || 0,
    origin: rule.origin,
    note: rule.note || '',
  };
}

function loadEvidenceRows(db) {
  return db.prepare(`
    SELECT
      t.id,
      t.name,
      t.transaction_month,
      t.source_type,
      t.flow_type,
      t.inflow,
      t.outflow,
      t.category_primary,
      t.category_sub,
      t.classification_source,
      t.ai_confidence,
      t.judgment_reason,
      t.reviewed,
      t.rule_id,
      COUNT(cl.id) AS correction_count,
      r.confidence AS rule_confidence,
      r.applied_count AS rule_applied_count,
      r.overridden_count AS rule_overridden_count,
      r.note AS rule_note
    FROM transactions t
    LEFT JOIN correction_log cl ON cl.transaction_id = t.id
    LEFT JOIN classification_rules r ON r.id = t.rule_id
    WHERE t.category_primary IS NOT NULL
      AND TRIM(t.category_primary) <> ''
      AND (
        t.classification_source = 'human'
        OR t.classification_source = 'rule'
        OR (t.classification_source = 'ai' AND t.reviewed = 1)
      )
    GROUP BY t.id
    ORDER BY t.transaction_date DESC, t.id DESC
    LIMIT 2000
  `).all();
}

function aggregateCases(rows, input, limit) {
  const groups = new Map();
  const requestedDirection = normalizeDirection(input.direction);
  const requestedSource = input.sourceType ? String(input.sourceType) : '';

  for (const row of rows) {
    const rowDirection = Number(row.inflow) > 0 ? 'in' : (Number(row.outflow) > 0 ? 'out' : null);
    if (requestedDirection && rowDirection !== requestedDirection) continue;

    const similarity = merchantSimilarity(input.name, row.name);
    if (similarity < MIN_SIMILARITY) continue;

    const sourceMatch = Boolean(requestedSource && row.source_type === requestedSource);
    const score = Math.min(1, similarity + (sourceMatch ? 0.04 : 0));
    const tier = evidenceTier(row);
    const matchKey = normalizeForRule(row.name);
    const groupKey = [matchKey, row.category_primary, tier.type, row.source_type || ''].join('\u0000');
    const current = groups.get(groupKey) || {
      match_key: matchKey,
      sample_name: row.name,
      source_type: row.source_type,
      direction: rowDirection,
      category_primary: row.category_primary,
      category_sub: row.category_sub || '',
      evidence_type: tier.type,
      similarity: score,
      occurrences: 0,
      correction_count: 0,
      latest_month: row.transaction_month,
      judgment_reason: row.judgment_reason || '',
      rule_id: row.rule_id || null,
      rule_note: row.rule_note || '',
      _baseWeight: tier.weight,
    };
    current.occurrences += 1;
    current.correction_count += Number(row.correction_count) || 0;
    current.similarity = Math.max(current.similarity, score);
    if ((row.transaction_month || '') > (current.latest_month || '')) {
      current.latest_month = row.transaction_month;
      current.sample_name = row.name;
      current.judgment_reason = row.judgment_reason || current.judgment_reason;
    }
    groups.set(groupKey, current);
  }

  return [...groups.values()]
    .map((item) => {
      const repetitionSupport = Math.min(3, item.occurrences);
      const evidenceWeight = item._baseWeight * item.similarity * repetitionSupport;
      const { _baseWeight, ...visible } = item;
      return { ...visible, evidence_weight: Number(evidenceWeight.toFixed(3)) };
    })
    .sort((a, b) =>
      b.evidence_weight - a.evidence_weight
      || b.similarity - a.similarity
      || String(b.latest_month).localeCompare(String(a.latest_month)))
    .slice(0, limit);
}

function buildConsensus(cases, matchedRule) {
  if (matchedRule) {
    return {
      suggested_category: matchedRule.category_value,
      status: 'matched_rule',
      conflict: false,
      confidence_ceiling: Number(matchedRule.confidence) || 0,
      categories: [{
        category: matchedRule.category_value,
        weight: Number(matchedRule.confidence) || 0,
        share: 1,
        case_count: 0,
      }],
    };
  }

  const categoryMap = new Map();
  for (const item of cases) {
    const current = categoryMap.get(item.category_primary) || { weight: 0, caseCount: 0, humanCases: 0 };
    current.weight += item.evidence_weight;
    current.caseCount += item.occurrences;
    if (item.evidence_type === 'human_correction') current.humanCases += item.occurrences;
    categoryMap.set(item.category_primary, current);
  }
  const totalWeight = [...categoryMap.values()].reduce((sum, item) => sum + item.weight, 0);
  const categories = [...categoryMap.entries()]
    .map(([category, item]) => ({
      category,
      weight: Number(item.weight.toFixed(3)),
      share: totalWeight > 0 ? Number((item.weight / totalWeight).toFixed(3)) : 0,
      case_count: item.caseCount,
      human_case_count: item.humanCases,
    }))
    .sort((a, b) => b.weight - a.weight || a.category.localeCompare(b.category));
  const top = categories[0] || null;
  const conflict = categories.length > 1 && Number(top?.share || 0) < 0.7;

  let confidenceCeiling = null;
  if (conflict) confidenceCeiling = 0.55;
  else if (top?.human_case_count >= 2 && top.share >= 0.8) confidenceCeiling = 0.88;
  else if (top?.human_case_count >= 1) confidenceCeiling = 0.76;
  else if ((top?.case_count || 0) >= 2 && top.share >= 0.8) confidenceCeiling = 0.72;
  else if (top) confidenceCeiling = 0.62;

  return {
    suggested_category: top?.category || null,
    status: !top ? 'no_history' : (conflict ? 'conflicting_history' : 'historical_consensus'),
    conflict,
    confidence_ceiling: confidenceCeiling,
    categories,
  };
}

function getMerchantLearningContext(input, db = getDb(), evidenceRows = null) {
  if (!input || !String(input.name || '').trim()) {
    throw new Error('name is required');
  }
  const name = String(input.name).trim();
  const sourceType = input.sourceType || input.source_type || null;
  const direction = normalizeDirection(input.direction);
  const limit = safeInt(input.limit, DEFAULT_CASE_LIMIT, MAX_CASE_LIMIT) || DEFAULT_CASE_LIMIT;
  const matchKey = normalizeForRule(name);
  const matchedRule = getMatchingRule(matchKey, sourceType, direction, db);
  const cases = aggregateCases(evidenceRows || loadEvidenceRows(db), { name, sourceType, direction }, limit);
  const consensus = buildConsensus(cases, matchedRule);

  return {
    input: { name, source_type: sourceType, direction },
    match_key: matchKey,
    matched_rule: publicRule(matchedRule),
    consensus,
    similar_cases: cases,
    should_web_search: !matchedRule && (cases.length === 0 || consensus.conflict || Number(consensus.confidence_ceiling || 0) < 0.7),
    may_create_alias_rule: !matchedRule && !consensus.conflict && Number(consensus.confidence_ceiling || 0) >= 0.6,
  };
}

function getMerchantLearningContexts(items, db = getDb()) {
  if (!Array.isArray(items)) throw new Error('items array is required');
  if (items.length > MAX_LEARNING_BATCH) {
    throw new Error(`items exceeds maximum batch size ${MAX_LEARNING_BATCH}`);
  }
  const evidenceRows = loadEvidenceRows(db);
  return items.map((item) => getMerchantLearningContext(item, db, evidenceRows));
}

function getLearningOverview(db = getDb()) {
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM correction_log) AS corrections,
      (SELECT COALESCE(MAX(id), 0) FROM correction_log) AS latest_correction_id,
      (SELECT COUNT(*) FROM classification_rules) AS rules,
      (SELECT COUNT(*) FROM classification_rules WHERE origin = 'human_correction') AS human_correction_rules,
      (SELECT COUNT(*) FROM transactions WHERE classification_source = 'human') AS human_classifications,
      (SELECT COUNT(*) FROM transactions WHERE classification_source = 'ai' AND reviewed = 1) AS confirmed_ai_classifications
  `).get();
  const rulePerformance = db.prepare(`
    SELECT
      COALESCE(SUM(applied_count), 0) AS applied,
      COALESCE(SUM(overridden_count), 0) AS overridden,
      COALESCE(SUM(CASE WHEN applied_count > 0 THEN 1 ELSE 0 END), 0) AS used_rules
    FROM classification_rules
  `).get();
  const weakRules = db.prepare(`
    SELECT id, match_key, source_type, direction, category_value, confidence,
      sample_count, applied_count, overridden_count, origin, note
    FROM classification_rules
    WHERE overridden_count > 0
    ORDER BY (1.0 * overridden_count / MAX(1, applied_count + overridden_count)) DESC,
      overridden_count DESC, id ASC
    LIMIT 20
  `).all().map(publicRule);
  const monthlyAutomation = db.prepare(`
    SELECT
      transaction_month AS month,
      COUNT(*) AS rows,
      COALESCE(SUM(CASE WHEN classification_source = 'rule' THEN 1 ELSE 0 END), 0) AS rule_rows,
      ROUND(100.0 * COALESCE(SUM(CASE WHEN classification_source = 'rule' THEN 1 ELSE 0 END), 0) / COUNT(*), 1) AS rule_rate
    FROM transactions
    GROUP BY transaction_month
    ORDER BY transaction_month DESC
    LIMIT 12
  `).all().reverse();
  const correctionCandidates = db.prepare(`
    SELECT match_key, source_type, LOWER(direction) AS direction, field_name, new_value,
      COUNT(*) AS evidence_count, MAX(id) AS latest_correction_id
    FROM correction_log
    WHERE match_key IS NOT NULL AND TRIM(match_key) <> ''
    GROUP BY match_key, source_type, LOWER(direction), field_name, new_value
    ORDER BY latest_correction_id DESC, evidence_count DESC
    LIMIT 100
  `).all().map((candidate) => {
    const matchedRule = candidate.field_name === 'category_primary'
      ? getMatchingRule(candidate.match_key, candidate.source_type, candidate.direction, db)
      : null;
    return {
      ...candidate,
      covered_by_rule: Boolean(matchedRule && matchedRule.category_value === candidate.new_value),
      matched_rule_id: matchedRule?.id || null,
    };
  });

  return {
    counts: {
      corrections: Number(counts.corrections) || 0,
      latest_correction_id: Number(counts.latest_correction_id) || 0,
      rules: Number(counts.rules) || 0,
      human_correction_rules: Number(counts.human_correction_rules) || 0,
      human_classifications: Number(counts.human_classifications) || 0,
      confirmed_ai_classifications: Number(counts.confirmed_ai_classifications) || 0,
    },
    rule_performance: {
      applied: Number(rulePerformance.applied) || 0,
      overridden: Number(rulePerformance.overridden) || 0,
      used_rules: Number(rulePerformance.used_rules) || 0,
      weak_rules: weakRules,
    },
    monthly_automation: monthlyAutomation,
    correction_candidates: correctionCandidates,
  };
}

module.exports = {
  MAX_LEARNING_BATCH,
  similarityKey,
  merchantSimilarity,
  getLearningOverview,
  getMerchantLearningContext,
  getMerchantLearningContexts,
};
