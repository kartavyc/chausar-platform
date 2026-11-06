import test from 'node:test';
import assert from 'node:assert/strict';
import { recordScenario } from '../helpers/recording-scenario.ts';

test('Today exact price approval and rejected proposal match the real engine recording', async t => {
  await recordScenario(t, 'today', async ({ rpc }) => {
    await rpc.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', unitPrice: '2999' }] } });
    const before = await rpc.request('venture.queue.list', { scope: 'current' });
    const price = before.rows.find((row: { kind: string }) => row.kind === 'price');
    assert.ok(price);
    const approved = await rpc.request('venture.queue.decide', { id: price.id, digest: price.digest, action: 'approve' });
    assert.equal(approved.outcome, 'done');
    const team = await rpc.request('venture.team.list', {});
    const agent = team.agents.find((row: { kind: string }) => row.kind === 'agent');
    assert.ok(agent);
    await rpc.request('venture.agents.thread.send', { agent: agent.id, text: 'Send the report to the client today.' });
    const next = await rpc.request('venture.queue.list', { scope: 'current' });
    const proposal = next.rows.find((row: { kind: string }) => row.kind === 'proposal');
    assert.ok(proposal);
    const denied = await rpc.request('venture.queue.decide', { id: proposal.id, digest: proposal.digest, action: 'deny' });
    assert.equal(denied.outcome, 'done');
    const after = await rpc.request('venture.queue.list', { scope: 'current' });
    assert.ok(!after.rows.some((row: { id: string }) => row.id === proposal.id));
  });
});
