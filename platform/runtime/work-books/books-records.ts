/**
 * Records (BK-12, BK-13, BK-14, BK-20): customers, suppliers and items read from facts, with
 * where each detail came from; joining two customers (and undoing it) through the memory
 * service; sources that disagree; and what the workspace holds about one record.
 */
import { check, hash, now, type Context, type Fact, type State } from '../contracts.ts';
import type { CalculatorService } from '../calculator.ts';
import { canSeeFact, gstinValid, resolveCustomer, selectFacts, type MemoryService } from '../memory.ts';
import type { OntologyService } from '../ontology.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { amountOf, input, isoDay, member, mentions, peekBooks, plainId, text, writeBooks, type Amount, type MatchDecision } from './books-common.ts';

type Kind = 'customer' | 'supplier' | 'item';
type RecordEntry = { id: string; kind: Kind; facts: Fact[] };
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
  for (const fact of [...selection.facts, ...disputed]) for (const [kind, id] of references(fact)) {
    const entry = records.get(id) ?? { id, kind, facts: [] }; entry.facts.push(fact); records.set(id, entry);
  }
  return records;
}
const nameOf = (entry: RecordEntry) => { const field = `${entry.kind}Name`; return (entry.facts.map(f => f.fields[field]).find(str) as string | undefined) ?? null; };
function findRecord(host: ModuleHost, ctx: Context, id: unknown): RecordEntry {
  check(plainId(id), 'INVALID_REQUEST', 'Name the record.'); const entry = collectRecords(host, ctx).get(id); check(entry, 'RECORD_NOT_FOUND', 'This record is not available to you.'); return entry;
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
    phones: values('phone').map(p => p.replace(/\D/g, '').slice(-10)).filter(p => p.length === 10), emails: values('email').map(e => e.toLowerCase()), names: values('customerName').map(n => n.toLowerCase().replace(/\s+/g, ' ')) };
}
const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
type Pair = { left: string; right: string; relation: string; evidence: string[]; reason: string; state: 'open' | 'joined' | 'not-same'; mergeId: string | null };
function evaluate(host: ModuleHost, ctx: Context, records: Map<string, RecordEntry>, left: string, right: string): Omit<Pair, 'state' | 'mergeId'> {
  const suggestion = (host.services.memory as MemoryService).suggestCustomerMatch(ctx, left, right);
  const a = identity(records.get(left)!), b = identity(records.get(right)!); const evidence: string[] = [];
  evidence.push(...({ 'same-tax-registration': ['same-gstin'], 'same-owner-separate-registrations': ['same-pan'], 'cannot-match-tax-identities': ['different-pan'] } as Record<string, string[]>)[suggestion.relation] ?? []);
  if (a.phones.some(p => b.phones.includes(p))) evidence.push('same-phone');
  if (a.emails.some(e => b.emails.includes(e))) evidence.push('same-email');
  if (a.names.some(n => b.names.includes(n))) evidence.push('same-name');
  const bad = [...new Set([...a.bad, ...b.bad])];
  return { left, right, relation: suggestion.relation, evidence, reason: [suggestion.reason, ...bad.map(r => `${r} It is not used as evidence.`)].join(' ') };
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
  const state = host.store.read(); const records = collectRecords(host, ctx); const decisions = peekBooks(state).matches;
  const latest = (key: string) => decisions.filter(d => pairKey(d.left, d.right) === key).at(-1);
  const pairs: Pair[] = candidates(records).map(([l, r]) => ({ ...evaluate(host, ctx, records, l, r), ...storedState(state, latest(pairKey(l, r))) }));
  const seen = new Set(pairs.map(p => pairKey(p.left, p.right)));
  for (const d of decisions) { const key = pairKey(d.left, d.right); if (seen.has(key)) continue; seen.add(key); const last = latest(key)!;
    pairs.push({ left: last.left, right: last.right, relation: last.relation, evidence: [...last.evidence], reason: last.reason, ...storedState(state, last) }); }
  return pairs;
}

