const { normalizeForRule } = require('../normalize');
const { OWNER_UNRESOLVED_CATEGORY } = require('../constants');
const { reportExclusionForEventKind } = require('../finance/semantics/financial-events');

const REPORT_LINE_DEFINITIONS = {
  'income:salary': { group: 'revenue', label: '薪資收入' },
  'income:business_revenue': { group: 'revenue', label: '業務收入' },
  'income:interest_income': { group: 'revenue', label: '利息收入' },
  'income:refunds_gains': { group: 'revenue', label: '退款與收益' },
  'income:other_income': { group: 'revenue', label: '其他收入' },

  'expense:food': { group: 'expense', label: '飲食' },
  'expense:daily_living': { group: 'expense', label: '日常開銷' },
  'expense:housing': { group: 'expense', label: '居住' },
  'expense:transportation': { group: 'expense', label: '交通' },
  'expense:shopping': { group: 'expense', label: '購物' },
  'expense:leisure_entertainment': { group: 'expense', label: '休閒娛樂' },
  'expense:subscription_software': { group: 'expense', label: '訂閱與軟體' },
  'expense:insurance': { group: 'expense', label: '保險' },
  'expense:medical': { group: 'expense', label: '醫療保健' },
  'expense:education': { group: 'expense', label: '教育學習' },
  'expense:fees_taxes': { group: 'expense', label: '金融手續與稅費' },
  'expense:interest': { group: 'expense', label: '利息支出' },
  'expense:business_operating': { group: 'expense', label: '業務營運支出' },
  'expense:other_expense': { group: 'expense', label: '其他支出' },

  'excluded:internal_transfer': { group: 'excluded', label: '內部轉帳' },
  'excluded:credit_card_payment': { group: 'excluded', label: '信用卡繳款' },
  'excluded:loan_principal': { group: 'excluded', label: '貸款本金' },
  'excluded:investment_purchase': { group: 'excluded', label: '投資買入' },
  'excluded:owner_equity': { group: 'excluded', label: '業主投入或提領' },
  'excluded:unresolved_inflow': { group: 'excluded', label: '無法確認流入' },
  'excluded:unresolved_outflow': { group: 'excluded', label: '無法確認流出' },
};

const CATEGORY_REPORT_LINES = new Map([
  ['飲食', 'expense:food'],
  ['日常開銷', 'expense:daily_living'],
  ['居住', 'expense:housing'],
  ['交通', 'expense:transportation'],
  ['購物', 'expense:shopping'],
  ['休閒娛樂', 'expense:leisure_entertainment'],
  ['訂閱服務', 'expense:subscription_software'],
  ['醫療保健', 'expense:medical'],
  ['保險', 'expense:insurance'],
  ['教育學習', 'expense:education'],
  ['金融手續與稅費', 'expense:fees_taxes'],
  ['轉帳/內部移轉', 'excluded:internal_transfer'],
  ['薪資收入', 'income:salary'],
  ['其他收入與收益', 'income:other_income'],
  ['food', 'expense:food'],
  ['daily living', 'expense:daily_living'],
  ['housing', 'expense:housing'],
  ['rent', 'expense:housing'],
  ['transportation', 'expense:transportation'],
  ['shopping', 'expense:shopping'],
  ['subscriptions', 'expense:subscription_software'],
  ['subscription', 'expense:subscription_software'],
  ['software', 'expense:subscription_software'],
  ['insurance', 'expense:insurance'],
  ['medical', 'expense:medical'],
  ['education', 'expense:education'],
  ['fees', 'expense:fees_taxes'],
  ['taxes', 'expense:fees_taxes'],
  ['transfer', 'excluded:internal_transfer'],
  ['internal transfer', 'excluded:internal_transfer'],
  ['salary', 'income:salary'],
  ['payroll', 'income:salary'],
  ['income', 'income:other_income'],
  ['business revenue', 'income:business_revenue'],
]);

