import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { SpeechService } from '../runtime/speech.ts';
import type { SpeechProvider } from '../runtime/speech.ts';
import { interpretSpeech } from '../runtime/speech-understood.ts';
import { numberWords, speakFigures, spokenBasisPoints, spokenRupees } from '../runtime/speech-spoken.ts';
import { voicePart } from '../runtime/models-ext/voice-methods.ts';
import { voiceMeters, voiceMonth, voiceUsage } from '../runtime/models-ext/voice-usage.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { Engine } from '../runtime/engine.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// Every transport, process and clock here is injected. No network, no microphone, no real date.
class MemoryStore implements StateStore { state: State = initialState('Voice workspace'); read() { return this.state; } async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); } }
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (name: string) => (e: any) => e?.code === name;
const T0 = Date.parse('2031-01-30T10:00:00.000Z');
function wav() {
  const h = Buffer.alloc(44); h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(44, 4); h.write('WAVE', 8, 'latin1'); h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36, 'latin1'); h.writeUInt32LE(8, 40); return Buffer.concat([h, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])]).toString('base64');
}
const audioBase64 = wav();
const sarvam: SpeechProvider = { id: 'sarvam', kind: 'sarvam-stt', model: 'saaras:v4', language: 'hi-IN', ratePerMinuteMinor: '50', budgetMinor: '100000' };
const whisper: SpeechProvider = { id: 'whisper', kind: 'local-command', command: '/opt/whisper/whisper-cli', model: '/opt/whisper/model.bin' };
const live: SpeechProvider = { id: 'live', kind: 'live-voice', model: 'gpt-4o-transcribe', ratePerMinuteMinor: '1500', budgetMinor: '1000000' };
const noAudio = (state: State) => assert.equal(JSON.stringify(state).includes(audioBase64.slice(0, 40)) || state.modelReceipts.some(r => 'payloadBase64' in r && r.kind === 'speech-preview' && r.status !== 'preview'), false);

function fixture(options: { stdout?: string; exitCode?: number; reply?: (endpoint: string) => { status: number; body: string } } = {}) {
  const store = new MemoryStore(); let at = T0; const calls: string[] = []; const processes: string[] = [];
  const speech = new SpeechService(store);
  const receipts = new Map<string, unknown>();
  const host: ModuleHost = {
    store, services: { speech }, demo: false, directory: '/nowhere',
    options: { clock: () => at,
      speechHttp: async (request: { endpoint: string }) => { calls.push(request.endpoint); return options.reply?.(request.endpoint) ?? { status: 200, body: JSON.stringify({ transcript: 'do lakh ka payment nahi aaya', language_code: 'hi-IN' }) }; },
      speechProcess: async (request: { args: string[] }) => { processes.push(request.args.join(' ')); return { exitCode: options.exitCode ?? 0, stdout: options.stdout ?? 'teen hazaar rupaye bhejo\n', stderr: '' }; } },
    call: async (method: string, payload: Record<string, unknown>) => { assert.equal(method, 'receipts.get'); const r = receipts.get(String(payload.id)); if (!r) throw Object.assign(new Error('missing'), { code: 'RECEIPT_NOT_FOUND' }); return structuredClone(r); },
  };
  const run = (method: string, payload: Record<string, unknown> = {}, ctx: Context = owner): Promise<any> => Promise.resolve(voicePart.methods[method]!.handler(ctx, payload, host));
  return { store, speech, host, run, calls, processes, receipts, tick: (ms: number) => { at += ms; }, now: () => at };
}

