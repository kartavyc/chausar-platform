import { check } from '../../contracts.ts';
import { parseExactJson } from '../accounting/common.ts';
import type { ApiReadResult } from '../read-kit.ts';

/**
 * Small helpers shared by the connectors-ext API read specs (Google, CRM, Tally registers, books
 * APIs). Source values stay exact text: parseExactJson keeps every number as its source spelling.
 */
export function sourceObject(value: unknown, code = 'SOURCE_SHAPE_INVALID'): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), code, 'The system returned an unexpected response shape.');
  return value as Record<string, unknown>;
}
export function sourceArray(value: unknown, code = 'SOURCE_SHAPE_INVALID'): unknown[] {
  check(Array.isArray(value), code, 'The system returned an unexpected response shape.');
  return value;
}
export function parseSourceJson(text: string): Record<string, unknown> {
  return sourceObject(parseExactJson(text));
}
/** A scalar as exact text. Null and absent stay empty text, which recipes read as missing, never zero. */
export function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  check(typeof value === 'string' && value.length <= 100_000, 'SOURCE_VALUE_INVALID', 'A source value is not plain text or a number.');
  return value;
}
/** Configuration is a plain object carrying only the named keys. */
export function strictConfig<C>(config: C, allowed: readonly string[], required: readonly string[] = []): C {
  check(config !== null && typeof config === 'object' && !Array.isArray(config), 'CONFIG_INVALID', 'The read configuration is a plain record.');
  const keys = Object.keys(config as object);
  check(keys.every(key => allowed.includes(key)) && required.every(key => keys.includes(key)), 'CONFIG_INVALID', 'The read configuration has unknown or missing settings.');
  return config;
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export function validDay(value: string): boolean {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function checkPeriod(period: { from: string; to: string } | null, required: boolean): { from: string; to: string } | null {
  if (period === null || period === undefined) { check(!required, 'PERIOD_REQUIRED', 'Choose the period to read.'); return null; }
  check(validDay(period.from) && validDay(period.to) && period.from <= period.to, 'PERIOD_INVALID', 'A period is two calendar dates, the first not after the second.');
  return period;
}
/** The calendar day after an ISO date, for exclusive upper bounds. */
export function nextDay(day: string): string {
  const at = new Date(`${day}T00:00:00.000Z`); at.setUTCDate(at.getUTCDate() + 1); return at.toISOString().slice(0, 10);
}
/** India Standard Time is a fixed +05:30 offset: midnight IST as epoch milliseconds. */
export function istMidnightMs(day: string): number { return Date.parse(`${day}T00:00:00.000+05:30`); }
export function currencyCode(value: unknown): string {
  const text = scalarText(value).trim().toUpperCase();
  if (text === '') return '';
  check(/^[A-Z]{3}$/.test(text), 'SOURCE_CURRENCY_INVALID', 'A currency is not an ISO code.');
  return text;
}
export function optionalCurrency(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  check(typeof value === 'string' && /^[A-Z]{3}$/.test(value), 'CONFIG_INVALID', 'A currency setting is a three-letter ISO code.');
  return value;
}
export function pageToken(value: unknown): string {
  check(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value), 'SOURCE_PAGINATION_INVALID', 'The system returned an unusable page token.');
  return value;
}

/**
 * The read result as recipe input for the 'api-records' decoder: the records, and the source's own
 * declared totals as meta keys (declaredRowCount, declaredAmount, declaredAmountUnit, declaredReference).
 */
export function recipeInput(result: ApiReadResult): { records: Record<string, unknown>[]; meta: Record<string, string> } {
  const meta: Record<string, string> = {}, declared = result.declared;
  if (declared) {
    if (declared.rowCount !== null && declared.rowCount !== undefined) meta.declaredRowCount = String(declared.rowCount);
    if (declared.amount !== null && declared.amount !== undefined) { meta.declaredAmount = declared.amount; meta.declaredAmountUnit = declared.amountUnit ?? 'major'; }
    if (declared.reference) meta.declaredReference = declared.reference;
  }
  return { records: result.records, meta };
}
