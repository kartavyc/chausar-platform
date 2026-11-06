import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveryListHandler, deliveryRunHandler } from '../runtime/venture/delivery/runs.ts';
import { getClientAiConsent, agreeClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { waitForAgentWork } from '../runtime/venture/agent-runtime/runner.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { setup, seedBlueprint, seedOrder, owner } from './venture-views-env.ts';

// Paired with client-ai-consent-w6.test.tsx: Allow only records permission; the owner starts separately.
test('client permission is exact and starts no work until the separate start action', async () => {
  const env = await setup();
  const { client, order } = await seedOrder(env, await seedBlueprint(env));
  env.models.connected = true;
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  await ventureAction(env.deps, owner, 'admin', 'test.live', tx => tx.touch({ launchStage: 'approve-each' }));
  let starts = 0;
  env.deps.agentRoute = async () => ({
    settings: { model: 'test-model', effort: 'high', autoReview: true, network: false, webSearch: false, shell: false },
    driver: { async open() { return {
      async run() { starts++; return { status: 'failed', text: 'Synthetic permission boundary check complete.' }; },
      async interrupt() {}, async close() {},
    }; } },
  });
  await assert.rejects(deliveryRunHandler(env.deps, owner, { orderId: order.id }), { code: 'CLIENT_AI_CONSENT_REQUIRED' });
  assert.equal(starts, 0);
  const disclosure = await getClientAiConsent(env.deps, owner, { clientId: client.id });
  await assert.rejects(agreeClientAiConsent(env.deps, owner, { clientId: client.id, disclosureDigest: 'stale' }), { code: 'CLIENT_AI_CONSENT_CHANGED' });
  assert.equal((await deliveryListHandler(env.deps, owner, {})).length, 0);
  const agreed = await agreeClientAiConsent(env.deps, owner, { clientId: client.id, disclosureDigest: disclosure.disclosureDigest });
  assert.equal(agreed.status, 'agreed');
  assert.equal(starts, 0);
  assert.equal((await deliveryListHandler(env.deps, owner, {})).length, 0);
  const run = await deliveryRunHandler(env.deps, owner, { orderId: order.id });
  await waitForAgentWork(env.store, run.id);
  assert.equal(starts, 1);
  assert.equal((await deliveryListHandler(env.deps, owner, {})).length, 1);
  assert.equal(env.store.read().actions.length, 0);
});
