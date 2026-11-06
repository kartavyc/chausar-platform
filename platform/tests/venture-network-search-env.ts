// Shared by the plain-English search tests (venture-network-search and -research, package 4D3): the views test business
// with a scripted AI on the chat tier, the chat consent given as the thread shows it, the owner's own files imported, a
// scripted web search, and public pages served through stub ports of the network guard. Nothing here touches the
// network; the AI is a script that answers from the task it is given and keeps each call in the vault the way the real
// port does (preview, dispatching, completed), so Forget's erasure of a call's text can be seen.
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { PURPOSE_TIER } from '../runtime/venture/contracts.ts';
import type {
  ModelOutcome, ModelPort, ModelPreview, ModelStatusView, ModelTask, NetworkSearchRecord, NetworkSearchView, PersonRecord, VentureMethod, WebSearchPort,
} from '../runtime/venture/contracts.ts';
import type { PinnedAnswer, PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { digest, listRecords } from '../runtime/venture/records.ts';
import { chatConsentState } from '../runtime/venture/agents/consent.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { connectionsCsv, emptyShelf, net, personNamed } from './venture-network-env.ts';
import { owner, setup, type Env } from './venture-views-env.ts';

type Responder = (task: ModelTask<any>) => unknown;

/**
 * A scripted AI for the network search purpose. traits answers the first call (venture-network-traits), scores every
 * scoring call (venture-network-scores). Every preview is kept as a venture-model-call record with its exact payload.
 */
export class SearchPort implements ModelPort {
  connected = true;
  traits: Responder | null = null;
  scores: Responder | null = null;
  /** Every task previewed, in order; sent: the ones sent after the owner's own message approved them. */
  previewed: ModelTask<any>[] = [];
  sent: ModelTask<any>[] = [];
  /** Thrown by runPreview for the next scoring call, once, when set. */
  failNextScore: ChausarError | null = null;
  /** Thrown by runPreview for the scoring call of that number (1 for the first), once, when set. */
  failScore: { at: number; error: ChausarError } | null = null;
  /** The main tier's AI; a test changes it to make the chat consent stale. */
  mainPreset: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5' = 'anthropic-sonnet-5-5';
  /** Runs inside preview, after the call is recorded: lets a test act before the send. */
  onPreview: ((task: ModelTask<any>) => void | Promise<void>) | null = null;
  /** Runs inside a sent call, before the AI answers: lets a test act while the call is out. */
  onSend: ((task: ModelTask<any>) => Promise<void>) | null = null;
  #scored = 0;
  #held = new Map<string, { digest: string; task: ModelTask<any>; used: boolean }>();
  #calls = 0;
  readonly env: Env;
  constructor(env: Env) { this.env = env; }
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => this.connected
      ? { presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' }
      : { presetId: 'built-in-templates' as const, model: null, usable: true, reason: 'No AI connected; using built-in templates' };
    return {
      connections: [], tiers: { fast: tier('anthropic-haiku-5-5'), main: tier(this.mainPreset) },
      spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: false, label: null },
    };
  }
  presets(): never { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate(): Promise<never> { throw new ChausarError('CLIENT_DATA_NEEDS_APPROVAL', 'A search carries client data, so it never goes on standing consent.'); }
  async preview<T>(ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    const tier = this.status().tiers[PURPOSE_TIER[task.purpose]];
    if (tier.presetId === 'built-in-templates') return null;
    this.previewed.push(task);
    this.#calls += 1;
    const callId = `modelcall_search_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    const payloadDigest = digest(payloadText);
    this.#held.set(callId, { digest: payloadDigest, task, used: false });
    const ventureId = this.env.venture.id;
    await this.env.store.update(state => {
      state.conversations.push({
        id: callId, kind: 'venture-model-call', ventureId, memberId: ctx.memberId, epoch: ctx.epoch, at: this.env.now(), purpose: task.purpose, tier: PURPOSE_TIER[task.purpose],
        presetId: tier.presetId, status: 'preview', payloadText, payloadDigest, containsClientData: task.containsClientData, error: null, costMicros: null,
      });
    });
    if (this.onPreview) await this.onPreview(task);
    return {
      callId, payloadText, digest: payloadDigest, presetId: tier.presetId, model: tier.model, endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: new Date(Date.parse(this.env.now()) + 30 * 60_000).toISOString(),
    };
  }
  async runPreview<T>(ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    if (ctx.channel !== 'desktop') throw new ChausarError('APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
    const held = this.#held.get(callId);
    if (!held || held.used || held.digest !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again; the approved text is no longer available.');
    held.used = true;
    const setStatus = (status: string) => this.env.store.update(state => {
      const call = state.conversations.find(record => record?.id === callId);
      if (call) { call.status = status; if (status !== 'dispatching') call.costMicros = '200'; }
    });
    await setStatus('dispatching');
    this.sent.push(held.task);
    const scoring = held.task.schemaName === 'venture-network-scores';
    if (scoring) this.#scored += 1;
    if (this.onSend) await this.onSend(held.task);
    const planned = scoring && this.failScore?.at === this.#scored ? this.failScore.error : null;
    if (scoring && (this.failNextScore || planned)) {
      const error = (this.failNextScore ?? planned)!;
      this.failNextScore = null;
      if (planned) this.failScore = null;
      await setStatus('failed');
      throw error;
    }
    const responder = scoring ? this.scores : this.traits;
    assert.ok(responder, `this test scripts no answer for ${held.task.schemaName}`);
    try {
      const value = validate(structuredClone(responder(held.task)));
      await setStatus('completed');
      return { value, by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', costMicros: '200', priceConfirmed: true };
    } catch (error) {
      await setStatus('failed');
      throw error;
    }
  }
  /** The scoring tasks sent, in order. */
  scoring(): ModelTask<any>[] { return this.sent.filter(task => task.schemaName === 'venture-network-scores'); }
}

export type SearchEnv = Env & { port: SearchPort };

/** The views test business with the scripted AI on both tiers, a real secret shelf (so Forget keeps its keyed check) and the chat consent given. */
export async function searchEnv(options: { consent?: boolean } = {}): Promise<SearchEnv> {
  const env = await setup();
  const port = new SearchPort(env);
  env.deps.models = port;
  env.deps.secrets = emptyShelf();
  const searched = Object.assign(env, { port });
  if (options.consent !== false) await giveConsent(searched);
  return searched;
}

/** Gives the one chat consent, with the digest of the text the owner reads. */
export async function giveConsent(env: SearchEnv): Promise<void> {
  const { view } = chatConsentState(env.deps, owner, env.store.read(), env.venture);
  assert.equal(view.state, 'needed');
  const given = await (agentHandlers as Record<string, (d: typeof env.deps, c: Context, p: unknown) => Promise<any>>)['venture.chats.consent'](env.deps, owner, { digest: view.digest });
  assert.equal(given.state, 'given');
}

/** A trait as the traits call answers it. */
export const trait = (label: string, fields: string[], terms: string[], kind = 'other') => ({ label, kind, fields, terms });
/** The traits call's whole answer. */
export const query = (traits: unknown[], over: Partial<{ clients: string; quietMonths: string; knownAtLeast: string }> = {}) =>
  ({ traits, clients: 'any', quietMonths: '', knownAtLeast: 'any', ...over });

type Candidate = { ref: string; fields: { field: string; text: string }[] };
/**
 * A scorer that does what an honest AI would: for every candidate and trait, 1 with the first field text that holds one
 * of the trait's words. words: per trait id, the words that count. Anything a test adds goes through extra.
 */
export function honestScores(words: Record<string, string[]>, extra: (candidate: Candidate) => { trait: string; score: string; quote: string; field: string }[] = () => []): Responder {
  return task => {
    const input = task.input as { people: Candidate[] };
    return {
      scores: input.people.map(candidate => ({
        ref: candidate.ref,
        traits: [
          ...Object.entries(words).flatMap(([id, list]) => {
            const hit = candidate.fields.find(item => list.some(word => item.text.toLowerCase().includes(word)));
            return hit ? [{ trait: id, score: '1', quote: hit.text, field: hit.field }] : [];
          }),
          ...extra(candidate),
        ],
      })),
    };
  };
}

/** Calls one network method as the owner in the app. */
export const search = (env: Env, payload: unknown, ctx: Context = owner) => net<NetworkSearchView>(env, 'venture.network.search' as VentureMethod, payload, ctx);
export const searchMore = (env: Env, searchId: string, ctx: Context = owner) => net<NetworkSearchView>(env, 'venture.network.searchMore' as VentureMethod, { searchId }, ctx);

export const searches = (env: Env): NetworkSearchRecord[] => listRecords(env.store.read(), 'venture-network-search');
export const searchRecord = (env: Env, id: string): NetworkSearchRecord => {
  const found = searches(env).find(record => record.id === id);
  assert.ok(found, `no search ${id}`);
  return found;
};

/** The owner's LinkedIn connections: two skincare founders in Pune, a growth lead and a spice shop owner. */
export const SKINCARE = connectionsCsv([
  'Asha,Rao,https://www.linkedin.com/in/asha-rao-dewdrop,asha@dewdrop.example,Dewdrop Naturals Pune,Co-founder,02 Oct 2026',
  'Rahul,Mehta,https://www.linkedin.com/in/rahulmehta,rahul@ubtan.example,Ubtan Lab,Head of Growth,15 Mar 2024',
  'Neha,Shah,https://www.linkedin.com/in/neha-shah-glow,neha@glow.example,Glow Skincare Pune,Founder,10 Jan 2025',
  'Farhan,Ali,https://www.linkedin.com/in/farhan-ali,farhan@alispices.example,Ali Spices,Owner,01 Jan 2023',
]);

/** Imports one file of the owner's own, as the app does. */
export function importFile(env: Env, kind: string, name: string, text: string) {
  return net<any>(env, 'venture.network.import', { kind, name, text });
}

/** The ids of the four people in SKINCARE, once imported. */
export function skincarePeople(env: Env): Record<'asha' | 'rahul' | 'neha' | 'farhan', PersonRecord> {
  return { asha: personNamed(env, 'Asha Rao'), rahul: personNamed(env, 'Rahul Mehta'), neha: personNamed(env, 'Neha Shah'), farhan: personNamed(env, 'Farhan Ali') };
}

/** The founder-in-Pune-selling-skincare query the tests script: three traits over role, company and notes. */
export const SKINCARE_QUERY = query([
  trait('Founder or owner', ['title'], ['founder', 'owner'], 'role'),
  trait('Based in Pune', ['company', 'note', 'meeting'], ['pune'], 'place'),
  trait('Sells skincare online', ['company', 'note', 'title'], ['skincare', 'naturals'], 'offer'),
]);
export const SKINCARE_WORDS = { t1: ['founder', 'owner'], t2: ['pune'], t3: ['skincare', 'naturals'] };

/** A web search that answers every query with these pages, and remembers each query it was asked. */
export function webSearch(pages: { url: string; title: string; snippet: string }[]): WebSearchPort & { asked: string[] } {
  const asked: string[] = [];
  return { asked, async search(query: string, options: { limit: number }) { asked.push(query); return pages.slice(0, options.limit); } };
}

/** The network guard's stub ports: every name is a public address, and send answers from pages by URL (404 else). */
export function pages(served: Record<string, PinnedAnswer | string>, resolve: Record<string, string> = {}) {
  const fetched: string[] = [];
  return {
    fetched,
    resolve: async (hostname: string) => [{ address: resolve[hostname] ?? '93.184.216.34', family: 4 as const }],
    send: async (target: PinnedTarget): Promise<PinnedAnswer> => {
      fetched.push(target.url.href);
      const page = served[target.url.href];
      if (page === undefined) return { status: 404, headers: {}, body: Buffer.from('') };
      return typeof page === 'string' ? { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(page, 'utf8') } : page;
    },
  };
}
