import { check, hash } from '../contracts.ts';
import type { AdapterContext, Secret } from './types.ts';

/** The business reference written into a system for one effect key: short, stable, opaque. */
export function effectReference(key: string): string { return `CHS-${hash(`writeback-reference:${key}`).slice(0, 16).toUpperCase()}`; }

/** Reads one named credential field; a missing field is a typed refusal, never a guess. */
export async function secret(ctx: AdapterContext, field: string): Promise<string> {
  const material: Secret = await ctx.credentials();
  const value = material[field];
  check(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\r\n]/.test(value), 'WRITE_CREDENTIALS_UNAVAILABLE', 'The connection has no usable credential. Sign in to the system again.');
  return value;
}
export function account(ctx: AdapterContext, field: string, pattern: RegExp): string {
  const value = ctx.connection.account[field];
  check(typeof value === 'string' && pattern.test(value), 'WRITE_CONNECTION_INCOMPLETE', 'The connection is missing an account detail.');
  return value;
}
