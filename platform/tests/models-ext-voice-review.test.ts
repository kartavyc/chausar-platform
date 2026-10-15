import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, rm, symlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { SPEECH_IN_FLIGHT_MS, SpeechService, removeStaleSpeechDirs } from '../runtime/speech.ts';
import type { SpeechProvider } from '../runtime/speech.ts';
import { interpretSpeech } from '../runtime/speech-understood.ts';
import { speakFigures } from '../runtime/speech-spoken.ts';
import { voicePart } from '../runtime/models-ext/voice-methods.ts';
import { voiceMeters, voiceMonth, voiceUsage } from '../runtime/models-ext/voice-usage.ts';
import { monthOf as routesMonthOf } from '../runtime/models-ext/routes-methods.ts';
import { monthOf, validZone, workspaceZone } from '../runtime/models-ext/months.ts';
import { modelsExtHostOptions } from '../runtime/models-ext/host-options.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

// Review regressions for the voice part. Every clock, transport and process is injected; no test reads today's date.
class MemoryStore implements StateStore { state: State = initialState('Voice review'); read() { return this.state; } async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); } }
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (name: string) => (e: any) => e?.code === name;
const T0 = Date.parse('2031-01-30T10:00:00.000Z');
const secret = { value: 'ek_review_secret_value_1', expires_at: Math.floor(T0 / 1000) + 60 };
const live: SpeechProvider = { id: 'live', kind: 'live-voice', model: 'gpt-4o-transcribe', ratePerMinuteMinor: '1500', budgetMinor: '1000000' };
const whisper: SpeechProvider = { id: 'whisper', kind: 'local-command', command: '/opt/whisper/whisper-cli', model: '/opt/whisper/model.bin' };

function fixture(options: { onDevice?: boolean; liveClient?: boolean; store?: MemoryStore } = {}) {
  const store = options.store ?? new MemoryStore(); let at = T0; let mono = 1000; let calls = 0;
  const speech = new SpeechService(store); const receipts = new Map<string, unknown>();
  const host: ModuleHost = {
    store, services: { speech }, demo: false, directory: '/nowhere',
    options: { clock: () => at, monotonic: () => mono, ...(options.onDevice ? { browserSpeechOnDevice: true } : {}), ...(options.liveClient === false ? {} : { liveVoiceClient: true }),
      speechHttp: async () => { calls++; return { status: 200, body: JSON.stringify(secret) }; },
      speechProcess: async () => ({ exitCode: 0, stdout: 'teen hazaar rupaye\n', stderr: '' }) },
    call: async (_method: string, payload: Record<string, unknown>) => structuredClone(receipts.get(String(payload.id))),
  };
  const run = (method: string, payload: Record<string, unknown> = {}, ctx: Context = owner): Promise<any> => Promise.resolve(voicePart.methods[method]!.handler(ctx, payload, host));
  return { store, speech, host, run, receipts, calls: () => calls, tick: (ms: number) => { at += ms; mono += ms; }, shiftWall: (ms: number) => { at += ms; } };
}
async function openLive(f: ReturnType<typeof fixture>, capMs: number) {
  const started = await f.run('voice.start', { live: true, capMs });
  await f.run('voice.start', { sessionId: started.sessionId, approvalId: (await f.speech.approve(owner, started.approval.previewId)).id });
  return started;
}
const receiptOf = (f: ReturnType<typeof fixture>, id: string) => f.store.state.modelReceipts.find(r => r.id === id)!;

test('live voice: an early stop keeps the approved cap reserved for the budget; measured minutes go to usage only', async () => {
  const f = fixture(); f.store.state.policy.send = 'samples';
  await f.speech.configure(owner, { ...live, budgetMinor: '4000' }, 'sk'); await f.run('voice.setEnabled', { enabled: true, providerId: 'live' });
  const first = await openLive(f, 120000); // cap cost 3000 of a 4000 budget
  const stopped = await f.run('voice.stop', { sessionId: first.sessionId });
  assert.deepEqual(stopped.live, { minutesMs: 0, costMinor: '0', closedBy: 'stop' });
  const r = receiptOf(f, first.approval.previewId);
  assert.deepEqual([r.costReservedMinor, r.liveChargedMinor, r.liveMinutesMs], ['3000', '0', 0]);
  // The WebRTC call may still be running: a second capped session would pass the budget only if the stop had freed it.
  const second = await f.run('voice.start', { live: true, capMs: 120000 });
  await assert.rejects(f.run('voice.start', { sessionId: second.sessionId, approvalId: (await f.speech.approve(owner, second.approval.previewId)).id }), code('BUDGET_EXCEEDED'));
  assert.equal(f.calls(), 1);
});

