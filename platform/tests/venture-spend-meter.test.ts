// Spend meters, the day's cap, the alert share and budget pressure (Ink v2 wave 4, 4F2; catalogue M3, M4, M5; spend
// limits stay in US dollars with a rupee view at the owner's rate). The meter says how much of this month's limit is
// used, worked out in code with its sum receipt; Today says so once a month at the alert share; past the limit the
// owner can raise it, connect another key or wait until the reset date, never buy credits; an agent past its own
// monthly limit is paused alone; near a limit the next turn is told to report, not start new work, optional steps are
// skipped and the automatic judge does not run. Nothing spends past a limit without the owner raising it.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { MicroString, SpendPolicyView, SpendRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { budgetPressure } from '../runtime/venture/money/spend.ts';
import { actTask, newHarnessState, DEFAULT_LIMITS } from '../runtime/venture/delivery/harness/loop.ts';
import { BUDGET_LINE, SKIPPED_STEP_LINE } from '../runtime/venture/delivery/harness/breaker.ts';
import {
  approve, call, code, decide, owner, phone, queue, RECONCILE, DONE, setup, startRun,
} from './venture-run-controls-env.ts';
import { business, PLAIN_IDEA, readyDraft } from './venture-judge-helpers.ts';
import { owner as portOwner, realPortEnv, wordsTask } from './venture-real-port-env.ts';

type Handler = (d: VentureDeps, c: Context, p: unknown) => Promise<SpendPolicyView>;
const policySet = (env: { deps: VentureDeps }, payload: unknown, ctx: Context = owner) => (money as Record<string, Handler>)['venture.spend.policy.set'](env.deps, ctx, payload);
const policyGet = (env: { deps: VentureDeps }) => (money as Record<string, Handler>)['venture.spend.policy.get'](env.deps, owner, {});

/** A settled paid call at this many micro-dollars, at the env's clock, worked for agent (or none). */
async function spent(env: { deps: VentureDeps }, micros: MicroString, agent: string | null = null, key = `seed-${Math.random()}`) {
  return ventureAction(env.deps, owner, 'prepare', 'seed.spend', tx => tx.put<SpendRecord>({
    ...tx.base('venture-spend'), key, item: 'connector:fal-video', label: 'One video render', agent, connector: 'fal-video', payer: 'connector:fal',
    draftDigest: 'd', rate: null, reservedMicros: micros, settledMicros: micros, settledBy: 'bill', phase: 'settled', quoteId: null, ref: null, refusal: null, settledAt: tx.now,
  }));
}

test('limits: a daily cap and an alert share (80% unless set), set in US dollars inside the app; bad values refused', async () => {
  const env = await setup();
  const fresh = await policyGet(env);
  assert.equal(fresh.alertPermille, 800);
  assert.equal(fresh.alert, "Today tells you at 80% of this month's limit.");
  assert.equal(fresh.dailyCap, 'No daily limit');
  assert.equal(fresh.meter, null, 'no monthly limit, no meter');
  const set = await policySet(env, { capUsd: '10.00', dailyCapUsd: '2.50', alertPermille: 750, inrPerUsd: '83.50' });
  assert.deepEqual([set.dailyCapMicros, set.dailyCapUsd, set.dailyCap, set.alertPermille, set.alert],
    ['2500000', '2.50', 'USD 2.5000 a day', 750, "Today tells you at 75% of this month's limit."]);
  assert.match(set.dailyCapRupees!, /^₹208\.75 at ₹83\.50 per \$1/);
  for (const bad of [{ alertPermille: 0 }, { alertPermille: 1001 }, { alertPermille: 79.5 }, { dailyCapUsd: '-1' }, { dailyCap: '12', dailyCapUsd: '1.00' }]) {
    await assert.rejects(policySet(env, bad), (error: any) => typeof error?.code === 'string', JSON.stringify(bad));
  }
  await assert.rejects(policySet(env, { dailyCapUsd: '1.00' }, phone), code('APP_APPROVAL_REQUIRED'));
  const kept = await policySet(env, { askFirstUsd: '1.00' });
  assert.deepEqual([kept.dailyCapMicros, kept.alertPermille], ['2500000', 750], 'other changes keep them');
  const cleared = await policySet(env, { dailyCapUsd: null });
  assert.equal(cleared.dailyCapMicros, null);
});

