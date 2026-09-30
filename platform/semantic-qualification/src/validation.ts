import { createHash } from 'node:crypto';
import type { SemanticIssue } from './contracts.ts';

export class SemanticError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'SemanticError'; this.code = code; }
}
export function requireThat(value: unknown, code: string, message: string): asserts value {
  if (!value) throw new SemanticError(code, message);
}
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
export function record(value: unknown, name = 'object'): asserts value is Record<string, any> {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_CONTRACT', `${name} must be a data object.`);
  requireThat([Object.prototype, null].includes(Object.getPrototypeOf(value)), 'NON_DATA_CONTRACT', `${name} must have a plain data prototype.`);
  for (const key of Reflect.ownKeys(value)) {
    requireThat(typeof key === 'string' && !reserved.has(key), 'NON_DATA_CONTRACT', 'Reserved keys and symbols are refused.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireThat(!descriptor.get && !descriptor.set && descriptor.enumerable, 'NON_DATA_CONTRACT', 'Accessors and hidden properties are refused.');
  }
}
/** Check before reading any untrusted property, including getters. */
export function dataOnly(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  requireThat(depth <= 32 && ++budget.nodes <= 300000, 'CONTRACT_LIMIT', 'Data exceeds its bounded structure limit.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { requireThat(value.length <= 20000, 'CONTRACT_LIMIT', 'A data string is too long.'); return; }
  if (typeof value === 'number') { requireThat(Number.isSafeInteger(value), 'NON_DATA_CONTRACT', 'Only safe integer configuration values are accepted; decimals must be strings.'); return; }
  requireThat(typeof value === 'object', 'NON_DATA_CONTRACT', 'Functions, code, undefined and non-JSON values are refused.');
  if (Array.isArray(value)) {
    requireThat(Object.getPrototypeOf(value) === Array.prototype && value.length <= 20000, 'CONTRACT_LIMIT', 'Invalid or oversized data array.');
    const keys = Reflect.ownKeys(value);
    requireThat(keys.length === value.length + 1, 'NON_DATA_CONTRACT', 'Sparse or decorated arrays are refused.');
    for (let i = 0; i < value.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      requireThat(d && 'value' in d && d.enumerable, 'NON_DATA_CONTRACT', 'Array accessors are refused.');
      dataOnly(d.value, depth + 1, budget);
    }
    return;
  }
  record(value); for (const key of Object.keys(value)) dataOnly(value[key], depth + 1, budget);
}
export function exactKeys(value: unknown, keys: string[], name = 'contract'): asserts value is Record<string, any> {
  record(value, name);
  requireThat(Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), 'INVALID_CONTRACT', `${name} requires exactly: ${keys.join(', ')}.`);
}
export function text(value: unknown, name: string, allowEmpty = false): asserts value is string {
  requireThat(typeof value === 'string' && (allowEmpty || value.trim().length > 0) && value.length <= 1000, 'INVALID_CONTRACT', `${name} must be bounded text.`);
}
export function strings(value: unknown, name: string, allowEmpty = false): asserts value is string[] {
  requireThat(Array.isArray(value) && (allowEmpty || value.length > 0) && value.length <= 200 && new Set(value).size === value.length, 'INVALID_CONTRACT', `${name} must be a unique bounded list.`);
  value.forEach(item => text(item, name));
}
export function digest(value: unknown): asserts value is string { requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'INVALID_DIGEST', 'Evidence requires a lowercase SHA-256 digest.'); }
export function canonicalJson(value: unknown): string {
  dataOnly(value);
  const normalize = (v: any): any => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, normalize(v[k])])) : v;
  return JSON.stringify(normalize(value));
}
export const sha256Bytes = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const hashData = (value: unknown) => sha256Bytes(canonicalJson(value));
export function freezeData<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (v: any) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(copy); return copy;
}
export function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validatePeriod(value: unknown) {
  exactKeys(value, ['from', 'to'], 'period');
  requireThat(calendarDate(value.from) && calendarDate(value.to) && value.from <= value.to, 'INVALID_PERIOD', 'The inclusive reporting period needs valid ordered calendar dates.');
}
export function exactDecimal(value: unknown, scale: number): bigint {
  requireThat(typeof value === 'string' && value.length <= 100 && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value), 'INEXACT_DECIMAL', 'Amounts and quantities need ungrouped exact decimal text.');
  const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  requireThat(fraction.length <= scale, 'INEXACT_DECIMAL', 'The value exceeds the explicitly configured decimal scale; rounding is not inferred.');
  return (negative ? -1n : 1n) * (BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0'));
}
export function scaledDecimal(value: bigint, scale: number) {
  const sign = value < 0n ? '-' : '', n = value < 0n ? -value : value;
  return scale === 0 ? sign + String(n) : `${sign}${n / 10n ** BigInt(scale)}.${String(n % 10n ** BigInt(scale)).padStart(scale, '0')}`;
}
export function issue(error: unknown, row?: number, field?: string): SemanticIssue {
  if (!(error instanceof SemanticError)) throw error;
  return { code: error.code, message: error.message, ...(row === undefined ? {} : { row }), ...(field === undefined ? {} : { field }) };
}
