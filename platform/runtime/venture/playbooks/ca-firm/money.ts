// AI-native CA firm: exact money for tax work. Amounts are BigInt paise, rates are whole basis points, and every
// division names its rounding. Nothing here uses a float. Idea taken, code written here: Invaro/opentax-engine
// (AGPL-3.0, ideas only), whose money module keeps cents as bigint and makes each division say how it rounds.
import { ChausarError } from '../../../portable.ts';
import { formatMinor } from '../../../currency.ts';

export type Rounding = 'half-up' | 'half-even' | 'floor' | 'ceil';
export type IsoDate = string;

export const PAISE_PER_RUPEE = 100n;
const BPS = 10000n;

export const invalid = (message: string): never => { throw new ChausarError('TAX_INPUT_INVALID', message); };
export const notModelled = (message: string): never => { throw new ChausarError('NOT_MODELLED', message); };

/** n / d with the named rounding. d must be positive. Works for negative n: half-up rounds half away from zero. */
export function divRound(n: bigint, d: bigint, mode: Rounding): bigint {
  if (d <= 0n) throw new ChausarError('TAX_INPUT_INVALID', 'A divisor must be positive.');
  const negative = n < 0n;
  const a = negative ? -n : n;
  const q = a / d, r = a % d;
  let up: boolean;
  if (r === 0n) up = false;
  else if (mode === 'floor') up = negative;
  else if (mode === 'ceil') up = !negative;
  else if (mode === 'half-up') up = r * 2n >= d;
  else up = r * 2n > d || (r * 2n === d && q % 2n === 1n);
  const magnitude = up ? q + 1n : q;
  return negative ? -magnitude : magnitude;
}

/** amount x bps / 10000, rounded as named (half-up to the paisa unless said otherwise). */
export function applyBps(amount: bigint, bps: bigint, mode: Rounding = 'half-up'): bigint {
  return divRound(amount * bps, BPS, mode);
}

/**
 * Sections 288A and 288B of the Income-tax Act, 1961: paise are ignored, then the amount goes to the nearest ten
 * rupees, a last figure of five or more going up. Non-negative amounts only.
 */
export function round288(minor: bigint): bigint {
  if (minor < 0n) throw new ChausarError('TAX_INPUT_INVALID', 'Only a non-negative amount is rounded this way.');
  const rupees = minor / PAISE_PER_RUPEE;
  const last = rupees % 10n;
  return (last >= 5n ? rupees - last + 10n : rupees - last) * PAISE_PER_RUPEE;
}

/** Down to a whole multiple: rule 119A ignores any fraction of one hundred rupees. Non-negative amounts only. */
export function floorToMultiple(minor: bigint, unit: bigint): bigint {
  if (minor <= 0n) return 0n;
  return (minor / unit) * unit;
}

/** Whole paise as text, never negative, never a fraction. */
export function paise(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) invalid(`${field} must be whole paise as text, never negative.`);
  return BigInt(value as string);
}

/** Whole paise as text that may be negative (a refund, a money-out movement). */
export function signedPaise(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^-?\d{1,15}$/.test(value)) invalid(`${field} must be whole paise as text.`);
  return BigInt(value as string);
}

export function optionalPaise(value: unknown, field: string): bigint {
  return value === undefined || value === null ? 0n : paise(value, field);
}

export const minBig = (a: bigint, b: bigint) => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);
export const sumBig = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n);

export function inr(minor: bigint | string): string {
  return formatMinor(minor, 'INR');
}

/** A real calendar date written YYYY-MM-DD. */
export function isoDate(value: unknown, field: string): IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${field} must be a date written YYYY-MM-DD.`);
  const [y, m, d] = (value as string).split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) invalid(`${field} is not a real date.`);
  return value as string;
}

/**
 * Months from start to end, both counted, where a part of a month counts as a whole month (sections 234A, 234B and
 * 234C). The first month runs from start to the day before the same date next month. End before start gives 0.
 */
export function monthsOrPart(start: IsoDate, end: IsoDate): number {
  if (end < start) return 0;
  const [sy, sm, sd] = start.split('-').map(Number) as [number, number, number];
  const [ey, em, ed] = end.split('-').map(Number) as [number, number, number];
  const whole = (ey - sy) * 12 + (em - sm);
  return ed >= sd ? whole + 1 : whole;
}

/** The day after a date, as YYYY-MM-DD. */
export function nextDay(date: IsoDate): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** '22 October 2025'. */
export function longDate(date: IsoDate): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${months[m - 1]} ${y}`;
}

/** '18%' or '0.25%' from basis points, by BigInt. */
export function bpsText(bps: bigint | string): string {
  const value = BigInt(bps);
  const whole = value / 100n, fraction = value % 100n;
  return fraction === 0n ? `${whole}%` : `${whole}.${String(fraction).padStart(2, '0').replace(/0+$/, '')}%`;
}
