/**
 * AS-04 to AS-07: an answer from a published calculation, the number guard's list, the receipt
 * in six parts, the rows behind a number, and what was sent to an AI model.
 *
 * Every figure is the calculator's. The written explanation on this path is the calculator's own
 * template; a model-written explanation passed to `askx.guard` is kept only when every number in
 * it is on the receipt, and is otherwise replaced by the template, with the page saying so.
 */
import { ChausarError, check, hash, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { CalculationReceipt, CalculationRequest } from '../calculator.ts';
import { canSeeFact, type Period } from '../memory.ts';
import type { AnswerReply, Gap, GuardLine, ReceiptReply, RunReply, SentReply, SourceRowsReply } from './contracts.ts';
import { asText, ruleKind, businessToday, codeOf, core, currentDictionary, headlineKey, identifier, input, isRuleCode, minorString, monthsOf, namedPeriod, period, priorPeriod, requireId, seedDictionary, text, translate , openReceipt } from './shared.ts';
import { isPeriodId, operationOf, recordAsked } from './menu.ts';
import { guardLines } from './guard.ts';
export { asciiDigits, guardLines } from './guard.ts';

export function gapsOf(receipt: CalculationReceipt): Gap[] {
  const out: Gap[] = [];
  for (const gap of receipt.coverage.gaps) {
    if (gap.includes('entered directly')) out.push('unreconciled');
    else if (gap.includes('conflicts')) out.push('conflicts');
    else if (gap.includes('unknown and were excluded')) out.push('missing-amounts');
    else if (gap.includes('No visible facts')) out.push('empty');
    else if (gap.includes('imported costs only')) out.push('costs-only');
  }
  return [...new Set(out)];
}

/** Months of the period, up to the knowledge date, with no visible rows of any kind. */
function monthsNotLoaded(host: ModuleHost, ctx: Context, receipt: CalculationReceipt): string[] {
  if (!receipt.period) return [];
  // Only rows of the kinds this calculation counts, that this seat may see, in its scope.
  const loaded = new Set<string>(), kinds = new Set(receipt.definitions.map(d => d.kind));
  for (const fact of host.store.read().facts) {
    if (fact.deletedAt || fact.supersededAt || !kinds.has(fact.kind) || receipt.branch !== null && fact.branch !== receipt.branch) continue;
    if (receipt.requestedSourceIds && !receipt.requestedSourceIds.includes(fact.sourceId)) continue;
    if (!canSeeFact(host.store, ctx, fact)) continue;
    loaded.add(fact.validFrom.slice(0, 7));
  }
  const until = receipt.asOf.slice(0, 7);
  return monthsOf(receipt.period).filter(month => month <= until && !loaded.has(month));
}

export function answerOf(host: ModuleHost, ctx: Context, receipt: CalculationReceipt): AnswerReply {
  const dictionary = currentDictionary(host, ctx), operation = dictionary ? operationOf(dictionary, receipt.operation) : undefined;
  const answer = host.store.read().answers.find(item => item?.receiptId === receipt.id && item.request);
  const lines = guardLines(receipt.explanation, receipt);
  const labels: AnswerReply['labels'] = [];
  if (dictionary && seedDictionary(dictionary)) labels.push('seed');
  if (operation?.type === 'scenario') labels.push('what-if');
  if (receipt.stale || answer?.stale) labels.push('stale');
  return {
    kind: 'answer', answerId: answer?.id ?? null, receiptId: receipt.id, operationId: receipt.operation, label: operation?.label ?? receipt.operation,
    period: receipt.period, comparePeriod: receipt.comparePeriod, branch: receipt.branch, asOf: receipt.asOf, headline: headlineKey(receipt),
    figures: receipt.figures.map(f => ({ key: f.key, label: f.label, minor: f.minor, unit: f.unit })),
    rows: { read: receipt.coverage.selectedRows, counted: receipt.coverage.countedRows, excluded: receipt.coverage.excludedRows },
    completeness: receipt.coverage.completeness, gaps: gapsOf(receipt), monthsNotLoaded: monthsNotLoaded(host, ctx, receipt), labels,
    explanation: { source: 'template', text: receipt.explanation, replaced: false, reason: 'no-model' },
    guard: { status: lines.every(line => line.matched) ? 'passed' : 'replaced', lines }, sent: 'nothing',
  };
}

export async function run(ctx: Context, payload: unknown, host: ModuleHost): Promise<RunReply> {
  const request = input(payload, ['operationId', 'period', 'periodId', 'comparePeriod', 'onDate', 'priceChangeBps', 'branch', 'today', 'correctedFrom'], ['operationId']);
  const dictionary = currentDictionary(host, ctx);
  if (!dictionary) return { kind: 'refused', code: 'ASK_NO_DICTIONARY' };
  const operation = operationOf(dictionary, request.operationId);
  if (!operation) return { kind: 'refused', code: 'ASK_NO_CALCULATION' };
  const today = businessToday(host, request.today);
  const chosen: Period = request.period !== undefined ? period(request.period) : namedPeriod(request.periodId ?? 'last-month', today);
  const calculation: CalculationRequest = { operation: operation.id, period: chosen };
  if (request.branch !== undefined && request.branch !== null) { check(identifier(request.branch), 'ASK_INVALID', 'Choose a branch by its name.'); calculation.branch = request.branch; }
  if (operation.type === 'change') calculation.comparePeriod = request.comparePeriod !== undefined ? period(request.comparePeriod) : priorPeriod(chosen);
  if (operation.type === 'aging') calculation.onDate = request.onDate !== undefined ? period({ from: request.onDate, to: request.onDate }).from : chosen.to;
  if (operation.type === 'scenario') calculation.assumptions = { priceChangeBps: minorString(request.priceChangeBps) };
  let corrected: { operationId?: string; periodChanged?: boolean; groupChanged?: boolean } | null = null;
  if (request.correctedFrom !== undefined) {
    const from = input(request.correctedFrom, ['operationId', 'periodChanged', 'groupChanged']);
    corrected = { ...(typeof from.operationId === 'string' && operationOf(dictionary, from.operationId) ? { operationId: from.operationId } : {}), periodChanged: from.periodChanged === true, groupChanged: from.groupChanged === true };
  }
  let receipt: CalculationReceipt;
  try { receipt = await host.call('calculation.run', calculation as unknown as Record<string, unknown>) as CalculationReceipt; }
  catch (error) {
    const code = codeOf(error);
    if (isRuleCode(code)) return { kind: 'refused', code: 'ASK_STOPPED_BY_RULE', rule: ruleKind(code) };
    throw translate(error);
  }
  await recordAsked(host, ctx.memberId, ctx.role, operation.id, isPeriodId(request.periodId) && request.period === undefined ? request.periodId : null, corrected);
  return answerOf(host, ctx, receipt);
}

/** An existing answer, read again under current access. */
export async function answer(ctx: Context, payload: unknown, host: ModuleHost): Promise<AnswerReply> {
  const request = input(payload, ['receiptId'], ['receiptId']);
  const receipt = await openReceipt(host, ctx, request.receiptId);
  return answerOf(host, ctx, receipt);
}

/** The number guard over a written explanation (for example a model's). Unmatched numbers replace it. */
export async function guard(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['receiptId', 'text'], ['receiptId', 'text']);
  const receipt = await openReceipt(host, ctx, request.receiptId);
  const written = text(request.text, 8000), lines = guardLines(written, receipt), passed = lines.every(line => line.matched);
  void ctx;
  return { status: passed ? 'passed' as const : 'replaced' as const, lines,
    explanation: passed ? { source: 'model' as const, text: written, replaced: false, reason: null } : { source: 'template' as const, text: receipt.explanation, replaced: true, reason: 'guard-replaced' as const } };
}

