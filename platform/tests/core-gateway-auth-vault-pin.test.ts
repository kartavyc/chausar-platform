import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { secretCustody } from '../runtime/gateway-auth/secret-store.ts';
import { pinUnlockCustody } from '../runtime/gateway-auth/pin.ts';
import type { VaultKeychainProvider } from '../runtime/vault.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

const passphrase = 'Synthetic gateway PIN passphrase';
const name = 'Synthetic PIN Co';
const PIN = '4829150736';
class FakeKeychain implements VaultKeychainProvider {
  entries = new Map<string, Uint8Array>(); retrievals = 0;
  async store(id: string, key: Uint8Array) { this.entries.set(id, Uint8Array.from(key)); }
  async retrieve(id: string) { this.retrievals++; const key = this.entries.get(id); return key ? Uint8Array.from(key) : null; }
  async remove(id: string) { this.entries.delete(id); }
}
async function fixture(t: TestContext, options: { demo?: boolean; fileAllowed?: boolean; noKeychain?: boolean } = {}) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-gw-pin-'));
  const keychain = new FakeKeychain(), engines: Engine[] = [];
  const storage = options.demo ? { demo: true, storage: 'experimental-file' as const } : installSyntheticProductionStorage(directory, ['main'], t.mock);
  // The weaker file-backed PIN is allowed only by an explicit trusted host option.
  const modules = options.fileAllowed ? { modules: { 'core-gateway-auth': { pinWithoutKeychain: true } } } : {};
  const engine = new Engine({ directory, ...storage, ...(options.noKeychain ? {} : { keychain }), ...modules }); engines.push(engine);
  t.after(async () => { for (const item of engines) await item.close().catch(() => {}); secretCustody.close(directory); await rm(directory, { recursive: true, force: true }); });
  const created = await engine.request('workspace.create', { name, passphrase });
  return { directory, keychain, engine, recoveryCode: created.recoveryCode as string, record: join(directory, 'pin-unlock', `${Buffer.from('main').toString('base64url')}.json`),
    extra: (more: Partial<ConstructorParameters<typeof Engine>[0]> = {}) => { const next = new Engine({ directory, ...storage, ...(options.noKeychain ? {} : { keychain }), ...modules, ...more }); engines.push(next); return next; } };
}
const files = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]);
const status = (engine: Engine, folder?: string) => engine.request('pin.status', folder ? { folder } : {});

test('set a PIN, lock, unlock with the PIN; the PIN is never written anywhere', async t => {
  const f = await fixture(t);
  assert.deepEqual(await status(f.engine), { enabled: false, failuresLeft: null, waitUntil: null, disabledReason: null, deviceBound: 'file' });
  const set = await f.engine.request('pin.set', { pin: PIN, passphrase });
  assert.deepEqual(set, { enabled: true, failuresLeft: 5, waitUntil: null, disabledReason: null, deviceBound: 'keychain' });
  if (process.platform !== 'win32') assert.equal(statSync(f.record).mode & 0o777, 0o600);
  const id = f.engine.vault!.vaultId;
  await f.engine.request('workspace.lock');
  assert.deepEqual(await status(f.engine), set, 'the lock screen reads the PIN state before any workspace is open');
  const reply = await f.engine.request('workspace.open', { unlock: 'pin', pin: PIN });
  assert.equal(reply.workspace.name, name); assert.equal(f.engine.vault!.vaultId, id);
  for (const file of files(f.directory)) {
    const bytes = readFileSync(file);
    assert.equal(bytes.includes(PIN), false, 'no file holds the PIN'); assert.equal(bytes.includes(passphrase), false, 'no file holds the passphrase');
  }
  const record = JSON.parse(readFileSync(f.record, 'utf8'));
  assert.deepEqual(Object.keys(record).sort(), ['binding', 'createdAt', 'deviceBound', 'failures', 'iv', 'kdf', 'salt', 'tag', 'version', 'vaultId', 'waitUntil', 'wrapped'].sort());
  assert.deepEqual(record.kdf, { name: 'scrypt', N: 32768, r: 8, p: 1 });
});

