import { assertIntegerString } from '../bridge/validate.ts';
import { indianGroup } from './money.ts';
/** Business counts are exact strings. Nullable metadata must be handled before calling. */
export function count(value: string): string { assertIntegerString(value, 'count', false); return indianGroup(value); }
/** basisPoints are hundredths of a percent, formatted to at most one decimal. */
export function percent(basisPoints: string): string { return `${decimalPercent(basisPoints)}%`; }
function decimalPercent(basisPoints: string): string {
  assertIntegerString(basisPoints, 'basisPoints');
  const value = BigInt(basisPoints), absolute = value < 0n ? -value : value;
  const tenths = (absolute + 5n) / 10n;
  return `${value < 0n && tenths !== 0n ? '-' : ''}${indianGroup((tenths / 10n).toString())}${tenths % 10n ? `.${tenths % 10n}` : ''}`;
}
/** Use a catalog-owned word; this is percentage points, not a percent of a change. */
export function points(basisPoints: string, word: string): string { return `${decimalPercent(basisPoints)} ${word}`; }
