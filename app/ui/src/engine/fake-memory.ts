/**
 * The fake engine's dated memory (wave 6, 6G4, D44): facts with since when, what they replaced, their source and who may
 * see them, in the engine's shapes, codes, order and words. The request checks and the views come from the engine's own
 * pure file (memory/facts-data.ts). The app is the only caller here, so every request is the owner's: an AI caller's
 * view and its rules are the engine's, tested there. Forget of a person takes the facts about them and their client.
 */

import { EngineError } from './types';
import type { ClientLite, MemoryChange, MemoryView } from './types';
import type { W4DeskHost } from './fake-w4';
import {
  MAX_FACTS, chainOf, factView, memoryView, parseAdd, parseForget, parseList, parseReplace, parseVisibility, sameTopic, type MemoryFactBody,
} from '../../../../platform/runtime/venture/memory/facts-data';
import { COUNTRY_TIME_ZONES } from '../../../../platform/runtime/venture/local-day-data';
import { namesTest } from './fake-crm';

const METHODS = new Set(['venture.memory.list', 'venture.memory.add', 'venture.memory.replace', 'venture.memory.visibility', 'venture.memory.forget']);
type Fact = { id: string; at: string } & MemoryFactBody;
export type MemoryHost = W4DeskHost & { clients: () => readonly ClientLite[] };

function engineChecked<T>(run: () => T): T {
  try { return run(); } catch (error) {
    if (error instanceof EngineError) throw error;
    const known = error as { code?: string; message?: string };
    throw new EngineError(known.code ?? 'INVALID_VENTURE_REQUEST', known.message ?? 'Send the required fields and nothing else.');
  }
}
function need(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new EngineError(code, message);
}
const live = (fact: Fact) => fact.erasedAt === null && fact.replacedBy === null && fact.replacedAt === null;

export class FakeMemoryDesk {
  private readonly host: MemoryHost;
  private readonly books = new Map<string, Fact[]>();
  private seq = 0;

  constructor(host: MemoryHost) { this.host = host; }

  handles(method: string): boolean { return METHODS.has(method); }

  request(method: string, p: Record<string, unknown>): unknown {
    return engineChecked(() => {
      switch (method) {
        case 'venture.memory.list': return this.list(p);
        case 'venture.memory.add': return this.add(p);
        case 'venture.memory.replace': return this.replace(p);
        case 'venture.memory.visibility': return this.visibility(p);
        case 'venture.memory.forget': return this.forget(p);
        default: throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
      }
    });
  }

  private facts(): Fact[] {
    const id = this.host.current();
    let facts = this.books.get(id);
    if (!facts) { facts = []; this.books.set(id, facts); }
    return facts;
  }
  private localDay(): string {
    const venture = this.host.ask('venture.get', {}) as { venture?: { country?: { code?: string } | null } } | null;
    const code = venture?.venture?.country?.code ?? 'IN';
    return new Intl.DateTimeFormat('en-CA', { timeZone: COUNTRY_TIME_ZONES[code as keyof typeof COUNTRY_TIME_ZONES] ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.host.now()));
  }
  private current(factId: string): Fact {
    const fact = this.facts().find(item => item.id === factId);
    need(fact && fact.erasedAt === null, 'FACT_NOT_FOUND', 'That fact was not found.');
    need(fact.replacedBy === null && fact.replacedAt === null, 'FACT_REPLACED', 'This fact was replaced already. Replace the newer one.');
    return fact;
  }

  private list(p: Record<string, unknown>): MemoryView {
    const { subject } = parseList(p);
    return memoryView(this.facts(), subject, null);
  }

