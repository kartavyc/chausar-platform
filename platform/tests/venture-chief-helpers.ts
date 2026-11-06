// Shared by the Chats tests (Ink v2 wave 4, package 4C1): a YouTube business made through the engine's own methods
// (venture-agent-helpers.ts) with the chief package's handlers beside the others, the scripted turns the chief's model
// calls get, and the businesses on this computer the workspace reports. Nothing here touches the network.
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { ModelTask, VentureBusinessRef } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as chiefHandlers } from '../runtime/venture/chief/index.ts';
import { agentBusiness, YOUTUBE_IDEA } from './venture-agent-helpers.ts';
import { owner } from './venture-judge-helpers.ts';

export type ChiefEnv = Awaited<ReturnType<typeof chiefBusiness>>;

/**
 * A YouTube business at approve each with both model tiers an AI, and chief(method) beside call(method) and
 * agents(method). A chief call goes to the chat tier, as agent chat does, so the preview names that tier's AI.
 */
export async function chiefBusiness(idea = YOUTUBE_IDEA) {
  const env = await agentBusiness(idea);
  const preview = env.models.preview;
  env.models.preview = async (ctx, task) => {
    const made = await preview(ctx, task);
    if (!made || task.purpose !== 'chief-chat') return made;
    const tier = env.models.status().tiers.main;
    return { ...made, presetId: tier.presetId, model: tier.model };
  };
  const chief = (method: string, payload: unknown = {}, ctx: Context = owner): Promise<any> => {
    const handler = (chiefHandlers as Record<string, (deps: typeof env.deps, ctx: Context, payload: unknown) => Promise<any>>)[method];
    assert.ok(handler, `no chief handler for ${method}`);
    return handler(env.deps, ctx, payload);
  };
  /** The businesses this computer holds, the open one first, as the workspace port reports them. */
  const others = (refs: VentureBusinessRef[]) => {
    env.deps.workspace = {
      current: () => ({ id: 'biz_open', name: 'Test Business' }),
      businesses: async () => [{ id: 'biz_open', name: 'Test Business', opens: 'with-this-computer', openedAt: null }, ...refs],
      recovery: async () => null,
    };
  };
  return { ...env, chief, others };
}

/** Gives the one chat consent for the business, as the consent sheet does. */
export async function chatConsent(env: ChiefEnv): Promise<void> {
  const view = await env.agents('venture.agents.thread.list', { agent: 'story-editor' });
  await env.agents('venture.chats.consent', { digest: view.consent.digest });
}

type Turn = unknown | ((task: ModelTask<any>) => unknown);

/** Scripts the chief's calls in order; each call takes the next turn. Returns the tasks the chief sent, in order. */
export function scriptChief(env: ChiefEnv, turns: Turn[]): ModelTask<any>[] {
  const tasks: ModelTask<any>[] = [];
  const queue = [...turns];
  env.models.respond['chief-chat'] = task => {
    tasks.push(task);
    assert.ok(queue.length, 'the chief asked its AI more times than this test scripted');
    const next = queue.shift();
    return typeof next === 'function' ? (next as (task: ModelTask<any>) => unknown)(task) : next;
  };
  return tasks;
}

/** A tool turn: the chief asks for these read tools and answers nothing yet. */
export const tools = (...names: string[]) => ({ tools: names, parts: [], proposals: [] });
/** A final turn: the answer's parts and any proposals. */
export const answer = (parts: unknown[], proposals: unknown[] = []) => ({ tools: [], parts, proposals });
export const text = (words: string) => ({ kind: 'text', text: words, receiptId: '', key: '' });
export const estimate = (words: string) => ({ kind: 'estimate', text: words, receiptId: '', key: '' });
export const figure = (receiptId: string, key: string) => ({ kind: 'figure', text: '', receiptId, key });
/** A proposal's fields in the answer's closed shape: every field present, empty where the kind does not use it. */
export function proposalFields(kind: string, fields: Record<string, string> = {}) {
  return { kind, agent: '', orderId: '', offerId: '', invoiceId: '', opportunityId: '', quantity: '', outreachKind: '', channel: '', text: '', ...fields };
}
/** A proposal as the chief makes it, decided first (4J14, Q22): yes, a reason, then its fields. */
export function proposal(kind: string, fields: Record<string, string> = {}) {
  return { decision: 'yes', reason: 'The owner asked for this.', content: proposalFields(kind, fields) };
}

/** The figures a tool returned in a task's input, by tool name. */
export function figuresOf(task: ModelTask<any>, tool: string): { receiptId: string; key: string; label: string; display: string }[] {
  const result = (task.input as any).results.find((item: any) => item.tool === tool);
  assert.ok(result, `no ${tool} result in this task`);
  return result.figures;
}

/** The chief.message events' data, oldest first. */
export function chiefEvents(env: ChiefEnv): unknown[] {
  return listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'chief.message').map(event => event.data);
}

/** How many proposal.created events the business logged. */
export function createdCount(env: ChiefEnv): number {
  return listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'proposal.created').length;
}

/** Prices the long-episode offer at amount (major units) and accepts the plan again. */
export async function priceOffer(env: ChiefEnv, amount: string): Promise<void> {
  const updated = await env.call('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', unitPrice: amount }] } });
  await env.call('venture.blueprint.accept', { digest: updated.blueprint.digest });
}
