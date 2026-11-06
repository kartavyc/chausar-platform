// Auto with spot checks: built, and locked (Ink v2 wave 4, package 4J15, catalogue Q10; the founder's decision).
// venture.auto.readiness {agent} lists, per step and for the agent, what auto would need: a check that verifies the
// step, a real order that passed in the last 14 days, a complete spend log, drills that passed within 30 days and
// since the last playbook change, a step kind that allows auto, the owner's own switch, and no taint latch beyond the
// order itself. It may say how close a business is. It never unlocks anything: even with every item met,
// venture.launch.advance and venture.team.posture to auto with spot checks answer AUTO_LOCKED, the launch ladder says
// so, and venture.policy.allowSession stays refused. A decision model may lower friction but never authorises.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AutoReadinessView, LaunchStatus, PlaybookRecord } from '../runtime/venture/contracts.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { AUTO_LOCKED_WORDS, CLEAN_DRILL_RUNS, decisionModelAdvice } from '../runtime/venture/policy/auto-gate.ts';
import { currentVenture, ventureAction } from '../runtime/venture/records.ts';
import { effectivePosture, harnessPolicyContext } from '../runtime/venture/policy/context.ts';
import { ladderPolicy } from '../runtime/venture/policy/ladder.ts';
import { seedSpend } from './venture-team-fixtures.ts';
import { call, code, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const DAY = 86_400_000;
const readiness = (env: Env, agent = 'delivery') => call<AutoReadinessView>(env, 'venture.auto.readiness', { agent });
const item = (view: AutoReadinessView, id: string) => {
  const found = view.items.find(entry => entry.id === id);
  assert.ok(found, `no readiness item ${id}`);
  return found!;
};
const AGENT_ITEMS = ['real-run', 'spend-log', 'drills', 'no-taint'];
const STEP_ITEMS = (step: string) => [`verifier:${step}`, `kind:${step}`, `owner:${step}`];

/** A business at approve each where the draft step meets every readiness item. */
async function ready() {
  const env = await setup();
  const blueprint = await seedBlueprint(env);
  await setStage(env, 'approve-each');
  const { order } = await seedOrder(env, blueprint);
  const playbook = await deliveryHandlers['venture.delivery.playbook']!(env.deps, owner, {}) as PlaybookRecord;
  await call(env, 'venture.team.gate', { agentId: 'delivery', stepId: 'draft', gate: 'auto' });
  const run = await seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'accepted', servedBy: 'model', practice: false,
    verdict: { choice: 'accepted', reason: null, at: env.now() }, checks: [{ check: 'figures-resolve', passed: true, detail: 'Every figure resolves.' }],
    harness: harness({ phase: 'done', taint: { turn: 1, source: 'client-request', toolCallId: null, tool: null } }),
  });
  await seedSpend(env, { ref: run.id, micros: '1200' });
  // Two clean drill runs, as the lock words say.
  await deliveryHandlers['venture.drills.run']!(env.deps, owner, {});
  env.advance(60_000);
  await deliveryHandlers['venture.drills.run']!(env.deps, owner, {});
  return { env, playbook, order, run };
}

test('every readiness item can be met, and auto with spot checks still answers AUTO_LOCKED everywhere', async () => {
  const { env } = await ready();
  const view = await readiness(env);
  for (const id of [...AGENT_ITEMS, ...STEP_ITEMS('draft')]) assert.equal(item(view, id).met, true, `${id}: ${item(view, id).line}`);
  assert.equal(view.locked, true);
  assert.equal(view.agent, 'delivery');
  assert.match(view.line, /^1 of 8 steps has every item met\. /);
  assert.ok(view.line.endsWith(AUTO_LOCKED_WORDS));
  assert.equal(AUTO_LOCKED_WORDS, "Auto with spot checks is built but locked. It opens after two clean drill runs and the founder's yes.");
  const locked = (error: any) => { assert.equal(error.code, 'AUTO_LOCKED'); assert.equal(error.message, AUTO_LOCKED_WORDS); return true; };
  await assert.rejects(deliveryHandlers['venture.launch.advance']!(env.deps, owner, { to: 'auto-spot-check' }), locked);
  await assert.rejects(call(env, 'venture.team.posture', { agentId: 'delivery', posture: 'auto-spot-check' }), locked);
  await assert.rejects(call(env, 'venture.policy.allowSession', { stepId: 'draft' }), code('AUTO_LOCKED'));
  const status = await deliveryHandlers['venture.launch.status']!(env.deps, owner, {}) as LaunchStatus;
  const auto = status.stages.find(stage => stage.stage === 'auto-spot-check')!;
  assert.deepEqual([auto.allowed, auto.reason], [false, AUTO_LOCKED_WORDS]);
  assert.equal(status.stage, 'approve-each', 'nothing moved');
});

