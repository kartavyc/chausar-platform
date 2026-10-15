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
import { canSeeFact } from '../memory.ts';
import type { Dictionary, Operation } from '../ontology.ts';
import type { Period } from '../memory.ts';
import { resolveCoreOperationAlias } from '../core-operation-aliases.ts';
import type { DataNeed as Need, MenuReply, PeriodId, SuggestReply, UnderstandReply, WantedReply } from './contracts.ts';
import { askState, codeOf, translate, businessToday, currentDictionary, input, needsOf, PERIOD_IDS, peekAsk, periodChoices, seedDictionary, text, topicOf, words } from './shared.ts';

const TOPICS = ['sales', 'collections', 'cash', 'stock', 'tax', 'other'] as const;

export function menu(ctx: Context, payload: unknown, host: ModuleHost): MenuReply {
  const request = input(payload, ['today']);
  const today = businessToday(host, request.today), dictionary = currentDictionary(host, ctx);
  if (!dictionary) return { state: 'no-dictionary', seed: false, dictionary: null, topics: [], gst2b: 'not-applicable', today, periods: periodChoices(today), branches: [] };
  const items = dictionary.operations.map(operation => ({
    operationId: operation.id, label: operation.label, type: operation.type, topic: topicOf(operation), needs: needsOf(operation),
    meaning: dictionary.definitions.find(definition => definition.name === operation.definitions[0])?.meaning ?? null,
  }));
  return {
    state: 'ready', seed: seedDictionary(dictionary),
    dictionary: { version: dictionary.version, pack: dictionary.pack, label: dictionary.label, gstMode: dictionary.gstMode },
    topics: TOPICS.map(topic => ({ topic, items: items.filter(item => item.topic === topic) })).filter(group => group.items.length > 0),
    gst2b: dictionary.gstMode === 'regular' && dictionary.definitions.some(definition => definition.name === 'purchases') ? 'offered' : 'not-applicable',
    today, periods: periodChoices(today), branches: branchesOf(host, ctx),
  };
}

const STARTERS: readonly [string, PeriodId][] = [['received', 'last-month'], ['billed', 'last-month'], ['aging', 'this-month'], ['net_sales', 'this-quarter'], ['margin', 'last-month'], ['purchases', 'last-month']];

/** Questions asked before come first, by how often; then the starter questions. Structure only. */
export function suggest(ctx: Context, payload: unknown, host: ModuleHost): SuggestReply {
  input(payload, []);
  const dictionary = currentDictionary(host, ctx); if (!dictionary) return { suggestions: [] };
  const label = (id: string) => dictionary.operations.find(operation => operation.id === id)?.label;
  const asked = [...peekAsk(host.store.read()).asked].filter(entry => entry.memberId === ctx.memberId && label(entry.operationId))
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
    if (keeps(ctx)) await remember(host, state => bump(state.wantedActions, ctx.memberId, question.trim(), 'text'));
    return { kind: 'no-match', reason: 'action', word: null, nearby: [] };
  }
  if (found.ids.length === 1) {
    const operation = dictionary.operations.find(candidate => candidate.id === found.ids[0])!;
    const choices = periodChoices(today), chosen = choices.find(choice => choice.id === (periodId ?? 'last-month'))!;
    return proposalReply(host, ctx, dictionary, operation, chosen.period, chosen.id, null, today);
  }
  if (found.ids.length > 1) {
    return { kind: 'choose', periodId, choices: found.ids.map(id => dictionary.operations.find(operation => operation.id === id)!).map(operation => ({
      operationId: operation.id, label: operation.label, meaning: dictionary.definitions.find(definition => definition.name === operation.definitions[0])?.meaning ?? null })) };
  }
  // A question about data that is not loaded says which data it needs.
  const need = NEEDS.find(([, terms]) => tokens.some(token => terms.includes(token)) || terms.some(term => term.includes(' ') && lowered.includes(term)));
  if (need) {
    const loaded = await dataLoaded(ctx, host, need[0]);
    if (keeps(ctx)) await host.store.update(state => {
      if (state.unsupported.filter(entry => entry?.by === ctx.memberId).length < WANTED_PER_MEMBER)
        state.unsupported.push({ id: newId('wanted'), at: now(), question: question.trim().slice(0, 500), status: 'not-yet', by: ctx.memberId });
    });
    return { kind: 'no-match', reason: 'needs-data', word: null, need: need[0], loaded, nearby: nearby([]) };
  }
  // Telling, not asking: a statement goes to Memory as a proposed line, never into a calculation.
  const statement = statementOf(question);
  if (statement) return { kind: 'statement', text: statement.text, memoryKind: statement.kind };
  // No calculation. One or two unknown words is a business word Chausar does not know.
  const word = found.unknown.length > 0 && found.unknown.length <= 2 ? found.unknown.join(' ') : null;
  if (keeps(ctx)) await remember(host, state => {
    if (word) bump(state.wantedWords, ctx.memberId, word, 'word');
  });
  if (keeps(ctx)) await host.store.update(state => {
    // The core wanted list is shared with the calculator; each member adds at most a bounded number of rows.
    if (state.unsupported.filter(entry => entry?.by === ctx.memberId).length < WANTED_PER_MEMBER)
      state.unsupported.push({ id: newId('wanted'), at: now(), question: question.trim().slice(0, 500), status: 'not-yet', by: ctx.memberId });
  });
  return { kind: 'no-match', reason: word ? 'unknown-word' : 'no-calculation', word, nearby: nearby([]) };
}

