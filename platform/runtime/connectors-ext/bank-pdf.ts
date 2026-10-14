import { ChausarError, check } from '../contracts.ts';
import { parseDateAs, parseMoney } from './values.ts';
import { labelOf, normalizeBalance, PDF_HEADER, readSummary, type SummaryKey } from './recipes/bank.ts';
import type { GridLine } from './tabular.ts';

/**
 * PDF bank statements through the trusted Python helper (`pdf.extract`), then a generic line
 * parser. EXPERIMENTAL: layouts are read by line shape, not by a bank-specific template.
 * The PDF text is data: it only ever becomes cells, never an instruction, label or choice of code.
 */
export type PdfPage = {
  page: number; text: string;
  /** How the text was read: the PDF's own text layer, or OCR of the page image (experimental). Absent means text. */
  source?: 'text' | 'ocr';
  /** OCR only: mean word confidence, whole percent 0-100. */
  confidence?: number;
};
export type PdfHelper = { run(op: 'pdf.extract' | 'pdf.ocr', input: { pdfBase64: string; maxPages?: number; language?: 'eng' }): Promise<{ result: any; receipt: any }> };
export type PdfLineRef = { page: number; line: number };
export type PdfRowsMeta = {
  pages: number; transactions: number; continuations: number; skipped: number;
  /** Lines that matched no shape: listed by position only, never by their text. */
  unparsed: PdfLineRef[]; unparsedCount: number;
  directionStated: number; directionInferred: number; directionUnknown: number;
  /** Row number in `rows` (1-based, header is row 1) to the page and line it came from. */
  lineMap: ({ row: number } & PdfLineRef)[];
  /** Pages whose text was read by OCR (experimental), for the envelope to say so. Empty for text-layer PDFs. */
  ocrPages: number[];
};
/** A refusal that names where in the PDF it happened. The message is a fixed sentence. */
export class PdfStatementError extends ChausarError {
  page: number; line: number | null;
  constructor(code: string, message: string, page: number, line: number | null) { super(code, message); this.page = page; this.line = line; }
}

const MAX_PAGES = 50;
/** Ask the helper for page texts. The helper runs locked on this machine; nothing leaves it. */
export async function extractBankPdf(helper: PdfHelper, pdfBase64: string): Promise<{ pages: PdfPage[]; receipt: unknown }> {
  check(helper && typeof helper.run === 'function', 'PDF_HELPER_REQUIRED', 'Reading a PDF statement needs the trusted PDF helper.');
  check(typeof pdfBase64 === 'string' && pdfBase64.length > 0 && pdfBase64.length <= 5_600_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64), 'INVALID_PDF', 'Provide the PDF statement as base64 text.');
  const response = await helper.run('pdf.extract', { pdfBase64, maxPages: MAX_PAGES });
  const pages = response?.result?.pages;
  check(Array.isArray(pages) && pages.length > 0 && pages.length <= MAX_PAGES, 'PDF_EXTRACT_INVALID', 'The PDF helper returned no readable pages.');
  const out: PdfPage[] = pages.map((item: any, index: number) => {
    check(item && Number.isSafeInteger(item.page) && item.page === index + 1 && typeof item.text === 'string', 'PDF_EXTRACT_INVALID', 'The PDF helper returned pages in an unexpected shape.');
    return { page: item.page, text: item.text };
  });
  return { pages: out, receipt: response.receipt };
}

export const OCR_NOTICE = 'Read by OCR (experimental): characters and amounts on these pages can be misread; review them before relying on the totals.';
export type OcrExtraction = {
  pages: PdfPage[];
  /** Pages read by OCR, ascending. Empty when every page had a text layer and OCR never ran. */
  ocrPages: number[];
  /** Present when ocrPages is not empty. */
  notice: string | null;
  receipts: { extract: unknown; ocr: unknown | null };
};
/**
 * EXPERIMENTAL. Text-layer extraction first; only pages with no text are read again by OCR (`pdf.ocr`).
 * An OCR page below the confidence floor is refused, naming the page. A machine without the OCR
 * reader refuses with OCR_DEPENDENCY_UNAVAILABLE naming the first scanned page. OCR text is data, exactly
 * like extracted text, and still has to pass the statement's own balance checks downstream.
 */