test('auto stays locked at every rung, from the ladder and from Team, whatever readiness says', async () => {
  const env = await setup();
  await seedBlueprint(env);
  for (const stage of ['rehearsal', 'shadow', 'approve-each'] as const) {
    await setStage(env, stage);
    await assert.rejects(deliveryHandlers['venture.launch.advance']!(env.deps, owner, { to: 'auto-spot-check' }), code('AUTO_LOCKED'));
    await assert.rejects(call(env, 'venture.team.posture', { agentId: 'delivery', posture: 'auto-spot-check' }), code('AUTO_LOCKED'));
  }
  // The other rungs still behave as before.
  await assert.rejects(deliveryHandlers['venture.launch.advance']!(env.deps, owner, { to: 'approve-sample' }), code('STAGE_PLANNED'));
  const tightened = await call<{ agent: { posture: string } }>(env, 'venture.team.posture', { agentId: 'delivery', posture: 'shadow' });
  assert.equal(tightened.agent.posture, 'shadow');
});

test('readiness says what is missing, item by item, in plain words', async () => {
  const env = await setup();
  await seedBlueprint(env);
  await setStage(env, 'approve-each');
  await deliveryHandlers['venture.delivery.playbook']!(env.deps, owner, {});
  const view = await readiness(env);
  assert.equal(item(view, 'real-run').met, false);
  assert.match(item(view, 'real-run').line, /No real order passed in the last 14 days/);
  assert.equal(item(view, 'drills').met, false);
  assert.match(item(view, 'drills').line, /Run the drills twice/);
  assert.equal(CLEAN_DRILL_RUNS, 2);
  assert.match(AUTO_LOCKED_WORDS, /two clean drill runs/, 'the lock words and the readiness item count the same runs');
  await deliveryHandlers['venture.drills.run']!(env.deps, owner, {});
  const once = item(await readiness(env), 'drills');
  assert.equal(once.met, false);
  assert.match(once.line, /needs two in a row/);
  assert.equal(item(view, 'owner:draft').met, false);
  assert.equal(item(view, 'verifier:gather').met, false, 'gather has no check that verifies it');
  assert.equal(item(view, 'kind:send').met, false, 'sending always asks');
  assert.match(item(view, 'kind:send').line, /always asks you first/);
  assert.equal(item(view, 'kind:approve').met, false, 'your own approval step is never auto');
  assert.equal(item(view, 'spend-log').met, true, 'nothing spent, nothing missing');
  assert.equal(item(view, 'no-taint').met, true);
  assert.match(view.line, /^0 of 8 steps have every item met\./);
  for (const entry of view.items) assert.doesNotMatch(`${entry.label} ${entry.line}`, /[\u2014\u2013]/);
});

test('readiness goes stale: an old real run, an old drill, a drill before the last playbook change, held spend, an outside latch', async () => {
  const { env, order, playbook } = await ready();
  // Held spend: the answer never came, so the log is not complete.
  await seedSpend(env, { ref: 'held', micros: '500', phase: 'unknown' });
  assert.equal(item(await readiness(env), 'spend-log').met, false);
  // A run latched by an email read in the last 14 days.
  await seedRun(env, order, { playbookId: playbook.id, playbookHash: playbook.hash, status: 'rejected', harness: harness({ phase: 'done', taint: { turn: 2, source: 'mail', toolCallId: 't2.1', tool: 'mail.read' } }) });
  assert.equal(item(await readiness(env), 'no-taint').met, false);
  // Fifteen days on, the real run is too old; the drill is still inside its 30 days.
  env.advance(15 * DAY);
  let view = await readiness(env);
  assert.equal(item(view, 'real-run').met, false);
  assert.equal(item(view, 'drills').met, true);
  assert.equal(item(view, 'no-taint').met, true, 'the latch is older than 14 days now');
  env.advance(16 * DAY);
  assert.equal(item(await readiness(env), 'drills').met, false, 'a drill older than 30 days does not count');
  // A new playbook version: a drill run before it does not count, even a fresh one for the old hash.
  await deliveryHandlers['venture.drills.run']!(env.deps, owner, {});
  assert.equal(item(await readiness(env), 'drills').met, false, 'one fresh clean run and one older than 30 days is not two clean runs');
  env.advance(60_000);
  await deliveryHandlers['venture.drills.run']!(env.deps, owner, {});
  assert.equal(item(await readiness(env), 'drills').met, true);
  await ventureAction(env.deps, owner, 'admin', 'seed.playbook', tx => {
    const next = tx.put<PlaybookRecord>({ ...playbook, ...tx.base('venture-playbook'), version: playbook.version + 1, hash: 'changed-hash', parentId: playbook.id });
    tx.touch({ playbookId: next.id });
  });
  view = await readiness(env);
  assert.equal(item(view, 'drills').met, false);
  assert.match(item(view, 'drills').line, /since the playbook last changed/);
});