test('voice is off by default: only status, usage and providers answer; switching needs the desktop app and an untainted request', async () => {
  const f = fixture();
  const status = await f.run('voice.status');
  assert.deepEqual([status.enabled, status.mode, status.send, status.localOnly, status.provider, status.live, status.speaking], [false, 'off', 'nothing', true, null, null, null]);
  assert.deepEqual(status.usage, { month: '2031-01', providers: [], totals: { minutesMs: 0, costMinor: '0' } });
  assert.ok((await f.run('voice.providers')).providers.some((p: any) => p.kind === 'live-voice'));
  assert.equal((await f.run('voice.usage', { month: '2030-12' })).month, '2030-12');
  for (const [method, payload] of [['voice.start', {}], ['voice.stop', { sessionId: 'voice_session_x' }], ['voice.confirm', { sessionId: 'voice_session_x', digest: 'a'.repeat(64) }],
    ['voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 1000 }], ['voice.speak', { receiptId: 'r' }], ['voice.stopSpeaking', { utteranceId: 'voice_utterance_x' }]] as const)
    await assert.rejects(f.run(method, payload), code('VOICE_OFF'), method);
  await assert.rejects(f.run('voice.setEnabled', { enabled: true }, { ...owner, channel: 'phone' }), code('VOICE_DESKTOP_ONLY'));
  await assert.rejects(f.run('voice.setEnabled', { enabled: true }, { ...owner, sourceTainted: true }), code('VOICE_TAINTED_CONTEXT'));
  await assert.rejects(f.run('voice.setEnabled', { enabled: true, providerId: 'nope' }), code('SPEECH_UNAVAILABLE'));
  await assert.rejects(f.run('voice.setEnabled', { enabled: 'yes' }), code('INVALID_REQUEST'));
  await assert.rejects(f.run('voice.status', { extra: 1 }), code('INVALID_REQUEST'));
  await assert.rejects(f.run('voice.usage', { month: '2031-13' }), code('INVALID_REQUEST'));
  assert.deepEqual(await f.run('voice.setEnabled', { enabled: true }), { enabled: true, providerId: 'browser' });
  const on = await f.run('voice.status');
  assert.deepEqual([on.enabled, on.mode, on.provider], [true, 'browser', { id: 'browser', kind: 'browser-transcript', label: 'Browser transcript', local: true, ratePerMinuteMinor: null }]);
  assert.ok(f.store.state.activity.some(e => e.event === 'voice.settings'));
});

test('browser transcript: heard, understood, confirmed; an edit is re-read; nothing caught is said plainly; minutes not counted', async () => {
  const f = fixture(); await f.run('voice.setEnabled', { enabled: true });
  const started = await f.run('voice.start', {});
  assert.deepEqual([started.capture, started.capMs, started.approval], ['browser-transcript', null, undefined]);
  await assert.rejects(f.run('voice.start', { live: true }), code('VOICE_PROVIDER_MISMATCH'));
  await assert.rejects(f.run('voice.stop', { sessionId: started.sessionId, transcript: 'x', durationMs: 10 }, { ...owner, memberId: 'other' }), code('VOICE_SESSION_NOT_FOUND'));
  const stopped = await f.run('voice.stop', { sessionId: started.sessionId, transcript: 'do lakh ka payment nahi aaya', durationMs: 4000 });
  assert.equal(stopped.heard, 'do lakh ka payment nahi aaya'); assert.equal(stopped.needsConfirmation, true);
  assert.equal(stopped.understood.understood, '2,00,000 ka payment nahi aaya'); assert.deepEqual(stopped.understood.negations.map((n: any) => n.text), ['nahi']);
  assert.equal(stopped.understood.receiptId, stopped.receiptId);
  await assert.rejects(f.run('voice.stop', { sessionId: started.sessionId, transcript: 'again', durationMs: 10 }), code('VOICE_SESSION_CLOSED'));
  await assert.rejects(f.run('voice.confirm', { sessionId: started.sessionId, digest: 'b'.repeat(64) }), code('UNDERSTOOD_CHANGED'));
  // The person changes "nahi aaya" to "aaya": the old digest no longer matches; the digest of the re-read edit does.
  const edited = 'do lakh ka payment aaya';
  await assert.rejects(f.run('voice.confirm', { sessionId: started.sessionId, digest: stopped.understood.digest, text: edited }), code('UNDERSTOOD_CHANGED'));
  const confirmed = await f.run('voice.confirm', { sessionId: started.sessionId, digest: interpretSpeech(edited).digest, text: edited });
  assert.equal(confirmed.text, edited); assert.equal(confirmed.understood, '2,00,000 ka payment aaya'); assert.match(confirmed.confirmationId, /^speech_confirmation_/);
  await assert.rejects(f.run('voice.confirm', { sessionId: started.sessionId, digest: interpretSpeech(edited).digest }), code('VOICE_NOTHING_HEARD'));
  const stored = (f.store.state.extensions as any)['models-ext'].speech.confirmations.at(-1);
  assert.deepEqual([stored.edited, stored.receiptId], [true, stopped.receiptId]);

  const quiet = await f.run('voice.start', {});
  const nothing = await f.run('voice.stop', { sessionId: quiet.sessionId, transcript: '  ', durationMs: 2000 });
  assert.deepEqual([nothing.heard, nothing.understood, nothing.words], [null, null, 'Not sure what was said.']);
  const unclear = await f.run('voice.start', {});
  assert.equal((await f.run('voice.stop', { sessionId: unclear.sessionId, transcript: 'do lakh [inaudible]', durationMs: 2000 })).words, 'Not sure what was said.');
  const usage = await f.run('voice.usage', {});
  assert.deepEqual(usage.providers, [{ providerId: 'browser', kind: 'browser-transcript', minutes: 'not counted', minutesMs: 'not counted', costMinor: 'not counted', basis: 'browser-text-only' }]);
  assert.deepEqual(usage.totals, { minutesMs: 0, costMinor: 'not counted' });
});

test('local whisper: a dropped note is turned into text on this computer and its audio is gone after success and failure', async () => {
  const f = fixture(); await f.speech.configure(owner, whisper); await f.run('voice.setEnabled', { enabled: true, providerId: 'whisper' });
  assert.equal((await f.run('voice.status')).mode, 'local');
  const note = await f.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 90000 });
  assert.equal(note.heard, 'teen hazaar rupaye bhejo'); assert.equal(note.understood.numbers[0].paise, '300000'); assert.equal(f.processes.length, 1);
  noAudio(f.store.state); const receipt = f.store.state.modelReceipts.find(r => r.id === note.receiptId);
  assert.deepEqual([receipt.status, receipt.audioDropped, 'payloadBase64' in receipt, typeof receipt.digest], ['completed', true, false, 'string']);
  await assert.rejects(f.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 1000, providerId: 'browser' }), code('VOICE_PROVIDER_MISMATCH'));
  await assert.rejects(f.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 1000, extra: 1 }), code('INVALID_REQUEST'));
  // A recording session through start/stop works the same way.
  const session = await f.run('voice.start', {}); assert.deepEqual([session.capture, session.capMs], ['record-audio', 300000]);
  assert.equal((await f.run('voice.stop', { sessionId: session.sessionId, audioBase64, mimeType: 'audio/wav', durationMs: 30000 })).heard, 'teen hazaar rupaye bhejo');
  const usage = await f.run('voice.usage', {});
  assert.deepEqual(usage.providers, [{ providerId: 'whisper', kind: 'local-command', minutes: '2', minutesMs: 120000, costMinor: '0', basis: 'local-free' }]);

  for (const [failing, expected] of [[fixture({ exitCode: 1 }), 'SPEECH_FAILED'], [fixture({ stdout: '   ' }), null]] as const) {
    await failing.speech.configure(owner, whisper); await failing.run('voice.setEnabled', { enabled: true, providerId: 'whisper' });
    const attempt = failing.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 1000 });
    if (expected) await assert.rejects(attempt, code(expected));
    else assert.deepEqual([(await attempt).heard, (await attempt).words], [null, 'Not sure what was said.']);
    assert.equal(failing.processes.length, 1); noAudio(failing.store.state);
    assert.ok(failing.store.state.modelReceipts.every(r => !('payloadBase64' in r)));
  }
});

