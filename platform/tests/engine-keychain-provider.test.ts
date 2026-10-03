import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerEngine } from '../runtime/worker.ts';
import { createServerEngine } from '../runtime/server.ts';
import { loadEngineKeychain, type EngineKeychainHostDependencies } from '../runtime/engine-keychain-host.ts';
import type { Engine } from '../runtime/engine.ts';
import type { VaultKeychainProvider } from '../runtime/vault.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

const passphrase = 'Public synthetic native custody host passphrase';
const name = 'Synthetic direct entry host';
class SyntheticEntries implements VaultKeychainProvider {
  entries = new Map<string, Uint8Array>();
  retrievals: string[] = [];
  removalFailure?: Error;
  async store(id: string, key: Uint8Array) { this.entries.set(id, Uint8Array.from(key)); }
  async retrieve(id: string) { this.retrievals.push(id); const key = this.entries.get(id); return key ? Uint8Array.from(key) : null; }
  async remove(id: string) { if (this.removalFailure) throw this.removalFailure; this.entries.get(id)?.fill(0); this.entries.delete(id); }
  clear() { for (const key of this.entries.values()) key.fill(0); this.entries.clear(); }
}
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-keychain-provider-host-'));
  const production = installSyntheticProductionStorage(directory, ['main'], t.mock);
  const keychain = new SyntheticEntries(), engines: Engine[] = [];
  t.after(async () => { try { for (const engine of engines) await engine.close(); } finally { keychain.clear(); await rm(directory, { recursive: true, force: true }); } });
  const hold = (engine: Engine) => { engines.push(engine); return engine; };
  return { directory, keychain, hold, production };
}
for (const host of ['worker', 'server'] as const) {
  test(`${host} constructor forwards actual synthetic custody and explicitly retrieves without returning key material`, async t => {
    const f = await fixture(t), environment = { CHAUSAR_DEMO: '0', CHAUSAR_VAULT_DIRECTORY: f.directory,
      CHAUSAR_POSTGRES_URL: f.production.postgresUrl };
    const engine = f.hold(host === 'worker' ? await createWorkerEngine(environment, { keychain: f.keychain })
      : await createServerEngine(environment, ['synthetic'], { keychain: f.keychain }));
    await engine.request('workspace.create', { name, passphrase });
    const id = engine.vault!.vaultId; assert.equal(engine.options.keychain, f.keychain); assert.equal(f.keychain.entries.size, 1);
    await engine.request('workspace.lock');
    const reply = await engine.request('workspace.open', { unlock: 'keychain' });
    assert.deepEqual(Object.keys(reply), ['workspace']); assert.equal(reply.workspace.name, name);
    assert.equal(engine.vault!.vaultId, id); assert.deepEqual(f.keychain.retrievals, [id]);
    const failure = new Error('Synthetic direct-entry removal unavailable'); f.keychain.removalFailure = failure;
    await assert.rejects(engine.request('workspace.delete', { confirmation: name }), error => error === failure);
    assert.equal(engine.vault, null); assert.deepEqual(engine.services, {}); assert.equal(f.keychain.entries.has(id), true);
    await assert.rejects(access(join(f.directory, 'main', 'authority.encrypted.json')), { code: 'ENOENT' });
    await assert.rejects(access(join(f.directory, 'main', 'writer.lock')), { code: 'ENOENT' });
    await assert.rejects(engine.request('workspace.open', { unlock: 'keychain' }), { code: 'UNLOCK_FAILED' });
  });
}

test('Engine convenience unlock refuses nonowner, different owner, non-desktop and tainted contexts before retrieval', async t => {
  const f = await fixture(t), engine = f.hold(await createWorkerEngine({ CHAUSAR_DEMO: '0', CHAUSAR_VAULT_DIRECTORY: f.directory,
    CHAUSAR_POSTGRES_URL: f.production.postgresUrl }, { keychain: f.keychain }));
  await engine.request('workspace.create', { name, passphrase }); await engine.request('workspace.lock');
  const owner = engine.bootstrapContext();
  for (const ctx of [{ ...owner, role: 'viewer' as const }, { ...owner, memberId: 'other-owner' }, { ...owner, epoch: owner.epoch + 1 },
    { ...owner, channel: 'phone' as const }, { ...owner, channel: 'mcp' as const }, { ...owner, sourceTainted: true }])
    await assert.rejects(engine.requestAs(ctx, 'workspace.open', { unlock: 'keychain', key: Array(32).fill(1) }), { code: 'KEYCHAIN_OWNER_REQUIRED' });
  assert.deepEqual(f.keychain.retrievals, []);
  await engine.requestAs(owner, 'workspace.open', { unlock: 'keychain' }); assert.equal(f.keychain.retrievals.length, 1);
});

