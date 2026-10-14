/**
 * History (BK-15, BK-16): what was known then beside what is known now, every version of a
 * record, and stale saved answers with a quick rebuild checked against a full rebuild on a
 * separate copy. Values are compared as exact minor-unit integers, never floats.
 */
import { check, now, type Context, type State, type StateStore } from '../contracts.ts';
import { CalculatorService, type CalculationReceipt } from '../calculator.ts';
import { canSeeFact, validatePeriod } from '../memory.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { amountOf, input, isoInstant, LIMITS, peekBooks, plainId, room, writeBooks, type Amount, type Rebuild } from './books-common.ts';

const calculator = (host: ModuleHost) => host.services.calculator as CalculatorService;
/** An empty selection is not a zero: nothing was counted as known on that date. */
const valueOf = (receipt: CalculationReceipt): Amount => receipt.coverage.countedRows > 0 ? { minor: receipt.valueMinor } : { missing: 'not-loaded-yet' };
function ownAnswers(state: State, ctx: Context) {
  const receipts = new Map(state.receipts.map(r => [r.id, r] as const));
  return state.answers.filter(a => typeof a?.id === 'string' && typeof a.receiptId === 'string' && receipts.get(a.receiptId)?.memberId === ctx.memberId);
}
function staleRow(answer: any, rebuild: Rebuild | undefined) {
  return { id: answer.id as string, question: typeof answer.question === 'string' ? answer.question : null, workedOutOn: String(answer.at ?? ''), reason: typeof answer.staleReason === 'string' ? answer.staleReason : null,
    rebuilt: rebuild ? { at: rebuild.at, matches: rebuild.matches, quick: rebuild.quick, full: rebuild.full } : null };
}
/**
 * A detached copy of the workspace rebuilt from the start (BK-16): nothing worked out before is
 * kept (no receipts, saved answers or conversations), the facts are laid down again in the order
 * they were learned, and a published sum is compiled again from its definition instead of using
 * the retained compiled artifact. The full rebuild may write its receipt only into the copy.
 */
export function fromStart(state: State): State {
  const copy = structuredClone(state);
  copy.receipts = []; copy.answers = []; copy.conversations = [];
  const order = new Map(copy.facts.map((f, i) => [f, i] as const));
  copy.facts = [...copy.facts].sort((a, b) => a.learnedAt.localeCompare(b.learnedAt) || order.get(a)! - order.get(b)!);
  const dictionary = copy.ontology?.current ?? (copy.ontology?.operations ? copy.ontology : null);
  if (dictionary && typeof dictionary === 'object') delete dictionary.compiledSums;
  return copy;
}
function scratchStore(state: State): StateStore {
  let copy = fromStart(state);
  return { read: () => copy, update: async change => { const next = structuredClone(copy); const result = await change(next); copy = next; return result; } };
}

const MAX_POINTS = 24;
type Change = 'start' | 'correction' | 'new-event' | 'join' | 'undo';
/**
 * Every instant inside (from, to] where what was known about the selection changed: a fact
 * in the period was learned (a correction when an earlier version from the same source
 * exists, else a new event) or replaced, or customers were joined or a join was undone.
 */
function changePoints(host: ModuleHost, ctx: Context, period: { from: string; to: string }, from: string, to: string): Map<string, Set<Change>> {
  const state = host.store.read(); const inWindow = (at: unknown): at is string => typeof at === 'string' && at > from && at <= to;
  const facts = state.facts.filter(f => !f.deletedAt && f.validFrom.slice(0, 10) >= period.from && f.validFrom.slice(0, 10) <= period.to && canSeeFact(host.store, ctx, f));
  const points = new Map<string, Set<Change>>(); const add = (at: string, change: Change) => points.set(at, (points.get(at) ?? new Set<Change>()).add(change));
  for (const f of facts) {
    if (inWindow(f.learnedAt)) add(f.learnedAt, facts.some(g => g !== f && g.sourceId === f.sourceId && g.kind === f.kind && g.entityId === f.entityId && g.learnedAt < f.learnedAt) ? 'correction' : 'new-event');
    if (inWindow(f.supersededAt)) add(f.supersededAt, 'correction');
  }
  for (const m of state.merges) if (inWindow(m?.at) && (m.type === 'merge' || m.type === 'undo')) add(m.at, m.type === 'merge' ? 'join' : 'undo');
  return points;
}

