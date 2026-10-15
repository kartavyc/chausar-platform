/**
 * The number guard (AS-04). Every number in a written explanation must be on the receipt, except
 * the numbers that are part of a date, a year or an ordinal, which are recognised by structure:
 *
 *   an ISO date (2026-09-30) that is a real calendar day;
 *   a month name with a year (September 2026, सितंबर 2026) or a day (30 September, Sep 30, 2026);
 *   a financial year (2026-27, FY 2026-27);
 *   a lone year 1990–2100 only after or before a word that introduces a time (in 2026, 2026 में);
 *   an ordinal whose suffix is the right one for its number (1st, 22nd, 13th).
 *
 * None of these may touch an amount marker (₹, Rs, %, lakh, crore, rows…): "₹2026", "2026%",
 * "September 2026 lakh" and "in 2026 rupees" are amounts and must match the receipt. Digits of
 * any script are read as ASCII first, and every digit run is a number, even next to letters.
 */
import type { CalculationReceipt } from '../calculator.ts';
import { validDate } from '../memory.ts';
import type { GuardLine } from './contracts.ts';
import { unitOf } from './shared.ts';

export function asciiDigits(value: string): string {
  return value.normalize('NFKC').replace(/\p{Nd}/gu, digit => {
    const code = digit.codePointAt(0)!;
    for (let zero = code; zero > code - 10; zero--) if (!/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) return String(code - zero);
    return digit;
  });
}

type Token = { kind: 'num' | 'word' | 'sym'; text: string; start: number; end: number };
// A number may carry an exponent or a fraction slash; it then never matches. Any numeral that is
// still not an ASCII digit after NFKC (Roman, Ethiopic, Tamil tens, Kaktovik…) is its own number.
const TOKEN = /\d{4}-\d{2}-\d{2}|\d+(?:,\d+)*(?:\.\d+)?(?:[eE][+-]?\d+|\u2044\d+)?|[\p{L}\p{M}]+|[\p{N}\uE000]|\S/gu;
/**
 * Invisible format characters and soft hyphens are removed first, so "2\u200B1,250" reads as
 * the one number a person sees. Digits joined by a non-breaking or thin space or an apostrophe
 * are one number too ("1\u202F250", "1'250").
 */
export function visible(value: string): string {
  // Roman numerals, fractions and other non-decimal numerals are marked before NFKC turns them into letters.
  const joined = value.replace(/[\p{Cf}\u00AD]/gu, '').replace(/[\p{Nl}\p{No}]/gu, '\uE000').replace(/(\p{Nd})[\u00A0\u2000-\u200A\u202F\u205F\u3000'\u2019](?=\p{Nd})/gu, '$1');
  return asciiDigits(joined).replace(/[\p{Cf}\u00AD]/gu, '');
}
export function tokenize(value: string): Token[] {
  return [...visible(value).matchAll(TOKEN)].map(m => ({
    kind: /^[\p{N}\uE000]/u.test(m[0]) ? 'num' : /^[\p{L}\p{M}]/u.test(m[0]) ? 'word' : 'sym', text: m[0], start: m.index!, end: m.index! + m[0].length,
  }));
}

const MONTHS: Readonly<Record<string, number>> = Object.fromEntries([
  ['january', 'jan', 'जनवरी'], ['february', 'feb', 'फ़रवरी', 'फरवरी'], ['march', 'mar', 'मार्च'], ['april', 'apr', 'अप्रैल'], ['may', 'मई'], ['june', 'jun', 'जून'],
  ['july', 'jul', 'जुलाई'], ['august', 'aug', 'अगस्त'], ['september', 'sep', 'sept', 'सितंबर', 'सितम्बर'], ['october', 'oct', 'अक्टूबर', 'अक्तूबर'],
  ['november', 'nov', 'नवंबर', 'नवम्बर'], ['december', 'dec', 'दिसंबर', 'दिसम्बर'],
].flatMap((names, index) => names.map(name => [name, index + 1])));
const CURRENCY = new Set(['₹', '$', '€', '£', '¥', 'rs', 'inr', 'usd', 'eur', 'rupees', 'rupee', 'dollars', 'dollar', 'रु', 'रुपये', 'रुपए', 'रुपया']);
const SCALE = new Set(['lakh', 'lakhs', 'lac', 'lacs', 'crore', 'crores', 'cr', 'k', 'm', 'mn', 'bn', 'thousand', 'thousands', 'hundred', 'hundreds', 'million', 'millions', 'billion', 'billions',
  'हज़ार', 'हजार', 'सौ', 'लाख', 'करोड़', 'करोड', 'अरब']);
const PERCENT = new Set(['%', 'percent', 'per', 'pc', 'प्रतिशत', 'फ़ीसदी', 'फीसदी']);
const BEFORE_AMOUNT = new Set([...CURRENCY, 'paise']);
const AFTER_AMOUNT = new Set([...SCALE, ...PERCENT, ...CURRENCY, 'paise', 'पैसे', '/', 'only', 'x', 'times', 'bps',
  'rows', 'row', 'customers', 'customer', 'invoices', 'invoice', 'orders', 'units', 'items']);
/** Number words are amounts said in words: never on a receipt, so a sentence with one is replaced. */
const NUMBER_WORDS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'dozen', 'half', 'double', 'doubled', 'triple', 'tripled', 'twice', 'thrice',
  'एक', 'दो', 'तीन', 'चार', 'पाँच', 'पांच', 'छह', 'छः', 'सात', 'आठ', 'नौ', 'दस', 'बीस', 'पचास', 'आधा', 'आधी', 'दोगुना', 'दोगुनी', 'तिगुना', ...SCALE]);