test('wrong PINs are counted, wait after three, and after five only the passphrase unlocks', async t => {
  const f = await fixture(t);
  await f.engine.request('pin.set', { pin: PIN, passphrase }); await f.engine.request('workspace.lock');
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const start = Date.now();
  for (const left of [4, 3]) {
    await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: '1357924680' }), { code: 'UNLOCK_FAILED' });
    assert.deepEqual(await status(f.engine), { enabled: true, failuresLeft: left, waitUntil: null, disabledReason: null, deviceBound: 'keychain' });
  }
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: '1357924680' }), { code: 'UNLOCK_FAILED' });
  let now = await status(f.engine);
  assert.equal(now.failuresLeft, 2); assert.equal(now.waitUntil, new Date(start + 30_000).toISOString());
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: PIN }), { code: 'PIN_WAIT' }, 'even the right PIN waits');
  assert.equal((await status(f.engine)).failuresLeft, 2, 'a refused wait is not a try');
  t.mock.timers.setTime(start + 30_001);
  assert.equal((await status(f.engine)).waitUntil, null);
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: '1357924681' }), { code: 'UNLOCK_FAILED' });
  now = await status(f.engine); assert.equal(now.failuresLeft, 1); assert.equal(now.waitUntil, new Date(start + 30_001 + 60_000).toISOString(), 'the wait doubles');
  t.mock.timers.setTime(start + 30_001 + 60_001);
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: '1357924682' }), { code: 'UNLOCK_FAILED' });
  assert.deepEqual(await status(f.engine), { enabled: false, failuresLeft: 0, waitUntil: null, disabledReason: 'too-many-tries', deviceBound: 'keychain' });
  const tombstone = JSON.parse(readFileSync(f.record, 'utf8'));
  assert.deepEqual(Object.keys(tombstone).sort(), ['at', 'disabled', 'vaultId', 'version'], 'the wrapped key is gone');
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: PIN }), { code: 'PIN_DISABLED' });
  await f.engine.request('workspace.open', { passphrase });
  assert.equal(f.engine.vault!.read().workspace.name, name);
  // Setting the PIN again replaces the tombstone.
  assert.equal((await f.engine.request('pin.set', { pin: PIN, passphrase })).enabled, true);
});

test('a right PIN resets the count', async t => {
  const f = await fixture(t);
  await f.engine.request('pin.set', { pin: PIN, passphrase }); await f.engine.request('workspace.lock');
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: '1357924680' }), { code: 'UNLOCK_FAILED' });
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: '1357924680' }), { code: 'UNLOCK_FAILED' });
  await f.engine.request('workspace.open', { unlock: 'pin', pin: PIN });
  assert.equal((await status(f.engine)).failuresLeft, 5);
});

test('a PIN record is useless off this device', async t => {
  const a = await fixture(t, { demo: true, fileAllowed: true });
  await a.engine.request('pin.set', { pin: PIN, passphrase }); await a.engine.request('workspace.lock');
  // Another app directory holding a copy of the same vault, with its own device secret and its own PIN.
  const b = await fixture(t, { demo: true, fileAllowed: true });
  await b.engine.request('workspace.lock'); await rm(join(b.directory, 'main'), { recursive: true, force: true });
  cpSync(join(a.directory, 'main'), join(b.directory, 'main'), { recursive: true });
  await b.engine.request('workspace.open', { passphrase }); await b.engine.request('pin.set', { pin: '7302958146', passphrase }); await b.engine.request('workspace.lock');
  cpSync(a.record, b.record);
  await assert.rejects(b.engine.request('workspace.open', { unlock: 'pin', pin: PIN }), { code: 'UNLOCK_FAILED' });
  // With a keychain, the device secret's store key is in this device's keychain only.
  const k = await fixture(t);
  await k.engine.request('pin.set', { pin: PIN, passphrase }); await k.engine.request('workspace.lock');
  await assert.rejects(pinUnlockCustody({ directory: k.directory, folder: 'main', pin: PIN, keychain: new FakeKeychain() }), { code: 'KEYCHAIN_UNAVAILABLE' });
  await assert.rejects(pinUnlockCustody({ directory: k.directory, folder: 'main', pin: PIN }), { code: 'KEYCHAIN_UNAVAILABLE' });
  await k.engine.request('workspace.open', { unlock: 'pin', pin: PIN });
});

