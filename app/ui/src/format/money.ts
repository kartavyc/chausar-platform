import { assertIntegerString } from '../bridge/validate.ts';

function exact(value: string): bigint { assertIntegerString(value); return BigInt(value); }
export function indianGroup(digits: string): string {
  if (!/^\d+$/.test(digits)) throw new TypeError('INVALID_FORMAT_VALUE');
  const canonical = BigInt(digits).toString();
  if (canonical.length <= 3) return canonical;
  const head = canonical.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${canonical.slice(-3)}`;
}
/** Paise strings remain exact even above 2^53. This is display arithmetic only. */
export function money(paise: string): string {
  const value = exact(paise), absolute = value < 0n ? -value : value;
  const fraction = absolute % 100n;
  return `${value < 0n ? '-' : ''}\u20b9${indianGroup((absolute / 100n).toString())}${fraction === 0n ? '' : `.${fraction.toString().padStart(2, '0')}`}`;
}
export interface ShortMoneyWords { readonly lakh: string; readonly crore: string }
/** The exact money(paise) must accompany this shortened display in title/accessible text. */
export function moneyShort(paise: string, words: ShortMoneyWords): string {
  const value = exact(paise), absolute = value < 0n ? -value : value;
  const scale = absolute >= 1_000_000_000n ? 1_000_000_000n : absolute >= 10_000_000n ? 10_000_000n : null;
  if (scale === null) return money(paise);
  // Round half up at the final display boundary. Never retain this as a business value.
  const hundredths = (absolute * 100n + scale / 2n) / scale;
  const fraction = (hundredths % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  const suffix = scale === 1_000_000_000n ? words.crore : words.lakh;
  return `${value < 0n ? '-' : ''}\u20b9${indianGroup((hundredths / 100n).toString())}${fraction ? `.${fraction}` : ''} ${suffix}`;
}
export interface SpokenMoneyWords {
  /** Catalog-owned names for 0..99, including Hindi's irregular number names. */
  readonly underHundred: readonly string[];
  readonly minus: string;
  readonly hundred: string;
  readonly thousand: string;
  readonly lakh: string;
  readonly crore: string;
  readonly rupees: string;
  readonly paise: string;
  readonly and: string;
}
function spokenInteger(value: bigint, words: SpokenMoneyWords): string {
  if (words.underHundred.length !== 100 || words.underHundred.some(word => typeof word !== 'string' || word.length === 0)) throw new TypeError('INVALID_FORMAT_WORDS');
  if (value < 100n) return words.underHundred[Number(value)]!;
  for (const [scale, word] of [[10_000_000n, words.crore], [100_000n, words.lakh], [1_000n, words.thousand], [100n, words.hundred]] as const) {
    if (value >= scale) return `${spokenInteger(value / scale, words)} ${word}${value % scale ? ` ${spokenInteger(value % scale, words)}` : ''}`;
  }
  throw new TypeError('INVALID_FORMAT_VALUE');
}
export function moneySpoken(paise: string, words: SpokenMoneyWords): string {
  const value = exact(paise), absolute = value < 0n ? -value : value;
  return `${value < 0n ? `${words.minus} ` : ''}${spokenInteger(absolute / 100n, words)} ${words.rupees}${absolute % 100n ? ` ${words.and} ${spokenInteger(absolute % 100n, words)} ${words.paise}` : ''}`;
}
