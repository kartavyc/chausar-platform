import { check } from './contracts.ts';

const supported = new Set(Intl.supportedValuesOf('currency'));
// ISO accounting units can be omitted from supportedValuesOf's currency list.
// Pin their known exponents instead of accepting Intl's unknown-code fallback.
const digits = new Map<string, number>([['CLF',4],['UYI',0],['UYW',4]]);
/** Uses the packaged runtime's currency metadata only, never floating money. */
export function currencyMinorDigits(currency: string): number {
  check(typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) && (supported.has(currency) || digits.has(currency)), 'INVALID_CURRENCY', 'Use a currency supported by the qualified runtime.');
  if (!digits.has(currency)) {
    const precision = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    check(Number.isInteger(precision) && precision !== undefined && precision >= 0 && precision <= 4, 'CURRENCY_PRECISION_UNSUPPORTED', 'This currency needs a qualified minor-unit precision.');
    digits.set(currency, precision);
  }
  return digits.get(currency)!;
}
export function decimalMinor(value: string, currency = 'INR'): string {
  const precision = currencyMinorDigits(currency);
  check(/^-?\d+(?:\.\d+)?$/.test(value), 'INVALID_AMOUNT', 'Use exact decimal text without exponents.');
  const sign = value.startsWith('-') ? -1n : 1n;
  const [whole, rawFraction = ''] = value.replace(/^-/, '').split('.');
  const fraction = rawFraction.replace(/0+$/, '');
  check(fraction.length <= precision, 'INVALID_AMOUNT', 'The amount contains a fractional minor unit for its currency.');
  return String(sign * (BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0') || '0')));
}
export function formatMinor(value: string | bigint, currency = 'INR'): string {
  const precision = currencyMinorDigits(currency), scale = 10n ** BigInt(precision);
  const amount = BigInt(value), absolute = amount < 0n ? -amount : amount;
  const whole = String(absolute / scale).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${amount < 0n ? '-' : ''}${whole}${precision ? '.' + String(absolute % scale).padStart(precision, '0') : ''}`;
}
