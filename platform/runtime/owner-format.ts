import { currencyMinorDigits } from './currency.ts';
import { check } from './portable.ts';
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

/**
 * The signed plain decimal of an amount, ungrouped and with every minor digit ("-500.00", "100000.00", "5000" for yen):
 * the number an explanation may state for a figure, worked out from its minor units, never read off its display.
 */
export function plainMoney(minor: string | bigint, currency: string): string {
  const { negative, whole, fraction } = parts(minor, currency);
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
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
  // Grouping commas as the owner writes them, western ("125,000") or Indian ("1,25,000"); never stray ones ("1,2,3").
  const found = /^(-?)(\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.(\d+))?$/.exec(text.trim());
  if (!found) return null;
  found[2] = found[2]!.replace(/,/g, '');
  let precision: number;
  try { precision = currencyMinorDigits(currency); } catch { return null; }
  const fraction = (found[3] ?? '').replace(/0+$/, '');
  if (fraction.length > precision) return null;
  // "-0" is zero: a sign only leads an amount that has a digit above zero.
  const negative = found[1] === '-' && /[1-9]/.test(found[2]! + fraction);
  return written(negative, found[2]!.replace(/^0+(?=\d)/, ''), fraction ? fraction.padEnd(precision, '0') : '', currency);
}

/**
 * The currency codes the screens read as money when a figure is written with its code: every code the runtime knows
 * (the list currency.ts accepts), so "HKD 5,000" is money and "GST 18%" is not.
 */
const CODES = [...Intl.supportedValuesOf('currency'), 'CLF', 'UYI', 'UYW'].join('|');
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

/**
 * One-shot C4 task 36: a file's size as the owner reads it, in steps of 1024: "512 bytes", "1 byte", "47 KB", "1.2 MB",
 * "12 MB", "1.5 GB". One decimal below 10 of a unit (dropped when it is .0), whole above; never 0 KB for a small file.
 */
export function formatBytes(bytes: number): string {
  const n = Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : 0;
  if (n < 1024) return n === 1 ? '1 byte' : `${n} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  const shown = unit === 0 || value >= 10 ? String(Math.max(1, Math.round(value))) : String(Math.round(value * 10) / 10);
  return `${shown} ${units[unit]}`;
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
// An instant names its zone (Z or an offset); a time without one would read in the computer's own zone (B2 fix round 1).
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

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
  // A day on the calendar only: "2026-02-31" is not one (Date.UTC would roll it into March).
  const real = new Date(Date.UTC(year, month - 1, day));
  return month >= 1 && month <= 12 && real.getUTCMonth() === month - 1 && real.getUTCDate() === day ? { year, month, day } : null;
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

/** A calendar day ('YYYY-MM-DD') moved by whole days, on the calendar alone (no zone): a date field's min and max. */
export function dayKeyPlus(day: string, days: number): string {
  const found = CALENDAR_DAY.exec(day);
  if (!found) return '';
  const moved = new Date(Date.UTC(Number(found[1]), Number(found[2]) - 1, Number(found[3]) + days));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}-${String(moved.getUTCDate()).padStart(2, '0')}`;
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

/** A wall-clock time as a time field keeps it ('09:00', a routine's or a quiet hour's setting) on the 12-hour clock: "9:00 am". */
export function formatClock(hhmm: string): string {
  const found = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!found) return hhmm;
  const hour = Number(found[1]);
  return `${hour % 12 || 12}:${found[2]} ${hour < 12 ? 'am' : 'pm'}`;
}

/** The wall clock in the zone at an instant as 'HH:MM' (24-hour): a key to compare with a time field, never shown. */
export function timeKeyIn(value: When, zone: string): string {
  const local = localIn(value, zone);
  return local ? `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}` : '';
}

// AI cost (one-shot B2 task 6). Micro units are millionths of a US dollar. The owner form rounds half up to cents; the
// receipt keeps the exact four-decimal form (records.ts formatMicros, "USD 0.0042").

const MICROS = /^\d{1,30}$/;

/**
 * An AI cost as the owner reads it: "On your own AI plan" when every call ran on the owner's Claude Code or Codex and
 * nothing was charged; "Free" for nothing spent with no paid call (a template); "under $0.01" below a cent; else
 * "$0.42". An unconfirmed price adds " (estimate)".
 */
export function formatCost(micros: string, options: { ownPlan?: boolean; paidCalls?: boolean; estimate?: boolean } = {}): string {
  check(MICROS.test(micros), 'INVALID_AMOUNT', 'Cost must be whole micro units.');
  const value = BigInt(micros), tail = options.estimate ? ' (estimate)' : '';
  if (value === 0n && options.ownPlan) return 'On your own AI plan';
  if (value === 0n && !options.paidCalls) return `Free${tail}`;
  // Half up to cents; a cost above zero that still rounds to no cents reads "under $0.01", never as nothing.
  const cents = (value + 5_000n) / 10_000n;
  if (value > 0n && cents === 0n) return `under $0.01${tail}`;
  return `$${grouped(String(cents / 100n), false)}.${String(cents % 100n).padStart(2, '0')}${tail}`;
}

/** A price per call or per million tokens: two decimals at least, up to four when the rate has them ("$3.00", "$0.0015"). */
export function formatRate(micros: string): string {
  check(MICROS.test(micros), 'INVALID_AMOUNT', 'A rate must be whole micro units.');
  const tenThousandths = (BigInt(micros) + 50n) / 100n;
  const fraction = String(tenThousandths % 10_000n).padStart(4, '0');
  return `$${grouped(String(tenThousandths / 10_000n), false)}.${fraction.slice(0, 2)}${fraction.slice(2).replace(/0+$/, '')}`;
}

/** A dollar amount in micro units (spent, a limit, what is left): "$12.50", "$0.00" for nothing, "under $0.01" below a cent. */
export function formatUsd(micros: string): string {
  return formatCost(micros, { paidCalls: true });
}
