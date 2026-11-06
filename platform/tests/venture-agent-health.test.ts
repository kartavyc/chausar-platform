// Ink v2 wave 4 (4A1, catalogue A20): agent health, computed in code from runs, verdicts and the queue, never by a
// model. Two failed runs in a row is failing and three is quarantined; an outside action the agent proposed that none
// of its steps declares (refused TOOL_DENIED, as the grant holds only declared tools) quarantines it; one no single
// role can claim makes one team-level quarantine; more than half of at least four reviewed outputs sent back, or a deep
// or old queue, is degraded. A quarantined team starts no run and its runs in flight stop advancing (the run, an
// approved turn, an answer, a brief), checked before the work and again in its commit, until the owner clears it.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { AgentView, DeliveryRunRecord, ModelPreview, ModelTask, TeamListView, VentureDeps } from '../runtime/venture/contracts.ts';
import { findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { HEALTH_WORDS } from '../runtime/venture/views/health.ts';
import { call, code, harness, owner, phone, seedBlueprint, seedOrder, seedRun, type Env, setup } from './venture-views-env.ts';
import { flagshipTeam, turn } from './venture-team-fixtures.ts';
import { approve, realOrder, startRun, turnOf, type RealOrderEnv } from './venture-real-order-env.ts';

const DAY = 24 * 60 * 60_000;
const agents = async (env: Env) => (await call<TeamListView>(env, 'venture.team.list')).agents;
const agent = async (env: Env, id = 'delivery') => (await agents(env)).find(item => item.id === id) as AgentView;
const health = async (env: Env, id = 'delivery') => (await agent(env, id)).health!;
type Table = Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>;
const viewsOf = <T>(env: { deps: VentureDeps }, method: string, payload: unknown = {}) => (views as Table)[method](env.deps, owner, payload) as Promise<T>;
const deliveryOf = <T>(env: { deps: VentureDeps }, method: string, payload: unknown) => (delivery as Table)[method](env.deps, owner, payload) as Promise<T>;

async function bookkeeping(env: Env) {
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  return { plan, order };
}

async function failedRun(env: Env, order: Awaited<ReturnType<typeof bookkeeping>>['order']) {
  env.advance(60_000);
  return seedRun(env, order, { status: 'failed' });
}

/** Three failed runs on a real order business, as the delivery package would leave them: the team is quarantined. */
async function quarantine(env: RealOrderEnv) {
  await ventureAction(env.deps, owner, 'prepare', 'seed.failures', tx => {
    for (let index = 0; index < 3; index += 1) {
      tx.put<DeliveryRunRecord>({
        ...tx.base('venture-delivery-run'), orderId: env.order.id, playbookId: 'playbook_missing', playbookHash: 'hash', status: 'failed', servedBy: 'model',
        practice: false, callId: null, preview: null, deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null,
      });
    }
  });
}

const READ = turnOf('Look at the statement', [['files.list', {}]]);
const SEND = turnOf('Send the report to the client now', [['files.list', {}], ['outbox.propose', { connector: 'mail-app', summary: 'The September report.' }]]);
const ASK = turnOf('Ask which account is the current account', [['handoff.owner', { question: 'Which account is the cafe current account?' }]]);

test('health: healthy at first; two failed runs in a row is failing, three is quarantined; each with one plain reason', async () => {
  const env = await setup();
  const { order } = await bookkeeping(env);
  const fresh = await health(env);
  assert.equal(fresh.status, 'healthy');
  assert.equal(fresh.reason, null);
  assert.match(fresh.digest, /^[0-9a-f]{64}$/);
  assert.equal((await agent(env)).state, 'idle');

  await failedRun(env, order);
  assert.equal((await health(env)).status, 'healthy', 'one failure is not a pattern');
  assert.equal((await agent(env)).state, 'failed', 'its latest run failed');
  await failedRun(env, order);
  assert.deepEqual(await health(env).then(item => [item.status, item.reason]), ['failing', 'Its last 2 runs failed.']);
  await failedRun(env, order);
  assert.deepEqual(await health(env).then(item => [item.status, item.reason]), ['quarantined', 'Its last 3 runs failed. It starts no new work until you clear it.']);

  // A run that finished well breaks the run of failures.
  env.advance(60_000);
  await seedRun(env, order, { status: 'accepted', verdict: { choice: 'accepted', reason: null, at: env.now() } });
  assert.equal((await health(env)).status, 'healthy');
});

test('a scripted turn that proposes an outside action no step declares is refused TOOL_DENIED and quarantines the agent; its run stops advancing', async () => {
  const env = await realOrder();
  env.models.turns = [SEND, READ];
  const run = await startRun(env);
  const next = await approve(env, run);
  const stored = findRecord(env.store.read(), 'venture-delivery-run', run.id)!;
  const proposed = stored.harness!.toolCalls.find(item => item.tool === 'outbox.propose')!;
  assert.equal(proposed.effect, 'outside-write');
  assert.equal(proposed.envelope.ok ? null : proposed.envelope.error.code, 'TOOL_DENIED', 'the grant holds only the tools its steps declare');
  const team = await viewsOf<TeamListView>(env, 'venture.team.list');
  const quarantined = team.agents.find(item => item.id === 'delivery')!;
  assert.deepEqual([quarantined.health?.status, quarantined.health?.reason], ['quarantined', HEALTH_WORDS.undeclared]);
  assert.equal(team.teamHealth?.status, 'healthy', "the one agent's own cause is not a team-level one");
  // The run in flight stops advancing: its next turn is refused before anything is sent.
  const sent = env.models.sent;
  await assert.rejects(approve(env, next), (error: any) => error.code === 'AGENT_QUARANTINED' && error.message.startsWith('Bookkeeping agent is quarantined: It proposed an outside action'));
  assert.equal(env.models.sent, sent, 'nothing was sent');
  // Cleared with the digest the owner saw, the run goes on.
  await viewsOf(env, 'venture.team.clearQuarantine', { agentId: 'delivery', digest: quarantined.health!.digest });
  assert.equal((await approve(env, next)).status, 'waiting-for-you');
});

test('a cause no single role can claim makes one team-level quarantine, which one digest clears', async () => {
  const env = await setup();
  const { playbook, order } = await flagshipTeam(env, 'youtube');
  // files.read is held by two roles' steps, so this turn is the team's; outbox.propose is declared by no step, so it was refused.
  const denied = {
    id: 't1.2', turn: 1, tool: 'outbox.propose', input: null, inputDigest: 'd', outcome: 'failed' as const, effect: 'outside-write' as const, tier: 'code' as const,
    envelope: { ok: false as const, error: { code: 'TOOL_DENIED', name: 'ToolDenied', message: 'outbox.propose is not granted to this agent.' } },
    receiptIds: [], tableIds: [], startedAt: env.now(), finishedAt: env.now(),
  };
  await seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'waiting-for-you',
    harness: harness({ phase: 'act', turns: [turn(1, ['files.read', 'outbox.propose'], 'call_1')], toolCalls: [denied] }),
  });
  const team = await call<TeamListView>(env, 'venture.team.list');
  assert.ok(team.agents.every(item => item.health?.status !== 'quarantined'), 'no agent is quarantined on its own');
  assert.deepEqual([team.teamHealth?.status, team.teamHealth?.reason], ['quarantined', HEALTH_WORDS.teamUndeclared]);
  assert.ok(!team.agents.some(item => item.health?.digest === team.teamHealth!.digest), 'one team-level digest, not one per agent');
  await assert.rejects(deliveryOf(env, 'venture.delivery.run', { orderId: order.id, useTemplate: true }),
    (error: any) => error.code === 'AGENT_QUARANTINED' && error.message.startsWith('The team is quarantined: '));

  await assert.rejects(call(env, 'venture.team.clearQuarantine', { agentId: 'story-editor', digest: team.teamHealth!.digest }), code('APPROVAL_STALE'));
  await call(env, 'venture.team.clearQuarantine', { agentId: 'team', digest: team.teamHealth!.digest });
  assert.equal((await call<TeamListView>(env, 'venture.team.list')).teamHealth?.status, 'healthy', 'one clear is enough');
  assert.deepEqual(listRecords(env.store.read(), 'venture-health-clear').map(record => record.agentId), ['team']);
});

