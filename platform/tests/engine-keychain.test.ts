import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { Engine, type EngineOptions } from '../runtime/engine.ts';
import { OntologyService } from '../runtime/ontology.ts';
import type { KeychainHook } from '../runtime/vault.ts';

const passphrase = 'Public synthetic Engine custody passphrase';
const replacement = 'Public synthetic replacement custody passphrase';
const name = 'Synthetic key custody workspace';
const budget = { maxEntryBytes: 1024 * 1024, maxTotalEntryBytes: 2 * 1024 * 1024, maxArtifacts: 32 };

// An in-memory contract double. Only actual Vault calls change custody; this
// exercises no native keychain provider and makes no OS acceptance claim.
class SyntheticCustody implements KeychainHook {
  entries = new Map<string, Uint8Array>();
  events: Array<{ operation: 'store' | 'remove'; vaultId: string }> = [];
  storeFailure?: Error;
  removeFailure?: Error;
  beforeRemove?: (vaultId: string) => Promise<void>;
  async store(vaultId: string, key: Uint8Array) {
    assert.equal(key.byteLength, 32);
    this.events.push({ operation: 'store', vaultId });
    this.entries.set(vaultId, Uint8Array.from(key));
    if (this.storeFailure) throw this.storeFailure;
  }
  async remove(vaultId: string) {
    this.events.push({ operation: 'remove', vaultId });
    await this.beforeRemove?.(vaultId);
    if (this.removeFailure) throw this.removeFailure;
    this.entries.get(vaultId)?.fill(0); this.entries.delete(vaultId);
  }
  clear() { for (const key of this.entries.values()) key.fill(0); this.entries.clear(); }
}

function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}
async function fixture(t: TestContext, install = true) {
  const root = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(root, /^C:[\\/]/i);
  const directory = await mkdtemp(join(root, 'chausar-engine-keychain-'));
  const custody = new SyntheticCustody(), engines: Engine[] = [];
  const engineFor = (extra: Partial<EngineOptions> = {}) => {
    const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
      ...(install ? { keychain: custody } : {}), ...extra });
    engines.push(engine); return engine;
  };
  t.after(async () => {
    try { for (const engine of engines) await engine.close(); }
    finally {
      custody.clear();
      const child = relative(root, directory);
      assert.ok(child.startsWith('chausar-engine-keychain-') && !child.startsWith('..') && !isAbsolute(child));
      await rm(directory, { recursive: true, force: true });
    }
  });
  return { directory, custody, engineFor, engine: engineFor() };
}
const create = (engine: Engine, extra: Record<string, unknown> = {}) =>
  engine.request('workspace.create', { name, passphrase, ...extra });
const capture = (engine: Engine) => engine.vault!.snapshot(() => engine.vault!.captureEncryptedCustody(budget));
const absent = (file: string) => assert.rejects(access(file), { code: 'ENOENT' });

test('Engine registers actual Vault custody, retains it through lock and fresh Engine reopen, and removes only after authorized deletion', async t => {
  const f = await fixture(t); await create(f.engine);
  const vaultId = f.engine.vault!.vaultId, key = Uint8Array.from(f.custody.entries.get(vaultId)!);
  assert.equal((await capture(f.engine)).keychainHookPresent, true);
  assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }]);
  const authority = join(f.directory, 'main', 'authority.encrypted.json');
  const unrelated = join(f.directory, 'main', 'user-note.txt'); await writeFile(unrelated, 'Synthetic retained note');
  const backup = await f.engine.request('workspace.backup');
  const member = await f.engine.request('members.add', { name: 'Scoped synthetic cofounder', role: 'cofounder', branches: ['main'] });
  await assert.rejects(f.engine.requestAs({ memberId: member.id, role: member.role, epoch: member.epoch },
    'workspace.delete', { confirmation: name }), { code: 'FORBIDDEN' });
  await assert.rejects(f.engine.request('workspace.delete', { confirmation: 'Incorrect confirmation' }), { code: 'CONFIRMATION_REQUIRED' });
  assert.deepEqual(f.custody.entries.get(vaultId), key); await access(authority); await access(backup.path);
  await f.engine.request('workspace.lock'); await f.engine.close();
  assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }]);
  const reopened = f.engineFor(); await reopened.request('workspace.open', { passphrase });
  assert.equal(reopened.vault!.vaultId, vaultId);
  assert.equal((await capture(reopened)).keychainHookPresent, true);
  assert.deepEqual(f.custody.entries.get(vaultId), key);
  f.custody.beforeRemove = async id => { assert.equal(id, vaultId); await absent(authority); await absent(backup.path); };
  const deleted = await reopened.request('workspace.delete', { confirmation: name });
  assert.equal(deleted.deleted, true); assert.equal(reopened.vault, null); assert.deepEqual(reopened.services, {});
  assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }, { operation: 'remove', vaultId }]);
  assert.equal(f.custody.entries.size, 0); await absent(join(f.directory, 'main', 'writer.lock'));
  assert.equal(await readFile(unrelated, 'utf8'), 'Synthetic retained note');
  await assert.rejects(reopened.request('workspace.open', { passphrase }), { code: 'UNLOCK_FAILED' });
  await create(reopened); assert.notEqual(reopened.vault!.vaultId, vaultId); key.fill(0);
});

