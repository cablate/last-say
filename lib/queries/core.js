// queries 共用層：DB 連線、數值安全、規則工具、normalize。
// 各 queries/ 子模組從這裡取共用 helper（單一來源，避免散落）。
const { getDb } = require('../db');
const { normalizeForRule } = require('../normalize');

// 數值安全轉換：避免 limit/offset NaN（Number('abc')=NaN）；null/空字串視為 fallback。
function safeInt(value, fallback, max) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  let v = Math.max(n, 0);
  if (max !== undefined) v = Math.min(v, max);
  return v;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// 從交易金額推方向：inflow>0 → 'in'（有人轉給我）/ outflow>0 → 'out'（我轉出）/ 否則 null。
function directionFromFlow(inflow, outflow) {
  if (Number(inflow) > 0) return 'in';
  if (Number(outflow) > 0) return 'out';
  return null;
}

module.exports = { getDb, safeInt, clamp, directionFromFlow, normalizeForRule };
