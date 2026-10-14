import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialState, hash } from '../runtime/contracts.ts';
import type { State, StateStore, Context } from '../runtime/contracts.ts';
import { SpeechService } from '../runtime/speech.ts';
import type { SpeechOptions, SpeechProvider } from '../runtime/speech.ts';
import { BHASHINI_COMPUTE_ENDPOINT, BHASHINI_CONFIG_ENDPOINT, LIVE_VOICE_ENDPOINT, SARVAM_ENDPOINT, wavSampleRate } from '../runtime/speech-providers.ts';
import { runSpeechBench, validateSpeechBench } from '../runtime/speech-bench.ts';
import { TrustService } from '../runtime/trust.ts';
import { Engine } from '../runtime/engine.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// Every provider transport here is an injected fake replaying documented reply shapes. No network.
class MemoryStore implements StateStore { state: State = initialState('Speech workspace'); read() { return this.state; } async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); } }
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const code = (name: string) => (e: any) => e.code === name;
type Request = Parameters<NonNullable<SpeechOptions['http']>>[0];
function wav(rate = 16000) {
  const h = Buffer.alloc(44); h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(44, 4); h.write('WAVE', 8, 'latin1'); h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36, 'latin1'); h.writeUInt32LE(8, 40); return Buffer.concat([h, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])]).toString('base64');
}
const audioBase64 = wav();
const sarvam: SpeechProvider = { id: 'sarvam', kind: 'sarvam-stt', model: 'saaras:v4', language: 'hi-IN', ratePerMinuteMinor: '50', budgetMinor: '100' };
const bhashini: SpeechProvider = { id: 'bhashini', kind: 'bhashini-asr', language: 'hi', pipelineId: 'pipeline0001', serviceId: 'ai4bharat/asr-hi', ratePerMinuteMinor: '0' };
const live: SpeechProvider = { id: 'live', kind: 'live-voice', model: 'gpt-realtime', ratePerMinuteMinor: '1500', budgetMinor: '50000' };
const bhashiniConfig = (callbackUrl = BHASHINI_COMPUTE_ENDPOINT, serviceId = 'ai4bharat/asr-hi') => JSON.stringify({ languages: [{ sourceLanguage: 'hi' }], pipelineResponseConfig: [{ taskType: 'asr', config: [{ serviceId, modelId: 'm', language: { sourceLanguage: 'hi' } }] }],
  pipelineInferenceAPIEndPoint: { callbackUrl, inferenceApiKey: { name: 'Authorization', value: 'inference-key-secret' }, isMultilingualEnabled: true, isSyncApi: true } });
const bhashiniReply = (source: string) => JSON.stringify({ pipelineResponse: [{ taskType: 'asr', config: { serviceId: 'ai4bharat/asr-hi' }, output: [{ source }], audio: null }] });

async function setup(provider: SpeechProvider, secret: string | undefined, http: (request: Request, calls: Request[]) => Promise<{ status: number; body: string; endpoint?: string }>) {
  const store = new MemoryStore(); store.state.policy.send = 'samples'; const calls: Request[] = [];
  const speech = new SpeechService(store, { liveVoiceCapEnforced: true, http: async request => { calls.push(request); return http(request, calls); } });
  await speech.configure(owner, provider, secret); return { store, speech, calls };
}
async function previewed(provider: SpeechProvider, secret: string | undefined, http: Parameters<typeof setup>[2], input: Record<string, unknown> = { audioBase64, mimeType: 'audio/wav', durationMs: 12000 }) {
  const fixture = await setup(provider, secret, http); const preview: any = await fixture.speech.preview(owner, { providerId: provider.id!, ...input } as any);
  const approval = await fixture.speech.approve(owner, preview.id); return { ...fixture, preview, approval };
}

