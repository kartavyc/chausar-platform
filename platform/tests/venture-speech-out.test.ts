// Package 5A6 (Ink v2 wave 5): speech out, text to speech on the owner's own provider key. A capability table names each
// provider's languages, stock voices with their licences, the most characters per call and the price per character from
// the provider's own page with the day it was checked. A provider with no dated price is refused (UNPRICED_CALL); the
// quote comes first, and the spend is reserved before each call; every voice is a stock voice with its licence or a
// consented voice (5A4); the output's asset note records the provider, the voice and the text's digest. In this build
// every provider needs a key Chausar has no place to take yet, so each is labelled planned with what it waits on and
// the manual path; a fixture provider proves the path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Context } from '../runtime/contracts.ts';
import type { SpendRecord, VentureDeps, VoiceConsentRecord } from '../runtime/venture/contracts.ts';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/build/index.ts';
import { SPEECH_PROVIDERS, speechQuote, speechSay, type SpeechProvider } from '../runtime/venture/build/speech-out.ts';
import { code, owner, setup, type Env } from './venture-views-env.ts';

const PUBLIC = '142.250.1.10';
const KEY = ['fixture', 'speech', 'key'].join('-');

/** A provider as a test builds it: priced, one stock voice, a simple request and an audio answer. */
function fixture(overrides: Partial<SpeechProvider> = {}): SpeechProvider {
  return {
    id: 'fixture-tts', name: 'Fixture TTS', languages: ['hi-IN'], maxChars: 200,
    voices: [{ id: 'asha-stock', name: 'Asha', language: 'hi-IN', licence: 'Fixture stock voice; its terms allow commercial use.' }],
    price: { microsPerMillionChars: '16000000', checkedOn: '2026-10-20', source: 'https://tts.example/pricing' },
    waitsOn: null, manualPath: 'Make the audio in the provider\'s own console and add the file to the order.', note: 'A fixture.',
    request: (text, voice, key) => ({ url: 'https://tts.example/v1/speak', headers: { 'x-api-key': key }, body: JSON.stringify({ text, voice }) }),
    audio: answer => Buffer.from(JSON.parse(answer.toString('utf8')).audio, 'base64'),
    ...overrides,
  };
}

function wire(env: Env) {
  const sent: PinnedTarget[] = [];
  env.deps.net = {
    resolve: async () => [{ address: PUBLIC, family: 4 }],
    send: async target => {
      sent.push(target);
      return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ audio: Buffer.from('ID3 audio bytes').toString('base64') })) };
    },
  };
  env.deps.secrets.set('speech:fixture-tts', KEY);
  return sent;
}
const spend = (env: Env): SpendRecord[] => listRecords(env.store.read(), 'venture-spend');
const providers = (env: Env) => (handlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>)['venture.speechOut.providers'](env.deps, owner, {});

