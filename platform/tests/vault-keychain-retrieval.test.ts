import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { Vault, ExperimentalFileSnapshotAdapter, type VaultKeychainProvider } from '../runtime/vault.ts';

const passphrase = 'Public synthetic convenience unlock passphrase';
const replacement = 'Public synthetic recovery replacement passphrase';
const name = 'Synthetic direct-entry retrieval workspace';
const unlockMessage = 'Unable to unlock vault. Check your credential or restore a valid backup.';
const unlockFailure = (error: any) => error?.code === 'UNLOCK_FAILED' && error.message === unlockMessage
  && error.cause === undefined;

// This synthetic provider retains an independent backing copy and transfers a
// new owned copy on retrieval. No platform store or native helper is executed.
class SyntheticKeychainProvider implements VaultKeychainProvider {
  entries = new Map<string, Uint8Array>();
  events: Array<{ operation: 'store' | 'retrieve' | 'remove'; vaultId: string }> = [];
  returned: Uint8Array[] = [];
  registrations: Uint8Array[] = [];
  retrievalFailure?: Error;
  removalFailure?: Error;
  beforeRetrieve?: (vaultId: string) => Promise<void>;
  beforeRemove?: (vaultId: string) => Promise<void>;
  async store(vaultId: string, key: Uint8Array) {
    assert.equal(key.byteLength, 32);
    this.events.push({ operation: 'store', vaultId });
    this.registrations.push(key);
    this.entries.set(vaultId, Uint8Array.from(key));
  }
  async retrieve(vaultId: string) {
    this.events.push({ operation: 'retrieve', vaultId });
    await this.beforeRetrieve?.(vaultId);
    if (this.retrievalFailure) throw this.retrievalFailure;
    const entry = this.entries.get(vaultId);
    if (!entry) return null;
    const owned = Uint8Array.from(entry); this.returned.push(owned); return owned;
  }
  async remove(vaultId: string) {
    this.events.push({ operation: 'remove', vaultId });
    await this.beforeRemove?.(vaultId);
    if (this.removalFailure) throw this.removalFailure;
    this.entries.get(vaultId)?.fill(0); this.entries.delete(vaultId);
  }
  clear() { for (const key of this.entries.values()) key.fill(0); this.entries.clear(); }
}

function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}
async function fixture(t: TestContext) {
  const root = await realpath(tmpdir()), directory = await mkdtemp(join(root, 'chausar-vault-keychain-retrieval-'));
  const keychain = new SyntheticKeychainProvider(), handles: Vault[] = [];
  const options = { directory, storage: 'experimental-file' as const, passphrase, keychain };
  const created = await Vault.create({ ...options, name }); handles.push(created.vault);
  const vaultId = created.vault.vaultId;
  const authorityFile = join(directory, 'authority.encrypted.json');
  const original = await readFile(authorityFile, 'utf8');
  await created.vault.close();
  t.after(async () => {
    try { for (const vault of handles) await vault.close().catch(() => {}); }
    finally {
      keychain.clear(); for (const returned of keychain.returned) returned.fill(0);
      const child = relative(root, directory);
      assert.ok(child.startsWith('chausar-vault-keychain-retrieval-') && !child.startsWith('..') && !isAbsolute(child));
      await rm(directory, { recursive: true, force: true });
    }
  });
  const open = async () => { const vault = await Vault.openWithKeychain({ directory, storage: 'experimental-file', keychain }); handles.push(vault); return vault; };
  const openPassphrase = async () => { const vault = await Vault.open(options); handles.push(vault); return vault; };
  return { directory, keychain, vaultId, authorityFile, original, recoveryCode: created.recoveryCode, handles, open, openPassphrase };
}
const absent = (file: string) => assert.rejects(access(file), { code: 'ENOENT' });
const consumed = (key: Uint8Array) => assert.deepEqual(key, new Uint8Array(key.byteLength));

test('Vault convenience unlock retrieves the actual envelope identity, authenticates committed data, and consumes only the returned key copy', async t => {
  const f = await fixture(t), backing = Uint8Array.from(f.keychain.entries.get(f.vaultId)!);
  consumed(f.keychain.registrations[0]);
  const vault = await f.open();
  assert.equal(vault.vaultId, f.vaultId); assert.equal(vault.read().workspace.name, name);
  assert.deepEqual(f.keychain.events, [{ operation: 'store', vaultId: f.vaultId }, { operation: 'retrieve', vaultId: f.vaultId }]);
  assert.equal(f.keychain.returned.length, 1); consumed(f.keychain.returned[0]);
  assert.deepEqual(f.keychain.entries.get(f.vaultId), backing);
  // Mutating the provider's transferred buffer cannot mutate the Vault key.
  f.keychain.returned[0].fill(31);
  await vault.update(state => { state.activity.push({ message: 'Committed after synthetic key retrieval' }); });
  await vault.close();
  const reopened = await f.openPassphrase();
  assert.deepEqual(reopened.read().activity, [{ message: 'Committed after synthetic key retrieval' }]);
  assert.equal(reopened.read().revision, 1); backing.fill(0);
});