test('live voice minutes run on the monotonic clock: moving the system clock neither erases nor adds minutes', async () => {
  const f = fixture(); f.store.state.policy.send = 'samples';
  await f.speech.configure(owner, live, 'sk'); await f.run('voice.setEnabled', { enabled: true, providerId: 'live' });
  const back = await openLive(f, 300000);
  f.tick(30000); f.shiftWall(-3600000); // the system clock is moved back an hour mid-call
  assert.deepEqual((await f.run('voice.stop', { sessionId: back.sessionId })).live, { minutesMs: 30000, costMinor: '750', closedBy: 'stop' });
  f.shiftWall(3600000);
  const ahead = await openLive(f, 120000);
  f.shiftWall(86400000); // forward a day: the session is not closed at its cap early, and not charged a day
  assert.equal((await f.run('voice.status')).live?.sessionId, ahead.sessionId);
  f.tick(119999); assert.equal((await f.run('voice.status')).live?.sessionId, ahead.sessionId);
  f.tick(1); assert.equal((await f.run('voice.status')).live, null);
  assert.deepEqual([receiptOf(f, ahead.approval.previewId).liveMinutesMs, receiptOf(f, ahead.approval.previewId).liveClosedBy, receiptOf(f, ahead.approval.previewId).costReservedMinor], [120000, 'cap', '3000']);
});

test('after a restart the monotonic origin is gone: wall clock, never below zero and never below one secret lifetime', async () => {
  const f = fixture(); f.store.state.policy.send = 'samples';
  await f.speech.configure(owner, live, 'sk'); await f.run('voice.setEnabled', { enabled: true, providerId: 'live' });
  const a = await openLive(f, 300000); const b = await openLive(f, 300000).catch(e => e);
  assert.equal(b.code, 'VOICE_LIVE_BUSY');
  // A new engine on the same workspace: a new SpeechService, so no origin for the session.
  const restarted = fixture({ store: f.store }); await restarted.speech.configure(owner, live, 'sk');
  restarted.shiftWall(-7200000);
  const stopped = await restarted.run('voice.stop', { sessionId: a.sessionId });
  assert.deepEqual(stopped.live, { minutesMs: 60000, costMinor: '1500', closedBy: 'stop' });
  assert.equal(receiptOf(f, a.approval.previewId).costReservedMinor, '7500');
  restarted.shiftWall(7200000); const c = await openLive(restarted, 300000);
  const again = fixture({ store: f.store }); again.shiftWall(90000);
  assert.deepEqual((await again.run('voice.stop', { sessionId: c.sessionId })).live, { minutesMs: 90000, costMinor: '2250', closedBy: 'stop' });
});

test('live voice needs the trusted desktop live client; the installed app sets it, demo and other hosts do not', async () => {
  const f = fixture({ liveClient: false }); f.store.state.policy.send = 'samples';
  await f.speech.configure(owner, live, 'sk'); await f.run('voice.setEnabled', { enabled: true, providerId: 'live' });
  await assert.rejects(f.run('voice.start', { live: true, capMs: 60000 }), code('LIVE_VOICE_CAP_NOT_ENFORCED'));
  assert.equal(f.store.state.modelReceipts.length, 0); assert.equal(f.calls(), 0);
  // A session prepared while the client was trusted cannot be opened by a host that is not.
  const trusted = fixture({ store: f.store }); await trusted.speech.configure(owner, live, 'sk');
  const started = await trusted.run('voice.start', { live: true, capMs: 60000 });
  const untrusted = fixture({ store: f.store, liveClient: false }); await untrusted.speech.configure(owner, live, 'sk');
  await assert.rejects(untrusted.run('voice.start', { sessionId: started.sessionId, approvalId: (await untrusted.speech.approve(owner, started.approval.previewId)).id }), code('LIVE_VOICE_CAP_NOT_ENFORCED'));
  assert.equal(untrusted.calls(), 0);
  assert.equal(modelsExtHostOptions({ directory: '/x', demo: false, env: { ELECTRON_RUN_AS_NODE: '1' } }).liveVoiceClient, true);
  assert.equal(modelsExtHostOptions({ directory: '/x', demo: true, env: { ELECTRON_RUN_AS_NODE: '1' } }).liveVoiceClient, undefined);
  assert.equal(modelsExtHostOptions({ directory: '/x', demo: false, env: {} }).liveVoiceClient, undefined);
});

