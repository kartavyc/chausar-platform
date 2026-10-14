import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialState } from '../runtime/contracts.ts';
import type { State, StateStore, Context } from '../runtime/contracts.ts';
import { SpeechService } from '../runtime/speech.ts';
import type { SpeechOptions, SpeechProvider } from '../runtime/speech.ts';
import { SARVAM_ENDPOINT } from '../runtime/speech-providers.ts';
import { TrustService } from '../runtime/trust.ts';
import { speechPart } from '../runtime/models-ext/speech-methods.ts';
import { Engine } from '../runtime/engine.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// Provider configurations persist in the workspace; keys do not. Every transport is an injected fake. No network.
class MemoryStore implements StateStore { state: State = initialState('Speech workspace'); read() { return structuredClone(this.state); } async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); } }
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const code = (name: string) => (e: any) => e.code === name;
type Http = NonNullable<SpeechOptions['http']>;
function wav(rate = 16000) {
  const h = Buffer.alloc(44); h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(44, 4); h.write('WAVE', 8, 'latin1'); h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36, 'latin1'); h.writeUInt32LE(8, 40); return Buffer.concat([h, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])]).toString('base64');
}
const audioBase64 = wav();
const sarvam: SpeechProvider = { id: 'sarvam', kind: 'sarvam-stt', label: 'Sarvam Hindi', model: 'saaras:v4', language: 'hi-IN', ratePerMinuteMinor: '100', budgetMinor: '100', credentialEnv: 'CHAUSAR_TEST_SARVAM_UNSET' };
const reply = (transcript: string) => ({ status: 200, body: JSON.stringify({ request_id: 'req-1', transcript, language_code: 'hi-IN' }) });
const stored = (store: MemoryStore) => (store.state.extensions?.['models-ext'] as any)?.speech?.providers;
const audio = { audioBase64, mimeType: 'audio/wav', durationMs: 30000 };

test('a configured provider survives a restart without its key; transcribe asks for the key and sends nothing', async () => {
  const store = new MemoryStore(); store.state.policy.send = 'samples'; const calls: any[] = [];
  const http: Http = async request => { calls.push(request); return reply('do lakh ka payment nahi aaya'); };
  const before = new SpeechService(store, { http });
  assert.equal((await before.configure(owner, sarvam, 'sarvam-secret-key')).credentialConfigured, true);
  assert.deepEqual(stored(store).map((p: any) => [p.id, p.kind, p.label, p.endpoint, p.model, p.language, p.ratePerMinuteMinor, p.budgetMinor, p.credentialEnv, p.enabled, p.revision]),
    [['sarvam', 'sarvam-stt', 'Sarvam Hindi', SARVAM_ENDPOINT, 'saaras:v4', 'hi-IN', '100', '100', 'CHAUSAR_TEST_SARVAM_UNSET', true, 1]]);
  assert.equal(JSON.stringify(store.state).includes('sarvam-secret-key'), false);
  assert.ok(store.state.activity.some(a => a.event === 'speech.provider.configured' && a.details.id === 'sarvam'));

  const after = new SpeechService(store, { http });
  const listed = Object.fromEntries((await after.providers(owner)).map(p => [p.id, p]));
  assert.deepEqual(Object.keys(listed).sort(), ['browser', 'sarvam']); assert.equal(listed.sarvam.credentialConfigured, false); assert.equal(listed.sarvam.revision, 1); assert.equal(listed.browser.credentialConfigured, true);
  const preview: any = await after.preview(owner, { providerId: 'sarvam', ...audio }); const approval = await after.approve(owner, preview.id);
  await assert.rejects(after.transcribe(owner, { previewId: preview.id, approvalId: approval.id }), code('CREDENTIAL_REQUIRED'));
  assert.equal(calls.length, 0); assert.equal(store.state.modelReceipts.find(r => r.id === preview.id).status, 'preview');
  assert.equal(store.state.modelReceipts.find(r => r.id === approval.id).used, false);

  // A broker holding the key serves the same preview and approval: nothing about the provider changed.
  const brokered = new SpeechService(store, { http, credentialBroker: id => id === 'sarvam' ? 'broker-sarvam-key' : undefined });
  assert.equal((await brokered.providers(owner)).find(p => p.id === 'sarvam')!.credentialConfigured, true);
  assert.equal((await brokered.transcribe(owner, { previewId: preview.id, approvalId: approval.id })).transcript, 'do lakh ka payment nahi aaya');
  assert.equal(calls.length, 1); assert.equal(calls[0].headers['api-subscription-key'], 'broker-sarvam-key');
  assert.equal(JSON.stringify(store.state).includes('broker-sarvam-key'), false);
});