test('Sarvam: exact multipart bytes, subscription header, single approved upload, secret only in memory', async () => {
  const { store, speech, calls, preview, approval } = await previewed(sarvam, 'sarvam-secret-key', async () => ({ status: 200, body: JSON.stringify({ request_id: 'req-1', transcript: 'दो लाख का पेमेंट नहीं आया', language_code: 'hi-IN' }) }));
  assert.equal(preview.endpoint, SARVAM_ENDPOINT); assert.equal(preview.approvalRequired, true); assert.equal(preview.estimatedCostMinor, '10'); assert.match(preview.networkDisclosure, /Sarvam/);
  await assert.rejects(speech.transcribe(owner, { previewId: preview.id }), code('OUTBOUND_APPROVAL_REQUIRED')); assert.equal(calls.length, 0);
  const result = await speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id });
  assert.equal(result.transcript, 'दो लाख का पेमेंट नहीं आया'); assert.equal(calls.length, 1); assert.equal(result.receipt.detectedLanguage, 'hi-IN'); assert.equal(result.receipt.providerRequestId, 'req-1');
  const [request] = calls; const text = Buffer.from(request.body).toString();
  assert.equal(request.endpoint, preview.endpoint); assert.equal(Buffer.from(request.body).toString('base64'), preview.payloadBase64); assert.equal(hash(preview.payloadBase64), preview.digest);
  assert.equal(request.headers['api-subscription-key'], 'sarvam-secret-key'); assert.equal(request.headers.Authorization, undefined); assert.equal(request.headers['Content-Type'], preview.contentType); assert.equal(request.redirect, 'error');
  assert.match(text, /name="model"\r\n\r\nsaaras:v4\r\n/); assert.match(text, /name="language_code"\r\n\r\nhi-IN\r\n/); assert.match(text, /name="file"; filename="recording.wav"/);
  assert.equal(JSON.stringify(store.state).includes('sarvam-secret-key'), false);
  await assert.rejects(speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code('PREVIEW_NOT_FOUND')); assert.equal(calls.length, 1);
});

test('Sarvam: configuration, privacy, duration and budget gates', async () => {
  const store = new MemoryStore(); const speech = new SpeechService(store, { http: async () => { throw new Error('No call'); } });
  await assert.rejects(speech.configure(owner, { ...sarvam, ratePerMinuteMinor: undefined }), code('RATE_REQUIRED'));
  await assert.rejects(speech.configure(owner, { ...sarvam, model: 'whisper-1' }), code('INVALID_SPEECH_PROVIDER'));
  await assert.rejects(speech.configure(owner, { ...sarvam, language: 'xx-YY' }), code('INVALID_SPEECH_PROVIDER'));
  await assert.rejects(speech.configure(owner, { ...sarvam, endpoint: 'http://api.sarvam.ai/speech-to-text' }), code('INVALID_ENDPOINT'));
  await assert.rejects(speech.configure(owner, { ...sarvam, pipelineId: 'pipeline0001' }), code('INVALID_SPEECH_PROVIDER'));
  await speech.configure(owner, sarvam);
  await assert.rejects(speech.preview(owner, { providerId: 'sarvam', audioBase64, mimeType: 'audio/wav', durationMs: 12000 }), code('SEND_DISABLED'));
  store.state.policy.send = 'samples';
  await assert.rejects(speech.preview(owner, { providerId: 'sarvam', audioBase64, mimeType: 'audio/wav', durationMs: 31000 }), code('INVALID_AUDIO'));
  const preview = await speech.preview(owner, { providerId: 'sarvam', audioBase64, mimeType: 'audio/wav', durationMs: 12000 }); const approval = await speech.approve(owner, preview.id);
  await assert.rejects(speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code('CREDENTIAL_REQUIRED'));
  let calls = 0; const budget = await setup({ ...sarvam, budgetMinor: '15' }, 'k', async () => { calls++; return { status: 200, body: '{"transcript":"ok"}' }; });
  const first = await budget.speech.preview(owner, { providerId: 'sarvam', audioBase64, mimeType: 'audio/wav', durationMs: 12000 });
  const firstResult = await budget.speech.transcribe(owner, { previewId: first.id, approvalId: (await budget.speech.approve(owner, first.id)).id }); assert.equal(firstResult.receipt.costReservedMinor, '10');
  const second = await budget.speech.preview(owner, { providerId: 'sarvam', audioBase64, mimeType: 'audio/wav', durationMs: 12000 });
  await assert.rejects(budget.speech.transcribe(owner, { previewId: second.id, approvalId: (await budget.speech.approve(owner, second.id)).id }), code('BUDGET_EXCEEDED')); assert.equal(calls, 1);
});