test('Send nothing or shape keeps voice on this computer: cloud providers refuse VOICE_LOCAL_ONLY', async () => {
  const f = fixture(); await f.speech.configure(owner, sarvam, 'sarvam-key'); await f.speech.configure(owner, live, 'live-key');
  await f.run('voice.setEnabled', { enabled: true, providerId: 'sarvam' });
  for (const send of ['nothing', 'shape'] as const) {
    f.store.state.policy.send = send; assert.equal((await f.run('voice.status')).localOnly, true);
    await assert.rejects(f.run('voice.start', {}), code('VOICE_LOCAL_ONLY'));
    await assert.rejects(f.run('voice.start', { providerId: 'live', live: true }), code('VOICE_LOCAL_ONLY'));
    await assert.rejects(f.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 1000 }), code('VOICE_LOCAL_ONLY'));
  }
  assert.equal((await f.run('voice.start', { providerId: 'browser' })).capture, 'browser-transcript');
  assert.equal(f.calls.length, 0);
});

test('paid upload: the exact recording is approved before it leaves, costs are counted, unsent recordings expire without audio', async () => {
  const f = fixture(); f.store.state.policy.send = 'samples'; await f.speech.configure(owner, sarvam, 'sarvam-key'); await f.run('voice.setEnabled', { enabled: true, providerId: 'sarvam' });
  assert.deepEqual((await f.run('voice.status')).provider, { id: 'sarvam', kind: 'sarvam-stt', label: null, local: false, ratePerMinuteMinor: '50' });
  const note = await f.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 12000 });
  assert.equal(note.heard, null); assert.equal(note.approval.costCapMinor, '10'); assert.match(note.approval.digest, /^[a-f0-9]{64}$/); assert.equal(f.calls.length, 0);
  await assert.rejects(f.run('voice.stop', { sessionId: note.sessionId }), code('OUTBOUND_APPROVAL_REQUIRED'));
  const approval = await f.speech.approve(owner, note.approval.previewId);
  const heard = await f.run('voice.stop', { sessionId: note.sessionId, approvalId: approval.id });
  assert.equal(heard.heard, 'do lakh ka payment nahi aaya'); assert.equal(f.calls.length, 1); noAudio(f.store.state);
  assert.deepEqual((await f.run('voice.usage', {})).providers, [{ providerId: 'sarvam', kind: 'sarvam-stt', minutes: '1', minutesMs: 12000, costMinor: '10', basis: 'recorded-length-at-rate' }]);
  // A recording never approved: after ten idle minutes the session expires and the audio goes, digest kept.
  const pending = await f.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 6000 });
  assert.ok('payloadBase64' in f.store.state.modelReceipts.find(r => r.id === pending.approval.previewId));
  f.tick(600000); await f.run('voice.status');
  const expired = f.store.state.modelReceipts.find(r => r.id === pending.approval.previewId);
  assert.deepEqual([expired.status, 'payloadBase64' in expired, expired.digest], ['expired', false, pending.approval.digest]);
  await assert.rejects(f.run('voice.stop', { sessionId: pending.sessionId, approvalId: 'speech_approval_x' }), code('VOICE_SESSION_CLOSED'));
  // A provider failure is refused once and keeps no audio.
  const broken = fixture({ reply: () => ({ status: 500, body: '' }) }); broken.store.state.policy.send = 'samples'; await broken.speech.configure(owner, sarvam, 'k'); await broken.run('voice.setEnabled', { enabled: true, providerId: 'sarvam' });
  const b = await broken.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 6000 });
  await assert.rejects(broken.run('voice.stop', { sessionId: b.sessionId, approvalId: (await broken.speech.approve(owner, b.approval.previewId)).id }), code('SPEECH_FAILED'));
  assert.ok(broken.store.state.modelReceipts.every(r => !('payloadBase64' in r))); assert.equal(broken.calls.length, 1);
});

