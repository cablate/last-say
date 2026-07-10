// Deterministic demo data for fresh clones and screenshots.
// No real financial data. Use FINANCE_DB_PATH to point this at a demo DB:
//   FINANCE_DB_PATH=data/dev-demo.sqlite npm run seed:demo:reset
const crypto = require('node:crypto');
const { openDatabase, initializeDatabase, DEFAULT_DB_PATH } = require('../lib/db');
const { normalizeForRule } = require('../lib/normalize');

const RESET = process.argv.includes('--reset');

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const RULE_RATE_TARGETS = [0.2, 0.32, 0.45, 0.58, 0.68, 0.76];
const SOURCE_CARD = '示範信用卡';
const SOURCE_BANK = '示範存款帳戶';
const SOURCE_LOAN = '示範貸款帳戶';
const SOURCE_INVEST = '示範投資帳戶';
const SOURCE_SAVINGS = '示範儲蓄帳戶';

const MERCHANTS = [
  { name: 'BLUE BOTTLE DEMO', category: '飲食', sub: '咖啡', amount: 180, rule: true, note: 'Demo coffee shop.' },
  { name: 'CITY BISTRO', category: '飲食', sub: '餐廳', amount: 520, rule: true, note: 'Demo restaurant.' },
  { name: 'UBER TRIP DEMO', category: '交通', sub: '叫車', amount: 260, rule: true, note: 'Demo rideshare.' },
  { name: 'METRO PASS', category: '交通', sub: '大眾運輸', amount: 1280, rule: true, note: 'Demo transit pass.' },
  { name: 'GOOGLE*CLOUD DEMO', category: '訂閱服務', sub: '雲端', amount: 820, rule: true, note: 'Demo cloud subscription.' },
  { name: 'GITHUB DEMO', category: '訂閱服務', sub: '開發工具', amount: 320, rule: true, note: 'Demo developer subscription.' },
  { name: 'STREAMBOX DEMO', category: '訂閱服務', sub: '影音', amount: 390, rule: true, note: 'Demo streaming subscription.' },
  { name: 'BOOKSTORE DEMO', category: '教育學習', sub: '書籍', amount: 640, rule: true, note: 'Demo bookstore.', humanRule: true },
  { name: 'ONLINE COURSE DEMO', category: '教育學習', sub: '課程', amount: 1800, rule: true, note: 'Demo online course.', humanRule: true },
  { name: 'HOME MARKET', category: '居住', sub: '居家用品', amount: 980, rule: true, note: 'Demo home goods.' },
  { name: 'PHARMACY DEMO', category: '醫療保健', sub: '藥局', amount: 450, rule: true, note: 'Demo pharmacy.' },
  { name: 'CINEMA DEMO', category: '休閒娛樂', sub: '電影', amount: 620, rule: true, note: 'Demo cinema.' },
  { name: 'FX SERVICE FEE', category: '金融手續與稅費', sub: '手續費', amount: 35, rule: true, note: 'Demo card fee.' },
  { name: 'MALL DEMO', category: '購物', sub: '百貨', amount: 1450, rule: true, note: 'Demo retail merchant.' },
  { name: 'PET SUPPLY DEMO', category: '日常開銷', sub: '寵物', amount: 760, rule: true, note: 'Demo pet supply.' },
  { name: 'INSURANCE DEMO', category: '保險', sub: '保費', amount: 2200, rule: true, note: 'Demo insurance payment.' },
  { name: 'TAX PAYMENT DEMO', category: '金融手續與稅費', sub: '稅費', amount: 1250, rule: true, note: 'Demo tax payment.' },
  { name: 'UNKNOWN SHOP A', category: '購物', sub: '待審', amount: 390, rule: false, low: true },
  { name: 'TRUNCATED MART B', category: '日常開銷', sub: '待審', amount: 260, rule: false, low: true },
  { name: 'ONE-OFF HOBBY', category: '休閒娛樂', sub: '活動', amount: 980, rule: false },
  { name: 'LOCAL HARDWARE', category: '日常開銷', sub: '五金', amount: 310, rule: false },
  { name: 'GIFT SHOP DEMO', category: '購物', sub: '禮品', amount: 720, rule: false },
  { name: 'CLINIC DEMO', category: '醫療保健', sub: '診所', amount: 900, rule: false },
  { name: 'GYM DAY PASS', category: '休閒娛樂', sub: '運動', amount: 500, rule: false },
  { name: 'WORKSHOP TOOLS DEMO', category: '教育學習', sub: '工作坊', amount: 1600, rule: false, humanFixTo: '教育學習' },
];