const COUNT_NOUNS = new Set(['rows', 'row', 'records', 'record', 'entries', 'entry', 'lines', 'line', 'left', 'excluded', 'counted', 'read', 'पंक्ति', 'पंक्तियाँ', 'पंक्तियां', 'पंक्तियों']);
// Only words that introduce a time and never an amount: "rose to 2026" or "a total of 2026" stay amounts.
const YEAR_BEFORE = new Set(['in', 'since', 'during', 'until', 'till', 'year', 'fy', 'साल', 'वर्ष']);
const YEAR_AFTER = new Set(['में', 'तक']);
/** English month names count only when capitalised, so the verb "may" is never a month. */
const monthOf = (t: Token) => t.kind !== 'word' ? undefined : /^[a-z]/i.test(t.text) && !/^[A-Z]/.test(t.text) ? undefined : MONTHS[t.text.toLowerCase()];
const lower = (t: Token | undefined) => t?.text.toLowerCase();
const plainInt = (t: Token | undefined, min: number, max: number) => t?.kind === 'num' && /^\d+$/.test(t.text) && Number(t.text) >= min && Number(t.text) <= max;
const year = (t: Token | undefined) => plainInt(t, 1990, 2100) && t!.text.length === 4;
const glued = (a: Token, b: Token | undefined) => b !== undefined && a.end === b.start;
function ordinalSuffix(n: number) { const tens = n % 100; return tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'; }
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The indices of number tokens that belong to a date, a year or an ordinal. A candidate is
 * dropped when an amount marker sits right before or after the whole expression.
 */
export function timeNumbers(tokens: readonly Token[]): Map<number, 'date' | 'ordinal'> {
  const out = new Map<number, 'date' | 'ordinal'>();
  // "Rs. 30 September": a full stop between a marker and the number does not hide the marker.
  const before = (first: number) => tokens[first - 1]?.text === '.' ? tokens[first - 2] : tokens[first - 1];
  const amountAround = (first: number, last: number) => BEFORE_AMOUNT.has(lower(before(first)) ?? '') || AFTER_AMOUNT.has(lower(tokens[last + 1]) ?? '');
  const take = (indices: number[], kind: 'date' | 'ordinal', through = Math.max(...indices)) => {
    const first = Math.min(...indices), last = through;
    if (indices.some(i => out.has(i)) || amountAround(first, last)) return false;
    indices.forEach(i => out.set(i, kind)); return true;
  };
  // Day with an optional glued ordinal suffix: returns [day index, last index].
  const dayAt = (i: number): [number, number] | null => {
    if (!plainInt(tokens[i], 1, 31)) return null;
    const suffix = tokens[i + 1];
    if (suffix?.kind === 'word' && glued(tokens[i]!, suffix) && lower(suffix) === ordinalSuffix(Number(tokens[i]!.text))) return [i, i + 1];
    return glued(tokens[i]!, suffix) && suffix?.kind === 'word' ? null : [i, i];
  };
  tokens.forEach((t, i) => {
    if (t.kind === 'num' && /^\d{4}-\d{2}-\d{2}$/.test(t.text) && validDate(t.text) && Number(t.text.slice(0, 4)) >= 1990 && Number(t.text.slice(0, 4)) <= 2100) take([i], 'date');
  });
  tokens.forEach((t, i) => {
    const month = monthOf(t);
    if (month === undefined) return;
    // Month Day[, Year]
    const after = dayAt(i + 1);
    if (after) {
      let y = after[1] + 1; if (tokens[y]?.text === ',') y++;
      const known = year(tokens[y]);
      if (Number(tokens[after[0]]!.text) <= daysIn(known ? Number(tokens[y]!.text) : 2000, month)) take(known ? [after[0], y] : [after[0]], 'date', known ? y : after[1]);
      return;
    }
    // [Day [of]] Month [Year]
    let j = i - 1; if (lower(tokens[j]) === 'of') j--;
    let day: number | null = null;
    if (plainInt(tokens[j], 1, 31) && !(tokens[j + 1]?.kind === 'word' && glued(tokens[j]!, tokens[j + 1]) && j + 1 !== i)) day = j;
    else if (tokens[j]?.kind === 'word' && plainInt(tokens[j - 1], 1, 31) && glued(tokens[j - 1]!, tokens[j]) && lower(tokens[j]) === ordinalSuffix(Number(tokens[j - 1]!.text))) day = j - 1;
    const known = year(tokens[i + 1]);
    if (day !== null && Number(tokens[day]!.text) <= daysIn(known ? Number(tokens[i + 1]!.text) : 2000, month)) take(known ? [day, i + 1] : [day], 'date');
    else if (known) take([i + 1], 'date');
  });
  tokens.forEach((t, i) => {
    // Financial year: 2026-27 or 2026-2027, the second year the next one.
    if (year(t) && tokens[i + 1]?.text === '-' && glued(t, tokens[i + 1]) && glued(tokens[i + 1]!, tokens[i + 2]) && tokens[i + 2]?.kind === 'num') {
      const next = tokens[i + 2]!.text, y = Number(t.text);
      if (/^\d{2}$/.test(next) && Number(next) === (y + 1) % 100 || /^\d{4}$/.test(next) && Number(next) === y + 1) { take([i, i + 2], 'date'); return; }
    }
    if (year(t) && !out.has(i) && (YEAR_BEFORE.has(lower(tokens[i - 1]) ?? '') || YEAR_AFTER.has(lower(tokens[i + 1]) ?? ''))) take([i], 'date');
  });
  tokens.forEach((t, i) => {
    if (out.has(i) || !plainInt(t, 1, 1000)) return;
    const suffix = tokens[i + 1];
    if (suffix?.kind === 'word' && glued(t, suffix) && lower(suffix) === ordinalSuffix(Number(t.text)) && !AFTER_AMOUNT.has(lower(tokens[i + 2]) ?? '')) take([i], 'ordinal');
  });
  return out;
}

function normal(value: string) {
  const v = value.replaceAll(',', ''); const [whole, decimals] = v.split('.');
  return `${BigInt(whole || '0')}${decimals ? '.' + decimals.replace(/0+$/, '') : ''}`.replace(/\.$/, '');
}
const numbersOf = (value: string) => tokenize(value).filter(t => t.kind === 'num' && !/^\d{4}-\d{2}-\d{2}$/.test(t.text)).map(t => normal(t.text));

type Marks = { negative: boolean; currency: boolean; scale: boolean; percent: boolean; next: string };
/** What sits around a number: a sign or currency before it, a scale, percent or noun after it. */
function marksOf(tokens: readonly Token[], i: number): Marks {
  let j = i - 1, currency = false, negative = false;
  if (tokens[j]?.text === '.' && lower(tokens[j - 1]) === 'rs') j--;
  if (CURRENCY.has(lower(tokens[j]) ?? '')) { currency = true; j--; }
  if (['-', '\u2212', '\u2013'].includes(tokens[j]?.text ?? '') && (glued(tokens[j]!, tokens[j + 1]))) negative = true;
  const after = lower(tokens[i + 1]) ?? '';
  return { negative, currency: currency || after === '/' || CURRENCY.has(after), scale: SCALE.has(after), percent: PERCENT.has(after), next: after };
}

/** Every number in a written explanation, and the receipt line it matched, or none. */
export function guardLines(explanation: string, receipt: Pick<CalculationReceipt, 'figures' | 'rows' | 'coverage'>): GuardLine[] {
  const tokens = tokenize(explanation), time = timeNumbers(tokens);
  const shown = receipt.figures.map(f => ({ f, ...unitOf(f), numbers: numbersOf(f.display), negative: /^\s*[-\u2212]/.test(f.display) }));
  // A quantity is said with its own unit word right after it ("120 boxes"); its first word is what is compared.
  const unitWord = (u: string | null) => u === null ? null : u.toLowerCase().split(/[^\p{L}\p{N}]+/u)[0] || null;
  return tokens.flatMap((t, i): GuardLine[] => {
    if (t.kind === 'word') {
      // An amount said in words, or a scale word with no number right before it.
      const word = t.text.toLowerCase();
      if (NUMBER_WORDS.has(word) && !(SCALE.has(word) && tokens[i - 1]?.kind === 'num')) return [{ number: t.text, matched: null }];
      return [];
    }
    if (t.kind !== 'num') return [];
    const kind = time.get(i);
    if (kind) return [{ number: t.text, matched: { field: kind } }];
    if (!/^\d+(?:,\d+)*(?:\.\d+)?$/.test(t.text)) return [{ number: t.text, matched: null }];
    const n = normal(t.text), m = marksOf(tokens, i);
    // A money figure matches only as it is shown: same digits, same sign, no scale and no percent.
    // A quantity or count is never money: it matches only with no currency, scale or percent, and a quantity only with its unit word.
    const plain = !m.currency && !m.scale && !m.percent;
    const quantity = shown.find(s => s.unit === 'quantity' && s.numbers.includes(n) && plain && m.negative === s.negative && (unitWord(s.quantityUnit) === null || m.next === unitWord(s.quantityUnit)));
    if (quantity) return [{ number: t.text, matched: { figureKey: quantity.f.key } }];
    const money = shown.find(s => s.unit === 'money' && s.numbers.includes(n) && !m.scale && !m.percent && m.negative === s.negative);
    if (money) return [{ number: t.text, matched: { figureKey: money.f.key } }];
    const points = shown.find(s => s.unit === 'basis-points' && s.numbers.includes(n) && ['bps', 'basis'].includes(m.next) && !m.currency && !m.negative === !s.negative);
    if (points) return [{ number: t.text, matched: { figureKey: points.f.key } }];
    const counted = shown.find(s => s.unit === 'count' && s.numbers.includes(n) && plain && !m.negative && !s.negative && /^\d+$/.test(t.text));
    if (counted) return [{ number: t.text, matched: { figureKey: counted.f.key } }];
    // A count matches only as a plain count of rows: no currency, sign, scale or percent, and a row word after it.
    const count = !m.currency && !m.negative && !m.scale && !m.percent && COUNT_NOUNS.has(m.next) && /^\d+$/.test(t.text);
    if (count && (n === String(receipt.rows.length) || n === String(receipt.coverage.countedRows))) return [{ number: t.text, matched: { field: 'rows' } }];
    if (count && n === String(receipt.coverage.excludedRows)) return [{ number: t.text, matched: { field: 'excluded' } }];
    return [{ number: t.text, matched: null }];
  });
}
