// Exact basis-point parsing and formatting, shared without native record dependencies.
import {check} from '../../portable.ts';
export function percentBps(value: unknown, field: string): string {
  check(typeof value === 'string' && value.length <= 12, 'INVALID_TAX_RATE', `${field} must be a rate like 18 or 8.25.`);
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.replace(/[\s%]/g, ''));
  check(match, 'INVALID_TAX_RATE', `${field} must be a rate like 18 or 8.25.`);
  const bps = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  check(bps <= 10000n, 'INVALID_TAX_RATE', `${field} must be 100 or less.`);
  return String(bps);
}

/** Basis points text to percent text for display and prefills: '1800' is '18', '825' is '8.25', '25' is '0.25'. */
export function bpsPercent(bps: string): string {
  check(/^\d{1,5}$/.test(bps), 'INVALID_TAX_RATE', 'A tax rate must be whole basis points.');
  const value = BigInt(bps), whole = value / 100n, fraction = value % 100n;
  if (fraction === 0n) return String(whole);
  const digits = String(fraction).padStart(2, '0');
  return `${whole}.${digits.endsWith('0') ? digits.slice(0, 1) : digits}`;
}
