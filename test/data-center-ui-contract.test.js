const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

test('data-center forms use shared currency-aware money helpers and expose canonical account kinds', () => {
  const accounts = source('components/finance-data/AccountRegister.jsx');
  const obligations = source('components/finance-data/ObligationRegister.jsx');
  assert.match(accounts, /majorToMinorExact\(amount, account\.currency\)/);
  assert.match(accounts, /ENUMS\.account_kind\.map/);
  assert.match(accounts, /SUPPORTED_CURRENCIES\.map/);
  assert.doesNotMatch(accounts, /BigInt\(match\[2\]\) \* 100n/);
  assert.match(obligations, /activeCurrency/);
  assert.match(obligations, /majorToMinorExact/);
  assert.doesNotMatch(obligations, /BigInt\(match\[2\]\) \* 100n/);
});

test('all three statements are server-backed and do not fall back to static readiness claims', () => {
  const reports = source('components/reports/ReportsView.jsx');
  const hooks = source('lib/hooks.js');
  assert.match(reports, /useBalanceSheet/);
  assert.match(reports, /useCashFlow/);
  assert.match(reports, /<BalanceSheet report=/);
  assert.match(reports, /<CashFlowStatement report=/);
  assert.doesNotMatch(reports, /StatementUnavailable|StatementReadinessTable|BalanceSheetPreview|CashFlowPreview/);
  assert.match(hooks, /\/api\/reports\/balance-sheet/);
  assert.match(hooks, /\/api\/reports\/cash-flow/);
});
