/**
 * Records (BK-12, BK-13, BK-14, BK-20): customers, suppliers and items read from facts, with
 * where each detail came from; joining two customers (and undoing it) through the memory
 * service; sources that disagree; and what the workspace holds about one record.
 */
import { check, hash, now, type Context, type Fact, type State } from '../contracts.ts';
import { sourceAccess, type ActionService, type PreparedAction } from '../actions.ts';
import type { CalculatorService } from '../calculator.ts';
import { canSeeFact, gstinValid, resolveCustomer, selectFacts, type MemoryService } from '../memory.ts';
import type { OntologyService } from '../ontology.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { amountOf, input, isoDay, LIMITS, member, mentions, namesId, peekBooks, plainId, room, text, writeBooks, type Amount, type MatchDecision } from './books-common.ts';
import { sourceVisible } from './books-sources.ts';
import { visibleMemoryLine } from './books-memory.ts';

type Kind = 'customer' | 'supplier' | 'item';
/** `selected` counts facts the selection chose; disputed claims are kept on the page but are not selected. */
type RecordEntry = { id: string; kind: Kind; facts: Fact[]; selected: number };
const DETAIL_FIELDS = ['customerName', 'supplierName', 'itemName', 'company', 'gstin', 'pan', 'phone', 'email', 'address', 'upiId', 'bankAccount', 'sku', 'unit'];
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Record references in one fact. A purchase names its party in customerId when no supplier field exists. */
function references(fact: Fact): [Kind, string][] {
  const refs: [Kind, string][] = [];
  if (str(fact.fields.supplierId)) refs.push(['supplier', fact.fields.supplierId]);
  if (str(fact.fields.customerId)) refs.push([fact.kind === 'purchase' && !str(fact.fields.supplierId) ? 'supplier' : 'customer', fact.fields.customerId]);
  if (str(fact.fields.itemId)) refs.push(['item', fact.fields.itemId]);
  return refs;
}
/** Current records under the caller's access; joined customers appear under the kept id. */
export function collectRecords(host: ModuleHost, ctx: Context): Map<string, RecordEntry> {
  const records = new Map<string, RecordEntry>(); const selection = selectFacts(host.store, ctx); const state = host.store.read();
  // Claims that sources disagree on stay on the record's page, each with its own source.
  const disputed = selection.conflicts.flatMap(c => c.rowIds).map(id => state.facts.find(f => f.id === id)).filter((f): f is Fact => !!f)
    .map(f => ({ ...structuredClone(f), fields: { ...structuredClone(f.fields), customerId: resolveCustomer(state, f.fields.customerId, selection.asOf) } }));
  const chosen = new Set(selection.facts);
  for (const fact of [...selection.facts, ...disputed]) for (const [kind, id] of references(fact)) {
    const entry = records.get(id) ?? { id, kind, facts: [], selected: 0 }; entry.facts.push(fact); if (chosen.has(fact)) entry.selected++; records.set(id, entry);
  }
  return records;
}
/**
 * Every record id the caller can see: current records plus the raw ids named by facts the
 * caller can see (a customer joined into another keeps its own id in the facts).
 */
