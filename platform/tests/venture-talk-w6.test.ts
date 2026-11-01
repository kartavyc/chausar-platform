// Wave 6 package 6I1 (D45): push-to-talk. A consent notice comes before the microphone first turns on; the desktop app
// only; speech to text through the owner's whisper.cpp or Sarvam on the owner's key (fixture-tested against Sarvam's
// public docs: no key exists); the words come back for the chat box, never sent and never an approval; the recording is
// deleted after transcription unless the owner chose to keep it; a chief answer is read aloud only from receipt-checked
// text, through speech-out.ts, after its quote.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import type { VentureDeps, VentureMethod } from '../runtime/venture/contracts.ts';
import type { PinnedTarget } from '../runtime/venture/core/net-guard.ts';
import { handlers } from '../runtime/venture/agents/index.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { captionWav } from '../runtime/venture/playbooks/translation-studio/caption-audio.ts';
import { ESTIMATE_SAID, NUMBER_SAID, SARVAM_RATE_DIGEST, TALK_CONSENT_DIGEST, spokenFrom } from '../runtime/venture/agents/talk-core.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';

const PUBLIC = '142.250.1.10';
const SARVAM_KEY = ['fixture', 'sarvam', 'subscription'].join('-');
const GOOGLE_KEY = ['fixture', 'google', 'speech'].join('-');

function talk<T = any>(env: Env, method: VentureMethod, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const handler = (handlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method];
  assert.ok(handler, `no agents handler for ${method}`);
  return handler(env.deps, ctx, payload) as Promise<T>;
}

/** Three seconds of a quiet tone, as the app's recorder makes it (mono 16 kHz PCM). */
const wav = (seconds = 3) => captionWav(Float32Array.from({ length: 16000 * seconds }, (_, i) => Math.sin(i / 8) * 0.1));

/** The owner's whisper.cpp as a stand-in: it records the file it was given and answers the SRT it is told to. */
function whisper(env: Env, srt = '1\n00:00:00,000 --> 00:00:02,000\n Show me unpaid invoices.\n') {
  const seen: { path: string; existed: boolean; head: string }[] = [];
  env.deps.services.speech = {
    localTranscriber: () => ({ ready: true, providerId: 'whisper-local' }),
    transcribeFile: async (_ctx: Context, input: { path: string; prompt?: string }) => {
      seen.push({ path: input.path, existed: existsSync(input.path), head: (await readFile(input.path)).subarray(0, 4).toString() });
      return { providerId: 'whisper-local', srt };
    },
  } as never;
  return seen;
}

function sarvamNet(env: Env, answer: { status: number; body: unknown } = { status: 200, body: { request_id: 'req_1', transcript: 'Kitne invoices baaki hain', language_code: 'hi-IN' } }) {
  const sent: PinnedTarget[] = [];
  env.deps.net = {
    resolve: async () => [{ address: PUBLIC, family: 4 }],
    send: async target => {
      sent.push(target);
      return { status: answer.status, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(answer.body)) };
    },
  };
  return sent;
}

async function agree(env: Env, keepAudio = false) {
  return talk(env, 'venture.talk.consent', { digest: TALK_CONSENT_DIGEST, keepAudio });
}

const talkKinds = (env: Env) => Object.fromEntries((env.store.read().conversations as { kind?: string }[])
  .filter(record => typeof record?.kind === 'string' && record.kind.startsWith('venture-') && !record.kind.startsWith('venture-talk-'))
  .reduce((map, record) => map.set(record.kind!, (map.get(record.kind!) ?? 0) + 1), new Map<string, number>()));

test('the view: desktop, no consent yet, whisper.cpp not set up, Sarvam fixture-tested with its dated price, reading aloud planned', async () => {
  const env = await setup();
  const view = await talk(env, 'venture.talk.get');
  assert.equal(view.desktop, true);
  assert.deepEqual([view.consent.given, view.consent.digest, view.consent.keepAudio], [false, TALK_CONSENT_DIGEST, false]);
  assert.match(view.consent.text, /deletes the recording unless you choose to keep it/);
  assert.equal(view.whisper.ready, false);
  assert.deepEqual([view.sarvam.label, view.sarvam.connected, view.sarvam.price.paisePerMinute, view.sarvam.price.checkedOn, view.sarvam.rateDigest], ['fixture-tested', false, '49', '2026-11-01', SARVAM_RATE_DIGEST]);
  assert.deepEqual([view.sarvam.capMinor, view.sarvam.cap, view.sarvam.spent], ['10000', '₹100.00', '₹0.00']);
  assert.equal(view.speak.label, 'planned: write');
  assert.equal(view.session, null);
  env.deps.host = 'hosted-web';
  const hosted = await talk(env, 'venture.talk.get');
  assert.equal(hosted.desktop, false);
  assert.equal(hosted.line, 'Push-to-talk works only in the desktop app.');
});

