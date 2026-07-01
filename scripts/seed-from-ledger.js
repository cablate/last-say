const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_DB_PATH, initializeDatabase, openDatabase } = require('../lib/db');
const { getMatchingRule, incrementRuleStat } = require('../lib/queries');
const { normalizeForRule } = require('../lib/normalize');

const PROJECT_ROOT = process.cwd();
const DEFAULT_LEDGER_PATH = path.join(PROJECT_ROOT, 'sample-ledger.csv');
const DEFAULT_SOURCE_INDEX_PATH = path.join(PROJECT_ROOT, 'sample-source-index.csv');

const args = new Set(process.argv.slice(2));
const reset = args.has('--reset');
const ledgerArg = process.argv.find((arg) => arg.startsWith('--ledger='));
const sourceIndexArg = process.argv.find((arg) => arg.startsWith('--source-index='));
const ledgerPath = ledgerArg ? path.resolve(ledgerArg.split('=').slice(1).join('=')) : DEFAULT_LEDGER_PATH;
const sourceIndexPath = sourceIndexArg ? path.resolve(sourceIndexArg.split('=').slice(1).join('=')) : DEFAULT_SOURCE_INDEX_PATH;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((items) => items.some((item) => item !== ''));
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const [rawHeader, ...rows] = parseCsv(text);
  const header = rawHeader.map((column) => column.replace(/^\uFEFF/, '').trim());
  return rows.map((values) => Object.fromEntries(header.map((column, index) => [column, values[index] ?? ''])));
}

