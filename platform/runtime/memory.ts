import { authorize, audit, check, hash, newId, now, type Context, type Fact, type State, type StateStore } from './contracts.ts';
import { assertSourceAccess, sourceAllowed } from './trust.ts';

export type FactInput = { entityId: string; sourceId: string; sourceRow: number; kind: string; validFrom: string; validTo?: string | null; fields: Record<string, unknown>; branch?: string };
export type Period = { from: string; to: string };
export type FactFilter = { period?: Period; asOf?: string; branch?: string; customerId?: string; orderId?: string; kinds?: string[] };
export type FactSelection = { facts: Fact[]; conflicts: { entityId: string; kind: string; rowIds: string[]; reason: string }[]; excluded: { rowId: string; reason: string }[]; asOf: string };
export function validDate(value: unknown): value is string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; }
export function gstinValid(input: unknown): input is string {
  if (typeof input !== 'string' || !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(input)) return false;
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let sum = 0, factor = 2;
  for (let i = 13; i >= 0; i--) { const product = alphabet.indexOf(input[i]) * factor; sum += Math.floor(product / 36) + product % 36; factor = factor === 2 ? 1 : 2; }
  return input[14] === alphabet[(36 - sum % 36) % 36];
}
export function validatePeriod(period?: Period) { if (period) check(Object.keys(period).length === 2 && validDate(period.from) && validDate(period.to) && period.from <= period.to, 'INVALID_PERIOD', 'Use an inclusive period with valid from and to dates.'); }
export function currentAccess(store: StateStore, ctx: Context, branch?: string, sourceId?: string) {
  const member = authorize(store, ctx);
  if (branch) check(member.branches.includes('*') || member.branches.includes(branch), 'FORBIDDEN_BRANCH', 'This branch is outside your current access.');
  if (sourceId) assertSourceAccess(store.read(), ctx, [sourceId]);
  return member;
}
export function canSeeFact(store: StateStore, ctx: Context, fact: Fact) { const member = authorize(store, ctx); return (member.branches.includes('*') || (!!fact.branch && member.branches.includes(fact.branch))) && sourceAllowed(store.read(), ctx, fact.sourceId); }
export function markStale(state: State, reason: string) { for (const item of [...state.answers, ...state.receipts]) { item.stale = true; item.staleReason = reason; } }
export function resolveCustomer(state: State, customerId: unknown, asOf: string): unknown {
  if (typeof customerId !== 'string') return customerId;
  const undone = new Set(state.merges.filter(m => m.type === 'undo' && m.at <= asOf).map(m => m.mergeId));
  let current = customerId; const visited = new Set<string>();
  for (let i = 0; i < state.merges.length + 1; i++) {
    check(!visited.has(current), 'MERGE_CYCLE', 'Customer aliases form a cycle.'); visited.add(current);
    const matching = state.merges.filter(m => m.type === 'merge' && m.at <= asOf && !undone.has(m.id) && m.entityIds.includes(current)).at(-1);
    if (!matching || matching.targetId === current) return current;
    current = matching.targetId;
  }
  return current;
}
export function selectFacts(store: StateStore, ctx: Context, filter: FactFilter = {}): FactSelection {
  currentAccess(store, ctx, filter.branch); validatePeriod(filter.period);
  const state = store.read(); const asOf = filter.asOf ?? now();
  check(typeof asOf === 'string' && Number.isFinite(Date.parse(asOf)), 'INVALID_ASOF', 'The known-on time must be an ISO timestamp.');
  const normalized = new Date(asOf).toISOString();
  const tombstones = new Set(state.tombstones.map(t => t.factId ?? t.id));
  const excluded: FactSelection['excluded'] = [];
  const visible = state.facts.filter(f => !f.deletedAt && !tombstones.has(f.id) && canSeeFact(store, ctx, f) && (!filter.branch || f.branch === filter.branch) && f.learnedAt <= normalized);
  const sourceLatest = new Map<string, Fact>();
  for (const f of visible) {
    const key = `${f.sourceId}\u0000${f.kind}\u0000${f.entityId}`;
    const previous = sourceLatest.get(key);
    if (!previous || f.learnedAt > previous.learnedAt || (f.learnedAt === previous.learnedAt && state.facts.indexOf(f) > state.facts.indexOf(previous))) { if (previous) excluded.push({ rowId: previous.id, reason: 'Superseded source version.' }); sourceLatest.set(key, f); }
    else excluded.push({ rowId: f.id, reason: 'Superseded source version.' });
  }
  const groups = new Map<string, Fact[]>();
  for (const f of sourceLatest.values()) { const key = `${f.kind}\u0000${f.entityId}`; groups.set(key, [...(groups.get(key) ?? []), f]); }
  const conflicts: FactSelection['conflicts'] = []; const selected: Fact[] = [];
  for (const claims of groups.values()) {
    let winner: Fact | undefined = claims[0];
    if (claims.length > 1) {
      const latestRule = state.sourceRules.filter(r => r.kind === claims[0].kind && r.at <= normalized).at(-1);
      const valueHashes = new Set(claims.map(f => hash({ validFrom: f.validFrom, validTo: f.validTo, fields: Object.fromEntries(Object.entries(f.fields).filter(([k]) => !k.startsWith('_'))), branch: f.branch })));
      if (latestRule?.sourceIds?.length) {
        winner = latestRule.sourceIds.map((s: string) => claims.find(f => f.sourceId === s)).find(Boolean);
      } else if (valueHashes.size > 1) winner = undefined;
      if (!winner) {
        const relevant = claims.some(f => (!filter.kinds || filter.kinds.includes(f.kind)) && (!filter.period || (f.validFrom >= filter.period.from && f.validFrom <= filter.period.to)) && (!filter.customerId || resolveCustomer(state, f.fields.customerId, normalized) === resolveCustomer(state, filter.customerId, normalized)) && (!filter.orderId || f.fields.orderId === filter.orderId));
        if (relevant) { conflicts.push({ entityId: claims[0].entityId, kind: claims[0].kind, rowIds: claims.map(f => f.id), reason: 'Sources disagree and no published source rule selects a claim.' }); claims.forEach(f => excluded.push({ rowId: f.id, reason: 'Unresolved source conflict.' })); }
        continue;
      }
      claims.filter(f => f.id !== winner!.id).forEach(f => excluded.push({ rowId: f.id, reason: valueHashes.size === 1 ? 'Duplicate claim across sources.' : 'A published source rule selected another claim.' }));
    }
    if (!winner) continue;
    if (filter.kinds && !filter.kinds.includes(winner.kind)) continue;
    if (filter.period && (winner.validFrom < filter.period.from || winner.validFrom > filter.period.to)) { excluded.push({ rowId: winner.id, reason: 'Outside the requested event period.' }); continue; }
    const customerId = resolveCustomer(state, winner.fields.customerId, normalized);
    if (filter.customerId && customerId !== resolveCustomer(state, filter.customerId, normalized)) continue;
    if (filter.orderId && winner.fields.orderId !== filter.orderId) continue;
    selected.push({ ...structuredClone(winner), fields: { ...structuredClone(winner.fields), customerId } });
  }
  return { facts: selected, conflicts: conflicts.filter(c => !filter.kinds || filter.kinds.includes(c.kind)), excluded, asOf: normalized };
}

