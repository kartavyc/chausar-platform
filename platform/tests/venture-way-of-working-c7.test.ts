// C7 task 21: "Keep this as a way of working?", offered by the agent after the owner signs off a draft they edited.
// One edited sign-off makes one offer; accepted as is makes none; a dismissed change is never offered again; a second
// edit while one is open makes none; a change that touches prices, tools, checks or the floor is refused by code; the
// owner's switch turns offers off; withdrawn client consent means no AI call. An agent's own words in chat still change
// nothing (venture-agent-threads.test.ts:211 is unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { waitForWayOfWorking } from '../runtime/venture/agents/way-of-working.ts';
import { defaultAiSettings } from '../runtime/venture/agent-runtime/settings.ts';
import { withdrawClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { PLAIN_IDEA, owner } from './venture-judge-helpers.ts';
import { nativeJudgeBusiness, readyNativeDraft } from './native-judge-business.ts';

type Env = Awaited<ReturnType<typeof nativeJudgeBusiness>>;
const agents = (env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<any> =>
  (agentHandlers as Record<string, (deps: Env['deps'], ctx: Context, payload: unknown) => Promise<any>>)[method]!(env.deps, ctx, payload);

/** A business whose chat consent is given, and whose AI answers the offer task with what the test says. */
async function offering(answer: (input: any) => unknown) {
  const env = await nativeJudgeBusiness(PLAIN_IDEA);
  const preview = env.models.preview.bind(env.models);
  env.models.preview = async (ctx, task) => {
    const made = await preview(ctx, task);
    if (!made || task.purpose !== 'agent-chat') return made;
    const tier = env.models.status().tiers.main;
    return { ...made, presetId: tier.presetId, model: tier.model };
  };
  const view = await agents(env, 'venture.agents.thread.list', { agent: 'delivery' });
  await agents(env, 'venture.chats.consent', { digest: view.consent.digest });
  const asked: any[] = [];
  env.models.respond['agent-chat'] = task => { asked.push(task.input); return answer(task.input); };
  return Object.assign(env, { asked });
}
const ADD = (stepId: string, value: string) => ({ offer: 'yes', stepId, op: 'guidance.add', value });
const offers = (env: Env) => listRecords(env.store.read(), 'venture-agent-proposal').filter(record => record.offered);
async function editAndSignOff(env: Env) {
  const ready = await readyNativeDraft(env);
  const edited = ready.renderedText.replace('We will read what you send', 'We read what you send');
  await env.call('venture.delivery.review', { runId: ready.id, verdict: 'edited', reason: 'tone', editedText: edited });
  await waitForWayOfWorking(env.deps);
  return ready;
}
const writeStep = (input: any) => input.steps.find((step: any) => step.kind === 'write')?.id ?? input.steps[0].id;

test('an edited sign-off makes one offer, labelled and shown as before and after; accepted as is makes none', async () => {
  const env = await offering(input => ADD(writeStep(input), 'Write in the present tense.'));
  const ready = await readyNativeDraft(env);
  await env.call('venture.delivery.review', { runId: ready.id, verdict: 'accepted' });
  await waitForWayOfWorking(env.deps);
  assert.equal(offers(env).length, 0, 'accepted as is offers nothing');
  await editAndSignOff(env);
  const [offer] = offers(env);
  assert.ok(offer, 'one offer');
  assert.equal(offer.status, 'drafted');
  assert.match(offer.label!, /^Offered by .+ after you approved the draft for /);
  assert.ok(offer.diff.some(line => line.op === 'add' && line.text.includes('present tense')));
  assert.ok(env.asked[0].before.includes('We will read what you send') && env.asked[0].after.includes('We read what you send'));
  const thread = await agents(env, 'venture.agents.thread.list', { agent: offer.agent });
  const shown = thread.items.find((item: any) => item.type === 'proposal' && item.proposal.id === offer.id);
  assert.equal(shown?.proposal.title, 'Keep this as a way of working?');
  assert.equal(shown?.proposal.offered, offer.label);
});

test('a second edit while one is open makes none; a dismissed change is never offered again', async () => {
  const env = await offering(input => ADD(writeStep(input), 'Write in the present tense.'));
  await editAndSignOff(env);
  await editAndSignOff(env);
  assert.equal(offers(env).length, 1, 'one open offer per agent');
  const [offer] = offers(env);
  await agents(env, 'venture.agents.proposal.decide', { id: offer.id, digest: offer.digest, decision: 'reject' });
  await editAndSignOff(env);
  assert.equal(offers(env).length, 1, 'the same change is never offered again');
});

test('a change touching prices or tools is refused by code; the switch off and withdrawn client consent ask nothing', async () => {
  const env = await offering(input => ADD(writeStep(input), 'Raise the price to 5000 rupees for every client.'));
  await editAndSignOff(env);
  assert.equal(offers(env).length, 0, 'a price change is never offered');
  const off = await offering(input => ADD(writeStep(input), 'Write in the present tense.'));
  await ventureAction(off.deps, owner, 'approve', 'test.settings', tx => { tx.replace({ ...tx.venture!, aiSettings: { ...defaultAiSettings(), offerWays: false } }); });
  await editAndSignOff(off);
  assert.deepEqual([offers(off).length, off.asked.length], [0, 0]);
  const withdrawn = await offering(input => ADD(writeStep(input), 'Write in the present tense.'));
  const ready = await readyNativeDraft(withdrawn);
  await withdrawClientAiConsent(withdrawn.deps, owner, { clientId: withdrawn.client.id });
  const edited = ready.renderedText.replace('We will read what you send', 'We read what you send');
  await withdrawn.call('venture.delivery.review', { runId: ready.id, verdict: 'edited', reason: 'tone', editedText: edited }).catch(() => null);
  await waitForWayOfWorking(withdrawn.deps);
  assert.deepEqual([offers(withdrawn).length, withdrawn.asked.length], [0, 0]);
});