test('Sarvam: redirects and failures are refused once, with no retry and no transcript kept', async () => {
  for (const reply of [{ status: 200, body: '{"transcript":"x"}', endpoint: 'https://elsewhere.example/speech' }, { status: 302, body: '' }]) {
    const { store, speech, calls, preview, approval } = await previewed(sarvam, 'k', async () => reply);
    await assert.rejects(speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code('REDIRECT_REFUSED')); assert.equal(calls.length, 1);
    const receipt = store.state.modelReceipts.find(r => r.id === preview.id); assert.equal(receipt.status, 'failed'); assert.equal(receipt.transcript, undefined); assert.equal(receipt.errorCode, 'REDIRECT_REFUSED');
  }
  const failing = await previewed(sarvam, 'k', async () => ({ status: 429, body: '{"error":{"message":"slow down"}}' }));
  await assert.rejects(failing.speech.transcribe(owner, { previewId: failing.preview.id, approvalId: failing.approval.id }), code('SPEECH_FAILED'));
  await assert.rejects(failing.speech.transcribe(owner, { previewId: failing.preview.id, approvalId: failing.approval.id }), code('PREVIEW_NOT_FOUND')); assert.equal(failing.calls.length, 1);
  let storeRef: MemoryStore; const revoked = await previewed(sarvam, 'k', async () => { storeRef.state.policy.send = 'shape'; return { status: 200, body: '{"transcript":"private"}' }; }); storeRef = revoked.store;
  await assert.rejects(revoked.speech.transcribe(owner, { previewId: revoked.preview.id, approvalId: revoked.approval.id }), code('PREVIEW_STALE'));
  assert.equal(revoked.store.state.modelReceipts.find(r => r.id === revoked.preview.id)?.transcript, undefined);
});

test('Bhashini: config step sends no audio, then the exact approved bytes go to the previewed endpoint', async () => {
  assert.equal(wavSampleRate(Buffer.from(audioBase64, 'base64')), 16000);
  const { store, speech, calls, preview, approval } = await previewed(bhashini, 'integrator-7:ulca-secret', async request => request.endpoint === BHASHINI_CONFIG_ENDPOINT ? { status: 200, body: bhashiniConfig() } : { status: 200, body: bhashiniReply('पेमेंट नहीं आया') });
  assert.equal(preview.endpoint, BHASHINI_COMPUTE_ENDPOINT); assert.equal(preview.configEndpoint, BHASHINI_CONFIG_ENDPOINT); assert.equal(preview.receiptBoundary, 'application-to-provider-http-two-step');
  assert.deepEqual(JSON.parse(preview.configPayload), { pipelineTasks: [{ taskType: 'asr', config: { language: { sourceLanguage: 'hi' } } }], pipelineRequestConfig: { pipelineId: 'pipeline0001' } });
  const body = JSON.parse(Buffer.from(preview.payloadBase64, 'base64').toString());
  assert.deepEqual(body.pipelineTasks[0].config, { language: { sourceLanguage: 'hi' }, serviceId: 'ai4bharat/asr-hi', audioFormat: 'wav', samplingRate: 16000 }); assert.equal(body.inputData.audio[0].audioContent, audioBase64);
  const result = await speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id });
  assert.equal(result.transcript, 'पेमेंट नहीं आया'); assert.equal(result.receipt.configCalls, 1); assert.equal(calls.length, 2);
  const [config, compute] = calls;
  assert.equal(config.endpoint, BHASHINI_CONFIG_ENDPOINT); assert.equal(config.headers.userID, 'integrator-7'); assert.equal(config.headers.ulcaApiKey, 'ulca-secret'); assert.equal(Buffer.from(config.body).toString(), preview.configPayload);
  assert.equal(Buffer.from(config.body).toString().includes(audioBase64), false); assert.equal(Buffer.from(config.body).toString().includes('audioContent'), false);
  assert.equal(compute.endpoint, preview.endpoint); assert.equal(compute.headers.Authorization, 'inference-key-secret'); assert.equal(compute.headers.userID, undefined);
  assert.equal(Buffer.from(compute.body).toString('base64'), preview.payloadBase64); assert.equal(compute.redirect, 'error');
  const snapshot = JSON.stringify(store.state); for (const secret of ['ulca-secret', 'inference-key-secret', 'integrator-7']) assert.equal(snapshot.includes(secret), false, secret);
});

