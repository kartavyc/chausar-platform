import { check } from '../contracts.ts';
import { gstinValid, validatePeriod, validDate } from '../memory.ts';

/**
 * Purchase register against GSTR-2B. A pure function: no state, no learning, no fuzzy text.
 *
 * Exact match key: supplier GSTIN (uppercase) + invoice number (trimmed, uppercase) + financial year
 * of the invoice date (1 April to 31 March). Every line lands in exactly one list.
 *
 * Probable matches are only suggestions and are never counted as matched. A pair is probable when
 * both lines have the same GSTIN, neither matched exactly, each is the other's only candidate, and
 *   (a) the invoice numbers are equal after normalisation (uppercase; leading zeros of each number part
 *       removed; spaces, '/' and '-' removed) in the same financial year, or
 *   (b) the invoice numbers are exactly equal, the financial years differ, and the invoice dates fall in
 *       the same or adjacent calendar months (a date entered on the wrong side of 1 April).
 */
export type MatchLine = { entityId: string; supplierGstin: string; invoiceNumber: string; invoiceDate: string; taxableMinor: string; taxMinor: string | null; sourceRow?: number };
export type GstMode = 'regular' | 'composition' | 'unregistered';
export type LineReceipt = { entityId: string; sourceRow: number | null };
export type PairReceipt = { register: LineReceipt; gstr2b: LineReceipt };
export type MatchedPair = { supplierGstin: string; invoiceNumber: string; financialYear: string; taxableMinor: string; taxMinor: string | null; taxCompared: boolean; receipt: PairReceipt };
export type AmountMismatch = {
  supplierGstin: string; invoiceNumber: string; financialYear: string;
  register: { taxableMinor: string; taxMinor: string | null }; gstr2b: { taxableMinor: string; taxMinor: string | null };
  /** GSTR-2B minus register. Tax difference is null when either side's tax is unknown. */
  difference: { taxableMinor: string; taxMinor: string | null };
  receipt: PairReceipt;
};
export type OneSided = { side: 'register' | 'gstr2b'; supplierGstin: string; invoiceNumber: string; invoiceDate: string; taxableMinor: string; taxMinor: string | null; receipt: LineReceipt };
export type ProbableMatch = { rule: 'normalised-number' | 'financial-year-boundary'; supplierGstin: string; register: OneSided; gstr2b: OneSided; receipt: PairReceipt };
export type InvalidLine = { side: 'register' | 'gstr2b'; reason: 'invalid-gstin' | 'duplicate-invoice'; receipt: LineReceipt };
export type MatchResult =
  | { mode: 'not-applicable'; reason: string }
  | {
    mode: 'matched';
    matched: MatchedPair[]; amountMismatch: AmountMismatch[]; inBooksOnly: OneSided[]; in2bOnly: OneSided[]; probable: ProbableMatch[]; invalid: InvalidLine[];
    counts: { register: number; gstr2b: number; outsidePeriod: number; matched: number; amountMismatch: number; inBooksOnly: number; in2bOnly: number; probable: number; invalid: number };
    /** Tax on invoices in the books but not in GSTR-2B: credit at risk. Lines with unknown tax are counted, never added as zero. */
    creditAtRisk: { taxMinor: string; linesWithUnknownTax: number };
    notices: string[];
  };

export const NOT_APPLICABLE: Readonly<Record<'composition' | 'unregistered', string>> = Object.freeze({
  composition: 'A composition taxpayer cannot claim input tax credit, so the purchase register is not matched with GSTR-2B.',
  unregistered: 'An unregistered business has no GSTR-2B, so there is nothing to match the purchase register with.',
});

