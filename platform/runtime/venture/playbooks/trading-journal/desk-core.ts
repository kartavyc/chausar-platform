// Chausar playbook: trading journal (wave 6, 6E7 / D49). The desk's checks and views, shared by the engine desk and the
// fake engine so both answer alike: payload checks, the journal view built from saved entries, the list rows and the
// lines the owner reads. Browser-safe. Written for Chausar.
import { check, digest } from '../../../portable.ts';
import { decimalMinor } from '../../../currency.ts';
// B2: the tax pack file for the CA keeps the exact form; the desk shows its figures in the owner form.
import { formatMoney } from '../../../owner-format.ts';
import { readTradebook, type TradeRow } from './brokers.ts';
import { buildJournal, GRANDFATHER_BEFORE, type Journal, type OpeningLot } from './journal.ts';
import { BROKER_IDS, BROKER_RATES, type BrokerId } from './rates.ts';
import { taxPack, type TaxPack } from './tax-pack.ts';
import type { TradeJournalEntry } from './records.ts';

export type JournalEntryRow = { id: string; at: string; entry: TradeJournalEntry };
export type JournalListRow = { id: string; kind: TradeJournalEntry['kind']; label: string; at: string; receiptId: string };
export type JournalItem = {
  imports: { id: string; broker: BrokerId; brokerName: string; name: string; trades: number; formatChecked: boolean; receiptId: string }[];
  openings: (OpeningLot & { entryId: string })[];
  packs: { id: string; yearId: TaxPack['yearId']; year: string; act: string; line: string; receiptId: string; stale: boolean; figures: { key: string; label: string; display: string; section: string }[] }[];
  journal: Journal | null; sourceDigest: string | null;
  /** The figures of the receipt saved with the latest import or opening holding, read from that receipt. */
  summary: { receiptId: string; figures: { key: string; label: string; display: string }[] } | null;
};
export type ReceiptFigures = (id: string) => readonly { key: string; label: string; display: string }[] | null;

export const JOURNAL_LINES = Object.freeze({
  list: 'Your imported tradebooks, opening holdings and tax packs. Chausar never says what to trade.',
  imported: 'Tradebook imported. Charges were worked by code; compare them with your contract notes.',
  unchecked: 'This broker format was not checked against a real export, so check the first import closely.',
  opening: 'Opening holding saved. It is used before any imported buy of the same share.',
  pack: 'Tax pack prepared. Check with your CA.',
});

const BAD_OPENING = 'OPENING_INVALID';
const object = (raw: unknown, keys: readonly string[], code: string, why: string): Record<string, unknown> => {
  check(!!raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).sort().join(',') === [...keys].sort().join(','), code, why);
  return raw as Record<string, unknown>;
};

/** The import payload: the broker the owner chose (or null to tell it from the columns), a file name and the CSV text. */
export function importPayload(raw: unknown): { broker: BrokerId | null; name: string; csv: string } {
  const body = object(raw, ['broker', 'name', 'csv'], 'TRADEBOOK_INVALID', 'Send the broker, the file name and the tradebook CSV.');
  check(body.broker === null || BROKER_IDS.includes(body.broker as BrokerId), 'TRADEBOOK_INVALID', 'Choose Zerodha, Groww, Upstox or Dhan, or let Chausar tell from the columns.');
  check(typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 200 && !/[\u0000-\u001f\u007f]/.test(body.name), 'TRADEBOOK_INVALID', 'Give the file a short name.');
  check(typeof body.csv === 'string', 'TRADEBOOK_INVALID', 'Add the tradebook CSV text.');
  return { broker: body.broker as BrokerId | null, name: body.name.trim(), csv: body.csv };
}

/** Read a tradebook for import, refusing a file already imported. */
export function importEntry(payload: ReturnType<typeof importPayload>, rows: readonly JournalEntryRow[]): { broker: BrokerId; name: string; sourceDigest: string; formatChecked: boolean; trades: TradeRow[]; note: string } {
  const sourceDigest = digest(payload.csv);
  check(!rows.some(row => row.entry.kind === 'import' && row.entry.sourceDigest === sourceDigest), 'TRADEBOOK_DUPLICATE', 'This tradebook is already imported.');
  const book = readTradebook(payload.csv, payload.broker);
  return { broker: book.broker, name: payload.name, sourceDigest, formatChecked: book.format.checked, trades: book.trades, note: book.format.note };
}