test('the microphone waits for the notice: no consent, a stale digest, the phone and the hosted tier are refused', async () => {
  const env = await setup();
  whisper(env);
  await assert.rejects(talk(env, 'venture.talk.start'), code('TALK_CONSENT_REQUIRED'));
  await assert.rejects(talk(env, 'venture.talk.consent', { digest: 'old', keepAudio: false }), code('APPROVAL_STALE'));
  await assert.rejects(talk(env, 'venture.talk.consent', { digest: TALK_CONSENT_DIGEST, keepAudio: false }, phone), code('APP_APPROVAL_REQUIRED'));
  const view = await agree(env);
  assert.deepEqual([view.consent.given, view.consent.keepAudio, view.consent.at], [true, false, env.now()]);
  await assert.rejects(talk(env, 'venture.talk.start', {}, phone), code('APP_APPROVAL_REQUIRED'));
  env.deps.host = 'hosted-web';
  await assert.rejects(talk(env, 'venture.talk.start'), code('TIER_UNAVAILABLE'));
  await assert.rejects(talk(env, 'venture.talk.hear', { sessionId: 'x', audioBase64: wav() }), code('TIER_UNAVAILABLE'));
});

test('whisper.cpp: one recording per session, the words come back for the box, the audio is deleted, nothing is sent or approved', async () => {
  const env = await setup();
  const seen = whisper(env, '1\n00:00:00,000 --> 00:00:01,000\n yes\n');
  await agree(env);
  const before = talkKinds(env);
  const started = await talk(env, 'venture.talk.start');
  assert.deepEqual([started.provider, started.seconds], ['whisper-local', 20]);
  assert.equal((await talk(env, 'venture.talk.get')).session.id, started.sessionId, 'the desktop shell checks the session it lets the microphone open for');
  const heard = await talk(env, 'venture.talk.hear', { sessionId: started.sessionId, audioBase64: wav() });
  assert.deepEqual([heard.text, heard.provider, heard.kept, heard.cost], ['yes', 'whisper-local', false, null]);
  assert.equal(heard.line, 'Check the words, then send. Saying yes never approves anything; you tap the card.');
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0]!.existed, seen[0]!.head], [true, 'RIFF']);
  assert.equal(existsSync(seen[0]!.path), false, 'the recording file is deleted after transcription');
  const rows = listRecords(env.store.read(), 'venture-talk-heard');
  assert.deepEqual(rows.map(row => [row.provider, row.durationMs, row.costMinor, row.audioBase64, row.phase]), [['whisper-local', 3000, '0', '', 'done']]);
  assert.deepEqual(talkKinds(env), before, 'a spoken yes changes nothing else: no message, no proposal, no approval');
  assert.equal(JSON.stringify(env.store.read()).includes('"yes"'), false, 'the words are not kept by Chausar');
  await assert.rejects(talk(env, 'venture.talk.hear', { sessionId: started.sessionId, audioBase64: wav() }), code('TALK_SESSION_EXPIRED'));
  const again = await talk(env, 'venture.talk.start');
  env.advance(61_000);
  await assert.rejects(talk(env, 'venture.talk.hear', { sessionId: again.sessionId, audioBase64: wav() }), code('TALK_SESSION_EXPIRED'));
  const quiet = await talk(env, 'venture.talk.start');
  whisper(env, '');
  await assert.rejects(talk(env, 'venture.talk.hear', { sessionId: quiet.sessionId, audioBase64: wav() }), code('TALK_NOTHING_HEARD'));
  const bad = await talk(env, 'venture.talk.start');
  await assert.rejects(talk(env, 'venture.talk.hear', { sessionId: bad.sessionId, audioBase64: Buffer.from('not a wav').toString('base64') }), code('INVALID_AUDIO'));
});