export function visibleRecordIds(host: ModuleHost, ctx: Context, records = collectRecords(host, ctx)): Set<string> {
  const ids = new Set(records.keys());
  for (const fact of host.store.read().facts) if (!fact.deletedAt && canSeeFact(host.store, ctx, fact)) for (const [, id] of references(fact)) ids.add(id);
  return ids;
}
const nameOf = (entry: RecordEntry) => { const field = `${entry.kind}Name`; return (entry.facts.map(f => f.fields[field]).find(str) as string | undefined) ?? null; };
function findRecord(host: ModuleHost, ctx: Context, id: unknown): RecordEntry {
  check(plainId(id), 'INVALID_BOOKS_REQUEST', 'Name the record.'); const entry = collectRecords(host, ctx).get(id); check(entry, 'RECORD_NOT_FOUND', 'This record is not available to you.'); return entry;
}
async function owes(host: ModuleHost, ctx: Context, entry: RecordEntry): Promise<{ value: Amount; receiptId: string | null }> {
  if (entry.kind !== 'customer') return { value: { missing: 'not-applicable' }, receiptId: null };
  const dictionary = (host.services.ontology as OntologyService).current(ctx);
  if (!dictionary?.operations.some(o => o.id === 'aging')) return { value: { missing: 'not-counted' }, receiptId: null };
  try {
    const receipt = await (host.services.calculator as CalculatorService).calculate(ctx, { operation: 'aging', customerId: entry.id });
    return { value: receipt.coverage.countedRows > 0 ? { minor: receipt.valueMinor } : { missing: 'not-counted' }, receiptId: receipt.id };
  } catch (error) {
    // A refused aging (for example an invoice without a due date) is not a zero.
    if (typeof (error as { code?: unknown })?.code === 'string' && !['ACCESS_REVOKED', 'FORBIDDEN', 'SOURCE_REVOKED'].includes((error as { code: string }).code)) return { value: { missing: 'not-counted' }, receiptId: null };
    throw error;
  }
}
async function recordView(host: ModuleHost, ctx: Context, id: unknown) {
  const entry = findRecord(host, ctx, id); const books = peekBooks(host.store.read());
  const details = new Map<string, { field: string; value: string; sourceId: string }>();
  for (const fact of entry.facts) for (const field of DETAIL_FIELDS) { const value = fact.fields[field]; if (str(value)) details.set(JSON.stringify([field, value, fact.sourceId]), { field, value, sourceId: fact.sourceId }); }
  const optIn = (['mail', 'whatsapp'] as const).map(channel => {
    const latest = books.optIns.filter(o => o.recordId === entry.id && o.channel === channel).at(-1);
    return latest ? { channel, answer: latest.answer, source: latest.source, on: latest.on } : { channel, answer: 'not-asked' as const, source: null, on: null };
  });
  return { id: entry.id, kind: entry.kind, name: nameOf(entry), details: [...details.values()], owes: await owes(host, ctx, entry),
    timeline: [...entry.facts].sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.entityId.localeCompare(b.entityId))
      .map(f => ({ at: f.validFrom, kind: f.kind, amount: amountOf(f.fields.amountMinor), sourceId: f.sourceId, ref: str(f.fields.invoiceId) ? f.fields.invoiceId : f.entityId })),
    optIn, stoppedOn: books.stops.filter(s => s.recordId === entry.id).at(-1)?.on ?? null };
}

