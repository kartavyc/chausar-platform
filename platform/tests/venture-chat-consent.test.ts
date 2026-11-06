// The one chat consent (Ink v2 wave 4, package 4B1, spec 5.2): agent chat sends the owner's message and what Chausar
// reads to answer it to the owner's own AI, so the first message needs the owner's consent to exactly that, naming the
// AI. A later change of AI connection makes it stale. With templates only nothing is sent and no consent is asked. A
// chat call carries client data, so it goes by preview and the approved send, never on standing consent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords } from '../runtime/venture/records.ts';
import { code, phone } from './venture-judge-helpers.ts';
import { agentBusiness, said, scriptChat } from './venture-agent-helpers.ts';

const TEXT = 'Chats send your message and what Chausar reads to answer it (run steps, file names, figures with their receipts, the agent\'s notes; for a network search, your question as you typed it, your contacts\' titles and companies with each contact\'s own name masked, and your notes and meeting titles with the full names of people in your network and of clients who are people masked; emails and phone numbers are masked everywhere) to Claude Sonnet 5.5 with your key. Keys, passphrases and bank or card numbers are never sent.';

test('consent: the first message waits for the consent, which names the connected AI', async () => {
  const env = await agentBusiness();
  const view = await env.agents('venture.agents.thread.list', { agent: 'story-editor' });
  assert.equal(view.consent.state, 'needed');
  assert.equal(view.consent.text, TEXT);
  assert.match(view.consent.digest, /^[a-f0-9]{64}$/);
  assert.equal(view.consent.at, null);
  await assert.rejects(env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'Why did the thumbnail render stop?' }), (error: any) => {
    assert.equal(error.code, 'CHAT_CONSENT_REQUIRED');
    assert.equal(error.message, TEXT);
    return true;
  });
  assert.equal(listRecords(env.store.read(), 'venture-agent-message').length, 0, 'nothing is stored before the consent');
  assert.equal(env.models.previewed.length, 0, 'nothing is previewed either');

  await assert.rejects(env.agents('venture.chats.consent', { digest: view.consent.digest }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.agents('venture.chats.consent', { digest: 'e'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(env.agents('venture.chats.consent', {}), code('INVALID_VENTURE_REQUEST'));
  const given = await env.agents('venture.chats.consent', { digest: view.consent.digest });
  assert.equal(given.state, 'given');
  assert.equal(given.digest, view.consent.digest);
  const record = listRecords(env.store.read(), 'venture-chat-consent').at(-1)!;
  assert.equal(record.textDigest, view.consent.digest);
  assert.equal(record.presetId, 'anthropic-sonnet-5-5');
  assert.equal(record.by, 'owner');
  // One consent per business covers every agent.
  assert.equal((await env.agents('venture.agents.thread.list', { agent: 'packager' })).consent.state, 'given');

  scriptChat(env, { answer: () => ({ parts: [said('The render stopped because the cut file was missing.')] }) });
  const sent = await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'Why did the thumbnail render stop?' });
  assert.equal(sent.added.length, 2);
  const task = env.models.previewed.filter(item => item.purpose === 'agent-chat').at(-1)!;
  assert.equal(task.containsClientData, true, 'a chat call carries client data');
  assert.deepEqual(env.models.consents, ['approved-preview'], 'sent under the owner\'s approval in the app, never standing consent');
  assert.equal(env.models.generated.filter(item => item.purpose === 'agent-chat').length, 0);
  const call = listRecords(env.store.read(), 'venture-model-call' as any).at(-1) as any;
  assert.equal(call.purpose, 'agent-chat');
});

test('consent: a change of AI connection makes it stale, and the new text names the new AI', async () => {
  const env = await agentBusiness();
  const first = await env.agents('venture.agents.thread.list', { agent: 'story-editor' });
  await env.agents('venture.chats.consent', { digest: first.consent.digest });
  const status = env.models.status.bind(env.models);
  env.models.status = () => {
    const now = status();
    return { ...now, tiers: { ...now.tiers, main: { ...now.tiers.main, presetId: 'openai-gpt-6-luna', model: 'gpt-6-luna' } } };
  };
  const view = await env.agents('venture.agents.thread.list', { agent: 'story-editor' });
  assert.equal(view.consent.state, 'stale');
  assert.match(view.consent.text, /to GPT-6 Luna with your key\./);
  assert.notEqual(view.consent.digest, first.consent.digest);
  await assert.rejects(env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'Why did the render stop?' }), code('CHAT_CONSENT_STALE'));
  await assert.rejects(env.agents('venture.chats.consent', { digest: first.consent.digest }), code('APPROVAL_STALE'));
  assert.equal((await env.agents('venture.chats.consent', { digest: view.consent.digest })).state, 'given');
});

test('consent: with templates only nothing is sent, so none is asked and the agent answers from code', async () => {
  const env = await agentBusiness();
  env.models.main = 'template';
  env.models.fast = 'template';
  const view = await env.agents('venture.agents.thread.list', { agent: 'story-editor' });
  assert.deepEqual(view.consent, { state: 'not-needed', text: null, digest: null, at: null });
  const sent = await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'Why did the thumbnail render stop?' });
  const reply = sent.added[1].message;
  assert.equal(reply.from, 'agent');
  assert.ok(reply.parts.every((part: any) => part.kind === 'text'));
  assert.match(reply.parts.map((part: any) => part.text).join(' '), /Connect your AI in Connections/);
  assert.equal(env.models.previewed.length, 0);
  assert.equal(listRecords(env.store.read(), 'venture-agent-message').at(-1)!.author, 'template');
  assert.equal((await env.agents('venture.chats.consent', { digest: 'e'.repeat(64) })).state, 'not-needed', 'nothing to agree to');
  assert.equal(listRecords(env.store.read(), 'venture-chat-consent').length, 0);
});
