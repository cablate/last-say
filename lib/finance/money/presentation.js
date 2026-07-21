const { SUPPORTED_CURRENCIES } = require('../contracts/enums');
const { currencyExponent } = require('./decimal');

function supportedCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new RangeError(`Unsupported currency: ${currency || '(empty)'}`);
  }
  return currency;
}

function moneyInputError(currency, exponent) {
  return exponent === 0
    ? `${currency} 不接受小數金額。`
    : `請輸入有效的 ${currency} 金額，最多 ${exponent} 位小數。`;
}

function majorToMinorExact(value, currencyValue = 'TWD') {
  const currency = supportedCurrency(currencyValue);
  const exponent = currencyExponent(currency);
  const text = String(value ?? '').trim();
  const match = text.match(/^(-?)(?:(\d+)(?:\.(\d+))?|\.(\d+))$/);
  if (!match) throw new RangeError(moneyInputError(currency, exponent));

  const whole = match[2] || '0';
  const fraction = match[3] ?? match[4] ?? '';
  if (fraction.length > exponent || (exponent === 0 && fraction.length > 0)) {
    throw new RangeError(moneyInputError(currency, exponent));
  }

  const scale = 10n ** BigInt(exponent);
  const fractionMinor = exponent === 0 ? 0n : BigInt(fraction.padEnd(exponent, '0') || '0');
  let minor = (BigInt(whole) * scale) + fractionMinor;
  if (match[1] === '-' && minor !== 0n) minor = -minor;
  return minor.toString();
}

function formatMoneyMinor(value, currencyValue = 'TWD', options = {}) {
  if (value === null || value === undefined) return options.emptyLabel || '尚未提供';
  const currency = supportedCurrency(currencyValue);
  const exponent = currencyExponent(currency);
  const scale = 10n ** BigInt(exponent);
  const minor = BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / scale;
  const fraction = exponent === 0 ? '' : (absolute % scale).toString().padStart(exponent, '0');
  const signedWhole = negative ? (whole === 0n ? -0 : -whole) : whole;
  const formatter = new Intl.NumberFormat(options.locale || 'zh-TW', {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  if (exponent === 0) {
    const formatted = formatter.format(signedWhole);
    return currency === 'TWD' ? formatted.replace('$', 'NT$') : formatted;
  }
  const formatted = formatter.formatToParts(signedWhole)
    .map((part) => part.type === 'fraction' ? fraction : part.value)
    .join('');
  return currency === 'TWD' ? formatted.replace('$', 'NT$') : formatted;
}

function currencyInputMode(currency) {
  return currencyExponent(supportedCurrency(currency)) === 0 ? 'numeric' : 'decimal';
}

function currencyInputPlaceholder(currency) {
  return currencyExponent(supportedCurrency(currency)) === 0 ? '例如 123456' : '例如 123456.78';
}

module.exports = {
  majorToMinorExact,
  formatMoneyMinor,
  currencyInputMode,
  currencyInputPlaceholder,
  supportedCurrency,
};