/** A proposal and the short lists it can be changed from (AS-02). */
export function proposalReply(host: ModuleHost, ctx: Context, dictionary: Dictionary, operation: Operation, chosen: Period, periodId: PeriodId | null, branch: string | null, today: string): UnderstandReply {
  return { kind: 'proposal', proposal: { operationId: operation.id, label: operation.label, period: chosen, periodId, branch, needs: needsOf(operation) },
    options: { operations: dictionary.operations.map(o => ({ operationId: o.id, label: o.label })), periods: periodChoices(today), branches: branchesOf(host, ctx) } };
}

/** Data a question can need that no published calculation covers yet, by the words that name it. */
const NEEDS: readonly [Need, readonly string[]][] = [
  ['gstr2b', ['gst', 'gstr', '2b', 'gstr2b', 'itc', 'igst', 'cgst', 'sgst', 'जीएसटी', 'input tax']],
  ['form26as', ['tds', '26as', 'ais', 'टीडीएस']],
  ['stock', ['stock', 'inventory', 'स्टॉक', 'माल']],
  ['bank-statement', ['bank', 'balance', 'बैंक']],
  ['payroll', ['salary', 'salaries', 'payroll', 'wages', 'वेतन', 'तनख्वाह']],
];
async function dataLoaded(ctx: Context, host: ModuleHost, need: Need): Promise<boolean> {
  let recipes: string[] = [];
  try { recipes = (await host.call('connectorsx.envelopes', { limit: 400 }) as { recipeId?: unknown; status?: unknown }[]).filter(e => e?.status === 'accepted').map(e => String(e.recipeId ?? '')); }
  catch (error) { if (!['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE'].includes(codeOf(error))) throw translate(error); }
  const facts = host.store.read().facts.filter(f => !f.deletedAt && canSeeFact(host.store, ctx, f));
  if (need === 'gstr2b') return recipes.some(r => r.startsWith('gst.gstr2b')) || facts.some(f => f.kind === 'gstr2b' || f.kind === 'gstr-2b');
  if (need === 'form26as') return recipes.some(r => /26as|ais/i.test(r));
  if (need === 'stock') return facts.some(f => f.fields.stockQuantity !== undefined || f.fields.quantity !== undefined);
  if (need === 'bank-statement') return recipes.some(r => /bank/i.test(r));
  return recipes.some(r => /payroll|keka|greythr/i.test(r));
}

/** A question word anywhere makes it a question; these only count as the first word. */
const QUESTION_WORDS = new Set(['what', 'how', 'which', 'who', 'whom', 'whose', 'when', 'why', 'where', 'क्या', 'कितना', 'कितनी', 'कितने', 'कौन', 'कब', 'क्यों', 'कहाँ', 'कैसे']);
const QUESTION_STARTS = new Set(['is', 'are', 'was', 'were', 'did', 'do', 'does', 'show', 'list', 'give', 'tell', 'can', 'could', 'should', 'total', 'दिखाओ', 'बताओ', 'बताएँ']);
const REMEMBER = /^\s*(?:please\s+)?(?:remember|note|keep in mind)(?:\s+that)?[\s,:]+|^\s*याद रख(?:ो|ें|िए)\s*(?:कि)?\s*/iu;
const PREFERENCE = /\b(?:prefer|always|never|please|i like|we like|i want|we want)\b|पसंद|हमेशा|कभी नहीं/iu;
// Words that tell rather than ask. "paid" and similar past forms are left out: "GST paid last month" is a short question.
const TELLING = /\b(?:is|are|has|have|always|never|usually|prefers?|closes|opens|owes)\b/u;
/**
 * A sentence that tells Chausar something rather than asking it. "Remember that…" (or "याद रखो कि…")
 * always counts. Without it, only an English sentence with a telling word, three or more words, no
 * question mark and no question word anywhere counts; a Hindi sentence needs the explicit "याद रखो".
 */