test('the capability table: languages, stock voices with licences, a per-call limit, and an honest label for each provider', async () => {
  const env = await setup();
  const view = await providers(env);
  assert.ok(view.providers.length >= 3);
  for (const provider of view.providers) {
    assert.ok(provider.languages.length > 0 && provider.voices.length > 0 && provider.maxChars > 0, provider.id);
    assert.ok(provider.voices.every((voice: any) => voice.licence.length > 10), provider.id);
    assert.equal(provider.label, 'planned: write', 'each needs a key Chausar has no place to take yet');
    assert.ok(provider.waitsOn && provider.manualPath, provider.id);
    if (provider.price) assert.match(provider.price.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.ok(SPEECH_PROVIDERS.some(provider => provider.languages.includes('hi-IN')), 'Hindi is offered');
});

test('a provider with no dated price is refused, before anything is reserved or sent', async () => {
  const env = await setup();
  const sent = wire(env);
  const unpriced = fixture({ price: null });
  await assert.rejects(speechSay(env.deps, owner, { provider: 'fixture-tts', voice: { stock: 'asha-stock' }, text: 'Namaste', quoted: 'x' }, [unpriced]), (error: any) => {
    assert.equal(error.code, 'UNPRICED_CALL');
    assert.match(error.message, /no dated price/);
    return true;
  });
  assert.equal(sent.length, 0);
  assert.equal(spend(env).length, 0);
  // The real table: a planned provider is refused with what it waits on.
  await assert.rejects(speechSay(env.deps, owner, { provider: SPEECH_PROVIDERS[0].id, voice: { stock: SPEECH_PROVIDERS[0].voices[0].id }, text: 'Hi', quoted: 'x' }), code('SPEECH_PLANNED'));
});

test('the quote comes first; then the spend is reserved before the call and settled after; the asset note names provider, voice and text digest', async () => {
  const env = await setup();
  const sent = wire(env);
  const provider = fixture();
  const text = 'Aapka order taiyaar hai.';
  const quote = speechQuote(provider, 'asha-stock', text);
  assert.equal(quote.chars, [...text].length);
  assert.equal(quote.micros, String(Math.ceil((quote.chars * 16_000_000) / 1_000_000)));
  assert.equal(quote.textDigest, createHash('sha256').update(text).digest('hex'));
  await assert.rejects(speechSay(env.deps, owner, { provider: 'fixture-tts', voice: { stock: 'asha-stock' }, text }, [provider]), (error: any) => {
    assert.equal(error.code, 'QUOTE_FIRST');
    return true;
  });
  assert.equal(sent.length, 0, 'nothing is sent before the quote is shown');
  // The reservation is written before the provider is called.
  let reservedBeforeCall = false;
  const watched: SpeechProvider = { ...provider, request: (t, v, k) => { reservedBeforeCall = spend(env).some(row => row.phase === 'reserved'); return provider.request!(t, v, k); } };
  const made = await speechSay(env.deps, owner, { provider: 'fixture-tts', voice: { stock: 'asha-stock' }, text, quoted: quote.textDigest }, [watched]);
  assert.equal(reservedBeforeCall, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].headers['x-api-key'], KEY);
  const [row] = spend(env);
  assert.equal(row.phase, 'settled');
  assert.equal(row.reservedMicros, quote.micros);
  assert.equal(row.item, 'connector:speech-fixture-tts');
  assert.equal(made.audio.toString(), 'ID3 audio bytes');
  assert.deepEqual(made.asset.source, { kind: 'generated', model: 'fixture-tts:asha-stock', prompt: `text sha256 ${quote.textDigest}` });
  assert.equal(made.asset.licence, 'Fixture stock voice; its terms allow commercial use.');
  assert.equal(made.asset.consentId, null);
  // The same text again is the same charge: never paid twice.
  await assert.rejects(speechSay(env.deps, owner, { provider: 'fixture-tts', voice: { stock: 'asha-stock' }, text, quoted: quote.textDigest }, [provider]), code('SPEND_ALREADY_CHARGED'));
  // Over the provider's limit per call: refused.
  await assert.rejects(speechSay(env.deps, owner, { provider: 'fixture-tts', voice: { stock: 'asha-stock' }, text: 'a'.repeat(201), quoted: 'x' }, [provider]), code('SPEECH_TOO_LONG'));
});

test('every voice is a stock voice with its licence or a consented voice (5A4); anything else is refused', async () => {
  const env = await setup();
  const sent = wire(env);
  const provider = fixture();
  await assert.rejects(speechSay(env.deps, owner, { provider: 'fixture-tts', voice: { stock: 'someone-famous' }, text: 'Hello', quoted: 'x' }, [provider]), code('VOICE_NOT_ALLOWED'));
  await assert.rejects(speechSay(env.deps, owner, { provider: 'fixture-tts', voice: { consentId: 'voiceconsent_nope', speaker: 'Asha' }, text: 'Hello', quoted: 'x' }, [provider]), code('CONSENT_REQUIRED'));
  // A current consent (5A4's record): the voice goes, and the asset names that consent; another speaker's name is refused.
  const consent = await ventureAction(env.deps, owner, 'approve', 'seed.consent', tx => tx.put<VoiceConsentRecord>({
    ...tx.base('venture-voice-consent'), speaker: 'Asha Rao', recordingFileId: 'upload_rec', recordingDigest: 'd', transcript: 'I agree that my voice is used.',
    statement: 'I agree.', scope: 'Narration for this business.', until: null, version: 1, revokedAt: null,
  }));
  const quote = speechQuote(provider, 'consent', 'Hello there');
  // A current consent alone is not enough: no provider's own voice-cloning call is built, so the voice is refused and
  // the consent id never goes out as a voice name.
  await assert.rejects(speechSay(env.deps, owner, { provider: 'fixture-tts', voice: { consentId: consent.id, speaker: 'Asha Rao' }, text: 'Hello there', quoted: quote.textDigest }, [provider]), (error: any) => {
    assert.equal(error.code, 'VOICE_NOT_ALLOWED');
    assert.match(error.message, /voice-cloning/);
    return true;
  });
  await assert.rejects(speechSay(env.deps, owner, { provider: 'fixture-tts', voice: { consentId: consent.id, speaker: 'Ravi' }, text: 'Hello again', quoted: speechQuote(provider, 'consent', 'Hello again').textDigest }, [provider]), code('VOICE_MISMATCH'));
  assert.equal(sent.length, 0, 'nothing was sent');
  assert.ok(!sent.some(target => String(target.body).includes(consent.id)));
});
