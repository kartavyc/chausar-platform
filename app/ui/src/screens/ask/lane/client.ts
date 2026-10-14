/**
 * The ask lane's engine client. Every reply is untrusted: it is checked by the validator named
 * for its method before a screen draws it, and a reply that does not pass is a failure, never a
 * partly drawn page. A refusal arrives as its short code only; the words come from the screen's
 * catalogue. The three codes the frame uses for a part not built yet become `not-built`.
 */
import type { PlaceRpc } from '../../../places/types.ts';

export type Reply<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'not-built' }
  | { readonly kind: 'refused'; readonly code: string };

const NOT_BUILT = new Set(['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE']);
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

export class ReplyInvalid extends Error { constructor() { super('INVALID_REPLY'); this.name = 'ReplyInvalid'; } }

/** Calls one engine method and validates its reply. Never throws for a refusal. */
export async function call<T>(rpc: PlaceRpc, method: string, payload: Record<string, unknown>, validate: (value: unknown) => T): Promise<Reply<T>> {
  let raw: unknown;
  try { raw = await rpc.request(method, payload); }
  catch (error) {
    const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : 'REQUEST_FAILED';
    if (NOT_BUILT.has(code)) return { kind: 'not-built' };
    return { kind: 'refused', code: CODE.test(code) ? code : 'REQUEST_FAILED' };
  }
  try { return { kind: 'ok', value: validate(raw) }; }
  catch { return { kind: 'refused', code: 'INVALID_REPLY' }; }
}

/* Small validators. Each throws ReplyInvalid; none coerces a value into another type. */
export function fail(): never { throw new ReplyInvalid(); }
export function obj(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
export function str(value: unknown, max = 20000): string { if (typeof value !== 'string' || value.length > max) fail(); return value; }
export function optStr(value: unknown, max = 20000): string | null { return value === null || value === undefined ? null : str(value, max); }
export function int(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(); return value; }
export function bool(value: unknown): boolean { if (typeof value !== 'boolean') fail(); return value; }
/** Whole paise or a signed whole count, as digits. Never a JavaScript number. */
export function minor(value: unknown): string { if (typeof value !== 'string' || !/^-?\d{1,40}$/.test(value)) fail(); return value; }
export function optMinor(value: unknown): string | null { return value === null || value === undefined ? null : minor(value); }
export function date(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value) || value.length > 40) fail(); return value; }
export function id(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)) fail(); return value; }
export function oneOf<T extends string>(value: unknown, options: readonly T[]): T { if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) fail(); return value as T; }
export function list<T>(value: unknown, item: (entry: unknown) => T, max = 5000): T[] {
  if (!Array.isArray(value) || value.length > max) fail();
  return value.map(item);
}
export interface Period { readonly from: string; readonly to: string }
export function period(value: unknown): Period { const v = obj(value); return { from: date(v.from), to: date(v.to) }; }
export function optPeriod(value: unknown): Period | null { return value === null || value === undefined ? null : period(value); }
