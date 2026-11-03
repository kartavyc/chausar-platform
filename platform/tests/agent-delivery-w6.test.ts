import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { deliveryRunHandler, deliveryListHandler, deliveryReviewHandler } from '../runtime/venture/delivery/runs.ts';
import { waitForAgentWork } from '../runtime/venture/agent-runtime/runner.ts';
import { getClientAiConsent, agreeClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { setup, seedBlueprint, seedOrder, owner } from './venture-views-env.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import type { AgentDriver } from '../runtime/venture/agent-runtime/driver-types.ts';
import { MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';
import { kitBusiness, installKitFixture, deliver, draft } from './fixtures/venture/kit-business.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { startRevision } from '../runtime/venture/delivery/revise.ts';

async function fixture() {
  const env = await setup(); const { client, order } = await seedOrder(env, await seedBlueprint(env));
  env.models.connected = true;
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  env.models.preview = async () => { throw new Error('The retired per-turn preview path was called'); };
  await ventureAction(env.deps, owner, 'admin', 'test.live', tx => tx.touch({ launchStage: 'approve-each' }));
  return { ...env, client, order };
}
const settings = { model: 'test-model', effort: 'high' as const, autoReview: true, network: false, webSearch: false, shell: false };

for (const terminal of ['failed', 'interrupted'] as const) test(`a proposed draft settles when the native driver returns ${terminal}`, async t => {
  t.after(installKitFixture());
  const env = await kitBusiness();
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id,
    request: 'A plain voice sheet.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  const route = env.deps.agentRoute!;
  env.deps.agentRoute = async (ctx, agentId) => {
    const selected = await route(ctx, agentId);
    return { ...selected, driver: { async open(input) {
      const session = await selected.driver.open(input);
      return { ...session, async run(message) { await session.run(message); return { status: terminal, text: 'Synthetic interrupted completion.' }; } };
    } } };
  };
  const run = await deliver(env, order.id, draft('Voice sheet', { 'Voice sheet': ['A warm, plain voice for Sunrise Bakery.'] }));
  assert.ok(run.agentJob?.proposal, 'the agent proposed a draft before its terminal failure');
  assert.equal(run.status, terminal === 'interrupted' ? 'stopped' : 'failed');
  assert.notEqual(run.agentJob?.reviewReady, true);
  assert.equal(run.canAccept, false);
  await assert.rejects(deliveryReviewHandler(env.deps, owner, { runId: run.id, verdict: 'accepted' }), { code: 'DELIVERY_NOT_READY' });
  assert.equal(env.store.read().actions.length, 0);
});
test('a playbook uses the assigned writer settings instead of an unrelated delivery agent', async t => {
  t.after(installKitFixture());
  const env = await kitBusiness();
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id,
    request: 'A plain voice sheet.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  const consent = await getClientAiConsent(env.deps, owner, { clientId: env.client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: env.client.id, disclosureDigest: consent.disclosureDigest });
  let selected = '';
  env.deps.agentRoute = async (_ctx, agentId) => { selected = agentId; throw new Error('route captured'); };
  await assert.rejects(deliveryRunHandler(env.deps, owner, { orderId: order.id }), /route captured/);
  const definition = flagshipDelivery('kit-fixture')!;
  assert.equal(selected, definition.roleOf[definition.draftStep(env.offers[0].playbookOffer)]);
});
test('real delivery entry point refuses client AI work before consent without calling a model preview', async () => {
  const env = await fixture();
  await assert.rejects(deliveryRunHandler(env.deps, owner, { orderId: env.order.id }), { code: 'CLIENT_AI_CONSENT_REQUIRED' });
});
test('real delivery entry point lets the tool complete a scoped job without per-turn approvals, then waits at the draft', async () => {
  const env = await fixture(); let prompts = 0;
  const view = await getClientAiConsent(env.deps, owner, { clientId: env.client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: env.client.id, disclosureDigest: view.disclosureDigest });
  const driver: AgentDriver = { async open(input) {
    const socket = connect(input.mcp.env.CHAUSAR_AGENT_MCP_SOCKET);
    const lines = createInterface({ input: socket }); const replies = lines[Symbol.asyncIterator](); let id = 0;
    const send = async (body: unknown) => { socket.write(JSON.stringify(body) + '\n'); return JSON.parse((await replies.next()).value!); };
    await send({ token: input.mcp.env.CHAUSAR_AGENT_MCP_TOKEN });
    await send({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test-agent', version: '1' } } });
    socket.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const call = async (name: string, args: unknown = {}) => {
      const result = await send({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
      assert.equal(result.error, undefined, JSON.stringify(result.error)); return result.result.structuredContent.data;
    };
    return { async run() {
      prompts++; const business = await call('read_business'); const client = await call('read_client'); await call('read_order');
      if (prompts === 2) assert.equal(business.revision.words, 'Use a shorter closing.');
      const price = await call('calculate', { operation: 'order_price', arguments: {} });
      const ref = price.refs.figures.find((entry: any) => entry.figureKey === 'total').ref;
      const saved = await call('draft_document', { draft: { title: 'Draft for review', sections: business.sections.map((heading: string, index: number) => ({ heading,
        parts: [{ kind: 'text', text: 'Please review this draft before sharing it.', ref: '' }, ...(index ? [] : [{ kind: 'figure', text: '', ref }])] })), questionsForClient: [] } });
      await call('propose_action', { kind: 'send-handoff', draftId: saved.draftId, draftDigest: saved.digest, to: client.email, subject: 'Draft for review' });
      await assert.rejects(deliveryReviewHandler(env.deps, owner, { runId: saved.draftId, verdict: 'accepted' }), { code: 'DELIVERY_NOT_READY' });
      return { status: 'completed', text: 'The draft is ready for your review.' };
    }, async interrupt() {}, async close() { lines.close(); socket.destroy(); } };
  } };
  env.deps.agentRoute = async () => ({ driver, settings });
  const started = await deliveryRunHandler(env.deps, owner, { orderId: env.order.id });
  await waitForAgentWork(env.store, started.id);
  const run = (await deliveryListHandler(env.deps, owner, {})).find(run => run.id === started.id)!;
  assert.equal(prompts, 1); assert.equal(run.preview, null); assert.equal(run.harness, undefined);
  assert.equal(run.status, 'ready-for-review'); assert.equal(run.verdict, null);
  assert.ok(run.agentJob?.proposal); assert.equal(env.store.read().actions.length, 0);
  await startRevision(env.deps, owner, { runId: run.id, words: 'Use a shorter closing.', by: 'send-back', rowId: null });
  await waitForAgentWork(env.store, run.id);
  const revised = (await deliveryListHandler(env.deps, owner, {})).find(item => item.id === run.id)!;
  assert.equal(prompts, 2); assert.equal(revised.status, 'ready-for-review');
  assert.equal(revised.preview, null); assert.equal(revised.revision, null);
  await ventureAction(env.deps, owner, 'prepare', 'test.change-order', tx => tx.replace({ ...tx.find('venture-order', env.order.id)!, request: 'A changed request.' }));
  await assert.rejects(deliveryReviewHandler(env.deps, owner, { runId: run.id, verdict: 'accepted' }), { code: 'JOB_SOURCE_CHANGED' });
});
