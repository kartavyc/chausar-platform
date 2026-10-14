/**
 * AS-01, AS-02, AS-03, AS-08 and AS-17: the published menu, suggested questions, reading a typed
 * question into a proposal without any model, and the not-yet list.
 *
 * A typed question is matched only against the published calculations through the reviewed
 * alias pack and a small fixed word table. Two candidates give one question back; none gives
 * Not yet and a row on the wanted list. Nothing is guessed.
 */
import { newId, now, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { Dictionary, Operation } from '../ontology.ts';
import { resolveCoreOperationAlias } from '../core-operation-aliases.ts';
import type { MenuReply, PeriodId, SuggestReply, UnderstandReply, WantedReply } from './contracts.ts';
import { askState, businessToday, currentDictionary, input, needsOf, PERIOD_IDS, peekAsk, periodChoices, seedDictionary, text, topicOf, words } from './shared.ts';

const TOPICS = ['sales', 'collections', 'cash', 'stock', 'tax', 'other'] as const;

export function menu(ctx: Context, payload: unknown, host: ModuleHost): MenuReply {
  const request = input(payload, ['today']);
  const today = businessToday(host, request.today), dictionary = currentDictionary(host, ctx);
  if (!dictionary) return { state: 'no-dictionary', seed: false, dictionary: null, topics: [], gst2b: 'not-applicable', today, periods: periodChoices(today) };
  const items = dictionary.operations.map(operation => ({
    operationId: operation.id, label: operation.label, type: operation.type, topic: topicOf(operation), needs: needsOf(operation),
    meaning: dictionary.definitions.find(definition => definition.name === operation.definitions[0])?.meaning ?? null,
  }));
  return {
    state: 'ready', seed: seedDictionary(dictionary),
    dictionary: { version: dictionary.version, pack: dictionary.pack, label: dictionary.label, gstMode: dictionary.gstMode },
    topics: TOPICS.map(topic => ({ topic, items: items.filter(item => item.topic === topic) })).filter(group => group.items.length > 0),
    gst2b: dictionary.gstMode === 'regular' && dictionary.definitions.some(definition => definition.name === 'purchases') ? 'offered' : 'not-applicable',
    today, periods: periodChoices(today),
  };
}

const STARTERS: readonly [string, PeriodId][] = [['received', 'last-month'], ['billed', 'last-month'], ['aging', 'this-month'], ['net_sales', 'this-quarter'], ['margin', 'last-month'], ['purchases', 'last-month']];

/** Questions asked before come first, by how often; then the starter questions. Structure only. */
export function suggest(ctx: Context, payload: unknown, host: ModuleHost): SuggestReply {
  input(payload, []);
  const dictionary = currentDictionary(host, ctx); if (!dictionary) return { suggestions: [] };
  const label = (id: string) => dictionary.operations.find(operation => operation.id === id)?.label;
  const asked = [...peekAsk(host.store.read()).asked].filter(entry => label(entry.operationId))
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
  const out: SuggestReply['suggestions'] = [];
  for (const entry of asked) if (out.length < 6) out.push({ operationId: entry.operationId, label: label(entry.operationId)!, periodId: entry.periodId ?? 'last-month', asked: entry.count, why: 'asked-before' });
  for (const [operationId, periodId] of STARTERS) if (out.length < 6 && label(operationId) && !out.some(item => item.operationId === operationId))
    out.push({ operationId, label: label(operationId)!, periodId, asked: 0, why: 'starter' });
  return { suggestions: out };
}

/** Fixed words for each starter calculation, in English and Hindi. Reviewed; never model output. */
const WORDS: Readonly<Record<string, readonly string[]>> = {
  billed: ['billed', 'billing', 'invoiced', 'invoices', 'invoice', 'बिल', 'बिलिंग', 'इनवॉइस'],
  received: ['received', 'collections', 'collected', 'collection', 'receipts', 'वसूली', 'प्राप्त', 'मिला', 'मिले'],
  earned: ['earned', 'delivered', 'अर्जित'],
  revenue: ['revenue', 'राजस्व'],
  sales: ['sales', 'sold', 'बिक्री'],
  refunds: ['refunds', 'refund', 'returns', 'returned', 'रिफंड', 'वापसी'],
  costs: ['costs', 'cost', 'expenses', 'expense', 'spent', 'लागत', 'खर्च'],
  purchases: ['purchases', 'purchase', 'bought', 'खरीद'],
  margin: ['margin', 'contribution', 'profit', 'मार्जिन', 'मुनाफ़ा', 'मुनाफा'],
  aging: ['aging', 'ageing', 'overdue', 'outstanding', 'unpaid', 'owe', 'owes', 'बकाया'],
  net_sales: ['net'],
};
/** "sales" alone could mean billed, earned or received: the one question back. */
const AMBIGUOUS: Readonly<Record<string, readonly string[]>> = { sales: ['billed', 'earned', 'received'], revenue: ['billed', 'earned', 'received'] };
const ACTION_WORDS = new Set(['send', 'remind', 'pay', 'file', 'email', 'whatsapp', 'message', 'delete', 'book', 'post', 'create', 'भेजो', 'भेजें', 'याद']);
const STOP = new Set(['what', 'was', 'is', 'are', 'were', 'how', 'much', 'many', 'the', 'a', 'an', 'my', 'our', 'in', 'for', 'of', 'did', 'we', 'i', 'me', 'show', 'tell', 'total', 'by', 'to', 'from', 'on', 'this', 'last', 'month', 'quarter', 'year', 'week', 'please', 'all', 'and', 'do', 'have', 'kitna', 'kitni', 'kya', 'क्या', 'कितना', 'कितनी', 'कुल', 'पिछले', 'इस', 'महीने', 'महीना', 'साल', 'तिमाही', 'में', 'का', 'की', 'के', 'है', 'था', 'थी', 'हुई', 'हुआ', 'बताएँ', 'बताओ', 'कृपया']);
const PERIOD_PHRASES: readonly [RegExp, PeriodId][] = [
  [/\blast month\b|\bprevious month\b|पिछले महीने|पिछला महीना/u, 'last-month'], [/\bthis month\b|इस महीने/u, 'this-month'],
  [/\blast quarter\b|पिछली तिमाही/u, 'last-quarter'], [/\bthis quarter\b|इस तिमाही/u, 'this-quarter'],
  [/\blast year\b|\blast financial year\b|पिछले साल/u, 'last-year'], [/\bthis year\b|\bthis financial year\b|इस साल/u, 'this-year'],
];

function candidates(question: string, dictionary: Dictionary): { ids: string[]; unknown: string[] } {
  const alias = resolveCoreOperationAlias(question, dictionary);
  if (alias.kind === 'matched') return { ids: [alias.operationId], unknown: [] };
  if (alias.kind === 'ambiguous') return { ids: alias.operationIds, unknown: [] };
  const tokens = words(question), published = new Set(dictionary.operations.map(operation => operation.id));
  const hits = new Set<string>(); const unknown: string[] = [];
  for (const token of tokens) {
    if (STOP.has(token) || /^\p{N}+$/u.test(token)) continue;
    const matched = Object.entries(WORDS).filter(([, list]) => list.includes(token)).map(([id]) => id);
    if (!matched.length) { unknown.push(token); continue; }
    for (const id of matched) {
      if (AMBIGUOUS[id] && !tokens.includes('net')) AMBIGUOUS[id]!.forEach(option => published.has(option) && hits.add(option));
      else if (published.has(id)) hits.add(id);
    }
  }
  // "net sales" is one calculation, not a choice.
  if (tokens.includes('net') && published.has('net_sales') && (tokens.includes('sales') || tokens.includes('बिक्री'))) return { ids: ['net_sales'], unknown: [] };
  return { ids: [...hits].sort(), unknown };
}

export async function understand(ctx: Context, payload: unknown, host: ModuleHost): Promise<UnderstandReply> {
  const request = input(payload, ['question', 'today'], ['question']);
  const question = text(request.question, 500), today = businessToday(host, request.today);
  const dictionary = currentDictionary(host, ctx);
  if (!dictionary) return { kind: 'refused', code: 'ASK_NO_DICTIONARY' };
  const lowered = question.toLowerCase();
  const periodId = PERIOD_PHRASES.find(([pattern]) => pattern.test(lowered))?.[1] ?? null;
  const tokens = words(question), found = candidates(question, dictionary);
  const nearby = (ids: string[]) => dictionary.operations.filter(operation => ids.includes(operation.id) || !ids.length && ['received', 'billed', 'aging'].includes(operation.id))
    .slice(0, 4).map(operation => ({ operationId: operation.id, label: operation.label }));
  if (tokens.some(token => ACTION_WORDS.has(token))) {
    await remember(host, state => bump(state.wantedActions, question.trim(), 'text'));
    return { kind: 'no-match', reason: 'action', word: null, nearby: [] };
  }
  if (found.ids.length === 1) {
    const operation = dictionary.operations.find(candidate => candidate.id === found.ids[0])!;
    const choices = periodChoices(today), chosen = choices.find(choice => choice.id === (periodId ?? 'last-month'))!;
    return { kind: 'proposal', proposal: { operationId: operation.id, label: operation.label, period: chosen.period, periodId: chosen.id, branch: null, needs: needsOf(operation) },
      options: { operations: dictionary.operations.map(o => ({ operationId: o.id, label: o.label })), periods: choices, branches: branchesOf(host, ctx) } };
  }
  if (found.ids.length > 1) {
    return { kind: 'choose', periodId, choices: found.ids.map(id => dictionary.operations.find(operation => operation.id === id)!).map(operation => ({
      operationId: operation.id, label: operation.label, meaning: dictionary.definitions.find(definition => definition.name === operation.definitions[0])?.meaning ?? null })) };
  }
  // No calculation. One or two unknown words is a business word Chausar does not know.
  const word = found.unknown.length > 0 && found.unknown.length <= 2 ? found.unknown.join(' ') : null;
  await remember(host, state => {
    if (word) bump(state.wantedWords, word, 'word');
  });
  await host.store.update(state => { state.unsupported.push({ id: newId('wanted'), at: now(), question: question.trim(), status: 'not-yet', by: ctx.memberId }); });
  return { kind: 'no-match', reason: word ? 'unknown-word' : 'no-calculation', word, nearby: nearby([]) };
}

function branchesOf(host: ModuleHost, ctx: Context): string[] {
  const member = host.store.read().members.find(m => m.id === ctx.memberId);
  const seen = new Set<string>();
  for (const fact of host.store.read().facts) if (fact.branch && !fact.deletedAt && (member?.branches.includes('*') || member?.branches.includes(fact.branch))) seen.add(fact.branch);
  return [...seen].sort().slice(0, 50);
}

function bump<T extends { count: number; lastAt: string }>(list: (T & Record<string, any>)[], value: string, key: string) {
  const normal = value.toLowerCase().replace(/\s+/g, ' ').slice(0, 300);
  const found = list.find(entry => String(entry[key]).toLowerCase() === normal);
  if (found) { found.count += 1; found.lastAt = now(); } else list.push({ [key]: value.replace(/\s+/g, ' ').slice(0, 300), count: 1, lastAt: now() } as any);
  if (list.length > 500) list.splice(0, list.length - 500);
}
async function remember(host: ModuleHost, change: (state: ReturnType<typeof askState>) => void) {
  await host.store.update(state => change(askState(state)));
}

/** Records which calculation was asked and, for a correction, what replaced what. Structure only. */
export async function recordAsked(host: ModuleHost, operationId: string, periodId: PeriodId | null, correctedFrom: { operationId?: string; periodChanged?: boolean; groupChanged?: boolean } | null) {
  await remember(host, state => {
    const found = state.asked.find(entry => entry.operationId === operationId && entry.periodId === periodId);
    if (found) { found.count += 1; found.lastAt = now(); } else state.asked.push({ operationId, periodId, count: 1, lastAt: now() });
    if (correctedFrom) state.corrections.push({ at: now(), from: correctedFrom.operationId ?? operationId, to: operationId, periodChanged: correctedFrom.periodChanged === true, groupChanged: correctedFrom.groupChanged === true });
    if (state.corrections.length > 1000) state.corrections.splice(0, state.corrections.length - 1000);
  });
}
export const isPeriodId = (value: unknown): value is PeriodId => typeof value === 'string' && (PERIOD_IDS as readonly string[]).includes(value);

export function wanted(_ctx: Context, payload: unknown, host: ModuleHost): WantedReply {
  input(payload, []);
  const state = host.store.read(), own = peekAsk(state);
  const grouped = new Map<string, { text: string; count: number; lastAt: string }>();
  for (const entry of state.unsupported) {
    if (typeof entry?.question !== 'string') continue;
    const key = entry.question.toLowerCase().replace(/\s+/g, ' ').trim();
    const found = grouped.get(key);
    if (found) { found.count += 1; if (entry.at > found.lastAt) found.lastAt = entry.at; } else grouped.set(key, { text: entry.question.trim().slice(0, 300), count: 1, lastAt: String(entry.at ?? '') });
  }
  const order = <T extends { count: number; lastAt: string }>(list: T[]) => [...list].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 200);
  return { calculations: order([...grouped.values()]), actions: order(own.wantedActions.map(a => ({ ...a }))), words: order(own.wantedWords.map(w => ({ ...w }))) };
}

export function operationOf(dictionary: Dictionary, id: unknown): Operation | undefined {
  return typeof id === 'string' ? dictionary.operations.find(operation => operation.id === id) : undefined;
}
