import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// Wave 6 package 6G1 (D42): the fake engine answers chat states exactly as the engine's chief/states.ts does (the
// engine's own tests are platform/tests/venture-chat-states.test.ts): the same states, groups, archive, snooze presets
// on the owner's clock (Kolkata for the sample), the same words and the same refusals.

function fake(start: string) {
  let now = start;
  const client = createFakeClient(new FakeEngine({ now: () => now }));
  return { client, at: (iso: string) => { now = iso; } };
}

// Friday 23 October 2026, 15:30 in India.
const NOW = '2026-10-23T10:00:00.000Z';

describe('fake chat states (6G1)', () => {
  it('the sample: a chat quiet past seven days has settled on its own; the one with drafted steps waits', async () => {
    const { client } = fake(NOW);
    const view = await client.request('venture.chief.threads', {});
    expect(view.groups.map((group) => [group.key, group.threads.map((thread) => thread.id)])).toEqual([
      ['today', ['chiefthread-billed']], ['this-week', ['chiefthread-titles']], ['last-week', ['chiefthread-trailer']],
    ]);
    expect(view.settled.map((thread) => [thread.id, thread.state, thread.settled])).toEqual([
      ['chiefthread-offer', 'settled', { at: '2026-10-18T10:00:00.000Z', by: 'auto' }],
    ]);
    expect(view.settleAfterDays).toBe(7);
    const billed = view.groups[0]!.threads[0]!;
    expect([billed.state, billed.waiting, billed.snoozedUntil, billed.settled]).toEqual(['active', true, null, null]);
    expect((await client.request('venture.chief.thread.list', { threadId: 'chiefthread-billed' })).snooze).toEqual([]);
    await expect(client.request('venture.chief.thread.state', { threadId: 'chiefthread-billed', state: 'settled' }))
      .rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'This chat is waiting for you. Answer it or decide its step first.' });
  });

  it('presets, snooze, settle, Undo and the words, as the engine says them', async () => {
    const { client, at } = fake(NOW);
    expect((await client.request('venture.chief.thread.list', { threadId: 'chiefthread-titles' })).snooze).toEqual([
      { id: 'later', until: '2026-10-23T13:00:00.000Z' },
      { id: 'tomorrow', until: '2026-10-24T03:30:00.000Z' },
      { id: 'next-week', until: '2026-10-26T03:30:00.000Z' },
    ]);
    const snoozed = await client.request('venture.chief.thread.state', { threadId: 'chiefthread-titles', state: 'snoozed', preset: 'tomorrow' });
    expect(snoozed.thread.state).toBe('snoozed');
    expect(snoozed.thread.snoozedUntil).toBe('2026-10-24T03:30:00.000Z');
    expect(snoozed.undo).toEqual({ threadId: 'chiefthread-titles', state: 'active' });
    expect(snoozed.line).toBe('Snoozed until 24 Oct 2026, 09:00. It comes back early if it needs you.');
    expect((await client.request('venture.chief.threads', {})).groups.map((group) => group.key)).toEqual(['today', 'last-week', 'snoozed']);
    const settled = await client.request('venture.chief.thread.state', { threadId: 'chiefthread-titles', state: 'settled' });
    expect(settled.thread.settled).toEqual({ at: NOW, by: 'owner' });
    expect(settled.undo).toEqual({ threadId: 'chiefthread-titles', state: 'snoozed', until: '2026-10-24T03:30:00.000Z' });
    expect(settled.line).toBe('Settled. It is in Settled chats until you open it again.');
    const back = await client.request('venture.chief.thread.state', settled.undo);
    expect(back.thread.snoozedUntil).toBe('2026-10-24T03:30:00.000Z');
    expect((await client.request('venture.chief.thread.state', { threadId: 'chiefthread-trailer', state: 'pinned' })).line).toBe('Pinned to the top of your chats.');
    expect((await client.request('venture.chief.thread.state', { threadId: 'chiefthread-offer', state: 'active' })).line).toBe('Back in your chats.');
    at('2026-10-24T03:30:00.000Z');
    expect((await client.request('venture.chief.thread.list', { threadId: 'chiefthread-titles' })).thread.state).toBe('active');
    // On a Sunday tomorrow is next week's Monday: one choice.
    at('2026-10-25T06:00:00.000Z');
    expect((await client.request('venture.chief.thread.list', { threadId: 'chiefthread-titles' })).snooze.map((option) => option.id)).toEqual(['later', 'tomorrow']);
  });

  it('the quiet days: 0 is never, Undo gives the number before; bad requests are refused with the engine\'s words', async () => {
    const { client } = fake(NOW);
    expect(await client.request('venture.chief.settle.set', { days: 0 })).toEqual({ days: 0, undo: 7, line: 'Chats never settle on their own.' });
    expect((await client.request('venture.chief.threads', {})).settled).toEqual([]);
    expect(await client.request('venture.chief.settle.set', { days: 1 })).toEqual({ days: 1, undo: 0, line: 'Chats settle after 1 quiet day.' });
    await expect(client.request('venture.chief.settle.set', { days: 366 })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'days is a whole number from 0 (never) to 365.' });
    await expect(client.request('venture.chief.thread.state', { threadId: 'chiefthread-titles', state: 'snoozed' } as never)).rejects.toMatchObject({ message: 'A snooze takes a preset or a time.' });
    await expect(client.request('venture.chief.thread.state', { threadId: 'chiefthread-titles', state: 'snoozed', until: '2026-10-23T09:59:00.000Z' })).rejects.toMatchObject({ message: 'Pick a time that is still ahead.' });
    await expect(client.request('venture.chief.thread.state', { threadId: 'chiefthread-titles', state: 'active', preset: 'later' })).rejects.toMatchObject({ message: 'Only a snooze takes a preset or a time.' });
    await expect(client.request('venture.chief.thread.state', { threadId: 'chiefthread-nowhere', state: 'active' })).rejects.toMatchObject({ message: 'That chat was not found.' });
  });

  it('the chief\'s question back keeps a chat waiting until the owner writes again', async () => {
    const { client } = fake(NOW);
    const consent = (await client.request('venture.chief.threads', {})).consent;
    if (consent.state === 'needed' || consent.state === 'stale') await client.request('venture.chats.consent', { digest: consent.digest! });
    const asked = await client.request('venture.chief.thread.send', { text: '@Editor and @Researcher, how are the hooks?' });
    expect(asked.ask).toBe('Which agent: Editor or Researcher?');
    expect(asked.thread.waiting).toBe(true);
    const answered = await client.request('venture.chief.thread.send', { threadId: asked.thread.id, text: '@Editor cut a trailer from episode 14' });
    expect(answered.thread.waiting).toBe(false);
  });
});

