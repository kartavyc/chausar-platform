import { check } from '../contracts.ts';
import type { WireObject, WireValue } from './types.ts';

/** Data-only payload checks shared by every adapter. They never calculate. */
export function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_WRITE_PAYLOAD', 'The action needs a plain record.');
  const keys = Object.keys(value);
  check(required.every(key => Object.hasOwn(value, key)), 'INVALID_WRITE_PAYLOAD', 'A required field is missing.');
  check(keys.every(key => required.includes(key) || optional.includes(key)), 'INVALID_WRITE_PAYLOAD', 'The action has a field it does not accept.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 500, pattern?: RegExp): string {
  check(typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'INVALID_WRITE_PAYLOAD', 'A text field is empty, too long or has control characters.');
  if (pattern) check(pattern.test(value), 'INVALID_WRITE_PAYLOAD', 'A field does not have its expected form.');
  return value;
}
export function optionalText(value: unknown, max = 500, pattern?: RegExp): string | undefined { return value === undefined ? undefined : text(value, max, pattern); }
/** Whole paise as a string: never a float. */
export function paise(value: unknown, allowZero = false): string {
  check(typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value) && (allowZero || value !== '0'), 'INVALID_AMOUNT', 'Money is whole paise written as a string.');
  return value;
}
export function date(value: unknown): string {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value), 'INVALID_DATE', 'Use a calendar date written as YYYY-MM-DD.');
  return value;
}
export function instant(value: unknown): string {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)), 'INVALID_DATE', 'Use a UTC instant.');
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  check(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, 'INVALID_WRITE_PAYLOAD', 'A count is outside its allowed range.');
  return value as number;
}
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  check(typeof value === 'string' && (allowed as readonly string[]).includes(value), 'INVALID_WRITE_PAYLOAD', 'A field has a value outside its allowed list.');
  return value as T;
}
export function email(value: unknown): string { return text(value, 254, /^[^\s@<>()",;]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/); }
/** E.164 without the plus sign, as messaging APIs take it. */
export function phone(value: unknown): string { return text(value, 16, /^[1-9]\d{7,14}$/); }
export function list<T>(value: unknown, max: number, each: (item: unknown) => T): T[] {
  check(Array.isArray(value) && value.length > 0 && value.length <= max, 'INVALID_WRITE_PAYLOAD', 'A list is empty or too long.');
  return value.map(each);
}
/** Paise string to rupees text for previews and system wire formats. Pure formatting, no arithmetic on floats. */
export function rupees(minor: string): string {
  const negative = minor.startsWith('-'), digits = (negative ? minor.slice(1) : minor).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2).replace(/^0+(?=\d)/, '')}.${digits.slice(-2)}`;
}
/** Rupees text from a system ("1234.5", "1234.50", or 1234.5 as a JSON number) to paise, exact. */
export function toPaise(value: unknown): string {
  const raw = typeof value === 'number' ? (check(Number.isFinite(value), 'WRITE_REPLY_INVALID', 'The system sent an invalid amount.'), String(value)) : value;
  check(typeof raw === 'string' && /^-?\d{1,14}(\.\d{1,2})?$/.test(raw), 'WRITE_REPLY_INVALID', 'The system sent an amount Chausar cannot read exactly.');
  const [whole, fraction = ''] = raw.replace('-', '').split('.');
  const value2 = (BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))).toString();
  return raw.startsWith('-') && value2 !== '0' ? `-${value2}` : value2;
}
export function plain(value: unknown): WireObject {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'WRITE_REPLY_INVALID', 'The system sent a reply Chausar cannot read.');
  return JSON.parse(JSON.stringify(value)) as WireObject;
}
export const str = (value: WireValue | undefined): string => value === null || value === undefined ? '' : String(value);
