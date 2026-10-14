/** Shared helpers for reportsx.*: dates, figures, the lane namespace and the clock. */
import { check, type State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { validDate } from '../memory.ts';
import { laneState, peekLane } from '../trust-ext/lane-state.ts';

export type Language = 'en' | 'hi';
export type Words = { en: string; hi: string };
export type Period = { from: string; to: string };
export type Missing = 'absent' | 'null' | 'unknown' | 'withheld' | 'not-applicable' | 'not-loaded-yet' | 'not-counted';
export type EngineFigure = { kind: 'money' | 'count' | 'percent'; exact: string; receiptId: string; labels: string[] } | { kind: 'missing'; missing: Missing };
export type FileRef = { name: string; path: string; bytes: number; sha256: string };

/** Rhythm times and "today" are India Standard Time (UTC+05:30, no daylight saving). */
export const IST_OFFSET_MS = 330 * 60_000;
export const DAY_MS = 86_400_000;

export function record(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function closed(payload: unknown, allowed: string[], code: string): Record<string, any> {
  check(record(payload) && Object.keys(payload).every(key => allowed.includes(key)), code, 'Unknown request properties are refused.');
  return payload;
}
/** Trusted test hosts may pin the clock through engine module options; production uses the system clock. */
export function clock(host: ModuleHost): number {
  const pinned = host.options.clock;
  return typeof pinned === 'function' ? Number((pinned as () => number)()) : Date.now();
}
export const isoAt = (ms: number) => new Date(ms).toISOString();
export const indiaDate = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
export function addDays(date: string, days: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10); }
export function daysBetween(from: string, to: string): number { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS); }
export function monthEnd(year: number, month: number): string { return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); }
export function dateOf(year: number, month: number, day: number): string { return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
/** Monday of the ISO week containing the date. */
export function isoWeek(date: string): Period { const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; const from = addDays(date, -weekday); return { from, to: addDays(from, 6) }; }
/** The twelve whole calendar months ending with the month that contains `to`. */
export function lastTwelveMonths(to: string): Period[] {
  const year = Number(to.slice(0, 4)), month = Number(to.slice(5, 7));
  return Array.from({ length: 12 }, (_, index) => {
    const offset = month - 11 + index, y = year + Math.floor((offset - 1) / 12), m = ((offset - 1) % 12 + 12) % 12 + 1;
    return { from: dateOf(y, m, 1), to: monthEnd(y, m) };
  });
}
export function validPeriod(value: unknown): Period {
  check(record(value) && Object.keys(value).sort().join(',') === 'from,to' && validDate(value.from) && validDate(value.to) && value.from <= value.to
    && daysBetween(value.from, value.to) <= 800, 'INVALID_PERIOD', 'Choose a period with a start and end date, at most two years long.');
  return { from: value.from, to: value.to };
}
export function language(value: unknown): Language {
  check(value === undefined || value === 'en' || value === 'hi', 'INVALID_LANGUAGE', 'Choose English or Hindi.');
  return value ?? 'en';
}
const monthWords: Record<Language, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
};
export function monthLabel(from: string, lang: Language): string { return `${monthWords[lang][Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`; }

/** Whole paise as a decimal rupee string, by string arithmetic (formatting only, never a business calculation). */
export function rupees(minor: string): string {
  check(/^-?\d+$/.test(minor), 'INVALID_MINOR_UNITS', 'Amounts must be whole paise.');
  const negative = minor.startsWith('-'), digits = minor.replace(/^-/, '').padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2).replace(/^0+(?=\d)/, '')}.${digits.slice(-2)}`;
}
/** Hundredths of a percent as a decimal percent string. */
export function percentText(hundredths: string): string { return rupees(hundredths); }

/** Read-only view of the reports namespace. */
export function peekReports(state: State): Record<string, any> { return peekLane(state)?.reports ?? {}; }
/** Mutable reports namespace; call only inside host.store.update. */
export function reportsState(state: State): Record<string, any> { return laneState(state).reports; }
export const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export const stamp = (ms: number) => isoAt(ms).replace(/[:.]/g, '-');
