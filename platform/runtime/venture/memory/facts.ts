// Chausar venture launcher, dated memory (wave 6, package 6G4, D44): the engine's fact methods. The rules and views are
// memory/facts-data.ts's, shared with the fake engine. The owner adds, replaces, shows to their AI or hides, and forgets
// facts inside the app; an AI caller (the scoped tool channel) may add a fact, labelled as from AI and kept as the
// owner's only, may replace only a fact an AI wrote, and reads only the current facts its owner lets an AI read. Each
// AI job of an order reads them as background (agent-runtime/job-memory.ts, factsForTurn). Forget of one fact erases
// the words of every version of it; Forget of a person erases every fact about them (eraseFactsNaming).
import { check, type Context, type State } from '../../contracts.ts';
import type { MemoryFactRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { requireClientAiConsent } from '../clients/ai-consent.ts';
import {
  ERASED_FACT, MAX_FACTS, chainOf, factView, factsForAi, memoryView, parseAdd, parseForget, parseList, parseReplace, parseVisibility, sameTopic,
  type FactForAi, type MemoryChange, type MemoryView,
} from './facts-data.ts';

const NOT_FOUND = 'That fact was not found.';
/** Model calls that are over; their stored text loses a forgotten fact's words. */
const FINISHED_CALLS: ReadonlySet<string> = new Set(['completed', 'failed', 'expired']);

/** An AI caller: the scoped tool channel, or any source-tainted context. The owner's phone is the owner. */
export const isAiCaller = (ctx: Context): boolean => ctx.channel === 'mcp' || ctx.sourceTainted === true;

/** Whether a client's AI permission stands now. */
function consentOf(state: State, venture: VentureRecord): (clientId: string) => boolean {
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client]));
  return clientId => { const consent = clients.get(clientId)?.aiConsent; return !!consent && !consent.withdrawnAt; };
}
const factsOf = (state: State, ventureId: string) => listRecords(state, 'venture-memory-fact', ventureId);
const today = (deps: VentureDeps, venture: VentureRecord) => localDayAt(deps.clock().toISOString(), venture.country);

function currentFact(tx: VentureTx, factId: string): MemoryFactRecord {
  const fact = tx.find('venture-memory-fact', factId);
  check(fact && fact.ventureId === tx.venture!.id && fact.erasedAt === null, 'FACT_NOT_FOUND', NOT_FOUND);
  check(fact.replacedBy === null && fact.replacedAt === null, 'FACT_REPLACED', 'This fact was replaced already. Replace the newer one.');
  return fact;
}

/** The facts one AI turn of an order reads: the business's and its client's that an AI may see. */
export function factsForTurn(state: State, venture: VentureRecord, clientId: string | null): FactForAi[] {
  return factsForAi(factsOf(state, venture.id), clientId, consentOf(state, venture));
}

/** venture.memory.list { subject? } (read): the owner reads every fact; an AI caller only current facts it may see. */
export async function memoryList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MemoryView> {
  const { subject } = parseList(payload);
  const { state, venture } = readVenture(deps, ctx);
  return memoryView(factsOf(state, venture.id), subject, isAiCaller(ctx) ? { consented: consentOf(state, venture) } : null);
}

/**
 * venture.memory.add { subject, topic, text, since?, visibility? } (prepare): a new fact. A topic is kept once per
 * subject (FACT_EXISTS: replace it instead). An AI's fact names the client only while the client's AI permission stands.
 */
