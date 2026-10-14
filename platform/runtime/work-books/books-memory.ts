/**
 * Memory (BK-17): what Chausar believes, with its kind, status and source. A line read from
 * outside content is kept as data with source 'outside-content'; nothing here reads a line
 * to change a setting. Editing keeps the earlier text; deleting removes the text and keeps
 * only a tombstone (id and dates).
 */
import { check, newId, now, type Context, type State, type StateStore } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { booksState, input, LIMITS, peekBooks, room, text, writeBooks, type MemoryKind, type MemoryRecord } from './books-common.ts';
import type { CalculatorService } from '../calculator.ts';
import { sourceVisible } from './books-sources.ts';

const KINDS: MemoryKind[] = ['preference', 'claim', 'conversation', 'working-context'];
export type MemoryLine = Omit<MemoryRecord, 'by' | 'sourceIds' | 'deletedAt'> & { text: string };
const view = (line: MemoryRecord): MemoryLine => ({ id: line.id, text: line.text ?? '', kind: line.kind, status: line.status, source: line.source, receiptId: line.receiptId, learnedAt: line.learnedAt, confirmedAt: line.confirmedAt, earlier: structuredClone(line.earlier) });
/**
 * A line is shown only when every source it was read from is visible to the caller and, when it
 * carries a receipt, only when the caller may read that receipt (the calculator's own rule).
 */
export function visibleMemoryLine(store: StateStore, ctx: Context, line: MemoryRecord, host?: Pick<ModuleHost, 'services'>): boolean {
  if (!(Array.isArray(line.sourceIds) ? line.sourceIds : []).every(s => typeof s === 'string' && sourceVisible(store, ctx, s))) return false;
  if (line.receiptId === null || line.receiptId === undefined) return true;
  const calculator = host?.services.calculator as CalculatorService | undefined;
  if (calculator && typeof calculator.receipt === 'function') { try { calculator.receipt(ctx, line.receiptId); return true; } catch { return false; } }
  // Without the calculator, only the receipt's own reader sees the line.
  return store.read().receipts.some(r => r?.id === line.receiptId && r.memberId === ctx.memberId);
}
function live(host: ModuleHost, ctx: Context, lines: MemoryRecord[], id: unknown): MemoryRecord {
  const line = typeof id === 'string' ? lines.find(l => l.id === id && !l.deletedAt) : undefined;
  check(line && visibleMemoryLine(host.store, ctx, line, host), 'MEMORY_NOT_FOUND', 'This memory line was not found.'); return line;
}
/** Room for one more line: live lines and tombstones are both bounded. */
function memoryRoom(lines: MemoryRecord[]) {
  room(lines.filter(l => !l.deletedAt), LIMITS.memoryLive); room(lines, LIMITS.memoryAll);
}

/** Records a line proposed by another part of the app (an ask reply, a computed result or
 * outside content). Call inside `store.update`; the line starts as 'proposed' and changes nothing. */
export function proposeMemoryLine(state: State, ctx: Context, line: { text: string; kind: MemoryKind; source: MemoryRecord['source']; receiptId?: string | null; sourceIds?: string[] }): MemoryLine {
  check(text(line.text, 2000) && KINDS.includes(line.kind) && ['told-by-owner', 'computed', 'outside-content'].includes(line.source), 'INVALID_MEMORY', 'A memory line needs text, a kind and a source.');
  check(line.source !== 'computed' || typeof line.receiptId === 'string', 'INVALID_MEMORY', 'A computed line needs its receipt.');
  const record: MemoryRecord = { id: newId('memory'), text: line.text, kind: line.kind, status: 'proposed', source: line.source, receiptId: line.receiptId ?? null, learnedAt: now(), confirmedAt: null, earlier: [], by: ctx.memberId, sourceIds: [...(line.sourceIds ?? [])], deletedAt: null };
  const lines = booksState(state).memory; memoryRoom(lines); lines.push(record); return view(record);
}

