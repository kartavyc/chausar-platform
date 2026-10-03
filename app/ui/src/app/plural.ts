/**
 * Which plural form a count takes, chosen from its exact digits without turning the
 * count into a floating-point number. The count a person reads stays the full exact
 * `display`; this only gives an ICU `plural` argument something small to select on.
 *
 * English: one for exactly 1. Hindi: one for 0 and 1. Every larger whole count is
 * `other` in both, so 2 stands in for all of them. A count that is not known is `other`.
 * This covers the two languages the app ships; another language needs its own rule.
 */

export type PluralSelector = 0 | 1 | 2;

export function pluralSelector(digits: string | null): PluralSelector {
  if (digits === null || !/^\d+$/.test(digits)) return 2;
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (trimmed === '0') return 0;
  if (trimmed === '1') return 1;
  return 2;
}