test('revision and revocation hold across a restart; both are audited', async () => {
  const store = new MemoryStore(); store.state.policy.send = 'samples'; const http: Http = async () => reply('theek hai');
  const first = new SpeechService(store, { http }); await first.configure(owner, sarvam, 'k1');
  const old: any = await first.preview(owner, { providerId: 'sarvam', ...audio }); const oldApproval = await first.approve(owner, old.id);
  const second = new SpeechService(store, { http }); assert.equal((await second.configure(owner, sarvam, 'k2')).revision, 2);
  const third = new SpeechService(store, { http, credentialBroker: () => 'k3' });
  await assert.rejects(third.transcribe(owner, { previewId: old.id, approvalId: oldApproval.id }), code('SPEECH_REVOKED'));

  const pending: any = await third.preview(owner, { providerId: 'sarvam', ...audio }); const pendingApproval = await third.approve(owner, pending.id);
  assert.deepEqual(await second.revoke(owner, 'sarvam'), { providerId: 'sarvam', enabled: false, revision: 3 });
  assert.ok(store.state.activity.some(a => a.event === 'speech.provider.revoked' && a.details.id === 'sarvam' && a.details.revision === 3));
  const restarted = new SpeechService(store, { http, credentialBroker: () => 'k3' });
  const listed = (await restarted.providers(owner)).find(p => p.id === 'sarvam')!; assert.equal(listed.enabled, false); assert.equal(listed.revision, 3);
  await assert.rejects(restarted.transcribe(owner, { previewId: pending.id, approvalId: pendingApproval.id }), code('SPEECH_REVOKED'));
  await assert.rejects(restarted.preview(owner, { providerId: 'sarvam', ...audio }), code('SPEECH_UNAVAILABLE'));
  await assert.rejects(restarted.revoke(owner, 'missing'), code('SPEECH_UNAVAILABLE'));
  const m = await new TrustService(store).addMember(owner, { id: 'accountant', name: 'Bookkeeper', role: 'accountant' });
  await assert.rejects(restarted.revoke({ memberId: m.id, role: m.role, epoch: m.epoch }, 'sarvam'), code('FORBIDDEN'));

  // Configuring again re-enables at a new revision; the built-in browser provider can be revoked durably too.
  assert.equal((await restarted.configure(owner, sarvam)).enabled, true);
  await restarted.revoke(owner, 'browser');
  const reopened = new SpeechService(store);
  assert.equal((await reopened.providers(owner)).find(p => p.id === 'browser')!.enabled, false);
  await assert.rejects(reopened.transcribe(owner, { providerId: 'browser', transcript: 'hello' }), code('SPEECH_UNAVAILABLE'));
  assert.equal((await reopened.providers(owner)).find(p => p.id === 'sarvam')!.revision, 4);
});

test('budgets are spent from durable receipts, so a restart does not refill them', async () => {
  const store = new MemoryStore(); store.state.policy.send = 'samples'; const options = { http: (async () => reply('ok')) as Http, credentialBroker: () => 'k' };
  const run = async (speech: SpeechService) => { const p: any = await speech.preview(owner, { providerId: 'sarvam', ...audio }); return speech.transcribe(owner, { previewId: p.id, approvalId: (await speech.approve(owner, p.id)).id }); };
  const first = new SpeechService(store, options); await first.configure(owner, sarvam); await run(first);
  const second = new SpeechService(store, options); await run(second);
  assert.deepEqual(store.state.modelReceipts.filter(r => r.kind === 'speech-preview').map(r => r.costReservedMinor), ['50', '50']);
  await assert.rejects(run(new SpeechService(store, options)), code('BUDGET_EXCEEDED'));
});