function sourcesOf(host: ModuleHost, receipt: CalculationReceipt): ReceiptReply['sources'] {
  const state = host.store.read(), ids = new Set(receipt.rowIds);
  return receipt.sourceIds.map(sourceId => {
    const rows = receipt.rows.filter(row => row.sourceId === sourceId).length;
    const imports = state.imports.filter(record => record?.sourceId === sourceId && Array.isArray(record.rowIds) && record.rowIds.some((id: string) => ids.has(id)));
    const latest = imports.at(-1);
    if (!latest) return { sourceId, wayIn: 'entered' as const, format: null, recipe: null, rows };
    const recipeId = latest.retainedInput?.input?.recipe?.id;
    return { sourceId, wayIn: latest.format ? 'file' as const : 'interface' as const, format: typeof latest.format === 'string' ? latest.format : null,
      recipe: typeof latest.recipeHash === 'string' ? { id: typeof recipeId === 'string' ? recipeId : latest.recipeHash.slice(0, 12), state: latest.coverage?.reconciled === true ? 'tested' as const : 'not-yet-tested' as const, hash: latest.recipeHash } : null, rows };
  });
}

function conversationFor(host: ModuleHost, ctx: Context, receiptId: string) {
  return host.store.read().conversations.find(record => record?.receiptId === receiptId && record.memberId === ctx.memberId && record.kind === 'calculation-answer');
}