test('a speech key given again keeps the revision, so a recording prepared before still sends; the key never enters state', async () => {
  const f = fixture(); f.store.state.policy.send = 'samples'; await f.speech.configure(owner, sarvam); await f.run('voice.setEnabled', { enabled: true, providerId: 'sarvam' });
  const note = await f.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 6000 });
  const approval = await f.speech.approve(owner, note.approval.previewId);
  await assert.rejects(f.run('voice.stop', { sessionId: note.sessionId, approvalId: approval.id }), code('CREDENTIAL_REQUIRED'));
  await assert.rejects(f.run('modelsx.speechKey', { providerId: 'sarvam', secret: 'resupplied-key' }, { ...owner, channel: 'phone' }), code('SPEECH_KEY_APP_ONLY'));
  await assert.rejects(f.run('modelsx.speechKey', { providerId: 'sarvam', secret: 'resupplied-key' }, { ...owner, sourceTainted: true }), code('SPEECH_KEY_APP_ONLY'));
  await assert.rejects(f.run('modelsx.speechKey', { providerId: 'browser', secret: 'k' }), code('INVALID_CREDENTIAL'));
  await assert.rejects(f.run('modelsx.speechKey', { providerId: 'sarvam', secret: 'two\nlines' }), code('INVALID_CREDENTIAL'));
  const supplied = await f.run('modelsx.speechKey', { providerId: 'sarvam', secret: 'resupplied-key' });
  assert.deepEqual(supplied, { providerId: 'sarvam', credentialConfigured: true, revision: 1, enabled: true });
  assert.equal((await f.speech.providers(owner)).find((p: any) => p.id === 'sarvam')!.revision, 1);
  const heard = await f.run('voice.stop', { sessionId: note.sessionId, approvalId: approval.id });
  assert.equal(heard.heard, 'do lakh ka payment nahi aaya');
  assert.equal(JSON.stringify(f.store.state).includes('resupplied-key'), false);
  const event = f.store.state.activity.find(e => e.event === 'speech.provider.key-supplied')!;
  assert.deepEqual(event.details, { id: 'sarvam', kind: 'sarvam-stt', revision: 1 });
});