test('Bhashini: a different callback URL or service is refused before any audio leaves', async () => {
  for (const [config, refusal] of [[bhashiniConfig('https://other-inference.example/pipeline'), 'BHASHINI_CALLBACK_MISMATCH'], [bhashiniConfig(BHASHINI_COMPUTE_ENDPOINT, 'other/service'), 'BHASHINI_SERVICE_MISMATCH'], ['{"pipelineInferenceAPIEndPoint":{}}', 'BHASHINI_CALLBACK_MISMATCH'], ['not json', 'INVALID_TRANSCRIPT']] as const) {
    const { store, speech, calls, preview, approval } = await previewed(bhashini, 'u:k', async () => ({ status: 200, body: config }));
    await assert.rejects(speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code(refusal));
    assert.equal(calls.length, 1); assert.equal(calls[0].endpoint, BHASHINI_CONFIG_ENDPOINT);
    const receipt = store.state.modelReceipts.find(r => r.id === preview.id); assert.equal(receipt.status, 'failed'); assert.equal(receipt.errorCode, refusal);
    await assert.rejects(speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code('PREVIEW_NOT_FOUND')); assert.equal(calls.length, 1);
  }
  const bad = await previewed(bhashini, 'u:k', async () => ({ status: 200, body: bhashiniConfig().replace('"Authorization"', '"Content-Type"') }));
  await assert.rejects(bad.speech.transcribe(owner, { previewId: bad.preview.id, approvalId: bad.approval.id }), code('BHASHINI_CONFIG_INVALID')); assert.equal(bad.calls.length, 1);
  const down = await previewed(bhashini, 'u:k', async () => ({ status: 500, body: '' }));
  await assert.rejects(down.speech.transcribe(owner, { previewId: down.preview.id, approvalId: down.approval.id }), code('SPEECH_FAILED')); assert.equal(down.calls.length, 1);
  const redirected = await previewed(bhashini, 'u:k', async () => ({ status: 200, body: bhashiniConfig(), endpoint: 'https://elsewhere.example/config' }));
  await assert.rejects(redirected.speech.transcribe(owner, { previewId: redirected.preview.id, approvalId: redirected.approval.id }), code('REDIRECT_REFUSED')); assert.equal(redirected.calls.length, 1);
});

test('Bhashini: revocation between the two steps stops the upload; inputs are strict', async () => {
  let storeRef: MemoryStore; const revoked = await previewed(bhashini, 'u:k', async () => { storeRef.state.policy.send = 'nothing'; return { status: 200, body: bhashiniConfig() }; }); storeRef = revoked.store;
  await assert.rejects(revoked.speech.transcribe(owner, { previewId: revoked.preview.id, approvalId: revoked.approval.id }), code('PREVIEW_STALE')); assert.equal(revoked.calls.length, 1);
  const fixture = await setup(bhashini, 'u:k', async () => ({ status: 200, body: '' }));
  await assert.rejects(fixture.speech.preview(owner, { providerId: 'bhashini', audioBase64, mimeType: 'audio/mpeg', durationMs: 1000 }), code('INVALID_AUDIO'));
  await assert.rejects(fixture.speech.preview(owner, { providerId: 'bhashini', audioBase64: Buffer.from('RIFF not really a wav file at all, just text padding here').toString('base64'), mimeType: 'audio/wav', durationMs: 1000 }), code('INVALID_AUDIO'));
  await assert.rejects(fixture.speech.configure(owner, bhashini, 'no-colon-secret'), code('INVALID_CREDENTIAL'));
  await assert.rejects(fixture.speech.configure(owner, { ...bhashini, pipelineId: undefined }), code('INVALID_SPEECH_PROVIDER'));
  await assert.rejects(fixture.speech.configure(owner, { ...bhashini, configEndpoint: 'https://user:pw@meity-auth.ulcacontrib.org/x' }), code('INVALID_ENDPOINT'));
});

