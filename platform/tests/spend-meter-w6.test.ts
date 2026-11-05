// W6 6G5 (D44): a spend meter per agent and per routine with an owner cap, and a model receipt on every run. Costs come
// from code and the usage records already kept, never a guessed price. Runs on the owner's own Codex or Claude plan say
// "On your plan" with no rupee figure. A routine at its own limit, its agent's limit or the month's limit is refused
// before it starts, with the reason; a paid call inside a routine run is held to that routine's limit too.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { DeliveryRunRecord, MicroString, ModelCallRecord, RoutineRecord, RoutineRunRecord, RoutineRunsView, SpendPolicyView, SpendRecord, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { currentVenture, findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { currentRoutineScope, withRoutineScope } from '../runtime/venture/agents/routine-scope.ts';
import { runModelReceipt, callsModelReceipt } from '../runtime/venture/money/model-receipt.ts';
import { routineTick } from '../runtime/venture/agents/routine-runner.ts';
import { chatRoute } from '../runtime/venture/agents/consent.ts';
import { owner as portOwner, realPortEnv, wordsTask } from './venture-real-port-env.ts';
import { chatConsent, chiefBusiness, type ChiefEnv } from './venture-chief-helpers.ts';
import { said, scriptChat } from './venture-agent-helpers.ts';
import { NOW, owner } from './venture-judge-helpers.ts';
import { nativeJudgeBusiness, readyNativeDraft } from './native-judge-business.ts';