// Sources that disagree (BK-14).
function conflicts(host: ModuleHost, ctx: Context) {
  const state = host.store.read(); const at = now();
  const visible = state.facts.filter(f => !f.deletedAt && f.learnedAt <= at && canSeeFact(host.store, ctx, f));
  const tombstoned = new Set(state.tombstones.map(t => t.factId ?? t.id));
  const latest = new Map<string, Fact>();
  for (const f of visible) { if (tombstoned.has(f.id)) continue; const key = JSON.stringify([f.sourceId, f.kind, f.entityId]); const prev = latest.get(key); if (!prev || f.learnedAt >= prev.learnedAt) latest.set(key, f); }
  const groups = new Map<string, Fact[]>(); for (const f of latest.values()) { const key = JSON.stringify([f.kind, f.entityId]); groups.set(key, [...(groups.get(key) ?? []), f]); }
  const rules = new Map<string, string[]>(); for (const r of state.sourceRules) if (typeof r?.kind === 'string' && Array.isArray(r.sourceIds)) rules.set(r.kind, [...r.sourceIds]);
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
    check((request.kind === undefined || ['customer', 'supplier', 'item'].includes(request.kind)) && (request.text === undefined || typeof request.text === 'string' && request.text.length <= 200), 'INVALID_REQUEST', 'Filter by customer, supplier or item and by text.');
    const needle = (request.text ?? '').trim().toLowerCase();
    return { records: [...collectRecords(host, ctx).values()].filter(r => (!request.kind || r.kind === request.kind) && (!needle || r.id.toLowerCase().includes(needle) || (nameOf(r) ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => a.id.localeCompare(b.id)).map(r => ({ id: r.id, kind: r.kind, name: nameOf(r), sources: [...new Set(r.facts.map(f => f.sourceId))].sort(), facts: r.facts.length })) };
  } },
  'records.get': { permission: 'read', handler(ctx, payload, host) { const { id } = input(payload, ['id'], ['id']); return recordView(host, ctx, id); } },
  'records.setOptIn': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['id', 'channel', 'answer', 'source', 'on'], ['id', 'channel', 'answer', 'source', 'on']);
    check(['mail', 'whatsapp'].includes(request.channel) && ['yes', 'no'].includes(request.answer) && text(request.source, 300) && isoDay(request.on), 'INVALID_REQUEST', 'Give the channel, the answer, where it came from and the date.');
    const entry = findRecord(host, ctx, request.id); const who = member(host.store.read(), ctx);
    await writeBooks(host.store, ctx, 'prepare', books => { books.optIns.push({ recordId: entry.id, channel: request.channel, answer: request.answer, source: request.source, on: request.on, by: who.name, at: now() }); });
    return recordView(host, ctx, entry.id);
  } },
  'records.stop': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['id', 'on'], ['id', 'on']); check(isoDay(request.on), 'INVALID_REQUEST', 'Give the date the stop word arrived.');
    const entry = findRecord(host, ctx, request.id); const who = member(host.store.read(), ctx);
    await writeBooks(host.store, ctx, 'prepare', books => { books.stops.push({ recordId: entry.id, on: request.on, by: who.name, at: now() }); });
    return recordView(host, ctx, entry.id);
  } },
  'records.matches': { permission: 'read', handler(ctx, payload, host) { input(payload, []); return { pairs: matchPairs(host, ctx) }; } },
  'records.decideMatch': { permission: 'approve', async handler(ctx, payload, host) {
    const request = input(payload, ['left', 'right', 'same'], ['left', 'right', 'same']);
    check(plainId(request.left) && plainId(request.right) && request.left !== request.right && typeof request.same === 'boolean', 'INVALID_REQUEST', 'Name two different customers and whether they are the same.');
    const records = collectRecords(host, ctx);
    for (const id of [request.left, request.right]) check(records.get(id)?.kind === 'customer', 'RECORD_NOT_FOUND', 'Both records must be customers available to you.');
    const pair = evaluate(host, ctx, records, request.left, request.right); const who = member(host.store.read(), ctx);
    let mergeId: string | null = null;
    if (request.same) {
      check(pair.relation !== 'cannot-match-tax-identities', 'MATCH_FORBIDDEN', 'Two different PANs cannot be the same customer.');
      mergeId = (await (host.services.memory as MemoryService).merge(ctx, [request.left, request.right], request.left)).id;
    }
    const decision: MatchDecision = { ...pair, state: request.same ? 'joined' : 'not-same', mergeId, undoneMergeId: null, by: who.name, role: who.role, at: now() };
    await writeBooks(host.store, ctx, 'approve', books => { books.matches.push(decision); });
    return { ...pair, state: decision.state, mergeId };
  } },
  'records.undoMatch': { permission: 'approve', async handler(ctx, payload, host) {
    const { mergeId } = input(payload, ['mergeId'], ['mergeId']);
    const decision = typeof mergeId === 'string' ? peekBooks(host.store.read()).matches.find(d => d.mergeId === mergeId) : undefined; check(decision, 'MATCH_NOT_FOUND', 'This join was not found.');
    await (host.services.memory as MemoryService).undoMerge(ctx, mergeId);
    const who = member(host.store.read(), ctx);
    const reopened: MatchDecision = { ...structuredClone(decision), state: 'open', mergeId: null, undoneMergeId: mergeId, by: who.name, role: who.role, at: now() };
    await writeBooks(host.store, ctx, 'approve', books => { books.matches.push(reopened); });
    return { left: reopened.left, right: reopened.right, relation: reopened.relation, evidence: reopened.evidence, reason: reopened.reason, state: 'open' as const, mergeId: null };
  } },
  'records.conflicts': { permission: 'read', handler(ctx, payload, host) { input(payload, []); return conflicts(host, ctx); } },
  'records.setPrecedence': { permission: 'admin', async handler(ctx, payload, host) {
    const request = input(payload, ['kind', 'sourceIds'], ['kind', 'sourceIds']);
    check(typeof request.kind === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(request.kind) && Array.isArray(request.sourceIds) && request.sourceIds.length <= 64 && request.sourceIds.every(plainId), 'INVALID_REQUEST', 'Name the kind of fact and the sources in order.');
    const rule = await (host.services.memory as MemoryService).setSourcePrecedence(ctx, request.kind, request.sourceIds);
    return { kind: rule.kind, sourceIds: [...rule.sourceIds] };
  } },
  'records.holdings': { permission: 'read', handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']); const entry = findRecord(host, ctx, id); const state = host.store.read(); const books = peekBooks(state);
    const ids = new Set([entry.id, ...state.merges.filter(m => m.type === 'merge' && Array.isArray(m.entityIds) && m.entityIds.includes(entry.id)).flatMap(m => m.entityIds as string[])]);
    const about = (value: unknown) => [...ids].some(i => mentions(value, i));
    const factIds = new Set(state.facts.filter(f => !f.deletedAt && canSeeFact(host.store, ctx, f) && [...ids].some(i => resolveCustomer(state, f.fields.customerId, now()) === i || references(f).some(([, r]) => r === i))).map(f => f.id));
    const receipts = state.receipts.filter(r => r.memberId === ctx.memberId && (about(r.rows) || (r.rowIds ?? []).some((rid: string) => factIds.has(rid))));
    const receiptIds = new Set(receipts.map(r => r.id));
    return { stores: [
      { store: 'facts', count: factIds.size }, { store: 'receipts', count: receipts.length },
      { store: 'answers', count: state.answers.filter(a => receiptIds.has(a.receiptId) || about(a.request)).length },
      { store: 'actions', count: state.actions.filter(about).length }, { store: 'conversations', count: state.conversations.filter(about).length },
      { store: 'memory', count: books.memory.filter(l => !l.deletedAt && l.text !== null && [...ids].some(i => l.text!.includes(i))).length },
      { store: 'opt-ins', count: books.optIns.filter(o => ids.has(o.recordId)).length + books.stops.filter(s => ids.has(s.recordId)).length },
      { store: 'matches', count: books.matches.filter(m => ids.has(m.left) || ids.has(m.right)).length },
    ] };
  } },
};
