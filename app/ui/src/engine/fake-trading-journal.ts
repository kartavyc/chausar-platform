// The fake engine's trading journal (wave 6, package 6E7): the engine's own core (playbooks/trading-journal/desk-core.ts,
// journal.ts, receipt.ts) over in-memory entries, so codes, words, figures and receipts match the engine. It holds only
// the owner's own trades, reaches no broker and never says what to trade.
import { check, digest } from '../../../../platform/runtime/portable';
import { dayKeyIn, ownerZone } from '../../../../platform/runtime/owner-format';
import { JOURNAL_LINES, sourcesOf, importEntry, importPayload, journalItem, journalOf, listRows, openingLot, packFor, type JournalEntryRow } from '../../../../platform/runtime/venture/playbooks/trading-journal/desk-core';
import { journalReceipt, taxPackReceipt } from '../../../../platform/runtime/venture/playbooks/trading-journal/receipt';
import type { TradeJournalEntry } from '../../../../platform/runtime/venture/playbooks/trading-journal/records';
import { roomGuard } from './fake-client-room';
import type { FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';
import type { WorkReceiptLite } from './types';

const PLAYBOOK = 'trading-journal';
const BAD = 'INVALID_VENTURE_REQUEST';
/** The engine's exactPayload, word for word (records.ts). */
function top(raw: unknown, required: readonly string[], allowed: readonly string[]): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw) && [Object.prototype, null].includes(Object.getPrototypeOf(raw)), BAD, 'Send one request object.');
  const record = raw as Record<string, unknown>;
  check(Object.keys(record).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(record, key)), BAD, 'Send the required fields and nothing else.');
  return record;
}

export function fakeTradingJournalDesk(host: W4DeskHost): FakePlaybookDesk {
  const spaces = new Map<string, JournalEntryRow[]>(), receipts = new Map<string, WorkReceiptLite>();
  let seq = 0;
  const rows = () => spaces.get(host.current()) ?? [];
  // The as-of day where the business is, as the engine's desk reads it (one-shot B2, the owner-day rule).
  const today = () => dayKeyIn(host.now(), ownerZone((host.ask('venture.get', {}) as { venture?: { country?: { code: string } | null } } | null)?.venture?.country?.code, 'UTC'));
  const nextId = (kind: string) => `${kind}_${++seq}`;
  const keepReceipt = (body: ReturnType<typeof journalReceipt> | ReturnType<typeof taxPackReceipt>) => {
    const id = nextId('work');
    receipts.set(id, { id, at: host.now(), operation: body.operation, currency: body.currency, explanation: body.explanation, figures: body.figures.map(f => ({ ...f })), steps: body.steps.map(s => ({ ...s, inputs: [...s.inputs] })) });
    return id;
  };
  const add = (id: string, entry: TradeJournalEntry) => { spaces.set(host.current(), [...rows(), { id, at: host.now(), entry }]); host.emit({ type: 'desk.changed', businessId: host.current(), at: host.now() } as never); };
  return {
    playbook: PLAYBOOK,
    workReceipt: id => receipts.get(id),
    kinds: { journal: {
      list: raw => roomGuard(() => {
        const p = top(raw, ['playbook', 'kind'], ['playbook', 'kind', 'filter']);
        if (p.filter !== undefined) top(p.filter, [], []);
        return { playbook: PLAYBOOK, kind: 'journal', rows: listRows(rows()), line: JOURNAL_LINES.list };
      }),
      get: raw => roomGuard(() => {
        const p = top(raw, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']);
        check(p.id === 'journal', BAD, 'Open your trading journal.');
        const item = journalItem(rows(), today(), id => receipts.get(id)?.figures.map(f => ({ key: f.key, label: f.label, display: String(f.display) })) ?? null);
        return { playbook: PLAYBOOK, kind: 'journal', item, digest: digest(item) };
      }),
      act: raw => roomGuard(() => {
        const p = top(raw, ['playbook', 'kind', 'id', 'action', 'payload'], ['playbook', 'kind', 'id', 'action', 'payload', 'digest']);
        check(p.id === 'new' && p.digest === undefined, BAD, 'Start a new import, opening holding or tax pack.');
        const current = rows(), asOf = today();
        if (p.action === 'import') {
          const read = importEntry(importPayload(p.payload), current), id = nextId('journal');
          const entry = { kind: 'import' as const, broker: read.broker, name: read.name, sourceDigest: read.sourceDigest, formatChecked: read.formatChecked, trades: read.trades, receiptId: '' };
          const next = [...current, { id, at: host.now(), entry }];
          entry.receiptId = keepReceipt(journalReceipt(id, sourcesOf(next), journalOf(next, asOf)!));
          add(id, entry);
          return { playbook: PLAYBOOK, kind: 'journal', id, result: { id, trades: read.trades.length, formatChecked: read.formatChecked, receiptId: entry.receiptId },
            line: read.formatChecked ? JOURNAL_LINES.imported : `${JOURNAL_LINES.imported} ${JOURNAL_LINES.unchecked}` };
        }
        if (p.action === 'add-opening') {
          const id = nextId('journal'), lot = openingLot(p.payload, id), entry = { kind: 'opening' as const, lot, receiptId: '' };
          const next = [...current, { id, at: host.now(), entry }];
          entry.receiptId = keepReceipt(journalReceipt(id, sourcesOf(next), journalOf(next, asOf)!));
          add(id, entry);
          return { playbook: PLAYBOOK, kind: 'journal', id, result: { id }, line: JOURNAL_LINES.opening };
        }
        check(p.action === 'tax-pack', BAD, 'Choose import, add-opening or tax-pack.');
        const { pack, sourceDigest } = packFor(current, p.payload, asOf), id = nextId('journal');
        const receiptId = keepReceipt(taxPackReceipt(id, sourcesOf(current), pack));
        add(id, { kind: 'pack', yearId: pack.yearId, pack, sourceDigest, receiptId });
        return { playbook: PLAYBOOK, kind: 'journal', id, result: { id, receiptId, pack }, line: JOURNAL_LINES.pack };
      }),
    } },
  };
}