const hashKey = (parts) => crypto.createHash('sha1').update(parts.join('|'), 'utf8').digest('hex');
const cents = (value) => Math.round(value * 100);
const day = (n) => String(n).padStart(2, '0');
const RULE_MERCHANTS = MERCHANTS.filter((merchant) => merchant.rule);
const REVIEW_MERCHANTS = MERCHANTS.filter((merchant) => !merchant.rule);
const CORRECTION_MERCHANTS = MERCHANTS.filter((merchant) => merchant.humanRule);

const db = openDatabase(DEFAULT_DB_PATH);

if (RESET) {
  db.exec(`
    DROP TABLE IF EXISTS correction_log;
    DROP TABLE IF EXISTS transaction_tags;
    DROP TABLE IF EXISTS transaction_sources;
    DROP TABLE IF EXISTS transactions;
    DROP TABLE IF EXISTS tags;
    DROP TABLE IF EXISTS sources;
    DROP TABLE IF EXISTS accounts;
    DROP TABLE IF EXISTS classification_rules;
  `);
}
initializeDatabase(db);

if (!RESET) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
  if (existing > 0) {
    console.log(`⚠ DB 已有 ${existing} 筆資料，seed:demo 預設不清空以保護既有資料。`);
    console.log('  若要重建 demo（會清空既有），請改用：npm run seed:demo:reset');
    db.close();
    process.exit(0);
  }
}

const cardAccountId = db.prepare(
  'INSERT INTO accounts (name, institution, account_type, masked_number) VALUES (?, ?, ?, ?)'
).run(`${SOURCE_CARD} ****1234`, 'Demo Bank', 'credit_card', '****1234').lastInsertRowid;
const bankAccountId = db.prepare(
  'INSERT INTO accounts (name, institution, account_type, masked_number) VALUES (?, ?, ?, ?)'
).run(`${SOURCE_BANK} ****5678`, 'Demo Bank', 'bank_account', '****5678').lastInsertRowid;
// 示範帳戶類型 loan / investment / savings（spec §785-786 要求 demo 涵蓋）
const loanAccountId = db.prepare(
  'INSERT INTO accounts (name, institution, account_type, masked_number) VALUES (?, ?, ?, ?)'
).run(`${SOURCE_LOAN} ****2468`, 'Demo Bank', 'loan', '****2468').lastInsertRowid;
const investAccountId = db.prepare(
  'INSERT INTO accounts (name, institution, account_type, masked_number) VALUES (?, ?, ?, ?)'
).run(`${SOURCE_INVEST} ****3579`, 'Demo Brokerage', 'investment', '****3579').lastInsertRowid;
const savingsAccountId = db.prepare(
  'INSERT INTO accounts (name, institution, account_type, masked_number) VALUES (?, ?, ?, ?)'
).run(`${SOURCE_SAVINGS} ****8080`, 'Demo Bank', 'savings', '****8080').lastInsertRowid;