test('paid live voice: approved cost cap, one session-secret request, the secret never reaches state', async () => {
  const store0 = new MemoryStore(); const speech0 = new SpeechService(store0);
  await assert.rejects(speech0.configure(owner, { ...live, endpoint: 'https://api.example.com/v1/realtime/client_secrets' }), code('LIVE_VOICE_NOT_VERIFIED'));
  await assert.rejects(speech0.configure(owner, { ...live, ratePerMinuteMinor: '0' }), code('RATE_REQUIRED'));
  const reply = { value: 'ek_live_secret_value_123', expires_at: 1790000000, session: { type: 'realtime', model: 'gpt-realtime' } };
  const { store, speech, calls, preview, approval } = await previewed(live, 'sk-live-key', async () => ({ status: 200, body: JSON.stringify(reply) }), { durationMs: 600000 });
  assert.equal(preview.endpoint, LIVE_VOICE_ENDPOINT); assert.equal(preview.estimatedCostMinor, '15000'); assert.equal(preview.approvalRequired, true); assert.equal(preview.receiptBoundary, 'application-to-provider-session-secret');
  assert.deepEqual(JSON.parse(Buffer.from(preview.payloadBase64, 'base64').toString()), { expires_after: { anchor: 'created_at', seconds: 60 }, session: { type: 'realtime', model: 'gpt-realtime' } });
  await assert.rejects(speech.transcribe(owner, { previewId: preview.id }), code('OUTBOUND_APPROVAL_REQUIRED')); assert.equal(calls.length, 0);
  const result: any = await speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id });
  assert.equal(result.transcript, null); assert.equal(result.live.clientSecret, reply.value); assert.equal(result.live.expiresAt, new Date(reply.expires_at * 1000).toISOString());
  assert.equal(result.live.ratePerMinuteMinor, '1500'); assert.equal(result.live.reservedMinor, '15000'); assert.equal(result.live.experimental, true); assert.match(result.live.disclosure, /cannot measure/);
  assert.equal(calls.length, 1); assert.equal(calls[0].headers.Authorization, 'Bearer sk-live-key'); assert.equal(Buffer.from(calls[0].body).toString('base64'), preview.payloadBase64);
  const snapshot = JSON.stringify(store.state); assert.equal(snapshot.includes(reply.value), false); assert.equal(snapshot.includes('sk-live-key'), false);
  assert.equal(store.state.modelReceipts.find(r => r.id === preview.id).costReservedMinor, '15000');
  const fixture = await setup(live, 'k', async () => ({ status: 200, body: '{"value":"short"}' }));
  await assert.rejects(fixture.speech.preview(owner, { providerId: 'live', audioBase64, mimeType: 'audio/wav', durationMs: 1000 }), code('INVALID_AUDIO'));
  await assert.rejects(fixture.speech.preview(owner, { providerId: 'live', durationMs: 1800001 }), code('INVALID_LIVE_CAP'));
  const bad = await fixture.speech.preview(owner, { providerId: 'live', durationMs: 60000 });
  await assert.rejects(fixture.speech.transcribe(owner, { previewId: bad.id, approvalId: (await fixture.speech.approve(owner, bad.id)).id }), code('LIVE_VOICE_INVALID_REPLY'));
  fixture.store.state.policy.send = 'shape'; await assert.rejects(fixture.speech.preview(owner, { providerId: 'live', durationMs: 60000 }), code('SEND_DISABLED'));
  const trust = new TrustService(fixture.store); const m = await trust.addMember(owner, { id: 'accountant', name: 'Bookkeeper', role: 'accountant' });
  fixture.store.state.policy.send = 'samples'; const pending = await fixture.speech.preview(owner, { providerId: 'live', durationMs: 60000 });
  await assert.rejects(fixture.speech.approve({ memberId: m.id, role: m.role, epoch: m.epoch }, pending.id), code('FORBIDDEN'));
});