// Same customer or not (BK-13).
function badId(kind: 'GSTIN' | 'PAN', value: string): string {
  const expected = kind === 'GSTIN' ? 15 : 10;
  return value.length !== expected ? `This ${kind} has ${value.length} characters.` : `This ${kind} does not pass its format check.`;
}
function identity(entry: RecordEntry) {
  const values = (field: string) => [...new Set(entry.facts.map(f => f.fields[field]).filter(str).map(v => v.trim()))];
  const gstins = values('gstin'), pans = values('pan');
  return { gstins, pans, bad: [...gstins.filter(g => !gstinValid(g)).map(g => badId('GSTIN', g)), ...pans.filter(p => !PAN.test(p)).map(p => badId('PAN', p))],
    badIds: [...gstins.filter(g => !gstinValid(g)).map((g: string) => ({ kind: 'GSTIN' as const, length: g.length, expected: 15 })), ...pans.filter(p => !PAN.test(p)).map(p => ({ kind: 'PAN' as const, length: p.length, expected: 10 }))],
    phones: values('phone').map(p => p.replace(/\D/g, '').slice(-10)).filter(p => p.length === 10), emails: values('email').map(e => e.toLowerCase()), names: values('customerName').map(n => n.toLowerCase().replace(/\s+/g, ' ')) };
}
const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
/** `badIds`: a GSTIN or PAN that failed its format check, not used as evidence (the screen says why in the person's language). */
type BadId = { kind: 'GSTIN' | 'PAN'; length: number; expected: number };
type Pair = { left: string; right: string; relation: string; evidence: string[]; reason: string; badIds: BadId[]; state: 'open' | 'joined' | 'not-same'; mergeId: string | null };
const DISPUTED_REASON = 'One of these customers appears only in records that sources disagree on, so their tax identities are not compared. Settle the disagreement first.';
/** Both customers have at least one selected (not disputed) fact, so the memory service can compare them. */
const comparable = (records: Map<string, RecordEntry>, left: string, right: string) => (records.get(left)?.selected ?? 0) > 0 && (records.get(right)?.selected ?? 0) > 0;
function evaluate(host: ModuleHost, ctx: Context, records: Map<string, RecordEntry>, left: string, right: string): Omit<Pair, 'state' | 'mergeId'> {
  const suggestion = comparable(records, left, right) ? (host.services.memory as MemoryService).suggestCustomerMatch(ctx, left, right) : { relation: 'abstain', reason: DISPUTED_REASON };
  const a = identity(records.get(left)!), b = identity(records.get(right)!); const evidence: string[] = [];
  evidence.push(...({ 'same-tax-registration': ['same-gstin'], 'same-owner-separate-registrations': ['same-pan'], 'cannot-match-tax-identities': ['different-pan'] } as Record<string, string[]>)[suggestion.relation] ?? []);
  if (a.phones.some(p => b.phones.includes(p))) evidence.push('same-phone');
  if (a.emails.some(e => b.emails.includes(e))) evidence.push('same-email');
  if (a.names.some(n => b.names.includes(n))) evidence.push('same-name');
  const bad = [...new Set([...a.bad, ...b.bad])];
  const badIds = [...new Map([...a.badIds, ...b.badIds].map(x => [JSON.stringify(x), x])).values()];
  return { left, right, relation: suggestion.relation, evidence, reason: [suggestion.reason, ...bad.map(r => `${r} It is not used as evidence.`)].join(' '), badIds };
}
function candidates(records: Map<string, RecordEntry>): [string, string][] {
  const byKey = new Map<string, string[]>();
  for (const entry of records.values()) {
    if (entry.kind !== 'customer') continue;
    const id = identity(entry); const keys = new Set<string>();
    for (const g of id.gstins) { const pan = g.slice(2, 12); if (PAN.test(pan)) keys.add(`pan:${pan}`); }
    for (const p of id.pans) if (PAN.test(p)) keys.add(`pan:${p}`);
    for (const p of id.phones) keys.add(`phone:${p}`); for (const e of id.emails) keys.add(`email:${e}`);
    for (const key of keys) byKey.set(key, [...(byKey.get(key) ?? []), entry.id]);
  }
  const pairs = new Map<string, [string, string]>();
  for (const ids of byKey.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const [l, r] = [ids[i], ids[j]].sort(); pairs.set(pairKey(l, r), [l, r]); }
  return [...pairs.values()].sort((x, y) => pairKey(...x).localeCompare(pairKey(...y)));
}
function storedState(state: State, decision: MatchDecision | undefined): Pick<Pair, 'state' | 'mergeId'> {
  if (!decision || decision.state === 'open') return { state: 'open', mergeId: null };
  if (decision.state === 'joined' && decision.mergeId && !state.merges.some(m => m.type === 'undo' && m.mergeId === decision.mergeId)) return { state: 'joined', mergeId: decision.mergeId };
  return { state: decision.state === 'not-same' ? 'not-same' : 'open', mergeId: null };
}
function matchPairs(host: ModuleHost, ctx: Context): Pair[] {
  const state = host.store.read(); const records = collectRecords(host, ctx); const visible = visibleRecordIds(host, ctx, records);
  // A stored decision is shown only when the caller can see both of its records.
  const decisions = peekBooks(state).matches.filter(d => visible.has(d.left) && visible.has(d.right));
  const latest = (key: string) => decisions.filter(d => pairKey(d.left, d.right) === key).at(-1);
  const pairs: Pair[] = candidates(records).map(([l, r]) => ({ ...evaluate(host, ctx, records, l, r), ...storedState(state, latest(pairKey(l, r))) }));
  const seen = new Set(pairs.map(p => pairKey(p.left, p.right)));
  for (const d of decisions) { const key = pairKey(d.left, d.right); if (seen.has(key)) continue; seen.add(key); const last = latest(key)!;
    pairs.push({ left: last.left, right: last.right, relation: last.relation, evidence: [...last.evidence], reason: last.reason, badIds: [], ...storedState(state, last) }); }
  return pairs;
}

