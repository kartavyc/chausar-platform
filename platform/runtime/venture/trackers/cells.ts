// C7 task 17: the cells of an owner-made tracker, checked by code. A tracker has no free money column: an amount gets in
// only as a receipt cell (a code figure with its receipt, shown with the receipt's own display) or an estimate cell
// (always labelled "model estimate"). A count column or cell that names a currency or holds money words refuses
// TRACKER_MONEY, and so does a text cell with money words; only an estimate column may hold them.
import { ChausarError, check } from '../../contracts.ts';
import { HOLDS_MONEY } from '../../owner-format.ts';
import type { State } from '../../contracts.ts';
import { findRecord } from '../records.ts';
import { screenUntrusted } from '../policy/untrusted.ts';

export const COLUMN_KINDS = Object.freeze(['text', 'date', 'choice', 'count', 'check', 'person', 'receipt', 'estimate'] as const);
export type ColumnKind = typeof COLUMN_KINDS[number];
export type TrackerColumn = { id: string; name: string; kind: ColumnKind; options?: string[] };
/** A stored cell: plain words, a date, a choice, a whole count, a tick, a person's id, a receipt id, or an estimate's words. */
export type TrackerCell = string | number | boolean | null;
export type CellView = { column: string; value: TrackerCell; display: string; receiptId?: string; label?: 'model estimate' };

export const TRACKER_LIMITS = Object.freeze({ trackers: 20, columns: 12, rows: 1000, name: 60, column: 40, options: 20, option: 40, text: 400 });
export const TRACKER_WORDS = Object.freeze({
  money: 'A tracker keeps no money of its own. Put an amount in a receipt column (from a receipt) or an estimate column (marked model estimate).',
  receipt: 'Choose a receipt from this business.',
  estimate: 'model estimate' as const,
});

const CURRENCY_WORDS = /\b(?:rupees?|rs\.?|inr|usd|dollars?|euros?|lakhs?|crores?|paise)\b/i;
/** Words that make a count about money: a count column or cell never holds a fee, a price or a cost. */
const MONEY_NOUNS = /\b(?:fees?|prices?|costs?|amounts?|salary|salaries|rent|earnings?|revenue|income)\b/i;
/** Whether words state an amount of money: a currency sign or code before a figure, or a currency word with a figure. */
export function statesMoney(text: string): boolean {
  return HOLDS_MONEY.test(text) || (CURRENCY_WORDS.test(text) && /\d/.test(text));
}
/** Whether a count column's name or a count cell is about money. */
const countsMoney = (text: string): boolean => statesMoney(text) || MONEY_NOUNS.test(text);
const money = () => new ChausarError('TRACKER_MONEY', TRACKER_WORDS.money);
const invalid = (message: string) => new ChausarError('INVALID_VENTURE_REQUEST', message);

/** Outside or model words, through the untrusted screen; words aimed at the AI are held (null). */
function screened(text: string): string | null {
  return screenUntrusted({ source: 'client-file', text }, { mode: 'enforce', released: [] }).text;
}

/** One cell, checked against its column. Answers the value to store. */
export function checkCell(state: State, ventureId: string, column: TrackerColumn, raw: unknown): TrackerCell {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (column.kind) {
    case 'text': case 'estimate': {
      check(typeof raw === 'string' && raw.length <= TRACKER_LIMITS.text, 'INVALID_VENTURE_REQUEST', `Keep "${column.name}" to ${TRACKER_LIMITS.text} characters.`);
      const words = raw.trim().replace(/\s+/g, ' ');
      if (column.kind === 'text' && statesMoney(words)) throw money();
      const clean = screened(words);
      check(clean !== null, 'TRACKER_WORDS_HELD', 'Those words were held: they read like instructions to an AI.');
      return clean;
    }
    case 'date':
      check(typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(`${raw}T00:00:00Z`)), 'INVALID_VENTURE_REQUEST', `Give "${column.name}" as a date.`);
      return raw;
    case 'choice':
      check(typeof raw === 'string' && (column.options ?? []).includes(raw), 'INVALID_VENTURE_REQUEST', `Choose one of the options for "${column.name}".`);
      return raw;
    case 'count': {
      if (typeof raw === 'string' && countsMoney(raw)) throw money();
      const value = typeof raw === 'string' && /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
      check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'INVALID_VENTURE_REQUEST', `Give "${column.name}" as a whole number.`);
      return value;
    }
    case 'check':
      check(typeof raw === 'boolean', 'INVALID_VENTURE_REQUEST', `Tick "${column.name}" or leave it.`);
      return raw;
    case 'person': {
      check(typeof raw === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw), 'INVALID_VENTURE_REQUEST', `Choose a person for "${column.name}".`);
      const person = findRecord(state, 'venture-client', raw) ?? findRecord(state, 'venture-person', raw);
      check(person && person.ventureId === ventureId, 'INVALID_VENTURE_REQUEST', `Choose a person from this business for "${column.name}".`);
      return raw;
    }
    case 'receipt': {
      check(typeof raw === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw), 'INVALID_VENTURE_REQUEST', TRACKER_WORDS.receipt);
      check(receiptDisplay(state, ventureId, raw) !== null, 'INVALID_VENTURE_REQUEST', TRACKER_WORDS.receipt);
      return raw;
    }
  }
}