export async function receiptView(ctx: Context, payload: unknown, host: ModuleHost): Promise<ReceiptReply> {
  const request = input(payload, ['receiptId'], ['receiptId']);
  const receipt = await openReceipt(host, ctx, request.receiptId);
  const view = answerOf(host, ctx, receipt), reasons = new Map<string, Set<string>>();
  for (const exclusion of receipt.exclusions) { const set = reasons.get(exclusion.reason) ?? new Set(); set.add(exclusion.rowId); reasons.set(exclusion.reason, set); }
  const conversation = conversationFor(host, ctx, receipt.id);
  const sources = sourcesOf(host, receipt);
  return {
    receiptId: receipt.id, operationId: receipt.operation, label: view.label,
    chain: { question: typeof conversation?.question === 'string' ? conversation.question : null, calculation: view.label, rowsRead: receipt.coverage.selectedRows, totalChecked: true },
    figures: view.figures, period: receipt.period, comparePeriod: receipt.comparePeriod, asOf: receipt.asOf, createdAt: receipt.createdAt, branch: receipt.branch,
    definitions: receipt.definitions.map(d => ({ name: d.name, label: d.label, meaning: d.meaning, kind: d.kind, field: d.field })),
    exclusions: [...reasons].map(([reason, rows]) => ({ reason, rows: rows.size })), completeness: view.completeness, gaps: view.gaps, sources,
    versions: { app: typeof host.options.appVersion === 'string' ? host.options.appVersion : null, dictionary: receipt.ontologyVersion, dictionaryHash: receipt.dictionaryHash,
      definitionHash: receipt.definitionHash, recipes: sources.flatMap(source => source.recipe ? [source.recipe.hash] : []), calculator: receipt.compiledCalculation ? 'compiled-sum' : 'calculator' },
    allowedBy: { memberId: receipt.memberId, role: ctx.role, device: ctx.channel ?? 'desktop', at: receipt.createdAt },
    labels: view.labels, notCounted: receipt.exclusions.filter(e => /currenc|exchange/i.test(e.reason)).length,
    fx: receipt.rows.flatMap(row => row.normalization ? [{ from: row.normalization.sourceCurrency, to: row.normalization.targetCurrency,
      rate: `${asText((row.normalization.rate as any)?.numerator)}/${asText((row.normalization.rate as any)?.denominator)}`, on: null }] : [])
      .filter((entry, index, list) => list.findIndex(other => other.from === entry.from && other.rate === entry.rate) === index),
    sent: conversation ? { kind: 'model', available: true } : { kind: 'nothing' },
    meaning: meaningOf(host, ctx, receipt), demo: host.store.read().workspace.demo === true || host.demo,
  };
}

function meaningOf(host: ModuleHost, ctx: Context, receipt: CalculationReceipt): ReceiptReply['meaning'] {
  const found = (host.services.ontology.history(ctx) as { version: number; hash: string; publishedBy: string; publishedAt: string }[]).find(d => d.hash === receipt.dictionaryHash);
  return found ? { version: found.version, publishedBy: found.publishedBy, publishedAt: found.publishedAt } : null;
}

const INTERNAL = /^_/;
export async function sourceRows(ctx: Context, payload: unknown, host: ModuleHost): Promise<SourceRowsReply> {
  const request = input(payload, ['receiptId', 'tab', 'offset', 'limit'], ['receiptId']);
  const tab = request.tab === 'left-out' ? 'left-out' : 'counted';
  const offset = Number.isSafeInteger(request.offset) && request.offset >= 0 ? request.offset : 0;
  const limit = Number.isSafeInteger(request.limit) && request.limit > 0 && request.limit <= 200 ? request.limit : 50;
  let receipt: CalculationReceipt;
  let hiddenCount = 0, rule: SourceRowsReply['rule'] = null;
  try { receipt = await host.call('receipts.get', { id: requireId(request.receiptId) }) as CalculationReceipt; }
  catch (error) {
    // The seat's own receipt now holds rows it may not see: show the rows it can, and how many it cannot.
    const own = codeOf(error) === 'RECEIPT_FORBIDDEN' ? host.store.read().receipts.find(r => r?.id === request.receiptId && r.memberId === ctx.memberId && r.epoch === ctx.epoch) as CalculationReceipt | undefined : undefined;
    if (!own) throw new ChausarError('ASK_NOT_FOUND', 'This item is no longer available.');
    const visible = (id: string) => { const fact = host.store.read().facts.find(f => f.id === id); return !!fact && !fact.deletedAt && canSeeFact(host.store, ctx, fact); };
    const ids = new Set([...own.rowIds, ...own.exclusions.map(e => e.rowId)]);
    const hiddenIds = [...ids].filter(id => !visible(id)); hiddenCount = hiddenIds.length;
    const member = host.store.read().members.find(m => m.id === ctx.memberId);
    rule = hiddenIds.some(id => { const f = host.store.read().facts.find(x => x.id === id); return f && !(member?.branches.includes('*') || f.branch && member?.branches.includes(f.branch)); }) ? 'branch' : 'source';
    receipt = { ...own, rows: own.rows.filter(r => visible(r.factId)), exclusions: own.exclusions.filter(e => visible(e.rowId)) };
  }
  const facts = new Map(host.store.read().facts.map(fact => [fact.id, fact]));
  const cells = (id: string) => Object.entries(facts.get(id)?.fields ?? {}).filter(([name]) => !INTERNAL.test(name)).map(([name, value]) => ({ name, value: asText(value).slice(0, 500) }));
  const all = tab === 'counted'
    ? receipt.rows.map(row => ({ rowId: row.factId, sourceId: row.sourceId, sourceRow: row.sourceRow, cells: cells(row.factId), amountMinor: row.amountMinor, reason: null }))
    : [...new Map(receipt.exclusions.map(e => [e.rowId, e])).values()].map(e => {
      const fact = facts.get(e.rowId);
      return { rowId: e.rowId, sourceId: fact?.sourceId ?? '', sourceRow: fact?.sourceRow ?? null, cells: cells(e.rowId),
        amountMinor: typeof fact?.fields.amountMinor === 'string' && /^-?\d+$/.test(fact.fields.amountMinor) ? fact.fields.amountMinor : null, reason: e.reason };
    });
  void ctx;
  return { tab, total: all.length, offset, rows: all.slice(offset, offset + limit), hidden: hiddenCount > 0, hiddenCount: hiddenCount >= 3 ? hiddenCount : null, rule: hiddenCount > 0 ? rule : null };
}