/**
 * Prepared or approved actions that depend on a join: made after the join and before its undo,
 * not yet attempted, naming one of the joined customers in their request or sources. Each is
 * cancelled through its owner: core actions through `ActionService.cancel`, write-back actions
 * through `writeback.drop`. Nothing is changed in place here; one that cannot be cancelled is
 * listed with its code.
 */
export function dependentActions(state: State, mergeId: string): PreparedAction[] {
  const merge = state.merges.find(m => m.id === mergeId && m.type === 'merge'); if (!merge) return [];
  const undo = state.merges.find(m => m.type === 'undo' && m.mergeId === mergeId);
  const ids: string[] = (Array.isArray(merge.entityIds) ? merge.entityIds as unknown[] : []).filter((id: unknown): id is string => typeof id === 'string');
  return (state.actions as PreparedAction[]).filter(a => a && (a.status === 'prepared' || a.status === 'approved') && Array.isArray(a.attempts) && a.attempts.length === 0
    && typeof a.createdAt === 'string' && a.createdAt >= merge.at && (!undo || a.createdAt <= undo.at)
    && ids.some(id => mentions(a.payload, id) || (Array.isArray(a.sourceIds) && a.sourceIds.includes(id))));
}
async function cancelDependents(host: ModuleHost, ctx: Context, mergeId: string): Promise<{ cancelled: string[]; notCancelled: { id: string; code: string }[] }> {
  const cancelled: string[] = [], notCancelled: { id: string; code: string }[] = [];
  const actions = host.services.actions as ActionService | undefined;
  for (const action of dependentActions(host.store.read(), mergeId)) {
    try {
      if (action.connector.startsWith('wb-')) await host.call('writeback.drop', { id: action.id });
      else { check(actions, 'ACTIONS_NOT_AVAILABLE', 'Actions are not available here.'); await actions.cancel(ctx, action.id); }
      cancelled.push(action.id);
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      notCancelled.push({ id: action.id, code: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'CANCEL_FAILED' });
    }
  }
  return { cancelled, notCancelled };
}

