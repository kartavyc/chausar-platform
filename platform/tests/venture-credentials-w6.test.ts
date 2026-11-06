import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { TrustService } from '../runtime/trust.ts';
import { VentureHost, createSecretShelf } from '../runtime/venture/host.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import type { VentureDeps, VentureEngineServices, ModelStatusView } from '../runtime/venture/contracts.ts';
import type { HostCredentialPort } from '../runtime/venture/models/credential-port.ts';
import { presetSpec } from '../runtime/venture/models/presets.ts';
import { VentureTestStore } from './venture-test-store.ts';
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const presetId = 'openai-gpt-6-luna', secretName = `model:${presetId}`, key = 'synthetic-credential-not-a-provider-key';
function credentials() {
  const values = new Map<string, string>();
  const port: HostCredentialPort = { async get(scope, name) { return values.get(scope + ':' + name) ?? null; }, async set(scope, name, value) { values.set(scope + ':' + name, value); }, async delete(scope, name) { values.delete(scope + ':' + name); } };
  return { values, port };
}
async function setup(port?: HostCredentialPort) {
  const store = new VentureTestStore(), clock = () => new Date('2026-10-15T09:00:00Z'), services = { trust: new TrustService(store), calculator: {}, ontology: {} } as unknown as VentureEngineServices;
  const seed = { store, clock, secrets: createSecretShelf(), host: 'test', demo: false, storage: 'experimental-file' } as unknown as VentureDeps;
  await ventureAction(seed, owner, 'admin', 'create', tx => tx.put({ ...tx.base('venture-record'), idea: 'Synthetic bookkeeping service', ideaDigest: 'synthetic', workingName: 'Synthetic Studio', country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as any, serviceType: 'bookkeeping', status: 'interview', launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now }), { create: true });
  const make = () => new VentureHost(store, services, { host: 'desktop', demo: false, storage: 'experimental-file', clock, credentials: port, modelTransport: { replay: false, async http() { throw Error('no network'); }, async process() { throw Error('no process'); } } });
  return { store, make, host: make() };
}
const connect = (host: VentureHost, apiKey = key) => host.request(owner, 'venture.models.connect', { presetId, consentDigest: presetSpec(presetId).consentDigest, apiKey });
test('desktop model keys survive host restart with workspace isolation and disappear on disconnect', async () => {
  const saved = credentials(), f = await setup(saved.port); await connect(f.host);
  assert.equal(saved.values.get(f.store.read().workspace.id + ':' + secretName), key);
  assert.equal(JSON.stringify(f.store.read()).includes(key), false); f.host.close();
  const reopened = f.make(), status = await reopened.request(owner, 'venture.models.status', {}) as ModelStatusView;
  assert.equal(status.connections.find(item => item.presetId === presetId)?.keyLoaded, true);
  const another = await setup(saved.port); assert.equal((await another.host.request(owner, 'venture.models.status', {}) as ModelStatusView).connections.length, 0);
  await reopened.request(owner, 'venture.models.disconnect', { connectionId: status.connections.find(item => item.presetId === presetId)!.id });
  assert.equal(saved.values.size, 0); reopened.close(); another.host.close();
});
test('desktop cannot report a connected key when protected persistence is absent or fails', async () => {
  for (const port of [undefined, { ...credentials().port, async set() { throw Object.assign(Error('private provider detail'), { code: 'CREDENTIAL_UNAVAILABLE' }); } }]) {
    const f = await setup(port); await assert.rejects(connect(f.host), { code: 'CREDENTIAL_UNAVAILABLE' });
    assert.equal(f.store.read().conversations.filter(row => row.kind === 'venture-model-connection').length, 0); f.host.close();
  }
});
test('locking a host during key persistence rolls back the OS value and cannot commit a connection', async () => {
  const saved = credentials(); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(done => { release = done; }), started = new Promise<void>(done => { entered = done; });
  const f = await setup({ ...saved.port, async set(scope, name, value) { await saved.port.set(scope, name, value); entered(); await gate; } });
  const connecting = connect(f.host); await started; f.host.close(); release();
  await assert.rejects(connecting, { code: 'VAULT_LOCKED' }); assert.equal(saved.values.size, 0);
  assert.equal(f.store.read().conversations.filter(row => row.kind === 'venture-model-connection').length, 0);
});

test('keeping an onboarding plan persists adopted keys before the business commit and retains the draft if protection fails', async () => {
  const saved = credentials(), source = await setup(saved.port); await connect(source.host);
  const connections = source.store.read().conversations.filter(row => row.kind === 'venture-model-connection') as any[];
  source.host.close(); saved.values.clear();
  for (const fail of [false, true]) {
    const store = new VentureTestStore(); let settled = false;
    const port = fail ? { ...saved.port, async set() { throw Object.assign(Error('synthetic failure'), { code: 'CREDENTIAL_UNAVAILABLE' }); } } : saved.port;
    const host = new VentureHost(store, { trust: new TrustService(store), ontology: { current: () => null, publish: async () => {} }, calculator: {} } as unknown as VentureEngineServices, {
      host: 'desktop', demo: false, storage: 'experimental-file', credentials: port,
      draft: { ai: () => ({ connections, calls: [] }), compose: () => null, moveKeys: shelf => shelf.set(secretName, key), settle: () => { settled = true; } },
      modelTransport: { replay: false, async http() { throw Error('no network'); }, async process() { throw Error('no process'); } },
    });
    const result = host.request(owner, 'venture.create', { idea: 'Synthetic bookkeeping service', countryCode: 'IN' });
    if (fail) {
      await assert.rejects(result, { code: 'CREDENTIAL_UNAVAILABLE' }); assert.equal(settled, false);
      assert.equal(store.read().conversations.some(row => row.kind === 'venture-record'), false);
    } else {
      await result; assert.equal(saved.values.get(store.read().workspace.id + ':' + secretName), key); assert.equal(settled, true);
    }
    host.close();
  }
});

test('OpenRouter accepts an explicit gateway model and keeps its endpoint fixed', async () => {
  const saved = credentials(), f = await setup(saved.port);
  const spec = presetSpec('openrouter' as any);
  await f.host.request(owner, 'venture.models.connect', { presetId: spec.id, consentDigest: spec.consentDigest, apiKey: key, model: 'openai/gpt-6-luna' });
  const connection = f.store.read().conversations.find(row => row.kind === 'venture-model-connection')!;
  assert.equal(connection.model, 'openai/gpt-6-luna'); assert.equal(connection.endpoint, 'https://openrouter.ai/api/v1/responses');
  assert.equal(saved.values.get(f.store.read().workspace.id + ':model:openrouter'), key);
  await assert.rejects(f.host.request(owner, 'venture.models.connect', { presetId: spec.id, consentDigest: spec.consentDigest, apiKey: key, model: '../outside' }), { code: 'INVALID_VENTURE_REQUEST' });
  f.host.close();
});
