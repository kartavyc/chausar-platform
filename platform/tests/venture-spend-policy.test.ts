// venture.spend.policy.get and venture.spend.policy.set: the owner's monthly limit, ask-first figure and rate card, set
// inside the app only, every figure formatted by the engine; and the spend rows naming the team agent they worked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SpendPolicyView, SpendRate, SpendRow } from '../runtime/venture/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, VENTURE_METHODS } from '../runtime/venture/contract-values.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { paidCall } from '../runtime/venture/money/spend.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';

const get = (env: Env) => money['venture.spend.policy.get']!(env.deps, owner, {}) as Promise<SpendPolicyView>;
const set = (env: Env, payload: unknown, ctx = owner) => money['venture.spend.policy.set']!(env.deps, ctx, payload) as Promise<SpendPolicyView>;
const FAL_LINE = { item: 'connector:fal', unit: 'per-call', microsPerCall: '150000', source: 'fal pricing page', checkedOn: '2026-10-15' };
const run = async () => ({ value: 'done', billedMicros: null });
/** The settings this file covers, without the Ink v2 wave 4 (4F2) meters and limits, which venture-spend-meter.test.ts covers,
 *  nor which currency leads (4Z3), which venture-spend-lead.test.ts covers. */
const base = (view: SpendPolicyView) => {
  const { reference, dailyCapMicros, dailyCapUsd, dailyCap, dailyCapRupees, alertPermille, alert, meter, limitReached, keyLimits, agentCaps, writeCaps, card, currencyLead, leads, capLead, askFirstLead, meters, ...rest } = view;
  return rest;
};
const call = (key: string, item: string, list: SpendRate | null = null) => ({ key, item, label: `Call ${key}`, payer: 'connector:fal', draftDigest: 'c'.repeat(64), list });

test('spend policy methods: listed, owned by money, and set is an owner action inside the app', () => {
  for (const method of ['venture.spend.policy.get', 'venture.spend.policy.set'] as const) {
    assert.ok(VENTURE_METHODS.includes(method), method);
    assert.equal(METHOD_OWNERS[method], 'money');
  }
  assert.ok(APP_ONLY_METHODS.includes('venture.spend.policy.set'));
  assert.ok(!APP_ONLY_METHODS.includes('venture.spend.policy.get'));
});

test('spend policy: nothing set reads as no limit and no ask-first; set keeps what it leaves out and marks rates confirmed', async () => {
  const env = await setup();
  assert.deepEqual(base(await get(env)), {
    capMicros: null, askFirstMicros: null, capUsd: null, askFirstUsd: null, cap: 'No monthly limit', askFirst: 'Never asks first', rates: [], setAt: null, inrPerUsd: null, rupeeRate: null,
  });

  const view = await set(env, { cap: '5000000', askFirst: '1000000', rates: [FAL_LINE] });
  assert.deepEqual({ ...base(view), rates: undefined }, {
    capMicros: '5000000', askFirstMicros: '1000000', capUsd: '5.00', askFirstUsd: '1.00', cap: '$5.00 a month', askFirst: 'Asks you first above $1.00', rates: undefined, setAt: env.now(),
    inrPerUsd: null, rupeeRate: null,
  });
  assert.deepEqual(view.rates, [{
    item: 'connector:fal', unit: 'per-call', inputMicrosPerMillion: null, outputMicrosPerMillion: null, microsPerCall: '150000',
    source: 'fal pricing page', checkedOn: '2026-10-15', confirmed: true, by: 'owner', price: '$0.15 per call',
    inputUsdPerMillion: null, outputUsdPerMillion: null, usdPerCall: '0.15',
  }]);
  assert.deepEqual(await get(env), view);

  const cleared = await set(env, { askFirst: null });
  assert.deepEqual([cleared.cap, cleared.askFirst, cleared.rates.length], ['$5.00 a month', 'Never asks first', 1]);

  const tokens = await set(env, { rates: [{ item: 'model:openai-gpt-6-luna', unit: 'per-million-tokens', inputMicrosPerMillion: '1250000', outputMicrosPerMillion: '10000000', source: 'my invoice', checkedOn: '2026-10-01' }] });
  assert.equal(tokens.rates[0].price, '$1.25 in and $10.00 out, per million tokens');
});

