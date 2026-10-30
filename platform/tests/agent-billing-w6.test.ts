import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startAgentBilling } from '../runtime/venture/agent-runtime/billing.ts';
import { priceAgentUsage } from '../runtime/venture/agent-runtime/cost-proof.ts';
import { setup, seedBlueprint, seedOrder, seedRun, owner } from './venture-views-env.ts';
import { ventureAction, listRecords } from '../runtime/venture/records.ts';
import { presetSpec, endpointFor } from '../runtime/venture/models/presets.ts';
import { setSpendPolicy } from '../runtime/venture/money/spend.ts';
import type { AgentRoute } from '../runtime/venture/agent-runtime/driver-types.ts';
import type { AgentUsage } from '../runtime/venture/agent-runtime/driver-types.ts';
import type { SpendRate } from '../runtime/venture/contracts.ts';
const rate: SpendRate = { item: 'model:openai-gpt-6-luna', model: 'gpt-6-luna', unit: 'per-million-tokens', inputMicrosPerMillion: '1000000', outputMicrosPerMillion: '2000000', microsPerCall: null, cacheReadMicrosPerMillion: '100000', cacheWriteMicrosPerMillion: '1250000', source: 'Synthetic owner rate', checkedOn: '2026-10-15', confirmed: true, by: 'owner' };
const usage = (inputTokens = 1000, outputTokens = 2000): AgentUsage => ({ inputTokens, outputTokens, model: 'gpt-6-luna', source: 'provider-reported' });
async function fixture() {
  const env = await setup(); const { order } = await seedOrder(env, await seedBlueprint(env)); const run = await seedRun(env, order, {});
  const spec = presetSpec('openai-gpt-6-luna');
  const connection = await ventureAction(env.deps, owner, 'admin', 'test.connection', tx => tx.put({ ...tx.base('venture-model-connection'), presetId: spec.id, routeKind: spec.kind, model: spec.model, endpoint: endpointFor(spec), tiers: ['main'], consentDigest: spec.consentDigest, consentedAt: tx.now, monthlyCapMicros: '1000000', status: 'connected' }));
  await setSpendPolicy(env.deps, owner, { capMicros: '1000000', askAboveMicros: null, rates: [rate] });
  const route: AgentRoute = { driver: { async open() { throw Error('not used'); } }, settings: { model: 'gpt-6-luna', effort: 'high', autoReview: true, shell: false, network: false, webSearch: false }, credentials: { apiKey: 'synthetic-value' }, billing: { connectionId: connection.id, presetId: spec.id, model: 'gpt-6-luna' } };
  return { ...env, run, route };
}
test('key jobs reserve the existing remaining cap once and settle provider usage with a code receipt', async () => {
  const env = await fixture();
  const billing = await startAgentBilling(env.deps, owner, { runId: env.run.id, jobId: 'job-a', agentId: 'delivery', route: env.route });
  assert.equal(listRecords(env.store.read(), 'venture-spend').at(-1)!.reservedMicros, '1000000');
  await assert.rejects(startAgentBilling(env.deps, owner, { runId: env.run.id, jobId: 'job-b', agentId: 'delivery', route: env.route }), { code: 'BUDGET_REACHED' });
  await billing.dispatched(); await billing.usage(usage()); await billing.finish({ status: 'completed', text: '', usage: usage() });
  const spend = listRecords(env.store.read(), 'venture-spend').find(row => row.key.includes('job-a'))!;
  assert.equal(spend.settledMicros, '5000'); assert.equal(spend.settledBy, 'usage');
  const receipts = listRecords(env.store.read(), 'venture-sum-receipt').filter(row => row.subject.type === 'agent-cost');
  assert.equal(receipts.at(-1)!.totalMinor, '5000'); assert.equal(receipts.at(-1)!.unit, 'micros');
});
test('plan jobs never reserve and interrupted key usage stays held rather than counted as zero', async () => {
  const env = await fixture(), plan = { ...env.route, credentials: undefined, billing: undefined };
  const free = await startAgentBilling(env.deps, owner, { runId: env.run.id, jobId: 'plan', agentId: 'delivery', route: plan }); await free.dispatched(); await free.finish({ status: 'completed', text: '' });
  assert.equal(listRecords(env.store.read(), 'venture-spend').length, 0);
  const billed = await startAgentBilling(env.deps, owner, { runId: env.run.id, jobId: 'unknown', agentId: 'delivery', route: env.route }); await billed.dispatched(); await billed.finish();
  const spend = listRecords(env.store.read(), 'venture-spend').at(-1)!; assert.equal(spend.phase, 'unknown'); assert.equal(spend.settledMicros, null);
});
test('actual model mismatch or missing cache prices never borrows another model price', async () => {
  const env = await fixture(), route = { ...env.route, settings: { ...env.route.settings, model: 'different-model' }, billing: { ...env.route.billing!, model: 'different-model' } };
  await assert.rejects(startAgentBilling(env.deps, owner, { runId: env.run.id, jobId: 'changed', agentId: 'delivery', route }), { code: 'SPEND_UNPRICED' });
  assert.equal(priceAgentUsage(rate, { ...usage(1000, 1000), cachedInputTokens: 500 }, 'codex', 'gpt-6-luna'), '2550');
  assert.equal(priceAgentUsage(rate, { ...usage(1000, 1000), cachedInputTokens: 500 }, 'claude', 'gpt-6-luna'), '3050');
  assert.throws(() => priceAgentUsage({ ...rate, cacheReadMicrosPerMillion: undefined }, { ...usage(), cachedInputTokens: 5 }, 'codex', 'gpt-6-luna'), { code: 'SPEND_UNPRICED' });
});