/** The opening holding payload: rupees as decimal text, the fair market value only for shares bought before February 2018. */
export function openingLot(raw: unknown, id: string): OpeningLot {
  const body = object(raw, ['symbol', 'isin', 'boughtOn', 'quantity', 'cost', 'fmv'], BAD_OPENING, 'Send the share, ISIN, day bought, quantity, cost and fair market value.');
  check(typeof body.symbol === 'string' && /^[A-Za-z0-9&._-]{1,40}$/.test(body.symbol), BAD_OPENING, 'Give the share symbol as the broker writes it.');
  check(body.isin === null || typeof body.isin === 'string' && /^IN[A-Z0-9]{10}$/.test(body.isin), BAD_OPENING, 'Give a twelve character Indian ISIN, or none.');
  check(typeof body.boughtOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.boughtOn) && new Date(body.boughtOn + 'T00:00:00Z').toISOString().slice(0, 10) === body.boughtOn, BAD_OPENING, 'Give the day bought as a date.');
  check(typeof body.quantity === 'string' && /^[1-9]\d{0,9}$/.test(body.quantity), BAD_OPENING, 'Give a whole quantity above zero.');
  check(typeof body.cost === 'string' && /^\d{1,13}(?:\.\d{1,2})?$/.test(body.cost) && BigInt(decimalMinor(body.cost, 'INR')) > 0n, BAD_OPENING, 'Give the total cost in rupees, like 1500.50.');
  const old = (body.boughtOn as string) < GRANDFATHER_BEFORE;
  check(body.fmv === null || old && typeof body.fmv === 'string' && /^\d{1,9}(?:\.\d{1,2})?$/.test(body.fmv), BAD_OPENING, 'A fair market value per share is only for shares bought before 1 February 2018.');
  return { id, symbol: (body.symbol as string).toUpperCase(), isin: body.isin as string | null, boughtOn: body.boughtOn as string, quantity: body.quantity as string, costMinor: decimalMinor(body.cost as string, 'INR'), fmvMinor: body.fmv === null ? null : decimalMinor(body.fmv as string, 'INR') };
}

/** The digest of every import and opening holding, so a saved pack knows when its sources changed. */
export function sourceDigestOf(rows: readonly JournalEntryRow[]): string | null {
  const sources = rows.filter(row => row.entry.kind !== 'pack').map(row => row.entry.kind === 'import' ? { id: row.id, digest: row.entry.sourceDigest } : { id: row.id, lot: row.entry.kind === 'opening' ? row.entry.lot : null });
  return sources.length ? digest(sources) : null;
}

/** The sources a journal or pack receipt names: each imported tradebook, and each opening holding the owner entered. */
export function sourcesOf(rows: readonly JournalEntryRow[]): { id: string; name: string; digest: string }[] {
  return rows.flatMap(row => row.entry.kind === 'import' ? [{ id: row.id, name: row.entry.name, digest: row.entry.sourceDigest }]
    : row.entry.kind === 'opening' ? [{ id: row.id, name: `Opening holding ${row.entry.lot.symbol}`, digest: digest(row.entry.lot) }] : []);
}

export function journalOf(rows: readonly JournalEntryRow[], asOf: string): Journal | null {
  const trades = rows.flatMap(row => row.entry.kind === 'import' ? row.entry.trades : []);
  if (!trades.length && !rows.some(row => row.entry.kind === 'opening')) return null;
  return buildJournal(trades, rows.flatMap(row => row.entry.kind === 'opening' ? [row.entry.lot] : []), asOf);
}

export function journalItem(rows: readonly JournalEntryRow[], asOf: string, figuresOf: ReceiptFigures): JournalItem {
  const sourceDigest = sourceDigestOf(rows);
  const latest = [...rows].reverse().find(row => row.entry.kind !== 'pack');
  const receiptId = latest && latest.entry.kind !== 'pack' ? latest.entry.receiptId : null;
  const figures = receiptId ? figuresOf(receiptId) : null;
  return {
    imports: rows.flatMap(row => row.entry.kind === 'import' ? [{ id: row.id, broker: row.entry.broker, brokerName: BROKER_RATES[row.entry.broker].name, name: row.entry.name, trades: row.entry.trades.length, formatChecked: row.entry.formatChecked, receiptId: row.entry.receiptId }] : []),
    openings: rows.flatMap(row => row.entry.kind === 'opening' ? [{ ...row.entry.lot, entryId: row.id }] : []),
    packs: rows.flatMap(row => row.entry.kind === 'pack' ? [{ id: row.id, yearId: row.entry.yearId, year: row.entry.pack.year, act: row.entry.pack.act, line: row.entry.pack.line, receiptId: row.entry.receiptId, stale: row.entry.sourceDigest !== sourceDigest,
      figures: row.entry.pack.figures.map(f => ({ key: f.key, label: f.label, display: f.unit === 'money' ? formatMoney(f.minor, 'INR') : f.display, section: f.rule.section })) }] : []),
    journal: journalOf(rows, asOf), sourceDigest,
    summary: receiptId && figures ? { receiptId, figures: figures.map(({ key, label, display }) => ({ key, label, display })) } : null,
  };
}

export function listRows(rows: readonly JournalEntryRow[]): JournalListRow[] {
  return rows.map(row => ({ id: row.id, kind: row.entry.kind, at: row.at,
    label: row.entry.kind === 'import' ? `${BROKER_RATES[row.entry.broker].name}: ${row.entry.name}` : row.entry.kind === 'opening' ? `Opening holding: ${row.entry.lot.symbol}` : `Tax pack: ${row.entry.pack.year}`,
    receiptId: row.entry.receiptId }));
}

/** The pack for one year from the current journal; refused while nothing is imported. */
export function packFor(rows: readonly JournalEntryRow[], raw: unknown, asOf: string): { pack: TaxPack; journal: Journal; sourceDigest: string } {
  const body = object(raw, ['yearId'], 'TAX_YEAR_UNSUPPORTED', 'Choose the year for the tax pack.');
  const journal = journalOf(rows, asOf), sourceDigest = sourceDigestOf(rows);
  check(journal && sourceDigest, 'JOURNAL_EMPTY', 'Import a tradebook first.');
  return { pack: taxPack(journal, body.yearId), journal, sourceDigest };
}