test('Engine create registration failure rolls back actual authority and partial custody before retry', async t => {
  const f = await fixture(t), failure = new Error('Synthetic registration unavailable');
  f.custody.storeFailure = failure;
  await assert.rejects(create(f.engine), error => error === failure);
  const vaultId = f.custody.events[0].vaultId;
  assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }, { operation: 'remove', vaultId }]);
  assert.equal(f.custody.entries.size, 0); assert.equal(f.engine.vault, null); assert.deepEqual(f.engine.services, {});
  await absent(join(f.directory, 'main', 'authority.encrypted.json')); await absent(join(f.directory, 'main', 'writer.lock'));
  f.custody.storeFailure = undefined; await create(f.engine);
  assert.notEqual(f.engine.vault!.vaultId, vaultId); assert.equal(f.custody.entries.size, 1);
});

test('Engine failed create initialization clears its closed handle even when rollback custody removal rejects', async t => {
  const f = await fixture(t), initializationFailure = new Error('Synthetic initialization refused');
  const removalFailure = new Error('Synthetic rollback removal unavailable'); f.custody.removeFailure = removalFailure;
  t.mock.method(OntologyService.prototype, 'publish', async () => { throw initializationFailure; });
  await assert.rejects(create(f.engine), error => error === removalFailure);
  const vaultId = f.custody.events[0].vaultId;
  assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }, { operation: 'remove', vaultId }]);
  assert.equal(f.custody.entries.has(vaultId), true); assert.equal(f.engine.vault, null); assert.deepEqual(f.engine.services, {});
  assert.equal((await f.engine.request('workspace.status')).open, false);
  await absent(join(f.directory, 'main', 'authority.encrypted.json')); await absent(join(f.directory, 'main', 'writer.lock'));
  await f.engine.close(); t.mock.restoreAll(); f.custody.removeFailure = undefined;
  await create(f.engine); assert.notEqual(f.engine.vault!.vaultId, vaultId);
});

test('Engine deletion reports exact custody removal failure after authority deletion and releases its closed handle without claiming success', async t => {
  const f = await fixture(t); await create(f.engine);
  const vault = f.engine.vault!, vaultId = vault.vaultId, failure = new Error('Synthetic removal unavailable');
  f.custody.removeFailure = failure;
  await assert.rejects(f.engine.request('workspace.delete', { confirmation: name }), error => error === failure);
  assert.throws(() => vault.read(), { code: 'VAULT_CLOSED' });
  assert.equal(f.engine.vault, null); assert.deepEqual(f.engine.services, {});
  assert.equal((await f.engine.request('workspace.status')).open, false);
  assert.equal(f.custody.entries.has(vaultId), true);
  assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }, { operation: 'remove', vaultId }]);
  await absent(join(f.directory, 'main', 'authority.encrypted.json')); await absent(join(f.directory, 'main', 'writer.lock'));
  await assert.rejects(f.engine.request('workspace.open', { passphrase }), { code: 'UNLOCK_FAILED' });
  await assert.rejects(f.engine.request('workspace.delete', { confirmation: name }), { code: 'VAULT_LOCKED' });
  await f.engine.close(); await create(f.engine);
  assert.notEqual(f.engine.vault!.vaultId, vaultId); assert.equal(f.custody.entries.has(vaultId), true);
});