const phone: Context = { ...owner, channel: 'phone' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const MIN = 60_000;
const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();
const PROMPT = 'Tell me which videos are waiting on me and what each one needs from me.';

async function checked(env: ChiefEnv): Promise<void> {
  const route = chatRoute(env.models.status());
  assert.ok(route);
  await ventureAction(env.deps, owner, 'prepare', 'test.check', tx => tx.put({
    ...tx.base('venture-connector-check'), rows: [{ connectorId: `model:${route.presetId}`, outcome: 'answered', line: 'Your key answered.', account: null, expiresOn: null }],
  } as never));
}
async function routine(env: ChiefEnv, name = 'Editor check', agent: string | null = 'story-editor'): Promise<string> {
  if (!listRecords(env.store.read(), 'venture-connector-check').length) await checked(env);
  const { routine } = await env.agents('venture.routines.set', { routine: { name, agent, prompt: PROMPT, on: true, schedule: { kind: 'interval', everyMinutes: 60, from: NOW } } });
  return routine.id;
}
/** A settled paid call at the env's clock, worked for agent and routine. */
async function spent(env: { deps: any }, micros: MicroString, agent: string | null, routineId: string | null = null) {
  return ventureAction(env.deps, owner, 'prepare', 'seed.spend', tx => tx.put<SpendRecord>({
    ...tx.base('venture-spend'), key: `seed-${Math.random()}`, item: 'model:anthropic-sonnet-5-5', label: 'Seeded call', agent, connector: 'anthropic-sonnet-5-5', payer: 'connection:none',
    draftDigest: 'd', rate: null, reservedMicros: micros, settledMicros: micros, settledBy: 'usage', phase: 'settled', quoteId: null, ref: null, refusal: null, settledAt: tx.now,
    ...(routineId ? { routine: routineId } : {}),
  }));
}
const policy = (env: ChiefEnv, payload: unknown, ctx: Context = owner) => env.call('venture.spend.policy.set', payload, ctx) as Promise<SpendPolicyView>;
const routineRows = async (env: ChiefEnv) => (await env.call('venture.queue.list')).rows.filter((row: any) => row.id.startsWith('routine:'));
const runsOf = (env: ChiefEnv, id: string) => env.agents('venture.routines.runs', { id }) as Promise<RoutineRunsView>;

test('a model call made inside a routine run names that routine; past the routine\'s own limit the next one is refused before it is sent', async () => {
  const env = await realPortEnv();
  await env.connect('anthropic-haiku-5-5');
  const made = await ventureAction(env.deps, portOwner, 'approve', 'seed.routine', tx => tx.put<RoutineRecord>({
    ...tx.base('venture-routine'), name: 'Morning check', agent: null, setBy: 'owner', prompt: PROMPT, schedule: { kind: 'interval', everyMinutes: 60, from: '2026-10-15T09:00:00.000Z' }, on: true, removedAt: null,
  }));
  assert.equal(currentRoutineScope(), undefined, 'no routine outside a run');
  const first = await withRoutineScope({ routineId: made.id, runId: 'rrun_one' }, async () => {
    assert.deepEqual(currentRoutineScope(), { routineId: made.id, runId: 'rrun_one' });
    const { outcome } = await env.approveTask(wordsTask('interview'));
    return outcome;
  });
  const call = listRecords(env.store.read(), 'venture-model-call').find(row => row.id === first.callId)!;
  assert.deepEqual([call.routineId, call.routineRunId], [made.id, 'rrun_one']);
  const charge = listRecords(env.store.read(), 'venture-spend').find(row => row.ref === call.id)!;
  assert.equal(charge.routine, made.id);
  // A limit below what it already spent: the next call inside the routine is refused; other work goes on.
  await env.money('venture.spend.policy.set', { routineCaps: [{ routine: made.id, capUsd: '0.00' }] });
  await assert.rejects(withRoutineScope({ routineId: made.id, runId: 'rrun_two' }, async () => (await env.approveTask(wordsTask('interview'))).outcome), (error: any) => {
    assert.equal(error?.code, 'SPEND_CAP');
    assert.match(error.message, /^Morning check reached its own monthly limit of USD 0\.0000/);
    assert.match(error.message, /Other work goes on\./);
    return true;
  });
  const outside = await (await env.approveTask(wordsTask('interview'))).outcome;
  assert.equal(outside.by, 'model', 'a call outside the routine is not held to its limit');
});

test('the meter: each agent and each routine, this month\'s spend with its receipt, plan runs with no rupee figure, the owner\'s cap, paused at it', async () => {
  const env = await chiefBusiness();
  const routineId = await routine(env);
  await policy(env, { inrPerUsd: '83.50' });
  await spent(env, '400000', 'story-editor', routineId);
  await spent(env, '100000', 'story-editor');
  await ventureAction(env.deps, owner, 'prepare', 'seed.plan', tx => tx.put({
    ...tx.base('venture-model-call'), purpose: 'agent-chat', agentId: 'story-editor', routineId, routineRunId: 'rrun_x', tier: 'main', presetId: 'claude-code-cli', routeKind: 'claude-cli', status: 'completed', costMicros: null, estimatedMaxCostMicros: '0', usage: { inputTokens: 900, outputTokens: 120 },
  } as never));
  let view = await env.call('venture.spend.policy.get') as SpendPolicyView;
  const editor = view.meters!.agents.find(row => row.id === 'story-editor')!;
  assert.deepEqual([editor.name, editor.used, editor.cap, editor.paused, editor.plan, editor.line],
    ['Story editor', 'USD 0.5000 this month', null, false, '1 job on your plan', 'No limit of its own']);
  assert.equal(editor.usedLead.currency, 'INR');
  assert.equal(JSON.stringify(editor.plan).includes('₹'), false, 'plan runs carry no rupee figure');
  const receipt = findRecord(env.store.read(), 'venture-sum-receipt', editor.receiptId) as SumReceiptRecord;
  assert.deepEqual([receipt.subject, receipt.totalMinor], [{ type: 'spent-by', scope: 'agent', id: 'story-editor', month: '2026-10' }, '500000']);
  const daily = view.meters!.routines.find(row => row.id === routineId)!;
  assert.deepEqual([daily.name, daily.used, daily.plan], ['Editor check', 'USD 0.4000 this month', '1 job on your plan']);

  await assert.rejects(policy(env, { routineCaps: [{ routine: routineId, capUsd: '1.00' }] }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(policy(env, { routineCaps: [{ routine: 'routine_nope', capUsd: '1.00' }] }), code('INVALID_VENTURE_REQUEST'));
  view = await policy(env, { routineCaps: [{ routine: routineId, capUsd: '0.40' }], agentCaps: [{ agent: 'story-editor', capUsd: '1.00' }] });
  const capped = view.meters!.routines.find(row => row.id === routineId)!;
  assert.deepEqual([capped.cap, capped.capUsd, capped.usedPermille, capped.paused], ['USD 0.4000 a month', '0.40', 1000, true]);
  assert.match(capped.line, /^Paused: it reached its limit\. Other work goes on\./);
  assert.match(capped.capRupees!, /^₹33\.40/);
  const half = view.meters!.agents.find(row => row.id === 'story-editor')!;
  assert.deepEqual([half.usedPermille, half.paused, half.line], [500, false, '50% of its limit used']);
  // Clearing a limit: an empty list keeps nothing.
  view = await policy(env, { routineCaps: [] });
  assert.equal(view.meters!.routines.find(row => row.id === routineId)!.cap, null);
});

test('a routine at its own limit is refused before it starts: the sweep skips it with the reason, and Run it on a waiting card sends nothing', async () => {
  const env = await chiefBusiness();
  scriptChat(env, { answer: () => ({ parts: [said('Two videos wait on your notes.')] }) });
  await chatConsent(env);
  const routineId = await routine(env);
  // A card parks first, then the routine reaches its limit before the owner taps Run it.
  env.setNow(at(61 * MIN));
  await routineTick(env.deps, owner);
  const [row] = await routineRows(env);
  await spent(env, '300000', 'story-editor', routineId);
  await policy(env, { routineCaps: [{ routine: routineId, capUsd: '0.30' }] });
  const refused = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.deepEqual([refused.outcome, refused.reason], ['refused', 'SPEND_CAP'], JSON.stringify(refused));
  assert.equal(listRecords(env.store.read(), 'venture-model-call').filter(call => call.purpose === 'agent-chat').length, 0, 'nothing went to the AI');
  let [run] = (await runsOf(env, routineId)).runs;
  assert.equal(run.state, 'needs-input', 'it still waits, so the owner can raise the limit and run it');
  // Next occurrence: the sweep skips it with the reason instead of parking a card.
  await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'deny' });
  env.setNow(at(122 * MIN));
  await routineTick(env.deps, owner);
  [run] = (await runsOf(env, routineId)).runs;
  assert.equal(run.state, 'skipped');
  assert.match(run.line, /^Skipped: Editor check reached its own monthly limit of USD 0\.3000/);
  assert.equal((await routineRows(env)).length, 0);
});

test("Run it carries the routine to the AI call, and the run's history shows a model receipt", async () => {
  const env = await chiefBusiness();
  const scopes: unknown[] = [];
  scriptChat(env, { answer: () => { scopes.push(currentRoutineScope()); return { parts: [said('Two videos wait on your notes.')] }; } });
  await chatConsent(env);
  const routineId = await routine(env);
  env.setNow(at(61 * MIN));
  await routineTick(env.deps, owner);
  const [row] = await routineRows(env);
  const runId = row.id.slice('routine:'.length).split(':')[0];
  const decided = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  assert.deepEqual(scopes, [{ routineId, runId }]);
  // The calls this run made and their charge, as the real port keeps them (the judge port keeps a short record, so they are seeded here).
  const seeded = await ventureAction(env.deps, owner, 'prepare', 'seed.call', tx => tx.put({
    ...tx.base('venture-model-call'), purpose: 'agent-chat', agentId: 'story-editor', routineId, routineRunId: runId, tier: 'main', presetId: 'anthropic-sonnet-5-5', routeKind: 'anthropic-messages', model: 'claude-sonnet-5-5', status: 'completed',
    costMicros: '42000', estimatedMaxCostMicros: '90000', usage: { inputTokens: 1200, outputTokens: 300 }, answeredBy: 'claude-sonnet-5-5',
  } as never)) as unknown as { id: string };
  await ventureAction(env.deps, owner, 'prepare', 'seed.charge', tx => tx.put<SpendRecord>({
    ...tx.base('venture-spend'), key: `model:${seeded.id}`, item: 'model:anthropic-sonnet-5-5', label: 'Claude Sonnet 5.5, agent-chat', agent: 'story-editor', connector: 'anthropic-sonnet-5-5', payer: 'connection:none',
    draftDigest: 'd', rate: null, reservedMicros: '90000', settledMicros: '42000', settledBy: 'usage', phase: 'settled', quoteId: null, ref: seeded.id, refusal: null, settledAt: tx.now, routine: routineId,
  }));
  const [run] = (await runsOf(env, routineId)).runs;
  const receipt = run.receipt!;
  assert.deepEqual([receipt.tool, receipt.model, receipt.tier, receipt.usage, receipt.cost, receipt.state, receipt.agent],
    ['Claude Sonnet 5.5, your key', 'claude-sonnet-5-5', 'Main model', '1,200 tokens in, 300 out', 'USD 0.0420', 'priced', 'Story editor']);
  const sum = findRecord(env.store.read(), 'venture-sum-receipt', receipt.receiptId!) as SumReceiptRecord;
  assert.deepEqual(sum.subject, { type: 'spent-by', scope: 'routine-run', id: runId, month: null });
});

test('model receipts: a plan run says "On your plan" with no rupee figure; a key run shows its cost and receipt; a template run used no AI; a retired agent says so', async () => {
  const env = await nativeJudgeBusiness('Pricing strategy advice for small online shops, done by AI helpers with me checking every reply.');
  const route = env.deps.agentRoute!;
  env.deps.agentRoute = async (ctx, agentId) => ({ ...(await route(ctx, agentId)), presetId: 'codex-cli' });
  const draft = await readyNativeDraft(env);
  const detail = await env.call('venture.runs.get', { runId: draft.id });
  const plan = detail.modelReceipt;
  assert.deepEqual([plan.tool, plan.model, plan.tier, plan.cost, plan.state], ['Codex', 'synthetic-tool-agent', 'Main model', 'On your plan', 'plan']);
  assert.equal(plan.costLead, undefined);
  assert.equal(JSON.stringify(plan).includes('₹'), false);
  assert.equal(plan.line, 'Codex · synthetic-tool-agent · Main model · Tokens not reported · On your plan');

  // The same run as a key run: the provider's reported use priced by code, with the job cost receipt.
  const state = env.store.read();
  const venture = currentVenture(state)!;
  const run = findRecord(state, 'venture-delivery-run', draft.id) as DeliveryRunRecord;
  const keyed: DeliveryRunRecord = { ...run, agentJob: { ...run.agentJob!, route: { presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', tier: 'main' }, model: 'claude-sonnet-5-5',
    usage: { inputTokens: 12400, outputTokens: 1900, source: 'provider-reported' }, cost: { display: 'USD 0.0657', state: 'priced', spendId: 'spend_x', receiptId: 'sum_x' } } };
  const key = runModelReceipt(state, venture, keyed);
  assert.deepEqual([key.tool, key.usage, key.cost, key.state, key.receiptId], ['Claude Sonnet 5.5, your key', '12,400 tokens in, 1,900 out', 'USD 0.0657', 'priced', 'sum_x']);
  const unknown = runModelReceipt(state, venture, { ...keyed, agentJob: { ...keyed.agentJob!, cost: { display: 'Final cost is not known. The allowance stays held.', state: 'unknown', spendId: 'spend_x' } } });
  assert.deepEqual([unknown.cost, unknown.state, unknown.receiptId], ['Not known yet', 'unknown', undefined]);
  const template = runModelReceipt(state, venture, { ...run, agentJob: undefined, servedBy: 'template', callId: null } as DeliveryRunRecord);
  assert.deepEqual([template.tool, template.tier, template.cost, template.state], ['Built-in templates', 'No AI', 'No cost', 'none']);
  const retired = runModelReceipt(state, venture, { ...run, agentJob: { ...run.agentJob!, scope: { ...run.agentJob!.scope, agentId: 'old-helper' } } });
  assert.equal(retired.agent, 'Old helper (retired)');
});

test('a routine run on the owner\'s plan: tokens when reported, "On your plan", never a rupee figure', async () => {
  const env = await chiefBusiness();
  await env.call('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const state = env.store.read();
  const venture = currentVenture(state)!;
  const calls = [{ id: 'call_a', kind: 'venture-model-call', purpose: 'agent-chat', agentId: 'story-editor', tier: 'fast', presetId: 'codex-cli', routeKind: 'codex-cli', model: 'gpt-6-astra', status: 'completed', costMicros: null, usage: { inputTokens: 500, outputTokens: 80 } }] as unknown as ModelCallRecord[];
  const receipt = callsModelReceipt(state, venture, calls, { agent: 'story-editor' });
  assert.deepEqual([receipt.tool, receipt.model, receipt.tier, receipt.usage, receipt.cost, receipt.state], ['Codex', 'gpt-6-astra', 'Quick model', '500 tokens in, 80 out', 'On your plan', 'plan']);
  assert.equal(JSON.stringify(receipt).includes('₹'), false);
  const none = callsModelReceipt(state, venture, [], { agent: null });
  assert.deepEqual([none.tool, none.state], ['Built-in templates', 'none']);
  void ({} as RoutineRunRecord);
});