export function insertFacts(state: State, inputs: FactInput[], learnedAt: string): Fact[] {
  const created: Fact[] = [];
  for (const input of inputs) {
    check(typeof input.entityId === 'string' && input.entityId.length > 0 && typeof input.sourceId === 'string' && input.sourceId.length > 0 && Number.isInteger(input.sourceRow) && input.sourceRow > 0, 'INVALID_FACT', 'Every fact needs a stable source, logical row identifier and row number.');
    check(validDate(input.validFrom) && (!input.validTo || (validDate(input.validTo) && input.validTo >= input.validFrom)), 'INVALID_FACT_DATE', 'Fact business dates must be valid.');
    check(/^[a-z][a-z0-9_]{0,63}$/.test(input.kind) && input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields), 'INVALID_FACT', 'Facts have a kind and a data object.');
    check(!Object.keys(input.fields).some(k => ['__proto__', 'prototype', 'constructor', '_supersedes'].includes(k)), 'INVALID_FACT_FIELD', 'Reserved fact fields are refused.');
    const sameKey = state.facts.filter(f => f.entityId === input.entityId && f.sourceId === input.sourceId && f.kind === input.kind);
    const previous = sameKey.at(-1);
    if (previous && hash({ fields: previous.fields, validFrom: previous.validFrom, validTo: previous.validTo, branch: previous.branch }) === hash({ fields: input.fields, validFrom: input.validFrom, validTo: input.validTo ?? null, branch: input.branch })) continue;
    check(!previous || previous.learnedAt <= learnedAt, 'SYSTEM_CLOCK_REGRESSION', 'A correction cannot be learned before the previous version.');
    const fact: Fact = { ...structuredClone(input), id: newId('fact'), validTo: input.validTo ?? null, learnedAt, supersededAt: null };
    state.facts.push(fact); created.push(fact);
  }
  if (created.length) markStale(state, 'Source facts changed. Recalculate this answer.');
  return created;
}
export class MemoryService {
  store: StateStore;
  constructor(store: StateStore) { this.store = store; }
  query(ctx: Context, filter: FactFilter = {}) { return selectFacts(this.store, ctx, filter); }
  history(ctx: Context, entityId: string) { authorize(this.store, ctx); return structuredClone(this.store.read().facts.filter(f => f.entityId === entityId && canSeeFact(this.store, ctx, f))); }
  suggestCustomerMatch(ctx: Context, leftId: string, rightId: string) {
    authorize(this.store, ctx); const selected = selectFacts(this.store, ctx).facts;
    const identity = (id: string) => { const facts = selected.filter(f => f.fields.customerId === id); check(facts.length > 0, 'CUSTOMER_NOT_FOUND', 'Both customers must exist under your current access.'); return { gstins: [...new Set(facts.map(f => f.fields.gstin).filter(gstinValid))], pans: [...new Set(facts.map(f => f.fields.pan).filter((v): v is string => typeof v === 'string' && /^[A-Z]{5}\d{4}[A-Z]$/.test(v)))] }; };
    const left = identity(leftId), right = identity(rightId);
    if (left.gstins.length === 1 && right.gstins.length === 1 && left.gstins[0] === right.gstins[0]) return { leftId, rightId, relation: 'same-tax-registration', confidence: 'exact-reviewed-field', requiresApproval: true, reason: 'Identical valid GST registrations; customer merges still require approval.' };
    const leftPans = [...left.pans, ...left.gstins.map(g => g.slice(2, 12))], rightPans = [...right.pans, ...right.gstins.map(g => g.slice(2, 12))];
    if (leftPans.some(p => rightPans.includes(p))) return { leftId, rightId, relation: 'same-owner-separate-registrations', confidence: 'exact-reviewed-field', requiresApproval: true, reason: 'A PAN links an owner; it does not merge branch registrations or unpaid balances.' };
    if (leftPans.length && rightPans.length) return { leftId, rightId, relation: 'cannot-match-tax-identities', confidence: 'conflicting-reviewed-fields', requiresApproval: true, reason: 'The published tax identities disagree. No automatic match is allowed.' };
    return { leftId, rightId, relation: 'abstain', confidence: 'insufficient-evidence', requiresApproval: true, reason: 'Names, phone numbers and email are suggestions only; no reviewed common tax identity is available.' };
  }
  async append(ctx: Context, inputs: FactInput[], options: { testLearnedAt?: string } = {}) {
    authorize(this.store, ctx, 'prepare');
    check(!options.testLearnedAt || this.store.read().workspace.demo, 'TEST_CLOCK_FORBIDDEN', 'A labelled demo workspace is required for the test clock.');
    const learnedAt = options.testLearnedAt ? new Date(options.testLearnedAt).toISOString() : now();
    for (const f of inputs) currentAccess(this.store, ctx, f.branch, f.sourceId);
    return this.store.update(state => { authorize(this.store, ctx, 'prepare'); for (const f of inputs) currentAccess(this.store, ctx, f.branch, f.sourceId); const records = insertFacts(state, inputs, learnedAt); audit(state, 'facts.appended', { count: records.length, testClock: !!options.testLearnedAt }); return structuredClone(records); });
  }
  async correct(ctx: Context, factId: string, fields: Record<string, unknown>, options: { testLearnedAt?: string } = {}) {
    authorize(this.store, ctx, 'prepare'); const old = this.store.read().facts.find(f => f.id === factId);
    check(old && canSeeFact(this.store, ctx, old), 'FACT_NOT_FOUND', 'This fact is unavailable under your current access.');
    return this.append(ctx, [{ entityId: old.entityId, sourceId: old.sourceId, sourceRow: old.sourceRow, kind: old.kind, validFrom: old.validFrom, validTo: old.validTo, branch: old.branch, fields: { ...old.fields, ...fields } }], options);
  }
  async setSourcePrecedence(ctx: Context, kind: string, sourceIds: string[]) {
    authorize(this.store, ctx, 'admin'); check(sourceIds.every(s => typeof s === 'string') && new Set(sourceIds).size === sourceIds.length, 'INVALID_SOURCE_RULE', 'Give a unique ordered source list, or an empty list to require agreement.');
    return this.store.update(state => { authorize(this.store, ctx, 'admin'); const rule = { id: newId('rule'), kind, sourceIds: [...sourceIds], at: now(), by: ctx.memberId }; state.sourceRules.push(rule); markStale(state, 'Source precedence changed.'); audit(state, 'source-rule.published', { kind, sources: sourceIds }); return rule; });
  }
  async merge(ctx: Context, entityIds: string[], targetId: string) {
    authorize(this.store, ctx, 'admin'); check(entityIds.length >= 2 && new Set(entityIds).size === entityIds.length && entityIds.includes(targetId), 'INVALID_MERGE', 'A merge needs unique customers and a target among them.');
    const known = new Set(selectFacts(this.store, ctx).facts.map(f => f.fields.customerId)); check(entityIds.every(id => known.has(id)), 'CUSTOMER_NOT_FOUND', 'Every merged customer must exist in your current access.');
    return this.store.update(state => { authorize(this.store, ctx, 'admin'); const merge = { id: newId('merge'), type: 'merge', entityIds: [...entityIds], targetId, at: now(), by: ctx.memberId }; state.merges.push(merge); resolveCustomer(state, entityIds[0], merge.at); markStale(state, 'Customer identity changed.'); audit(state, 'customer.merged', { mergeId: merge.id }); return merge; });
  }
  async undoMerge(ctx: Context, mergeId: string) {
    authorize(this.store, ctx, 'admin'); check(this.store.read().merges.some(m => m.id === mergeId && m.type === 'merge'), 'MERGE_NOT_FOUND', 'The merge was not found.');
    check(!this.store.read().merges.some(m => m.type === 'undo' && m.mergeId === mergeId), 'ALREADY_UNDONE', 'This merge was already undone.');
    return this.store.update(state => { authorize(this.store, ctx, 'admin'); const event = { id: newId('merge_undo'), type: 'undo', mergeId, at: now(), by: ctx.memberId }; state.merges.push(event); markStale(state, 'Customer merge was undone.'); audit(state, 'customer.merge-undone', { mergeId }); return event; });
  }
}