test('PIN changes and PIN unlock refuse phone, outside text, other channels and non-owner contexts', async t => {
  const f = await fixture(t), owner = f.engine.bootstrapContext();
  await assert.rejects(f.engine.requestAs({ ...owner, channel: 'phone' }, 'pin.set', { pin: PIN, passphrase }), { code: 'OPEN_DESKTOP' });
  await assert.rejects(f.engine.requestAs({ ...owner, channel: 'mcp' }, 'pin.set', { pin: PIN, passphrase }), { code: 'OPEN_DESKTOP' });
  await assert.rejects(f.engine.requestAs({ ...owner, sourceTainted: true }, 'pin.set', { pin: PIN, passphrase }), { code: 'TAINTED_PIN_REQUEST' });
  await assert.rejects(f.engine.requestAs({ ...owner, sourceTainted: true }, 'pin.clear', {}), { code: 'TAINTED_PIN_REQUEST' });
  await assert.rejects(f.engine.request('pin.set', { pin: PIN, passphrase: 'not the passphrase at all' }), { code: 'PASSPHRASE_INCORRECT' });
  for (const pin of ['12345', '1234567890123', '12a456', 123456]) await assert.rejects(f.engine.request('pin.set', { pin, passphrase }), { code: 'PIN_INVALID' });
  for (const pin of ['111111', '123456', '987654', '0123456789']) await assert.rejects(f.engine.request('pin.set', { pin, passphrase }), { code: 'PIN_TOO_SIMPLE' });
  assert.equal(existsSync(f.record), false);
  await f.engine.request('pin.set', { pin: PIN, passphrase }); await f.engine.request('workspace.lock');
  for (const ctx of [{ ...owner, role: 'viewer' as const }, { ...owner, memberId: 'other-owner' }, { ...owner, epoch: owner.epoch + 1 },
    { ...owner, channel: 'phone' as const }, { ...owner, channel: 'mcp' as const }, { ...owner, sourceTainted: true }])
    await assert.rejects(f.engine.requestAs(ctx, 'workspace.open', { unlock: 'pin', pin: PIN }), { code: 'KEYCHAIN_OWNER_REQUIRED' });
  await assert.rejects(f.engine.requestAs({ ...owner, channel: 'phone' }, 'pin.status', {}), { code: 'OPEN_DESKTOP' });
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: 'abc' }), { code: 'PIN_INVALID' });
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: PIN, folder: '../main' }), { code: 'INVALID_PATH' });
  await assert.rejects(f.engine.request('pin.status', { folder: '../x' }), { code: 'INVALID_PATH' });
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: PIN, folder: 'other' }), { code: 'PIN_NOT_SET' });
  assert.equal((await status(f.engine)).failuresLeft, 5, 'refused attempts never count');
});

