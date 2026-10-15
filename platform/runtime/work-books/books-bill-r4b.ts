/**
 * Bill photo, round 4 (WK-13/BK-18): word boxes from the local reader, on every page.
 *
 * The helper's `pdf.ocr` is asked for `words: true` (an additive option): each page then
 * carries its image size in pixels and every word's box, with the 1-based line of the page
 * text it belongs to. A field read from a line is outlined by the boxes of the words that make
 * it (an amount by the last word with a digit; anything else by the words its value contains,
 * else the whole line), not by the line's band. Boxes are per mille of the page (0..1000), so a
 * screen draws them at any size. Every page read gets its own outline of all its words.
 * A reader that sends no boxes (an older helper) leaves `box` out and `outline` empty: the
 * screen then draws the line's band as before.
 */
import type { BillField, BillProposal } from './books-bill-parse.ts';

export type Box = { x: number; y: number; w: number; h: number };
export type OcrWord = { text: string; line: number; left: number; top: number; width: number; height: number };
export type WordsPage = { page: number; width: number; height: number; words: OcrWord[]; omitted: number };
export type Outline = { page: number; width: number; height: number; boxes: Box[]; omitted: number };

const int = (v: unknown, max = 100000): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const WORDS_KEPT = 1500;

/** Word boxes per page from the helper's reply, or null when the reader sent none or sent them in another shape. */
export function wordsOf(result: unknown): WordsPage[] | null {
  const pages = (result as { pages?: unknown })?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return null;
  const out: WordsPage[] = [];
  for (const p of pages as Record<string, unknown>[]) {
    if (!p || !Array.isArray(p.words) || !int(p.page, 50) || !int(p.width) || !int(p.height) || (p.width as number) === 0 || (p.height as number) === 0) return null;
    const words: OcrWord[] = [];
    for (const w of (p.words as Record<string, unknown>[]).slice(0, WORDS_KEPT)) {
      if (!w || typeof w.text !== 'string' || w.text.length > 100 || !int(w.line) || (w.line as number) < 1 || !int(w.left) || !int(w.top) || !int(w.width) || !int(w.height)) return null;
      words.push({ text: w.text, line: w.line as number, left: w.left as number, top: w.top as number, width: w.width as number, height: w.height as number });
    }
    out.push({ page: p.page as number, width: p.width as number, height: p.height as number, words, omitted: (int(p.wordsOmitted) ? p.wordsOmitted as number : 0) + Math.max(0, (p.words as unknown[]).length - WORDS_KEPT) });
  }
  return out;
}

const mille = (value: number, of: number) => Math.max(0, Math.min(1000, Math.round(value * 1000 / of)));
function boxOf(words: readonly OcrWord[], page: WordsPage): Box | null {
  if (words.length === 0) return null;
  const left = Math.min(...words.map(w => w.left)), top = Math.min(...words.map(w => w.top));
  const right = Math.max(...words.map(w => w.left + w.width)), bottom = Math.max(...words.map(w => w.top + w.height));
  const x = mille(left, page.width), y = mille(top, page.height);
  return { x, y, w: Math.max(1, mille(right, page.width) - x), h: Math.max(1, mille(bottom, page.height) - y) };
}
const plainWord = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The words a field was read from: an amount's last word with a digit; otherwise the line's words its value contains. */
function fieldWords(field: BillField, line: readonly OcrWord[], amount: boolean): OcrWord[] {
  if (amount) { const last = [...line].reverse().find(w => /\d/.test(w.text)); return last ? [last] : [...line]; }
  // A word belongs to the value when its letters and digits are a whole token of the value, or (two or more of them) part of it: "SPM-0042" in "SPM-0042".
  const value = field.value === null ? '' : field.value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ' ');
  const tokens = new Set(value.split(/\s+/).filter(Boolean)), joined = value.replace(/\s+/g, '');
  const digits = field.value !== null && /^\d{4}-\d{2}-\d{2}$/.test(field.value) ? line.filter(w => /\d/.test(w.text)) : [];
  const hit = line.filter(w => { const p = plainWord(w.text); return p.length > 0 && (tokens.has(p) || (p.length >= 2 && joined.includes(p))); });
  return hit.length > 0 ? hit : digits.length > 0 ? digits : [...line];
}

function withBox(field: BillField, pages: readonly WordsPage[], amount: boolean): BillField {
  const region = field.region; if (!region) return field;
  const page = pages.find(p => p.page === region.page); if (!page) return field;
  const box = boxOf(fieldWords(field, page.words.filter(w => w.line === region.line), amount), page);
  return box ? { ...field, region: { ...region, box } } : field;
}

/** The proposal with each field's word box, where the reader sent boxes. */
export function withBoxes(proposal: BillProposal, pages: readonly WordsPage[] | null): BillProposal {
  if (!pages) return proposal;
  const f = (field: BillField, amount = false) => withBox(field, pages, amount);
  return { ...proposal, supplier: f(proposal.supplier), billNumber: f(proposal.billNumber), date: f(proposal.date), total: f(proposal.total, true),
    lines: proposal.lines.map(l => ({ description: f(l.description), quantity: f(l.quantity), amount: f(l.amount, true) })),
    tax: proposal.tax.map(t => ({ name: f(t.name), amount: f(t.amount, true) })) };
}

/** Every page read, each with all its word boxes, so the screen outlines every page, not only the first. */
export function outlineOf(pages: readonly WordsPage[] | null): Outline[] {
  return (pages ?? []).map(p => ({ page: p.page, width: p.width, height: p.height, omitted: p.omitted,
    boxes: p.words.map(w => boxOf([w], p)).filter((b): b is Box => b !== null) }));
}
