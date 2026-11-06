import test from 'node:test';
import assert from 'node:assert/strict';
import { recordScenario } from '../helpers/recording-scenario.ts';

test('Work order and template run match the real engine recording', async t => {
  await recordScenario(t, 'work', async ({ rpc }) => {
    const client = await rpc.request('venture.client.add', { name: 'Sample Cafe', countryCode: 'IN' });
    const permission = await rpc.request('venture.client.aiConsent.get', { clientId: client.id });
    await rpc.request('venture.client.aiConsent.agree', { clientId: client.id, disclosureDigest: permission.disclosureDigest });
    const order = await rpc.request('venture.order.create', { clientId: client.id, offerId: 'offer_1', request: 'Prepare the monthly books for review.' });
    const run = await rpc.request('venture.delivery.run', { orderId: order.id, useTemplate: true });
    assert.ok(run.id);
    const runs = await rpc.request('venture.runs.list', { state: 'all' });
    assert.ok(runs.runs.some((row: { id: string; runId?: string }) => (row.runId ?? row.id) === run.id));
    const detail = await rpc.request('venture.runs.get', { runId: run.id });
    assert.equal(detail.runId, run.id);
    assert.ok(detail.steps.length > 0);
  });
});
