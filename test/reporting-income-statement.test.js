const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function runFixture(rows, params = 'month=2026-06', extraSql = '', options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-reporting-'));
  const dbPath = path.join(dir, 'finance.sqlite');
  const script = `
    const { getDb, closeDb } = require('./lib/db');
    const { getIncomeStatement } = require('./lib/queries');
    const rows = JSON.parse(process.argv[1]);
    const params = new URLSearchParams(process.argv[2] || '');
    const extraSql = process.argv[3] || '';
    const reopenAfterExtraSql = process.argv[4] === '1';
    let db = getDb();
    const accountIds = new Map();
    function accountId(name, type) {
      const key = name + ':' + type;
      if (accountIds.has(key)) return accountIds.get(key);
      const id = db.prepare('INSERT INTO accounts (name, account_type) VALUES (?, ?)').run(name, type).lastInsertRowid;
      accountIds.set(key, id);
      return id;
    }
    const insert = db.prepare(\`
      INSERT INTO transactions (
        dedupe_key, import_match_key, transaction_date, transaction_month,
        source_type, flow_type, name, amount, inflow, outflow,
        category_primary, ai_confidence, judgment_reason, account_id,
        classification_source, reviewed
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    \`);
    rows.forEach((row, index) => {
      insert.run(
        row.dedupe_key || 'row-' + index,
        row.import_match_key || row.name.toLowerCase().replace(/\\s+/g, '-'),
        row.transaction_date || '2026-06-01',
        row.transaction_month || '2026-06',
        row.source_type || 'bank',
        row.flow_type || 'purchase',
        row.name,
        row.amount,
        row.inflow || 0,
        row.outflow || 0,
        row.category_primary || 'Unmapped',
        row.ai_confidence ?? 0.9,
        row.judgment_reason || 'fixture row',
        accountId(row.account_name || 'Checking', row.account_type || 'bank'),
        row.classification_source || 'ai',
        row.reviewed ?? 1
      );
    });
    if (extraSql) db.exec(extraSql);
    // 模擬升級：DROP reporting 表後重開連線，migrateSchema 應冪等補回缺失的 reporting 表。
    if (reopenAfterExtraSql) {
      closeDb();
      db = getDb();
    }
    const result = getIncomeStatement(params, db);
    closeDb();
    console.log(JSON.stringify(result));
  `;

  try {
    const stdout = execFileSync(process.execPath, ['-e', script, JSON.stringify(rows), params, extraSql, options.reopenAfterExtraSql ? '1' : '0'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, FINANCE_DB_PATH: dbPath },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function findLine(lines, line) {
  return lines.find((item) => item.line === line);
}

test('management P&L counts card charges once and excludes settlements/transfers/principal', () => {
  const report = runFixture([
    {
      name: 'Card restaurant charge',
      source_type: 'credit card',
      account_name: 'Rewards Card',
      account_type: 'credit_card',
      amount: -100000,
      outflow: 100000,
      category_primary: 'Food',
    },
    {
      name: 'Credit card payment from checking',
      source_type: 'bank',
      account_name: 'Checking',
      account_type: 'bank',
      amount: -100000,
      outflow: 100000,
      category_primary: 'Transfer',
    },
    {
      name: 'Internal transfer to savings',
      source_type: 'bank',
      account_name: 'Checking',
      account_type: 'bank',
      amount: -500000,
      outflow: 500000,
      category_primary: 'Transfer',
    },
    {
      name: 'Internal transfer from checking',
      source_type: 'bank',
      account_name: 'Savings',
      account_type: 'bank',
      amount: 500000,
      inflow: 500000,
      category_primary: 'Transfer',
    },
    {
      name: 'Salary deposit',
      source_type: 'bank',
      account_name: 'Checking',
      account_type: 'bank',
      amount: 8000000,
      inflow: 8000000,
      category_primary: 'Salary',
    },
    {
      name: 'Loan principal repayment',
      source_type: 'bank',
      account_name: 'Checking',
      account_type: 'bank',
      amount: -900000,
      outflow: 900000,
      category_primary: 'Loan',
    },
    {
      name: 'Loan interest',
      source_type: 'bank',
      account_name: 'Checking',
      account_type: 'bank',
      amount: -100000,
      outflow: 100000,
      category_primary: 'Fees',
    },
  ]);

  assert.equal(report.coverage.status, 'complete');
  assert.equal(report.total_revenue_cents, 8000000);
  assert.equal(report.total_expense_cents, 200000);
  assert.equal(report.net_income_cents, 7800000);
  assert.equal(findLine(report.expenses, 'expense:food').amount_cents, 100000);
  assert.equal(findLine(report.expenses, 'expense:interest').amount_cents, 100000);
  assert.equal(findLine(report.excluded, 'excluded:credit_card_payment').amount_cents, 100000);
  assert.equal(findLine(report.excluded, 'excluded:internal_transfer').amount_cents, 1000000);
  assert.equal(findLine(report.excluded, 'excluded:loan_principal').amount_cents, 900000);

  // management-pl-contract L190: drilldown from statement line to underlying transactions.
  // The card restaurant charge is the first inserted row (id = 1) and maps to expense:food.
  const foodLine = findLine(report.expenses, 'expense:food');
  assert.ok(foodLine.transaction_ids.includes(1), 'expense:food should drill down to the card restaurant charge row id');
  assert.equal(foodLine.transaction_count, 1);
});

test('unmapped or unreviewed rows make the P&L partial without hiding computed totals', () => {
  const report = runFixture([
    {
      name: 'Known cafe',
      amount: -12000,
      outflow: 12000,
      category_primary: 'Food',
      reviewed: 1,
    },
    {
      name: 'Ambiguous counterparty',
      amount: -34000,
      outflow: 34000,
      category_primary: 'Mystery',
      reviewed: 0,
      ai_confidence: 0.3,
    },
  ]);

  assert.equal(report.coverage.status, 'partial');
  assert.equal(report.total_expense_cents, 12000);
  assert.equal(report.unmapped_transaction_count, 1);
  assert.equal(report.unreviewed_transaction_count, 1);
  assert.equal(report.review_items.length, 1);
  assert.equal(report.coverage.blockers.length, 2);
});

test('owner-unresolved cash is disclosed separately and never invented as P&L', () => {
  const report = runFixture([
    {
      name: 'Owner unresolved inflow',
      amount: 40000,
      inflow: 40000,
      category_primary: '無法確認',
      classification_source: 'human',
      reviewed: 1,
    },
    {
      name: 'Owner unresolved outflow',
      amount: -150000,
      outflow: 150000,
      category_primary: '無法確認',
      classification_source: 'human',
      reviewed: 1,
    },
  ]);

  assert.equal(report.total_revenue_cents, 0);
  assert.equal(report.total_expense_cents, 0);
  assert.equal(report.net_income_cents, 0);
  assert.equal(report.unmapped_transaction_count, 0);
  assert.equal(report.unreviewed_transaction_count, 0);
  assert.equal(report.owner_unresolved_transaction_count, 2);
  assert.equal(report.owner_unresolved_inflow_cents, 40000);
  assert.equal(report.owner_unresolved_outflow_cents, 150000);
  assert.equal(report.owner_unresolved_net_cents, -110000);
  assert.equal(findLine(report.excluded, 'excluded:unresolved_inflow').amount_cents, 40000);
  assert.equal(findLine(report.excluded, 'excluded:unresolved_outflow').amount_cents, 150000);
  assert.equal(report.coverage.status, 'partial');
  assert.equal(report.coverage.blockers.length, 1);
  assert.equal(report.coverage.blockers[0].kind, 'owner_unresolved_transaction');
});

test('ordinary report rules cannot turn deterministic card-payment exclusions into expenses', () => {
  const report = runFixture([
    {
      name: '本行自動扣繳',
      flow_type: '信用卡繳款/移轉',
      amount: -3913200,
      inflow: 3913200,
      outflow: 0,
      category_primary: '轉帳/內部移轉',
      reviewed: 0,
      ai_confidence: 0.95,
    },
  ], 'month=2026-06', `
    INSERT INTO report_mapping_rules (
      match_key, report_line, confidence, origin, note
    ) VALUES (
      '本行自動扣繳', 'expense:education', 0.9, 'ai_analysis', 'rule test'
    );
  `);

  assert.equal(report.total_expense_cents, 0);
  assert.equal(report.unreviewed_transaction_count, 0);
  assert.equal(findLine(report.expenses, 'expense:education'), undefined);
  assert.equal(findLine(report.excluded, 'excluded:internal_transfer').amount_cents, 3913200);
});

test('report review coverage matches the low-confidence transaction review queue', () => {
  const report = runFixture([
    {
      name: 'High-confidence known expense',
      amount: -12000,
      outflow: 12000,
      category_primary: 'Food',
      reviewed: 0,
      ai_confidence: 0.72,
    },
    {
      name: 'Low-confidence known expense',
      amount: -34000,
      outflow: 34000,
      category_primary: 'Food',
      reviewed: 0,
      ai_confidence: 0.35,
    },
  ]);

  assert.equal(report.unreviewed_transaction_count, 1);
  assert.equal(report.coverage.blockers.length, 1);
  assert.equal(report.coverage.blockers[0].kind, 'unreviewed_transaction');
});

// R2(b)：reviewItem 回傳 transaction_id（值 = id），讓 AI POST review 時可直接取用。
test('review_items expose transaction_id equal to id for AI to POST (R2b)', () => {
  const report = runFixture([
    {
      name: 'Ambiguous counterparty',
      amount: -34000,
      outflow: 34000,
      category_primary: 'Mystery',
      reviewed: 0,
      ai_confidence: 0.3,
    },
  ]);
  assert.equal(report.review_items.length, 1);
  const ri = report.review_items[0];
  assert.ok('transaction_id' in ri, 'review_items must carry transaction_id');
  assert.equal(ri.transaction_id, ri.id, 'transaction_id equals id');
});

test('explicit transaction report mappings override built-in category mapping', () => {
  const report = runFixture([
    {
      name: 'Contract software tool',
      amount: -45000,
      outflow: 45000,
      category_primary: 'Mystery',
    },
  ], 'month=2026-06', `
    INSERT INTO transaction_report_mappings (
      transaction_id, report_line, mapping_source, confidence, reason
    )
    SELECT id, 'expense:business_operating', 'human', 1.0, 'operator mapped fixture'
    FROM transactions
    WHERE name = 'Contract software tool';
  `);

  assert.equal(report.coverage.status, 'complete');
  assert.equal(report.unmapped_transaction_count, 0);
  assert.equal(findLine(report.expenses, 'expense:business_operating').amount_cents, 45000);
});

test('income statement recreates missing reporting tables for upgraded live DBs', () => {
  const report = runFixture([
    {
      name: 'Known cafe',
      amount: -12000,
      outflow: 12000,
      category_primary: 'Food',
      reviewed: 1,
    },
  ], 'month=2026-06', `
    DROP TABLE IF EXISTS transaction_report_mappings;
    DROP TABLE IF EXISTS report_mapping_rules;
  `, { reopenAfterExtraSql: true });

  assert.equal(report.coverage.status, 'complete');
  assert.equal(report.unmapped_transaction_count, 0);
  assert.equal(findLine(report.expenses, 'expense:food').amount_cents, 12000);
});

test('transfer keyword catches transfers whose category is not the Transfer category', () => {
  // WP4: the 'transfer' keyword was added so built-in detection fires on rows whose
  // category_primary is not the dedicated Transfer category but whose name signals a transfer.
  const report = runFixture([
    {
      name: 'Transfer to savings',
      amount: -300000,
      outflow: 300000,
      category_primary: 'Other',
    },
  ]);

  assert.equal(report.coverage.status, 'complete');
  assert.equal(findLine(report.excluded, 'excluded:internal_transfer').amount_cents, 300000);
  assert.equal(findLine(report.excluded, 'excluded:internal_transfer').transaction_count, 1);
});

test('amountForReportGroup falls back to negative amount when outflow is zero', () => {
  // WP4: dead-code guard. expense group returns Math.abs(outflow || (amount < 0 ? amount : 0)).
  // With outflow = 0 (falsy) and amount < 0, the fallback must contribute abs(amount) to the expense.
  const report = runFixture([
    {
      name: 'Charge without outflow column populated',
      amount: -77000,
      outflow: 0,
      category_primary: 'Food',
    },
  ]);

  assert.equal(report.coverage.status, 'complete');
  assert.equal(findLine(report.expenses, 'expense:food').amount_cents, 77000);
  assert.equal(report.total_expense_cents, 77000);
});

test('unmapped rows with no unreviewed rows yield the unmapped coverage status', () => {
  // WP4: the coverage status has a fourth state. When unmapped > 0 but unreviewed == 0,
  // status must be 'unmapped' (distinct from 'partial' which requires unreviewed/unmatched blockers).
  const report = runFixture([
    {
      name: 'Cafe with known category',
      amount: -12000,
      outflow: 12000,
      category_primary: 'Food',
      reviewed: 1,
    },
    {
      name: 'Opaque vendor with no category',
      amount: -99000,
      outflow: 99000,
      category_primary: 'Unmapped',
      reviewed: 1,
    },
  ]);

  assert.equal(report.coverage.status, 'unmapped');
  assert.equal(report.unmapped_transaction_count, 1);
  assert.equal(report.unreviewed_transaction_count, 0);
  assert.equal(report.total_expense_cents, 12000);
  assert.equal(report.coverage.blockers.length, 1);
  assert.equal(report.coverage.blockers[0].kind, 'unmapped_report_line');
});