test('degraded: more than half of at least four reviewed outputs sent back or edited', async () => {
  const env = await setup();
  const { order } = await bookkeeping(env);
  const reviewed = async (choice: 'accepted' | 'edited' | 'rejected') => {
    env.advance(60_000);
    await seedRun(env, order, { status: choice, verdict: { choice, reason: null, at: env.now() } });
  };
  await reviewed('rejected'); await reviewed('edited'); await reviewed('accepted');
  assert.equal((await health(env)).status, 'healthy', 'three reviewed outputs are too few to judge');
  await reviewed('accepted');
  assert.equal((await health(env)).status, 'healthy', 'two of four is not more than half');
  await reviewed('rejected');
  assert.deepEqual(await health(env).then(item => [item.status, item.reason]), ['degraded', "The playbook is producing work people don't want. Revise it."]);
});

test('degraded: more than ten things waiting on the agent, or one waiting longer than seven days', async () => {
  const deep = await setup();
  const first = await bookkeeping(deep);
  for (let index = 0; index < 10; index += 1) await seedRun(deep, first.order, { status: 'waiting-for-you' });
  assert.equal((await health(deep)).status, 'healthy', 'ten is not more than ten');
  await seedRun(deep, first.order, { status: 'waiting-for-you' });
  assert.deepEqual(await health(deep).then(item => [item.status, item.reason]), ['degraded', '11 things wait on you for this agent.']);
  assert.equal((await agent(deep)).state, 'waiting');

  const old = await setup();
  const second = await bookkeeping(old);
  await seedRun(old, second.order, { status: 'waiting-for-you' });
  old.advance(7 * DAY);
  assert.equal((await health(old)).status, 'healthy', 'exactly seven days is not older than seven days');
  old.advance(60_000);
  assert.deepEqual(await health(old).then(item => [item.status, item.reason]), ['degraded', 'Something has waited on you for this agent for more than 7 days.']);
});

