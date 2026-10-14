/**
 * Typed rupees to whole paise, by string handling only: no number is ever made from the
 * amount, so no float can round it. Accepts digits with Indian or Western grouping
 * commas and at most two decimals ("1,234.50", "1,23,456", "0.5"). Refuses a sign, an
 * exponent, a third decimal and anything else by returning null.
 */
const PLAIN = /^\d{1,15}$/;
const INDIAN = /^\d{1,2}(,\d{2})*,\d{3}$/;
const WESTERN = /^\d{1,3}(,\d{3})+$/;

export function rupeesToPaise(text: string): string | null {
  const typed = text.trim().replace(/^₹\s*/, '');
  const dot = typed.indexOf('.');
  const whole = dot < 0 ? typed : typed.slice(0, dot);
  const fraction = dot < 0 ? '' : typed.slice(dot + 1);
  if (!(PLAIN.test(whole) || INDIAN.test(whole) || WESTERN.test(whole))) return null;
  if (dot >= 0 && !/^\d{1,2}$/.test(fraction)) return null;
  const digits = (whole.split(',').join('') + fraction.padEnd(2, '0')).replace(/^0+(?=\d)/, '');
  return digits.length > 17 ? null : digits;
}

/** A whole count typed in a field (a limit, a number of days or minutes). */
export function wholeNumber(text: string, max = 1_000_000): number | null {
  const typed = text.trim();
  if (!/^\d{1,7}$/.test(typed)) return null;
  const n = Number(typed);
  return n <= max ? n : null;
}

/** Whole paise back to the text a person would type, for a field's first value. */
export function paiseToTyped(paise: string): string {
  const padded = paise.padStart(3, '0');
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, ''), fraction = padded.slice(-2);
  return fraction === '00' ? whole : `${whole}.${fraction}`;
}