test('keeping audio is the owner\'s choice; withdrawing deletes what was kept and turns the microphone off', async () => {
  const env = await setup();
  whisper(env);
  await agree(env, true);
  const started = await talk(env, 'venture.talk.start');
  const heard = await talk(env, 'venture.talk.hear', { sessionId: started.sessionId, audioBase64: wav(2) });
  assert.equal(heard.kept, true);
  assert.equal(listRecords(env.store.read(), 'venture-talk-heard')[0]!.audioBase64.length > 0, true);
  assert.equal((await talk(env, 'venture.talk.get')).recordings, 1);
  const view = await talk(env, 'venture.talk.consent', { withdraw: true });
  assert.deepEqual([view.consent.given, view.recordings], [false, 0]);
  const row = listRecords(env.store.read(), 'venture-talk-heard')[0]!;
  assert.deepEqual([row.audioBase64, row.audioDigest, typeof row.erasedAt], ['', '', 'string']);
  await assert.rejects(talk(env, 'venture.talk.start'), code('TALK_CONSENT_REQUIRED'));
});

test('Sarvam on the owner\'s key: the rate and a monthly limit approved once, its documented request, a code-computed cost, the limit held', async () => {
  const env = await setup();
  await agree(env);
  await assert.rejects(talk(env, 'venture.talk.setup', { listen: 'sarvam', key: SARVAM_KEY, capMinor: '6', rateDigest: 'old' }), code('APPROVAL_STALE'));
  await assert.rejects(talk(env, 'venture.talk.setup', { listen: 'sarvam', capMinor: '6', rateDigest: SARVAM_RATE_DIGEST }), code('TALK_NOT_READY'));
  await assert.rejects(talk(env, 'venture.talk.setup', { listen: 'sarvam', key: SARVAM_KEY, capMinor: '6', rateDigest: SARVAM_RATE_DIGEST }, phone), code('APP_APPROVAL_REQUIRED'));
  const view = await talk(env, 'venture.talk.setup', { listen: 'sarvam', key: SARVAM_KEY, capMinor: '6', rateDigest: SARVAM_RATE_DIGEST });
  assert.deepEqual([view.listen, view.sarvam.connected, view.sarvam.capMinor, view.sarvam.cap], ['sarvam', true, '6', '₹0.06']);
  assert.equal(JSON.stringify(view).includes(SARVAM_KEY), false, 'the key never comes back');
  const sent = sarvamNet(env);
  const started = await talk(env, 'venture.talk.start');
  assert.equal(started.provider, 'sarvam');
  const heard = await talk(env, 'venture.talk.hear', { sessionId: started.sessionId, audioBase64: wav(3) });
  assert.deepEqual([heard.text, heard.provider, heard.cost], ['Kitne invoices baaki hain', 'sarvam', { minor: '3', figure: '₹0.03' }]);
  assert.equal(sent.length, 1);
  const target = sent[0]!;
  assert.deepEqual([String(target.url), target.method, target.headers['api-subscription-key']], ['https://api.sarvam.ai/speech-to-text', 'POST', SARVAM_KEY]);
  assert.match(target.headers['content-type']!, /^multipart\/form-data; boundary=/);
  const body = Buffer.from(target.body as Uint8Array).toString('latin1');
  assert.match(body, /name="model"\r\n\r\nsaaras:v4\r\n/);
  assert.match(body, /name="language_code"\r\n\r\nunknown\r\n/);
  assert.match(body, /name="file"; filename="talk.wav"\r\nContent-Type: audio\/wav\r\n\r\nRIFF/);
  assert.deepEqual(listRecords(env.store.read(), 'venture-talk-heard').map(row => [row.provider, row.costMinor, row.phase]), [['sarvam', '3', 'done']]);
  assert.equal((await talk(env, 'venture.talk.get')).sarvam.spent, '₹0.03');
  // Three paise spent of a six paise limit: the next three-second recording fits, a fourth paisa would not.
  const second = await talk(env, 'venture.talk.start');
  await talk(env, 'venture.talk.hear', { sessionId: second.sessionId, audioBase64: wav(3) });
  const third = await talk(env, 'venture.talk.start');
  await assert.rejects(talk(env, 'venture.talk.hear', { sessionId: third.sessionId, audioBase64: wav(1) }), code('TALK_CAP_REACHED'));
  assert.equal(sent.length, 2, 'a recording past the limit is never sent');
});