export const historyMethods: Record<string, MethodSpec> = {
  'history.beliefLine': { permission: 'read', async handler(ctx, payload, host) {
    const request = input(payload, ['operation', 'period', 'from', 'to'], ['operation', 'period', 'from', 'to']);
    check(typeof request.operation === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(request.operation) && isoInstant(request.from) && isoInstant(request.to), 'INVALID_BOOKS_REQUEST', 'Choose a calculation, a period and the window to look over.');
    validatePeriod(request.period);
    const from = new Date(request.from).toISOString(), to = new Date(request.to).toISOString();
    check(from < to, 'INVALID_BOOKS_REQUEST', 'The window starts before it ends.'); check(to <= now(), 'INVALID_ASOF', 'The known-on time cannot be in the future.');
    const changes = [...changePoints(host, ctx, request.period, from, to).entries()].sort(([a], [b]) => a.localeCompare(b));
    // Bounded: the start and the latest changes; older changes beyond the bound are counted, not drawn.
    const kept = changes.slice(-(MAX_POINTS - 1)); const omitted = changes.length - kept.length;
    const points = [];
    for (const [at, kinds] of [[from, new Set<Change>(['start'])] as [string, Set<Change>], ...kept]) {
      const receipt = await calculator(host).calculate(ctx, { operation: request.operation, period: request.period, asOf: at });
      points.push({ at: receipt.asOf, value: valueOf(receipt), receiptId: receipt.id, changes: [...kinds].sort() });
    }
    return { operation: request.operation, period: { from: request.period.from, to: request.period.to }, from, to, points, omitted };
  } },
  'history.asKnownOn': { permission: 'read', async handler(ctx, payload, host) {
    const request = input(payload, ['operation', 'period', 'asOf'], ['operation', 'period', 'asOf']);
    check(typeof request.operation === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(request.operation) && isoInstant(request.asOf), 'INVALID_BOOKS_REQUEST', 'Choose a calculation, a period and a known-on time.');
    validatePeriod(request.period);
    const asOf = new Date(request.asOf).toISOString(); check(asOf <= now(), 'INVALID_ASOF', 'The known-on time cannot be in the future.');
    const then = await calculator(host).calculate(ctx, { operation: request.operation, period: request.period, asOf });
    const current = await calculator(host).calculate(ctx, { operation: request.operation, period: request.period });
    return { then: { value: valueOf(then), receiptId: then.id, asOf: then.asOf }, now: { value: valueOf(current), receiptId: current.id, asOf: current.asOf } };
  } },
  'history.versions': { permission: 'read', handler(ctx, payload, host) {
    const { entityId } = input(payload, ['entityId'], ['entityId']); check(plainId(entityId), 'INVALID_BOOKS_REQUEST', 'Name the record.');
    const state = host.store.read();
    const facts = state.facts.filter(f => !f.deletedAt && (f.entityId === entityId || f.fields.invoiceId === entityId) && canSeeFact(host.store, ctx, f))
      .sort((a, b) => a.learnedAt.localeCompare(b.learnedAt) || state.facts.indexOf(a) - state.facts.indexOf(b));
    const seen = new Set<string>(); let first = true;
    return { versions: facts.map(f => {
      const key = JSON.stringify([f.entityId, f.kind]); const later = facts.find(g => g !== f && g.entityId === f.entityId && g.kind === f.kind && g.sourceId === f.sourceId && facts.indexOf(g) > facts.indexOf(f));
      const change = first ? 'first' as const : seen.has(key) ? 'correction' as const : 'new-event' as const; first = false; seen.add(key);
      return { factId: f.id, learnedAt: f.learnedAt, supersededAt: f.supersededAt ?? later?.learnedAt ?? null, kind: f.kind, validFrom: f.validFrom, amount: amountOf(f.fields.amountMinor), sourceId: f.sourceId, change };
    }) };
  } },
  'history.stale': { permission: 'read', handler(ctx, payload, host) {
    input(payload, []); const state = host.store.read(); const rebuilds = peekBooks(state).rebuilds;
    const latest = (id: string) => rebuilds.filter(r => r.answerId === id).at(-1);
    return { answers: ownAnswers(state, ctx).filter(a => a.stale === true || latest(a.id)).map(a => staleRow(a, latest(a.id))) };
  } },
  'history.rebuild': { permission: 'prepare', async handler(ctx, payload, host) {
    const { id } = input(payload, ['id'], ['id']);
    const answer = ownAnswers(host.store.read(), ctx).find(a => a.id === id); check(answer, 'ANSWER_NOT_FOUND', 'This saved answer is not available to you.');
    check(answer.request && typeof answer.request === 'object' && typeof answer.request.operation === 'string', 'REBUILD_NOT_AVAILABLE', 'This saved answer has no calculation to run again.');
    // A rebuild works the answer out again as known now; the full rebuild uses the same knowledge cut on a detached copy.
    const { asOf: _old, ...request } = structuredClone(answer.request);
    // Only the latest rebuild of each answer is read, so a new one replaces the earlier; the number of answers kept is bounded.
    const kept = peekBooks(host.store.read()).rebuilds; if (!kept.some(r => r.answerId === answer.id)) room(kept, LIMITS.rebuilds);
    const quick = await calculator(host).calculate(ctx, request);
    const full = await new CalculatorService(scratchStore(host.store.read())).calculate(ctx, { ...request, asOf: quick.asOf });
    const rebuild: Rebuild = { answerId: answer.id, at: now(), matches: BigInt(quick.valueMinor) === BigInt(full.valueMinor) && quick.coverage.countedRows === full.coverage.countedRows,
      quick: valueOf(quick), full: valueOf(full), quickReceiptId: quick.id, fullReceiptId: full.id };
    await writeBooks(host.store, ctx, 'prepare', books => {
      books.rebuilds = books.rebuilds.filter(r => r.answerId !== answer.id); room(books.rebuilds, LIMITS.rebuilds); books.rebuilds.push(rebuild);
    });
    return staleRow(host.store.read().answers.find(a => a.id === answer.id) ?? answer, rebuild);
  } },
};