const KEYWORDS = {
  cardPayment: [
    'card payment',
    'credit card payment',
    'credit-card payment',
    'pay credit card',
    'autopay card',
    '信用卡繳款',
    '信用卡款',
    '繳信用卡',
    '扣繳信用卡',
  ],
  transfer: [
    'transfer',
    'internal transfer',
    'bank transfer',
    'own account transfer',
    'transfer between accounts',
    '轉帳',
    '轉入',
    '轉出',
    '內部移轉',
    '跨行轉',
  ],
  loanPrincipal: ['loan principal', 'principal repayment', 'principal', '本金'],
  investmentPurchase: [
    'investment purchase',
    'brokerage',
    'stock purchase',
    'etf',
    'fund purchase',
    '投資',
    '證券',
    '基金',
  ],
  interestExpense: ['loan interest', 'interest expense', '利息支出', '貸款利息'],
  interestIncome: ['interest income', 'bank interest', '存款利息', '利息收入'],
  salary: ['salary', 'payroll', 'wage', '薪資', '薪水'],
  businessRevenue: ['business revenue', 'client payment', 'invoice payment', '營收', '業務收入'],
  food: ['restaurant', 'cafe', 'coffee', 'food', '餐', '咖啡'],
  housing: ['rent', 'mortgage', 'housing', '房租', '租金'],
  transportation: ['uber', 'taxi', 'metro', 'bus', 'transport', '交通'],
  subscription: ['subscription', 'software', 'saas', '訂閱'],
  feesTaxes: ['fee', 'tax', '手續費', '稅'],
};

function isKnownReportLine(reportLine) {
  return Boolean(REPORT_LINE_DEFINITIONS[reportLine]);
}

function getReportLineDefinition(reportLine) {
  return REPORT_LINE_DEFINITIONS[reportLine] || null;
}

function directionFromRow(row) {
  if (Number(row.inflow) > 0) return 'in';
  if (Number(row.outflow) > 0) return 'out';
  return null;
}