/**
 * Business-profile entries (core `business.profile.*`): what the owner told about the business
 * (industry, products, customers, business model, location), shown as read-only claim lines with
 * their earlier versions. Their ids start with `profile:`; Delete removes the whole version chain
 * through `business.profile.remove`. They cannot be edited or confirmed here.
 */
export const PROFILE_PREFIX = 'profile:';
type ProfileLine = MemoryLine & { origin: 'business-profile'; field: string; readOnly: true };
async function profileLines(host: ModuleHost): Promise<ProfileLine[]> {
  const reply = await optionalCall(host, 'business.profile.history', {});
  if (!reply.available || !Array.isArray(reply.value)) return [];
  type Rec = { id: string; field: string; value: string; origin: string; learnedAt: string; replacesId: string | null; tainted: boolean };
  const records: Rec[] = (reply.value as unknown[]).slice(0, 2000).flatMap(r => {
    if (!r || typeof r !== 'object') return [];
    const v = r as Record<string, unknown>;
    if (typeof v.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,180}$/.test(v.id) || typeof v.field !== 'string' || typeof v.value !== 'string' || v.value.length > 2000 || typeof v.learnedAt !== 'string') return [];
    return [{ id: v.id, field: v.field.slice(0, 40), value: v.value, origin: String(v.origin), learnedAt: v.learnedAt, replacesId: typeof v.replacesId === 'string' ? v.replacesId : null, tainted: v.sourceTainted === true }];
  });
  const byId = new Map(records.map(r => [r.id, r] as const)), replaced = new Set(records.map(r => r.replacesId).filter((id): id is string => id !== null));
  return records.filter(r => !replaced.has(r.id)).map(head => {
    const earlier: { text: string; at: string }[] = []; const seen = new Set([head.id]);
    for (let prev = head.replacesId ? byId.get(head.replacesId) : undefined; prev && !seen.has(prev.id); prev = prev.replacesId ? byId.get(prev.replacesId) : undefined) { seen.add(prev.id); earlier.push({ text: prev.value, at: prev.learnedAt }); }
    const owner = head.origin === 'owner-told';
    return { id: `${PROFILE_PREFIX}${head.id}`, text: head.value, kind: 'claim' as const,
      status: owner ? (earlier.length ? 'corrected' as const : 'told-by-owner' as const) : 'assumed' as const,
      source: head.tainted ? 'outside-content' as const : 'told-by-owner' as const, receiptId: null, learnedAt: head.learnedAt, confirmedAt: owner ? head.learnedAt : null,
      earlier, origin: 'business-profile' as const, field: head.field, readOnly: true as const };
  }).sort((a, b) => a.learnedAt.localeCompare(b.learnedAt));
}
const isProfile = (id: unknown) => typeof id === 'string' && id.startsWith(PROFILE_PREFIX);