test('meter: the share of this month\'s limit used, worked out in code with its receipt; near at the alert share; past the cap, raise, connect or wait, never credits', async () => {
  const env = await setup();
  await policySet(env, { capUsd: '10.00' });
  await spent(env, '7900000');
  let view = await policyGet(env);
  const meter = view.meter!;
  assert.deepEqual([meter.usedPermille, meter.line, meter.near, meter.over, meter.resetOn, meter.reset],
    [790, "79% of this month's limit used", false, false, '2026-11-01', 'Starts again on 1 Nov']);
  const receipt = findRecord(env.store.read(), 'venture-sum-receipt', meter.receiptId)!;
  assert.equal(receipt.totalMinor, '7900000');
  assert.deepEqual(receipt.subject, { type: 'spent', month: '2026-10' });
  assert.equal(view.limitReached, undefined);
  await spent(env, '100000');
  assert.equal((await policyGet(env)).meter!.near, true, 'at 80%');
  await spent(env, '2000000');
  view = await policyGet(env);
  assert.deepEqual([view.meter!.usedPermille, view.meter!.over, view.meter!.line], [1000, true, "This month's limit is used up"]);
  assert.deepEqual(view.limitReached, {
    scope: 'business', line: "This month's AI limit is used up. Nothing more is spent until you raise it or the month ends.",
    options: [{ id: 'raise', label: 'Raise the limit' }, { id: 'wait', label: 'Wait until 1 Nov' }],
  }, 'another key would not help with the business\'s own limit');
  assert.ok(!JSON.stringify(view).toLowerCase().includes('credit'), 'never credits');
});

test('limit reached: only a key at its own monthly limit offers connecting another key', async () => {
  const env = await realPortEnv();
  await env.connect('anthropic-haiku-5-5');
  assert.equal((await env.money('venture.spend.policy.get')).keyLimits, undefined);
  // This key's own limit is USD 5.00 a month (the default when it was connected): this month's calls reach it.
  await ventureAction(env.deps, portOwner, 'prepare', 'seed.calls', tx => tx.put({
    ...tx.base('venture-model-call'), purpose: 'interview', tier: 'fast', presetId: 'anthropic-haiku-5-5', status: 'completed', costMicros: '5000000', estimatedMaxCostMicros: '1000',
  } as never));
  const view = await env.money('venture.spend.policy.get');
  assert.deepEqual(view.keyLimits, [{
    scope: 'key', presetId: 'anthropic-haiku-5-5',
    line: 'Claude Haiku 5.5 reached its own monthly limit of USD 5.0000. Nothing more goes to it until you raise that limit or the month ends.',
    options: [{ id: 'raise', label: 'Raise its limit' }, { id: 'connect', label: 'Connect another key' }, { id: 'wait', label: 'Wait until 1 Nov' }],
  }]);
  // The port refuses the next call the same way, BUDGET_REACHED, before anything is sent.
  const { outcome } = await env.approveTask(wordsTask('interview', { containsClientData: true }));
  await assert.rejects(outcome, code('BUDGET_REACHED'));
  assert.equal(env.sent.length, 0);
});

