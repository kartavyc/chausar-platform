/**
 * AS-14: saved answers, investigations and what-ifs, each with its stale mark.
 *
 * A saved item keeps the calculation request and the receipt it was worked out with. It is stale
 * when the meanings changed, a counted row was replaced, rows arrived in its period after it was
 * worked out, or the seat's access changed. Rebuild works the same request out again under current
 * access and keeps the new receipt. When a source it used is deleted, its derived values are
 * removed and only the question and the deletion date remain.
 */
import { check, newId, now, type Context, type State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { CalculationReceipt } from '../calculator.ts';
import type { SavedItem, SavedKind, SavedReply } from './contracts.ts';
import { askState, codeOf, core, headlineKey, input, peekAsk, requireId, text } from './shared.ts';

export function staleOf(state: State, item: SavedItem, receipt: CalculationReceipt | null, dictionaryHash: string | null): SavedReply['items'][number]['stale'] {
  if (!receipt) return { reason: 'access-changed', since: null };
  if (dictionaryHash !== null && receipt.dictionaryHash !== dictionaryHash) return { reason: 'meaning-changed', since: null };
  const rows = new Set(receipt.rowIds);
  const replaced = state.facts.filter(fact => rows.has(fact.id) && (fact.supersededAt || fact.deletedAt));
  if (replaced.length) return { reason: 'books-changed', since: replaced.map(f => String(f.supersededAt ?? f.deletedAt)).sort()[0]!.slice(0, 10) };
  const kinds = new Set(receipt.definitions.map(d => d.kind));
  if (receipt.period) {
    const later = state.facts.filter(fact => !rows.has(fact.id) && kinds.has(fact.kind) && fact.learnedAt > receipt.createdAt && !fact.deletedAt
      && fact.validFrom >= receipt.period!.from && fact.validFrom <= receipt.period!.to);
    if (later.length) return { reason: 'new-rows', since: later.map(f => f.learnedAt).sort()[0]!.slice(0, 10) };
  }
  return null;
}

export async function save(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['receiptId', 'question'], ['receiptId']);
  const receipt = await core<CalculationReceipt>(host, 'receipts.get', { id: requireId(request.receiptId) });
  const question = request.question === undefined || request.question === null ? null : text(request.question, 500);
  const answer = host.store.read().answers.find(a => a?.receiptId === receipt.id && a.request);
  check(answer, 'ASK_NOT_FOUND', 'This answer has no saved request to rebuild from.');
  const figure = receipt.figures.find(f => f.key === headlineKey(receipt));
  return host.store.update(state => {
    const own = askState(state);
    const existing = own.saved.find(item => item.memberId === ctx.memberId && item.receiptId === receipt.id);
    if (existing) return { id: existing.id };
    const item: SavedItem = { id: newId('saved'), memberId: ctx.memberId, kind: 'answer', question, operationId: receipt.operation, savedAt: now(),
      receiptId: receipt.id, request: structuredClone(answer.request), refId: null,
      headline: figure ? { kind: figure.unit, minor: figure.minor } : null, workedOutAt: receipt.createdAt, sourceIds: [...receipt.sourceIds], deletedOn: null };
    own.saved.push(item);
    return { id: item.id };
  });
}