export async function extractBankPdfWithOcr(helper: PdfHelper, pdfBase64: string, options: { minConfidence?: number } = {}): Promise<OcrExtraction> {
  const minConfidence = options?.minConfidence ?? 80;
  check(Number.isSafeInteger(minConfidence) && minConfidence >= 1 && minConfidence <= 100, 'PDF_OCR_OPTIONS_INVALID', 'The OCR confidence floor is a whole percent from 1 to 100.');
  const extracted = await extractBankPdf(helper, pdfBase64);
  const pages: PdfPage[] = extracted.pages.map(page => ({ ...page, source: 'text' }));
  const scanned = pages.filter(page => page.text.trim() === '').map(page => page.page);
  if (!scanned.length) return { pages, ocrPages: [], notice: null, receipts: { extract: extracted.receipt, ocr: null } };
  let response: { result: any; receipt: any };
  try { response = await helper.run('pdf.ocr', { pdfBase64, maxPages: MAX_PAGES, language: 'eng' }); }
  catch (error) {
    if ((error as any)?.code === 'OCR_DEPENDENCY_UNAVAILABLE')
      throw new PdfStatementError('OCR_DEPENDENCY_UNAVAILABLE', 'A page has no text layer, and the experimental OCR reader is not installed on this machine.', scanned[0], null);
    throw error;
  }
  const ocr = response?.result?.pages;
  check(Array.isArray(ocr) && ocr.length === pages.length, 'PDF_OCR_INVALID', 'The OCR reader returned a different number of pages than the PDF has.');
  ocr.forEach((item: any, index: number) => check(item && item.page === index + 1 && typeof item.text === 'string' && Number.isSafeInteger(item.confidence) && item.confidence >= 0 && item.confidence <= 100,
    'PDF_OCR_INVALID', 'The OCR reader returned pages in an unexpected shape.'));
  for (const number of scanned) {
    const read = ocr[number - 1];
    if (read.text.trim() === '' || read.confidence < minConfidence)
      throw new PdfStatementError('PDF_OCR_LOW_CONFIDENCE', 'A scanned page was read by OCR with too little confidence to use. Check the page named with this refusal.', number, null);
    pages[number - 1] = { page: number, text: read.text, source: 'ocr', confidence: read.confidence };
  }
  return { pages, ocrPages: scanned, notice: OCR_NOTICE, receipts: { extract: extracted.receipt, ocr: response.receipt } };
}

const DATE_START = [/^(\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2}))(?=\s|$)/, /^(\d{1,2}[ -][A-Za-z]{3,9}[ ,-]+(?:\d{4}|\d{2}))(?=\s|$)/];
const startDate = (text: string): string | null => { for (const re of DATE_START) { const m = re.exec(text); if (m) return m[1]; } return null; };
const validDate = (text: string) => parseDateAs(text, 'DMY') !== null || parseDateAs(text, 'DMY-MON') !== null;
const isDateToken = (token: string) => /^\d{1,2}[/.-]\d{1,2}[/.-](?:\d{4}|\d{2})$/.test(token) && validDate(token);
type MoneyToken = { text: string; suffix: 'Cr' | 'Dr' | null };
/** A money token has exactly two decimals; reference numbers without decimals never qualify. */
function moneyToken(token: string): MoneyToken | null {
  const m = /^(-?(?:₹|Rs\.?|INR)?[\d,]*\d\.\d{2})(?:\(?(Cr|Dr)\.?\)?)?$/i.exec(token);
  if (!m) return null;
  try { if (parseMoney(m[1], 'major', 'INR') === null) return null; } catch { return null; }
  return { text: m[1], suffix: m[2] ? (m[2].toLowerCase() === 'cr' ? 'Cr' : 'Dr') : null };
}
/** Split into tokens, folding a separate "Cr"/"Dr" word onto the money token before it. */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const token of text.split(' ').filter(Boolean)) {
    if (/^\(?(?:Cr|Dr)\.?\)?$/i.test(token) && out.length && moneyToken(out.at(-1)!)) out[out.length - 1] += token.replace(/[().]/g, '');
    else out.push(token);
  }
  return out;
}
const endsWithMoney = (text: string, count: number) => { const list = tokens(text); return list.length >= count && list.slice(-count).every(token => moneyToken(token) !== null); };
/** Longest-first split of a line into fixed labels; null when any part is not a label. */
function splitLabels(list: string[]): string[] | null {
  const out: string[] = []; let i = 0;
  while (i < list.length) {
    let found = 0;
    for (let j = Math.min(list.length, i + 6); j > i; j--) if (labelOf(list.slice(i, j).join(' ')) !== null) { found = j; break; }
    if (!found) return null;
    out.push(list.slice(i, found).join(' ')); i = found;
  }
  return out;
}
const HEADING_WORDS = new Set(['date', 'narration', 'description', 'particulars', 'remarks', 'withdrawal', 'withdrawals', 'deposit', 'deposits', 'debit', 'credit',
  'balance', 'chq', 'cheque', 'ref', 'no', 'value', 'dt', 'amount', 'amt', 'dr', 'cr', 'txn', 'transaction', 'tran', 'closing', 'sl', 'details', 'inr', 'number']);