test('Engine holds its transition and Vault writer lock until actual custody removal settles', async t => {
  const f = await fixture(t); await create(f.engine);
  const entered = deferred(), release = deferred();
  f.custody.beforeRemove = async () => { entered.resolve(); await release.promise; };
  const deletion = f.engine.request('workspace.delete', { confirmation: name });
  try {
    await entered.promise;
    await access(join(f.directory, 'main', 'writer.lock')); await absent(join(f.directory, 'main', 'authority.encrypted.json'));
    await assert.rejects(f.engine.request('workspace.create', { name, passphrase }), { code: 'VAULT_BUSY' });
    await assert.rejects(f.engine.request('workspace.lock'), { code: 'VAULT_BUSY' });
    await assert.rejects(f.engine.request('workspace.status'), { code: 'VAULT_BUSY' });
    await assert.rejects(f.engine.close(), { code: 'VAULT_BUSY' });
  } finally { release.resolve(); await deletion; }
  assert.equal(f.engine.vault, null); assert.equal(f.custody.entries.size, 0);
  await absent(join(f.directory, 'main', 'writer.lock'));
});

test('Engine does not acknowledge deletion when the custody hook rejects with a falsy reason', async t => {
  const f = await fixture(t); await create(f.engine);
  f.custody.beforeRemove = async () => { throw undefined; };
  const outcome = await f.engine.request('workspace.delete', { confirmation: name })
    .then(() => ({ fulfilled: true }), error => ({ fulfilled: false, error }));
  assert.deepEqual(outcome, { fulfilled: false, error: undefined });
  assert.equal(f.engine.vault, null); assert.deepEqual(f.engine.services, {});
  assert.equal(f.custody.entries.size, 1); await absent(join(f.directory, 'main', 'authority.encrypted.json'));
});

test('Engine recovery retains the same custody identity without re-registering and forwards removal after another reopen', async t => {
  const f = await fixture(t), created = await create(f.engine), vaultId = f.engine.vault!.vaultId;
  const key = Uint8Array.from(f.custody.entries.get(vaultId)!);
  await f.engine.request('workspace.lock');
  await f.engine.request('workspace.recover', { recoveryCode: created.recoveryCode, passphrase: replacement });
  assert.equal(f.engine.vault!.vaultId, vaultId); assert.equal((await capture(f.engine)).keychainHookPresent, true);
  assert.deepEqual(f.custody.entries.get(vaultId), key); assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }]);
  await f.engine.request('workspace.lock');
  await assert.rejects(f.engine.request('workspace.open', { passphrase }), { code: 'UNLOCK_FAILED' });
  await f.engine.request('workspace.open', { passphrase: replacement });
  await f.engine.request('workspace.delete', { confirmation: name });
  assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }, { operation: 'remove', vaultId }]); key.fill(0);
});

test('Engine restore registers authenticated backup identity and forwards removal after lock and reopen', async t => {
  const f = await fixture(t); await create(f.engine);
  const vaultId = f.engine.vault!.vaultId, key = Uint8Array.from(f.custody.entries.get(vaultId)!);
  const backup = await f.engine.request('workspace.backup'); await f.engine.request('workspace.lock');
  await f.engine.request('workspace.restore', { folder: 'restored', backupFile: basename(backup.path), passphrase });
  assert.equal(f.engine.vault!.vaultId, vaultId); assert.deepEqual(f.custody.entries.get(vaultId), key);
  assert.equal((await capture(f.engine)).keychainHookPresent, true);
  assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }, { operation: 'store', vaultId }]);
  await f.engine.request('workspace.lock'); await f.engine.request('workspace.open', { folder: 'restored', passphrase });
  await f.engine.request('workspace.delete', { confirmation: name });
  assert.equal(f.custody.entries.size, 0); await absent(join(f.directory, 'restored', 'authority.encrypted.json'));
  // Vault backups retain their envelope identity; deletion targets that identity,
  // even when another encrypted file copy remains independently reopenable.
  await f.engine.request('workspace.open', { passphrase }); assert.equal(f.engine.vault!.vaultId, vaultId);
  assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }, { operation: 'store', vaultId }, { operation: 'remove', vaultId }]);
  key.fill(0);
});