// One-shot A1 (row 11): as the engine's agents/consent.ts, the chat consent is to what is sent and to whom. Saving the
// same AI again with another model setting keeps it; another AI asks again.
describe('fake chat consent', () => {
  it('stays given when the same AI is saved again with another model, and asks again for another AI', async () => {
    const { client } = fake(NOW);
    const key = ['test', 'key', 'value'].join('-');
    await client.request('venture.models.connect', { presetId: 'openai-gpt-6-luna', consentDigest: 'consent-openai', apiKey: key, tiers: ['fast', 'main'] } as never);
    let consent = (await client.request('venture.chief.threads', {})).consent;
    expect(consent.state === 'needed' || consent.state === 'stale').toBe(true);
    await client.request('venture.chats.consent', { digest: consent.digest! });
    await client.request('venture.models.connect', { presetId: 'openai-gpt-6-luna', consentDigest: 'consent-openai', apiKey: key, model: 'gpt-6-luna-mini', tiers: ['fast', 'main'] } as never);
    consent = (await client.request('venture.chief.threads', {})).consent;
    expect(consent.state).toBe('given');
    await client.request('venture.models.connect', { presetId: 'openrouter', consentDigest: 'consent-openrouter', apiKey: key, tiers: ['fast', 'main'] } as never);
    expect((await client.request('venture.chief.threads', {})).consent.state).toBe('stale');
  });

  it('on OpenRouter, a model from another company asks again (review of A1 row 11)', async () => {
    const { client } = fake(NOW);
    const key = ['test', 'key', 'value'].join('-');
    const connect = (model: string) => client.request('venture.models.connect', { presetId: 'openrouter', consentDigest: 'consent-openrouter', apiKey: key, model, tiers: ['fast', 'main'] } as never);
    await connect('openai/gpt-6-luna');
    const consent = (await client.request('venture.chief.threads', {})).consent;
    expect(consent.text).toContain('openai');
    await client.request('venture.chats.consent', { digest: consent.digest! });
    await connect('openai/gpt-6-luna-mini');
    expect((await client.request('venture.chief.threads', {})).consent.state).toBe('given');
    await connect('deepseek/deepseek-v4');
    expect((await client.request('venture.chief.threads', {})).consent.state).toBe('stale');
  });
});
