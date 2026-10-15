import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { ConnectorCredentialStore, type StoredCredential } from '../runtime/connectors-ext/credentials.ts';
import { secretCustody, SecretStore } from '../runtime/gateway-auth/secret-store.ts';
import type { VaultKeychainProvider } from '../runtime/vault.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Synthetic in-memory keychain: UUID-keyed 32-byte entries, with switchable failures. */
class FakeKeychain implements VaultKeychainProvider {
  entries = new Map<string, Uint8Array>();
  calls: string[] = [];
  failRetrieve = false; failStore = false;
  async store(id: string, key: Uint8Array) { this.calls.push('store'); assert.match(id, UUID); assert.equal(key.byteLength, 32); if (this.failStore) throw new Error('synthetic store failure'); this.entries.set(id, Uint8Array.from(key)); }
  async retrieve(id: string) { this.calls.push('retrieve'); if (this.failRetrieve) throw new Error('synthetic retrieve failure'); const key = this.entries.get(id); return key ? Uint8Array.from(key) : null; }
  async remove(id: string) { this.calls.push('remove'); this.entries.get(id)?.fill(0); this.entries.delete(id); }
}
const credential = (secret: string): StoredCredential => ({ kind: 'key', system: 'synthetic', secret, storedAt: '2026-01-01T00:00:00.000Z' });
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-gw-secrets-'));
  const engines: Engine[] = [];
  t.after(async () => { for (const engine of engines) await engine.close().catch(() => {}); secretCustody.close(directory); await rm(directory, { recursive: true, force: true }); });
  return { directory, credentials: join(directory, 'connector-credentials'), keychain: new FakeKeychain(), hold: (engine: Engine) => { engines.push(engine); return engine; } };
}
function openWith(key: Uint8Array, file: string, aad: string) {
  const record = JSON.parse(readFileSync(file, 'utf8'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64')); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(record.sealed, 'base64')), decipher.final()]).toString('utf8');
}
const mode = (path: string) => statSync(path).mode & 0o777;

test('file mode is unchanged: no custody, or custody without a keychain, keeps the .key file store', async t => {
  const f = await fixture(t), store = new ConnectorCredentialStore(f.credentials);
  store.set('src_a', credential('alpha'));
  assert.equal(existsSync(join(f.credentials, '.key')), true); assert.equal(existsSync(join(f.credentials, '.keychain-id')), false);
  if (process.platform !== 'win32') assert.equal(mode(join(f.credentials, '.key')), 0o600);
  await secretCustody.open({ directory: f.directory });
  assert.equal(secretCustody.key(f.credentials, true), undefined);
  store.set('src_b', credential('beta'));
  assert.equal((store.get('src_a') as any).secret, 'alpha'); assert.equal((store.get('src_b') as any).secret, 'beta');
  secretCustody.close(f.directory);
  assert.equal((store.get('src_b') as any).secret, 'beta', 'a file-mode store keeps working as before');
});

test('keychain mode: a first-ever save is enrolled into the keychain and later saves seal with the keychain key', async t => {
  const f = await fixture(t);
  await secretCustody.open({ directory: f.directory, keychain: f.keychain });
  assert.equal(f.keychain.calls.length, 0, 'opening with nothing stored touches no keychain entry');
  const store = new ConnectorCredentialStore(f.credentials);
  store.set('src_a', credential('alpha'));
  await secretCustody.settled(f.directory);
  assert.equal(existsSync(join(f.credentials, '.key')), false); assert.equal(existsSync(join(f.credentials, '.keychain-id')), true);
  if (process.platform !== 'win32') assert.equal(mode(join(f.credentials, '.keychain-id')), 0o600);
  const id = readFileSync(join(f.credentials, '.keychain-id'), 'utf8'); assert.match(id, UUID);
  assert.equal(f.keychain.entries.size, 1);
  assert.equal((store.get('src_a') as any).secret, 'alpha', 'the credential sealed before enrolment still opens');
  store.set('src_b', credential('beta'));
  const file = join(f.credentials, `${Buffer.from('src_b').toString('base64url')}.cred`);
  assert.equal(JSON.parse(openWith(f.keychain.entries.get(id)!, file, 'src_b')).secret, 'beta');
  assert.equal(existsSync(join(f.credentials, '.key')), false);
});

test('migration moves an existing .key into the keychain and keeps saved credentials readable', async t => {
  const f = await fixture(t), store = new ConnectorCredentialStore(f.credentials);
  store.set('src_old', credential('kept'));
  const legacy = readFileSync(join(f.credentials, '.key'));
  await secretCustody.open({ directory: f.directory, keychain: f.keychain });
  assert.deepEqual(f.keychain.calls, ['store', 'retrieve']);
  assert.equal(existsSync(join(f.credentials, '.key')), false);
  const id = readFileSync(join(f.credentials, '.keychain-id'), 'utf8');
  assert.deepEqual(Buffer.from(f.keychain.entries.get(id)!), legacy);
  assert.equal((store.get('src_old') as any).secret, 'kept');
  // A fresh open after migration reads the key back from the keychain.
  secretCustody.close(f.directory); await secretCustody.open({ directory: f.directory, keychain: f.keychain });
  assert.equal((store.get('src_old') as any).secret, 'kept');
});

test('a migration interrupted after recording the keychain id finishes on the next open', async t => {
  const f = await fixture(t), store = new ConnectorCredentialStore(f.credentials);
  store.set('src_old', credential('kept'));
  const legacy = readFileSync(join(f.credentials, '.key')), id = '0f2c9d1e-3b4a-4c5d-8e6f-7a8b9c0d1e2f';
  await f.keychain.store(id, legacy); writeFileSync(join(f.credentials, '.keychain-id'), id, { mode: 0o600 });
  await secretCustody.open({ directory: f.directory, keychain: f.keychain });
  assert.equal(existsSync(join(f.credentials, '.key')), false);
  assert.equal((store.get('src_old') as any).secret, 'kept');
});

test('a failed migration leaves the file store exactly as it was', async t => {
  const f = await fixture(t), store = new ConnectorCredentialStore(f.credentials);
  store.set('src_old', credential('kept')); f.keychain.failStore = true;
  await secretCustody.open({ directory: f.directory, keychain: f.keychain });
  assert.equal(existsSync(join(f.credentials, '.key')), true); assert.equal(existsSync(join(f.credentials, '.keychain-id')), false);
  assert.equal((store.get('src_old') as any).secret, 'kept');
});

test('an enrolled store refuses while locked, and keys are zeroed on close', async t => {
  const f = await fixture(t), store = new ConnectorCredentialStore(f.credentials);
  store.set('src_a', credential('alpha'));
  await secretCustody.open({ directory: f.directory, keychain: f.keychain });
  const held = secretCustody.key(f.credentials, false)!;
  assert.equal(held.length, 32); assert.notDeepEqual(held, Buffer.alloc(32));
  secretCustody.close(f.directory);
  assert.deepEqual(held, Buffer.alloc(32), 'the in-memory key is zeroed on lock');
  assert.throws(() => store.get('src_a'), { code: 'SECRET_STORE_LOCKED' });
  assert.throws(() => store.set('src_b', credential('beta')), { code: 'SECRET_STORE_LOCKED' });
  assert.equal(existsSync(join(f.credentials, '.key')), false, 'a locked store never falls back to a new file key');
  // A custody whose vault is no longer attached locks itself.
  let live = true; await secretCustody.open({ directory: f.directory, keychain: f.keychain, live: () => live });
  assert.equal((store.get('src_a') as any).secret, 'alpha'); live = false;
  assert.throws(() => store.get('src_a'), { code: 'SECRET_STORE_LOCKED' });
});

test('a keychain failure after enrolment refuses rather than falling back to a file key', async t => {
  const f = await fixture(t), store = new ConnectorCredentialStore(f.credentials);
  await secretCustody.open({ directory: f.directory, keychain: f.keychain });
  store.set('src_a', credential('alpha')); await secretCustody.settled(f.directory);
  secretCustody.close(f.directory); f.keychain.failRetrieve = true;
  await secretCustody.open({ directory: f.directory, keychain: f.keychain });
  assert.throws(() => store.get('src_a'), { code: 'KEYCHAIN_UNAVAILABLE' });
  assert.throws(() => store.set('src_b', credential('beta')), { code: 'KEYCHAIN_UNAVAILABLE' });
  assert.equal(existsSync(join(f.credentials, '.key')), false);
  assert.deepEqual(secretCustody.status(f.directory).stores[0], { name: 'connector-credentials', backing: 'keychain', present: true, available: false });
  // A missing entry is the same refusal.
  secretCustody.close(f.directory); f.keychain.failRetrieve = false; f.keychain.entries.clear();
  await secretCustody.open({ directory: f.directory, keychain: f.keychain });
  assert.throws(() => store.get('src_a'), { code: 'KEYCHAIN_UNAVAILABLE' });
  // Without any keychain on this launch the enrolled store refuses, never re-keyed from a file.
  secretCustody.close(f.directory); await secretCustody.open({ directory: f.directory });
  assert.throws(() => store.get('src_a'), { code: 'KEYCHAIN_UNAVAILABLE' });
  assert.throws(() => store.set('src_c', credential('gamma')), { code: 'KEYCHAIN_UNAVAILABLE' });
  assert.equal(existsSync(join(f.credentials, '.key')), false);
});

test('SecretStore seals named secrets under custody and refuses while locked', async t => {
  const f = await fixture(t), secrets = new SecretStore(f.directory);
  await assert.rejects(secrets.set('device.one', 'x'), { code: 'SECRET_STORE_LOCKED' });
  for (const keychain of [undefined, f.keychain]) {
    await secretCustody.open({ directory: f.directory, keychain });
    await secrets.set('device.one', 'synthetic-plain-value-0001');
    assert.equal((await secrets.get('device.one'))!.toString('utf8'), 'synthetic-plain-value-0001');
    assert.equal(await secrets.has('device.one'), true); assert.equal(await secrets.get('device.none'), null);
    for (const name of ['', 'Upper', '../x', 'a/b', '1abc', 'x'.repeat(101)]) await assert.rejects(secrets.set(name, 'x'), { code: 'SECRET_NAME_INVALID' });
    await assert.rejects(secrets.set('device.empty', ''), { code: 'SECRET_VALUE_INVALID' });
    for (const name of readdirSync(join(f.directory, 'secrets'))) assert.equal(readFileSync(join(f.directory, 'secrets', name)).includes('synthetic-plain-value'), false);
    if (process.platform !== 'win32') { assert.equal(mode(join(f.directory, 'secrets', 'device.one.secret')), 0o600); assert.equal(mode(join(f.directory, 'secrets')), 0o700); }
    secretCustody.close(f.directory);
    await assert.rejects(secrets.get('device.one'), { code: 'SECRET_STORE_LOCKED' });
  }
  // The file-era secrets key moved into the keychain on first keychain use; a renamed file no longer opens (name is bound).
  assert.equal(existsSync(join(f.directory, 'secrets', '.key')), false); assert.equal(existsSync(join(f.directory, 'secrets', '.keychain-id')), true);
  await secretCustody.open({ directory: f.directory, keychain: f.keychain });
  renameSync(join(f.directory, 'secrets', 'device.one.secret'), join(f.directory, 'secrets', 'device.two.secret'));
  await assert.rejects(secrets.get('device.two'), { code: 'SECRET_STORE_INVALID' });
  assert.equal(await secrets.remove('device.two'), true); assert.equal(await secrets.has('device.two'), false);
});

test('through a real Engine the connector credential store ends up keychain-backed and locks with the workspace', async t => {
  const f = await fixture(t), engine = f.hold(new Engine({ directory: f.directory, ...installSyntheticProductionStorage(f.directory, ['main'], t.mock), keychain: f.keychain }));
  const passphrase = 'Synthetic gateway secrets passphrase';
  await engine.request('workspace.create', { name: 'Synthetic Secrets Co', passphrase });
  assert.equal(f.keychain.entries.size, 1, 'only the vault key is enrolled until a credential is saved');
  const store = new ConnectorCredentialStore(f.credentials);
  store.set('src_live', credential('engine-held'));
  await secretCustody.settled(f.directory);
  assert.equal(existsSync(join(f.credentials, '.keychain-id')), true); assert.equal(existsSync(join(f.credentials, '.key')), false);
  assert.equal(f.keychain.entries.size, 2);
  const status = await engine.request('secrets.status', {});
  assert.deepEqual(status, { backing: 'keychain', unlocked: true, stores: [
    { name: 'connector-credentials', backing: 'keychain', present: true, available: true },
    { name: 'secrets', backing: 'file', present: false, available: true }] });
  assert.equal(JSON.stringify(status).includes(f.directory), false);
  await engine.request('workspace.lock');
  assert.throws(() => store.get('src_live'), { code: 'SECRET_STORE_LOCKED' });
  await engine.request('workspace.open', { passphrase });
  assert.equal((store.get('src_live') as any).secret, 'engine-held');
  await assert.rejects(engine.requestAs({ ...engine.bootstrapContext(), channel: 'phone' }, 'secrets.status', {}), { code: 'OPEN_DESKTOP' });
});

test('a demo Engine keeps the file store even with a keychain installed', async t => {
  const f = await fixture(t), engine = f.hold(new Engine({ directory: f.directory, demo: true, storage: 'experimental-file', keychain: f.keychain }));
  await engine.request('workspace.create', { name: 'Synthetic Demo Co', passphrase: 'Synthetic gateway demo passphrase' });
  const store = new ConnectorCredentialStore(f.credentials);
  store.set('src_demo', credential('demo')); await secretCustody.settled(f.directory);
  assert.equal(existsSync(join(f.credentials, '.key')), true); assert.equal(existsSync(join(f.credentials, '.keychain-id')), false);
  assert.equal((await engine.request('secrets.status', {})).backing, 'file');
});