test('Sarvam refusals: a used-up quota and a failed answer keep the cost held and are not retried', async () => {
  const env = await setup();
  await agree(env);
  await talk(env, 'venture.talk.setup', { listen: 'sarvam', key: SARVAM_KEY, capMinor: '10000', rateDigest: SARVAM_RATE_DIGEST });
  const sent = sarvamNet(env, { status: 429, body: { error: { message: 'Quota exceeded', code: 'insufficient_quota_error' } } });
  const started = await talk(env, 'venture.talk.start');
  await assert.rejects(talk(env, 'venture.talk.hear', { sessionId: started.sessionId, audioBase64: wav(2) }), code('QUOTA_REACHED'));
  sarvamNet(env, { status: 200, body: { request_id: 'r', transcript: 42 } });
  const next = await talk(env, 'venture.talk.start');
  await assert.rejects(talk(env, 'venture.talk.hear', { sessionId: next.sessionId, audioBase64: wav(2) }), code('SPEECH_FAILED'));
  assert.equal(sent.length, 1);
  assert.deepEqual(listRecords(env.store.read(), 'venture-talk-heard').map(row => [row.costMinor, row.phase]), [['2', 'failed'], ['2', 'failed']]);
  const cleared = await talk(env, 'venture.talk.setup', { clearSarvam: true });
  assert.deepEqual([cleared.sarvam.connected, cleared.listen, env.deps.secrets.has('speech:sarvam-stt')], [false, 'whisper-local', false]);
});

test('reading aloud speaks only receipt-checked text: figures by their receipt, never a number the AI wrote, after the quote', async () => {
  const parts = [
    { kind: 'text' as const, text: 'Clients owe you' },
    { kind: 'figure' as const, receiptId: 'R-1', key: 'total', display: '₹26,200.00' },
    { kind: 'text' as const, text: 'and about' },
    { kind: 'estimate' as const, text: '3' },
    { kind: 'text' as const, text: 'of them are late by 12 days.' },
  ];
  const env = await setup();
  const message = await ventureAction(env.deps, owner, 'admin', 'seed.chief', tx => {
    const ask = tx.put({ ...tx.base('venture-chief-message'), threadId: 'thread_1', from: 'owner', text: 'Who owes me?', parts: [{ kind: 'text', text: 'Who owes me?' }], author: 'owner', callIds: [], receiptIds: [], proposalIds: [], routedTo: null, read: true } as never);
    const answer = tx.put({ ...tx.base('venture-chief-message'), threadId: 'thread_1', from: 'chief', text: '', parts, author: 'template', callIds: [], receiptIds: ['R-1'], proposalIds: [], routedTo: null, read: true } as never);
    return { ask: (ask as { id: string }).id, answer: (answer as { id: string }).id };
  });
  await assert.rejects(talk(env, 'venture.talk.say', { threadId: 'thread_1', messageId: message.ask }), code('TALK_NOT_FOUND'));
  await assert.rejects(talk(env, 'venture.talk.say', { threadId: 'other', messageId: message.answer }), code('TALK_NOT_FOUND'));
  await assert.rejects(talk(env, 'venture.talk.say', { threadId: 'thread_1', messageId: message.answer }, phone), code('APP_APPROVAL_REQUIRED'));
  const planned = await talk(env, 'venture.talk.say', { threadId: 'thread_1', messageId: message.answer });
  assert.equal(planned.spoken, `Clients owe you ₹26,200.00 and about ${ESTIMATE_SAID} ${NUMBER_SAID}`);
  assert.doesNotMatch(planned.spoken, /\b(3|12)\b/);
  assert.deepEqual([planned.quote, planned.audioBase64], [null, null]);
  assert.match(planned.line, /Google Cloud key/);
  assert.equal(spokenFrom(parts, 1, () => false).endsWith('The worked figures are on screen.'), true);

  env.deps.secrets.set('speech:google-tts', GOOGLE_KEY);
  const sent: PinnedTarget[] = [];
  env.deps.net = {
    resolve: async () => [{ address: PUBLIC, family: 4 }],
    send: async target => { sent.push(target); return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ audioContent: Buffer.from('ID3 spoken').toString('base64') })) }; },
  };
  const quoted = await talk(env, 'venture.talk.say', { threadId: 'thread_1', messageId: message.answer });
  assert.equal(quoted.audioBase64, null);
  assert.equal(sent.length, 0, 'the quote comes first; nothing is sent for it');
  assert.equal(quoted.quote.chars, [...planned.spoken].length);
  assert.match(quoted.quote.figure, /^USD \d+\.\d{4}$/);
  const said = await talk(env, 'venture.talk.say', { threadId: 'thread_1', messageId: message.answer, quoted: quoted.quote.textDigest, approvedRateDigest: quoted.quote.rateDigest });
  assert.equal(Buffer.from(said.audioBase64, 'base64').toString(), 'ID3 spoken');
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(Buffer.from(sent[0]!.body as Uint8Array).toString()).input.text, planned.spoken, 'exactly the checked words are sent');
  assert.equal(listRecords(env.store.read(), 'venture-upload').length, 0, 'spoken audio is played, not kept');
});