test('spend policy: set is refused outside the app, for a rate marked unconfirmed, and for odd figures', async () => {
  const env = await setup();
  await assert.rejects(set(env, { cap: '5000000' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(set(env, { rates: [{ ...FAL_LINE, confirmed: false }] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(set(env, { cap: '5.00' }), code('INVALID_AMOUNT'));
  await assert.rejects(set(env, { capMicros: '5000000' }), code('INVALID_VENTURE_REQUEST'));
  assert.equal((await get(env)).setAt, null, 'nothing was written');
});

test('spend policy: a rate the owner sets prices a call that had no price, and the cap holds', async () => {
  const env = await setup();
  await assert.rejects(paidCall(env.deps, owner, call('render-1', 'connector:fal'), run), code('SPEND_UNPRICED'));
  await set(env, { rates: [FAL_LINE], cap: '200000' });
  assert.equal(await paidCall(env.deps, owner, call('render-2', 'connector:fal'), run), 'done');
  // 150000 held this month; another 150000 would make 300000, past the 200000 limit.
  await assert.rejects(paidCall(env.deps, owner, call('render-3', 'connector:fal'), run), code('SPEND_CAP'));
});

test('spend rows: heavy work and the delivery agent\'s model calls name the team agent; other calls name none', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'prepare', 'seed.calls', tx => {
    tx.state.conversations.push({ id: 'call_1', kind: 'venture-model-call', ventureId: tx.venture!.id, purpose: 'agent-turn' });
    tx.state.conversations.push({ id: 'call_2', kind: 'venture-model-call', ventureId: tx.venture!.id, purpose: 'blueprint' });
  });
  const rate = (item: string): SpendRate => ({ item, unit: 'per-call', inputMicrosPerMillion: null, outputMicrosPerMillion: null, microsPerCall: '1000', source: 'test', checkedOn: '2026-10-15', confirmed: true, by: 'list' });
  await paidCall(env.deps, owner, call('delegate:run_1:t1.1:d', 'delegate:claude-code', rate('delegate:claude-code')), run);
  await paidCall(env.deps, owner, call('model:call_1', 'model:anthropic-sonnet-5-5', rate('model:anthropic-sonnet-5-5')), run);
  await paidCall(env.deps, owner, call('model:call_2', 'model:anthropic-sonnet-5-5', rate('model:anthropic-sonnet-5-5')), run);
  const { rows } = await money['venture.spend.list']!(env.deps, owner, {}) as { rows: SpendRow[] };
  const agentOf = new Map(rows.map(row => [row.label, row.agent ?? null]));
  assert.equal(agentOf.get('Call delegate:run_1:t1.1:d'), 'delivery');
  assert.equal(agentOf.get('Call model:call_1'), 'delivery');
  assert.equal(agentOf.get('Call model:call_2'), null);
});

// C5 task 15: Use the reference rate. The owner's choice, once: it stores the exact figure, its date and its source, and
// the view offers it with those words. Margins then count, and their basis names the date.
test('spend policy: using the reference rate stores its figure, day and source; a typed rate replaces it', async () => {
  const env = await setup();
  const { REFERENCE_RATE } = await import('../runtime/venture/money/reference-rate.ts');
  const before = await get(env);
  assert.equal(before.reference?.line, 'Use the reference rate of 5 Nov 2026: ₹94.3996 per US dollar');
  const view = await set(env, { useReference: true });
  assert.equal(view.inrPerUsd, REFERENCE_RATE.perUsd);
  assert.equal(view.rupeeRate, '₹94.3996 per $1 (FBIL reference rate of 5 Nov 2026)');
  const { listRecords } = await import('../runtime/venture/records.ts');
  assert.deepEqual(listRecords(env.store.read(), 'venture-spend-policy').at(-1)!.rupeeRate, { perUsd: '943996', setOn: '2026-11-05', source: 'FBIL reference rate' });
  await assert.rejects(set(env, { useReference: true, inrPerUsd: '90' }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
  await assert.rejects(set(env, { useReference: false }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
  const typed = await set(env, { inrPerUsd: '90.00' });
  assert.match(typed.rupeeRate!, /your rate, set/);
});