test('Vault clears borrowed registration bytes after restore and after rejected registration', async t => {
  const f = await fixture(t), source = await f.openPassphrase(), backupFile = join(f.directory, 'synthetic-backup.chausar');
  await source.backup(backupFile); await source.close();
  const restored = await Vault.restore({ directory: join(f.directory, 'restored'), storage: 'experimental-file',
    backupFile, passphrase, keychain: f.keychain }); f.handles.push(restored);
  consumed(f.keychain.registrations.at(-1)!);
  assert.equal(restored.vaultId, f.vaultId); assert.equal(restored.read().workspace.name, name);
  let rejected: Uint8Array | undefined;
  const failure = new Error('Synthetic registration rejected');
  await assert.rejects(Vault.create({ directory: join(f.directory, 'failed-create'), storage: 'experimental-file', passphrase, name,
    keychain: { async store(_id, key) { rejected = key; throw failure; }, async remove() {} } }), error => error === failure);
  assert.ok(rejected); consumed(rejected);
  await absent(join(f.directory, 'failed-create', 'authority.encrypted.json'));
  await absent(join(f.directory, 'failed-create', 'writer.lock'));
});

test('Vault convenience unlock refuses a missing entry without modifying authority and releases the writer for passphrase unlock', async t => {
  const f = await fixture(t); f.keychain.entries.get(f.vaultId)!.fill(0); f.keychain.entries.delete(f.vaultId);
  await assert.rejects(f.open(), unlockFailure);
  assert.deepEqual(f.keychain.events, [{ operation: 'store', vaultId: f.vaultId }, { operation: 'retrieve', vaultId: f.vaultId }]);
  assert.equal(f.keychain.returned.length, 0); await absent(join(f.directory, 'writer.lock'));
  assert.equal(await readFile(f.authorityFile, 'utf8'), f.original);
  const fallback = await f.openPassphrase(); assert.equal(fallback.read().workspace.name, name);
});

test('Vault convenience unlock sanitizes provider errors and preserves passphrase fallback', async t => {
  const f = await fixture(t), failure = new Error('Synthetic provider detail: secret-token-placeholder');
  f.keychain.retrievalFailure = failure;
  await assert.rejects(f.open(), error => {
    assert.ok(unlockFailure(error)); assert.notEqual(error, failure);
    assert.ok(!String(error).includes('secret-token-placeholder'));
    assert.ok(!JSON.stringify(error).includes('secret-token-placeholder')); return true;
  });
  await absent(join(f.directory, 'writer.lock')); assert.equal(await readFile(f.authorityFile, 'utf8'), f.original);
  const fallback = await f.openPassphrase(); assert.equal(fallback.vaultId, f.vaultId);
  assert.equal(f.keychain.events.filter(event => event.operation === 'store').length, 1);
});

test('Vault convenience unlock rejects wrong and malformed keys, consumes transferred bytes, and leaves backing entries untouched', async t => {
  const f = await fixture(t), wrong = Uint8Array.from(f.keychain.entries.get(f.vaultId)!); wrong[0] ^= 1;
  for (const candidate of [wrong, new Uint8Array(31).fill(59), new Uint8Array(33).fill(61)]) {
    f.keychain.entries.get(f.vaultId)?.fill(0); f.keychain.entries.set(f.vaultId, candidate);
    const retained = Uint8Array.from(candidate);
    await assert.rejects(f.open(), unlockFailure);
    consumed(f.keychain.returned.at(-1)!); assert.deepEqual(f.keychain.entries.get(f.vaultId), retained);
    await absent(join(f.directory, 'writer.lock')); assert.equal(await readFile(f.authorityFile, 'utf8'), f.original);
    const fallback = await f.openPassphrase(); assert.equal(fallback.vaultId, f.vaultId); await fallback.close(); retained.fill(0);
  }
});

test('Vault convenience unlock authenticates ciphertext and envelope metadata rather than accepting a stored key alone', async t => {
  const f = await fixture(t), original = JSON.parse(f.original);
  const changedTag = Buffer.from(original.snapshot.tag, 'base64url'); changedTag[0] ^= 1;
  const changedSalt = Buffer.from(original.passphrase.salt, 'base64url'); changedSalt[0] ^= 1;
  for (const altered of [
    { ...original, snapshot: { ...original.snapshot, tag: changedTag.toString('base64url') } },
    { ...original, revision: original.revision + 1 },
    { ...original, passphrase: { ...original.passphrase, salt: changedSalt.toString('base64url') } },
  ]) {
    await writeFile(f.authorityFile, JSON.stringify(altered));
    await assert.rejects(f.open(), unlockFailure); consumed(f.keychain.returned.at(-1)!);
    await absent(join(f.directory, 'writer.lock'));
    await assert.rejects(f.openPassphrase(), unlockFailure);
    await writeFile(f.authorityFile, f.original);
    const fallback = await f.openPassphrase(); assert.equal(fallback.vaultId, f.vaultId); await fallback.close();
  }
});

