/**
 * Memory (BK-17): what Chausar believes, with its kind, status and source. A line read from
 * outside content is kept as data with source 'outside-content'; nothing here reads a line
 * to change a setting. Editing keeps the earlier text; deleting removes the text and keeps
 * only a tombstone (id and dates).
 */
import { check, newId, now, type Context, type State, type StateStore } from '../contracts.ts';
import type { MethodSpec } from '../modules/types.ts';
import { booksState, input, peekBooks, text, writeBooks, type MemoryKind, type MemoryRecord } from './books-common.ts';
import { sourceVisible } from './books-sources.ts';

const KINDS: MemoryKind[] = ['preference', 'claim', 'conversation', 'working-context'];
export type MemoryLine = Omit<MemoryRecord, 'by' | 'sourceIds' | 'deletedAt'> & { text: string };
const view = (line: MemoryRecord): MemoryLine => ({ id: line.id, text: line.text ?? '', kind: line.kind, status: line.status, source: line.source, receiptId: line.receiptId, learnedAt: line.learnedAt, confirmedAt: line.confirmedAt, earlier: structuredClone(line.earlier) });
/** A line is shown only when every source it was read from is visible to the caller. */
export const visibleMemoryLine = (store: StateStore, ctx: Context, line: MemoryRecord) => (Array.isArray(line.sourceIds) ? line.sourceIds : []).every(s => typeof s === 'string' && sourceVisible(store, ctx, s));
function live(store: StateStore, ctx: Context, lines: MemoryRecord[], id: unknown): MemoryRecord {
  const line = typeof id === 'string' ? lines.find(l => l.id === id && !l.deletedAt) : undefined;
  check(line && visibleMemoryLine(store, ctx, line), 'MEMORY_NOT_FOUND', 'This memory line was not found.'); return line;
}

/** Records a line proposed by another part of the app (an ask reply, a computed result or
 * outside content). Call inside `store.update`; the line starts as 'proposed' and changes nothing. */
export function proposeMemoryLine(state: State, ctx: Context, line: { text: string; kind: MemoryKind; source: MemoryRecord['source']; receiptId?: string | null; sourceIds?: string[] }): MemoryLine {
  check(text(line.text, 2000) && KINDS.includes(line.kind) && ['told-by-owner', 'computed', 'outside-content'].includes(line.source), 'INVALID_MEMORY', 'A memory line needs text, a kind and a source.');
  check(line.source !== 'computed' || typeof line.receiptId === 'string', 'INVALID_MEMORY', 'A computed line needs its receipt.');
  const record: MemoryRecord = { id: newId('memory'), text: line.text, kind: line.kind, status: 'proposed', source: line.source, receiptId: line.receiptId ?? null, learnedAt: now(), confirmedAt: null, earlier: [], by: ctx.memberId, sourceIds: [...(line.sourceIds ?? [])], deletedAt: null };
  booksState(state).memory.push(record); return view(record);
}

export const memoryMethods: Record<string, MethodSpec> = {
  'books.memory': { permission: 'read', handler(ctx, payload, host) {
    const { outsideOnly } = input(payload, ['outsideOnly']); check(outsideOnly === undefined || typeof outsideOnly === 'boolean', 'INVALID_BOOKS_REQUEST', 'outsideOnly is true or false.');
    return { lines: peekBooks(host.store.read()).memory.filter(l => !l.deletedAt && (!outsideOnly || l.source === 'outside-content') && visibleMemoryLine(host.store, ctx, l)).map(view) };
  } },
  'books.remember': { permission: 'admin', handler(ctx, payload, host) {
    const request = input(payload, ['text', 'kind'], ['text', 'kind']);
    check(text(request.text, 2000) && KINDS.includes(request.kind), 'INVALID_MEMORY', 'A memory line needs text and one of the four kinds.');
    return writeBooks(host.store, ctx, 'admin', books => {
      const at = now(); const record: MemoryRecord = { id: newId('memory'), text: request.text, kind: request.kind, status: 'told-by-owner', source: 'told-by-owner', receiptId: null, learnedAt: at, confirmedAt: at, earlier: [], by: ctx.memberId, sourceIds: [], deletedAt: null };
      books.memory.push(record); return view(record);
    });
  } },
  'books.memoryEdit': { permission: 'admin', handler(ctx, payload, host) {
    const request = input(payload, ['id', 'text'], ['id', 'text']); check(text(request.text, 2000), 'INVALID_MEMORY', 'Give the corrected text.');
    return writeBooks(host.store, ctx, 'admin', books => {
      const line = live(host.store, ctx, books.memory, request.id); check(line.text !== request.text, 'NO_CHANGE', 'The text is the same.');
      const at = now(); line.earlier.push({ text: line.text ?? '', at: line.confirmedAt ?? line.learnedAt }); line.text = request.text; line.status = 'corrected'; line.confirmedAt = at;
      return view(line);
    });
  } },
  'books.forget': { permission: 'admin', handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']);
    return writeBooks(host.store, ctx, 'admin', books => { const line = live(host.store, ctx, books.memory, id); line.text = null; line.earlier = []; line.deletedAt = now(); return { id: line.id, deleted: true as const }; });
  } },
  'books.memoryConfirm': { permission: 'admin', handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']);
    return writeBooks(host.store, ctx, 'admin', books => {
      const line = live(host.store, ctx, books.memory, id);
      // Outside content stays outside content: confirming it never makes it something the owner said.
      if (line.status === 'proposed') line.status = line.source === 'outside-content' ? 'assumed' : 'told-by-owner';
      line.confirmedAt = now(); return view(line);
    });
  } },
};