test('two live starts at once: one session is recorded, the other refuses VOICE_LIVE_BUSY; opening re-checks', async () => {
  const f = fixture(); f.store.state.policy.send = 'samples';
  await f.speech.configure(owner, live, 'sk'); await f.run('voice.setEnabled', { enabled: true, providerId: 'live' });
  const results = await Promise.allSettled([f.run('voice.start', { live: true, capMs: 60000 }), f.run('voice.start', { live: true, capMs: 60000 })]);
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'VOICE_LIVE_BUSY');
  assert.equal(f.store.state.modelReceipts.filter(r => r.kind === 'speech-preview').length, 1);
  // Two sessions awaiting approval (written by an earlier version): only one can open.
  const winner = (results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
  const voice = (f.store.state.extensions as any)['models-ext'].voice;
  const twin = { ...structuredClone(voice.sessions.find((s: any) => s.id === winner.sessionId)), id: 'voice_session_legacy' };
  const twinPreview = await f.speech.preview(owner, { providerId: 'live', durationMs: 60000 }, { liveCapEnforced: true }); twin.previewId = twinPreview.id; voice.sessions.push(twin);
  await f.run('voice.start', { sessionId: winner.sessionId, approvalId: (await f.speech.approve(owner, winner.approval.previewId)).id });
  await assert.rejects(f.run('voice.start', { sessionId: twin.id, approvalId: (await f.speech.approve(owner, twinPreview.id)).id }), code('VOICE_LIVE_BUSY'));
  assert.equal(f.calls(), 1); assert.equal(voice.sessions.filter((s: any) => s.status === 'live').length, 1);
});

test('Send nothing or shape: the browser transcript is refused unless the host says it recognises on the device', async () => {
  const f = fixture(); // browser speech may use the network (Chromium Web Speech)
  await assert.rejects(f.run('voice.setEnabled', { enabled: true }), code('VOICE_NO_LOCAL_PROVIDER'));
  await f.speech.configure(owner, whisper);
  assert.deepEqual(await f.run('voice.setEnabled', { enabled: true }), { enabled: true, providerId: 'whisper' });
  assert.deepEqual([(await f.run('voice.status')).mode, (await f.run('voice.status')).provider.local], ['local', true]);
  await f.run('voice.setEnabled', { enabled: true, providerId: 'browser' });
  const blocked = await f.run('voice.status');
  assert.deepEqual([blocked.mode, blocked.blocked, blocked.provider.local, blocked.provider.words], ['off', 'VOICE_LOCAL_ONLY', false,
    'Turned into text by the browser\'s speech service, which may send your voice off this computer. Chausar receives text only.']);
  await assert.rejects(f.run('voice.start', {}), code('VOICE_LOCAL_ONLY'));
  // Samples: allowed, and labelled as may-use-network.
  f.store.state.policy.send = 'samples';
  const open = await f.run('voice.status'); assert.deepEqual([open.mode, open.blocked, open.provider.local], ['browser', null, false]);
  const session = await f.run('voice.start', {});
  f.store.state.policy.send = 'shape'; // changed before the words were handed over
  await assert.rejects(f.run('voice.stop', { sessionId: session.sessionId, transcript: 'do lakh', durationMs: 1000 }), code('VOICE_LOCAL_ONLY'));
  assert.equal(f.store.state.modelReceipts.some(r => r.transcript === 'do lakh'), false);
  // A host whose browser recognises on the device: allowed under nothing, and called local.
  const device = fixture({ onDevice: true });
  assert.deepEqual(await device.run('voice.setEnabled', { enabled: true }), { enabled: true, providerId: 'browser' });
  const s = await device.run('voice.start', {});
  assert.equal((await device.run('voice.stop', { sessionId: s.sessionId, transcript: 'do lakh', durationMs: 1000 })).heard, 'do lakh');
});