/** The exact words that left the computer for one answer, while retained; then only the fingerprint. */
export async function sent(ctx: Context, payload: unknown, host: ModuleHost): Promise<SentReply> {
  const request = input(payload, ['receiptId'], ['receiptId']);
  await openReceipt(host, ctx, request.receiptId);
  const conversation = conversationFor(host, ctx, request.receiptId);
  if (!conversation) return { kind: 'nothing', why: 'menu' };
  const state = host.store.read(), question = String(conversation.question);
  const previews = state.modelReceipts.filter(record => record?.kind === 'model-preview' && record.memberId === ctx.memberId
    && (record.questionHash === hash(question) || record.questionHash === hash(question.trim())) && String(record.createdAt) <= String(conversation.at));
  const preview = previews.at(-1);
  if (!preview) return { kind: 'nothing', why: 'no-model-record' };
  const days = state.policy.retentionDays, at = String(preview.createdAt ?? preview.at);
  const kept = typeof preview.payload === 'string' && Number.isFinite(days) && days >= 1 && Date.parse(at) >= Date.now() - days * 86_400_000;
  return { kind: 'sent', routeId: String(preview.routeId), sendLevel: String(preview.send ?? state.policy.send), bytes: typeof preview.payload === 'string' ? Buffer.byteLength(preview.payload) : 0,
    costMinor: typeof preview.estimatedCostMinor === 'string' && /^\d+$/.test(preview.estimatedCostMinor) ? preview.estimatedCostMinor : null,
    text: kept ? preview.payload : null, digest: String(preview.digest), removed: !kept, at, boundary: String(preview.receiptBoundary ?? 'application-to-provider-http'), retentionDays: Number.isFinite(days) ? days : 0 };
}

/** The rows behind a number as CSV: counted and left out, cells as written, formulas neutralised. */
export async function exportReceipt(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['receiptId'], ['receiptId']);
  const counted = await sourceRows(ctx, { receiptId: request.receiptId, tab: 'counted', limit: 200 }, host);
  const left = await sourceRows(ctx, { receiptId: request.receiptId, tab: 'left-out', limit: 200 }, host);
  const all = async (tab: 'counted' | 'left-out', first: SourceRowsReply) => {
    const rows = [...first.rows];
    while (rows.length < first.total) rows.push(...(await sourceRows(ctx, { receiptId: request.receiptId, tab, offset: rows.length, limit: 200 }, host)).rows);
    return rows;
  };
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replaceAll('"', '""')}"`;
  const lines = ['"counted","source","row","amount_paise","reason","cells"'];
  for (const [tab, first] of [['counted', counted], ['left-out', left]] as const) for (const row of await all(tab, first))
    lines.push([cell(tab === 'counted' ? 'yes' : 'no'), cell(row.sourceId), `"${row.sourceRow ?? ''}"`, `"${row.amountMinor ?? ''}"`, cell(row.reason ?? ''), cell(row.cells.map(c => `${c.name}=${c.value}`).join('; '))].join(','));
  return { fileName: `receipt-${request.receiptId}.csv`, csv: lines.join('\r\n') + '\r\n' };
}
