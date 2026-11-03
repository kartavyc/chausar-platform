// Chausar playbook: trading journal (wave 6, 6E7 / D49). The owner desk: import a broker tradebook, add an opening
// holding, prepare a tax pack. Every amount is worked by code and saved with a work receipt. Nothing here reaches a
// broker, places an order or says what to trade. Written for Chausar.
import { check } from '../../../contracts.ts';
import type { Json, TradeJournalRecord, VentureRecord } from '../../contracts.ts';
import type { State } from '../../../contracts.ts';
import { digest, exactPayload, listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../../records.ts';
import type { DeskHandlers } from '../desk-types.ts';
import { JOURNAL_LINES, sourcesOf, importEntry, importPayload, journalItem, journalOf, listRows, openingLot, packFor, type JournalEntryRow, type JournalItem, type JournalListRow } from './desk-core.ts';
import { journalReceipt, taxPackReceipt } from './receipt.ts';

export type TradingJournalDeskTypes = {
  journal: { filter: Json; row: JournalListRow; item: JournalItem; actions: {
    import: { payload: Json; result: { id: string; trades: number; formatChecked: boolean; receiptId: string } };
    'add-opening': { payload: Json; result: { id: string } };
    'tax-pack': { payload: Json; result: { id: string; receiptId: string; pack: import('./tax-pack.ts').TaxPack } };
  } };
};

const PLAYBOOK = 'trading-journal' as const;
const rowsOf = (state: State, venture: VentureRecord): JournalEntryRow[] => listRecords(state, 'venture-trade-journal', venture.id).map(row => ({ id: row.id, at: row.at, entry: row.entry }));
const top = (raw: unknown, op: 'list' | 'get' | 'act') => exactPayload(raw, op === 'list' ? ['playbook', 'kind', 'filter'] : op === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload', 'digest'],
  op === 'list' ? ['playbook', 'kind'] : op === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload']);
const today = (now: string) => now.slice(0, 10);
function saveReceipt(tx: VentureTx, body: ReturnType<typeof journalReceipt> | ReturnType<typeof taxPackReceipt>): string {
  const proof = { ...tx.base('venture-work-receipt'), ...body };
  proof.digest = digest({ ...proof, digest: '' });
  tx.put(proof);
  return proof.id;
}

export const TRADING_JOURNAL_DESK: DeskHandlers = { journal: {
  async list(deps, ctx, p) {
    top(p, 'list'); if (p.filter !== undefined) exactPayload(p.filter, []);
    const { state, venture } = readVenture(deps, ctx);
    return { playbook: PLAYBOOK, kind: 'journal', rows: listRows(rowsOf(state, venture)), line: JOURNAL_LINES.list };
  },
  async get(deps, ctx, p) {
    top(p, 'get'); check(p.id === 'journal', 'INVALID_VENTURE_REQUEST', 'Open your trading journal.');
    const { state, venture } = readVenture(deps, ctx), item = journalItem(rowsOf(state, venture), today(deps.clock().toISOString()), id => listRecords(state, 'venture-work-receipt', venture.id).find(row => row.id === id)?.figures ?? null);
    return { playbook: PLAYBOOK, kind: 'journal', item, digest: digest(item) };
  },
  async act(deps, ctx, p) {
    requireAppChannel(ctx, 'venture.desk.act'); top(p, 'act');
    check(p.id === 'new' && p.digest === undefined, 'INVALID_VENTURE_REQUEST', 'Start a new import, opening holding or tax pack.');
    return ventureAction(deps, ctx, 'approve', `trading.journal.${p.action}`, tx => {
      const venture = tx.venture!, rows = rowsOf(tx.state, venture), asOf = today(tx.now);
      const save = (base: ReturnType<typeof tx.base<'venture-trade-journal'>>, entry: TradeJournalRecord['entry']) => {
        const record: TradeJournalRecord = { ...base, entry };
        tx.put(record); tx.emit('desk.changed', { playbook: PLAYBOOK, kind: 'journal', id: record.id }); return record;
      };
      if (p.action === 'import') {
        const read = importEntry(importPayload(p.payload), rows), base = tx.base('venture-trade-journal');
        const entry = { kind: 'import' as const, broker: read.broker, name: read.name, sourceDigest: read.sourceDigest, formatChecked: read.formatChecked, trades: read.trades, receiptId: '' };
        const next = [...rows, { id: base.id, at: base.at, entry }], journal = journalOf(next, asOf)!;
        entry.receiptId = saveReceipt(tx, journalReceipt(base.id, sourcesOf(next), journal));
        const record = save(base, entry);
        return { playbook: PLAYBOOK, kind: 'journal', id: record.id, result: { id: record.id, trades: read.trades.length, formatChecked: read.formatChecked, receiptId: entry.receiptId },
          line: read.formatChecked ? JOURNAL_LINES.imported : `${JOURNAL_LINES.imported} ${JOURNAL_LINES.unchecked}` };
      }
      if (p.action === 'add-opening') {
        const base = tx.base('venture-trade-journal'), lot = openingLot(p.payload, base.id), entry = { kind: 'opening' as const, lot, receiptId: '' };
        const next = [...rows, { id: base.id, at: base.at, entry }], journal = journalOf(next, asOf)!;
        entry.receiptId = saveReceipt(tx, journalReceipt(base.id, sourcesOf(next), journal));
        const record = save(base, entry);
        return { playbook: PLAYBOOK, kind: 'journal', id: record.id, result: { id: record.id }, line: JOURNAL_LINES.opening };
      }
      check(p.action === 'tax-pack', 'INVALID_VENTURE_REQUEST', 'Choose import, add-opening or tax-pack.');
      const { pack, sourceDigest } = packFor(rows, p.payload, asOf), base = tx.base('venture-trade-journal');
      const receiptId = saveReceipt(tx, taxPackReceipt(base.id, sourcesOf(rows), pack));
      const record = save(base, { kind: 'pack', yearId: pack.yearId, pack, sourceDigest, receiptId });
      return { playbook: PLAYBOOK, kind: 'journal', id: record.id, result: { id: record.id, receiptId, pack }, line: JOURNAL_LINES.pack };
    });
  },
} };
