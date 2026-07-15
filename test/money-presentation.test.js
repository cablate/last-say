const test = require('node:test');
const assert = require('node:assert/strict');

const {
  majorToMinorExact,
  formatMoneyMinor,
  currencyInputMode,
  currencyInputPlaceholder,
} = require('../lib/finance/money/presentation');

test('majorToMinorExact respects zero- and two-decimal currency exponents', () => {
  assert.equal(majorToMinorExact('123456', 'JPY'), '123456');
  assert.equal(majorToMinorExact('12.34', 'USD'), '1234');
  assert.equal(majorToMinorExact('.5', 'TWD'), '50');
  assert.equal(majorToMinorExact('-0.05', 'EUR'), '-5');
  assert.equal(majorToMinorExact('-0', 'TWD'), '0');
  assert.throws(() => majorToMinorExact('123.4', 'JPY'), /JPY 不接受小數/);
  assert.throws(() => majorToMinorExact('1.234', 'USD'), /最多 2 位小數/);
});
test('formatMoneyMinor renders canonical minor units without floating-point drift', () => {
  assert.match(formatMoneyMinor('123456', 'JPY'), /123,456/);
  assert.match(formatMoneyMinor('1234', 'USD'), /12\.34/);
  assert.match(formatMoneyMinor('-5', 'TWD'), /-.*0\.05|0\.05.*-/);
  assert.equal(formatMoneyMinor(null, 'TWD', { emptyLabel: '金額未定' }), '金額未定');
});

test('currency input hints follow the canonical exponent', () => {
  assert.equal(currencyInputMode('JPY'), 'numeric');
  assert.equal(currencyInputMode('USD'), 'decimal');
  assert.equal(currencyInputPlaceholder('JPY'), '例如 123456');
  assert.equal(currencyInputPlaceholder('TWD'), '例如 123456.78');
});
