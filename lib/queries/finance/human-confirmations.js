const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { ENUMS, FinanceError, assertObject, rejectUnknown, requiredString } = require('../../finance/contracts');
const { getDb, stableKey, logChange, requireRow, withTransaction } = require('./common');
const { issueConfirmationAuthorization } = require('./authorization');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function proposalPayload({ action_kind, resource_type, resource_key = null, payload, expected_version = null }) {
  return { action_kind, resource_type, resource_key, payload, expected_version };
}

function payloadHash(input) {
  return sha256(canonicalJson(proposalPayload(input)));
}

function createHumanConfirmation(input, db = getDb(), now = new Date()) {
  assertObject(input);
  rejectUnknown(input, ['action_kind', 'resource_type', 'resource_key', 'payload', 'expected_version']);
  const actionKind = requiredString(input.action_kind, 'action_kind', 80);
  if (!ENUMS.high_risk_action.includes(actionKind)) throw new FinanceError('VALIDATION_ERROR', 'Unsupported high-risk action', { field: 'action_kind', allowedValues: ENUMS.high_risk_action });
  const resourceType = requiredString(input.resource_type, 'resource_type', 80);
  assertObject(input.payload, 'payload');
  const expectedVersion = input.expected_version === undefined || input.expected_version === null ? null : Number(input.expected_version);
  if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) throw new FinanceError('VALIDATION_ERROR', 'expected_version must be a positive integer', { field: 'expected_version' });
  const proposalKey = stableKey();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const hash = payloadHash({ action_kind: actionKind, resource_type: resourceType, resource_key: input.resource_key || null, payload: input.payload, expected_version: expectedVersion });
  db.prepare(`INSERT INTO human_confirmation_requests (proposal_key,action_kind,resource_type,resource_key,payload_hash,payload_json,expected_version,status,expires_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(proposalKey, actionKind, resourceType, input.resource_key || null, hash, canonicalJson(input.payload), expectedVersion, 'pending', expiresAt);
  return { proposal_key: proposalKey, action_kind: actionKind, resource_type: resourceType, resource_key: input.resource_key || null, payload_hash: hash, expected_version: expectedVersion, status: 'pending', expires_at: expiresAt };
}

function listHumanConfirmations({ status = 'pending', now = new Date() } = {}, db = getDb()) {
  const allowed = ['pending', 'confirmed', 'consumed', 'expired', 'all'];
  if (!allowed.includes(status)) throw new FinanceError('VALIDATION_ERROR', 'Unsupported confirmation status', { field: 'status', allowedValues: allowed });
  const evaluatedAt = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(evaluatedAt.getTime())) throw new FinanceError('VALIDATION_ERROR', 'now must be a valid date', { field: 'now' });
  const rows = db.prepare(`
    SELECT proposal_key,action_kind,resource_type,resource_key,payload_hash,payload_json,
      expected_version,effective_status AS status,expires_at,confirmed_at,consumed_at,created_at
    FROM (
      SELECT proposal_key,action_kind,resource_type,resource_key,payload_hash,payload_json,
        expected_version,expires_at,confirmed_at,consumed_at,created_at,
        CASE
          WHEN status IN ('pending','confirmed') AND expires_at <= ? THEN 'expired'
          ELSE status
        END AS effective_status
      FROM human_confirmation_requests
    )
    ${status === 'all' ? '' : 'WHERE effective_status=?'}
    ORDER BY created_at DESC
  `).all(evaluatedAt.toISOString(), ...(status === 'all' ? [] : [status]));
  return rows.map((row)=>({...row,payload:JSON.parse(row.payload_json),payload_json:undefined}));
}

function getHumanConfirmation(proposalKey, db = getDb()) {
  const row = requireRow(db.prepare('SELECT * FROM human_confirmation_requests WHERE proposal_key=?').get(proposalKey), 'Confirmation proposal');
  return { ...row, payload: JSON.parse(row.payload_json) };
}

function confirmHumanConfirmation(proposalKey, { browserConfirmed = false } = {}, db = getDb(), now = new Date()) {
  if (!browserConfirmed) throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Browser confirmation flow is required', { status: 403 });
  const outcome = withTransaction(db, () => {
    const before = requireRow(db.prepare('SELECT * FROM human_confirmation_requests WHERE proposal_key=?').get(proposalKey), 'Confirmation proposal');
    if (before.status !== 'pending') throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Proposal is no longer pending', { status: 409 });
    if (Date.parse(before.expires_at) <= now.getTime()) {
      db.prepare("UPDATE human_confirmation_requests SET status='expired' WHERE id=?").run(before.id);
      return { expired: true };
    }
    const receipt = randomBytes(32).toString('base64url');
    db.prepare(`UPDATE human_confirmation_requests SET confirmation_hash=?,status='confirmed',confirmed_at=? WHERE id=? AND status='pending'`)
      .run(sha256(receipt), now.toISOString(), before.id);
    return { proposal_key: proposalKey, confirmation_receipt: receipt, expires_at: before.expires_at };
  });
  if (outcome.expired) throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Proposal expired', { status: 409 });
  return outcome;
}

function consumeHumanConfirmation(input, operation, db = getDb(), now = new Date()) {
  const receipt = requiredString(input.confirmation_receipt, 'confirmation_receipt', 200);
  return withTransaction(db, () => {
    const before = requireRow(db.prepare('SELECT * FROM human_confirmation_requests WHERE proposal_key=?').get(input.proposal_key), 'Confirmation proposal');
    if (before.status !== 'confirmed' || before.consumed_at) throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Receipt is not active or was already consumed', { status: 409 });
    if (Date.parse(before.expires_at) <= now.getTime()) throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Receipt expired', { status: 409 });
    const actualHash = payloadHash(input);
    if (actualHash !== before.payload_hash || before.action_kind !== input.action_kind || before.resource_type !== input.resource_type || (before.resource_key || null) !== (input.resource_key || null) || (before.expected_version ?? null) !== (input.expected_version ?? null)) {
      throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Proposal payload or version changed', { status: 409 });
    }
    const actualReceiptHash = Buffer.from(sha256(receipt), 'hex');
    const expectedReceiptHash = Buffer.from(before.confirmation_hash || '', 'hex');
    if (actualReceiptHash.length !== expectedReceiptHash.length || !timingSafeEqual(actualReceiptHash, expectedReceiptHash)) throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Invalid confirmation receipt', { status: 403 });
    const consumedAt = now.toISOString();
    const result = db.prepare(`UPDATE human_confirmation_requests SET status='consumed',consumed_at=? WHERE id=? AND status='confirmed' AND consumed_at IS NULL`).run(consumedAt, before.id);
    if (Number(result.changes) !== 1) throw new FinanceError('HUMAN_CONFIRMATION_REQUIRED', 'Receipt was consumed concurrently', { status: 409 });
    const authorization = issueConfirmationAuthorization({ proposal_key: before.proposal_key, action_kind: before.action_kind, consumed_at: consumedAt });
    const output = operation(authorization);
    const after = db.prepare('SELECT * FROM human_confirmation_requests WHERE id=?').get(before.id);
    logChange(db, { resourceType: 'human_confirmation', resourceKey: before.proposal_key, action: 'consume', before: { ...before, confirmation_hash: '[redacted]' }, after: { ...after, confirmation_hash: '[redacted]' }, actorType: 'human_ui', actorNote: before.action_kind });
    return output;
  });
}

module.exports = { canonicalJson, payloadHash, createHumanConfirmation, listHumanConfirmations, getHumanConfirmation, confirmHumanConfirmation, consumeHumanConfirmation };
