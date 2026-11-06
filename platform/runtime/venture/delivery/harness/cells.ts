// Chausar delivery harness: reading amounts and dates out of client files. Code reads them; the model never types them.
// An amount becomes an exact minor-unit string (BigInt text). Anything that can't be read exactly is refused, never guessed.
import { decimalMinor } from '../../../currency.ts';
import { validDate } from '../../../memory.ts';
import type { DateOrder, IsoDate, MinorString } from '../../contracts.ts';

export type MoneyCell = { ok: true; minor: MinorString | null } | { ok: false; why: string };

/** Signs a cell may carry for each currency, besides its own code. Anything else in front of a number is refused. */
const SIGNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  INR: ['Rs.', 'Rs', '\u20b9'], USD: ['US$', '$'], EUR: ['\u20ac'], GBP: ['\u00a3'], JPY: ['\u00a5'], AUD: ['A$', '$'], CAD: ['C$', '$'],
  NZD: ['NZ$', '$'], SGD: ['S$', '$'], ZAR: ['R'],
});
const ALL_SIGNS = /^(?:US\$|A\$|C\$|NZ\$|S\$|Rs\.?|[\u20b9$\u20ac\u00a3\u00a5])/;
const ISO = new Set(Intl.supportedValuesOf('currency'));

/** Takes the currency mark off the front: its own code or sign passes; another currency's mark is refused, not converted. */
function stripMark(text: string, currency: string): { text: string; foreign: boolean } {
  const code = /^([A-Z]{3})(?![A-Za-z])\s*/.exec(text);
  if (code && ISO.has(code[1])) return code[1] === currency ? { text: text.slice(code[0].length), foreign: false } : { text, foreign: true };
  for (const sign of SIGNS[currency] ?? []) if (text.startsWith(sign)) return { text: text.slice(sign.length).trimStart(), foreign: false };
  return { text, foreign: ALL_SIGNS.test(text) };
}

/**
 * A cell as money in the currency's minor units. Empty cells are null. Accepts thousands commas (Indian and Western
 * grouping), the business's own currency code or sign in front, a minus, brackets for a negative, and Dr or Cr after
 * (Cr is negative, as in a bank's running balance). Refuses another currency's mark (an amount in dollars is never
 * read as rupees), words, exponents and more decimals than the currency has.
 */
export function parseMoneyCell(raw: string, currency: string): MoneyCell {
  let text = raw.trim();
  if (!text || text === '-') return { ok: true, minor: null };
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  const suffix = /\s*\b(Dr|Cr)\.?$/i.exec(text);
  if (suffix) { if (/^cr/i.test(suffix[1])) negative = !negative; text = text.slice(0, suffix.index).trim(); }
  if (text.startsWith('-')) { negative = !negative; text = text.slice(1).trim(); }
  const marked = stripMark(text, currency);
  if (marked.foreign) return { ok: false, why: 'is in another currency' };
  text = marked.text;
  if (text.startsWith('-')) { negative = !negative; text = text.slice(1).trim(); }
  if (!/^(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?$/.test(text)) return { ok: false, why: 'is not an amount' };
  const plain = text.replace(/,/g, '');
  try {
    const minor = BigInt(decimalMinor(plain, currency));
    return { ok: true, minor: String(negative ? -minor : minor) };
  } catch {
    return { ok: false, why: 'has more decimals than the currency allows' };
  }
}

/**
 * True when a value reads as an amount in any currency: a number with or without a currency code or sign in front or
 * behind ("INR4500", "$12", "4,500.00 Cr", "12 USD"). Agent-written code may never make such a value.
 */
export function looksLikeAmount(value: string): boolean {
  let text = value.trim();
  if (/^\(.*\)$/.test(text)) text = text.slice(1, -1).trim();
  text = text.replace(/\s*\b(?:Dr|Cr)\.?$/i, '').replace(/^-\s*/, '');
  const lead = /^([A-Z]{3})(?![A-Za-z])\s*/.exec(text);
  if (lead && ISO.has(lead[1])) text = text.slice(lead[0].length);
  else text = text.replace(ALL_SIGNS, '').trimStart();
  const trail = /\s*([A-Z]{3})$/.exec(text);
  if (trail && ISO.has(trail[1])) text = text.slice(0, trail.index);
  text = text.replace(/^-\s*/, '').trim();
  return /^(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?$/.test(text);
}

/** A short run of digits as a whole number (dates, ids). Never used for money. */
const int = (text: string | undefined) => parseInt(text ?? '', 10);

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(year: number, month: number, day: number): IsoDate | null {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return validDate(value) ? value : null;
}

/**
 * A cell as a calendar date. Accepts 2026-09-14, 14/09/2026 and 14-09-2026 (read in the country's date order),
 * 14 Sep 2026 and Sep 14, 2026. A two-digit year is refused, never guessed.
 */
export function parseDateCell(raw: string, order: DateOrder): IsoDate | null {
  const text = raw.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (match) return iso(int(match[1]), int(match[2]), int(match[3]));
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (match) {
    const [a, b, year] = [int(match[1]), int(match[2]), int(match[3])];
    return order === 'month-day-year' ? iso(year, a, b) : iso(year, b, a);
  }
  match = /^(\d{1,2})[\s-]([A-Za-z]{3,4})[a-z]*[\s-,]+(\d{4})$/.exec(text);
  if (match && MONTHS[match[2].toLowerCase()]) return iso(int(match[3]), MONTHS[match[2].toLowerCase()], int(match[1]));
  match = /^([A-Za-z]{3,4})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (match && MONTHS[match[1].toLowerCase()]) return iso(int(match[3]), MONTHS[match[1].toLowerCase()], int(match[2]));
  return null;
}

/**
 * Raw CSV rows (RFC 4180 quoting, CRLF or LF). Unlike the import parser it keeps the header row as data, so a
 * client file with blank or repeated headers can still be read; the caller names the columns.
 */
export { csvRows } from '../../../csv.ts';

/** Amount-like tokens in free text (a PDF page), each with its line, for the agent to choose from by id. */
export function amountCandidates(text: string, currency: string): { text: string; line: string; minor: MinorString }[] {
  const found: { text: string; line: string; minor: MinorString }[] = [];
  // A currency mark and any number, or a number with thousands commas or two decimals. Bare whole numbers (dates,
  // invoice numbers, phone numbers) are left out.
  const pattern = /(?:\b(?:INR|USD|EUR|GBP|AUD|CAD|SGD|AED|NZD|ZAR|JPY|Rs\.?)|\u20b9|\$|\u20ac|\u00a3)\s*\d[\d,]*(?:\.\d{1,4})?(?![\d.])|(?<![\d.,])(?:\d{1,3}(?:,\d{2,3})+(?:\.\d{1,4})?|\d+\.\d{2})(?![\d.])/g;
  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(pattern)) {
      const parsed = parseMoneyCell(match[0], currency);
      if (parsed.ok && parsed.minor !== null) found.push({ text: match[0].trim(), line: line.trim().slice(0, 160), minor: parsed.minor });
    }
  }
  return found;
}

/** Date-like tokens in free text, read in the country's date order. */
export function dateCandidates(text: string, order: DateOrder): { text: string; line: string; iso: IsoDate }[] {
  const found: { text: string; line: string; iso: IsoDate }[] = [];
  const pattern = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{1,2}[\s-][A-Za-z]{3,9}[\s-,]+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/g;
  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(pattern)) {
      const value = parseDateCell(match[0], order);
      if (value) found.push({ text: match[0], line: line.trim().slice(0, 160), iso: value });
    }
  }
  return found;
}