// Sources that disagree (BK-14).
function conflicts(host: ModuleHost, ctx: Context) {
  const state = host.store.read(); const at = now();
  const visible = state.facts.filter(f => !f.deletedAt && f.learnedAt <= at && canSeeFact(host.store, ctx, f));
  const tombstoned = new Set(state.tombstones.map(t => t.factId ?? t.id));
  const latest = new Map<string, Fact>();
  for (const f of visible) { if (tombstoned.has(f.id)) continue; const key = JSON.stringify([f.sourceId, f.kind, f.entityId]); const prev = latest.get(key); if (!prev || f.learnedAt >= prev.learnedAt) latest.set(key, f); }
  const groups = new Map<string, Fact[]>(); for (const f of latest.values()) { const key = JSON.stringify([f.kind, f.entityId]); groups.set(key, [...(groups.get(key) ?? []), f]); }
  // A precedence rule is shown only when every source it names is visible to the caller.
  const rules = new Map<string, string[]>();
  for (const r of state.sourceRules) if (typeof r?.kind === 'string' && Array.isArray(r.sourceIds)) {
    if (r.sourceIds.every((s: unknown) => typeof s === 'string' && sourceVisible(host.store, ctx, s))) rules.set(r.kind, [...r.sourceIds]); else rules.delete(r.kind);
  }
  const shown = (f: Fact) => Object.fromEntries(Object.entries(f.fields).filter(([k, v]) => !k.startsWith('_') && v !== undefined && v !== null).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const list = [];
  for (const claims of groups.values()) {
    if (claims.length < 2) continue;
    if (new Set(claims.map(f => hash({ validFrom: f.validFrom, validTo: f.validTo, fields: shown(f), branch: f.branch }))).size < 2) continue;
    const order = rules.get(claims[0].kind) ?? []; const picked = order.find(s => claims.some(f => f.sourceId === s)) ?? null;
    list.push({ entityId: claims[0].entityId, kind: claims[0].kind, claims: claims.sort((a, b) => a.sourceId.localeCompare(b.sourceId)).map(f => ({ sourceId: f.sourceId, fields: { validFrom: f.validFrom, ...shown(f) } })),
      rule: order.length ? order.join(' > ') : null, picked });
  }
  return { conflicts: list, rules: [...rules.entries()].map(([kind, sourceIds]) => ({ kind, sourceIds })) };
}

export const recordMethods: Record<string, MethodSpec> = {
  'records.search': { permission: 'read', handler(ctx, payload, host) {
    const request = input(payload, ['kind', 'text']);
    check((request.kind === undefined || ['customer', 'supplier', 'item'].includes(request.kind)) && (request.text === undefined || typeof request.text === 'string' && request.text.length <= 200), 'INVALID_BOOKS_REQUEST', 'Filter by customer, supplier or item and by text.');
    const needle = (request.text ?? '').trim().toLowerCase();
    return { records: [...collectRecords(host, ctx).values()].filter(r => (!request.kind || r.kind === request.kind) && (!needle || r.id.toLowerCase().includes(needle) || (nameOf(r) ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => a.id.localeCompare(b.id)).map(r => ({ id: r.id, kind: r.kind, name: nameOf(r), sources: [...new Set(r.facts.map(f => f.sourceId))].sort(), facts: r.facts.length })) };
  } },
  'records.get': { permission: 'read', handler(ctx, payload, host) { const { id } = input(payload, ['id'], ['id']); return recordView(host, ctx, id); } },
  'records.setOptIn': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['id', 'channel', 'answer', 'source', 'on'], ['id', 'channel', 'answer', 'source', 'on']);
    check(['mail', 'whatsapp'].includes(request.channel) && ['yes', 'no'].includes(request.answer) && text(request.source, 300) && isoDay(request.on), 'INVALID_BOOKS_REQUEST', 'Give the channel, the answer, where it came from and the date.');
    check(!ctx.sourceTainted, 'TAINTED_CONSENT', 'Only a person records what a customer agreed to. Imported text cannot.');
    const entry = findRecord(host, ctx, request.id); const who = member(host.store.read(), ctx);
    await writeBooks(host.store, ctx, 'prepare', books => { room(books.optIns, LIMITS.optIns); books.optIns.push({ recordId: entry.id, channel: request.channel, answer: request.answer, source: request.source, on: request.on, by: who.name, at: now() }); });
    return recordView(host, ctx, entry.id);
  } },
  'records.stop': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['id', 'on'], ['id', 'on']); check(isoDay(request.on), 'INVALID_BOOKS_REQUEST', 'Give the date the stop word arrived.');
    check(!ctx.sourceTainted, 'TAINTED_CONSENT', 'Only a person records a stop word. Imported text cannot.');
    const entry = findRecord(host, ctx, request.id); const who = member(host.store.read(), ctx);
    await writeBooks(host.store, ctx, 'prepare', books => { room(books.stops, LIMITS.stops); books.stops.push({ recordId: entry.id, on: request.on, by: who.name, at: now() }); });
    return recordView(host, ctx, entry.id);
  } },
  'records.matches': { permission: 'read', handler(ctx, payload, host) { input(payload, []); return { pairs: matchPairs(host, ctx) }; } },
  'records.decideMatch': { permission: 'approve', async handler(ctx, payload, host) {
    const request = input(payload, ['left', 'right', 'same'], ['left', 'right', 'same']);
    check(plainId(request.left) && plainId(request.right) && request.left !== request.right && typeof request.same === 'boolean', 'INVALID_BOOKS_REQUEST', 'Name two different customers and whether they are the same.');
    const records = collectRecords(host, ctx);
    for (const id of [request.left, request.right]) check(records.get(id)?.kind === 'customer', 'RECORD_NOT_FOUND', 'Both records must be customers available to you.');
    check(comparable(records, request.left, request.right), 'RECORD_DISPUTED', 'One of these customers appears only in records that sources disagree on. Settle the disagreement first.');
    const pair = evaluate(host, ctx, records, request.left, request.right); const who = member(host.store.read(), ctx);
    room(peekBooks(host.store.read()).matches, LIMITS.matches);
    let mergeId: string | null = null;
    if (request.same) {
      check(pair.relation !== 'cannot-match-tax-identities', 'MATCH_FORBIDDEN', 'Two different PANs cannot be the same customer.');
      mergeId = (await (host.services.memory as MemoryService).merge(ctx, [request.left, request.right], request.left)).id;
    }
    const { badIds: _bad, ...kept } = pair;
    const decision: MatchDecision = { ...kept, state: request.same ? 'joined' : 'not-same', mergeId, undoneMergeId: null, by: who.name, role: who.role, at: now() };
    await writeBooks(host.store, ctx, 'approve', books => { room(books.matches, LIMITS.matches); books.matches.push(decision); });
    return { ...pair, state: decision.state, mergeId };
  } },
  'records.undoMatch': { permission: 'approve', async handler(ctx, payload, host) {
    const { mergeId } = input(payload, ['mergeId'], ['mergeId']);
    const visible = visibleRecordIds(host, ctx);
    const decision = typeof mergeId === 'string' ? peekBooks(host.store.read()).matches.find(d => d.mergeId === mergeId) : undefined;
    check(decision && visible.has(decision.left) && visible.has(decision.right), 'MATCH_NOT_FOUND', 'This join was not found.');
    await (host.services.memory as MemoryService).undoMerge(ctx, mergeId);
    // Any approval that depended on the join is cancelled (BK-13): only through the action's own service.
    const settled = await cancelDependents(host, ctx, mergeId);
    const who = member(host.store.read(), ctx);
    const reopened: MatchDecision = { ...structuredClone(decision), state: 'open', mergeId: null, undoneMergeId: mergeId, by: who.name, role: who.role, at: now() };
    await writeBooks(host.store, ctx, 'approve', books => { books.matches.push(reopened); });
    return { left: reopened.left, right: reopened.right, relation: reopened.relation, evidence: reopened.evidence, reason: reopened.reason, badIds: [], state: 'open' as const, mergeId: null, ...settled };
  } },
  'records.conflicts': { permission: 'read', handler(ctx, payload, host) { input(payload, []); return conflicts(host, ctx); } },
  'records.setPrecedence': { permission: 'admin', async handler(ctx, payload, host) {
    const request = input(payload, ['kind', 'sourceIds'], ['kind', 'sourceIds']);
    check(typeof request.kind === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(request.kind) && Array.isArray(request.sourceIds) && request.sourceIds.length <= 64 && request.sourceIds.every(plainId), 'INVALID_BOOKS_REQUEST', 'Name the kind of fact and the sources in order.');
    const rule = await (host.services.memory as MemoryService).setSourcePrecedence(ctx, request.kind, request.sourceIds);
    return { kind: rule.kind, sourceIds: [...rule.sourceIds] };
  } },
  'records.optIn': { permission: 'read', handler(ctx, payload, host) {
    const { customerId } = input(payload, ['customerId'], ['customerId']); const entry = findRecord(host, ctx, customerId);
    const books = peekBooks(host.store.read()); const stoppedAt = books.stops.filter(s => s.recordId === entry.id).at(-1)?.on ?? null;
    return { channels: (['mail', 'whatsapp'] as const).map(channel => {
      const latest = books.optIns.filter(o => o.recordId === entry.id && o.channel === channel).at(-1);
      return { channel, agreed: latest?.answer ?? 'not-asked' as const, source: latest?.source ?? null, at: latest?.on ?? null, stoppedAt };
    }) };
  } },
  'records.holdings': { permission: 'read', handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']); return { stores: holdingsOf(host, ctx, id) };
  } },
};

