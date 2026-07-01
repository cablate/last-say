// 產生示範用的假交易資料（通用商家、隨機分布），讓任何人 clone 後都能跑 demo。
// 不含任何真實個資。用法：npm run seed:demo（--reset 清空重建）。
const crypto = require('node:crypto');
const { openDatabase, initializeDatabase, DEFAULT_DB_PATH } = require('../lib/db');

const RESET = process.argv.includes('--reset');

// 假商家池：name / category / owner / necessity / flow / 金額區間（元）
const MERCHANTS = [
  { name: 'GOOGLE*CLOUD', cat: '雲端/開發工具', owner: '事業', nec: '事業必要', flow: '信用卡消費', amt: [300, 1500] },
  { name: 'GITHUB', cat: '雲端/開發工具', owner: '事業', nec: '事業必要', flow: '信用卡消費', amt: [120, 400] },
  { name: 'NETFLIX', cat: '社群/娛樂訂閱', owner: '個人', nec: '可優化', flow: '信用卡消費', amt: [270, 450] },
  { name: 'SPOTIFY', cat: '社群/娛樂訂閱', owner: '個人', nec: '可優化', flow: '信用卡消費', amt: [149, 320] },
  { name: 'UBER EATS', cat: '餐飲', owner: '個人', nec: '可節省', flow: '信用卡消費', amt: [120, 800] },
  { name: 'UBER TRIP', cat: '車馬交通', owner: '個人', nec: '必要', flow: '信用卡消費', amt: [85, 500] },
  { name: 'STARBUCKS', cat: '餐飲', owner: '個人', nec: '可節省', flow: '信用卡消費', amt: [80, 320] },
  { name: '7-ELEVEN', cat: '生活採買', owner: '個人', nec: '必要', flow: '信用卡消費', amt: [30, 400] },
  { name: 'IKEA', cat: '住宿', owner: '個人', nec: '可優化', flow: '信用卡消費', amt: [300, 5000] },
  { name: 'APPLE.COM/BILL', cat: '社群/娛樂訂閱', owner: '個人', nec: '可優化', flow: '信用卡消費', amt: [90, 1190] },
  { name: 'AMAZON', cat: '服飾/購物', owner: '個人', nec: '可優化', flow: '信用卡消費', amt: [200, 3000] },
  { name: 'FX 反映手續費', cat: '外幣手續費', owner: '事業', nec: '事業必要', flow: '信用卡消費', amt: [2, 60] },
];

const hashKey = (parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex');
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const db = openDatabase(DEFAULT_DB_PATH);

if (RESET) {
  // DROP 是 DDL，不觸發 row-level trigger，可安全清空 append-only 的 correction_log。
  db.exec(`
    DROP TABLE IF EXISTS correction_log;
    DROP TABLE IF EXISTS transaction_tags;
    DROP TABLE IF EXISTS transaction_sources;
    DROP TABLE IF EXISTS transactions;
    DROP TABLE IF EXISTS tags;
    DROP TABLE IF EXISTS sources;
    DROP TABLE IF EXISTS accounts;
  `);
}
initializeDatabase(db);

// 保護既有資料：未加 --reset 時若 DB 已有交易，警告退出，不自動清空。
if (!RESET) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
  if (existing > 0) {
    console.log(`⚠ DB 已有 ${existing} 筆資料，seed:demo 預設不清空以保護既有資料。`);
    console.log(`  若要重建 demo（會清空既有），請改用：npm run seed:demo:reset`);
    db.close();
    process.exit(0);
  }
}

// 帳戶：一張信用卡 + 一個數位存款帳戶
const cardAcc = db.prepare(
  'INSERT INTO accounts (name, institution, account_type, masked_number) VALUES (?, ?, ?, ?)'
).run('國泰信用卡 ****1234', '國泰', 'credit', '****1234');
const bankAcc = db.prepare(
  'INSERT INTO accounts (name, institution, account_type, masked_number) VALUES (?, ?, ?, ?)'
).run('國泰數位存款 ****5678', '國泰', 'bank', '****5678');

const insertTx = db.prepare(`
  INSERT OR IGNORE INTO transactions
    (dedupe_key, import_match_key, transaction_date, transaction_month, source_type, flow_type,
     name, amount, inflow, outflow, category_primary, judgment_reason, account_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
`);

let count = 0;
let bankBalance = 2500000; // 25000 元起（cents）

for (let m = 1; m <= 6; m++) {
  const month = `2026-${String(m).padStart(2, '0')}`;
  const n = rand(25, 45);
  for (let i = 0; i < n; i++) {
    const mer = pick(MERCHANTS);
    const day = String(rand(1, 28)).padStart(2, '0');
    const date = `${month}-${day}`;
    const isCard = Math.random() < 0.75;
    const sourceType = isCard ? '國泰信用卡' : '國泰數位存款';
    const yuan = rand(mer.amt[0], mer.amt[1]);
    const outflowCents = yuan * 100;
    const amountCents = -outflowCents;
    const dedupe = hashKey([sourceType, date, mer.name, amountCents, i]);
    const category = mer.cat;
    insertTx.run(
      dedupe, dedupe, date, month, sourceType, mer.flow, mer.name,
      amountCents, outflowCents, category,
      isCard ? 'AI 初分（範例）' : null,
      isCard ? cardAcc.lastInsertRowid : bankAcc.lastInsertRowid
    );
    count++;
  }
  // 每月一筆薪資流入（數位存款）+ 更新餘額
  const salaryCents = rand(60000, 80000) * 100;
  bankBalance += salaryCents - rand(15000, 30000) * 100;
  const sDate = `${month}-05`;
  const sKey = hashKey(['salary', sDate]);
  db.prepare(`
    INSERT OR IGNORE INTO transactions
      (dedupe_key, import_match_key, transaction_date, transaction_month, source_type, flow_type,
       name, amount, inflow, outflow, category_primary, balance, account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(
    sKey, sKey, sDate, month, '國泰數位存款', '薪水入帳', '每月薪資',
    salaryCents, salaryCents, '收入', bankBalance, bankAcc.lastInsertRowid
  );
  count++;
}

const total = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
console.log(`✓ demo 資料建立完成：本次處理 ${count} 筆，DB 共 ${total} 筆交易。`);
console.log(`  帳戶：國泰信用卡 ****1234、國泰數位存款 ****5678`);
console.log(`  月份：2026-01 ~ 2026-06`);
console.log(`  下一步：npm run dev → http://localhost:3127`);
db.close();