test('Engine requires installed retrieval capability and explicit keychain selection, preserving passphrase unlock', async t => {
  const f = await fixture(t), engine = f.hold(await createWorkerEngine({ CHAUSAR_DEMO: '1', CHAUSAR_VAULT_DIRECTORY: f.directory }));
  await engine.request('workspace.create', { name, passphrase }); await engine.request('workspace.lock');
  await assert.rejects(engine.request('workspace.open', { unlock: 'keychain', keychain: f.keychain }), { code: 'KEYCHAIN_PROVIDER_REQUIRED' });
  await assert.rejects(engine.request('workspace.open', { unlock: 'unreviewed', passphrase }), { code: 'INVALID_REQUEST' });
  await engine.request('workspace.open', { passphrase }); assert.equal(engine.vault!.read().workspace.name, name);
  assert.deepEqual(f.keychain.retrievals, []);
});

test('Engine missing direct entry refuses explicit convenience unlock and allows a separately requested passphrase unlock', async t => {
  const f = await fixture(t), engine = f.hold(await createWorkerEngine({ CHAUSAR_DEMO: '0', CHAUSAR_VAULT_DIRECTORY: f.directory,
    CHAUSAR_POSTGRES_URL: f.production.postgresUrl }, { keychain: f.keychain }));
  await engine.request('workspace.create', { name, passphrase }); await engine.request('workspace.lock'); f.keychain.clear();
  await assert.rejects(engine.request('workspace.open', { unlock: 'keychain', passphrase }), { code: 'UNLOCK_FAILED' });
  assert.equal(engine.vault, null); await engine.request('workspace.open', { passphrase });
  assert.equal(engine.vault!.read().workspace.name, name); assert.equal(f.keychain.entries.size, 0);
});

test('host manifest binds exact helper platform architecture and pin without executing a helper', async () => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const path = join(await realpath(tmpdir()), 'synthetic-keychain-helper', 'manifest.json');
    const executable = platform === 'win32' ? 'chausar-keychain.exe' : 'chausar-keychain', verified: unknown[] = [];
    const manifest = { format: 'chausar.keychain-helper.v1', platform, architecture: 'x64', executable, sha256: 'a'.repeat(64) };
    const dependencies: EngineKeychainHostDependencies = { keychainPlatform: platform, keychainArchitecture: 'x64',
      readKeychainManifest: async selected => { assert.equal(selected, path); return Buffer.from(JSON.stringify(manifest)); },
      keychainProcess: { verifyExecutable: async input => { verified.push(input); }, spawnProcess: () => { assert.fail('Loading custody must not execute a native helper'); } } };
    const provider = await loadEngineKeychain({ CHAUSAR_KEYCHAIN_MANIFEST: path }, dependencies);
    assert.equal(typeof provider!.retrieve, 'function');
    assert.deepEqual(verified, [{ platform, architecture: 'x64', executable: join(join(path, '..'), executable), sha256: manifest.sha256 }]);
    for (const mutation of [{ platform: 'other' }, { architecture: 'arm64' }, { executable: '../helper' }, { sha256: 'not-a-pin' }, { extra: true }])
      await assert.rejects(loadEngineKeychain({ CHAUSAR_KEYCHAIN_MANIFEST: path }, { ...dependencies,
        readKeychainManifest: async () => Buffer.from(JSON.stringify({ ...manifest, ...mutation })) }), { code: 'KEYCHAIN_MANIFEST_INVALID' });
  }
});

test('production unavailable custody refuses and demo factories omit custody before manifest or helper use', async t => {
  const f = await fixture(t), path = join(f.directory, 'manifest.json');
  const environment = { CHAUSAR_KEYCHAIN_MANIFEST: path, CHAUSAR_VAULT_DIRECTORY: f.directory };
  for (const create of [() => createWorkerEngine(environment), () => createServerEngine(environment, [])])
    await assert.rejects(create(), { code: 'KEYCHAIN_MANIFEST_INVALID' });
  let reads = 0, verifications = 0, spawns = 0;
  const dependencies: EngineKeychainHostDependencies = { keychain: f.keychain,
    readKeychainManifest: async () => { reads++; throw new Error('Demo must omit custody before manifest reads.'); },
    keychainProcess: {
      verifyExecutable: async () => { verifications++; throw new Error('Demo must omit helper verification.'); },
      spawnProcess: () => { spawns++; assert.fail('Demo must not execute a helper.'); },
    } };
  for (const [index, create] of [() => createWorkerEngine({ ...environment, CHAUSAR_DEMO: '1' }, dependencies),
    () => createServerEngine(environment, ['synthetic', '--demo'], dependencies)].entries()) {
    const engine = f.hold(await create());
    const folder = 'demo-' + index;
    assert.equal(engine.options.keychain, undefined);
    await engine.request('workspace.create', { name, passphrase, folder });
    assert.equal(f.keychain.entries.size, 0);
    await engine.request('workspace.lock');
    await assert.rejects(engine.request('workspace.open', { unlock: 'keychain', folder }), { code: 'KEYCHAIN_PROVIDER_REQUIRED' });
  }
  await assert.rejects(loadEngineKeychain(environment, { ...dependencies, keychain: undefined }, true), { code: 'KEYCHAIN_PREVIEW_REFUSED' });
  assert.deepEqual({ reads, verifications, spawns }, { reads: 0, verifications: 0, spawns: 0 });
  assert.equal(await loadEngineKeychain({}), undefined);
});
