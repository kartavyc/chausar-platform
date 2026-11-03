// One-shot A3 (S2 in the W6 hands-on report): a standing order the owner gave in agent chat ("From now on, keep every
// client reply under 80 words and sign off with 'Warmly, Pune Frames'") made every live draft and every rehearsal fail
// the claim check on "Pune Frames". The real cause was the claim check: the owner's own standing orders were not among
// the sources that back a name (fixed in one-shot A1 row 4). These tests run the whole path through the engine: the
// order drafted in chat, accepted, then a live agent draft and a three-client rehearsal that both sign off with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { nativeJudgeBusiness, readyNativeDraft } from './native-judge-business.ts';
import { owner, plainDraft, PLAIN_IDEA, type Business } from './venture-judge-helpers.ts';

const ORDER = "From now on, keep every client reply under 80 words and sign off with 'Warmly, Pune Frames'.";
const SIGN_OFF = 'Warmly, Pune Frames';

/** A business whose consulting agent works to the owner's standing order, accepted from agent chat. */
async function withStandingOrder(): Promise<Business> {
  const env = await nativeJudgeBusiness(PLAIN_IDEA);
  await env.call('venture.judge.auto.set', { auto: false });
  const agents = (method: string, payload: unknown = {}, ctx: Context = owner): Promise<any> => (agentHandlers as Record<string, any>)[method](env.deps, ctx, payload);
  // A chat call goes to the tier the consent names, as the real port's preview does (venture-agent-helpers.ts).
  const preview = env.models.preview.bind(env.models);
  env.models.preview = async (ctx, task) => {
    const made = await preview(ctx, task);
    if (!made || task.purpose !== 'agent-chat') return made;
    const tier = env.models.status().tiers.main;
    return { ...made, presetId: tier.presetId, model: tier.model };
  };
  const view = await agents('venture.agents.thread.list', { agent: 'delivery' });
  await agents('venture.chats.consent', { digest: view.consent.digest });
  env.models.respond['agent-chat'] = () => ({ stepId: 'draft', op: 'guidance.add', value: "Keep every client reply under 80 words and sign off with 'Warmly, Pune Frames'." });
  const sent = await agents('venture.agents.thread.send', { agent: 'delivery', text: ORDER });
  const proposal = sent.added.find((item: any) => item.type === 'proposal').proposal;
  const decided = await agents('venture.agents.proposal.decide', { id: proposal.id, digest: proposal.digest, decision: 'accept' });
  assert.equal(decided.proposal.status, 'accepted');
  // The agent signs off as the owner asked.
  env.models.respond.delivery = task => {
    const draft = plainDraft(task) as { sections: { parts: unknown[] }[] };
    draft.sections.at(-1)!.parts.push({ kind: 'text', text: SIGN_OFF, ref: '' });
    return draft;
  };
  return env;
}

test('A3 S2: a live agent draft that signs off as the standing order says passes every check and can be accepted', async () => {
  const env = await withStandingOrder();
  const run = await readyNativeDraft(env);
  assert.match(run.renderedText, /Warmly, Pune Frames/);
  assert.deepEqual(run.checks.filter((item: any) => !item.passed && !item.notChecked), [], 'no check fails on the owner\'s sign-off');
  assert.deepEqual([run.canAccept, run.acceptBlocked], [true, null]);
});

test('A3 S2: a rehearsal of the three practice clients with the same sign-off passes, three of three', async () => {
  const env = await withStandingOrder();
  env.models.respond['client-sim'] = () => ({ message: 'Please look at my prices for the new tea range and advise.', asksForPerson: false });
  const rehearsal = await env.call('venture.simulation.run', {});
  assert.equal(rehearsal.episodes.length, 3);
  for (const episode of rehearsal.episodes) {
    assert.ok(JSON.stringify(episode.turns).includes(SIGN_OFF), 'the practice draft signs off as asked');
    assert.equal(episode.passed, true, episode.firstFailure ?? 'passed');
  }
  assert.deepEqual(rehearsal.summary, { scenarios: 3, passed: 3, failed: 0 });
});

test('A3 S2: a name no source backs still fails the claim check, so the check still works', async () => {
  const env = await withStandingOrder();
  env.models.respond.delivery = task => {
    const draft = plainDraft(task) as { sections: { parts: unknown[] }[] };
    draft.sections.at(-1)!.parts.push({ kind: 'text', text: 'Sunrise Partners recommended us to you.', ref: '' });
    return draft;
  };
  const run = await readyNativeDraft(env);
  assert.equal(run.canAccept, false);
  assert.match(run.acceptBlocked, /Sunrise Partners/);
});