test('raw audio: a stuck dispatch, completed receipts and old whisper folders lose their audio', async () => {
  const store = new MemoryStore(); const speech = new SpeechService(store); const at = (ms: number) => new Date(T0 + ms).toISOString();
  const record = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'speech-preview', status, createdAt: at(-3600000), payloadBase64: 'QUJD', digest: 'd', ...extra });
  store.state.modelReceipts.push(record('young-preview', 'preview', { createdAt: at(-1000) }), record('old-preview', 'preview'),
    record('in-flight', 'dispatching', { dispatchedAt: at(-SPEECH_IN_FLIGHT_MS + 1000) }), record('stuck', 'dispatching', { dispatchedAt: at(-SPEECH_IN_FLIGHT_MS) }),
    record('stuck-legacy', 'dispatching'), record('done', 'completed'), record('failed', 'failed'), record('expired', 'expired'));
  assert.equal(await speech.expireUnsent(600000, T0), 6);
  const by = (id: string) => store.state.modelReceipts.find(r => r.id === id)!;
  assert.deepEqual(store.state.modelReceipts.filter(r => 'payloadBase64' in r).map(r => r.id), ['young-preview', 'in-flight']);
  assert.deepEqual([by('old-preview').status, by('stuck').status, by('stuck').errorCode, by('stuck-legacy').status, by('done').status, by('done').audioDropped], ['expired', 'failed', 'SPEECH_INTERRUPTED', 'failed', 'completed', true]);
  // First use of a SpeechService strips audio an earlier version left on completed receipts.
  const legacy = new MemoryStore(); legacy.state.modelReceipts.push(record('old-done', 'completed', { createdAt: new Date().toISOString() }));
  await new SpeechService(legacy).transcribe(owner, { providerId: 'browser', transcript: 'do lakh' });
  assert.equal('payloadBase64' in legacy.state.modelReceipts[0]!, false);
  // Whisper working folders older than an hour go; fresh ones, links and other folders stay.
  const root = await mkdtemp(join(tmpdir(), 'chausar-mx-dirs-'));
  try {
    for (const name of ['chausar-speech-OLD123', 'chausar-speech-NEW123', 'keep-me']) await mkdir(join(root, name));
    await utimes(join(root, 'chausar-speech-OLD123'), (T0 - 7200000) / 1000, (T0 - 7200000) / 1000);
    await utimes(join(root, 'chausar-speech-NEW123'), (T0 - 60000) / 1000, (T0 - 60000) / 1000);
    await utimes(join(root, 'keep-me'), (T0 - 7200000) / 1000, (T0 - 7200000) / 1000);
    await symlink(join(root, 'keep-me'), join(root, 'chausar-speech-LNK123'));
    assert.equal(await removeStaleSpeechDirs(root, T0), 1);
    for (const [name, kept] of [['chausar-speech-OLD123', false], ['chausar-speech-NEW123', true], ['keep-me', true], ['chausar-speech-LNK123', true]] as const)
      assert.equal(await lstat(join(root, name)).then(() => true, () => false), kept, name);
    assert.equal(await removeStaleSpeechDirs(join(root, 'missing'), T0), 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('voice.confirm runs only in the desktop app from an untainted request, and says whether the words were edited', async () => {
  const f = fixture({ onDevice: true }); await f.run('voice.setEnabled', { enabled: true });
  const s = await f.run('voice.start', {});
  const heard = await f.run('voice.stop', { sessionId: s.sessionId, transcript: 'do lakh ka payment nahi aaya', durationMs: 1000 });
  const edit = 'bees lakh ka payment bhejo';
  await assert.rejects(f.run('voice.confirm', { sessionId: s.sessionId, digest: interpretSpeech(edit).digest, text: edit }, { ...owner, channel: 'mcp', sourceTainted: true } as Context), code('VOICE_DESKTOP_ONLY'));
  await assert.rejects(f.run('voice.confirm', { sessionId: s.sessionId, digest: interpretSpeech(edit).digest, text: edit }, { ...owner, sourceTainted: true }), code('VOICE_TAINTED_CONTEXT'));
  const confirmed = await f.run('voice.confirm', { sessionId: s.sessionId, digest: heard.understood.digest });
  assert.deepEqual([confirmed.edited, confirmed.text], [false, 'do lakh ka payment nahi aaya']);
});

test('voice.speak: a stale answer is said first; labels are fixed per key and operation; units are the figure\'s own', async () => {
  const f = fixture({ onDevice: true }); await f.run('voice.setEnabled', { enabled: true });
  f.receipts.set('calc_2', { id: 'calc_2', operation: 'billed', stale: false, explanation: 'ignored',
    figures: [{ key: 'total', label: 'Ninety nine problems, top 5', minor: '20000000', display: '₹2,00,000', unit: 'money', currency: 'INR' },
      { key: 'changeBps', label: 'Change in basis points (truncated)', minor: '-50', display: '-50 bps', unit: 'basis-points' },
      { key: 'odd', label: 'Owner wrote seven lakh here', minor: '700', display: '$7.00', unit: 'money', currency: 'USD' }] });
  f.store.state.answers.push({ id: 'answer_1', receiptId: 'calc_2', stale: true, staleReason: 'The dictionary changed.' });
  const en = await f.run('voice.speak', { receiptId: 'calc_2' });
  assert.deepEqual(en.segments, [
    { text: 'These figures are out of date. Recalculate before relying on them.' },
    { text: 'Billed: two lakh rupees.', figureKey: 'total' },
    { text: 'Change: minus fifty basis points.', figureKey: 'changeBps' },
    { text: 'Figure: an amount in another currency, not read aloud.', figureKey: 'odd' }]);
  for (const segment of en.segments) assert.doesNotMatch(segment.text, /ninety|problems|seven|USD|\d/i);
  assert.equal(speakFigures({ operation: 'owner_custom', figures: [{ key: 'total', label: 'Seven', minor: '100', display: '₹1', unit: 'money', currency: 'INR' }] }, 'hi')[0]!.text, 'Kul: ek rupaya.');
  assert.equal(speakFigures({ operation: 'toString', figures: [{ key: 'constructor', label: 'x', minor: '1', display: '1', unit: 'basis-points' }] }, 'en')[0]!.text, 'Figure: one basis point.');
});

test('voice months use the workspace time zone and the same month function as model spend; an unknown zone is India time', async () => {
  const instant = Date.parse('2031-01-31T20:00:00.000Z'); // 1 Feb in India, 31 Jan in New York
  assert.equal(routesMonthOf, monthOf);
  assert.deepEqual([voiceMonth(instant), voiceMonth(instant, 'America/New_York'), monthOf(new Date(instant), 'America/New_York')], ['2031-02', '2031-01', '2031-01']);
  assert.deepEqual([validZone('Mars/Olympus_Mons'), validZone(''), validZone(7), validZone('Europe/London')], ['Asia/Kolkata', 'Asia/Kolkata', 'Asia/Kolkata', 'Europe/London']);
  assert.equal(monthOf(instant, 'Mars/Olympus_Mons'), '2031-02');
  const state = initialState('zones');
  state.modelReceipts.push({ id: 'r1', kind: 'speech-preview', status: 'completed', providerId: 'sarvam', providerKind: 'sarvam-stt', completedAt: new Date(instant).toISOString(), durationMs: 30000, costReservedMinor: '25' });
  (state.workspace as any).timeZone = 'America/New_York';
  assert.equal(workspaceZone(state), 'America/New_York');
  assert.deepEqual(voiceMeters(state, '2031-01'), { voiceMinutesMs: 30000, voiceCostMinor: '25' });
  assert.deepEqual(voiceUsage(state, '2031-02').providers, []);
  (state.workspace as any).timeZone = 'Not/AZone';
  assert.doesNotThrow(() => voiceMeters(state, '2031-02')); assert.deepEqual(voiceMeters(state, '2031-02'), { voiceMinutesMs: 30000, voiceCostMinor: '25' });
  // voice.usage defaults to the month of the injected clock in the workspace's zone.
  const f = fixture(); (f.store.state.workspace as any).timeZone = 'America/New_York'; f.tick(instant - T0);
  assert.equal((await f.run('voice.usage', {})).month, '2031-01');
  (f.store.state.workspace as any).timeZone = 'Bad/Zone'; assert.equal((await f.run('voice.usage', {})).month, '2031-02');
});