test('a quarantined agent starts no run; Clear quarantine needs the app and the health digest the owner saw', async () => {
  const env = await setup();
  const { order } = await bookkeeping(env);
  for (let index = 0; index < 3; index += 1) await failedRun(env, order);
  const seen = await health(env);
  assert.equal(seen.status, 'quarantined');
  await delivery['venture.delivery.playbook']!(env.deps, owner, {});
  await assert.rejects(delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }),
    (error: any) => error.code === 'AGENT_QUARANTINED' && error.message === 'Bookkeeping agent is quarantined: Its last 3 runs failed. It starts no new work until you clear it. Clear it on Team first.');
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').length, 3, 'nothing started');

  await assert.rejects(call(env, 'venture.team.clearQuarantine', { agentId: 'delivery', digest: seen.digest }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.team.clearQuarantine', { agentId: 'delivery', digest: 'f'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(call(env, 'venture.team.clearQuarantine', { agentId: 'designer', digest: seen.digest }), code('AGENT_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.team.clearQuarantine', { agentId: 'keeper', digest: seen.digest }), code('AGENT_IS_CODE'));
  const { agent: cleared } = await call<{ agent: AgentView }>(env, 'venture.team.clearQuarantine', { agentId: 'delivery', digest: seen.digest });
  assert.equal(cleared.health?.status, 'healthy');
  const [record] = listRecords(env.store.read(), 'venture-health-clear');
  assert.deepEqual([record.agentId, record.digest, record.reason], ['delivery', seen.digest, seen.reason]);
  await assert.rejects(call(env, 'venture.team.clearQuarantine', { agentId: 'delivery', digest: seen.digest }), code('APPROVAL_STALE'), 'nothing left to clear');

  env.advance(60_000);
  const run = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  assert.equal(run.status, 'ready-for-review', 'work starts again once cleared');
  // Failures before the clear no longer count; new ones do.
  await failedRun(env, order); await failedRun(env, order);
  assert.equal((await health(env)).status, 'failing');
});

test('quarantined while the run was being prepared: the commit that would start it refuses', async () => {
  const env = await realOrder();
  env.models.turns = [READ];
  const preview = env.models.preview.bind(env.models);
  env.models.preview = async <T>(ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> => { await quarantine(env); return preview(ctx, task); };
  await assert.rejects(startRun(env), code('AGENT_QUARANTINED'));
  assert.deepEqual(listRecords(env.store.read(), 'venture-delivery-run').map(item => item.status), ['failed', 'failed', 'failed'], 'no run started');
});

test('quarantined while a turn was out: none of its tools run', async () => {
  const env = await realOrder();
  env.models.turns = [READ, READ];
  const run = await startRun(env);
  const runPreview = env.models.runPreview.bind(env.models);
  env.models.runPreview = (async (...args: Parameters<typeof runPreview>) => { const outcome = await runPreview(...args); await quarantine(env); return outcome; }) as typeof runPreview;
  await assert.rejects(approve(env, run), code('AGENT_QUARANTINED'));
  assert.deepEqual(findRecord(env.store.read(), 'venture-delivery-run', run.id)!.harness!.toolCalls, [], 'no tool ran');
});

test("a quarantined team's answer and heavy-work brief do not move its runs on", async () => {
  const env = await realOrder();
  env.models.turns = [ASK, READ];
  const run = await startRun(env);
  const asking = await approve(env, run);
  assert.equal(asking.status, 'needs-answer');
  await quarantine(env);
  await assert.rejects(deliveryOf(env, 'venture.delivery.answer', { runId: run.id, answer: 'The HDFC account ending 1234.' }), code('AGENT_QUARANTINED'));
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', run.id)!.status, 'needs-answer');

  // A run waiting on a heavy-work brief: approving the brief is refused; nothing starts.
  const briefing = await ventureAction(env.deps, owner, 'prepare', 'seed.brief', tx => tx.put<DeliveryRunRecord>({
    ...tx.base('venture-delivery-run'), orderId: env.order.id, playbookId: 'playbook_missing', playbookHash: 'hash', status: 'brief-waiting', servedBy: 'model',
    practice: false, callId: null, preview: null, deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null,
    harness: harness({
      phase: 'brief', delegations: [{
        toolCallId: 't1.1', turn: 1, cli: 'claude-code', executable: 'claude', version: '1.0.0', briefText: 'Sort the bills.', uploadIds: [],
        limits: { minutes: 5, maxTurns: 4, budgetMicros: null }, digest: 'e'.repeat(64), status: 'waiting', startedAt: null, delegateRunId: null,
      }],
    }),
  }));
  await assert.rejects(deliveryOf(env, 'venture.delivery.delegate', { runId: briefing.id, digest: 'e'.repeat(64), decision: 'approve' }), code('AGENT_QUARANTINED'));
});