test('a lowered owner cap stops at reported usage while retaining its code proof', async () => {
  const env = await fixture();
  const billing = await startAgentBilling(env.deps, owner, { runId: env.run.id, jobId: 'lowered', agentId: 'delivery', route: env.route });
  await billing.dispatched();
  await setSpendPolicy(env.deps, owner, { capMicros: '4000' });
  await assert.rejects(billing.usage(usage()), { code: 'BUDGET_REACHED' });
  assert.equal(listRecords(env.store.read(), 'venture-sum-receipt').at(-1)!.totalMinor, '5000');
  await billing.finish();
  assert.equal(listRecords(env.store.read(), 'venture-spend').at(-1)!.phase, 'unknown');
});

test('a job which never dispatched releases its reservation; partial usage without final usage stays held', async () => {
  const env = await fixture();
  const first = await startAgentBilling(env.deps, owner, { runId: env.run.id, jobId: 'unsent', agentId: 'delivery', route: env.route });
  await first.finish();
  assert.equal(listRecords(env.store.read(), 'venture-spend').at(-1)!.phase, 'released');
  const second = await startAgentBilling(env.deps, owner, { runId: env.run.id, jobId: 'partial', agentId: 'delivery', route: env.route });
  await second.dispatched(); await second.usage(usage()); await second.finish({ status: 'completed', text: '' });
  assert.equal(listRecords(env.store.read(), 'venture-spend').at(-1)!.phase, 'unknown');
});

test('cache counters and priced cost cannot move backwards and reopen an allowance', async () => {
  for (const next of [{ ...usage(2000, 1000), cachedInputTokens: 400 }, { ...usage(2000, 1000), cachedInputTokens: 1800 }]) {
    const env = await fixture();
    const billing = await startAgentBilling(env.deps, owner, { runId: env.run.id, jobId: 'cache', agentId: 'delivery', route: env.route });
    await billing.dispatched(); await billing.usage({ ...usage(2000, 1000), cachedInputTokens: 500 });
    await assert.rejects(billing.usage(next), { code: 'MODEL_FAILED' });
    await billing.finish({ status: 'completed', text: '', usage: next });
    assert.equal(listRecords(env.store.read(), 'venture-spend').at(-1)!.phase, 'unknown');
  }
});

test('disconnect during tool startup refuses dispatch and releases the unused allowance', async () => {
  const env = await fixture();
  const billing = await startAgentBilling(env.deps, owner, { runId: env.run.id, jobId: 'closed', agentId: 'delivery', route: env.route });
  await ventureAction(env.deps, owner, 'admin', 'test.disconnect', tx => {
    const row = tx.find('venture-model-connection', env.route.billing!.connectionId)!; tx.replace({ ...row, status: 'disconnected' });
  });
  await assert.rejects(billing.dispatched(), { code: 'MODEL_KEY_MISSING' }); await billing.finish();
  assert.equal(listRecords(env.store.read(), 'venture-spend').at(-1)!.phase, 'released');
});
