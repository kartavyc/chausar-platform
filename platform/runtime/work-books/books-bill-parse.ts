/**
 * Turns the text a local reader found on a bill into a proposed form: supplier, bill number,
 * date, lines, tax and total. Deterministic: fixed patterns over the lines, amounts turned into
 * whole paise by string arithmetic and BigInt, never floats. Each field keeps the place it was
 * read from (page and line) and how sure the reading is. Text on the bill is data: it fills
 * fields and is never followed as an instruction.
 */
export type Certainty = 'sure' | 'check-this' | 'could-not-read';
export type Region = { page: number; line: number; of: number };
export type BillField = { value: string | null; certainty: Certainty; region: Region | null };
export type BillLine = { description: BillField; quantity: BillField; amount: BillField };
export type BillTax = { name: BillField; amount: BillField };
export type Amount = { minor: string } | { missing: 'unknown' };
export type BillProposal = { supplier: BillField; billNumber: BillField; date: BillField; lines: BillLine[]; tax: BillTax[]; total: BillField;
  sums: { linesPlusTax: Amount; total: Amount; equal: boolean | null } };
export type OcrPage = { page: number; text: string; confidence: number };

/** A page whose mean word confidence is under this marks everything read from it "check this". */
export const SURE_CONFIDENCE = 85;
const MAX_TEXT = 200;
const MONEY = String.raw`(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const ENDS_IN_MONEY = new RegExp(String.raw`^(.*?)\s*${MONEY}\s*$`, 'i');
const ITEM_FULL = new RegExp(String.raw`^(.*?[A-Za-z].*?)\s+(\d{1,6})\s*(?:x|×|@)?\s*${MONEY}\s+${MONEY}\s*$`, 'i');
const BILL_NO = /\b(?:bill|invoice|inv)\s*(?:no\.?|number|#)\s*[:.-]?\s*([A-Za-z0-9][A-Za-z0-9/-]{0,39})/i;
const DATE_DMY = /\b(?:bill\s*|invoice\s*)?dated?\s*[:.-]?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/i;
const DATE_ISO = /\b(?:bill\s*|invoice\s*)?dated?\s*[:.-]?\s*(\d{4})-(\d{2})-(\d{2})\b/i;
const SUPPLIER = /^(?:from|supplier|vendor|sold\s*by|seller)\s*[:-]\s*(.+)$/i;
const HEADING = /^(?:tax\s*)?(?:invoice|bill|receipt|cash\s*memo|estimate|original|duplicate)\b[\s.:-]*$/i;
const GRAND = /\b(?:grand\s*total|amount\s*payable|net\s*payable|total\s*payable|bill\s*total|total\s*amount|net\s*amount)\b/i;
const TOTAL = /\btotal\b/i;
const SUBTOTAL = /\bsub\s*-?\s*total\b|\btaxable\s*(?:value|amount)\b/i;
const TAX = /\b(?:cgst|sgst|igst|utgst|cess|gst|vat)\b/i;
const NOT_ITEM = /\b(?:gstin|pan|phone|ph|mob(?:ile)?|tel|pin(?:code)?|a\/c|account|ifsc|upi|round(?:ed)?\s*off|balance|paid|change|discount)\b/i;

const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
/** "1,23,456.7" → "12345670" paise, by string arithmetic. */
export function paiseOf(text: string): string {
  const [whole, fraction = ''] = text.replace(/,/g, '').split('.');
  return String(BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2)));
}
const unread = (): BillField => ({ value: null, certainty: 'could-not-read', region: null });
type Line = { text: string; region: Region; confident: boolean };
const field = (value: string, line: Line, structured: boolean): BillField => ({ value, certainty: structured && line.confident ? 'sure' : 'check-this', region: line.region });

function isoDate(day: number, month: number, year: number): string | null {
  const full = year < 100 ? 2000 + year : year; const iso = `${full}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

