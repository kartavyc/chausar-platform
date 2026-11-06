import test from 'node:test';
import assert from 'node:assert/strict';
import { presetSpec } from '../../runtime/venture/models/presets.ts';
import { recordScenario } from '../helpers/recording-scenario.ts';

test('Chats consent, answer and kept thread match the real engine recording', async t => {
  const text = 'Keep the draft here until you have reviewed it.';
  await recordScenario(t, 'chats', async ({ rpc }) => {
    const before = await rpc.request('venture.chief.threads', {});
    assert.equal(before.consent.state, 'needed');
    await rpc.request('venture.chats.consent', { digest: before.consent.digest });
    const sent = await rpc.request('venture.chief.thread.send', { text: 'What should I review before sharing work?' });
    assert.ok(JSON.stringify(sent.added).includes(text));
    const thread = await rpc.request('venture.chief.thread.list', { threadId: sent.thread.id });
    assert.ok(JSON.stringify(thread).includes(text));
    const after = await rpc.request('venture.chief.threads', {});
    assert.ok(after.groups.some((group: { threads: { id: string }[] }) => group.threads.some(row => row.id === sent.thread.id)));
  }, {
    replay: { label: 'synthetic recording', note: 'Sample model answer passed through real Chats consent and answer checks.', responses: [{
      purpose: 'chief-chat', kind: 'anthropic-messages', model: 'claude-sonnet-5-5', status: 200, mustInclude: ['What should I review before sharing work?'],
      body: { content: [{ type: 'text', text: JSON.stringify({ tools: [], parts: [{ kind: 'text', text, receiptId: '', key: '' }], proposals: [] }) }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 30 } },
    }] },
    prepare: async engine => { await engine.request('venture.models.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: presetSpec('anthropic-sonnet-5-5').consentDigest, apiKey: 'recording-sample-only-credential', tiers: ['main'] }); },
  });
});
