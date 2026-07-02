// sim 用：模擬「外部 AI 讀國泰原始信用卡帳單 → 產出 import 格式 ledger CSV」。
// 真實流程裡這層是 AI（Codex/Claude Code）做；這裡用關鍵字模擬 AI 第一環分類。
// 用法: node scripts/sim-cathay-to-ledger.js <raw-cathay.csv> <YYYY-MM> <out.csv>
const fs = require('node:fs');

// 簡易 quoted-CSV 行解析（國泰欄位內不含換行，僅含逗號）
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { fields.push(cur); cur = ''; continue; }
    cur += ch;
  }
  fields.push(cur);
  return fields.map((s) => s.trim());
}

function toNumber(v) {
  const n = String(v ?? '').replace(/,/g, '').replace(/−/g, '-').trim();
  if (!n || n === '-' ) return null;
  const p = Number(n);
  return Number.isFinite(p) ? p : null;
}

// 模擬 AI 第一環分類（關鍵字）。回傳 {main, sub, reason, confidence}。
// main 對應 STANDARD_CATEGORIES（lib/constants.js）其一；sub 為自由文字子類別（可 null）。
// MVP 只分 category。
function classify(name) {
  const n = name.toUpperCase();
  if (/GOOGLE|OPENAI|ANTHROPIC|OSLINK|STEAM|CHATGPT|SUBSCR|MICROSOFT|GITHUB|JETBRAINS|APPLE|CANVA|NOTION/.test(n))
    return { main: '訂閱服務', sub: '軟體', reason: '國際軟體/訂閱', confidence: 0.92 };
  if (/統一超商|全聯|家樂福|超商|迷客夏|寶雅/.test(name))
    return { main: '飲食', sub: '便利商店', reason: '便利商店/量販', confidence: 0.88 };
  if (/小北|屈臣氏|康是美|生活百貨|五金|洗衣|理髮|寵物/.test(name))
    return { main: '日常開銷', sub: '日用品', reason: '生活維持型日常消費', confidence: 0.72 };
  if (/麥當勞|漢堡|燒肉|餐|食|飲|咖啡|星巴克|茶|號|屋|廣場/.test(name))
    return { main: '飲食', sub: '餐飲', reason: '餐飲', confidence: 0.7 };
  if (/加油站|中油|台塑/.test(name))
    return { main: '交通', sub: '油錢', reason: '加油', confidence: 0.85 };
  if (/保險/.test(name))
    return { main: '保險', sub: null, reason: '保險分期', confidence: 0.8 };
  if (/手續費/.test(name))
    return { main: '金融手續與稅費', sub: '手續費', reason: '交易手續費', confidence: 0.9 };
  // 未匹配關鍵字：AI 仍給最佳猜測 + 低信心（不填哨兵留空）。低信心會進待審讓人複核。
  return { main: '購物', sub: '其他', reason: '未匹配關鍵字，AI 低信心猜測', confidence: 0.25 };
}

function main() {
  const [, , rawPath, statementMonth, outPath] = process.argv;
  if (!rawPath || !statementMonth || !outPath) {
    console.error('用法: node scripts/sim-cathay-to-ledger.js <raw.csv> <YYYY-MM> <out.csv>');
    process.exit(1);
  }
  const text = fs.readFileSync(rawPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.includes('消費日') && l.includes('交易說明'));
  if (headerIdx < 0) { console.error('✗ 找不到交易表頭（消費日/交易說明）'); process.exit(1); }
  const header = parseCsvLine(lines[headerIdx]);
  const at = (name) => header.indexOf(name);
  const iDate = at('消費日'), iName = at('交易說明'), iAmt = at('新臺幣金額');
  const stmtYear = Number(statementMonth.split('-')[0]);
  const stmtMon = Number(statementMonth.split('-')[1]);

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || !line.includes(',')) continue;
    const cells = parseCsvLine(line);
    if (cells.length <= Math.max(iDate, iName, iAmt)) continue; // 不完整列（摘要/結尾）
    const dateRaw = (cells[iDate] ?? '').trim();
    const name = (cells[iName] ?? '').trim();
    const amt = toNumber(cells[iAmt]);
    if (!dateRaw || dateRaw === '−' || amt === null) continue; // 跳過無日期/非交易列（上期帳單總額 等）

    const md = dateRaw.match(/^(\d{1,2})\/(\d{1,2})$/);
    let date = `${statementMonth}-01`;
    if (md) {
      const mm = Number(md[1]), dd = Number(md[2]);
      const year = mm > stmtMon ? stmtYear - 1 : stmtYear; // 跨年：月份大於結帳月 → 前一年
      date = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }

    const base = {
      '來源類型': '國泰信用卡 *7654', '來源說明': `cathay-credit-card-${statementMonth} posted statement`,
      '日期': date, '月份': statementMonth, '名稱': name,
      '帳戶餘額': '', '帳戶原始排序': '', '原始交易資訊': '', '判斷理由': '', '信心度': '', '備註': '',
    };
    if (amt < 0) {
      // 負數 = 繳款/退款（inflow），標移轉 → 不列入實際消費
      rows.push({ ...base, '金額': String(amt), '流入': String(-amt), '流出': '0',
        '這筆是什麼': '信用卡繳款/移轉', '分類': '', '子類別': '' });
    } else {
      const c = classify(name);
      rows.push({ ...base, '金額': String(-amt), '流入': '0', '流出': String(amt),
        '這筆是什麼': '信用卡消費',
        '分類': c?.main ?? '待確認', '子類別': c?.sub ?? '',
        '判斷理由': c?.reason ?? '',
        '信心度': c?.confidence ?? '' });
    }
  }

  const cols = ['來源類型','來源說明','日期','月份','名稱','金額','流入','流出','帳戶餘額','帳戶原始排序','原始交易資訊','這筆是什麼','分類','子類別','信心度','判斷理由','備註'];
  const esc = (v) => { const s = String(v ?? ''); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  fs.writeFileSync(outPath, csv);

  const pays = rows.filter((r) => r['先放哪邊'] === '移轉不算').length;
  const pending = rows.filter((r) => r['先放哪邊'] === '待確認').length;
  const classified = rows.length - pays - pending;
  console.error(`[converter] ${statementMonth}: ${rows.length} 筆 → ${outPath}  (消費已分類 ${classified}、待確認 pending ${pending}、繳款/移轉 ${pays})`);
}

main();