test('live voice runs only through voice.start: the session is recorded, closed at stop or at the cap, and charged at most the cap', async () => {
  const secret = { value: 'ek_live_secret_value_123', expires_at: Math.floor(T0 / 1000) + 60 };
  const f = fixture({ reply: () => ({ status: 200, body: JSON.stringify(secret) }) }); f.store.state.policy.send = 'samples';
  await f.speech.configure(owner, live, 'sk-live'); await f.run('voice.setEnabled', { enabled: true, providerId: 'live' });
  await assert.rejects(f.run('voice.start', {}), code('VOICE_PROVIDER_MISMATCH'));
  await assert.rejects(f.run('voice.start', { live: true, capMs: 1800001 }), code('INVALID_LIVE_CAP'));
  await assert.rejects(f.run('voice.start', { live: true }, { ...owner, channel: 'phone' }), code('VOICE_DESKTOP_ONLY'));
  // The core path is still refused: no trusted flag reaches SpeechService from a request.
  await assert.rejects(f.speech.preview(owner, { providerId: 'live', durationMs: 60000 }), code('LIVE_VOICE_CAP_NOT_ENFORCED'));
  const started = await f.run('voice.start', { live: true, capMs: 120000 });
  assert.deepEqual([started.capture, started.capMs, started.approval.costCapMinor], ['live-session', 120000, '3000']);
  await assert.rejects(f.run('voice.start', { live: true }), code('VOICE_LIVE_BUSY'));
  await assert.rejects(f.speech.transcribe(owner, { previewId: started.approval.previewId, approvalId: (await f.speech.approve(owner, started.approval.previewId)).id }), code('LIVE_VOICE_CAP_NOT_ENFORCED'));
  const approval = await f.speech.approve(owner, started.approval.previewId);
  const opened = await f.run('voice.start', { sessionId: started.sessionId, approvalId: approval.id });
  assert.deepEqual(opened.live, { clientSecret: secret.value, expiresAt: new Date(secret.expires_at * 1000).toISOString(), connectEndpoint: 'https://api.openai.com/v1/realtime/calls', model: 'gpt-4o-transcribe', capMs: 120000, endsAt: new Date(T0 + 120000).toISOString() });
  assert.equal(JSON.stringify(f.store.state).includes(secret.value), false);
  assert.deepEqual((await f.run('voice.status')).live, { sessionId: started.sessionId, startedAt: new Date(T0).toISOString(), capMs: 120000, endsAt: new Date(T0 + 120000).toISOString() });
  await assert.rejects(f.run('voice.start', { sessionId: started.sessionId, approvalId: approval.id }), code('VOICE_SESSION_CLOSED'));
  f.tick(30000);
  const stopped = await f.run('voice.stop', { sessionId: started.sessionId, transcript: 'do lakh ka payment nahi aaya', durationMs: 30000 });
  assert.deepEqual(stopped.live, { minutesMs: 30000, costMinor: '750', closedBy: 'stop' }); assert.equal(stopped.heard, 'do lakh ka payment nahi aaya');
  assert.equal((await f.run('voice.confirm', { sessionId: started.sessionId, digest: stopped.understood.digest })).text, 'do lakh ka payment nahi aaya');

  // No stop arrives: the next voice call closes the session at endsAt and charges the cap.
  const second = await f.run('voice.start', { live: true, capMs: 60000 });
  await f.run('voice.start', { sessionId: second.sessionId, approvalId: (await f.speech.approve(owner, second.approval.previewId)).id });
  f.tick(60000 + 300000);
  assert.equal((await f.run('voice.status')).live, null);
  const receipt = f.store.state.modelReceipts.find(r => r.id === second.approval.previewId);
  assert.deepEqual([receipt.liveMinutesMs, receipt.liveChargedMinor, receipt.liveClosedBy, receipt.costReservedMinor], [60000, '1500', 'cap', '1500']);
  // The renderer's own stop after its hang-up still hands over the words, once, and cannot add minutes.
  const late = await f.run('voice.stop', { sessionId: second.sessionId, transcript: 'teen hazaar', durationMs: 999999 });
  assert.deepEqual(late.live, { minutesMs: 60000, costMinor: '1500', closedBy: 'cap' }); assert.equal(late.heard, 'teen hazaar');
  await assert.rejects(f.run('voice.stop', { sessionId: second.sessionId, transcript: 'x', durationMs: 1 }), code('VOICE_SESSION_CLOSED'));
  const usage = await f.run('voice.usage', {});
  assert.deepEqual(usage.providers, [{ providerId: 'live', kind: 'live-voice', minutes: '2', minutesMs: 90000, costMinor: '2250', basis: 'live-minutes-at-rate' }]);
  // Turning voice off ends an open session at once.
  const third = await f.run('voice.start', { live: true, capMs: 60000 });
  await f.run('voice.start', { sessionId: third.sessionId, approvalId: (await f.speech.approve(owner, third.approval.previewId)).id });
  f.tick(10000); await f.run('voice.setEnabled', { enabled: false });
  assert.equal(f.store.state.modelReceipts.find(r => r.id === third.approval.previewId).liveMinutesMs, 10000);
  assert.equal(f.calls.length, 3); noAudio(f.store.state);
});