/** Every store that holds something about one record, counted only as far as the caller can see. */
export function holdingsOf(host: ModuleHost, ctx: Context, id: unknown, recount = false): { store: string; count: number }[] {
  // Round 4 (BK-20): `recount` counts again after a deletion, when the record may no longer be in any fact.
  { const entry = recount && plainId(id) ? { id } : findRecord(host, ctx, id); const state = host.store.read(); const books = peekBooks(state);
    const ids = recordIdsOf(state, entry.id);
    const about = (value: unknown) => [...ids].some(i => mentions(value, i));
    const factIds = new Set(state.facts.filter(f => !f.deletedAt && canSeeFact(host.store, ctx, f) && [...ids].some(i => resolveCustomer(state, f.fields.customerId, now()) === i || references(f).some(([, r]) => r === i))).map(f => f.id));
    // Only what the caller can see is counted: own receipts, answers and conversations, actions under core's access rule, visible memory lines and matches.
    const ownReceipts = state.receipts.filter(r => r?.memberId === ctx.memberId);
    const receipts = ownReceipts.filter(r => about(r.rows) || (r.rowIds ?? []).some((rid: string) => factIds.has(rid)));
    const receiptIds = new Set(receipts.map(r => r.id)), ownReceiptIds = new Set(ownReceipts.map(r => r.id));
    const actions = host.services.actions as ActionService | undefined;
    const canSeeAction = (action: PreparedAction) => {
      try {
        if (typeof actions?.access === 'function') actions.access(state, ctx, action);
        else { sourceAccess(state, ctx, Array.isArray(action.sourceIds) ? action.sourceIds : []); check((action.sourceIds?.length ?? 0) > 0 || action.createdBy === ctx.memberId, 'ACTION_FORBIDDEN', 'This private local action belongs to another account.'); }
        return true;
      } catch { return false; }
    };
    const visible = visibleRecordIds(host, ctx);
    return [
      { store: 'facts', count: factIds.size }, { store: 'receipts', count: receipts.length },
      { store: 'answers', count: state.answers.filter(a => ownReceiptIds.has(a?.receiptId) && (receiptIds.has(a.receiptId) || about(a.request))).length },
      { store: 'actions', count: (state.actions as PreparedAction[]).filter(a => about(a) && canSeeAction(a)).length },
      { store: 'conversations', count: state.conversations.filter(c => c?.memberId === ctx.memberId && about(c)).length },
      { store: 'memory', count: books.memory.filter(l => !l.deletedAt && l.text !== null && visibleMemoryLine(host.store, ctx, l, host) && lineNames(l, ids)).length },
      { store: 'opt-ins', count: books.optIns.filter(o => ids.has(o.recordId)).length + books.stops.filter(s => ids.has(s.recordId)).length },
      { store: 'matches', count: books.matches.filter(m => (ids.has(m.left) || ids.has(m.right)) && visible.has(m.left) && visible.has(m.right)).length },
    ];
  }
}
/** The record ids a deletion of `id` covers: the record and every id joined with it. */
export function recordIdsOf(state: State, id: string): Set<string> {
  // The same rule as the memory service's resolveCustomer: a join that was undone no longer joins anything.
  const undone = new Set(state.merges.filter(m => m.type === 'undo').map(m => m.mergeId));
  return new Set([id, ...state.merges.filter(m => m.type === 'merge' && !undone.has(m.id) && Array.isArray(m.entityIds) && m.entityIds.includes(id))
    .flatMap(m => (m.entityIds as unknown[]).filter((e): e is string => typeof e === 'string'))]);
}
/** A memory line about one of `ids`: the exact id as a whole word, never inside a longer id. */
export const lineNames = (line: { text: string | null }, ids: Set<string>) => line.text !== null && [...ids].some(i => namesId(line.text!, i));
