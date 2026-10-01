import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { initialState, hash } from '../runtime/contracts.ts';
import type { State, StateStore, Context } from '../runtime/contracts.ts';
import { SpeechService } from '../runtime/speech.ts';
import type { SpeechOptions } from '../runtime/speech.ts';
import { TrustService } from '../runtime/trust.ts';

class MemoryStore implements StateStore { state: State = initialState('Speech workspace'); read() { return this.state; } async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); } }
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const code = (name: string) => (e: any) => e.code === name;
const audioBase64 = Buffer.from('RIFF synthetic audio fixture').toString('base64');
async function uploadFixture(http: NonNullable<SpeechOptions['http']>) {
  const store = new MemoryStore(); store.state.policy.send = 'samples'; const speech = new SpeechService(store, { http });
  const provider = await speech.configure(owner, { id: 'api-speech', kind: 'api-upload', model: 'whisper-1', endpoint: 'https://api.example.com/v1/audio/transcriptions', ratePerMinuteMinor: '100', budgetMinor: '1000' }, 'speech-api-secret');
  const preview = await speech.preview(owner, { providerId: provider.id, audioBase64, mimeType: 'audio/wav', durationMs: 90000 });
  assert.ok('payloadBase64' in preview); assert.equal(preview.receiptBoundary, 'application-to-provider-http');
  const approval = await speech.approve(owner, preview.id); return { store, speech, provider, preview, approval };
}

test('browser transcript is text input with provider/network disclosure and no API dispatch', async () => {
  const store = new MemoryStore(); let calls = 0; const speech = new SpeechService(store, { http: async () => { calls++; return { status: 200, body: '{}' }; } });
  const result = await speech.transcribe(owner, { providerId: 'browser', transcript: 'Show overdue invoices', browserProvider: 'Browser speech API' });
  assert.equal(result.transcript, 'Show overdue invoices'); assert.equal(calls, 0); assert.equal(result.receipt.providerVerified, false); assert.equal(result.receipt.actualCostMinor, null);
  assert.match(result.receipt.networkDisclosure, /may process audio remotely/);
});
test('browser preview can be accepted exactly once', async () => {
  const store = new MemoryStore(); const speech = new SpeechService(store); const preview = await speech.preview(owner, { providerId: 'browser', transcript: 'Show revenue' });
  assert.equal((await speech.transcribe(owner, { previewId: preview.id })).transcript, 'Show revenue'); await assert.rejects(speech.transcribe(owner, { previewId: preview.id }), code('SPEECH_REVOKED'));
});
test('paid upload requires samples policy and exact human approval', async () => {
  let calls = 0; const { store, speech, provider, preview, approval } = await uploadFixture(async () => { calls++; return { status: 200, body: '{"text":"Show revenue"}' }; });
  await assert.rejects(speech.transcribe(owner, { previewId: preview.id }), code('OUTBOUND_APPROVAL_REQUIRED')); assert.equal(calls, 0);
  const result = await speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id }); assert.equal(result.transcript, 'Show revenue'); assert.equal(calls, 1); assert.equal(result.receipt.costReservedMinor, '150'); assert.equal(result.receipt.actualCostMinor, null);
  store.state.policy.send = 'shape'; await assert.rejects(speech.preview(owner, { providerId: provider.id, audioBase64, mimeType: 'audio/wav', durationMs: 10000 }), code('SEND_DISABLED'));
});
test('upload exact multipart bytes match preview and secrets never enter snapshots', async () => {
  let request: any; const { store, speech, preview, approval } = await uploadFixture(async value => { request = value; return { status: 200, body: '{"text":"Show invoices"}' }; });
  await speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id });
  assert.equal(Buffer.from(request.body).toString('base64'), preview.payloadBase64); assert.equal(hash(preview.payloadBase64), preview.digest);
  assert.equal(request.headers['Content-Type'], preview.contentType); assert.equal(request.redirect, 'error'); assert.equal(JSON.stringify(store.state).includes('speech-api-secret'), false);
  assert.match(Buffer.from(request.body).toString(), /name="model"/); assert.match(Buffer.from(request.body).toString(), /recording.wav/);
});
test('speech HTTP failure has no fallback or automatic resend', async () => {
  let calls = 0; const { speech, preview, approval } = await uploadFixture(async () => { calls++; return { status: 503, body: '' }; });
  await assert.rejects(speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code('SPEECH_FAILED'));
  await assert.rejects(speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code('PREVIEW_NOT_FOUND')); assert.equal(calls, 1);
});
test('speech revocation during upload withholds returned transcript', async () => {
  let storeRef: MemoryStore; const { store, speech, preview, approval } = await uploadFixture(async () => { storeRef.state.policy.send = 'nothing'; return { status: 200, body: '{"text":"Private text"}' }; }); storeRef = store;
  await assert.rejects(speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code('PREVIEW_STALE'));
  assert.equal(store.state.modelReceipts.find(r => r.id === preview.id)?.transcript, undefined);
});
test('speech budgets use paise and stop further uploads', async () => {
  const { speech, provider, preview, approval } = await uploadFixture(async () => ({ status: 200, body: '{"text":"Show revenue"}' }));
  await speech.configure(owner, { id: provider.id, kind: 'api-upload', model: 'whisper-1', endpoint: 'https://api.example.com/v1/audio/transcriptions', ratePerMinuteMinor: '100', budgetMinor: '100' });
  await assert.rejects(speech.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code('SPEECH_REVOKED'));
  const next = await speech.preview(owner, { providerId: provider.id, audioBase64, mimeType: 'audio/wav', durationMs: 90000 }); const consent = await speech.approve(owner, next.id);
  await assert.rejects(speech.transcribe(owner, { previewId: next.id, approvalId: consent.id }), code('BUDGET_EXCEEDED'));
});
test('local speech uses configured executable and model in temporary cwd with no upload', async () => {
  const store = new MemoryStore(); let request: any; const speech = new SpeechService(store, { process: async value => { request = value; return { exitCode: 0, stdout: 'Show receivables' }; }, http: async () => { throw new Error('Should not upload'); } });
  const provider = await speech.configure(owner, { kind: 'local-command', command: resolve('test-tools', 'whisper-cli.exe'), model: resolve('test-tools', 'ggml-base.bin') });
  const preview = await speech.preview(owner, { providerId: provider.id, audioBase64, mimeType: 'audio/wav', durationMs: 10000 }); const result = await speech.transcribe(owner, { previewId: preview.id });
  assert.equal(result.transcript, 'Show receivables'); assert.equal(preview.approvalRequired, false); assert.ok(request.cwd.includes('chausar-speech-')); assert.ok(request.args.includes('-nt')); assert.ok(request.args.includes(provider.model)); assert.equal(request.env.OPENAI_API_KEY, undefined);
});
test('accountant can prepare speech but cannot approve a paid upload', async () => {
  const { store, speech, preview } = await uploadFixture(async () => ({ status: 200, body: '{}' })); const trust = new TrustService(store); const m = await trust.addMember(owner, { id: 'accountant', name: 'Bookkeeper', role: 'accountant' });
  await assert.rejects(speech.approve({ memberId: m.id, role: m.role, epoch: m.epoch }, preview.id), code('FORBIDDEN'));
});
