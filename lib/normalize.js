// lib/normalize.js
// 規則比對鍵正規化。本工具（匯入套用）與外部 AI（產規則）必須共用同一演算法，
// 否則 AI 寫的 match_key 與本工具算出的對不上。外部 AI 必須呼叫 normalize API，契約在 Last Say Skill。
//
// 目標：讓「同一交易來源的不同變體」收斂成同一比對鍵。台灣帳單常見的變體來源：
//  - 全形字元（Ｃａｂ / ＊ / －）→ NFKC 轉半形
//  - 大小寫差異（GOOGLE / Google）→ lowercase
//  - 帳單附加識別碼（GOOGLE*CLOUD WMZPFP / Nintendo CC1583732260 / 保險費分期 01/12）
//    → 移除「含數字 ≥4 碼」與「全大寫純字母 ≥5 碼且幾乎無母音的高熵後綴」

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

// 判斷單一 token 是否為「帳單附加識別碼」應移除。
function isLikelyIdToken(token) {
  // 含數字且長度 >= 4：訂單號、數字識別碼、期數殘留（Z9FJ2T / CC1583732260 / 4259522985）
  if (/[0-9]/.test(token) && token.length >= 4) return true;
  // 全大寫純英字母 >= 5 碼 且 母音 <= 1：高熵隨機後綴（WMZPFP / QCPZWS / KFJQQS）
  // 母音門檻用來避免誤移正常英文詞（CLAUDE 母音 3 / NINTENDO 母音 3 → 保留）
  if (/^[A-Z]{5,}$/.test(token)) {
    const vowels = [...token].filter((c) => VOWELS.has(c.toLowerCase())).length;
    if (vowels <= 1) return true;
  }
  return false;
}

// normalizeForRule(raw) → 比對鍵字串。null/undefined → 空字串。
function normalizeForRule(raw) {
  if (raw == null) return '';
  let s = String(raw).normalize('NFKC');             // 1. 全形→半形（含全形空白、星號、英數）
  s = s.replace(/\b\d{1,2}\/\d{1,2}\b/g, ' ');       // 2. 去期數 01/12
  const tokens = s.split(/\s+/).filter((t) => t.length > 0);
  const kept = tokens.filter((t) => !isLikelyIdToken(t)); // 3. 去識別碼 token
  return kept.join(' ').toLowerCase().trim().replace(/\s+/g, ' '); // 4. lowercase + collapse
}

module.exports = { normalizeForRule, isLikelyIdToken };

// 直接執行：node lib/normalize.js 跑 self-test（涵蓋實證樣本）
if (require.main === module) {
  const cases = [
    ['GOOGLE*CLOUD WMZPFP', 'google*cloud'],
    ['GOOGLE*CLOUD Z9FJ2T', 'google*cloud'],
    ['GOOGLE*CLOUD QCPZWS', 'google*cloud'],
    ['Nintendo CC1583732260', 'nintendo'],
    ['Nintendo CD1622997473', 'nintendo'],
    ['保險費分期 01/12', '保險費分期'],
    ['保險費分期 12/12', '保險費分期'],
    ['國外交易手續費 -GOOGLE', '國外交易手續費 -google'],
    ['國外交易手續費 -Google', '國外交易手續費 -google'],
    ['STEAMGAMES.COM 4259522985', 'steamgames.com'],
    ['連加＊統一超商股份有限', '連加*統一超商股份有限'],
    ['連支＊麥當勞', '連支*麥當勞'],
    ['連支＊ＣｈａｒｇｅＳＰ', '連支*chargesp'],
    ['統一金流－ＣａｂＣｏｄ', '統一金流-cabcod'],
    ['OPENAI *CHATGPT SUBSCR', 'openai *chatgpt'],
    ['ANTHROPIC* CLAUDE SUBSCR', 'anthropic* claude'],
  ];
  let pass = 0;
  for (const [input, expected] of cases) {
    const got = normalizeForRule(input);
    const ok = got === expected;
    if (ok) pass += 1;
    console.log(`${ok ? '✓' : '✗'} "${input}" → "${got}"${ok ? '' : ` (期望 "${expected}")`}`);
  }
  console.log(`\n${pass}/${cases.length} 通過`);
}
