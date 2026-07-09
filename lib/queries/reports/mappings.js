// 寫入型報表映射查詢：transaction_report_mappings（逐筆）+ report_mapping_rules（比對規則）。
// 對應 WP1 兩支 route（app/api/reports/mappings、app/api/reports/mapping-rules）的查詢層。
// 路由只負責 JSON 解析與 envelope；校驗與寫入在此（CJS，可直接被 test 與 route 共用）。
//
// 安全守則（與紅線一致）：
// - report_line 必須 ∈ REPORT_LINE_DEFINITIONS（白名單，來自 lib/reporting/report-lines.js）
// - 動態欄位名不接受使用者輸入（SQL 欄位全為靜態字串）
// - 不寫金額 / 日期 / 來源欄位
// - 錯誤丟 Error（含可辨識訊息），由 route 轉成 {error} + 4xx
const { getDb, clamp } = require('../core');
const { REPORT_LINE_DEFINITIONS, isKnownReportLine } = require('../../reporting/report-lines');

// 校驗失敗專用錯誤（route 依 message 判 4xx）。
class MappingValidationError extends Error {}

// report_line 不在白名單時，附上完整可用清單供 AI/AI 操作者自我修正。
function reportLineNotInWhitelistMessage(reportLine) {
  const allowed = Object.keys(REPORT_LINE_DEFINITIONS).join(', ');
  return `report_line 不在白名單中：${reportLine}（允許：${allowed}）`;
}

// upsertTransactionReportMapping：寫 transaction_report_mappings（PK = transaction_id）。
// 回傳 { transaction_id, report_line }。
//
// reason / note 語意統一（兩表一致）：
//   reason = AI 判斷理由
//   note   = 證據／出處
// 兩欄獨立寫入各自欄位，不再互相合併（不再把 note 併入 reason）。
// rule_id：選填；若提供必須存在於 report_mapping_rules，否則 400。
function upsertTransactionReportMapping(data, db = getDb()) {
  const body = data || {};

  // transaction_id：必填、正整數
  const transactionId = Number(body.transaction_id);
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    throw new MappingValidationError('transaction_id 必須是正整數');
  }

  // report_line：必填、白名單
  const reportLine = body.report_line && String(body.report_line).trim()
    ? String(body.report_line).trim()
    : null;
  if (!reportLine) {
    throw new MappingValidationError('report_line 為必填');
  }
  if (!isKnownReportLine(reportLine)) {
    throw new MappingValidationError(reportLineNotInWhitelistMessage(reportLine));
  }

  // mapping_source：預設 'ai'
  const mappingSource = body.mapping_source && String(body.mapping_source).trim()
    ? String(body.mapping_source).trim()
    : 'ai';

  // confidence：可選 0~1
  let confidence = null;
  if (body.confidence !== undefined && body.confidence !== null && body.confidence !== '') {
    const c = Number(body.confidence);
    if (!Number.isFinite(c) || c < 0 || c > 1) {
      throw new MappingValidationError('confidence 必須是 0~1 之間的數值');
    }
    confidence = c;
  }

  // reason / note：獨立寫入。未明確提供（=== undefined）保留舊值；明確給 null 代表清空。
  const reasonProvided = Object.prototype.hasOwnProperty.call(body, 'reason');
  const reason = reasonProvided && body.reason != null ? String(body.reason) : null;
  const noteProvided = Object.prototype.hasOwnProperty.call(body, 'note');
  const note = noteProvided && body.note != null ? String(body.note) : null;

  // rule_id：選填；若提供必須是正整數且存在於 report_mapping_rules。
  let ruleId = null;
  const ruleIdProvided = Object.prototype.hasOwnProperty.call(body, 'rule_id');
  if (ruleIdProvided && body.rule_id !== null && body.rule_id !== undefined && body.rule_id !== '') {
    const rid = Number(body.rule_id);
    if (!Number.isInteger(rid) || rid <= 0) {
      throw new MappingValidationError('rule_id 必須是正整數');
    }
    const ruleRow = db.prepare('SELECT id FROM report_mapping_rules WHERE id = ?').get(rid);
    if (!ruleRow) {
      const err = new MappingValidationError(`rule_id 不存在：${rid}`);
      err.badRequest = true;
      throw err;
    }
    ruleId = rid;
  } else if (ruleIdProvided) {
    // 明確給 null / 空字串 → 清空 rule_id（設為 null）
    ruleId = null;
  }

  // transaction_id 存在驗證
  const txn = db.prepare('SELECT id FROM transactions WHERE id = ?').get(transactionId);
  if (!txn) {
    const err = new MappingValidationError(`transaction_id 不存在：${transactionId}`);
    err.notFound = true;
    throw err;
  }

  // 欄位合併：PK=transaction_id 覆蓋語意保留（第二次 upsert 覆蓋 report_line），
  // 但未「明確提供」的 confidence/reason/note/mapping_source/rule_id 保留舊值，避免被抹成 null。
  const existing = db.prepare(`
    SELECT mapping_source, confidence, reason, note, rule_id FROM transaction_report_mappings WHERE transaction_id = ?
  `).get(transactionId);

  let finalMappingSource = mappingSource;
  let finalConfidence = confidence;
  let finalReason = reason;
  let finalNote = note;
  let finalRuleId = ruleId;

  if (existing) {
    // mapping_source：本次未明確提供（fallback 'ai'）但舊值存在 → 保留舊值
    //   注意：'ai' 是預設值而非「使用者明確提供」，無法與明確 'ai' 區分，
    //   故僅在舊值非 null 時保留舊值（避免把已記錄的 human_correction 抹回 ai）。
    if (!Object.prototype.hasOwnProperty.call(body, 'mapping_source') && existing.mapping_source != null) {
      finalMappingSource = existing.mapping_source;
    }
    // confidence：本次未明確提供 → 保留舊值
    if (confidence === null && existing.confidence != null) {
      finalConfidence = existing.confidence;
    }
    // reason：本次未明確提供 → 保留舊值
    if (!reasonProvided && existing.reason != null) {
      finalReason = existing.reason;
    }
    // note：本次未明確提供 → 保留舊值
    if (!noteProvided && existing.note != null) {
      finalNote = existing.note;
    }
    // rule_id：本次未明確提供 → 保留舊值
    if (!ruleIdProvided && existing.rule_id != null) {
      finalRuleId = existing.rule_id;
    }
    db.prepare(`
      UPDATE transaction_report_mappings
      SET report_line = $line, mapping_source = $src, confidence = $conf,
          reason = $reason, note = $note, rule_id = $rid
      WHERE transaction_id = $tid
    `).run({
      $tid: transactionId,
      $line: reportLine,
      $src: finalMappingSource,
      $conf: finalConfidence,
      $reason: finalReason,
      $note: finalNote,
      $rid: finalRuleId,
    });
  } else {
    db.prepare(`
      INSERT INTO transaction_report_mappings
        (transaction_id, report_line, mapping_source, confidence, reason, note, rule_id)
      VALUES ($tid, $line, $src, $conf, $reason, $note, $rid)
    `).run({
      $tid: transactionId,
      $line: reportLine,
      $src: finalMappingSource,
      $conf: finalConfidence,
      $reason: finalReason,
      $note: finalNote,
      $rid: finalRuleId,
    });
  }

  return { transaction_id: transactionId, report_line: reportLine };
}

