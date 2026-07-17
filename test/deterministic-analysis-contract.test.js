const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixturePath = path.join(
  __dirname,
  'fixtures',
  'financial-control',
  'deterministic-analysis-response.json',
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const RESPONSE_KEYS = [
  'schema_version',
  'analysis_id',
  'formula_version',
  'scope',
  'source_watermark',
  'coverage',
  'facts',
  'derived',
  'candidates',
  'drillback',
];
const MONEY_PATTERN = /^-?\d+$/;

function assertMoneyFields(value, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMoneyFields(item, [...pathParts, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (key.endsWith('_minor')) {
      assert.ok(
        child === null || (typeof child === 'string' && MONEY_PATTERN.test(child)),
        `${childPath.join('.')} must be an integer decimal string or null`,
      );
    }
    assertMoneyFields(child, childPath);
  }
}

function assertResponse(response) {
  assert.deepEqual(Object.keys(response).sort(), [...RESPONSE_KEYS].sort());
  assert.equal(response.schema_version, 'finance.analysis-read-model/v1');
  assert.match(response.analysis_id, /^[a-z][a-z0-9_]*$/);
  assert.match(response.formula_version, /^[a-z][a-z0-9-]*\/\d+$/);
  assert.ok(['empty', 'unmapped', 'partial', 'unreconciled', 'complete'].includes(response.coverage.status));
  assert.ok(Array.isArray(response.coverage.blockers));
  assert.ok(Array.isArray(response.coverage.warnings));
  assert.ok(Array.isArray(response.candidates));
  assert.ok(response.source_watermark.change_sequence);
  assertMoneyFields(response);
  assert.equal(JSON.stringify(response).includes('ai_answer'), false);
}

test('FC-A1 fixture is synthetic and every response follows the deterministic envelope', () => {
  assert.equal(fixture.fixture_schema, 'last-say-deterministic-analysis-response/v1');
  assert.equal(fixture.privacy, 'synthetic-only');
  assert.equal(fixture.contract_id, 'finance.control.deterministic-analysis-read-model');
  assert.equal(fixture.scenarios.length, 2);

  for (const scenario of fixture.scenarios) {
    const responses = [scenario.before, scenario.after, scenario.expected].filter(Boolean);
    responses.forEach(assertResponse);
  }
});

test('the same query reflects a confirmed source change on the next deterministic read', () => {
  const scenario = fixture.scenarios.find((item) => item.id === 'same-query-recomputes-after-confirmed-source-change');
  assert.ok(scenario);
  assertResponse(scenario.before);
  assertResponse(scenario.after);
  assert.equal(scenario.before.analysis_id, scenario.request.analysis_id);
  assert.equal(scenario.after.analysis_id, scenario.request.analysis_id);
  assert.deepEqual(scenario.before.scope, scenario.after.scope);
  assert.notDeepEqual(scenario.before.source_watermark, scenario.after.source_watermark);

  const beforeIncome = BigInt(scenario.before.facts.confirmed_income_minor);
  const beforeExpense = BigInt(scenario.before.facts.confirmed_expense_minor);
  const afterIncome = BigInt(scenario.after.facts.confirmed_income_minor);
  const afterExpense = BigInt(scenario.after.facts.confirmed_expense_minor);
  const addedExpense = -BigInt(scenario.applied_change.amount_minor);

  assert.equal(BigInt(scenario.before.derived.net_result_minor), beforeIncome - beforeExpense);
  assert.equal(BigInt(scenario.after.derived.net_result_minor), afterIncome - afterExpense);
  assert.equal(afterIncome, beforeIncome);
  assert.equal(afterExpense - beforeExpense, addedExpense);
  assert.ok(scenario.after.drillback.expense_transaction_keys.includes(scenario.applied_change.resource_key));
});

test('proposed and unknown values remain outside confirmed totals', () => {
  const scenario = fixture.scenarios.find((item) => item.id === 'candidate-and-unknown-remain-outside-confirmed-totals');
  assert.ok(scenario);
  const response = scenario.expected;
  assertResponse(response);
  assert.equal(response.coverage.status, 'partial');
  assert.equal(response.facts.confirmed_fixed_obligation_minor, null);
  assert.equal(response.facts.confirmed_reimbursement_minor, '0');
  assert.equal(response.derived.confirmed_personal_net_burden_minor, response.facts.gross_business_expense_minor);
  assert.equal(response.candidates[0].included_in_confirmed_totals, false);
  assert.notEqual(response.candidates[0].proposed_amount_minor, response.facts.confirmed_reimbursement_minor);
});