test('a key is never carried to a changed service; settings are validated strictly', async () => {
  const store = new MemoryStore(); const speech = new SpeechService(store);
  const api: SpeechProvider = { id: 'api', kind: 'api-upload', model: 'whisper-1', endpoint: 'https://api.example.com/v1/audio/transcriptions', ratePerMinuteMinor: '10' };
  await speech.configure(owner, api, 'api-key');
  assert.equal((await speech.configure(owner, { ...api, budgetMinor: '500' })).credentialConfigured, true);
  assert.equal((await speech.configure(owner, { ...api, endpoint: 'https://other.example.com/v1/audio/transcriptions' })).credentialConfigured, false);
  await assert.rejects(speech.configure(owner, { ...api, id: '__proto__ x' }), code('INVALID_SPEECH_PROVIDER'));
  await assert.rejects(speech.configure(owner, { ...api, label: 'x'.repeat(121) }), code('INVALID_SPEECH_PROVIDER'));
  await assert.rejects(speech.configure(owner, { ...api, enabled: 'yes' as any }), code('INVALID_SPEECH_PROVIDER'));
  assert.deepEqual(stored(store).map((p: any) => p.id), ['api']);
});

test('purge drops confirmations whose speech receipt is gone and keeps provider settings', () => {
  const state = initialState('Purge workspace');
  state.modelReceipts.push({ id: 'kept', kind: 'speech-receipt' });
  state.extensions = { 'models-ext': { speech: { providers: [{ id: 'sarvam', kind: 'sarvam-stt', revision: 1, enabled: true }], benchRuns: [],
    confirmations: [{ id: 'c1', receiptId: 'kept' }, { id: 'c2', receiptId: 'removed-now' }, { id: 'c3', receiptId: 'removed-earlier' }, { id: 'c4', receiptId: null }] } } };
  assert.equal(speechPart.purge!(state, { sourceIds: ['s1'], removedIds: new Set(['removed-now']), at: '2000-01-01T00:00:00.000Z' }), 2);
  const ns = (state.extensions['models-ext'] as any).speech;
  assert.deepEqual(ns.confirmations.map((c: any) => c.id), ['c1', 'c4']); assert.equal(ns.providers.length, 1);
});

test('an approval lasts five minutes on an injected clock, whatever the real date is', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2031, 0, 1) });
  const store = new MemoryStore(); store.state.policy.send = 'samples'; const calls: unknown[] = [];
  const speech = new SpeechService(store, { http: async request => { calls.push(request); return reply('theek hai'); }, credentialBroker: () => 'k' }); await speech.configure(owner, sarvam);
  const preview: any = await speech.preview(owner, { providerId: 'sarvam', ...audio }); const late = await speech.approve(owner, preview.id);
  assert.equal(preview.createdAt, '2031-01-01T00:00:00.000Z'); assert.equal(late.expiresAt, '2031-01-01T00:05:00.000Z');
  t.mock.timers.tick(300000);
  await assert.rejects(speech.transcribe(owner, { previewId: preview.id, approvalId: late.id }), code('OUTBOUND_APPROVAL_REQUIRED')); assert.equal(calls.length, 0);
  const fresh = await speech.approve(owner, preview.id); t.mock.timers.tick(299999);
  const heard: any = await speech.transcribe(owner, { previewId: preview.id, approvalId: fresh.id });
  assert.equal(heard.transcript, 'theek hai'); assert.equal(heard.receipt.completedAt, '2031-01-01T00:09:59.999Z'); assert.equal(calls.length, 1);
});

async function filesContain(directory: string, needle: string): Promise<boolean> {
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && (await readFile(join(entry.parentPath, entry.name))).includes(needle)) return true;
  }
  return false;
}

