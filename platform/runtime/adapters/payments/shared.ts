import { check, ChausarError } from '../../contracts.ts';
import { validDate } from '../../memory.ts';
import { parseExactJson } from '../accounting/common.ts';

/**
 * Small helpers shared by the payment and commerce read specs. Source bytes are data: JSON is read
 * with exact number spellings (amounts stay text, never floats) and every refusal is a fixed sentence.
 */
export type ReadPeriod = { from: string; to: string };

export function exactJson(body: string, code: string): unknown {
  try { return parseExactJson(body); }
  catch { throw new ChausarError(code, 'The system returned a response that is not complete JSON.'); }
}
export function plain(value: unknown, code: string): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), code, 'The system returned a response in an unexpected shape.');
  return value as Record<string, unknown>;
}
export function items(value: unknown, code: string): Record<string, unknown>[] {
  check(Array.isArray(value), code, 'The system returned a response in an unexpected shape.');
  return value.map(item => plain(item, code));
}
/** Configuration is a plain object holding only the named keys. */
export function strictConfig(config: unknown, allowed: readonly string[], code: string): Record<string, unknown> {
  check(config !== null && typeof config === 'object' && !Array.isArray(config) && Object.keys(config).every(key => allowed.includes(key)),
    code, 'The connection settings hold an unknown or missing value.');
  return config as Record<string, unknown>;
}
export function pageSize(value: unknown, fallback: number, min: number, max: number, code: string): number {
  if (value === undefined) return fallback;
  check(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, code, 'The page size is outside what this system allows.');
  return value as number;
}
export function requirePeriod(period: ReadPeriod | null, code = 'READ_PERIOD_REQUIRED'): ReadPeriod {
  check(period && validDate(period.from) && validDate(period.to) && period.from <= period.to, code, 'Choose a period with a start and end date.');
  return { from: period.from, to: period.to };
}
/** India Standard Time is a fixed +05:30 offset. */
export const istStartSeconds = (date: string): number => Date.parse(`${date}T00:00:00+05:30`) / 1000;
export const istEndSeconds = (date: string): number => Date.parse(`${date}T23:59:59+05:30`) / 1000;
export function istDay(epochSeconds: string): { year: number; month: number; day: number } {
  const d = new Date(Number(epochSeconds) * 1000 + 19_800_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
/** Read one query value of a request this adapter built itself. */
export function queryValue(url: string, name: string): string | null { return new URL(url).searchParams.get(name); }
export const WHOLE = /^(?:0|[1-9]\d{0,17})$/;
export const EPOCH_SECONDS = /^\d{9,11}$/;