export async function memoryAdd(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MemoryChange> {
  const ai = isAiCaller(ctx);
  const { venture: open } = readVenture(deps, ctx);
  const input = parseAdd(payload, today(deps, open), ai);
  return ventureAction(deps, ctx, 'prepare', 'memory.add', tx => {
    const venture = tx.venture!;
    if (input.subject.startsWith('client:')) {
      const clientId = input.subject.slice('client:'.length);
      check(listRecords(tx.state, 'venture-client', venture.id).some(client => client.id === clientId), 'CLIENT_NOT_FOUND', 'Choose a client from this business.');
      if (ai) requireClientAiConsent(tx.state, venture.id, clientId);
    }
    const facts = factsOf(tx.state, venture.id);
    const live = facts.filter(fact => fact.erasedAt === null && fact.replacedBy === null && fact.replacedAt === null);
    const twin = live.find(fact => fact.subject === input.subject && sameTopic(fact.topic, input.topic));
    check(!twin, 'FACT_EXISTS', `A fact about ${twin?.topic} is kept already. Replace it instead.`);
    check(live.length < MAX_FACTS, 'INVALID_VENTURE_REQUEST', `Chausar keeps up to ${MAX_FACTS} facts. Forget one first.`);
    const fact = tx.put<MemoryFactRecord>({
      ...tx.base('venture-memory-fact'), subject: input.subject, topic: input.topic, text: input.text, since: input.since,
      replaces: null, replacedBy: null, replacedAt: null, source: { kind: ai ? 'ai' : 'owner', runId: null }, visibility: input.visibility, erasedAt: null,
    });
    return { fact: factView(fact), replaced: null, line: ai ? 'Kept as from AI. Only the owner sees it until they let their AI read it.' : 'Chausar keeps this fact.' };
  });
}

/**
 * venture.memory.replace { factId, text, since? } (prepare): a new fact in the old one's place. The old fact is kept,
 * marked replaced and linked to the new one; the new one names what it replaced. It is true from the day given (today
 * if none), never before the fact it replaces. An AI caller replaces only a fact an AI wrote, and its fact starts as the
 * owner's only; the owner's keeps who may see the fact.
 */
export async function memoryReplace(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MemoryChange> {
  const ai = isAiCaller(ctx);
  const { venture: open } = readVenture(deps, ctx);
  const input = parseReplace(payload, today(deps, open));
  return ventureAction(deps, ctx, 'prepare', 'memory.replace', tx => {
    const old = currentFact(tx, input.factId);
    check(!ai || old.source.kind === 'ai', 'APP_APPROVAL_REQUIRED', 'Only the owner replaces a fact the owner gave.');
    check(input.since >= old.since, 'INVALID_VENTURE_REQUEST', 'A newer fact cannot start before the one it replaces.');
    check(input.text !== old.text || input.since !== old.since, 'INVALID_VENTURE_REQUEST', 'That is the fact as it is now.');
    const next = tx.put<MemoryFactRecord>({
      ...tx.base('venture-memory-fact'), subject: old.subject, topic: old.topic, text: input.text, since: input.since,
      replaces: old.id, replacedBy: null, replacedAt: null, source: { kind: ai ? 'ai' : 'owner', runId: null }, visibility: ai ? 'owner' : old.visibility, erasedAt: null,
    });
    const replaced = tx.replace<MemoryFactRecord>({ ...old, replacedBy: next.id, replacedAt: tx.now });
    return { fact: factView(next), replaced: factView(replaced), line: 'Replaced. The earlier fact is kept, marked replaced.' };
  });
}

/** venture.memory.visibility { factId, visibility } (approve, inside the app): whether the owner's AI may read a current fact. */
export async function memoryVisibility(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MemoryChange> {
  requireAppChannel(ctx, 'venture.memory.visibility');
  const input = parseVisibility(payload);
  return ventureAction(deps, ctx, 'approve', 'memory.visibility', tx => {
    const fact = currentFact(tx, input.factId);
    const stored = fact.visibility === input.visibility ? fact : tx.replace<MemoryFactRecord>({ ...fact, visibility: input.visibility });
    return { fact: factView(stored), replaced: null, line: input.visibility === 'ai' ? 'Your AI can read this fact now.' : 'Only you see this fact now.' };
  });
}

/** Erases the words of these facts (topic and text), keeping their ids, dates and links, and of finished calls that carried them. */
function eraseFacts(tx: VentureTx, facts: readonly MemoryFactRecord[]): void {
  const texts = facts.map(fact => fact.text).filter(text => text.length >= 2);
  for (const fact of facts) tx.replace<MemoryFactRecord>({ ...fact, topic: '', text: '', erasedAt: tx.now });
  if (!texts.length) return;
  const holds = (value: unknown) => typeof value === 'string' && texts.some(text => value.includes(text));
  for (const call of tx.list('venture-model-call')) {
    if (!FINISHED_CALLS.has(call.status) || !(holds(call.payloadText) || holds(call.error?.message))) continue;
    tx.replace({ ...call, payloadText: ERASED_FACT, ...(call.error ? { error: { ...call.error, message: holds(call.error.message) ? ERASED_FACT : call.error.message } } : {}), erasedAt: tx.now });
  }
}

/** venture.memory.forget { factId } (approve, inside the app): erases the words of the fact and of every version of it. */
export async function memoryForget(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MemoryChange> {
  requireAppChannel(ctx, 'venture.memory.forget');
  const input = parseForget(payload);
  return ventureAction(deps, ctx, 'approve', 'memory.forget', tx => {
    const fact = tx.find('venture-memory-fact', input.factId);
    check(fact && fact.ventureId === tx.venture!.id && fact.erasedAt === null, 'FACT_NOT_FOUND', NOT_FOUND);
    const chain = chainOf(factsOf(tx.state, tx.venture!.id), fact.id).filter(item => item.erasedAt === null);
    eraseFacts(tx, chain);
    return { fact: null, replaced: null, line: chain.length > 1 ? `Forgotten: the words of all ${chain.length} versions are erased.` : 'Forgotten: its words are erased.' };
  });
}

/**
 * Forget of people (network/forget.ts removePersonData, DPDP): every fact about their clients, and every fact whose words
 * name them or hold their email, phone or page address, goes, with every version of it. Links to a removed version are
 * cleared; a fact it replaced stays marked replaced.
 */
export function eraseFactsNaming(tx: VentureTx, input: { clientIds: ReadonlySet<string>; handles: readonly string[]; mentionsName: (text: unknown) => boolean }): void {
  const facts = tx.list('venture-memory-fact');
  const names = (text: string) => input.mentionsName(text) || input.handles.some(handle => handle && text.toLowerCase().includes(handle.toLowerCase()));
  const hit = facts.filter(fact => (fact.subject.startsWith('client:') && input.clientIds.has(fact.subject.slice('client:'.length))) || names(fact.topic) || names(fact.text));
  if (!hit.length) return;
  const drop = new Set(hit.flatMap(fact => chainOf(facts, fact.id).map(item => item.id)));
  tx.state.conversations = tx.state.conversations.filter(record => !((record as { kind?: string })?.kind === 'venture-memory-fact' && drop.has((record as { id: string }).id)));
  for (const fact of tx.list('venture-memory-fact')) {
    const replaces = fact.replaces && drop.has(fact.replaces) ? null : fact.replaces;
    const replacedBy = fact.replacedBy && drop.has(fact.replacedBy) ? null : fact.replacedBy;
    if (replaces !== fact.replaces || replacedBy !== fact.replacedBy) tx.replace<MemoryFactRecord>({ ...fact, replaces, replacedBy });
  }
}
