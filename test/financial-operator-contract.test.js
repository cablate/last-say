const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getFinanceCapabilities } = require('../lib/finance/capabilities');

test('operator Skill names inventory, preview, reversal, and the human boundary', () => {
  const root = path.join(__dirname, '..');
  const skill = fs.readFileSync(path.join(root, '.claude/skills/last-say-ops/SKILL.md'), 'utf8');
  const api = fs.readFileSync(path.join(root, '.claude/skills/last-say-ops/references/api-contract.md'), 'utf8');
  const foundation = fs.readFileSync(path.join(root, '.claude/skills/last-say-ops/references/financial-data-foundation.md'), 'utf8');
  const capabilities = getFinanceCapabilities();
  assert.match(skill, /GET \/api\/finance\/capabilities/); assert.match(skill, /GET \/api\/finance\/inventory/); assert.match(skill, /actor_type=human/);
  assert.match(api, /HUMAN_CONFIRMATION_REQUIRED/); assert.match(api, /imports\/preview/);
  assert.match(foundation, /\/confirmations/); assert.match(foundation, /arbitrary SQL|direct DB writes/); assert.match(foundation, /reverse_ingestion_run/);
  assert.equal(capabilities.api_version, 'finance/v1');
  for (const action of ['declare_scope_complete', 'reverse_ingestion_run']) assert.ok(foundation.includes(action));
});