function toNumber(value) {
  const clean = String(value ?? '').replace(/,/g, '').trim();
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

// 匯入去重用的輕量正規化（trim + collapse whitespace + lowercase）。
// 注意：這與 lib/normalize.js 的 normalizeForRule（NFKC + 去期數 + 去識別碼，用於規則比對鍵）
// 是「不同語意、不可互換」——本函式穩定餵 dedupe_key/import_match_key，改它會使既有資料失效。
function normalizeForDedupe(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hashKey(parts) {
  return crypto.createHash('sha1').update(parts.join('|'), 'utf8').digest('hex');
}

function sourceFamily(sourceType) {
  if (sourceType.includes('信用卡')) return 'card';
  if (sourceType.includes('帳戶')) return 'bank';
  return 'other';
}

function parseStatementMonth(sourceType, description, transactionMonth) {
  const posted = String(description).match(/(\d{4})-(\d{2})\s+posted statement/);
  if (posted) return `${posted[1]}-${posted[2]}`;

  const creditCsv = String(description).match(/cathay-credit-card-(\d{4})-(\d{2})/);
  if (creditCsv) return `${creditCsv[1]}-${creditCsv[2]}`;

  if (sourceType.includes('信用卡')) return transactionMonth || null;
  return null;
}

function accountType(sourceType) {
  if (sourceType.includes('信用卡')) return 'credit_card';
  if (sourceType.includes('帳戶')) return 'bank_account';
  return 'other';
}

function maskedNumber(sourceType, rawInfo) {
  const sourceMask = String(sourceType).match(/\*+(\d+)/);
  if (sourceMask) return sourceMask[1];
  const rawMask = String(rawInfo ?? '').match(/\b(\d{4})\b/);
  return rawMask ? rawMask[1] : null;
}

function buildKeys(row) {
  const sourceType = row['來源類型'] || '';
  const family = sourceFamily(sourceType);
  const date = row['日期'];
  const name = normalizeForDedupe(row['名稱']);
  const amount = toNumber(row['金額']) ?? 0;
  const importMatchKey = hashKey([family, date, name, amount]);

  if (family === 'card') {
    return {
      importMatchKey,
      dedupeKey: hashKey(['card', sourceType, date, name, amount])
    };
  }

  const balance = row['帳戶餘額'] || '';
  const order = row['帳戶原始排序'] || '';
  const rawInfo = row['原始交易資訊'] || '';
  return {
    importMatchKey,
    dedupeKey: hashKey(['bank', sourceType, date, name, amount, balance || order || rawInfo])
  };
}

const palette = [
  '#2563eb', '#059669', '#dc2626', '#d97706', '#7c3aed', '#0f766e',
  '#be123c', '#4f46e5', '#0891b2', '#65a30d', '#c2410c', '#475569'
];

const fixedTagColors = new Map([
  ['owner:個人', '#2563eb'],
  ['owner:事業', '#059669'],
  ['owner:事業候選', '#0f766e'],
  ['owner:待確認', '#d97706'],
  ['owner:移轉不算', '#64748b'],
  ['necessity:必要', '#dc2626'],
  ['necessity:事業必要', '#be123c'],
  ['necessity:可節省', '#d97706'],
  ['necessity:可優化', '#7c3aed'],
  ['necessity:需確認', '#ea580c'],
  ['necessity:不列入', '#64748b'],
  ['source:國泰信用卡', '#4f46e5'],
  ['source:國泰帳戶 ****1490', '#0f766e']
]);

function colorFor(tagType, name) {
  const key = `${tagType}:${name}`;
  if (fixedTagColors.has(key)) return fixedTagColors.get(key);
  const index = Math.abs([...key].reduce((sum, char) => sum + char.codePointAt(0), 0)) % palette.length;
  return palette[index];
}

function sourceIndexMap(sourceRows) {
  const map = new Map();
  for (const source of sourceRows) {
    map.set(`${source['來源類型']}|${source['說明']}`, source);
  }
  return map;
}

function upsertAccount(db, sourceType, rawInfo) {
  const name = sourceType;
  const accountTypeValue = accountType(sourceType);
  const masked = maskedNumber(sourceType, rawInfo);
  db.prepare(`
    INSERT INTO accounts (name, institution, account_type, masked_number)
    VALUES (?, '國泰', ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      account_type = excluded.account_type,
      masked_number = COALESCE(excluded.masked_number, accounts.masked_number)
  `).run(name, accountTypeValue, masked);
  return db.prepare('SELECT id FROM accounts WHERE name = ?').get(name).id;
}

function upsertSource(db, row, sourceMap) {
  const sourceType = row['來源類型'] || '';
  const description = row['來源說明'] || 'unknown source';
  const indexed = sourceMap.get(`${sourceType}|${description}`);
  const sourceFile = indexed?.['來源檔'] || '';
  const rowCount = toNumber(indexed?.['筆數']);
  const statementMonth = parseStatementMonth(sourceType, description, row['月份']);
  db.prepare(`
    INSERT INTO sources (source_type, source_file, description, statement_month, row_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_type, source_file, description) DO UPDATE SET
      statement_month = excluded.statement_month,
      row_count = COALESCE(excluded.row_count, sources.row_count)
  `).run(sourceType, sourceFile, description, statementMonth, rowCount);
  return db.prepare(`
    SELECT id, statement_month AS statementMonth
    FROM sources
    WHERE source_type = ? AND source_file = ? AND description = ?
  `).get(sourceType, sourceFile, description);
}

function upsertTag(db, tagType, name) {
  if (!name) return null;
  const color = colorFor(tagType, name);
  db.prepare(`
    INSERT INTO tags (tag_type, name, color)
    VALUES (?, ?, ?)
    ON CONFLICT(tag_type, name) DO UPDATE SET color = excluded.color
  `).run(tagType, name, color);
  return db.prepare('SELECT id FROM tags WHERE tag_type = ? AND name = ?').get(tagType, name).id;
}

function attachTag(db, transactionId, tagType, name) {
  const tagId = upsertTag(db, tagType, name);
  if (!tagId) return;
  db.prepare(`
    INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
    VALUES (?, ?)
  `).run(transactionId, tagId);
}

function insertOrUpdateTransaction(db, row, accountId, source, keys) {
  // Math.round：避免 IEEE-754 漂移（如 2.55*100=254.9999…）。cents 必為整數。
  const amount = Math.round((toNumber(row['金額']) ?? 0) * 100);
  const inflowRaw = toNumber(row['流入']) ?? 0;
  const outflowRaw = toNumber(row['流出']) ?? 0;
  const inflow = Math.round(inflowRaw * 100);
  const outflow = Math.round(outflowRaw * 100);
  const balanceRaw = toNumber(row['帳戶餘額']);
  const balance = balanceRaw !== null ? Math.round(balanceRaw * 100) : null;
  const statementMonth = source.statementMonth || parseStatementMonth(row['來源類型'], row['來源說明'], row['月份']);

  // 規則套用：只影響 INSERT 新交易。ON CONFLICT DO UPDATE 不碰分類欄 → 重匯尊重人工校正。
  const matchKey = normalizeForRule(row['名稱']);
  const direction = inflowRaw > 0 ? 'in' : (outflowRaw > 0 ? 'out' : null);
  const rule = getMatchingRule(matchKey, row['來源類型'] || null, direction, db);
  const csvOwner = row['先放哪邊'] || '待確認';
  const csvCategory = row['分類'] || '待確認';
  const csvSubCategory = row['子類別'] || '';
  const csvNecessity = row['必要/可省'] || '需確認';
  // AI 對本次分類的信心度 0~1（選填，CSV 欄「信心度」）；空字串/非數字/超出範圍 → null。
  const _confStr = String(row['信心度'] ?? '').trim();
  const _confRaw = Number(_confStr);
  const aiConfidence = _confStr === '' || !Number.isFinite(_confRaw) || _confRaw < 0 || _confRaw > 1 ? null : _confRaw;
  const owner = (rule && rule.owner_value) || csvOwner;
  const category = (rule && rule.category_value) || csvCategory;
  const necessity = (rule && rule.necessity_value) || csvNecessity;
  const sourceKind = rule
    ? 'rule'
    : (csvOwner !== '待確認' || csvCategory !== '待確認' || csvNecessity !== '需確認' ? 'ai' : 'pending');
  const ruleId = rule ? rule.id : null;
  // 是否為新交易：重匯（dedupe_key 已存在）走 ON CONFLICT DO UPDATE，不計規則套用。
  const existed = !!db.prepare('SELECT 1 FROM transactions WHERE dedupe_key = ?').get(keys.dedupeKey);

  db.prepare(`
    INSERT INTO transactions (
      dedupe_key, import_match_key, transaction_date, transaction_month, statement_month,
      source_type, flow_type, name, amount, inflow, outflow, owner_primary,
      category_primary, category_sub, necessity, judgment_reason, memo, raw_info, balance,
      account_original_order, account_id, first_source_id, classification_source, rule_id, ai_confidence
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      statement_month = COALESCE(transactions.statement_month, excluded.statement_month),
      judgment_reason = COALESCE(NULLIF(transactions.judgment_reason, ''), excluded.judgment_reason),
      memo = COALESCE(NULLIF(transactions.memo, ''), excluded.memo),
      updated_at = CURRENT_TIMESTAMP
  `).run(
    keys.dedupeKey,
    keys.importMatchKey,
    row['日期'],
    row['月份'],
    statementMonth,
    row['來源類型'],
    row['這筆是什麼'],
    row['名稱'],
    amount,
    inflow,
    outflow,
    owner,
    category,
    csvSubCategory,
    necessity,
    row['判斷理由'] || '',
    row['備註'] || '',
    row['原始交易資訊'] || '',
    balance,
    row['帳戶原始排序'] || '',
    accountId,
    source.id,
    sourceKind,
    ruleId,
    aiConfidence
  );

  const transaction = db.prepare('SELECT id FROM transactions WHERE dedupe_key = ?').get(keys.dedupeKey);
  db.prepare(`
    INSERT OR IGNORE INTO transaction_sources (
      transaction_id, source_id, source_row_id, source_description, raw_info
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(transaction.id, source.id, row.id || row['id'] || keys.importMatchKey, row['來源說明'] || '', row['原始交易資訊'] || '');

  attachTag(db, transaction.id, 'owner', owner);
  attachTag(db, transaction.id, 'category', category);
  attachTag(db, transaction.id, 'necessity', necessity);
  attachTag(db, transaction.id, 'source', row['來源類型']);
  attachTag(db, transaction.id, 'flow', row['這筆是什麼']);
  if (statementMonth) attachTag(db, transaction.id, 'statement_month', statementMonth);

  if (!existed && rule) incrementRuleStat(db, rule.id, 'applied');
  return { id: transaction.id, appliedRule: !existed && !!rule };
}

function main(opts = {}) {
  const useLedgerPath = opts.ledgerPath || ledgerPath;
  const useSourcePath = opts.sourcePath || (opts.sourcePath === null ? null : sourceIndexPath);
  const useDbPath = opts.dbPath || DEFAULT_DB_PATH;
  const doReset = opts.reset !== undefined ? opts.reset : reset;

  if (!fs.existsSync(useLedgerPath)) {
    throw new Error(`Ledger not found: ${useLedgerPath}`);
  }
  if (useSourcePath && !fs.existsSync(useSourcePath)) {
    throw new Error(`Source index not found: ${useSourcePath}`);
  }

  if (doReset && fs.existsSync(useDbPath)) {
    fs.rmSync(useDbPath, { force: true });
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${useDbPath}${suffix}`;
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar, { force: true });
    }
  }

  const ledger = readCsv(useLedgerPath);
  const sources = useSourcePath ? readCsv(useSourcePath) : [];
  const sourcesByDescription = sourceIndexMap(sources);
  const db = openDatabase(useDbPath);
  initializeDatabase(db);

  let insertedOrMatched = 0;
  let rulesApplied = 0;
  const importMatchCounts = new Map();
  const transactionIds = new Set();

  db.exec('BEGIN;');
  try {
    for (const row of ledger) {
      const accountId = upsertAccount(db, row['來源類型'], row['原始交易資訊']);
      const source = upsertSource(db, row, sourcesByDescription);
      const keys = buildKeys(row);
      importMatchCounts.set(keys.importMatchKey, (importMatchCounts.get(keys.importMatchKey) || 0) + 1);
      const res = insertOrUpdateTransaction(db, row, accountId, source, keys);
      transactionIds.add(res.id);
      insertedOrMatched += 1;
      if (res.appliedRule) rulesApplied += 1;
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }

  const stats = {
    ledger_rows_seen: insertedOrMatched,
    rules_applied: rulesApplied,
    transactions_in_database: db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count,
    source_links: db.prepare('SELECT COUNT(*) AS count FROM transaction_sources').get().count,
    accounts: db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count,
    sources: db.prepare('SELECT COUNT(*) AS count FROM sources').get().count,
    tags: db.prepare('SELECT COUNT(*) AS count FROM tags').get().count,
    duplicate_import_match_groups: [...importMatchCounts.values()].filter((count) => count > 1).length,
    duplicate_import_match_rows_beyond_first: [...importMatchCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    database_path: useDbPath,
    ledger_path: useLedgerPath
  };

  db.close();
  return stats;
}

if (require.main === module) {
  console.log(JSON.stringify(main(), null, 2));
} else {
  module.exports = { main, readCsv, sourceIndexMap, DEFAULT_DB_PATH, PROJECT_ROOT };
}