test('clearing, deleting, recovering or a different vault leaves no PIN that unlocks', async t => {
  const f = await fixture(t);
  await f.engine.request('pin.set', { pin: PIN, passphrase });
  assert.equal((await f.engine.request('pin.clear', {})).enabled, false);
  await f.engine.request('workspace.lock');
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: PIN }), { code: 'PIN_NOT_SET' });
  // Recovery sets a new passphrase: the PIN made under the old one is removed when the recovered vault attaches.
  await f.engine.request('workspace.open', { passphrase }); await f.engine.request('pin.set', { pin: PIN, passphrase }); await f.engine.request('workspace.lock');
  const fresh = 'Synthetic recovered PIN passphrase';
  await f.engine.request('workspace.recover', { recoveryCode: f.recoveryCode, passphrase: fresh });
  assert.equal(existsSync(f.record), false); assert.equal((await status(f.engine)).enabled, false);
  // A record naming another vault reports not enabled and never unlocks.
  await f.engine.request('pin.set', { pin: PIN, passphrase: fresh }); await f.engine.request('workspace.lock');
  const record = JSON.parse(readFileSync(f.record, 'utf8')); record.vaultId = 'another-vault';
  writeFileSync(f.record, JSON.stringify(record), { mode: 0o600 });
  assert.equal((await status(f.engine)).enabled, false);
  await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: PIN }), { code: 'UNLOCK_FAILED' });
  // Deleting a vault opened with its passphrase removes its PIN record.
  await f.engine.request('workspace.open', { passphrase: fresh }); assert.equal(existsSync(f.record), false, 'attach drops a record for another vault');
  await f.engine.request('pin.set', { pin: PIN, passphrase: fresh }); assert.equal(existsSync(f.record), true);
  await f.engine.request('workspace.delete', { confirmation: name });
  assert.equal(existsSync(f.record), false);
});

test('deleting a vault opened with its PIN removes the record through custody', async t => {
  const f = await fixture(t);
  await f.engine.request('pin.set', { pin: PIN, passphrase }); await f.engine.request('workspace.lock');
  await f.engine.request('workspace.open', { unlock: 'pin', pin: PIN });
  const id = f.engine.vault!.vaultId; assert.equal(f.keychain.entries.has(id), true);
  await f.engine.request('workspace.delete', { confirmation: name });
  assert.equal(existsSync(f.record), false); assert.equal(f.keychain.entries.has(id), false, 'native custody removal still runs');
});

test('without the keychain, setting a PIN refuses before the passphrase is checked, and writes nothing', async t => {
  for (const options of [{ demo: true }, { noKeychain: true }]) {
    const f = await fixture(t, options);
    await assert.rejects(f.engine.request('pin.set', { pin: PIN, passphrase }), { code: 'PIN_NEEDS_KEYCHAIN', message: 'Quick unlock needs this computer\u2019s keychain. Use your passphrase.' });
    await assert.rejects(f.engine.request('pin.set', { pin: PIN, passphrase: 'not the passphrase at all' }), { code: 'PIN_NEEDS_KEYCHAIN' });
    assert.equal(existsSync(f.record), false); assert.equal(existsSync(join(f.directory, 'secrets')), false, 'no device secret was made');
    assert.equal((await status(f.engine)).enabled, false);
    await f.engine.request('workspace.lock');
    await assert.rejects(f.engine.request('workspace.open', { unlock: 'pin', pin: PIN }));
    await f.engine.request('workspace.open', { passphrase });
  }
  // With the keychain the same request goes through, and the device secret is held by the keychain.
  const k = await fixture(t);
  assert.equal((await k.engine.request('pin.set', { pin: PIN, passphrase })).deviceBound, 'keychain');
});

test('only an explicit trusted host option allows the weaker file-backed PIN; a demo engine then never touches the keychain', async t => {
  const f = await fixture(t, { demo: true, fileAllowed: true });
  const set = await f.engine.request('pin.set', { pin: PIN, passphrase });
  assert.equal(set.deviceBound, 'file');
  await f.engine.request('workspace.lock');
  const before = f.keychain.retrievals;
  await f.engine.request('workspace.open', { unlock: 'pin', pin: PIN });
  assert.equal(f.keychain.retrievals, before);
  assert.equal(existsSync(join(f.directory, 'secrets', '.key')), true); assert.equal(existsSync(join(f.directory, 'secrets', '.keychain-id')), false);
});
