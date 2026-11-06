// Shared by the wave 4 agent chat tests (package 4B1, and 4B2 and 4C1 after it): a YouTube business made through the
// engine's own methods (venture-judge-helpers.ts), the agents package's handlers beside the others, and the scripted
// answers the chat's model calls get. Nothing here touches the network; keys in fixtures are built at runtime.
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { ModelTask } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { verhoeffValid } from '../runtime/venture/core/secrets.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { business, owner } from './venture-judge-helpers.ts';

export const YOUTUBE_IDEA = 'Run a YouTube channel that explains personal finance in plain words';
export const OWN_FOOTAGE = { basis: 'own-footage' as const, holder: 'Asha Rao' };
export const EPISODE_REQUEST = 'One long episode on budgets from my raw footage.';

export type AgentEnv = Awaited<ReturnType<typeof agentBusiness>>;

/** A YouTube business at approve each with both model tiers an AI, and agents(method) beside call(method). */
export async function agentBusiness(idea = YOUTUBE_IDEA, stage: 'rehearsal' | 'shadow' | 'approve-each' = 'approve-each') {
  const env = await business(idea, stage);
  // The judge port previews every call as Haiku. A chat call goes to the tier the consent names, and the real port's
  // preview names that connection's preset and model, so this one does too.
  const preview = env.models.preview.bind(env.models);
  env.models.preview = async (ctx, task) => {
    const made = await preview(ctx, task);
    if (!made || task.purpose !== 'agent-chat') return made;
    const tier = env.models.status().tiers.main;
    return { ...made, presetId: tier.presetId, model: tier.model };
  };
  const agents = (method: string, payload: unknown = {}, ctx: Context = owner): Promise<any> => {
    const handler = (agentHandlers as Record<string, (deps: typeof env.deps, ctx: Context, payload: unknown) => Promise<any>>)[method];
    assert.ok(handler, `no agents handler for ${method}`);
    return handler(env.deps, ctx, payload);
  };
  return { ...env, agents };
}

/** Gives the one chat consent with the digest the thread shows. */
export async function consent(env: AgentEnv, agent = 'story-editor'): Promise<void> {
  const view = await env.agents('venture.agents.thread.list', { agent });
  assert.equal(view.consent.state, 'needed');
  const given = await env.agents('venture.chats.consent', { digest: view.consent.digest });
  assert.equal(given.state, 'given');
}

export type ChatScript = {
  /** The typed patch the model drafts for a "from now on" request. */
  patch?: (task: ModelTask<any>) => unknown;
  /** The typed answer the model writes for a question. */
  answer?: (task: ModelTask<any>) => unknown;
};

/** Scripts the agent-chat purpose: a patch for venture-agent-patch tasks, an answer for venture-agent-answer tasks. */
export function scriptChat(env: AgentEnv, script: ChatScript): void {
  env.models.respond['agent-chat'] = task => {
    if (task.schemaName === 'venture-agent-patch') {
      assert.ok(script.patch, 'this test scripts no patch');
      return script.patch(task);
    }
    assert.equal(task.schemaName, 'venture-agent-answer');
    assert.ok(script.answer, 'this test scripts no answer');
    return script.answer(task);
  };
}

/** A card number that passes Luhn, built at runtime (a well-known test number, never a real card). */
export const TEST_CARD = ['4111', '1111', '1111', '1111'].join(' ');

/** A twelve-digit number that passes Verhoeff, as an Aadhaar number would, built at runtime from a fixed start. */
export function testAadhaar(): string {
  for (let last = 0; last < 10; last += 1) {
    const digits = `23456789012${last}`;
    if (verhoeffValid(digits)) return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
  }
  throw new Error('no check digit');
}

/** A text part of a model answer, in the answer schema's closed shape. */
export const said = (text: string) => ({ kind: 'text', text, receiptId: '', key: '' });
/** A figure part of a model answer, citing a receipt and its key. */
export const figure = (receiptId: string, key: string) => ({ kind: 'figure', text: '', receiptId, key });

/** The names of the agent.message events, with their data, oldest first. */
export function agentEvents(env: AgentEnv): { name: string; data: unknown }[] {
  return listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'agent.message').map(event => ({ name: event.name, data: event.data }));
}

/** The YouTube business's playbook id the business points at now. */
export const playbookIdOf = (env: AgentEnv) => listRecords(env.store.read(), 'venture-record')[0].playbookId;

/** A YouTube order on the long-episode offer, with no files: its run drafts the package straight away. */
export async function episodeOrder(env: AgentEnv, request = EPISODE_REQUEST) {
  return env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request, intake: { rights: OWN_FOOTAGE, format: 'long' } });
}

/** A YouTube order with one file whose run's first act turn asks the owner a question, approved so the run waits for the answer. */
export async function askingRun(env: AgentEnv, question = 'How long should the episode be?') {
  const order = await episodeOrder(env);
  await env.call('venture.files.add', { orderId: order.id, name: 'notes.txt', contentBase64: Buffer.from('Budgets, then the emergency fund.', 'utf8').toString('base64') });
  env.models.respond['agent-turn'] = () => ({ note: 'Check the length first', calls: [{ tool: 'handoff.owner', input: JSON.stringify({ question }) }], finished: false });
  const started = await env.call('venture.delivery.run', { orderId: order.id });
  assert.equal(started.status, 'waiting-for-you', JSON.stringify(started));
  const asked = await env.call('venture.delivery.approve', { runId: started.id, digest: started.preview.digest });
  assert.equal(asked.status, 'needs-answer', JSON.stringify(asked.harness?.toolCalls?.map((item: any) => item.envelope)));
  return asked;
}