export const memoryMethods: Record<string, MethodSpec> = {
  'books.memory': { permission: 'read', async handler(ctx, payload, host) {
    const { outsideOnly } = input(payload, ['outsideOnly']); check(outsideOnly === undefined || typeof outsideOnly === 'boolean', 'INVALID_BOOKS_REQUEST', 'outsideOnly is true or false.');
    const lines = peekBooks(host.store.read()).memory.filter(l => !l.deletedAt && (!outsideOnly || l.source === 'outside-content') && visibleMemoryLine(host.store, ctx, l, host)).map(view);
    // Round 2, additive: the business profile's entries, read-only, after the lane's own lines.
    return { lines: [...lines, ...(await profileLines(host)).filter(l => !outsideOnly || l.source === 'outside-content')] };
  } },
  'books.remember': { permission: 'admin', handler(ctx, payload, host) {
    const request = input(payload, ['text', 'kind'], ['text', 'kind']);
    check(text(request.text, 2000) && KINDS.includes(request.kind), 'INVALID_MEMORY', 'A memory line needs text and one of the four kinds.');
    // Work that has read outside text never speaks for the owner: its line is kept as outside content, waiting to be confirmed.
    const tainted = ctx.sourceTainted === true;
    return writeBooks(host.store, ctx, 'admin', books => {
      memoryRoom(books.memory);
      const at = now(); const record: MemoryRecord = { id: newId('memory'), text: request.text, kind: request.kind, status: tainted ? 'proposed' : 'told-by-owner', source: tainted ? 'outside-content' : 'told-by-owner', receiptId: null, learnedAt: at, confirmedAt: tainted ? null : at, earlier: [], by: ctx.memberId, sourceIds: [], deletedAt: null };
      books.memory.push(record); return view(record);
    });
  } },
  'books.memoryEdit': { permission: 'admin', handler(ctx, payload, host) {
    const request = input(payload, ['id', 'text'], ['id', 'text']); check(text(request.text, 2000), 'INVALID_MEMORY', 'Give the corrected text.');
    check(!ctx.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot correct what Chausar remembers.');
    check(!isProfile(request.id), 'PROFILE_LINE_READ_ONLY', 'A business profile entry is changed where it was told, not here. It can be deleted.');
    return writeBooks(host.store, ctx, 'admin', books => {
      const line = live(host, ctx, books.memory, request.id); check(line.text !== request.text, 'NO_CHANGE', 'The text is the same.');
      room(line.earlier, LIMITS.earlier); const at = now(); line.earlier.push({ text: line.text ?? '', at: line.confirmedAt ?? line.learnedAt }); line.text = request.text; line.status = 'corrected'; line.confirmedAt = at;
      return view(line);
    });
  } },
  'books.forget': { permission: 'admin', async handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']);
    if (isProfile(id)) {
      // The whole version chain goes, through the core business profile service.
      const reply = await host.call('business.profile.remove', { id: (id as string).slice(PROFILE_PREFIX.length) });
      check(reply && typeof reply === 'object' && (reply as { removed?: unknown }).removed === true, 'MEMORY_NOT_FOUND', 'This memory line was not found.');
      return { id, deleted: true as const };
    }
    return writeBooks(host.store, ctx, 'admin', books => { const line = live(host, ctx, books.memory, id); line.text = null; line.earlier = []; line.deletedAt = now(); return { id: line.id, deleted: true as const }; });
  } },
  /**
   * A line proposed from the ask line (SH-04 "telling, not asking", BK-17). It waits as
   * 'proposed' until the owner or a cofounder confirms it, and changes nothing until then.
   * Anything said by work that has read outside content is kept as outside content.
   */
  'books.memoryPropose': { permission: 'prepare', handler(ctx, payload, host) {
    const request = input(payload, ['text', 'kind', 'receiptId'], ['text', 'kind']);
    check(text(request.text, 2000) && KINDS.includes(request.kind) && (request.receiptId === undefined || (typeof request.receiptId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(request.receiptId))), 'INVALID_MEMORY', 'A memory line needs text and one of the four kinds.');
    if (request.receiptId !== undefined) {
      const receipt = host.store.read().receipts.find(r => r?.id === request.receiptId);
      check(receipt && receipt.memberId === ctx.memberId, 'RECEIPT_NOT_FOUND', 'This receipt is not available to you.');
    }
    const source: MemoryRecord['source'] = ctx.sourceTainted ? 'outside-content' : request.receiptId !== undefined ? 'computed' : 'told-by-owner';
    return writeBooks(host.store, ctx, 'prepare', (_books, state) => proposeMemoryLine(state, ctx, { text: request.text, kind: request.kind, source, receiptId: source === 'computed' ? request.receiptId : null }));
  } },
  'books.memoryConfirm': { permission: 'admin', handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']);
    check(!isProfile(id), 'PROFILE_LINE_READ_ONLY', 'A business profile entry is changed where it was told, not here. It can be deleted.');
    check(!ctx.sourceTainted, 'TAINTED_APPROVAL', 'Imported text cannot confirm what Chausar remembers.');
    return writeBooks(host.store, ctx, 'admin', books => {
      const line = live(host, ctx, books.memory, id);
      // Outside content stays outside content: confirming it never makes it something the owner said.
      if (line.status === 'proposed') line.status = line.source === 'outside-content' ? 'assumed' : 'told-by-owner';
      line.confirmedAt = now(); return view(line);
    });
  } },
};
