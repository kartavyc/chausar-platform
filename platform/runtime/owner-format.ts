import { currencyMinorDigits } from './currency.ts';

// Chausar: how an amount, a count, a day and a time read on the owner's screens (one-shot B2).
// Browser-safe (no node: import), so the engine, the fake engine and the app all write figures the same way.
//
// Two forms of every amount:
// - the owner form here ("₹2,000", "$5,000", "SGD 5,000") for anything the owner reads on a screen;
// - the exact form (currency.ts formatMinor "INR 2,000.00", records.ts formatMicros "USD 0.0042") for receipts' AI
//   costs, files and links that leave the app, text the AI reads, and anything code reads back.
// The owner form of an amount in minor units is lossless: it only drops a zero fraction and regroups the digits.

/** The currencies written with a sign; every other currency keeps its code, so "$" never means three currencies. */
const SIGNS: Readonly<Record<string, string>> = Object.freeze({ INR: '₹', USD: '$', EUR: '€' });

/** The sign an amount in this currency is written with, or null when it is written with its code. */
export function currencySign(currency: string): string | null {
  return SIGNS[currency] ?? null;
}

/** Digits grouped in threes ("100,000"), or the Indian way for rupees ("1,00,000"): the last three, then twos. */
function grouped(digits: string, indian: boolean): string {
  if (!indian || digits.length <= 3) return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${digits.slice(-3)}`;
}

/** One amount from its parts: sign, whole digits and the fraction digits to show ('' for none). */
function written(negative: boolean, whole: string, fraction: string, currency: string): string {
  const sign = currencySign(currency);
  const figure = `${grouped(whole, currency === 'INR')}${fraction ? `.${fraction}` : ''}`;
  return `${negative ? '-' : ''}${sign ?? `${currency} `}${figure}`;
}

function parts(minor: string | bigint, currency: string) {
  const precision = currencyMinorDigits(currency), scale = 10n ** BigInt(precision);
  const amount = BigInt(minor), absolute = amount < 0n ? -amount : amount;
  return { negative: amount < 0n, whole: String(absolute / scale), fraction: precision ? String(absolute % scale).padStart(precision, '0') : '', precision };
}

/** An amount in minor units, as the owner reads it: "₹2,000", "₹2,000.50", "₹1,00,000", "-₹500", "$5,000", "SGD 5,000". */
export function formatMoney(minor: string | bigint, currency: string): string {
  const { negative, whole, fraction } = parts(minor, currency);
  return written(negative, whole, /[1-9]/.test(fraction) ? fraction : '', currency);
}

/** A range: "₹3,000 to ₹12,000"; both ends show their minor units when either end has some. */
export function formatMoneyRange(low: string | bigint, high: string | bigint, currency: string): string {
  const [a, b] = [parts(low, currency), parts(high, currency)];
  const fractional = /[1-9]/.test(a.fraction) || /[1-9]/.test(b.fraction);
  const end = (p: typeof a) => written(p.negative, p.whole, fractional ? p.fraction : '', currency);
  return `${end(a)} to ${end(b)}`;
}

/**
 * An amount the owner typed ("2000", "2000.5"), in the owner form, worked out from the text alone (no arithmetic).
 * Null when the text is not plain decimal digits the currency can hold (an exponent, stray commas, too many decimals).
 */
export function typedMoney(text: string, currency: string): string | null {
  const found = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!found) return null;
  let precision: number;
  try { precision = currencyMinorDigits(currency); } catch { return null; }
  const fraction = (found[3] ?? '').replace(/0+$/, '');
  if (fraction.length > precision) return null;
  return written(found[1] === '-', found[2]!.replace(/^0+(?=\d)/, ''), fraction ? fraction.padEnd(precision, '0') : '', currency);
}

/** The currency codes the screens read as money when a figure is written with its code. */
const CODES = 'INR|USD|EUR|GBP|AED|SGD|AUD|CAD|JPY|NZD|ZAR|CHF|KWD';
/**
 * Money in text, one pattern for the engine, the fake and the app: a sign or a code, then its digits. It reads the
 * owner form ("₹2,000", "-₹500", "SGD 5,000") and the exact form ("INR 2,000.00", "USD 0.0042") alike.
 */
export const MONEY_TEXT = new RegExp(`-?(?:[₹$€]\\s?|\\b(?:${CODES})\\s?-?)\\d[\\d,]*(?:\\.\\d+)?`, 'g');
/** Whether a text holds an amount anywhere (MONEY_TEXT without the global flag, so it keeps no state between tests). */
export const HOLDS_MONEY = new RegExp(`(?:[₹$€]\\s?|\\b(?:${CODES})\\s?-?)\\d`);

/** A count, grouped as the business's country groups it: "1,00,000" for India, "100,000" elsewhere. */
export function formatCount(n: number | bigint, countryCode: string): string {
  const negative = n < 0, digits = String(negative ? -n : n).replace(/\..*$/, '');
  return `${negative ? '-' : ''}${grouped(digits, countryCode === 'IN')}`;
}