test('daily cap: through preview then approve, a call that would pass today\'s cap is refused in the claim, before it is sent; the next day starts again', async () => {
  const env = await realPortEnv();
  await env.connect('anthropic-haiku-5-5');
  const probe = (await env.port.preview(portOwner, wordsTask('interview', { containsClientData: true })))!;
  const estimate = probe.estimatedMaxCostMicros;
  await env.money('venture.spend.policy.set', { dailyCap: estimate });
  const first = await env.approveTask(wordsTask('interview', { containsClientData: true }));
  await first.outcome;
  assert.equal(env.sent.length, 1);
  const second = await env.approveTask(wordsTask('interview', { containsClientData: true }));
  await assert.rejects(second.outcome, (error: any) => {
    assert.equal(error.code, 'SPEND_CAP');
    assert.match(error.message, /^This could take today's spend to USD \d+\.\d{4}, past your daily limit of USD \d+\.\d{4}\. It was not run\. Raise the limit or wait until tomorrow\.$/);
    return true;
  });
  assert.equal(env.sent.length, 1, 'nothing more was sent');
  env.advance(24 * 60 * 60_000);
  const nextDay = await env.approveTask(wordsTask('interview', { containsClientData: true }));
  await nextDay.outcome;
  assert.equal(env.sent.length, 2);
});

test('alert: one Today notice a month at the alert share; once seen it does not come back that month', async () => {
  const env = await setup();
  await policySet(env, { capUsd: '10.00', inrPerUsd: '83.50' });
  await spent(env, '7000000');
  const none = (await queue(env)).rows.find(row => row.id.startsWith('spend:alert'));
  assert.equal(none, undefined, 'below the alert share: nothing on Today');
  await spent(env, '1500000');
  const row = (await queue(env)).rows.find(row => row.id.startsWith('spend:alert'))!;
  assert.equal(row.title, "85% of this month's AI limit is used");
  assert.equal(row.line, 'USD 8.5000 of USD 10.0000, ₹709.75 of ₹835.00 at ₹83.50 per $1 (your rate, set 16 Oct 2026). It starts again on 1 Nov.');
  assert.deepEqual(row.actions.map(item => [item.id, item.primary]), [['later', true]]);
  assert.equal((await decide(env, row, 'later')).outcome, 'done');
  await spent(env, '500000');
  assert.equal((await queue(env)).rows.find(item => item.id.startsWith('spend:alert')), undefined, 'one notice a month');
});

test('agent limit: through preview then approve, past its own monthly limit only that agent is paused, with a Today row; other spend goes on', async () => {
  const env = await realPortEnv();
  await env.connect('anthropic-haiku-5-5');
  await env.money('venture.spend.policy.set', { agentCaps: [{ agent: 'delivery', capUsd: '1.00' }], inrPerUsd: '83.50' });
  await spent(env, '999990', 'delivery');
  const turn = await env.approveTask(wordsTask('agent-turn', { containsClientData: true }));
  await assert.rejects(turn.outcome, (error: any) => {
    assert.equal(error.code, 'SPEND_CAP');
    assert.equal(error.message, 'Bookkeeping agent reached its own monthly limit of USD 1.0000, so it is paused until you raise it or the month ends. Other work goes on.');
    return true;
  });
  assert.equal(env.sent.length, 0, 'the agent\'s call was not sent');
  const other = await env.approveTask(wordsTask('interview', { containsClientData: true }));
  await other.outcome;
  assert.equal(env.sent.length, 1, 'other work goes on');
  await spent(env, '10', 'delivery');
  const view = await policyGet(env);
  assert.deepEqual(view.agentCaps!.map(item => [item.agent, item.name, item.cap, item.paused]), [['delivery', 'Bookkeeping agent', 'USD 1.0000 a month', true]]);
  assert.match(view.agentCaps![0].capRupees!, /^₹83\.50 at ₹83\.50 per \$1/);
  assert.match(view.agentCaps![0].usedRupees!, /^₹83\.50 at /);
  const rows = await call<{ rows: { id: string; title: string; line?: string }[] }>(env as never, 'venture.queue.list', {});
  const row = rows.rows.find(item => item.id.startsWith('spend:agent:delivery'))!;
  assert.equal(row.title, 'Bookkeeping agent is paused: it reached its own monthly limit of USD 1.0000');
  assert.match(row.line!, /^Other work goes on\. Raise its limit in Money to let it go on this month\. Its limit is ₹83\.50 at ₹83\.50 per \$1/);
  await assert.rejects(policySet(env, { agentCaps: [{ agent: 'delivery', capUsd: '1.00' }, { agent: 'delivery', capUsd: '2.00' }] }), code('INVALID_VENTURE_REQUEST'));
});

test('agent limit: a rehearsal\'s agent turn, sent on standing consent with no approval, is refused at the agent\'s limit before it is sent', async () => {
  const env = await realPortEnv();
  await env.connect('anthropic-haiku-5-5');
  await env.money('venture.spend.policy.set', { agentCaps: [{ agent: 'delivery', capUsd: '1.00' }] });
  await spent(env, '1000000', 'delivery');
  // The same call a rehearsal's act turn makes: generate, standing consent, made-up clients only.
  await assert.rejects(env.port.generate(portOwner, wordsTask('agent-turn')), code('SPEND_CAP'));
  assert.equal(env.sent.length, 0, 'nothing spent past the agent\'s limit');
  const refused = listRecords(env.store.read(), 'venture-spend').filter(record => record.phase === 'refused');
  assert.deepEqual(refused.map(record => record.agent), ['delivery']);
  await env.port.generate(portOwner, wordsTask('client-sim'));
  assert.equal(env.sent.length, 1, 'a practice client is no agent\'s spend');
});

test('projection: "about N more drafts at today\'s cost", worked out in code from the last drafts\' costs, labelled a projection', async () => {
  const env = await setup();
  await policySet(env, { capUsd: '0.01', inrPerUsd: '83.50' });
  for (let n = 0; n < 2; n += 1) {
    let run = await startRun(env, [RECONCILE, DONE]);
    while (run.status === 'waiting-for-you') run = await approve(env, run);
    assert.equal(run.status, 'ready-for-review');
  }
  const meter = (await policyGet(env)).meter!;
  // Each draft cost three calls of USD 0.0002 here; the cap leaves USD 0.0100, so 16 more fit at the dearest draft's cost.
  assert.deepEqual(meter.projection && { line: meter.projection.line, label: meter.projection.label, count: meter.projection.runIds.length },
    { line: "About 16 more drafts at today's cost", label: 'projection from your last 2 drafts', count: 2 });
  assert.equal(meter.projection!.left, 'USD 0.0100 left');
  assert.match(meter.projection!.leftRupees!, /^₹0\.84 at ₹83\.50 per \$1/, 'the room left in rupees too, at the owner\'s rate');
});

test('pressure: near the day\'s or the month\'s limit the next turn is told to report, and an optional step is skipped', async () => {
  const env = await setup();
  await policySet(env, { capUsd: '10.00', dailyCapUsd: '1.00' });
  const venture = () => findRecord(env.store.read(), 'venture-record', env.venture.id)!;
  const now = () => env.deps.clock().toISOString();
  assert.equal(budgetPressure(env.store.read(), venture(), now()).nearlyUsed, false);
  await spent(env, '800000');
  assert.equal(budgetPressure(env.store.read(), venture(), now()).nearlyUsed, true, '80% of the day\'s cap');
  const steps = [
    { id: 'gather', kind: 'gather', title: 'Read the files', tools: ['files.list'], guidance: [] },
    { id: 'polish', kind: 'work', title: 'Polish the wording', tools: ['files.list'], guidance: [], optional: true },
  ];
  const ctx = {
    serviceType: 'bookkeeping', offer: { name: 'Books', description: 'Books' }, clientRequest: 'Close my books', playbook: { steps }, dictionaryManifest: '',
    files: [], containsClientData: true, allowed: [], budget: budgetPressure(env.store.read(), venture(), now()),
  } as never;
  const task = actTask(ctx, newHarnessState(['files.list'], DEFAULT_LIMITS, []));
  assert.ok(task.instructions.includes(BUDGET_LINE));
  assert.equal(BUDGET_LINE, "Budget nearly used: report what you have; don't start new work.");
  const input = task.input as { steps: { step: string }[]; skipped: { step: string; line: string }[]; budget: { note: string } };
  assert.deepEqual(input.steps.map(step => step.step), ['Read the files']);
  assert.deepEqual(input.skipped, [{ step: 'Polish the wording', line: SKIPPED_STEP_LINE }]);
  assert.equal(SKIPPED_STEP_LINE, "Skipped polishing to stay within this month's limit");
  assert.equal(input.budget.note, BUDGET_LINE);
  // Without pressure nothing changes, so the text the owner approves stays the same.
  const calm = actTask({ ...(ctx as object), budget: { nearlyUsed: false } } as never, newHarnessState(['files.list'], DEFAULT_LIMITS, []));
  assert.ok(!calm.instructions.includes(BUDGET_LINE));
  // The run's own cap at 80% counts too.
  const nearRun = { ...newHarnessState(['files.list'], { ...DEFAULT_LIMITS, maxCostMicros: '1000' }, []), used: { turns: 1, toolCalls: 0, costMicros: '800' } };
  assert.ok(actTask({ ...(ctx as object), budget: { nearlyUsed: false } } as never, nearRun).instructions.includes(BUDGET_LINE));
  // A real order's turn carries it: the run's loop reads the day's spend when it previews the turn.
  await spent(env, '150000');
  const run = await startRun(env, [RECONCILE, DONE]);
  assert.ok(run.preview!.payloadText.includes(BUDGET_LINE));
});

test('pressure: the automatic judge does not run past the alert share and says so; code checks still run', async () => {
  const env = await business(PLAIN_IDEA);
  await policySet(env, { capUsd: '10.00' });
  await spent(env, '8200000');
  const run = await readyDraft(env);
  assert.equal(run.status, 'ready-for-review');
  assert.equal(run.judge.status, 'failed');
  assert.equal(run.judge.line, "Not checked: this month's limit is nearly used.");
  assert.equal(env.models.rulesTasks().length, 0, 'no judge call was made');
  assert.ok(run.checks.length > 0, 'code checks always run');
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').length, 1);
});
