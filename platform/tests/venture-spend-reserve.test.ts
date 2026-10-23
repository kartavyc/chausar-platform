// Package 1C (H4, M1): the run's spend cap is reserved before each paid call (a real order's model calls, heavy work
// and every call of a rehearsal), so the call that would cross it is refused before it is sent and Today asks for more
// room; and the owner types spend limits and rates in US dollars, which one parser turns into whole micro units. No
// network and no paid calls: the model port is a script or a fake transport, and heavy work is a fake command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TrustService } from '../runtime/trust.ts';
import type { HarnessState, ModelTask, ModelTransport, MoneyOverview, QueueDecision, QueueList, SimulationRunRecord, SpendPolicyView, SpendRow, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { createModelPort, handlers as modelHandlers, PRESETS } from '../runtime/venture/models/index.ts';
import {
  allowCapWindow, applyTurn, capShortfall, capWindow, DEFAULT_LIMITS, newHarnessState, reserveRunCall, runCapMicros, settleDelegation,
} from '../runtime/venture/delivery/harness/loop.ts';
import type { ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { microsAsUsd, monthlyCapMicros, usdToMicros } from '../runtime/venture/models/cost.ts';
import { microsToPaise, paidCall, rupeeRateOf, rupeesBeside, setSpendPolicy } from '../runtime/venture/money/spend.ts';
import {
  approve, AT, call, code, decideBrief, installFakeClaude, owner, realOrder, runOf, startRun, turnOf, type RealOrderEnv,
} from './venture-real-order-env.ts';
import { setup as viewsSetup, type Env as ViewsEnv } from './venture-views-env.ts';
import { VentureTestStore } from './venture-test-store.ts';

const limits = (maxCostMicros: string) => ({ ...DEFAULT_LIMITS, maxCostMicros });

// ---------------------------------------------------------------------------
// 1. The run's cap, as the loop counts it
// ---------------------------------------------------------------------------

test('run cap: the call that would cross the cap is refused before it runs; a call that reaches it exactly fits', () => {
  const state = newHarnessState(['files.list'], limits('1000'), []);
  state.used.costMicros = '600';
  assert.equal(runCapMicros(state), 1000n);
  assert.equal(capShortfall(state, '400'), null, 'reaching the cap exactly fits');
  assert.equal(capShortfall(state, '401'), 1n);
  assert.doesNotThrow(() => reserveRunCall(state, '400'));
  assert.throws(() => reserveRunCall(state, '401'), (error: any) => {
    assert.equal(error.code, 'RUN_CAP_REACHED');
    assert.match(error.message, /USD 0\.0010/, 'the cap is said in the engine format');
    assert.match(error.message, /not sent/);
    return true;
  });
});

test('run cap: more room is whole windows of the run cap, enough for the waiting call; each approval adds it once', () => {
  const state = newHarnessState(['files.list'], limits('1000'), []);
  state.used.costMicros = '900';
  assert.equal(capWindow(state, '100'), null, 'nothing to allow when the call fits');
  assert.equal(capWindow(state, '300'), '1000');
  assert.equal(capWindow(state, '2500'), '3000', 'a call bigger than one window gets enough whole windows');
  const raised = allowCapWindow(state, '300', AT, 'owner');
  assert.deepEqual(raised.capWindows, [{ micros: '1000', at: AT, by: 'owner' }]);
  assert.equal(runCapMicros(raised), 2000n);
  assert.equal(state.capWindows, undefined, 'the state passed in is not changed');
  assert.equal(capShortfall(raised, '300'), null);
  assert.throws(() => allowCapWindow(raised, '300', AT, 'owner'), code('RUN_CAP_NOT_REACHED'));
});

test('run cap: after a turn the loop stops acting at the cap the owner raised, not at the old one', async () => {
  const env = { deps: { services: {} }, runRef: { kind: 'rehearsal', scenarioId: 'scenario_1', episode: 0 }, files: [], tables: [], receipts: [], now: () => AT } as unknown as ToolEnv;
  const turn = { note: 'Look around', calls: [], finished: false };
  const atCap = await applyTurn(env, newHarnessState(['files.list'], limits('1000'), []), turn, { by: 'model', callId: 'call_1', costMicros: '1000' });
  assert.deepEqual([atCap.phase, atCap.stopReason], ['write', 'The run reached its spending limit.']);
  const windowed: HarnessState = { ...newHarnessState(['files.list'], limits('1000'), []), capWindows: [{ micros: '1000', at: AT, by: 'owner' }] };
  const after = await applyTurn(env, windowed, turn, { by: 'model', callId: 'call_1', costMicros: '1000' });
  assert.deepEqual([after.phase, after.stopReason], ['act', null]);
});

test('heavy work: what it cost joins the run when it is settled; a declined brief costs nothing', () => {
  const briefing = (status: 'waiting' | 'running'): HarnessState => ({
    ...newHarnessState(['agent.delegate'], DEFAULT_LIMITS, []), phase: 'brief', used: { turns: 1, toolCalls: 1, costMicros: '200' },
    delegations: [{ toolCallId: 't1.1', status } as NonNullable<HarnessState['delegations']>[number]],
  });
  const envelope = { ok: true as const, result: {} };
  const finished = settleDelegation(briefing('running'), { status: 'finished', envelope, outcome: 'succeeded', delegateRunId: 'delegaterun_1', receiptIds: [], proofs: [], costMicros: '42100' });
  assert.equal(finished.used.costMicros, '42300');
  const declined = settleDelegation(briefing('waiting'), { status: 'declined', envelope, outcome: 'cancelled', delegateRunId: null, receiptIds: [], proofs: [] });
  assert.equal(declined.used.costMicros, '200');
});

// ---------------------------------------------------------------------------
// 2. A real order: refused before the send, then more room from Today
// ---------------------------------------------------------------------------

const queue = (env: RealOrderEnv) => call<QueueList>(env, views, 'venture.queue.list');
const decide = (env: RealOrderEnv, row: { id: string; digest: string }) => call<QueueDecision>(env, views, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
const rowsOf = async (env: RealOrderEnv, runId: string) => (await queue(env)).rows.filter(row => row.viewRef?.id === runId);
const READ = turnOf('Look at the statement', [['files.list', {}]]);

test('real order: the next call is held against the run cap before it is sent; Today asks for one more window, once', async () => {
  const env = await realOrder();
  env.models.turns = [READ, READ];
  let run = await startRun(env);
  assert.ok(run.canApprove);
  // The first turn costs 200; the next one may cost 300000, past the 250000 cap of the run.
  env.models.estimate = '300000';
  run = await approve(env, run);
  assert.equal(env.models.sent, 1);
  assert.equal(run.status, 'waiting-for-you');
  assert.equal(run.harness!.used.costMicros, '200');
  assert.equal(run.canApprove, false, 'a call that would cross the cap cannot be approved');
  assert.equal(run.awaitingYou, true, 'it still waits for the owner');

  await assert.rejects(approve(env, run), code('RUN_CAP_REACHED'));
  assert.equal(env.models.sent, 1, 'refused before it was sent');
  const sends = listRecords(env.store.read(), 'venture-journal-entry').filter(entry => entry.action === 'delivery.send');
  assert.deepEqual(sends.map(entry => entry.state), ['applied'], 'a refusal at the cap never reaches the journal as a send');

  const rows = await rowsOf(env, run.id);
  assert.equal(rows.length, 1, 'only the cap row, no send row');
  const [row] = rows;
  assert.equal(row.kind, 'quote');
  assert.equal(row.title, 'Bookkeeping agent reached its spend cap for this run');
  assert.equal(row.line, 'Allow one more window of USD 0.2500?');
  assert.deepEqual(row.change, { label: 'One more window', after: 'USD 0.2500' });
  assert.deepEqual(row.actions.map(item => [item.id, item.primary, item.secondAsk ?? false]), [['later', false, false], ['approve', true, true]]);

  assert.equal((await decide(env, row)).outcome, 'done');
  run = await runOf(env, run.id);
  assert.deepEqual(run.harness!.capWindows, [{ micros: '250000', at: AT, by: 'owner' }]);
  assert.equal(run.canApprove, true);
  assert.equal((await decide(env, row)).outcome, 'refused', 'one approval raises the cap once');
  const [send] = await rowsOf(env, run.id);
  assert.equal(send.title, 'Send the next step for Cafe Aroma Demo to your AI');

  run = await approve(env, run);
  assert.equal(env.models.sent, 2);
  assert.equal(run.harness!.used.costMicros, '400');
});

test('real order: when the waiting call needs several windows, Today asks for more spend for this run, with the figure', async () => {
  const env = await realOrder();
  env.models.turns = [READ, READ];
  const run = await startRun(env);
  // 200 spent, and the next call may cost 600000: 350200 past the 250000 cap, so two whole windows.
  env.models.estimate = '600000';
  await approve(env, run);
  const [row] = await rowsOf(env, run.id);
  assert.equal(row.title, 'Bookkeeping agent reached its spend cap for this run');
  assert.equal(row.line, 'Allow more spend for this run: USD 0.5000');
  assert.deepEqual(row.change, { label: 'More spend for this run', after: 'USD 0.5000' });
});

test('real order: a cancelled order is not live; its waiting step cannot be approved and leaves Today', async () => {
  const env = await realOrder();
  env.models.turns = [READ];
  const run = await startRun(env);
  await ventureAction(env.deps, owner, 'prepare', 'seed.cancel', tx => { tx.replace({ ...tx.find('venture-order', env.order.id)!, status: 'cancelled' }); });
  const after = await runOf(env, run.id);
  assert.deepEqual([after.canApprove, after.awaitingYou], [false, false]);
  assert.deepEqual(await rowsOf(env, run.id), [], 'no Send the next step for a cancelled order');
});

const BRIEF = 'Match every payment in the bank statement to a bill, and list the payments with no bill.';
const DELEGATE = turnOf('Hand the matching to the owner tool', [['agent.delegate', { brief: BRIEF }]]);

test('heavy work: one approval; the brief the owner approves raises the run cap by its reserve, and what it cost joins the run', async () => {
  const fake = installFakeClaude();
  try {
    const env = await realOrder({ delegate: fake.ports });
    env.models.turns = [DELEGATE, READ];
    let run = await approve(env, await startRun(env));
    assert.equal(run.status, 'brief-waiting');
    // Claude Code may spend up to USD 2.0000 of the owner's plan, far past the run's cap; the brief's own row asks once.
    const rows = await rowsOf(env, run.id);
    assert.equal(rows.length, 1);
    assert.match(rows[0].title, /wants Claude Code to work on/, 'no separate more-spend row for a brief');

    run = await decideBrief(env, run, 'approve');
    assert.equal(fake.started(), true);
    assert.deepEqual(run.harness!.capWindows!.map(window => [window.micros, window.by]), [['2000000', 'owner']], 'the approval raised the cap by the reserve');
    const settled = listRecords(env.store.read(), 'venture-spend').find(item => item.item === 'delegate:claude-code')!;
    assert.equal(settled.settledMicros, '42100', 'the fake tool reported USD 0.0421');
    assert.equal(run.harness!.used.costMicros, '42300', 'the first turn (200) and the heavy work (42100)');
    assert.equal(run.canApprove, true, 'the next turn still fits under the raised cap');
  } finally {
    fake.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3. Rehearsals: every paid call holds what the run has left
// ---------------------------------------------------------------------------

const WORDS_SCHEMA = { type: 'object', additionalProperties: false, required: ['words'], properties: { words: { type: 'string', description: 'Plain words only.' } } };
const wordsTask = (capLeftMicros?: string): ModelTask<{ words: string }> => ({
  purpose: 'blueprint', instructions: 'Write one short line in plain words.', input: { idea: 'Monthly bookkeeping for cafes' }, schemaName: 'test-words', schema: WORDS_SCHEMA,
  validate: raw => raw as { words: string }, containsClientData: false, maxOutputTokens: 1024, ...(capLeftMicros ? { capLeftMicros } : {}),
});

/** The real model port on a fake transport that answers like Anthropic, with Sonnet connected. */
async function portEnv() {
  const store = new VentureTestStore();
  const http: unknown[] = [];
  const reply = { id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'synthetic', content: [{ type: 'text', text: JSON.stringify({ words: 'Plan words' }) }], stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 812, output_tokens: 164 } };
  const transport: ModelTransport = { replay: false, async http(request) { http.push(request); return { status: 200, body: JSON.stringify(reply) }; }, async process() { throw new Error('No process here.'); } };
  const values = new Map<string, string>();
  const secrets = { get: (name: string) => values.get(name) ?? null, set: (name: string, value: string) => { values.set(name, value); }, delete: (name: string) => { values.delete(name); }, has: (name: string) => values.has(name), clear: () => values.clear() };
  const clock = () => new Date(AT);
  const port = createModelPort({ store, clock, transport, secrets, host: 'test', demo: false, claudeCodeTerms: 'accepted' } as Parameters<typeof createModelPort>[0]);
  const deps = { store, clock, models: port, services: { trust: new TrustService(store) }, secrets, host: 'test', demo: false, storage: 'experimental-file' } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes and small shops', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as any, serviceType: 'bookkeeping', status: 'interview', launchStage: 'rehearsal',
    blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  const sonnet = PRESETS.find(item => item.id === 'anthropic-sonnet-5-5')!;
  await (modelHandlers as any)['venture.models.connect'](deps, owner, { presetId: sonnet.id, consentDigest: sonnet.consentDigest, apiKey: 'sk-ant-test-not-a-real-key-0000' });
  return { store, port, http };
}

test('model port: a call that may cost more than its run has left is refused before anything is written or sent', async () => {
  const { store, port, http } = await portEnv();
  await assert.rejects(port.generate(owner, wordsTask('1')), code('RUN_CAP_REACHED'));
  assert.equal(http.length, 0, 'nothing sent');
  assert.equal(listRecords(store.read(), 'venture-model-call').length, 0, 'no call recorded');
  assert.equal(listRecords(store.read(), 'venture-spend').length, 0, 'nothing held');
  const outcome = await port.generate(owner, wordsTask('1000000'));
  assert.equal(outcome.value.words, 'Plan words');
  assert.equal(http.length, 1);
});

const ASK = turnOf('Check which account this is', [['handoff.owner', { question: 'Is this the cafe current account?' }]]);
const DONE = turnOf('Ready to write the report', [], true);
const rehearse = (env: RealOrderEnv) => call<SimulationRunRecord>(env, delivery, 'venture.simulation.run', { scenarioIds: ['bookkeeping-clean'], episodes: 1 });

test('rehearsal: the turns, the practice client, the reply and the judge each hold what the run has left, and each counts', async () => {
  const env = await realOrder();
  env.models.turns = [ASK, DONE];
  const run = await rehearse(env);
  // The practice client's opening request comes before the agent's run starts, so it is not the run's spend.
  assert.deepEqual(env.models.generated.map(task => [task.purpose, task.capLeftMicros]), [
    ['client-sim', undefined], ['agent-turn', '250000'], ['client-sim', '249800'], ['agent-turn', '249600'], ['delivery', '249400'],
    // The rules judge every practice client asks (Ink v2 wave 2, Q1), then the practice judge.
    ['judge', '249200'], ['judge', '249000'],
  ]);
  assert.equal(run.episodes[0].harness!.used.costMicros, '1200', 'six calls at 200 each, the practice client and both judges included');
});

test('rehearsal: a turn that would cross the cap is not sent; the reply is written if it fits, else the episode fails and says why', async () => {
  const env = await realOrder();
  env.models.turns = [DONE];
  env.models.estimate = '300000';
  const run = await rehearse(env);
  assert.deepEqual(env.models.generated.map(task => [task.purpose, task.capLeftMicros]), [['client-sim', undefined], ['agent-turn', '250000'], ['delivery', '250000']]);
  assert.equal(run.episodes[0].passed, false);
  assert.match(run.episodes[0].firstFailure ?? '', /refused: Past what the run has left/);
});

// ---------------------------------------------------------------------------
// 4. Spend settings in US dollars (M1), through one parser
// ---------------------------------------------------------------------------

const get = (env: ViewsEnv) => money['venture.spend.policy.get']!(env.deps, owner, {}) as Promise<SpendPolicyView>;
const set = (env: ViewsEnv, payload: unknown) => money['venture.spend.policy.set']!(env.deps, owner, payload) as Promise<SpendPolicyView>;

test('dollars: one parser for every figure typed in US dollars, with its decimals and range; and back again', () => {
  const limit = { field: 'The monthly limit', decimals: 2 } as const;
  assert.equal(usdToMicros('20', limit), '20000000');
  assert.equal(usdToMicros('12.50', limit), '12500000');
  assert.equal(usdToMicros(' 0.5 ', limit), '500000');
  assert.equal(usdToMicros('0', limit), '0');
  assert.equal(usdToMicros('0.000075', { field: 'A rate', decimals: 6 }), '75');
  for (const bad of ['5.001', '-1', '1e3', '5,00', '', ' ', 'five', '.5', '12345678', 12, null]) {
    assert.throws(() => usdToMicros(bad, limit), code('INVALID_AMOUNT'), String(bad));
  }
  assert.throws(() => usdToMicros('0.0000001', { field: 'A rate', decimals: 6 }), (error: any) => error.code === 'INVALID_AMOUNT' && /six decimals/.test(error.message));
  assert.deepEqual(['20000000', '2500000', '12345678', '75', '0'].map(microsAsUsd), ['20.00', '2.50', '12.345678', '0.000075', '0.00']);
  // The AI connection's own monthly limit goes through the same parser, with its range of 0.01 to 1000 dollars.
  const RANGE = 'Monthly limit must be an amount from 0.01 to 1000 US dollars, like 5 or 12.50.';
  assert.equal(monthlyCapMicros('12.50'), '12500000');
  for (const bad of ['0', '1000.01', '0.001', 'five']) assert.throws(() => monthlyCapMicros(bad), (error: any) => error.code === 'INVALID_AMOUNT' && error.message === RANGE, bad);
  assert.throws(() => usdToMicros('1000.01', { field: 'Monthly limit', decimals: 2, min: '10000', max: '1000000000' }), (error: any) => error.message === RANGE);
});

test('spend settings: the monthly limit and the ask-first figure are set in US dollars; the view gives them back the same way', async () => {
  const env = await viewsSetup();
  const empty = await get(env);
  assert.deepEqual([empty.capUsd, empty.askFirstUsd], [null, null]);
  const view = await set(env, { capUsd: '20', askFirstUsd: '2.50' });
  assert.deepEqual(
    [view.capMicros, view.askFirstMicros, view.capUsd, view.askFirstUsd, view.cap, view.askFirst],
    ['20000000', '2500000', '20.00', '2.50', 'USD 20.0000 a month', 'Asks you first above USD 2.5000'],
  );
  const cleared = await set(env, { askFirstUsd: null });
  assert.deepEqual([cleared.capUsd, cleared.askFirstUsd, cleared.askFirst], ['20.00', null, 'Never asks first']);
  await assert.rejects(set(env, { capUsd: '5000000.123' }), (error: any) => error.code === 'INVALID_AMOUNT' && error.message === 'The monthly limit must be an amount in US dollars with at most two decimals, like 20 or 12.50.');
  await assert.rejects(set(env, { capUsd: '5', cap: '5000000' }), code('INVALID_VENTURE_REQUEST'));
  assert.equal((await get(env)).capUsd, '20.00', 'nothing refused was written');
});

test('spend settings: rate card prices are typed in US dollars and given back the same way', async () => {
  const env = await viewsSetup();
  const view = await set(env, { rates: [
    { item: 'model:openai-gpt-6-luna', unit: 'per-million-tokens', inputUsdPerMillion: '1.25', outputUsdPerMillion: '10', source: 'my invoice', checkedOn: '2026-10-01' },
    { item: 'connector:fal', unit: 'per-call', usdPerCall: '0.000075', source: 'fal pricing page', checkedOn: '2026-10-15' },
  ] });
  assert.deepEqual(view.rates.map(rate => [rate.inputMicrosPerMillion, rate.outputMicrosPerMillion, rate.microsPerCall, rate.inputUsdPerMillion, rate.outputUsdPerMillion, rate.usdPerCall]), [
    ['1250000', '10000000', null, '1.25', '10.00', null],
    [null, null, '75', null, null, '0.000075'],
  ]);
  assert.equal(view.rates[0].price, 'USD 1.2500 in and USD 10.0000 out, per million tokens');
  await assert.rejects(set(env, { rates: [{ item: 'connector:fal', unit: 'per-call', usdPerCall: '0.25', microsPerCall: '250000', source: 'x', checkedOn: '2026-10-15' }] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set(env, { rates: [{ item: 'connector:fal', unit: 'per-call', usdPerCall: '0.0000001', source: 'x', checkedOn: '2026-10-15' }] }), code('INVALID_AMOUNT'));
});

// ---------------------------------------------------------------------------
// 5. Rupees beside dollars, at the owner's own rate
// ---------------------------------------------------------------------------

const RUPEES = { rate: { perUsd: '835000', setOn: '2026-10-23' }, dateOrder: 'day-month-year' } as const;
const LABEL = 'at ₹83.50 per $1 (your rate, set 23 Oct 2026)';

test('rupees: micro-dollars become paise in BigInt at the owner\'s rate, to the nearest paisa with a half paisa rounded up', () => {
  assert.deepEqual(['83.50', '83.5', '83.5012', '0.0001', '9999.9999'].map(rupeeRateOf), ['835000', '835000', '835012', '1', '99999999']);
  for (const bad of ['0', '83.50001', '-1', '83,50', 'x', '', '10000', 83.5, null]) assert.throws(() => rupeeRateOf(bad), code('INVALID_AMOUNT'), String(bad));
  assert.equal(microsToPaise('1000000', '835000'), 8350n, 'one dollar is ₹83.50');
  assert.equal(microsToPaise('250000', '835000'), 2088n, '₹20.875 rounds up to ₹20.88');
  assert.equal(microsToPaise('100', '500000'), 1n, 'exactly half a paisa rounds up');
  assert.equal(microsToPaise('99', '500000'), 0n, 'under half a paisa rounds down');
  assert.equal(rupeesBeside('250000', RUPEES), `₹20.88 ${LABEL}`);
  assert.equal(rupeesBeside('20000000000', { ...RUPEES, rate: { perUsd: '12345012', setOn: '2026-10-23' } }), '₹2,46,90,024.00 at ₹1,234.5012 per $1 (your rate, set 23 Oct 2026)', 'Indian grouping; the rate keeps its four places');
  assert.equal(rupeesBeside('250000', null), null, 'no rate: dollars only');
});

test('rupees: spend settings take rupees per US dollar with the day it was set; the limits show rupees beside dollars', async () => {
  const env = await viewsSetup();
  const plain = await set(env, { capUsd: '20', askFirstUsd: '2.50' });
  assert.deepEqual([plain.inrPerUsd, plain.rupeeRate, plain.capRupees, plain.askFirstRupees], [null, null, undefined, undefined], 'no rate: dollars only');
  const view = await set(env, { inrPerUsd: '83.5' });
  const label = 'at ₹83.50 per $1 (your rate, set 15 Oct 2026)';
  assert.deepEqual(
    [view.inrPerUsd, view.rupeeRate, view.cap, view.capRupees, view.askFirstRupees],
    ['83.50', '₹83.50 per $1 (your rate, set 15 Oct 2026)', 'USD 20.0000 a month', `₹1,670.00 ${label}`, `₹208.75 ${label}`],
  );
  env.advance(2 * 86_400_000);
  assert.equal((await set(env, { inrPerUsd: '83.50', capUsd: '25' })).rupeeRate, '₹83.50 per $1 (your rate, set 15 Oct 2026)', 'the same rate keeps its day');
  assert.equal((await set(env, { inrPerUsd: '84' })).rupeeRate, '₹84.00 per $1 (your rate, set 17 Oct 2026)', 'a new rate is dated today');
  await assert.rejects(set(env, { inrPerUsd: '84.12345' }), code('INVALID_AMOUNT'));
  const cleared = await set(env, { inrPerUsd: null });
  assert.deepEqual([cleared.inrPerUsd, cleared.rupeeRate, cleared.capRupees], [null, null, undefined]);
});

test('rupees: spend rows, the month total and the AI spend line show rupees beside dollars at the owner\'s rate', async () => {
  const env = await viewsSetup();
  const list = { item: 'connector:fal', unit: 'per-call' as const, inputMicrosPerMillion: null, outputMicrosPerMillion: null, microsPerCall: '1000000', source: 'test', checkedOn: '2026-10-15', confirmed: true, by: 'list' as const };
  await paidCall(env.deps, owner, { key: 'render-1', item: 'connector:fal', label: 'Render', payer: 'connector:fal', draftDigest: 'c'.repeat(64), list }, async () => ({ value: 'done', billedMicros: '250000' }));
  const before = await money['venture.spend.list']!(env.deps, owner, {}) as { rows: SpendRow[]; total: string; totalRupees?: string };
  assert.equal(before.rows[0].reservedRupees, undefined, 'no rate: dollars only');
  assert.equal(before.totalRupees, undefined);
  await set(env, { inrPerUsd: '83.50' });
  const label = 'at ₹83.50 per $1 (your rate, set 15 Oct 2026)';
  const after = await money['venture.spend.list']!(env.deps, owner, {}) as { rows: SpendRow[]; total: string; totalRupees?: string };
  assert.deepEqual([after.rows[0].reserved, after.rows[0].reservedRupees, after.rows[0].settled, after.rows[0].settledRupees], ['USD 1.0000', `₹83.50 ${label}`, 'USD 0.2500', `₹20.88 ${label}`]);
  assert.deepEqual([after.total, after.totalRupees], ['USD 0.2500 this month', `₹20.88 ${label}`]);
  const overview = await money['venture.money.overview']!(env.deps, owner, {}) as MoneyOverview;
  assert.equal(overview.lines.find(line => line.id === 'spent')!.rupees, `₹20.88 ${label}`);
});

test('rupees: the run cap row on Today shows the room in rupees too, at the owner\'s rate', async () => {
  const env = await realOrder();
  env.models.turns = [READ, READ];
  await setSpendPolicy(env.deps, owner, { inrPerUsd: '83.50' });
  const run = await startRun(env);
  env.models.estimate = '300000';
  await approve(env, run);
  const [row] = await rowsOf(env, run.id);
  assert.equal(row.line, 'Allow one more window of USD 0.2500, ₹20.88 at ₹83.50 per $1 (your rate, set 16 Oct 2026)?');
  assert.deepEqual(row.change, { label: 'One more window', after: 'USD 0.2500 · ₹20.88' });
});