test('speak: every number comes from the receipt figures, in Indian words for en and hi, never from written text', async () => {
  const f = fixture(); await f.run('voice.setEnabled', { enabled: true });
  f.receipts.set('calc_1', { id: 'calc_1', explanation: 'You billed 999 and 12345 last week.', allowedNumbers: ['999'], stale: false,
    figures: [{ key: 'value', label: 'Billed', minor: '20000000', display: '₹2,00,000', unit: 'money', currency: 'INR' },
      { key: 'marginBps', label: 'Margin in basis points (truncated)', minor: '1205', display: '1205 bps', unit: 'basis-points' },
      { key: 'odd', label: 'Top 5 customers', minor: '12345678', display: '₹1,23,456.78', unit: 'money', currency: 'INR' }] });
  const hi = await f.run('voice.speak', { receiptId: 'calc_1', language: 'hi' });
  assert.deepEqual(hi.segments, [
    { text: 'Billed: do lakh rupaye.', figureKey: 'value' },
    { text: 'Margin in basis points (truncated): barah dashamlav shunya paanch pratishat.', figureKey: 'marginBps' },
    { text: 'Aankda: ek lakh teis hazaar chaar sau chhappan rupaye aur athattar paise.', figureKey: 'odd' }]);
  const en = await f.run('voice.speak', { receiptId: 'calc_1' });
  assert.equal(en.language, 'en'); assert.equal(en.segments[0].text, 'Billed: two lakh rupees.');
  assert.equal(en.segments[2].text, 'Figure: one lakh twenty-three thousand four hundred fifty-six rupees and seventy-eight paise.');
  for (const segment of [...hi.segments, ...en.segments]) assert.doesNotMatch(segment.text, /\d/);
  assert.deepEqual((await f.run('voice.status')).speaking, { utteranceId: en.utteranceId });
  assert.deepEqual(await f.run('voice.stopSpeaking', { utteranceId: en.utteranceId }), { stopped: true });
  assert.equal((await f.run('voice.status')).speaking, null);
  await assert.rejects(f.run('voice.speak', { receiptId: 'calc_1', language: 'fr' }), code('INVALID_REQUEST'));
  await assert.rejects(f.run('voice.speak', { receiptId: 'missing' }), code('RECEIPT_NOT_FOUND'));
  assert.deepEqual(speakFigures({ figures: [], stale: true }, 'en'), [{ text: 'These figures are out of date.' }, { text: 'This answer has no figures to read aloud.' }]);
});