const isHeading = (list: string[]) => list.filter(token => HEADING_WORDS.has(token.toLowerCase().replace(/[^a-z]/g, ''))).length >= 3 && !list.some(token => moneyToken(token));
const PAGE_LINE = /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s*(?:of|\/)\s*\d+|-\s*\d+\s*-)$/i;
const FOOTER_LINE = /computer generated|end of (?:the )?statement|does not require (?:a )?signature/i;

type Txn = { kind: 'txn'; ref: PdfLineRef; date: string; valueDate: string; narration: string; amount: MoneyToken; balance: MoneyToken };
type Item = Txn | { kind: 'cells'; ref: PdfLineRef; cells: string[] };

/**
 * Turn extracted statement text into table rows for the 'bank.pdf-text' recipe.
 * A transaction line starts with a date and ends with one or two money tokens then the balance;
 * narration lies between. Lines without a leading date continue the previous narration on the
 * same page. Headings, page numbers and fixed footer sentences are skipped. Anything else is
 * listed as unparsed; if an unparsed line looks like a transaction the statement is refused.
 */
export function pdfTextToRows(pages: readonly PdfPage[]): { rows: string[][]; meta: PdfRowsMeta } {
  check(Array.isArray(pages) && pages.length > 0 && pages.length <= MAX_PAGES, 'PDF_PAGES_REQUIRED', 'Provide the page texts of the PDF statement.');
  const meta: PdfRowsMeta = { pages: pages.length, transactions: 0, continuations: 0, skipped: 0, unparsed: [], unparsedCount: 0, directionStated: 0, directionInferred: 0, directionUnknown: 0, lineMap: [], ocrPages: [] };
  const items: Item[] = []; const suspicious: PdfLineRef[] = [];
  for (const page of pages) {
    check(page && Number.isSafeInteger(page.page) && page.page > 0 && typeof page.text === 'string', 'PDF_PAGES_REQUIRED', 'Provide the page texts of the PDF statement.');
    if (page.text.trim() === '') throw new PdfStatementError('PDF_SCANNED_PAGE', 'A page has no text layer. Scanned pages are read only through the experimental OCR reader.', page.page, null);
    if (page.source === 'ocr') meta.ocrPages.push(page.page);
    const lines: string[] = page.text.split(/\r\n|\r|\n/);
    let pendingSummary: { labels: string[]; ref: PdfLineRef } | null = null;
    lines.forEach((raw: string, index: number) => {
      const ref = { page: page.page, line: index + 1 };
      const text = raw.normalize('NFKC').replace(/[\s ]+/g, ' ').trim();
      if (!text) return;
      const list = tokens(text);
      const unparsed = () => { meta.unparsed.push(ref); if (startDate(text) !== null || endsWithMoney(text, 2)) suspicious.push(ref); };
      if (pendingSummary) {
        const values = list.every(token => moneyToken(token) || /^\d{1,6}$/.test(token)) ? list : null;
        const head = pendingSummary; pendingSummary = null;
        if (values && values.length === head.labels.length) { items.push({ kind: 'cells', ref: head.ref, cells: ['', ...head.labels] }, { kind: 'cells', ref, cells: ['', ...values] }); return; }
        meta.unparsed.push(head.ref);
      }
      const date = startDate(text);
      if (date !== null) {
        const parsed = date && validDate(date) ? transaction(date, list.slice(date.split(' ').length), ref) : null;
        if (parsed) { items.push(parsed); meta.transactions++; } else unparsed();
        return;
      }
      const labels = splitLabels(list);
      if (labels && labels.length >= 2 && labels.every(label => !['total', 'marker'].includes(labelOf(label)!))) { pendingSummary = { labels, ref }; return; }
      if (labels && labels.length === 1 && labelOf(labels[0]) === 'marker') { items.push({ kind: 'cells', ref, cells: ['', labels[0]] }); return; }
      const valueAt = list.findIndex(token => moneyToken(token));
      if (valueAt > 0 && valueAt === list.length - 1) {
        const label = list.slice(0, valueAt).join(' ').replace(/[\s:-]+$/, ''); const key: SummaryKey | null = labelOf(label);
        if (key === 'opening' || key === 'closing') { items.push({ kind: 'cells', ref, cells: ['', label, list[valueAt]] }); return; }
      }
      if (PAGE_LINE.test(text) || FOOTER_LINE.test(text) || isHeading(list)) { meta.skipped++; return; }
      const last = items.at(-1);
      if (last?.kind === 'txn' && last.ref.page === page.page && !endsWithMoney(text, 1)) { last.narration = `${last.narration} ${text}`.trim(); meta.continuations++; return; }
      unparsed();
    });
    if (pendingSummary) meta.unparsed.push((pendingSummary as { ref: PdfLineRef }).ref);
  }
  meta.unparsed.sort((a, b) => a.page - b.page || a.line - b.line); meta.unparsedCount = meta.unparsed.length;
  if (suspicious.length) { const first = suspicious[0]; throw new PdfStatementError('PDF_LINE_UNREADABLE', 'A line that starts like a transaction could not be read. Check the page and line named with this refusal.', first.page, first.line); }
  // Direction: a stated Cr/Dr wins; otherwise only the change in the running balance decides.
  const summaryLines: GridLine[] = items.filter(item => item.kind === 'cells').map((item, i) => ({ line: i + 1, cells: (item as { cells: string[] }).cells }));
  // A conflicting summary is refused by the bank decoder; here it only leaves the opening unknown.
  let opening: string | null = null;
  try { opening = readSummary(summaryLines).opening; } catch { opening = null; }
  let previous: bigint | null = opening === null ? null : BigInt(parseMoney(opening, 'major', 'INR')!);
  const rows: string[][] = [[...PDF_HEADER]];
  for (const item of items) {
    if (item.kind === 'cells') { rows.push(item.cells); meta.lineMap.push({ row: rows.length, ...item.ref }); continue; }
    const balanceText = normalizeBalance(item.balance.text, item.balance.suffix ?? '');
    const balance = BigInt(parseMoney(balanceText, 'major', 'INR')!);
    let direction = '';
    if (item.amount.suffix) { direction = item.amount.suffix; meta.directionStated++; }
    else if (previous !== null && balance !== previous) { direction = balance > previous ? 'Cr' : 'Dr'; meta.directionInferred++; }
    else meta.directionUnknown++;
    previous = balance;
    rows.push([item.date, item.valueDate, item.narration, item.amount.text, direction, balanceText, String(item.ref.page), String(item.ref.line)]);
    meta.lineMap.push({ row: rows.length, ...item.ref });
  }
  return { rows, meta };
}

function transaction(date: string, rest: string[], ref: PdfLineRef): Txn | null {
  const list = [...rest];
  const balance = moneyToken(list.at(-1) ?? ''); if (!balance) return null; list.pop();
  const first = moneyToken(list.at(-1) ?? ''); if (!first) return null; list.pop();
  let amount = first;
  const second = moneyToken(list.at(-1) ?? '');
  if (second) {
    // Two money tokens: withdrawal and deposit columns. Exactly one may be nonzero.
    list.pop();
    const zero = (token: MoneyToken) => BigInt(parseMoney(token.text, 'major', 'INR')!) === 0n;
    if (zero(first) === zero(second)) return null;
    amount = zero(first) ? second : first;
  }
  let valueDate = '';
  if (list.length && isDateToken(list[0])) valueDate = list.shift()!;
  if (list.length && isDateToken(list.at(-1)!)) { const last = list.pop()!; valueDate = valueDate || last; }
  return { kind: 'txn', ref, date, valueDate, narration: list.join(' '), amount, balance };
}
