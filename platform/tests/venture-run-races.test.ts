// Native Stop and instruction races; exact outside-effect journals have their own tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { RunControlResult } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { waitForAgentWork } from '../runtime/venture/agent-runtime/runner.ts';
import { call, code, record, setup, startNativeDraft, stop } from './venture-run-controls-env.ts';
import * as views from './venture-views-env.ts';

test('Stop while a native draft is being prepared discards its late draft and proposal', async t => {
  const env = await setup(); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  t.after(() => release());
  const tools: string[] = [];
  const pending = startNativeDraft(env, { beforeDraft: async () => { entered(); await held; }, observe: name => { tools.push(name); } });
  await ready;
  const run = listRecords(env.store.read(), 'venture-delivery-run').at(-1)!;
  await stop(env, run.id, true);
  await assert.rejects(call(env, 'venture.runs.resume', { runId: run.id }), code('RUN_RESTART_REQUIRED'));
  release();
  const done = await pending;
  assert.equal(done.status, 'stopped');
  assert.equal(record(env, run.id).deliverable, null);
  assert.equal(record(env, run.id).agentJob!.proposal, null);
  assert.ok(!tools.includes('draft_document') && !tools.includes('propose_action'));
});

test('two concurrent owner instructions are saved once and both reach the explicit new session', async () => {
  const env = await setup(), run = await startNativeDraft(env);
  assert.equal(run.status, 'ready-for-review');
  await Promise.all([
    call(env, 'venture.runs.steer', { runId: run.id, text: 'NOTE-ALPHA use the cafe account.' }),
    call(env, 'venture.runs.steer', { runId: run.id, text: 'NOTE-BRAVO skip the bills.' }),
  ]);
  const saved = record(env, run.id);
  assert.equal(saved.status, 'stopped');
  assert.equal(saved.agentJob!.ownerNotes!.length, 2);
  const route = env.deps.agentRoute!; let prompt = '';
  env.deps.agentRoute = async (...args) => {
    const selected = await route(...args), open = selected.driver.open.bind(selected.driver);
    return { ...selected, driver: { async open(input) {
      const session = await open(input), run = session.run.bind(session);
      return { ...session, async run(text) { prompt = text; return run(text); } };
    } } };
  };
  const resumed = await call<RunControlResult>(env, 'venture.runs.resume', { runId: run.id });
  await waitForAgentWork(env.store, resumed.run.runId);
  assert.notEqual(resumed.run.runId, run.id);
  assert.equal((prompt.match(/NOTE-ALPHA/g) ?? []).length, 1);
  assert.equal((prompt.match(/NOTE-BRAVO/g) ?? []).length, 1);
  assert.match(prompt, /Previous approvals grant no permission/);
  assert.equal(record(env, run.id).status, 'stopped');
});

test('owner instructions screen private payment numbers before they are stored or sent to AI', async () => {
  const env = await setup(), run = await startNativeDraft(env);
  const card = ['4111', '1111', '1111', '1111'].join(' ');
  await call(env, 'venture.runs.steer', { runId: run.id, text: `Use card ${card}; the OTP is 482913.` });
  const text = record(env, run.id).agentJob!.ownerNotes![0].text;
  assert.ok(!text.includes(card) && text.includes('[redacted card number]'));
  assert.ok(!text.includes('482913') && text.includes('[redacted OTP]'));
  assert.equal(record(env, run.id).preview, null);
});

test('pause and away cover rehearsals and the improvement loop too: no phone or agent caller spends meanwhile', async () => {
  const env = await views.setup();
  await views.seedBlueprint(env);
  const phone: Context = views.phone;
  const agent: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
  const run = (method: string, ctx: Context, payload: unknown = {}) => (delivery as Record<string, (d: unknown, c: Context, p: unknown) => Promise<unknown>>)[method](env.deps, ctx, payload);
  await views.call(env, 'venture.business.pause', { paused: true });
  await assert.rejects(run('venture.simulation.run', phone, { useTemplate: true }), code('BUSINESS_PAUSED'));
  await assert.rejects(run('venture.simulation.run', views.owner, { useTemplate: true }), code('BUSINESS_PAUSED'));
  await assert.rejects(run('venture.improve.run', agent), code('BUSINESS_PAUSED'));
  await views.call(env, 'venture.business.pause', { paused: false });
  await views.call(env, 'venture.away.set', { from: '2026-10-15', to: '2026-10-20' });
  await assert.rejects(run('venture.simulation.run', agent, { useTemplate: true }), code('BUSINESS_PAUSED'));
  await assert.rejects(run('venture.improve.run', phone), code('BUSINESS_PAUSED'));
});