test('Vault convenience unlock refuses an invalid envelope before retrieving any credential', async t => {
  const f = await fixture(t);
  await writeFile(f.authorityFile, JSON.stringify({ ...JSON.parse(f.original), id: '../untrusted-entry' }));
  await assert.rejects(f.open(), unlockFailure);
  assert.deepEqual(f.keychain.events, [{ operation: 'store', vaultId: f.vaultId }]);
  assert.equal(f.keychain.returned.length, 0); await absent(join(f.directory, 'writer.lock'));
  await writeFile(f.authorityFile, f.original); const fallback = await f.openPassphrase(); assert.equal(fallback.vaultId, f.vaultId);
});

test('Vault convenience unlock uses the loaded envelope ID exactly and rejects identity substitution even when that entry returns the original key', async t => {
  const f = await fixture(t), substitutedId = 'synthetic-substituted-envelope-id';
  f.keychain.entries.set(substitutedId, Uint8Array.from(f.keychain.entries.get(f.vaultId)!));
  await writeFile(f.authorityFile, JSON.stringify({ ...JSON.parse(f.original), id: substitutedId }));
  await assert.rejects(f.open(), unlockFailure);
  assert.deepEqual(f.keychain.events.at(-1), { operation: 'retrieve', vaultId: substitutedId });
  consumed(f.keychain.returned.at(-1)!); await absent(join(f.directory, 'writer.lock'));
  await writeFile(f.authorityFile, f.original); const fallback = await f.openPassphrase(); assert.equal(fallback.vaultId, f.vaultId);
});

test('Vault convenience unlock holds the writer while retrieval is pending and does not retrieve when another writer owns the Vault', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  f.keychain.beforeRetrieve = async vaultId => { assert.equal(vaultId, f.vaultId); entered.resolve(); await release.promise; };
  const opening = f.open();
  try {
    await entered.promise; await access(join(f.directory, 'writer.lock'));
    await assert.rejects(f.open(), { code: 'VAULT_BUSY' });
    await assert.rejects(f.openPassphrase(), { code: 'VAULT_BUSY' });
    assert.equal(f.keychain.events.filter(event => event.operation === 'retrieve').length, 1);
  } finally { release.resolve(); }
  const vault = await opening; consumed(f.keychain.returned[0]);
  await vault.close(); await absent(join(f.directory, 'writer.lock'));
});

test('Vault convenience unlock closes its transferred storage adapter on authenticated unlock failure', async t => {
  const f = await fixture(t); let closes = 0;
  class OwnedAdapter extends ExperimentalFileSnapshotAdapter { async close() { closes++; } }
  f.keychain.retrievalFailure = new Error('Synthetic provider unavailable');
  await assert.rejects(Vault.openWithKeychain({ directory: f.directory, storage: new OwnedAdapter(f.directory), keychain: f.keychain }), unlockFailure);
  assert.equal(closes, 1); await absent(join(f.directory, 'writer.lock'));
  const fallback = await f.openPassphrase(); assert.equal(fallback.vaultId, f.vaultId);
});

test('Vault recovery preserves the direct entry identity and later convenience unlock retains actual deletion custody', async t => {
  const f = await fixture(t), recovered = await Vault.recover({ directory: f.directory, storage: 'experimental-file',
    recoveryCode: f.recoveryCode, newPassphrase: replacement, keychain: f.keychain });
  f.handles.push(recovered); assert.equal(recovered.vaultId, f.vaultId); await recovered.close();
  await assert.rejects(f.openPassphrase(), unlockFailure);
  const vault = await f.open(); assert.equal(vault.vaultId, f.vaultId); assert.equal(vault.read().revision, 1);
  consumed(f.keychain.returned.at(-1)!);
  f.keychain.beforeRemove = async vaultId => { assert.equal(vaultId, f.vaultId); await absent(f.authorityFile); await access(join(f.directory, 'writer.lock')); };
  await vault.delete();
  assert.deepEqual(f.keychain.events, [{ operation: 'store', vaultId: f.vaultId }, { operation: 'retrieve', vaultId: f.vaultId }, { operation: 'remove', vaultId: f.vaultId }]);
  assert.equal(f.keychain.entries.size, 0); assert.throws(() => vault.read(), { code: 'VAULT_CLOSED' });
  await absent(join(f.directory, 'writer.lock'));
  await assert.rejects(f.open(), unlockFailure);
  assert.equal(f.keychain.events.filter(event => event.operation === 'retrieve').length, 1);
});

test('Vault convenience unlock retains exact removal failure after authority deletion and closes its writer without claiming deletion succeeded', async t => {
  const f = await fixture(t), vault = await f.open(), failure = new Error('Synthetic direct-entry removal failed');
  f.keychain.removalFailure = failure;
  await assert.rejects(vault.delete(), error => error === failure);
  assert.throws(() => vault.read(), { code: 'VAULT_CLOSED' }); assert.equal(f.keychain.entries.has(f.vaultId), true);
  await absent(f.authorityFile); await absent(join(f.directory, 'writer.lock'));
  await assert.rejects(f.open(), unlockFailure); await assert.rejects(f.openPassphrase(), unlockFailure);
  assert.equal(f.keychain.events.filter(event => event.operation === 'retrieve').length, 1);
});