const sourceIds = new Map();
for (const month of MONTHS) {
  const cardSourceId = db.prepare(`
    INSERT INTO sources (source_type, source_file, description, statement_month, row_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(SOURCE_CARD, `demo-credit-card-${month}.csv`, `${month} demo statement`, month, 25).lastInsertRowid;
  const bankSourceId = db.prepare(`
    INSERT INTO sources (source_type, source_file, description, statement_month, row_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(SOURCE_BANK, `demo-bank-${month}.csv`, `${month} demo account`, month, 1).lastInsertRowid;
  const loanSourceId = db.prepare(`
    INSERT INTO sources (source_type, source_file, description, statement_month, row_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(SOURCE_LOAN, `demo-loan-${month}.csv`, `${month} demo loan statement`, month, 2).lastInsertRowid;
  const investSourceId = db.prepare(`
    INSERT INTO sources (source_type, source_file, description, statement_month, row_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(SOURCE_INVEST, `demo-invest-${month}.csv`, `${month} demo brokerage statement`, month, 1).lastInsertRowid;
  const savingsSourceId = db.prepare(`
    INSERT INTO sources (source_type, source_file, description, statement_month, row_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(SOURCE_SAVINGS, `demo-savings-${month}.csv`, `${month} demo savings interest`, month, 1).lastInsertRowid;
  sourceIds.set(`${month}:card`, cardSourceId);
  sourceIds.set(`${month}:bank`, bankSourceId);
  sourceIds.set(`${month}:loan`, loanSourceId);
  sourceIds.set(`${month}:invest`, investSourceId);
  sourceIds.set(`${month}:savings`, savingsSourceId);
}

const ruleIds = new Map();
for (const merchant of MERCHANTS.filter((m) => m.rule)) {
  const origin = merchant.humanRule ? 'human_correction' : 'ai_analysis';
  const ruleId = db.prepare(`
    INSERT INTO classification_rules
      (match_key, source_type, direction, category_value, confidence, sample_count, origin, enabled, note)
    VALUES (?, ?, 'out', ?, ?, ?, ?, 1, ?)
  `).run(
    normalizeForRule(merchant.name),
    SOURCE_CARD,
    merchant.category,
    merchant.humanRule ? 0.92 : 0.84,
    merchant.humanRule ? 3 : 6,
    origin,
    `${merchant.note} Demo rule created from ${origin === 'human_correction' ? 'human corrections' : 'AI analysis'}.`,
  ).lastInsertRowid;
  ruleIds.set(merchant.name, ruleId);
}
const salaryRuleId = db.prepare(`
  INSERT INTO classification_rules
    (match_key, source_type, direction, category_value, confidence, sample_count, origin, enabled, note)
  VALUES (?, ?, 'in', '薪資收入', 0.98, 6, 'bootstrap', 1, 'Demo salary deposit rule.')
`).run(normalizeForRule('DEMO SALARY'), SOURCE_BANK).lastInsertRowid;

const ruleApplied = new Map();
function bumpRule(ruleId) {
  if (!ruleId) return;
  ruleApplied.set(ruleId, (ruleApplied.get(ruleId) || 0) + 1);
}

const insertTx = db.prepare(`
  INSERT INTO transactions (
    dedupe_key, import_match_key, transaction_date, transaction_month, statement_month,
    source_type, flow_type, name, amount, inflow, outflow,
    category_primary, category_sub, ai_confidence, judgment_reason, memo, raw_info, balance,
    account_original_order, account_id, first_source_id, classification_source, rule_id, reviewed
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const inserted = [];
let totalRows = 0;
for (const [monthIndex, month] of MONTHS.entries()) {
  const totalThisMonth = 26; // 25 card rows + 1 salary row.
  const targetRuleRows = Math.round(totalThisMonth * RULE_RATE_TARGETS[monthIndex]);
  const salaryCountsAsRule = 1;
  const cardRuleRows = Math.max(0, targetRuleRows - salaryCountsAsRule);
  const humanSlot = monthIndex >= 2 ? cardRuleRows : -1;

  for (let i = 0; i < 25; i += 1) {
    const isRuleSlot = i < cardRuleRows;
    const isHumanSlot = i === humanSlot;
    const merchant = isRuleSlot
      ? RULE_MERCHANTS[(i + monthIndex) % RULE_MERCHANTS.length]
      : (isHumanSlot
        ? CORRECTION_MERCHANTS[monthIndex % CORRECTION_MERCHANTS.length]
        : REVIEW_MERCHANTS[(i - cardRuleRows + monthIndex) % REVIEW_MERCHANTS.length]);
    const date = `${month}-${day((i % 24) + 1)}`;
    const amount = cents(merchant.amount + monthIndex * 11 + (i % 4) * 17);
    const dedupe = hashKey([SOURCE_CARD, date, merchant.name, amount, i]);
    const isRule = isRuleSlot;
    const isLow = !isRule && !isHumanSlot && (i < cardRuleRows + 3 || merchant.low);
    const isHuman = isHumanSlot;
    const ruleId = isRule ? ruleIds.get(merchant.name) : null;
    const source = isHuman ? 'human' : (isRule ? 'rule' : 'ai');
    const confidence = source === 'rule' ? 0.9 : (isLow ? 0.34 : 0.72);
    const reviewed = source === 'human' || (source === 'rule' && monthIndex < 3) ? 1 : 0;
    const reason = source === 'rule'
      ? `示範規則已辨識 ${merchant.name}，自動歸為${merchant.category}。`
      : (isLow
        ? `示範低信心：${merchant.name} 資訊不足，暫歸${merchant.category}待審。`
        : `示範 AI 初分：${merchant.name} 依商家型態歸為${merchant.category}。`);

    insertTx.run(
      dedupe,
      hashKey(['import', SOURCE_CARD, date, merchant.name, amount]),
      date,
      month,
      month,
      SOURCE_CARD,
      '信用卡消費',
      merchant.name,
      -amount,
      0,
      amount,
      isHuman && merchant.humanFixTo ? merchant.humanFixTo : merchant.category,
      merchant.sub || '',
      confidence,
      reason,
      '',
      '',
      null,
      String(i + 1),
      cardAccountId,
      sourceIds.get(`${month}:card`),
      source,
      ruleId,
      reviewed,
    );
    const txId = db.prepare('SELECT id FROM transactions WHERE dedupe_key = ?').get(dedupe).id;
    inserted.push({ id: txId, merchant, month, source, ruleId });
    if (source === 'rule') bumpRule(ruleId);
    totalRows += 1;
  }

  const salary = cents(68000 + monthIndex * 1200);
  const salaryDate = `${month}-05`;
  const salaryKey = hashKey([SOURCE_BANK, salaryDate, 'DEMO SALARY', salary]);
  insertTx.run(
    salaryKey,
    hashKey(['import', SOURCE_BANK, salaryDate, 'DEMO SALARY', salary]),
    salaryDate,
    month,
    month,
    SOURCE_BANK,
    '薪水入帳',
    'DEMO SALARY',
    salary,
    salary,
    0,
    '薪資收入',
    '',
    0.98,
    '示範薪資規則辨識固定入帳。',
    '',
    '',
    cents(120000 + monthIndex * 35000),
    '',
    bankAccountId,
    sourceIds.get(`${month}:bank`),
    'rule',
    salaryRuleId,
    1,
  );
  bumpRule(salaryRuleId);
  totalRows += 1;

  // === 示範帳戶類型 loan / investment / savings（spec §785-786）===
  // loan：示範本金還款（excluded:loan_principal）+ 利息分期（expense:interest）
  const loanPrincipal = cents(8500 + monthIndex * 50);
  const loanPrincipalDate = `${month}-15`;
  insertTx.run(
    hashKey([SOURCE_LOAN, loanPrincipalDate, 'DEMO LOAN PRINCIPAL', loanPrincipal, monthIndex]),
    hashKey(['import', SOURCE_LOAN, loanPrincipalDate, 'DEMO LOAN PRINCIPAL', loanPrincipal]),
    loanPrincipalDate,
    month,
    month,
    SOURCE_LOAN,
    '貸款本金還款',
    'DEMO LOAN PRINCIPAL',
    -loanPrincipal,
    0,
    loanPrincipal,
    '轉帳/內部移轉',
    '',
    0.9,
    '示範貸款本金還款（報表排除列）。',
    '',
    '',
    cents(480000 - monthIndex * 8500),
    '1',
    loanAccountId,
    sourceIds.get(`${month}:loan`),
    'rule',
    null,
    1,
  );
  totalRows += 1;

  const loanInterest = cents(3200);
  const loanInterestDate = `${month}-15`;
  insertTx.run(
    hashKey([SOURCE_LOAN, loanInterestDate, 'DEMO LOAN INTEREST', loanInterest, monthIndex]),
    hashKey(['import', SOURCE_LOAN, loanInterestDate, 'DEMO LOAN INTEREST', loanInterest]),
    loanInterestDate,
    month,
    month,
    SOURCE_LOAN,
    '貸款利息',
    'DEMO LOAN INTEREST',
    -loanInterest,
    0,
    loanInterest,
    '金融手續與稅費',
    '利息支出',
    0.88,
    '示範貸款利息支出（分期）。',
    '',
    '',
    null,
    '2',
    loanAccountId,
    sourceIds.get(`${month}:loan`),
    'rule',
    null,
    1,
  );
  totalRows += 1;

  // investment：示範定期定額買入（excluded:investment_purchase）
  const investAmount = cents(5000 + monthIndex * 100);
  const investDate = `${month}-20`;
  insertTx.run(
    hashKey([SOURCE_INVEST, investDate, 'DEMO ETF PURCHASE', investAmount, monthIndex]),
    hashKey(['import', SOURCE_INVEST, investDate, 'DEMO ETF PURCHASE', investAmount]),
    investDate,
    month,
    month,
    SOURCE_INVEST,
    '投資買入',
    'DEMO ETF PURCHASE',
    -investAmount,
    0,
    investAmount,
    '轉帳/內部移轉',
    'ETF',
    0.86,
    '示範投資帳戶定期定額買入（報表排除列）。',
    '',
    '',
    cents(60000 + monthIndex * 5000),
    '1',
    investAccountId,
    sourceIds.get(`${month}:invest`),
    'rule',
    null,
    1,
  );
  totalRows += 1;

  // savings：示範存款利息收入（interest income）
  const savingsInterest = cents(180 + monthIndex * 15);
  const savingsDate = `${month}-25`;
  insertTx.run(
    hashKey([SOURCE_SAVINGS, savingsDate, 'DEMO SAVINGS INTEREST', savingsInterest, monthIndex]),
    hashKey(['import', SOURCE_SAVINGS, savingsDate, 'DEMO SAVINGS INTEREST', savingsInterest]),
    savingsDate,
    month,
    month,
    SOURCE_SAVINGS,
    '存款利息入帳',
    'DEMO SAVINGS INTEREST',
    savingsInterest,
    savingsInterest,
    0,
    '其他收入與收益',
    '存款利息',
    0.95,
    '示範儲蓄帳戶利息收入。',
    '',
    '',
    cents(200000 + monthIndex * 12000),
    '1',
    savingsAccountId,
    sourceIds.get(`${month}:savings`),
    'rule',
    null,
    1,
  );
  totalRows += 1;
}

for (const [ruleId, count] of ruleApplied) {
  db.prepare('UPDATE classification_rules SET applied_count = ? WHERE id = ?').run(count, ruleId);
}

const correctionTargets = inserted.filter((row) => row.source === 'human').slice(0, 5);
for (const target of correctionTargets) {
  const matchKey = normalizeForRule(target.merchant.name);
  db.prepare(`
    INSERT INTO correction_log
      (transaction_id, field_name, old_value, new_value, match_key, source_type, direction, rule_id)
    VALUES (?, 'category_primary', ?, ?, ?, ?, 'out', ?)
  `).run(
    target.id,
    '購物',
    target.merchant.humanFixTo || target.merchant.category,
    matchKey,
    SOURCE_CARD,
    ruleIds.get(target.merchant.name) || null,
  );
}

const summary = db.prepare(`
  SELECT statement_month AS month,
         COUNT(*) AS total,
         SUM(CASE WHEN classification_source = 'rule' THEN 1 ELSE 0 END) AS rule_count,
         SUM(CASE WHEN reviewed = 0 AND (
           classification_source IS NULL
           OR classification_source = 'pending'
           OR (classification_source = 'ai' AND (ai_confidence < 0.5 OR ai_confidence IS NULL))
         ) THEN 1 ELSE 0 END) AS needs_review
  FROM transactions
  GROUP BY statement_month
  ORDER BY statement_month
`).all();
const corrections = db.prepare('SELECT COUNT(*) AS count FROM correction_log').get().count;
const humanRules = db.prepare("SELECT COUNT(*) AS count FROM classification_rules WHERE origin = 'human_correction'").get().count;

console.log(`✓ demo 資料建立完成：DB 共 ${totalRows} 筆交易。`);
console.log(`  月份：${MONTHS[0]} ~ ${MONTHS[MONTHS.length - 1]}`);
console.log(`  規則自動化率：${summary.map((row) => `${row.month} ${Math.round((row.rule_count / row.total) * 100)}%`).join(' → ')}`);
console.log(`  待審提示：${summary.map((row) => `${row.month} ${row.needs_review}`).join(' / ')}`);
console.log(`  人工修正：${corrections} 筆；human_correction 規則：${humanRules} 條。`);
const devHint = process.platform === 'win32'
  ? process.env.PSModulePath
    ? '  下一步（PowerShell）：$env:FINANCE_DB_PATH="data/dev-demo.sqlite"; npm run dev\n  或 cmd：set FINANCE_DB_PATH=data/dev-demo.sqlite && npm run dev'
    : '  下一步（cmd）：set FINANCE_DB_PATH=data/dev-demo.sqlite && npm run dev\n  或 PowerShell：$env:FINANCE_DB_PATH="data/dev-demo.sqlite"; npm run dev'
  : '  下一步（bash/zsh）：FINANCE_DB_PATH=data/dev-demo.sqlite npm run dev';
console.log(devHint);

db.close();
