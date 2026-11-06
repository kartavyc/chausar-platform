import test from 'node:test';
import assert from 'node:assert/strict';
import { presetSpec } from '../../runtime/venture/models/presets.ts';
import { recordScenario } from '../helpers/recording-scenario.ts';

for (const ai of [false, true]) test(`Team conversation ${ai ? 'with' : 'without'} AI matches its real engine recording`, async t => {
  const text = 'Your next step is to review the draft before sharing it.';
  await recordScenario(t, ai ? 'team-ai' : 'team-template', async ({ rpc }) => {
    const team = await rpc.request('venture.team.list', {});
    const agent = team.agents.find((row: { kind: string }) => row.kind === 'agent');
    assert.ok(agent);
    const thread = await rpc.request('venture.agents.thread.list', { agent: agent.id });
    if (ai) {
      assert.equal(thread.consent.state, 'needed');
      await rpc.request('venture.chats.consent', { digest: thread.consent.digest });
    } else assert.equal(thread.consent.state, 'not-needed');
    const sent = await rpc.request('venture.agents.thread.send', { agent: agent.id, text: 'What should I review before sharing work?' });
    assert.equal(sent.added.length, 2);
    if (ai) assert.ok(JSON.stringify(sent).includes(text));
    else assert.ok(JSON.stringify(sent).includes('Connect your AI'));
    const after = await rpc.request('venture.agents.thread.list', { agent: agent.id });
    assert.equal(after.items.filter((item: { type: string }) => item.type === 'message').length, 2);
  }, ai ? {
    replay: { label: 'synthetic recording', note: 'Sample model words; all Team answers are produced by the real engine.', responses: [{
      purpose: 'agent-chat', kind: 'anthropic-messages', model: 'claude-sonnet-5-5', status: 200, mustInclude: ['What should I review before sharing work?'],
      body: { content: [{ type: 'text', text: JSON.stringify({ parts: [{ kind: 'text', text, receiptId: '', key: '' }] }) }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 30 } },
    }] },
    prepare: async engine => { await engine.request('venture.models.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: presetSpec('anthropic-sonnet-5-5').consentDigest, apiKey: 'recording-sample-only-credential', tiers: ['main'] }); },
  } : {});
});