test('engine: a Sarvam provider persists through lock, reopen and a new engine; its key does not', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-mx-')); const passphrase = 'correct horse battery staple 42';
  const storage = installSyntheticProductionStorage(directory, ['main'], t.mock);
  const sent: { url: string; key: string | null }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => { sent.push({ url: String(url), key: new Headers(init.headers).get('api-subscription-key') }); return new Response(JSON.stringify({ request_id: 'req-9', transcript: 'do lakh ka payment nahi aaya', language_code: 'hi-IN' }), { status: 200 }); });
  const sarvamSent = () => sent.filter(s => s.url === SARVAM_ENDPOINT);
  let engine = new Engine({ directory, ...storage });
  try {
    await engine.request('workspace.create', { name: 'Test Shop', passphrase, demo: false, pack: 'ecommerce' });
    await engine.request('trust.update', { send: 'samples' });
    const configured = await engine.request('speech.configure', { config: { id: 'sarvam', kind: 'sarvam-stt', model: 'saaras:v4', language: 'hi-IN', ratePerMinuteMinor: '100', budgetMinor: '1000' }, secret: 'engine-sarvam-secret' });
    assert.equal(configured.credentialConfigured, true); assert.equal(configured.revision, 1);

    await engine.request('workspace.lock', {}); await engine.request('workspace.open', { folder: 'main', passphrase });
    let listed = (await engine.request('speech.list', {})).find((p: any) => p.id === 'sarvam');
    assert.equal(listed.credentialConfigured, false); assert.equal(listed.enabled, true); assert.equal(listed.revision, 1); assert.equal(listed.endpoint, SARVAM_ENDPOINT);
    const catalogue = await engine.request('modelsx.speechCatalogue', {});
    assert.equal(catalogue.configurationStoredInWorkspace, true); assert.equal(catalogue.credentialsStoredInWorkspace, false); assert.equal('configurationIsSessionLocal' in catalogue, false);
    assert.deepEqual(catalogue.providers.find((p: any) => p.kind === 'sarvam-stt').configured.map((p: any) => [p.id, p.credentialConfigured]), [['sarvam', false]]);
    const stale = await engine.request('speech.preview', { providerId: 'sarvam', ...audio }); const staleApproval = await engine.request('speech.approve', { id: stale.id });
    await assert.rejects(engine.request('speech.transcribe', { previewId: stale.id, approvalId: staleApproval.id }), code('CREDENTIAL_REQUIRED'));
    assert.equal(sarvamSent().length, 0);

    await engine.request('speech.configure', { config: { id: 'sarvam', kind: 'sarvam-stt', model: 'saaras:v4', language: 'hi-IN', ratePerMinuteMinor: '100', budgetMinor: '1000' }, secret: 'engine-sarvam-secret-2' });
    await assert.rejects(engine.request('speech.transcribe', { previewId: stale.id, approvalId: staleApproval.id }), code('SPEECH_REVOKED'));
    const preview = await engine.request('speech.preview', { providerId: 'sarvam', ...audio }); const approval = await engine.request('speech.approve', { id: preview.id });
    const heard = await engine.request('speech.transcribe', { previewId: preview.id, approvalId: approval.id });
    assert.equal(heard.transcript, 'do lakh ka payment nahi aaya'); assert.deepEqual(sarvamSent().map(s => s.key), ['engine-sarvam-secret-2']);

    // A new engine on the same directory sees the same provider, its revision and its spent budget, but no key.
    await engine.request('workspace.lock', {}); await engine.close?.();
    engine = new Engine({ directory, ...storage }); await engine.request('workspace.open', { folder: 'main', passphrase });
    listed = (await engine.request('speech.list', {})).find((p: any) => p.id === 'sarvam');
    assert.equal(listed.credentialConfigured, false); assert.equal(listed.revision, 2);
    const state = (engine as any).store().read();
    assert.deepEqual(state.modelReceipts.filter((r: any) => r.kind === 'speech-preview' && r.providerId === 'sarvam').map((r: any) => [r.status, r.costReservedMinor]), [['preview', '0'], ['completed', '50']]);
    assert.ok(state.activity.some((a: any) => a.event === 'speech.provider.configured'));

    assert.deepEqual(await engine.request('modelsx.speechRevoke', { providerId: 'sarvam' }), { providerId: 'sarvam', enabled: false, revision: 3 });
    await assert.rejects(engine.request('modelsx.speechRevoke', { providerId: 'sarvam', extra: 1 }), code('INVALID_REQUEST'));
    await engine.request('workspace.lock', {}); await engine.request('workspace.open', { folder: 'main', passphrase });
    assert.equal((await engine.request('speech.list', {})).find((p: any) => p.id === 'sarvam').enabled, false);
    await assert.rejects(engine.request('speech.preview', { providerId: 'sarvam', ...audio }), code('SPEECH_UNAVAILABLE'));

    const decrypted = JSON.stringify((engine as any).store().read());
    assert.ok(decrypted.includes('"providers"')); assert.ok(decrypted.includes('saaras:v4'));
    for (const secret of ['engine-sarvam-secret', 'engine-sarvam-secret-2']) { assert.equal(decrypted.includes(secret), false); assert.equal(await filesContain(directory, secret), false); }
    await engine.request('workspace.lock', {});
  } finally { await engine.close?.(); await rm(directory, { recursive: true, force: true }); }
});