function rowText(row) {
  return [
    row.name,
    row.category_primary,
    row.category_sub,
    row.memo,
    row.raw_info,
    row.flow_type,
    row.source_type,
    row.account_name,
    row.account_type,
  ].filter(Boolean).join(' ').toLowerCase();
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function cashMagnitude(row) {
  const inflow = Math.abs(Number(row.inflow) || 0);
  const outflow = Math.abs(Number(row.outflow) || 0);
  const amount = Math.abs(Number(row.amount) || 0);
  return inflow || outflow || amount;
}

function typedOwnerCoversRow(row, field) {
  const ownedAmount = Math.abs(Number(row[field]) || 0);
  const rowAmount = cashMagnitude(row);
  return ownedAmount > 0 && rowAmount > 0 && ownedAmount === rowAmount;
}

function typedOwnerExclusion(kind) {
  const exclusion = reportExclusionForEventKind(kind);
  return exclusion ? {
    ...exclusion,
    mappingSource: 'typed_owner',
    confidence: 1,
  } : null;
}

function isHumanMappingSource(source) {
  return ['human', 'human_correction', 'manual', 'owner_confirmed', 'user_confirmed']
    .includes(String(source || '').trim().toLowerCase());
}

function isHumanConfirmedClassification(row) {
  return Number(row.reviewed) === 1
    && isHumanMappingSource(row.classification_source);
}

function isHumanConfirmedReportMapping(row) {
  return Number(row.mapping_reviewed) === 1
    && isHumanMappingSource(row.mapping_source);
}

function categoryReportLine(row) {
  const raw = String(row.category_primary || '').trim();
  if (!raw) return null;
  return CATEGORY_REPORT_LINES.get(raw) || CATEGORY_REPORT_LINES.get(raw.toLowerCase()) || null;
}

function ruleApplies(row, rule) {
  if (!rule || !rule.report_line || !isKnownReportLine(rule.report_line)) return false;

  const matchKey = String(rule.match_key || '').trim();
  if (matchKey) {
    const normalizedName = normalizeForRule(row.name || '');
    const importKey = String(row.import_match_key || '').trim();
    if (matchKey !== normalizedName && matchKey !== importKey) return false;
  }

  if (rule.source_type && rule.source_type !== row.source_type) return false;
  if (rule.direction && rule.direction !== directionFromRow(row)) return false;
  return true;
}

function findReportRule(row, rules) {
  if (!Array.isArray(rules)) return null;
  return rules.find((rule) => ruleApplies(row, rule)) || null;
}

function evidenceBackedExclusion(row) {
  const direction = directionFromRow(row);

  if (typedOwnerCoversRow(row, 'typed_transfer_amount_minor')) {
    return typedOwnerExclusion('own_transfer');
  }

  if (typedOwnerCoversRow(row, 'typed_card_payment_amount_minor')) {
    return typedOwnerExclusion('credit_card_payment');
  }

  if (typedOwnerCoversRow(row, 'typed_investment_cash_minor')) {
    return typedOwnerExclusion('investment_purchase');
  }

  if (String(row.category_primary || '').trim() === OWNER_UNRESOLVED_CATEGORY
    && isHumanConfirmedClassification(row)) {
    const cashDirection = direction || (Number(row.amount) > 0 ? 'in' : Number(row.amount) < 0 ? 'out' : null);
    const unresolved = reportExclusionForEventKind('owner_unresolved', { cash_direction: cashDirection });
    if (unresolved) return {
      ...unresolved,
      mappingSource: 'human',
      confidence: 1,
    };
  }

  return null;
}

function builtInReportLine(row) {
  const text = rowText(row);
  const direction = directionFromRow(row);
  const categoryLine = categoryReportLine(row);

  if (direction === 'in' && hasAny(text, KEYWORDS.interestIncome)) {
    return { reportLine: 'income:interest_income', reason: 'built-in interest income mapping' };
  }

  if (direction === 'out' && hasAny(text, KEYWORDS.interestExpense)) {
    return { reportLine: 'expense:interest', reason: 'built-in interest expense mapping' };
  }

  if (categoryLine && !categoryLine.startsWith('excluded:')) {
    return {
      reportLine: categoryLine,
      reason: 'transaction category mapped to report line',
      mappingSource: row.classification_source || 'category',
      confidence: row.ai_confidence ?? null,
    };
  }

  if (direction === 'in' && hasAny(text, KEYWORDS.salary)) {
    return { reportLine: 'income:salary', reason: 'built-in salary keyword mapping' };
  }

  if (direction === 'in' && hasAny(text, KEYWORDS.businessRevenue)) {
    return { reportLine: 'income:business_revenue', reason: 'built-in business revenue keyword mapping' };
  }

  if (direction === 'out' && hasAny(text, KEYWORDS.food)) {
    return { reportLine: 'expense:food', reason: 'built-in food keyword mapping' };
  }

  if (direction === 'out' && hasAny(text, KEYWORDS.housing)) {
    return { reportLine: 'expense:housing', reason: 'built-in housing keyword mapping' };
  }

  if (direction === 'out' && hasAny(text, KEYWORDS.transportation)) {
    return { reportLine: 'expense:transportation', reason: 'built-in transportation keyword mapping' };
  }

  if (direction === 'out' && hasAny(text, KEYWORDS.subscription)) {
    return { reportLine: 'expense:subscription_software', reason: 'built-in subscription keyword mapping' };
  }

  if (direction === 'out' && hasAny(text, KEYWORDS.feesTaxes)) {
    return { reportLine: 'expense:fees_taxes', reason: 'built-in fees/taxes keyword mapping' };
  }

  return null;
}

function exclusionCandidateReason(row) {
  const text = rowText(row);
  const direction = directionFromRow(row);
  const categoryLine = categoryReportLine(row);
  const partialTypedOwner = [
    row.typed_transfer_amount_minor,
    row.typed_card_payment_amount_minor,
    row.typed_investment_cash_minor,
  ].some((amount) => Math.abs(Number(amount) || 0) > 0);

  if (partialTypedOwner) {
    return '已有部分 owner 配對，但配對金額不足以覆蓋整筆交易；需要確認剩餘金額。';
  }

  if (hasAny(text, KEYWORDS.loanPrincipal)) {
    return '疑似貸款還款，但沒有已確認的本金、利息與費用拆分。';
  }

  if (direction === 'out' && hasAny(text, KEYWORDS.cardPayment)) {
    return '疑似信用卡繳款或相關移轉，但沒有已確認的帳單繳款配對。';
  }

  if (direction === 'out' && hasAny(text, KEYWORDS.investmentPurchase)) {
    return '疑似投資買入，但沒有已確認的交易與現金配對。';
  }

  if (categoryLine === 'excluded:internal_transfer' || hasAny(text, KEYWORDS.transfer)) {
    return '疑似內部轉帳，但沒有已確認的雙邊轉帳配對。';
  }

  if (String(row.category_primary || '').trim() === OWNER_UNRESOLVED_CATEGORY) {
    return '用途仍無法確認；需要擁有者確認後才能排除於損益。';
  }

  return null;
}

function classifyTransactionForReport(row, rules = []) {
  const explicitLine = row.mapping_report_line || row.report_line;
  if (explicitLine) {
    if (isKnownReportLine(explicitLine)) {
      const definition = getReportLineDefinition(explicitLine);
      if (definition?.group === 'excluded' && !isHumanConfirmedReportMapping(row)) {
        return {
          status: 'unmapped',
          reportLine: null,
          definition: null,
          mappingSource: 'unconfirmed_explicit_exclusion',
          confidence: row.mapping_confidence ?? row.confidence ?? null,
          reason: '逐筆排除尚未經人工確認；確認前不列入排除小計。',
          ruleId: row.mapping_rule_id ?? null,
        };
      }
      return {
        status: 'mapped',
        reportLine: explicitLine,
        definition,
        mappingSource: row.mapping_source || 'explicit',
        confidence: row.mapping_confidence ?? row.confidence ?? null,
        reason: row.mapping_reason || 'explicit transaction report mapping',
        ruleId: row.mapping_rule_id ?? null,
      };
    }
    return {
      status: 'unmapped',
      reportLine: null,
      definition: null,
      mappingSource: 'invalid_explicit_mapping',
      confidence: row.mapping_confidence ?? null,
      reason: `unknown report line: ${explicitLine}`,
      ruleId: row.mapping_rule_id ?? null,
    };
  }

  const exclusion = evidenceBackedExclusion(row);
  if (exclusion) {
    return {
      status: 'mapped',
      reportLine: exclusion.reportLine,
      definition: getReportLineDefinition(exclusion.reportLine),
      mappingSource: exclusion.mappingSource || 'typed_owner',
      confidence: exclusion.confidence ?? null,
      reason: exclusion.reason,
      ruleId: null,
    };
  }

  const rule = findReportRule(row, rules);
  const ruleDefinition = rule ? getReportLineDefinition(rule.report_line) : null;
  if (rule && ruleDefinition?.group !== 'excluded') {
    return {
      status: 'mapped',
      reportLine: rule.report_line,
      definition: ruleDefinition,
      mappingSource: 'report_rule',
      confidence: rule.confidence,
      reason: rule.note || 'report mapping rule',
      ruleId: rule.id,
    };
  }

  const builtIn = builtInReportLine(row);
  if (builtIn) {
    return {
      status: 'mapped',
      reportLine: builtIn.reportLine,
      definition: getReportLineDefinition(builtIn.reportLine),
      mappingSource: builtIn.mappingSource || 'built_in',
      confidence: builtIn.confidence ?? null,
      reason: builtIn.reason,
      ruleId: null,
    };
  }

  const candidateReason = exclusionCandidateReason(row)
    || (ruleDefinition?.group === 'excluded'
      ? '一般報表規則建議排除，但缺少人工逐筆確認或已確認的專屬配對。'
      : null);

  return {
    status: 'unmapped',
    reportLine: null,
    definition: null,
    mappingSource: 'unmapped',
    confidence: null,
    reason: candidateReason || 'no explicit, rule, category, or built-in mapping matched',
    ruleId: null,
  };
}

function amountForReportGroup(row, group) {
  const inflow = Number(row.inflow) || 0;
  const outflow = Number(row.outflow) || 0;
  const amount = Number(row.amount) || 0;
  if (group === 'revenue') return Math.abs(inflow || (amount > 0 ? amount : 0));
  if (group === 'excluded') return Math.abs(inflow || outflow || amount);
  return Math.abs(outflow || (amount < 0 ? amount : 0));
}

module.exports = {
  REPORT_LINE_DEFINITIONS,
  isKnownReportLine,
  getReportLineDefinition,
  classifyTransactionForReport,
  amountForReportGroup,
};
