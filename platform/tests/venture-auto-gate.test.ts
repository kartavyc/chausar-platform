// Auto with spot checks: built, and locked (Ink v2 wave 4, package 4J15, catalogue Q10; the founder's decision).
// Nothing unlocks it: even with a real order accepted, a complete spend log, two clean drill runs and the owner's own
// switch, venture.launch.advance and venture.team.posture to auto with spot checks answer AUTO_LOCKED, the launch
// ladder says so, and venture.policy.allowSession stays refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { LaunchStatus, PlaybookRecord } from '../runtime/venture/contracts.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { AUTO_LOCKED_WORDS } from '../runtime/venture/policy/auto-lock.ts';
import { currentVenture, ventureAction } from '../runtime/venture/records.ts';
import { effectivePosture, harnessPolicyContext } from '../runtime/venture/policy/context.ts';
import { ladderPolicy } from '../runtime/venture/policy/ladder.ts';
import { seedSpend } from './venture-team-fixtures.ts';
import { call, code, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup } from './venture-views-env.ts';

/** A business at approve each with everything auto could ask for: the owner's switch, an accepted real order, settled spend, two clean drill runs. */
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
  return { env, playbook };
}

test('with everything in place, auto with spot checks still answers AUTO_LOCKED everywhere', async () => {
  const { env } = await ready();
  assert.equal(AUTO_LOCKED_WORDS, 'Routine-step approval is not available yet.');
  const locked = (error: any) => { assert.equal(error.code, 'AUTO_LOCKED'); assert.equal(error.message, AUTO_LOCKED_WORDS); return true; };
  await assert.rejects(deliveryHandlers['venture.launch.advance']!(env.deps, owner, { to: 'auto-spot-check' }), locked);
  await assert.rejects(call(env, 'venture.team.posture', { agentId: 'delivery', posture: 'auto-spot-check' }), locked);
  await assert.rejects(call(env, 'venture.policy.allowSession', { stepId: 'draft' }), code('AUTO_LOCKED'));
  const status = await deliveryHandlers['venture.launch.status']!(env.deps, owner, {}) as LaunchStatus;
  // 6C4: unfinished stages are hidden; the owner sees Practice and Live only.
  assert.deepEqual(status.stages.map(stage => stage.stage), ['practice', 'live']);
  assert.equal(status.stage, 'live', 'nothing moved');
});

test('auto stays locked at every rung, from the ladder and from Team', async () => {
  const env = await setup();
  await seedBlueprint(env);
  for (const stage of ['rehearsal', 'shadow', 'approve-each'] as const) {
    await setStage(env, stage);
    await assert.rejects(deliveryHandlers['venture.launch.advance']!(env.deps, owner, { to: 'auto-spot-check' }), code('AUTO_LOCKED'));
    await assert.rejects(call(env, 'venture.team.posture', { agentId: 'delivery', posture: 'auto-spot-check' }), code('AUTO_LOCKED'));
  }
  // 6C4: the hidden sample stage is not a choice at all.
  await assert.rejects(deliveryHandlers['venture.launch.advance']!(env.deps, owner, { to: 'approve-sample' }), code('INVALID_VENTURE_REQUEST'));
  const tightened = await call<{ agent: { posture: string } }>(env, 'venture.team.posture', { agentId: 'delivery', posture: 'shadow' });
  assert.equal(tightened.agent.posture, 'shadow');
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