test('a decision model may lower friction but never authorises; any doubt goes to the owner', async () => {
  const { env } = await ready();
  const view = await readiness(env);
  const go = decisionModelAdvice(view, 'go');
  assert.equal(go.authorises, false);
  assert.equal(go.friction, 'lower');
  assert.equal(go.toOwner, false);
  assert.match(go.line, /never authorises/);
  for (const doubt of ['unsure', 'wait'] as const) {
    const advice = decisionModelAdvice(view, doubt);
    assert.deepEqual([advice.authorises, advice.friction, advice.toOwner], [false, 'as-is', true], doubt);
  }
  // On an agent that is not ready, a model's go changes nothing.
  const fresh = await setup();
  await seedBlueprint(fresh);
  const notReady = decisionModelAdvice(await readiness(fresh), 'go');
  assert.deepEqual([notReady.authorises, notReady.friction, notReady.toOwner], [false, 'as-is', true]);
  // Nothing in the view can be read as an unlock.
  assert.equal(view.locked, true);
});

test('readiness: Keeper is code; an unknown agent is not found; the payload is exact; no plan has no agent', async () => {
  const { env } = await ready();
  await assert.rejects(readiness(env, 'keeper'), code('AGENT_IS_CODE'));
  await assert.rejects(readiness(env, 'nobody'), code('AGENT_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.auto.readiness', { agent: 'delivery', extra: 1 }), code('INVALID_VENTURE_REQUEST'));
  const bare = await setup();
  await assert.rejects(readiness(bare), code('AGENT_NOT_FOUND'));
});

test('a vault that says auto (edited, imported or restored) is capped at approve each: the ladder asks and allowSession refuses', async () => {
  const { env, playbook } = await ready();
  await call(env, 'venture.team.gate', { agentId: 'delivery', stepId: 'work', gate: 'auto' });
  // Written straight into the vault, as an edited, imported or restored file would hold it.
  await ventureAction(env.deps, owner, 'admin', 'seed.vault-stage', tx => { tx.touch({ launchStage: 'auto-spot-check' }); });
  await ventureAction(env.deps, owner, 'admin', 'seed.vault-posture', tx => { tx.put({ ...tx.base('venture-agent-posture'), agentId: 'delivery', posture: 'auto-spot-check' } as any); });
  const state = env.store.read();
  const venture = currentVenture(state)!;
  assert.equal(venture.launchStage, 'auto-spot-check');
  assert.equal(effectivePosture(state, venture), 'approve-each');
  const context = harnessPolicyContext({ state, venture, playbook, runRef: { kind: 'delivery', runId: 'run_x' }, store: env.store });
  assert.equal(context.posture, 'approve-each');
  const answer = await ladderPolicy.decide({ phase: 'tool-call', name: 'calc.sum', inputDigest: 'd' }, context);
  assert.equal(answer?.verdict, 'ask', 'a step on Auto still asks while auto is locked');
  await assert.rejects(call(env, 'venture.policy.allowSession', { stepId: 'work' }), code('AUTO_LOCKED'));
  const team = await call<{ agents: { id: string; posture: string }[] }>(env, 'venture.team.list', {});
  assert.equal(team.agents.find(agent => agent.id === 'delivery')!.posture, 'approve-each');
});