export function parseBill(pages: readonly OcrPage[]): BillProposal {
  const lines: Line[] = [];
  for (const page of pages) {
    const texts = page.text.split(/\r?\n/);
    texts.forEach((text, i) => { const value = clean(text); if (value) lines.push({ text: value, region: { page: page.page, line: i + 1, of: texts.length }, confident: page.confidence >= SURE_CONFIDENCE }); });
  }
  let supplier: BillField = unread(), billNumber: BillField = unread(), date: BillField = unread(), total: BillField = unread();
  const used = new Set<Line>();
  for (const line of lines) {
    const named = SUPPLIER.exec(line.text); if (named && supplier.certainty === 'could-not-read') { supplier = field(clean(named[1]), line, true); used.add(line); }
    const number = BILL_NO.exec(line.text); if (number && billNumber.certainty === 'could-not-read') { billNumber = field(number[1], line, true); used.add(line); }
    if (date.certainty === 'could-not-read') {
      const dmy = DATE_DMY.exec(line.text), iso = DATE_ISO.exec(line.text);
      const value = iso ? isoDate(+iso[3], +iso[2], +iso[1]) : dmy ? isoDate(+dmy[1], +dmy[2], +dmy[3]) : null;
      if (value) { date = field(value, line, true); used.add(line); }
      else if (iso || dmy) { date = { value: null, certainty: 'could-not-read', region: line.region }; used.add(line); }
    }
  }
  // The total: the last "grand total"-like line, else the last plain total that is not a subtotal.
  const totals = lines.filter(l => ENDS_IN_MONEY.test(l.text) && !SUBTOTAL.test(l.text));
  const totalLine = totals.filter(l => GRAND.test(l.text)).at(-1) ?? totals.filter(l => TOTAL.test(l.text) && !TAX.test(l.text)).at(-1);
  if (totalLine) { total = field(paiseOf(ENDS_IN_MONEY.exec(totalLine.text)![2]), totalLine, true); used.add(totalLine); }
  const before = (l: Line) => !totalLine || l.region.page < totalLine.region.page || (l.region.page === totalLine.region.page && l.region.line < totalLine.region.line);
  const tax: BillTax[] = []; const items: BillLine[] = [];
  for (const line of lines) {
    if (used.has(line) || !before(line) || SUBTOTAL.test(line.text) || TOTAL.test(line.text)) continue;
    const money = ENDS_IN_MONEY.exec(line.text); if (!money) continue;
    if (TAX.test(line.text) && !/gstin/i.test(line.text)) { tax.push({ name: field(clean(money[1]) || 'Tax', line, true), amount: field(paiseOf(money[2]), line, true) }); continue; }
    if (NOT_ITEM.test(line.text) || !/[A-Za-z]{2}/.test(money[1])) continue;
    const full = ITEM_FULL.exec(line.text);
    if (full) {
      const quantity = BigInt(full[2]), rate = BigInt(paiseOf(full[3])), amount = paiseOf(full[4]);
      // Quantity times rate must give the amount exactly; otherwise the person checks the line.
      const agrees = quantity * rate === BigInt(amount);
      items.push({ description: field(clean(full[1]), line, true), quantity: field(full[2], line, agrees), amount: field(amount, line, agrees) });
    } else items.push({ description: field(clean(money[1]), line, false), quantity: field('1', line, false), amount: field(paiseOf(money[2]), line, false) });
  }
  // Without a labelled supplier, the first plain line of the first page is a guess the person checks.
  if (supplier.certainty === 'could-not-read') {
    const first = lines.find(l => l.region.page === (lines[0]?.region.page ?? 1) && !used.has(l) && !HEADING.test(l.text) && /[A-Za-z]{3}/.test(l.text) && !ENDS_IN_MONEY.test(l.text) && !NOT_ITEM.test(l.text));
    if (first) supplier = field(first.text, first, false);
  }
  if (items.length === 0) items.push({ description: unread(), quantity: unread(), amount: unread() });
  const amounts = [...items.map(i => i.amount.value), ...tax.map(t => t.amount.value)];
  const readable = amounts.every((a): a is string => a !== null);
  const linesPlusTax: Amount = readable ? { minor: String(amounts.reduce((sum, a) => sum + BigInt(a), 0n)) } : { missing: 'unknown' };
  const totalAmount: Amount = total.value !== null ? { minor: total.value } : { missing: 'unknown' };
  return { supplier, billNumber, date, lines: items, tax, total,
    sums: { linesPlusTax, total: totalAmount, equal: 'minor' in linesPlusTax && 'minor' in totalAmount ? BigInt(linesPlusTax.minor) === BigInt(totalAmount.minor) : null } };
}
