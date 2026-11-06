import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { FAKE_TALK_WORDS } from '../../src/engine/fake-talk';
import type { ChiefSendResult, TalkHeard, TalkSaid, TalkStarted, TalkView } from '../../src/engine/types';
import { captionWav } from '../../../../platform/runtime/venture/playbooks/translation-studio/caption-audio';
import { ESTIMATE_SAID, SARVAM_RATE_DIGEST, TALK_CONSENT_DIGEST } from '../../../../platform/runtime/venture/agents/talk-core';

/**
 * The fake engine answers push-to-talk (6I1, D45) as the engine does (platform/tests/venture-talk-w6.test.ts holds the
 * engine's side): the notice before the microphone, the same refusals and words, Sarvam's dated price and limit, and
 * reading aloud only receipt-checked words. It recognizes nothing and says so.
 */
const NOW = '2026-11-01T10:00:00.000Z';
const ask = <T>(engine: FakeEngine, method: string, params: Record<string, unknown> = {}) => engine.request(method, params) as Promise<T>;
const wav = (seconds: number) => captionWav(new Float32Array(16000 * seconds).fill(0.1));

describe('fake engine: push-to-talk (6I1)', () => {
  it('the notice comes first, whisper.cpp must be set up, one recording per session, the words come back unsent', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const first = await ask<TalkView>(engine, 'venture.talk.get');
    expect([first.desktop, first.consent.given, first.sarvam.label, first.sarvam.cap, first.speak.label]).toEqual([true, false, 'fixture-tested', '₹100.00', 'planned: write']);
    await expect(ask(engine, 'venture.talk.start')).rejects.toMatchObject({ code: 'TALK_CONSENT_REQUIRED' });
    await expect(ask(engine, 'venture.talk.consent', { digest: 'old', keepAudio: false })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    await ask(engine, 'venture.talk.consent', { digest: TALK_CONSENT_DIGEST, keepAudio: false });
    await expect(ask(engine, 'venture.talk.start')).rejects.toMatchObject({ code: 'TALK_NOT_READY' });
    await ask(engine, 'venture.transcription.set', { command: 'C:\\whisper\\whisper-cli.exe', model: 'C:\\whisper\\ggml-base.bin' });
    const started = await ask<TalkStarted>(engine, 'venture.talk.start');
    expect([started.provider, started.seconds]).toEqual(['whisper-local', 20]);
    expect((await ask<TalkView>(engine, 'venture.talk.get')).session?.id).toBe(started.sessionId);
    const heard = await ask<TalkHeard>(engine, 'venture.talk.hear', { sessionId: started.sessionId, audioBase64: wav(2) });
    expect(heard).toEqual({ text: FAKE_TALK_WORDS, provider: 'whisper-local', kept: false, cost: null, line: 'Check the words, then send. Saying yes never approves anything; you tap the card.' });
    await expect(ask(engine, 'venture.talk.hear', { sessionId: started.sessionId, audioBase64: wav(2) })).rejects.toMatchObject({ code: 'TALK_SESSION_EXPIRED' });
    const withdrawn = await ask<TalkView>(engine, 'venture.talk.consent', { withdraw: true });
    expect([withdrawn.consent.given, withdrawn.recordings]).toEqual([false, 0]);
  });

  it('Sarvam: the rate and limit approved once, the cost in paise by code, the limit held', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await ask(engine, 'venture.talk.consent', { digest: TALK_CONSENT_DIGEST, keepAudio: false });
    await expect(ask(engine, 'venture.talk.setup', { listen: 'sarvam', capMinor: '6', rateDigest: SARVAM_RATE_DIGEST })).rejects.toMatchObject({ code: 'TALK_NOT_READY' });
    const view = await ask<TalkView>(engine, 'venture.talk.setup', { listen: 'sarvam', key: ['fixture', 'sarvam', 'key'].join('-'), capMinor: '6', rateDigest: SARVAM_RATE_DIGEST });
    expect([view.listen, view.sarvam.connected, view.sarvam.cap]).toEqual(['sarvam', true, '₹0.06']);
    const one = await ask<TalkStarted>(engine, 'venture.talk.start');
    expect((await ask<TalkHeard>(engine, 'venture.talk.hear', { sessionId: one.sessionId, audioBase64: wav(3) })).cost).toEqual({ minor: '3', figure: '₹0.03' });
    const two = await ask<TalkStarted>(engine, 'venture.talk.start');
    await ask(engine, 'venture.talk.hear', { sessionId: two.sessionId, audioBase64: wav(3) });
    const three = await ask<TalkStarted>(engine, 'venture.talk.start');
    await expect(ask(engine, 'venture.talk.hear', { sessionId: three.sessionId, audioBase64: wav(1) })).rejects.toMatchObject({ code: 'TALK_CAP_REACHED' });
    expect((await ask<TalkView>(engine, 'venture.talk.get')).sarvam.spent).toBe('₹0.06');
  });

  it('reading aloud: the chief\'s own answer only, never a model number, and read on screen without a speech key', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const sent = await ask<ChiefSendResult>(engine, 'venture.chief.thread.send', { text: 'What did I invoice this month?' });
    const owner = sent.added.find((message) => message.from === 'owner')!;
    const chief = sent.added.find((message) => message.from === 'chief');
    await expect(ask(engine, 'venture.talk.say', { threadId: sent.thread.id, messageId: owner.id })).rejects.toMatchObject({ code: 'TALK_NOT_FOUND' });
    expect(chief).toBeDefined();
    if (!chief) return;
    const said = await ask<TalkSaid>(engine, 'venture.talk.say', { threadId: sent.thread.id, messageId: chief.id });
    expect([said.quote, said.audioBase64]).toEqual([null, null]);
    for (const part of chief.parts) {
      if (part.kind === 'estimate') expect(said.spoken).toContain(ESTIMATE_SAID);
      if (part.kind === 'figure') expect(said.spoken).toContain(part.display);
    }
    expect(said.line).toMatch(/Google Cloud key/);
  });

  it('the hosted tier says push-to-talk is not available', async () => {
    const engine = new FakeEngine({ now: () => NOW, hosted: true });
    const view = await ask<TalkView>(engine, 'venture.talk.get');
    expect([view.desktop, view.line]).toEqual([false, 'Push-to-talk works only in the desktop app.']);
    await expect(ask(engine, 'venture.talk.start')).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' });
  });
});