test('Engine restore registration failure preserves Vault committed-target semantics, refuses attachment and releases the writer', async t => {
  const f = await fixture(t); await create(f.engine);
  const vaultId = f.engine.vault!.vaultId, backup = await f.engine.request('workspace.backup');
  await f.engine.request('workspace.lock');
  const failure = new Error('Synthetic restored registration unavailable'); f.custody.storeFailure = failure;
  await assert.rejects(f.engine.request('workspace.restore', { folder: 'restored', backupFile: basename(backup.path), passphrase }), error => error === failure);
  assert.equal(f.engine.vault, null); assert.deepEqual(f.engine.services, {});
  await access(join(f.directory, 'restored', 'authority.encrypted.json')); await absent(join(f.directory, 'restored', 'writer.lock'));
  f.custody.storeFailure = undefined;
  await f.engine.request('workspace.open', { folder: 'restored', passphrase });
  assert.equal(f.engine.vault!.vaultId, vaultId);
  await f.engine.request('workspace.delete', { confirmation: name }); assert.equal(f.custody.entries.size, 0);
});

test('RPC payload hooks cannot supply or replace constructor custody; omission remains supported', async t => {
  const f = await fixture(t, false);
  const payloadHook = { async store() { assert.fail('RPC must never supply key custody'); }, async remove() { assert.fail('RPC must never remove key custody'); } };
  await create(f.engine, { keychain: payloadHook }); assert.equal((await capture(f.engine)).keychainHookPresent, false);
  const created = await f.engine.request('workspace.backup'); await f.engine.request('workspace.lock');
  await f.engine.request('workspace.open', { passphrase, keychain: payloadHook });
  assert.equal((await capture(f.engine)).keychainHookPresent, false); await f.engine.request('workspace.lock');
  await f.engine.request('workspace.restore', { folder: 'restored', backupFile: basename(created.path), passphrase, keychain: payloadHook });
  assert.equal((await capture(f.engine)).keychainHookPresent, false);
  assert.equal((await f.engine.request('workspace.delete', { confirmation: name, keychain: payloadHook })).deleted, true);
  const trusted = f.engineFor({ keychain: f.custody }); await create(trusted, { folder: 'trusted', keychain: payloadHook });
  const vaultId = trusted.vault!.vaultId; await trusted.request('workspace.delete', { confirmation: name, keychain: payloadHook });
  assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }, { operation: 'remove', vaultId }]);
});

test('Engine refuses unclassified managed copies before deleting authority or calling custody removal', async t => {
  const f = await fixture(t); await create(f.engine);
  const vaultId = f.engine.vault!.vaultId;
  await f.engine.vault!.writeArtifact({ id: 'synthetic_copy', purpose: 'private-trial', value: { synthetic: true }, expectedDigest: null });
  const unmanaged = join(f.directory, 'main', 'private-artifacts', 'private-trial', 'unclassified.txt');
  await writeFile(unmanaged, 'Synthetic unclassified custody');
  await assert.rejects(f.engine.request('workspace.delete', { confirmation: name }), { code: 'ARTIFACT_INVENTORY_INCOMPLETE' });
  assert.equal(f.engine.vault!.vaultId, vaultId); await access(join(f.directory, 'main', 'authority.encrypted.json'));
  assert.equal(f.custody.entries.has(vaultId), true); assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }]);
  assert.equal(await readFile(unmanaged, 'utf8'), 'Synthetic unclassified custody');
  await unlink(unmanaged); await f.engine.request('workspace.delete', { confirmation: name });
  assert.equal(f.custody.entries.size, 0);
});

test('Engine active custody still requires explicit external keychain evidence for complete backup', async t => {
  const f = await fixture(t); await create(f.engine);
  const vaultId = f.engine.vault!.vaultId;
  await assert.rejects(f.engine.request('workspace.backup.v2.create', { destinationId: 'synthetic_archive', confirmed: true }),
    { code: 'BACKUP_EXTERNAL_KEYS_REQUIRED' });
  assert.equal(f.engine.vault!.vaultId, vaultId); assert.deepEqual(f.custody.events, [{ operation: 'store', vaultId }]);
  assert.deepEqual(await f.engine.vault!.listArtifacts({ purpose: 'workspace-interchange' }), []);
});