test('recorded-clip bench replays each provider offline and scores both traps', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../benchmarks/speech/recorded-clips.json', import.meta.url), 'utf8'));
  const results = await runSpeechBench(fixtures);
  const by = Object.fromEntries(results.map(r => [r.kind, r]));
  assert.deepEqual(Object.keys(by).sort(), ['api-upload', 'bhashini-asr', 'local-command', 'sarvam-stt']);
  for (const kind of ['api-upload', 'sarvam-stt']) { assert.equal(by[kind].passed, 5, kind); assert.equal(by[kind].bothTrapsCaught, true, kind); assert.equal(by[kind].trapsTotal, 2); }
  const dropped = by['bhashini-asr'].clips.find(c => c.clipId === 'trap-nahi-payment')!;
  assert.equal(dropped.trapCaught, false); assert.equal(dropped.negated, false); assert.equal(by['bhashini-asr'].bothTrapsCaught, false); assert.equal(by['bhashini-asr'].passed, 4);
  const misheard = by['local-command'].clips.find(c => c.clipId === 'trap-do-lakh')!;
  assert.equal(misheard.trapCaught, false); assert.equal(by['local-command'].bothTrapsCaught, false);
  assert.equal(by['sarvam-stt'].clips.find(c => c.clipId === 'trap-do-lakh')!.understood, '2,00,000 से ऊपर के इनवॉइस दिखाओ');
  assert.ok(results.every(r => r.clips.every(c => c.errorCode === null)));
  assert.deepEqual((await runSpeechBench(fixtures, ['sarvam-stt'])).map(r => r.kind), ['sarvam-stt']);
  await assert.rejects(runSpeechBench(fixtures, ['live-voice']), code('INVALID_SPEECH_BENCH'));
  assert.throws(() => validateSpeechBench({ ...fixtures, extra: true }), code('INVALID_SPEECH_BENCH'));
  assert.throws(() => validateSpeechBench({ ...fixtures, providers: { 'sarvam-stt': {} } }), code('INVALID_SPEECH_BENCH'));
  const broken = structuredClone(fixtures); broken.providers['sarvam-stt']['trap-do-lakh'] = { status: 500, body: '' };
  const failed = (await runSpeechBench(broken, ['sarvam-stt']))[0].clips.find(c => c.clipId === 'trap-do-lakh')!;
  assert.equal(failed.errorCode, 'SPEECH_FAILED'); assert.equal(failed.transcript, null); assert.equal(failed.trapCaught, false);
});