export function financialYear(date: string): string {
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export const exactNumber = (value: string): string => value.trim().toUpperCase();
/** Documented normalisation for probable matches only: uppercase, drop leading zeros of each number part, then strip spaces, '/' and '-'. */
export const normalisedNumber = (value: string): string => exactNumber(value).replace(/(^|[^0-9])0+(?=[0-9])/g, '$1').replace(/[\s/-]+/g, '');
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

type Line = MatchLine & { side: 'register' | 'gstr2b'; gstin: string; fy: string; key: string };
const receiptOf = (line: MatchLine): LineReceipt => ({ entityId: line.entityId, sourceRow: line.sourceRow ?? null });
const oneSided = (line: Line): OneSided => ({ side: line.side, supplierGstin: line.gstin, invoiceNumber: line.invoiceNumber, invoiceDate: line.invoiceDate, taxableMinor: line.taxableMinor, taxMinor: line.taxMinor, receipt: receiptOf(line) });

function validLine(line: MatchLine) {
  check(line && typeof line === 'object' && typeof line.entityId === 'string' && line.entityId.length > 0 && typeof line.supplierGstin === 'string'
    && typeof line.invoiceNumber === 'string' && line.invoiceNumber.trim().length > 0 && validDate(line.invoiceDate)
    && typeof line.taxableMinor === 'string' && /^-?\d{1,20}$/.test(line.taxableMinor)
    && (line.taxMinor === null || (typeof line.taxMinor === 'string' && /^-?\d{1,20}$/.test(line.taxMinor)))
    && (line.sourceRow === undefined || Number.isSafeInteger(line.sourceRow)), 'INVALID_MATCH_LINE', 'Each line needs an entity, GSTIN, invoice number, ISO date and whole-paise amounts.');
}

export function matchPurchaseRegister(input: { register: MatchLine[]; gstr2b: MatchLine[]; gstMode: GstMode; period?: { from: string; to: string } }): MatchResult {
  check(input && ['regular', 'composition', 'unregistered'].includes(input.gstMode), 'INVALID_GST_MODE', 'State whether the business is regular, composition or unregistered.');
  if (input.gstMode !== 'regular') return { mode: 'not-applicable', reason: NOT_APPLICABLE[input.gstMode] };
  check(Array.isArray(input.register) && Array.isArray(input.gstr2b) && input.register.length + input.gstr2b.length <= 200_000, 'INVALID_MATCH_INPUT', 'Give the purchase register and GSTR-2B as lists of lines.');
  validatePeriod(input.period);
  const invalid: InvalidLine[] = []; let outsidePeriod = 0;
  const prepare = (lines: MatchLine[], side: Line['side']): Map<string, Line> => {
    const bucket = new Map<string, Line[]>();
    for (const line of lines) {
      validLine(line);
      if (input.period && (line.invoiceDate < input.period.from || line.invoiceDate > input.period.to)) { outsidePeriod++; continue; }
      const gstin = line.supplierGstin.trim().toUpperCase();
      if (!gstinValid(gstin)) { invalid.push({ side, reason: 'invalid-gstin', receipt: receiptOf(line) }); continue; }
      const fy = financialYear(line.invoiceDate), key = `${gstin}|${exactNumber(line.invoiceNumber)}|${fy}`;
      const group = bucket.get(key); if (group) group.push({ ...line, side, gstin, fy, key }); else bucket.set(key, [{ ...line, side, gstin, fy, key }]);
    }
    const out = new Map<string, Line>();
    for (const [key, group] of bucket) {
      // Two lines with one key on the same side cannot be told apart; none of them is matched.
      if (group.length > 1) group.forEach(line => invalid.push({ side, reason: 'duplicate-invoice', receipt: receiptOf(line) }));
      else out.set(key, group[0]);
    }
    return out;
  };
  const books = prepare(input.register, 'register'), twoB = prepare(input.gstr2b, 'gstr2b');
  const matched: MatchedPair[] = [], amountMismatch: AmountMismatch[] = [];
  const leftBooks: Line[] = [], leftTwoB = new Map(twoB);
  for (const [key, line] of books) {
    const other = twoB.get(key);
    if (!other) { leftBooks.push(line); continue; }
    leftTwoB.delete(key);
    const receipt = { register: receiptOf(line), gstr2b: receiptOf(other) };
    const taxCompared = line.taxMinor !== null && other.taxMinor !== null;
    if (line.taxableMinor === other.taxableMinor && (!taxCompared || line.taxMinor === other.taxMinor)) {
      matched.push({ supplierGstin: line.gstin, invoiceNumber: exactNumber(line.invoiceNumber), financialYear: line.fy, taxableMinor: line.taxableMinor, taxMinor: taxCompared ? line.taxMinor : (line.taxMinor ?? other.taxMinor), taxCompared, receipt });
    } else {
      amountMismatch.push({ supplierGstin: line.gstin, invoiceNumber: exactNumber(line.invoiceNumber), financialYear: line.fy,
        register: { taxableMinor: line.taxableMinor, taxMinor: line.taxMinor }, gstr2b: { taxableMinor: other.taxableMinor, taxMinor: other.taxMinor },
        difference: { taxableMinor: String(BigInt(other.taxableMinor) - BigInt(line.taxableMinor)), taxMinor: taxCompared ? String(BigInt(other.taxMinor!) - BigInt(line.taxMinor!)) : null },
        receipt });
    }
  }
  // Probable pairs: one-to-one candidates only. Anything with two candidates stays one-sided.
  const remaining2b = [...leftTwoB.values()];
  const probableRule = (a: Line, b: Line): ProbableMatch['rule'] | null => {
    if (a.gstin !== b.gstin) return null;
    if (a.fy === b.fy && normalisedNumber(a.invoiceNumber) === normalisedNumber(b.invoiceNumber)) return 'normalised-number';
    if (a.fy !== b.fy && exactNumber(a.invoiceNumber) === exactNumber(b.invoiceNumber) && Math.abs(monthIndex(a.invoiceDate) - monthIndex(b.invoiceDate)) <= 1) return 'financial-year-boundary';
    return null;
  };
  // Probable rules need the same GSTIN, so pairs are only sought within one supplier's lines.
  const bySupplier = <T extends Line>(lines: T[]) => { const map = new Map<string, T[]>(); for (const line of lines) { const group = map.get(line.gstin); if (group) group.push(line); else map.set(line.gstin, [line]); } return map; };
  const twoBBySupplier = bySupplier(remaining2b), booksBySupplier = bySupplier(leftBooks);
  const candidates = leftBooks.map(a => (twoBBySupplier.get(a.gstin) ?? []).filter(b => probableRule(a, b) !== null));
  const probable: ProbableMatch[] = []; const paired = new Set<Line>();
  leftBooks.forEach((a, i) => {
    if (candidates[i].length !== 1) return;
    const b = candidates[i][0];
    if ((booksBySupplier.get(b.gstin) ?? []).filter(other => probableRule(other, b) !== null).length !== 1) return;
    probable.push({ rule: probableRule(a, b)!, supplierGstin: a.gstin, register: oneSided(a), gstr2b: oneSided(b), receipt: { register: receiptOf(a), gstr2b: receiptOf(b) } });
    paired.add(a); paired.add(b);
  });
  const inBooksOnly = leftBooks.filter(line => !paired.has(line)).map(oneSided);
  const in2bOnly = remaining2b.filter(line => !paired.has(line)).map(oneSided);
  let atRisk = 0n, unknown = 0;
  for (const line of inBooksOnly) { if (line.taxMinor === null) unknown++; else atRisk += BigInt(line.taxMinor); }
  return {
    mode: 'matched', matched, amountMismatch, inBooksOnly, in2bOnly, probable, invalid,
    counts: { register: input.register.length, gstr2b: input.gstr2b.length, outsidePeriod, matched: matched.length, amountMismatch: amountMismatch.length,
      inBooksOnly: inBooksOnly.length, in2bOnly: in2bOnly.length, probable: probable.length, invalid: invalid.length },
    creditAtRisk: { taxMinor: String(atRisk), linesWithUnknownTax: unknown },
    notices: [
      'Matched means the same supplier GSTIN, invoice number and financial year, with equal taxable value and equal tax where both sides state tax.',
      'In the books only: GSTR-2B does not show the invoice, so its input tax credit is at risk until the supplier reports it.',
      'In GSTR-2B only: the supplier reported an invoice that the purchase register does not have.',
      'Probable matches are suggestions for a person to confirm. They are never counted as matched.',
      'Lines with an invalid GSTIN, or two lines with the same invoice on one side, are set aside and never matched.',
    ],
  };
}