export function statementOf(question: string): { text: string; kind: 'preference' | 'claim' } | null {
  const trimmed = question.trim(), told = REMEMBER.test(trimmed);
  const body = trimmed.replace(REMEMBER, '').trim();
  if (!body) return null;
  if (!told) {
    const all = words(body), first = all[0] ?? '';
    if (/[?？]/.test(body) || /[\u0900-\u097F]/u.test(body) || all.some(w => QUESTION_WORDS.has(w)) || QUESTION_STARTS.has(first)
      || all.length < 3 || !TELLING.test(` ${body.toLowerCase()} `)) return null;
  }
  return { text: body.slice(0, 2000), kind: PREFERENCE.test(body) ? 'preference' : 'claim' };
}

function branchesOf(host: ModuleHost, ctx: Context): string[] {
  const seen = new Set<string>();
  for (const fact of host.store.read().facts) if (fact.branch && !fact.deletedAt && !seen.has(fact.branch) && canSeeFact(host.store, ctx, fact)) seen.add(fact.branch);
  return [...seen].sort().slice(0, 50);
}

const WANTED_PER_MEMBER = 500;
/** Counts one more ask of a typed text in the member's own list, bounded per member. */
function bump(list: ({ memberId: string; count: number; lastAt: string } & Record<string, any>)[], memberId: string, value: string, key: string) {
  const normal = value.toLowerCase().replace(/\s+/g, ' ').slice(0, 300);
  const found = list.find(entry => entry.memberId === memberId && String(entry[key]).toLowerCase() === normal);
  if (found) { found.count += 1; found.lastAt = now(); return; }
  const mine = list.filter(entry => entry.memberId === memberId);
  if (mine.length >= WANTED_PER_MEMBER) list.splice(list.indexOf(mine.sort((a, b) => a.lastAt.localeCompare(b.lastAt))[0]!), 1);
  list.push({ memberId, [key]: value.replace(/\s+/g, ' ').slice(0, 300), count: 1, lastAt: now() });
}
async function remember(host: ModuleHost, change: (state: ReturnType<typeof askState>) => void) {
  await host.store.update(state => change(askState(state)));
}
/** A viewer seat reads only: its questions are answered but nothing about them is kept. */
const keeps = (ctx: Context) => ctx.role !== 'viewer';

/** Records which calculation was asked and, for a correction, what replaced what. Structure only. */
export async function recordAsked(host: ModuleHost, memberId: string, role: string, operationId: string, periodId: PeriodId | null, correctedFrom: { operationId?: string; periodChanged?: boolean; groupChanged?: boolean } | null) {
  if (role === 'viewer') return;
  await remember(host, state => {
    const found = state.asked.find(entry => entry.memberId === memberId && entry.operationId === operationId && entry.periodId === periodId);
    if (found) { found.count += 1; found.lastAt = now(); } else state.asked.push({ memberId, operationId, periodId, count: 1, lastAt: now() });
    if (correctedFrom) state.corrections.push({ memberId, at: now(), from: correctedFrom.operationId ?? operationId, to: operationId, periodChanged: correctedFrom.periodChanged === true, groupChanged: correctedFrom.groupChanged === true });
    const mine = state.corrections.filter(entry => entry.memberId === memberId);
    if (mine.length > 1000) state.corrections.splice(state.corrections.indexOf(mine[0]!), 1);
  });
}
export const isPeriodId = (value: unknown): value is PeriodId => typeof value === 'string' && (PERIOD_IDS as readonly string[]).includes(value);

/** The member's own not-yet lists. Typed text is never shown to another seat. */
export function wanted(ctx: Context, payload: unknown, host: ModuleHost): WantedReply {
  input(payload, []);
  const state = host.store.read(), own = peekAsk(state);
  const grouped = new Map<string, { text: string; count: number; lastAt: string }>();
  for (const entry of state.unsupported) {
    if (typeof entry?.question !== 'string' || entry.by !== ctx.memberId) continue;
    const key = entry.question.toLowerCase().replace(/\s+/g, ' ').trim();
    const found = grouped.get(key);
    if (found) { found.count += 1; if (entry.at > found.lastAt) found.lastAt = entry.at; } else grouped.set(key, { text: entry.question.trim().slice(0, 300), count: 1, lastAt: String(entry.at ?? '') });
  }
  const order = <T extends { count: number; lastAt: string }>(list: T[]) => [...list].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 200);
  return { calculations: order([...grouped.values()]), actions: order(own.wantedActions.filter(a => a.memberId === ctx.memberId).map(({ memberId: _m, ...a }) => a)),
    words: order(own.wantedWords.filter(w => w.memberId === ctx.memberId).map(({ memberId: _m, ...w }) => w)) };
}

export function operationOf(dictionary: Dictionary, id: unknown): Operation | undefined {
  return typeof id === 'string' ? dictionary.operations.find(operation => operation.id === id) : undefined;
}