/** A receipt of this business and its code figure, as the receipt itself shows it; null for any other id. */
export function receiptDisplay(state: State, ventureId: string, id: string): string | null {
  const sum = findRecord(state, 'venture-sum-receipt', id);
  if (sum && sum.ventureId === ventureId) return sum.figures[0]?.display ?? null;
  const price = findRecord(state, 'venture-price-receipt', id);
  if (price && price.ventureId === ventureId) return price.figures.find(item => item.key === 'total')?.display ?? price.figures[0]?.display ?? null;
  const work = findRecord(state, 'venture-work-receipt', id);
  if (work && work.ventureId === ventureId) return work.figures[0]?.display ?? null;
  return null;
}

/** A cell as the screen shows it: a receipt with its figure, an estimate always labelled, a person by name. */
export function cellView(state: State, ventureId: string, column: TrackerColumn, value: TrackerCell): CellView {
  if (value === null) return { column: column.id, value, display: '' };
  if (column.kind === 'receipt') return { column: column.id, value, display: receiptDisplay(state, ventureId, String(value)) ?? '', receiptId: String(value) };
  if (column.kind === 'estimate') return { column: column.id, value, display: String(value), label: TRACKER_WORDS.estimate };
  if (column.kind === 'check') return { column: column.id, value, display: value ? 'Yes' : 'No' };
  if (column.kind === 'person') {
    const person = findRecord(state, 'venture-client', String(value)) ?? findRecord(state, 'venture-person', String(value));
    return { column: column.id, value, display: (person as { name?: string } | undefined)?.name ?? '' };
  }
  return { column: column.id, value, display: String(value) };
}

/** The columns of a tracker, checked: ids, names and kinds; a choice column's options; a count column never named for money. */
export function checkColumns(raw: unknown): TrackerColumn[] {
  check(Array.isArray(raw) && raw.length >= 1 && raw.length <= TRACKER_LIMITS.columns, 'INVALID_VENTURE_REQUEST', `Give a tracker one to ${TRACKER_LIMITS.columns} columns.`);
  const seen = new Set<string>();
  return (raw as unknown[]).map(item => {
    const column = item as Record<string, unknown>;
    if (!column || typeof column !== 'object' || Array.isArray(column) || Object.keys(column).some(key => !['id', 'name', 'kind', 'options'].includes(key))) throw invalid('Give each column an id, a name and a kind.');
    check(typeof column.id === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(column.id) && !seen.has(column.id), 'INVALID_VENTURE_REQUEST', 'Give each column its own short id.');
    seen.add(column.id as string);
    check(typeof column.name === 'string' && column.name.trim() !== '' && column.name.length <= TRACKER_LIMITS.column, 'INVALID_VENTURE_REQUEST', `Name each column in ${TRACKER_LIMITS.column} characters or fewer.`);
    check(COLUMN_KINDS.includes(column.kind as ColumnKind), 'INVALID_VENTURE_REQUEST', 'Choose a column kind from the list.');
    const name = (column.name as string).trim();
    if (column.kind === 'count' && countsMoney(`${name} 1`)) throw money();
    if (column.kind === 'choice') {
      const options = column.options;
      check(Array.isArray(options) && options.length >= 1 && options.length <= TRACKER_LIMITS.options && options.every(option => typeof option === 'string' && option.trim() !== '' && option.length <= TRACKER_LIMITS.option) && new Set(options).size === options.length, 'INVALID_VENTURE_REQUEST', 'Give a choice column one to 20 different options.');
      return { id: column.id as string, name, kind: 'choice', options: (options as string[]).map(option => option.trim()) };
    }
    check(column.options === undefined, 'INVALID_VENTURE_REQUEST', 'Only a choice column has options.');
    return { id: column.id as string, name, kind: column.kind as ColumnKind };
  });
}