test('spoken amounts read back to the same figure through "what it understood"', () => {
  const rupees = ['1', '7', '23', '99', '100', '105', '999', '1000', '2500', '45678', '100000', '175000', '200000', '1234567', '9999999', '10000000', '123456789', '99999999999'];
  for (const language of ['en', 'hi'] as const) for (const value of rupees) {
    const spoken = spokenRupees(`${value}00`, language); const read = interpretSpeech(spoken);
    assert.equal(read.numbers.length, 1, `${language} ${spoken}`); assert.equal(read.numbers[0]!.paise, `${value}00`, `${language} ${spoken}`);
  }
  assert.equal(spokenRupees('20000000', 'hi'), 'do lakh rupaye'); assert.equal(spokenRupees('100', 'hi'), 'ek rupaya'); assert.equal(spokenRupees('50', 'en'), 'fifty paise');
  assert.equal(spokenRupees('-250000', 'en'), 'minus two thousand five hundred rupees'); assert.equal(spokenRupees('0', 'hi'), 'shunya rupaye');
  assert.equal(numberWords(1234567890123n, 'en'), 'one lakh twenty-three thousand four hundred fifty-six crore seventy-eight lakh ninety thousand one hundred twenty-three');
  assert.equal(spokenBasisPoints('-50', 'en'), 'minus zero point five percent'); assert.throws(() => spokenRupees('1.5', 'en'), code('INVALID_MINOR_UNITS'));
});

test('usage is per provider per India-time month from speech receipts, on the injected clock only', async () => {
  const f = fixture(); await f.speech.configure(owner, whisper); await f.run('voice.setEnabled', { enabled: true, providerId: 'whisper' });
  await f.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 60000 });
  f.tick(2 * 86400000); // 2031-02-01, India time
  await f.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 45000 });
  await f.run('voice.dropNote', { audioBase64, mimeType: 'audio/wav', durationMs: 15000 });
  assert.equal((await f.run('voice.usage', {})).month, '2031-02');
  assert.deepEqual((await f.run('voice.usage', { month: '2031-01' })).totals, { minutesMs: 60000, costMinor: '0' });
  assert.deepEqual((await f.run('voice.usage', { month: '2031-02' })).totals, { minutesMs: 60000, costMinor: '0' });
  assert.deepEqual((await f.run('voice.usage', { month: '2031-03' })).providers, []);
  assert.deepEqual(voiceMeters(f.store.state, '2031-02'), { voiceMinutesMs: 60000, voiceCostMinor: '0' });
  assert.equal(voiceMonth(Date.parse('2031-01-31T18:29:59.999Z')), '2031-01'); assert.equal(voiceMonth(Date.parse('2031-01-31T18:30:00.000Z')), '2031-02');
  // A receipt from the core speech methods counts by its own completion time; a missing figure is never zero.
  const state = initialState('x'); state.modelReceipts.push({ id: 'r1', kind: 'speech-preview', status: 'completed', providerId: 'sarvam', providerKind: 'sarvam-stt', completedAt: '2031-05-10T00:00:00.000Z', durationMs: 30000, costReservedMinor: '25' },
    { id: 'r2', kind: 'speech-preview', status: 'failed', providerId: 'sarvam', providerKind: 'sarvam-stt', completedAt: '2031-05-10T00:00:00.000Z', durationMs: 30000, costReservedMinor: '25' },
    { id: 'r3', kind: 'speech-preview', status: 'completed', providerId: 'live', providerKind: 'live-voice', createdAt: '2031-05-10T00:00:00.000Z' });
  assert.deepEqual(voiceUsage(state, '2031-05').providers, [{ providerId: 'sarvam', kind: 'sarvam-stt', minutes: '1', minutesMs: 30000, costMinor: '25', basis: 'recorded-length-at-rate' }]);
});