  private add(p: Record<string, unknown>): MemoryChange {
    const input = parseAdd(p, this.localDay(), false);
    if (input.subject.startsWith('client:')) {
      const clientId = input.subject.slice('client:'.length);
      need(this.host.clients().some(client => client.id === clientId), 'CLIENT_NOT_FOUND', 'Choose a client from this business.');
    }
    const kept = this.facts().filter(live);
    const twin = kept.find(fact => fact.subject === input.subject && sameTopic(fact.topic, input.topic));
    need(!twin, 'FACT_EXISTS', `A fact about ${twin?.topic} is kept already. Replace it instead.`);
    need(kept.length < MAX_FACTS, 'INVALID_VENTURE_REQUEST', `Chausar keeps up to ${MAX_FACTS} facts. Forget one first.`);
    this.seq += 1;
    const fact: Fact = {
      id: `fact_fake${this.seq}`, at: this.host.now(), subject: input.subject, topic: input.topic, text: input.text, since: input.since,
      replaces: null, replacedBy: null, replacedAt: null, source: { kind: 'owner', runId: null }, visibility: input.visibility, erasedAt: null,
    };
    this.facts().push(fact);
    return { fact: factView(fact), replaced: null, line: 'Chausar keeps this fact.' };
  }

  private replace(p: Record<string, unknown>): MemoryChange {
    const input = parseReplace(p, this.localDay());
    const old = this.current(input.factId);
    need(input.since >= old.since, 'INVALID_VENTURE_REQUEST', 'A newer fact cannot start before the one it replaces.');
    need(input.text !== old.text || input.since !== old.since, 'INVALID_VENTURE_REQUEST', 'That is the fact as it is now.');
    this.seq += 1;
    const next: Fact = {
      id: `fact_fake${this.seq}`, at: this.host.now(), subject: old.subject, topic: old.topic, text: input.text, since: input.since,
      replaces: old.id, replacedBy: null, replacedAt: null, source: { kind: 'owner', runId: null }, visibility: old.visibility, erasedAt: null,
    };
    this.facts().push(next);
    old.replacedBy = next.id;
    old.replacedAt = this.host.now();
    return { fact: factView(next), replaced: factView(old), line: 'Replaced. The earlier fact is kept, marked replaced.' };
  }

  private visibility(p: Record<string, unknown>): MemoryChange {
    const input = parseVisibility(p);
    const fact = this.current(input.factId);
    fact.visibility = input.visibility;
    return { fact: factView(fact), replaced: null, line: input.visibility === 'ai' ? 'Your AI can read this fact now.' : 'Only you see this fact now.' };
  }

  private forget(p: Record<string, unknown>): MemoryChange {
    const input = parseForget(p);
    const fact = this.facts().find(item => item.id === input.factId);
    need(fact && fact.erasedAt === null, 'FACT_NOT_FOUND', 'That fact was not found.');
    const chain = chainOf(this.facts(), fact.id).filter(item => item.erasedAt === null);
    for (const item of chain) { item.topic = ''; item.text = ''; item.erasedAt = this.host.now(); }
    return { fact: null, replaced: null, line: chain.length > 1 ? `Forgotten: the words of all ${chain.length} versions are erased.` : 'Forgotten: its words are erased.' };
  }

  /** Forget of people, as the engine's eraseFactsNaming: facts about their clients, or naming them, go with every version. */
  forgetPeople(people: readonly { id: string; names: string[]; clientId: string | null; emails?: string[]; phones?: string[] }[], erase: boolean): void {
    if (!erase) return;
    const facts = this.facts();
    const clientIds = new Set(people.flatMap(person => (person.clientId ? [person.clientId] : [])));
    const names = namesTest(people);
    const hit = facts.filter(fact => (fact.subject.startsWith('client:') && clientIds.has(fact.subject.slice('client:'.length))) || names(fact.topic) || names(fact.text));
    const drop = new Set(hit.flatMap(fact => chainOf(facts, fact.id).map(item => item.id)));
    const kept = facts.filter(fact => !drop.has(fact.id));
    for (const fact of kept) {
      if (fact.replaces && drop.has(fact.replaces)) fact.replaces = null;
      if (fact.replacedBy && drop.has(fact.replacedBy)) fact.replacedBy = null;
    }
    this.books.set(this.host.current(), kept);
  }
}
