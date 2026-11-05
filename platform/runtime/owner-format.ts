import { currencyMinorDigits } from './currency.ts';
import { COUNTRY_TIME_ZONES } from './venture/local-day-data.ts';

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

// Days, times and durations (one-shot B2 task 2). An instant reads in the zone given (the business's zone, from
// ownerZone); a calendar day ('YYYY-MM-DD') is a day on every calendar and never shifts; nothing here reads the
// computer's own zone, so the same instant reads the same on every machine.

/** The business's zone from its country code (the table the engine uses for the local day); another country or none gives the fallback. */
export function ownerZone(countryCode: string | null | undefined, fallback: string): string {
  return (countryCode && countryCode !== 'XX' ? COUNTRY_TIME_ZONES[countryCode] : undefined) ?? fallback;
}

/**
 * The computer's own zone. Only the app calls it, as the fallback when no business is open or the business is in
 * another country; the engine falls back to UTC instead.
 */
export function computerZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export type When = string | Date | number;
type Local = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const clocks = new Map<string, Intl.DateTimeFormat>();
function clockIn(zone: string): Intl.DateTimeFormat {
  let clock = clocks.get(zone);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
    clocks.set(zone, clock);
  }
  return clock;
}
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The milliseconds of an instant (a Date, a number, or an ISO time), or NaN for anything else. */
function msOf(value: When): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return typeof value === 'string' && INSTANT.test(value) ? Date.parse(value) : Number.NaN;
}

/** The wall clock in a zone at an instant, or null when the value is not an instant. */
function localIn(value: When, zone: string): Local | null {
  const ms = msOf(value);
  if (!Number.isFinite(ms)) return null;
  const parts: Record<string, string> = {};
  for (const part of clockIn(zone).formatToParts(ms)) parts[part.type] = part.value;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: WEEKDAY_SHORT.indexOf(parts.weekday ?? '') };
}

/** A calendar day's parts, or null when the text is not one. */
function calendarDay(value: When): { year: number; month: number; day: number } | null {
  const found = typeof value === 'string' ? CALENDAR_DAY.exec(value) : null;
  if (!found) return null;
  const [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { year, month, day } : null;
}

const asGiven = (value: When): string => (typeof value === 'string' ? value : '');
const dayWords = (d: { year: number; month: number; day: number }, size: 'full' | 'short') => `${d.day} ${MONTHS[d.month - 1]}${size === 'full' ? ` ${d.year}` : ''}`;
const clockWords = (l: Local) => `${l.hour % 12 || 12}:${String(l.minute).padStart(2, '0')} ${l.hour < 12 ? 'am' : 'pm'}`;

/**
 * A day as the owner reads it: "3 Nov 2026" ("3 Nov" short). A 'YYYY-MM-DD' is a calendar day and reads as itself; an
 * instant reads in the zone; anything else comes back as it came.
 */
export function formatDay(value: When, zone: string, size: 'full' | 'short' = 'full'): string {
  const day = calendarDay(value) ?? localIn(value, zone);
  return day ? dayWords(day, size) : asGiven(value);
}

/** A time of day in the zone, on a 12-hour clock: "12:41 am", "9:05 pm". Anything not an instant comes back as it came. */
export function formatTime(value: When, zone: string): string {
  const local = localIn(value, zone);
  return local ? clockWords(local) : asGiven(value);
}

/** A moment in the zone: "3 Nov 2026, 12:41 am" ("3 Nov, 12:41 am" short). */
export function formatMoment(value: When, zone: string, size: 'full' | 'short' = 'full'): string {
  const local = localIn(value, zone);
  return local ? `${dayWords(local, size)}, ${clockWords(local)}` : asGiven(value);
}

/** The weekday and day in the zone, for a page's date line: "Tuesday, 3 November". */
export function formatWeekday(value: When, zone: string): string {
  const local = localIn(value, zone);
  return local ? `${WEEKDAYS[local.weekday]}, ${local.day} ${LONG_MONTHS[local.month - 1]}` : asGiven(value);
}

/** A month ('2026-11') as "November 2026" (long), "November" (name, a goal's month) or "Nov" (short, a chart's column); anything else comes back as it came. */
export function formatMonth(month: string, size: 'long' | 'name' | 'short' = 'long'): string {
  const found = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!found) return month;
  const index = Number(found[2]) - 1;
  return size === 'long' ? `${LONG_MONTHS[index]} ${found[1]}` : size === 'name' ? LONG_MONTHS[index]! : MONTHS[index]!;
}

/** The calendar day in the zone at an instant, as 'YYYY-MM-DD' (a key and a date field's value, never shown as is). */
export function dayKeyIn(value: When, zone: string): string {
  const local = localIn(value, zone);
  return local ? `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}` : '';
}

/** The hour (0 to 23) in the zone at an instant, for a greeting; NaN when the value is not an instant. */
export function hourIn(value: When, zone: string): number {
  return localIn(value, zone)?.hour ?? Number.NaN;
}

/**
 * How long something took: "45 s", "1 min 20 s" (seconds while under ten minutes), "12 min", "1 h 5 min", "2 days 3 h",
 * and nothing at all for under a second, so "Worked for 0s" never shows.
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return '';
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  if (minutes === 0) return `${seconds} s`;
  if (minutes < 10) return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`;
  if (hours === 0) return `${minutes} min`;
  if (days === 0) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const dayWord = `${days} ${days === 1 ? 'day' : 'days'}`;
  return hours % 24 ? `${dayWord} ${hours % 24} h` : dayWord;
}

/** The time between two ISO instants as formatElapsed words; never negative, and nothing when either is not a time. */
export function formatAge(fromIso: string, toIso: string): string {
  return formatElapsed(Date.parse(toIso) - Date.parse(fromIso));
}

/** The short weekday in the zone at an instant ("Tue"), for a list within the week; '' when the value is not an instant. */
export function weekdayIn(value: When, zone: string): string {
  const local = localIn(value, zone);
  return local ? WEEKDAY_SHORT[local.weekday]! : '';
}