test('engine: voice end to end on synthetic production storage, through the real module and calculator', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-'));
  let at = T0; const secret = { value: 'ek_engine_live_secret_1', expires_at: Math.floor(T0 / 1000) + 60 };
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock),
    modules: { 'models-ext': { clock: () => at, speechHttp: async () => ({ status: 200, body: JSON.stringify(secret) }) } } });
  try {
    await engine.request('workspace.create', { name: 'Test Shop', passphrase: 'correct horse battery staple 42', demo: false, pack: 'ecommerce' });
    await assert.rejects(engine.request('voice.start', {}), code('VOICE_OFF'));
    assert.equal((await engine.request('voice.status', {})).enabled, false);
    await engine.request('voice.setEnabled', { enabled: true });
    const started = await engine.request('voice.start', {});
    const heard = await engine.request('voice.stop', { sessionId: started.sessionId, transcript: 'do lakh ka bill nahi bhejo', durationMs: 3000 });
    assert.equal(heard.understood.understood, '2,00,000 ka bill nahi bhejo');
    const confirmed = await engine.request('voice.confirm', { sessionId: started.sessionId, digest: heard.understood.digest });
    assert.equal(confirmed.text, 'do lakh ka bill nahi bhejo');
    // A real calculator receipt is read aloud from its own figures.
    await engine.request('ontology.publish', { pack: 'ecommerce' });
    const csv = 'id,kind,date,amount,currency,customerId,invoiceId\ninvoice-a,invoice,2031-01-02,200000.00,INR,customer-a,invoice-a\n';
    const recipe = { version: 1, id: 'voice-test-v1', system: 'voice-csv', edition: '1', scope: { company: 'Test Shop', branches: ['main'] },
      bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' }, { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'customerId', source: 'customerId', type: 'string', nulls: 'omit' }, { target: 'invoiceId', source: 'invoiceId', type: 'string', nulls: 'omit' }],
      allowedKinds: ['invoice'], allowedStatuses: [], onUnmapped: 'reject' };
    await engine.request('sources.import', { sourceId: 'voice-export', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 1, amountMinor: '20000000' } });
    const receipt = await engine.request('calculation.run', { operation: 'billed', period: { from: '2031-01-01', to: '2031-01-31' } });
    assert.equal(receipt.valueMinor, '20000000');
    const spoken = await engine.request('voice.speak', { receiptId: receipt.id, language: 'hi' });
    const valueSegment = spoken.segments.find((s: any) => receipt.figures.some((fig: any) => fig.key === s.figureKey && fig.minor === '20000000'));
    assert.match(valueSegment.text, /do lakh rupaye/);
    assert.deepEqual(await engine.request('voice.stopSpeaking', { utteranceId: spoken.utteranceId }), { stopped: true });
    // Live voice: approved, recorded, closed at the cap without a stop.
    await engine.request('trust.update', { send: 'samples' });
    await engine.request('speech.configure', { config: live, secret: 'sk-engine-live' });
    await assert.rejects(engine.request('speech.preview', { providerId: 'live', durationMs: 60000 }), code('LIVE_VOICE_CAP_NOT_ENFORCED'));
    await engine.request('voice.setEnabled', { enabled: true, providerId: 'live' });
    const session = await engine.request('voice.start', { live: true, capMs: 60000 });
    const approval = await engine.request('speech.approve', { id: session.approval.previewId });
    const opened = await engine.request('voice.start', { sessionId: session.sessionId, approvalId: approval.id });
    assert.equal(opened.live.clientSecret, secret.value); assert.equal(opened.live.endsAt, new Date(T0 + 60000).toISOString());
    at += 120000;
    const status = await engine.request('voice.status', {});
    assert.equal(status.live, null); assert.equal(status.mode, 'paid');
    assert.deepEqual(status.usage.providers.find((p: any) => p.providerId === 'live'), { providerId: 'live', kind: 'live-voice', minutes: '1', minutesMs: 60000, costMinor: '1500', basis: 'live-minutes-at-rate' });
    const supplied = await engine.request('modelsx.speechKey', { providerId: 'live', secret: 'sk-engine-live-2' });
    assert.equal(supplied.revision, (await engine.request('speech.list', {})).find((p: any) => p.id === 'live').revision);
    const snapshot = JSON.stringify((engine as any).store().read());
    for (const hidden of [secret.value, 'sk-engine-live', 'sk-engine-live-2']) assert.equal(snapshot.includes(hidden), false);
    await engine.request('workspace.lock', {});
  } finally { await engine.close?.(); await rm(directory, { recursive: true, force: true }); }
});
