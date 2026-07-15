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

test('unfinished statements render honest unavailable states instead of static readiness claims', () => {
  const reports = source('components/reports/ReportsView.jsx');
  assert.match(reports, /title="資產負債表"/);
  assert.match(reports, /title="現金流量表"/);
  assert.match(reports, /正式報表尚未實作/);
  assert.doesNotMatch(reports, /StatementReadinessTable|BalanceSheetPreview|CashFlowPreview/);
  assert.doesNotMatch(reports, /目前能看到信用卡消費與繳款流水|目前只有交易流水/);
});
