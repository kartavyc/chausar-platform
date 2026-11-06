// The shadow summary (Ink v2 wave 4, package 4J15, catalogue Q11). venture.shadow.summary {agent} counts, from the
// shadow stage's own practice drafts, what would have gone out, what was held and what the owner would have changed,
// with a dash where a figure is unknown. Before the first run it offers a rehearsal on three sample orders; "Watch one
// real order end to end before arming" stays until the owner has watched one; every success condition carries its
// bound ("or stop with a reason after 5 tries").
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, ShadowSummaryView } from '../runtime/venture/contracts.ts';
import { SHADOW_BOUND, SHADOW_REHEARSE, SHADOW_WATCH } from '../runtime/venture/delivery/shadow-summary.ts';
import { call, code, harness, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';
import { seedRehearsal } from './venture-team-fixtures.ts';

const summary = (env: Env, agent = 'delivery') => call<ShadowSummaryView>(env, 'venture.shadow.summary', { agent });
const passing = [{ check: 'figures-resolve' as const, passed: true, detail: 'Every figure resolves.' }];
const failing = [{ check: 'figures-resolve' as const, passed: false, detail: 'A figure does not resolve.' }];

async function shadowBusiness() {
  const env = await setup();
  const blueprint = await seedBlueprint(env);
  await setStage(env, 'shadow');
  const { order } = await seedOrder(env, blueprint);
  const practice = (fields: Partial<DeliveryRunRecord>) => seedRun(env, order, { practice: true, servedBy: 'model', status: 'ready-for-review', checks: passing, ...fields });
  return { env, order, practice };
}

test('shadow summary: before any shadow draft every figure is a dash, and the first run offers a rehearsal and a watched order', async () => {
  const { env } = await shadowBusiness();
  const view = await summary(env);
  assert.deepEqual([view.wouldHaveGone, view.held, view.changed], [null, null, null]);
  assert.equal(view.line, 'Would have gone out -, held -, you would have changed -');
  assert.deepEqual(view.offers, [SHADOW_REHEARSE, SHADOW_WATCH]);
  assert.match(SHADOW_REHEARSE, /three sample orders: a routine one, a risky one and one that pushes on price/);
  assert.match(SHADOW_WATCH, /^Watch one real order end to end before arming/);
  assert.equal(SHADOW_BOUND, 'or stop with a reason after 5 tries');
  for (const offer of view.offers) assert.ok(offer.includes(SHADOW_BOUND), `every success condition carries its bound: ${offer}`);
  for (const text of [view.line, ...view.offers]) assert.doesNotMatch(text, /[\u2014\u2013]/);
});

test('shadow summary: counts the practice drafts: gone out when every check passed, held when something stopped it, changed by your review', async () => {
  const { env, practice, order } = await shadowBusiness();
  await practice({});
  await practice({});
  await practice({ status: 'edited', verdict: { choice: 'edited', reason: null, at: env.now() }, renderedText: 'The draft.', editedText: 'Better words.' });
  // Saved as edited with the same words: you would have sent it as it was, so it is not a change.
  await practice({ status: 'edited', verdict: { choice: 'edited', reason: null, at: env.now() }, renderedText: 'The draft.', editedText: '  The draft. ' });
  await practice({ status: 'rejected', verdict: { choice: 'rejected', reason: null, at: env.now() } });
  await practice({ checks: failing });
  await practice({ status: 'failed', checks: [] });
  await practice({ status: 'needs-answer', checks: [] });
  await practice({ status: 'waiting-for-you', checks: [] }); // still working: counted nowhere
  await practice({ playbookChecks: [{ playbook: 'youtube', check: 'hooks', outcome: 'fail', detail: 'No hook.' }] });
  // A real draft at approve each, and a template outline, are not shadow drafts.
  await seedRun(env, order, { practice: false, servedBy: 'model', status: 'ready-for-review', checks: passing });
  await seedRun(env, order, { practice: true, servedBy: 'template', status: 'ready-for-review', checks: passing });
  const view = await summary(env);
  assert.deepEqual([view.wouldHaveGone, view.held, view.changed], [5, 4, 2]);
  assert.equal(view.line, 'Would have gone out 5, held 4, you would have changed 2');
  assert.ok(!view.offers.includes(SHADOW_REHEARSE), 'not a first run any more');
});

test('shadow summary: you would have changed is a dash until you have reviewed a practice draft', async () => {
  const { env, practice } = await shadowBusiness();
  await practice({});
  await practice({ harness: harness({ phase: 'done', holds: [{ id: 'hold_1', tool: 'files.read', inputDigest: 'd', reason: 'Held.', status: 'waiting', turn: 1, validTurn: 2 } as any] }) });
  const view = await summary(env);
  assert.deepEqual([view.wouldHaveGone, view.held, view.changed], [1, 1, null]);
  assert.equal(view.line, 'Would have gone out 1, held 1, you would have changed -');
});

test('shadow summary: "watch one real order" stays until a real order was watched end to end; a rehearsal ends the first-run offer', async () => {
  const { env, practice, order } = await shadowBusiness();
  await seedRehearsal(env, 'playbook_x');
  let view = await summary(env);
  assert.deepEqual(view.offers, [SHADOW_WATCH], 'rehearsed, but no real order watched yet');
  await practice({});
  assert.deepEqual((await summary(env)).offers, [SHADOW_WATCH], 'a practice draft not yet reviewed is not watched end to end');
  await seedRun(env, order, { practice: true, servedBy: 'model', status: 'edited', checks: passing, verdict: { choice: 'edited', reason: null, at: env.now() } });
  view = await summary(env);
  assert.deepEqual(view.offers, [], 'watched one real order to its review');
});

test('shadow summary: Keeper is code, an unknown agent is not found, the payload is exact', async () => {
  const { env } = await shadowBusiness();
  await assert.rejects(summary(env, 'keeper'), code('AGENT_IS_CODE'));
  await assert.rejects(summary(env, 'nobody'), code('AGENT_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.shadow.summary', {}), code('INVALID_VENTURE_REQUEST'));
  const bare = await setup();
  await assert.rejects(summary(bare), code('AGENT_NOT_FOUND'));
});
