import test from 'node:test';
import assert from 'node:assert/strict';
import { recordScenario } from '../helpers/recording-scenario.ts';
import { presetSpec } from '../../runtime/venture/models/presets.ts';
import type { ModelReplayFixture } from '../../runtime/venture/contracts.ts';

const answer = { name: 'Client names', summary: 'A list of the clients in this business.', html: '<h1>Client names</h1><ul id="clients"></ul><script>chausar.call("clients_list",{}).then(function(r){document.getElementById("clients").textContent=r.clients.map(function(c){return c.name;}).join(", ");});</script>' };
const replay: ModelReplayFixture = {
  label: 'synthetic recording',
  note: 'Hand-written mini app answer for an offline sample business. No live account or paid call.',
  responses: [{ purpose: 'chief-chat', kind: 'anthropic-messages', model: 'claude-sonnet-5-5', status: 200, mustInclude: ['venture-mini-app'], body: { content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 80 } } }],
};

test('Apps records a real AI replay, exact permission approval, revocation and removal', async t => {
  await recordScenario(t, 'apps', async ({ rpc }) => {
    await rpc.request('venture.apps.list', {});
    const made = await rpc.request('venture.apps.make', { ask: 'Make a small list of my client names.' });
    assert.equal(made.app.name, answer.name);
    assert.ok(made.app.ask);
    await assert.rejects(rpc.request('venture.apps.call', { app: made.app.id, tool: 'clients_list', arguments: {} }), { code: 'APP_NOT_ALLOWED' });
    const granted = await rpc.request('venture.apps.grant', { app: made.app.id, digest: made.app.ask.digest });
    assert.equal(granted.app.ask, null);
    const result = await rpc.request('venture.apps.call', { app: made.app.id, tool: 'clients_list', arguments: {} });
    assert.deepEqual(result.structuredContent.clients, []);
    const pinned = await rpc.request('venture.apps.pin', { app: made.app.id, pinned: true });
    assert.equal(pinned.app.pinned, true);
    await rpc.request('venture.apps.get', { app: made.app.id });
    await rpc.request('venture.apps.revoke', { app: made.app.id });
    await assert.rejects(rpc.request('venture.apps.call', { app: made.app.id, tool: 'clients_list', arguments: {} }), { code: 'APP_NOT_ALLOWED' });
    const removed = await rpc.request('venture.apps.remove', { app: made.app.id });
    assert.equal(removed.removed, true);
    await rpc.request('venture.apps.list', {});
  }, {
    replay,
    async prepare(engine) {
      const spec = presetSpec('anthropic-sonnet-5-5');
      await engine.request('venture.models.connect', { presetId: spec.id, consentDigest: spec.consentDigest, apiKey: 'sample-only-provider-credential' });
      const threads = await engine.request('venture.chief.threads', {});
      await engine.request('venture.chats.consent', { digest: threads.consent.digest });
    },
  });
});