test('engine: speech.configure with a new kind, catalogue, interpret, confirm and bench through modules', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-'));
  const fixtures = JSON.parse(await readFile(new URL('../benchmarks/speech/recorded-clips.json', import.meta.url), 'utf8'));
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock), modules: { 'models-ext': { speechBench: fixtures } } });
  try {
    await engine.request('workspace.create', { name: 'Test Shop', passphrase: 'correct horse battery staple 42', demo: true });
    const configured = await engine.request('speech.configure', { config: { id: 'sarvam', kind: 'sarvam-stt', model: 'saaras:v4', language: 'hi-IN', ratePerMinuteMinor: '50' }, secret: 'engine-sarvam-secret' });
    assert.equal(configured.kind, 'sarvam-stt'); assert.equal(configured.credentialConfigured, true); assert.equal(configured.endpoint, SARVAM_ENDPOINT);
    const catalogue = await engine.request('modelsx.speechCatalogue', {});
    const kinds = Object.fromEntries(catalogue.providers.map((p: any) => [p.kind, p]));
    assert.deepEqual(Object.keys(kinds).sort(), ['api-upload', 'bhashini-asr', 'browser-transcript', 'live-voice', 'local-command', 'sarvam-stt']);
    assert.equal(kinds['local-command'].cost, 'free'); assert.equal(kinds['local-command'].status, 'supported'); assert.equal(kinds['local-command'].needsFounderAccount, false);
    for (const kind of ['sarvam-stt', 'bhashini-asr', 'live-voice']) { assert.equal(kinds[kind].needsFounderAccount, true); assert.equal(kinds[kind].status, 'experimental'); }
    assert.deepEqual(kinds['sarvam-stt'].configured.map((p: any) => [p.id, p.ratePerMinute, p.credentialConfigured]), [['sarvam', '₹0.50 per minute', true]]);
    await assert.rejects(engine.request('modelsx.speechCatalogue', { extra: 1 }), code('INVALID_REQUEST'));
    await engine.request('trust.update', { send: 'samples' });
    const preview = await engine.request('speech.preview', { providerId: 'sarvam', audioBase64, mimeType: 'audio/wav', durationMs: 6000 });
    assert.equal(preview.approvalRequired, true); assert.equal(preview.estimatedCostMinor, '5');
    const reading = await engine.request('modelsx.speechInterpret', { text: 'do lakh ka payment nahi aaya' });
    assert.equal(reading.understood, '2,00,000 ka payment nahi aaya'); assert.equal(reading.requiresConfirmation, true); assert.deepEqual(reading.negations.map((n: any) => n.text), ['nahi']); assert.equal(reading.receiptId, null);
    await assert.rejects(engine.request('modelsx.speechConfirm', { text: 'do lakh ka payment nahi aaya', digest: 'a'.repeat(64) }), code('UNDERSTOOD_CHANGED'));
    const confirmed = await engine.request('modelsx.speechConfirm', { text: 'do lakh ka payment nahi aaya', digest: reading.digest });
    assert.match(confirmed.confirmationId, /^speech_confirmation_/); assert.equal(confirmed.understood, reading.understood);
    await assert.rejects(engine.request('modelsx.speechConfirm', { text: '[inaudible] lakh', digest: (await engine.request('modelsx.speechInterpret', { text: '[inaudible] lakh' })).digest }), code('SPEECH_UNCLEAR'));
    const heard = await engine.request('speech.transcribe', { providerId: 'browser', transcript: 'दो लाख रुपये का बिल नहीं भेजा' });
    const fromReceipt = await engine.request('modelsx.speechInterpret', { receiptId: heard.receipt.id });
    assert.equal(fromReceipt.understood, '2,00,000 रुपये का बिल नहीं भेजा'); assert.equal(fromReceipt.numbers[0].paise, '20000000'); assert.equal(fromReceipt.receiptId, heard.receipt.id);
    await assert.rejects(engine.request('modelsx.speechInterpret', { receiptId: 'missing' }), code('SPEECH_RECEIPT_NOT_FOUND'));
    await assert.rejects(engine.request('modelsx.speechInterpret', { text: 'x', receiptId: heard.receipt.id }), code('INVALID_REQUEST'));
    const bench = await engine.request('modelsx.speechBench', { kinds: ['sarvam-stt', 'bhashini-asr'] });
    assert.equal(bench.recordedOffline, true); assert.deepEqual(bench.providers.map((p: any) => [p.kind, p.bothTrapsCaught]), [['sarvam-stt', true], ['bhashini-asr', false]]);
    assert.equal((engine as any).store().read().modelReceipts.some((r: any) => String(r.providerId).startsWith('bench-')), false);
    const state = JSON.stringify((engine as any).store().read()); assert.equal(state.includes('engine-sarvam-secret'), false); assert.equal(state.includes('bench-fixture-key'), false);
    await engine.request('workspace.lock', {});
  } finally { await engine.close?.(); await rm(directory, { recursive: true, force: true }); }
});

test('engine: the speech bench is refused without recorded clips from the host', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-'));
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock) });
  try {
    await engine.request('workspace.create', { name: 'Test Shop', passphrase: 'correct horse battery staple 42', demo: true });
    await assert.rejects(engine.request('modelsx.speechBench', {}), code('SPEECH_BENCH_FIXTURES_REQUIRED'));
    await engine.request('workspace.lock', {});
  } finally { await engine.close?.(); await rm(directory, { recursive: true, force: true }); }
});

test('live voice is refused unless the host enforces the minute cap, and only on the desktop', async () => {
  const store = new MemoryStore(); store.state.policy.send = 'samples'; let calls = 0;
  const off = new SpeechService(store, { http: async () => { calls++; return { status: 200, body: '{}' }; } });
  await off.configure(owner, live, 'sk-live-key');
  await assert.rejects(off.preview(owner, { providerId: 'live', durationMs: 60000 }), code('LIVE_VOICE_CAP_NOT_ENFORCED'));
  const on = new SpeechService(store, { liveVoiceCapEnforced: true, http: async () => { calls++; return { status: 200, body: '{}' }; } });
  await assert.rejects(on.preview({ ...owner, channel: 'phone' }, { providerId: 'live', durationMs: 60000 }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(on.preview({ ...owner, channel: 'mcp' }, { providerId: 'live', durationMs: 60000 }), code('APP_APPROVAL_REQUIRED'));
  const preview: any = await on.preview(owner, { providerId: 'live', durationMs: 60000 }); const approval = await on.approve(owner, preview.id);
  await assert.rejects(off.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code('LIVE_VOICE_CAP_NOT_ENFORCED'));
  assert.equal(calls, 0);
});
