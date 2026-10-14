/**
 * AS-10: why did it change. Two parts that are never merged.
 *
 * Measured: the same published sum worked out for the earlier and the later period, then each
 * counted row's signed amount grouped by one field the person chose. Each bar is the exact
 * difference for one group; the bars add up to the change, which is checked with BigInt before
 * anything is shown. A calculation whose total is not a plain signed sum of its rows is refused.
 *
 * Possible causes: sentences a person wrote, labelled Guess, each with the receipts for and
 * against. Nothing from outside enters a measured number. Reopening an investigation reads both
 * receipts again under the seat's current access.
 */
import { check, newId, now, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { CalculationReceipt } from '../calculator.ts';
import type { WhyRecord, WhyReply } from './contracts.ts';
import { askState, core, currentDictionary, identifier, input, peekAsk, period, priorPeriod, requireId, signedRows, text } from './shared.ts';
import { operationOf } from './menu.ts';

const BY = ['customer', 'branch', 'source', 'kind'] as const;
const MAX_BARS = 6;

function groupKey(by: WhyRecord['by'], row: CalculationReceipt['rows'][number]): string {
  if (by === 'customer') return row.customerId ?? '';
  if (by === 'branch') return row.branch ?? '';
  if (by === 'source') return row.sourceId;
  return row.kind;
}

export function measuredBars(by: WhyRecord['by'], earlier: CalculationReceipt, later: CalculationReceipt) {
  const before = signedRows(earlier), after = signedRows(later);
  check(before && after, 'ASK_NOT_GROUPABLE', 'Only a published sum can be split into measured causes.');
  const change = new Map<string, bigint>();
  for (const { row, signed } of before) change.set(groupKey(by, row), (change.get(groupKey(by, row)) ?? 0n) - signed);
  for (const { row, signed } of after) change.set(groupKey(by, row), (change.get(groupKey(by, row)) ?? 0n) + signed);
  const ranked = [...change].filter(([, v]) => v !== 0n).sort((a, b) => { const x = a[1] < 0n ? -a[1] : a[1], y = b[1] < 0n ? -b[1] : b[1]; return x === y ? a[0].localeCompare(b[0]) : x > y ? -1 : 1; });
  const shown = ranked.slice(0, MAX_BARS), other = ranked.slice(MAX_BARS).reduce((sum, [, v]) => sum + v, 0n);
  const total = BigInt(later.valueMinor) - BigInt(earlier.valueMinor);
  check(shown.reduce((sum, [, v]) => sum + v, 0n) + other === total, 'ASK_BRIDGE_NOT_EXACT', 'The measured parts do not add up to the change, so no bridge is shown.');
  return { bars: shown.map(([key, v]) => ({ key, changeMinor: String(v) })), otherMinor: String(other), total };
}

function reply(record: WhyRecord): WhyReply {
  const { memberId: _m, sourceIds: _s, ...body } = record;
  const earlier = BigInt(record.earlier.minor), change = BigInt(record.later.minor) - earlier;
  return { ...structuredClone(body), direction: change > 0n ? 'up' : change < 0n ? 'down' : 'same', changeMinor: String(change),
    changeBps: earlier === 0n ? null : String(change * 10000n / (earlier < 0n ? -earlier : earlier)),
    steps: [{ id: 'earlier', state: 'done' }, { id: 'later', state: 'done' }, { id: 'split', state: 'done' }] };
}

export async function start(ctx: Context, payload: unknown, host: ModuleHost): Promise<WhyReply> {
  const request = input(payload, ['operationId', 'period', 'comparePeriod', 'by', 'branch'], ['operationId', 'period']);
  const dictionary = currentDictionary(host, ctx);
  check(dictionary, 'ASK_NO_DICTIONARY', 'Publish what your words mean before asking for numbers.');
  const operation = operationOf(dictionary, request.operationId);
  check(operation, 'ASK_NO_CALCULATION', 'No published calculation has this name.');
  check(operation.type === 'sum', 'ASK_NOT_GROUPABLE', 'Only a published sum can be split into measured causes.');
  const later = period(request.period), earlierPeriod = request.comparePeriod === undefined ? priorPeriod(later) : period(request.comparePeriod);
  const by = request.by === undefined ? 'customer' : request.by;
  check((BY as readonly string[]).includes(by), 'ASK_INVALID', 'Split by customer, branch, source or kind.');
  const branch = request.branch === undefined || request.branch === null ? undefined : (check(identifier(request.branch), 'ASK_INVALID', 'Choose a branch by its name.'), request.branch as string);
  const scope = branch === undefined ? {} : { branch };
  const earlierReceipt = await core<CalculationReceipt>(host, 'calculation.run', { operation: operation.id, period: earlierPeriod, ...scope });
  const laterReceipt = await core<CalculationReceipt>(host, 'calculation.run', { operation: operation.id, period: later, ...scope });
  const measured = measuredBars(by, earlierReceipt, laterReceipt);
  const record: WhyRecord = { id: newId('why'), memberId: ctx.memberId, createdAt: now(), operationId: operation.id, label: operation.label, by,
    earlier: { period: earlierPeriod, minor: earlierReceipt.valueMinor, receiptId: earlierReceipt.id }, later: { period: later, minor: laterReceipt.valueMinor, receiptId: laterReceipt.id },
    bars: measured.bars, otherMinor: measured.otherMinor, guesses: [], sourceIds: [...new Set([...earlierReceipt.sourceIds, ...laterReceipt.sourceIds])] };
  // Each member keeps their own most recent pages; one seat never pushes out another's.
  await host.store.update(state => {
    const own = askState(state), mine = own.why.filter(w => w.memberId === ctx.memberId);
    if (mine.length >= 200) own.why.splice(own.why.indexOf(mine[0]!), 1);
    own.why.push(record);
  });
  return reply(record);
}

export async function get(ctx: Context, payload: unknown, host: ModuleHost): Promise<WhyReply> {
  const request = input(payload, ['whyId'], ['whyId']), id = requireId(request.whyId);
  const record = peekAsk(host.store.read()).why.find(w => w.id === id && w.memberId === ctx.memberId);
  check(record, 'ASK_NOT_FOUND', 'This investigation is no longer available.');
  // Permissions are checked again: both receipts must still open for this seat.
  await core(host, 'receipts.get', { id: record.earlier.receiptId });
  await core(host, 'receipts.get', { id: record.later.receiptId });
  return reply(record);
}

export async function guess(ctx: Context, payload: unknown, host: ModuleHost): Promise<WhyReply> {
  const request = input(payload, ['whyId', 'text', 'forReceiptIds', 'againstReceiptIds', 'source'], ['whyId', 'text']);
  const id = requireId(request.whyId), sentence = text(request.text, 1000);
  const ids = (value: unknown) => { check(value === undefined || Array.isArray(value) && value.length <= 20 && value.every(identifier), 'ASK_INVALID', 'Evidence is a short list of receipts.'); return (value ?? []) as string[]; };
  const forIds = ids(request.forReceiptIds), againstIds = ids(request.againstReceiptIds);
  for (const receiptId of [...forIds, ...againstIds]) await core(host, 'receipts.get', { id: receiptId });
  let source: WhyRecord['guesses'][number]['source'] = null;
  if (request.source !== undefined) {
    const given = input(request.source, ['name', 'fetchedAt'], ['name', 'fetchedAt']);
    check(typeof given.fetchedAt === 'string' && Number.isFinite(Date.parse(given.fetchedAt)), 'ASK_INVALID', 'Say when the outside source was fetched.');
    source = { name: text(given.name, 200), fetchedAt: given.fetchedAt };
  }
  return host.store.update(state => {
    const record = askState(state).why.find(w => w.id === id && w.memberId === ctx.memberId);
    check(record, 'ASK_NOT_FOUND', 'This investigation is no longer available.');
    check(record.guesses.length < 20, 'ASK_INVALID', 'An investigation holds at most twenty possible causes.');
    record.guesses.push({ id: newId('guess'), text: sentence.trim(), forReceiptIds: forIds, againstReceiptIds: againstIds, source, at: now() });
    return reply(record);
  });
}