/** Saves a why-changed investigation, a what-if or a forecast by its own record. */
export async function saveRef(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['kind', 'refId', 'question'], ['kind', 'refId']);
  check(['why', 'what-if', 'forecast'].includes(request.kind), 'ASK_INVALID', 'Choose what kind of item to save.');
  const kind = request.kind as SavedKind, refId = requireId(request.refId);
  const question = request.question === undefined || request.question === null ? null : text(request.question, 500);
  let headline: SavedItem['headline'] = null, receiptId: string | null = null, operationId: string | null = null, workedOutAt: string | null = null, sourceIds: string[] = [];
  if (kind === 'why') {
    const record = peekAsk(host.store.read()).why.find(w => w.id === refId && w.memberId === ctx.memberId);
    check(record, 'ASK_NOT_FOUND', 'This investigation is no longer available.');
    headline = { kind: 'money', minor: String(BigInt(record.later.minor) - BigInt(record.earlier.minor)) };
    receiptId = record.later.receiptId; operationId = record.operationId; workedOutAt = record.createdAt; sourceIds = [...record.sourceIds];
  } else if (kind === 'what-if') {
    const receipt = await core<CalculationReceipt>(host, 'receipts.get', { id: refId });
    const figure = receipt.figures.find(f => f.key === 'scenario');
    headline = figure ? { kind: 'money', minor: figure.minor } : null; receiptId = receipt.id; operationId = receipt.operation; workedOutAt = receipt.createdAt; sourceIds = [...receipt.sourceIds];
  } else {
    const forecast = await core<any>(host, 'forecasts.get', { id: refId });
    operationId = forecast.operation; workedOutAt = forecast.createdAt; sourceIds = [...forecast.sourceIds];
  }
  const answer = receiptId ? host.store.read().answers.find(a => a?.receiptId === receiptId && a.request) : undefined;
  return host.store.update(state => {
    const own = askState(state);
    const item: SavedItem = { id: newId('saved'), memberId: ctx.memberId, kind, question, operationId, savedAt: now(), receiptId,
      request: answer ? structuredClone(answer.request) : null, refId, headline, workedOutAt, sourceIds, deletedOn: null };
    own.saved.push(item); return { id: item.id };
  });
}

export async function saved(ctx: Context, payload: unknown, host: ModuleHost): Promise<SavedReply> {
  input(payload, []);
  const state = host.store.read(), dictionary = host.services.ontology.current(ctx);
  const items: SavedReply['items'] = [];
  for (const item of peekAsk(state).saved.filter(s => s.memberId === ctx.memberId).reverse()) {
    let receipt: CalculationReceipt | null = null;
    if (item.receiptId && !item.deletedOn) {
      try { receipt = await host.call('receipts.get', { id: item.receiptId }) as CalculationReceipt; } catch (error) { if (!['RECEIPT_FORBIDDEN', 'ACCESS_REVOKED', 'RECEIPT_NOT_FOUND', 'SOURCE_REVOKED'].includes(codeOf(error)) && !codeOf(error).endsWith('_FORBIDDEN')) throw error; }
    }
    const stale = item.deletedOn ? null : item.receiptId ? staleOf(state, item, receipt, dictionary?.hash ?? null) : null;
    const { memberId: _m, request, sourceIds: _s, ...shown } = item;
    items.push({ ...shown, stale, rebuildable: !item.deletedOn && request !== null && (item.kind === 'answer' || item.kind === 'what-if') });
  }
  return { items };
}

export async function rebuild(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['savedId'], ['savedId']), id = requireId(request.savedId);
  const item = peekAsk(host.store.read()).saved.find(s => s.id === id && s.memberId === ctx.memberId);
  check(item, 'ASK_NOT_FOUND', 'This saved item is no longer available.');
  check(!item.deletedOn && item.request, 'ASK_CANNOT_REBUILD', 'Something this answer used was deleted, so it cannot be rebuilt.');
  // Work it out again as known now: the saved knowledge cut is dropped, every other parameter is kept.
  const { asOf: _asOf, ...again } = item.request as Record<string, unknown>;
  const receipt = await core<CalculationReceipt>(host, 'calculation.run', again);
  const figure = receipt.figures.find(f => f.key === headlineKey(receipt));
  return host.store.update(state => {
    const found = askState(state).saved.find(s => s.id === id && s.memberId === ctx.memberId);
    check(found && !found.deletedOn, 'ASK_NOT_FOUND', 'This saved item is no longer available.');
    found.receiptId = receipt.id; found.workedOutAt = receipt.createdAt; found.sourceIds = [...receipt.sourceIds];
    found.headline = figure ? { kind: figure.unit, minor: figure.minor } : null;
    const answer = state.answers.find(a => a?.receiptId === receipt.id && a.request);
    if (answer) found.request = structuredClone(answer.request);
    return { id: found.id, receiptId: receipt.id };
  });
}

export async function unsave(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['savedId'], ['savedId']), id = requireId(request.savedId);
  return host.store.update(state => {
    const own = askState(state), index = own.saved.findIndex(s => s.id === id && s.memberId === ctx.memberId);
    check(index >= 0, 'ASK_NOT_FOUND', 'This saved item is no longer available.');
    own.saved.splice(index, 1); return { removed: true as const };
  });
}