// createReportMappingRule：寫 report_mapping_rules（新增）。回傳 { id }。
function createReportMappingRule(data, db = getDb()) {
  const body = data || {};

  // report_line：必填、白名單
  const reportLine = body.report_line && String(body.report_line).trim()
    ? String(body.report_line).trim()
    : null;
  if (!reportLine) {
    throw new MappingValidationError('report_line 為必填');
  }
  if (!isKnownReportLine(reportLine)) {
    throw new MappingValidationError(reportLineNotInWhitelistMessage(reportLine));
  }

  // 比對條件
  const matchKey = body.match_key && String(body.match_key).trim()
    ? String(body.match_key).trim()
    : null;
  const sourceType = body.source_type && String(body.source_type).trim()
    ? String(body.source_type).trim()
    : null;
  let direction = null;
  if (body.direction !== undefined && body.direction !== null && body.direction !== '') {
    // 容忍大小寫（'IN'/'OUT' 與 'in'/'out' 視為相同）——與 lib/queries/rules.js 兩端點一致。
    const d = String(body.direction).trim().toLowerCase();
    if (!['in', 'out'].includes(d)) {
      throw new MappingValidationError("direction 只允許 'in' 或 'out'");
    }
    direction = d;
  }

  // 至少需一個比對條件
  if (matchKey === null && sourceType === null && direction === null) {
    throw new MappingValidationError('規則至少需指定一個比對條件（match_key / source_type / direction）');
  }

  // confidence：預設 0，0~1
  let confidence = 0;
  if (body.confidence !== undefined && body.confidence !== null && body.confidence !== '') {
    const c = Number(body.confidence);
    if (!Number.isFinite(c) || c < 0 || c > 1) {
      throw new MappingValidationError('confidence 必須是 0~1 之間的數值');
    }
    confidence = c;
  }

  // enabled：預設 true
  const enabled = (body.enabled === false || body.enabled === 0 || body.enabled === '0')
    ? 0
    : 1;

  // reason / note：獨立寫入各自欄位（reason=AI 判斷理由、note=證據／出處）。
  const reason = body.reason != null ? String(body.reason) : null;
  const note = body.note != null ? String(body.note) : null;

  const result = db.prepare(`
    INSERT INTO report_mapping_rules
      (match_key, source_type, direction, report_line, confidence, enabled, note, reason)
    VALUES ($mk, $st, $dir, $line, $conf, $enabled, $note, $reason)
  `).run({
    $mk: matchKey,
    $st: sourceType,
    $dir: direction,
    $line: reportLine,
    $conf: confidence,
    $enabled: enabled,
    $note: note,
    $reason: reason,
  });

  return { id: Number(result.lastInsertRowid) };
}

module.exports = {
  MappingValidationError,
  upsertTransactionReportMapping,
  createReportMappingRule,
};
