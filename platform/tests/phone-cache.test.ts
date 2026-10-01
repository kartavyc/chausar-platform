import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { EncryptedBriefCache } from '../runtime/phone/cache.ts';
import type { BriefCacheKeyProvider, EncryptedBriefCacheOptions, OpaqueBriefStorage } from '../runtime/phone/cache.ts';
import type { Brief, DeviceBinding } from '../runtime/phone/contracts.ts';

const crypto = webcrypto as unknown as Crypto;
const binding: DeviceBinding = { workspaceId: 'workspace', memberId: 'member', deviceId: 'device', epoch: 1 };
const initialTime = Date.parse('2026-09-30T12:00:00.000Z');
const invalid = (error: unknown) => error instanceof Error && error.message === 'CACHE_INVALID';
const brief = (id = 'brief1', summary = 'A private business summary'): Brief => ({
  id, workspaceId: binding.workspaceId, version: 'v1', generatedAt: '2026-09-30T11:59:00.000Z',
  title: 'Owner brief', summary, receiptIds: ['receipt1'],
});

class MemoryStorage implements OpaqueBriefStorage {
  records = new Map<string, Uint8Array>();
  async list() { return [...this.records.keys()]; }
  async get(key: string) { return this.records.get(key)?.slice(); }
  async set(key: string, bytes: Uint8Array) { this.records.set(key, bytes.slice()); }
  async remove(key: string) { this.records.delete(key); }
  async clear() { this.records.clear(); }
}
class MemoryKeys implements BriefCacheKeyProvider {
  key: CryptoKey | undefined;
  requested: DeviceBinding[] = [];
  clearCount = 0;
  constructor(key: CryptoKey) { this.key = key; }
  async getKey(owner: DeviceBinding) { this.requested.push({ ...owner }); return this.key; }
  async clear() { this.key = undefined; this.clearCount++; }
}
async function fixture(options: Partial<EncryptedBriefCacheOptions> = {}) {
  const storage = new MemoryStorage();
  const keys = new MemoryKeys(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  let time = initialTime;
  const cache = new EncryptedBriefCache({ crypto, storage, keys, now: () => time, ...options });
  return { cache, storage, keys, time: () => time, advance: (ms: number) => { time += ms; } };
}
async function recordKey(owner: DeviceBinding, id: string): Promise<string> {
  const ownerText = JSON.stringify([owner.workspaceId, owner.memberId, owner.deviceId, owner.epoch]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['chausar-phone-brief-v1', ownerText, id]))));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function encryptedPayload(owner: DeviceBinding, id: string, payload: unknown, key: CryptoKey): Promise<Uint8Array> {
  const storageId = await recordKey(owner, id);
  const ownerText = JSON.stringify([owner.workspaceId, owner.memberId, owner.deviceId, owner.epoch]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, tagLength: 128,
    additionalData: new TextEncoder().encode(JSON.stringify(['chausar-phone-brief-v1', ownerText, storageId])),
  }, key, new TextEncoder().encode(JSON.stringify(payload))));
  const bytes = new Uint8Array(13 + ciphertext.length);
  bytes[0] = 1; bytes.set(iv, 1); bytes.set(ciphertext, 13);
  return bytes;
}

test('only allowlisted brief fields are encrypted; storage identifiers and bytes omit plaintext and credentials', async () => {
  const { cache, storage, keys } = await fixture();
  const input = { ...brief(), credential: 'NEVER_STORE_CREDENTIAL', session: { token: 'NEVER_STORE_TOKEN' }, approval: { token: 'NEVER_STORE_APPROVAL' } };
  await cache.put(binding, input);
  const cached = await cache.read(binding, input.id);
  assert.deepEqual(cached, { ...brief(), cachedAt: '2026-09-30T12:00:00.000Z', expiresAt: '2026-10-01T12:00:00.000Z' });
  assert.equal(storage.records.size, 1);
  const [id, bytes] = [...storage.records][0];
  assert.match(id, /^[a-f0-9]{64}$/);
  const storedText = new TextDecoder().decode(bytes);
  for (const value of [input.summary, input.title, input.id, binding.workspaceId, binding.memberId, binding.deviceId, input.credential, input.session.token, input.approval.token]) {
    assert.equal(id.includes(value) || storedText.includes(value), false);
  }
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: bytes.slice(1, 13), tagLength: 128,
    additionalData: new TextEncoder().encode(JSON.stringify(['chausar-phone-brief-v1', JSON.stringify([binding.workspaceId, binding.memberId, binding.deviceId, binding.epoch]), id])),
  }, keys.key!, bytes.slice(13));
  assert.deepEqual(Object.keys(JSON.parse(new TextDecoder().decode(plaintext))).sort(), ['cachedAt', 'expiresAt', 'generatedAt', 'id', 'receiptIds', 'summary', 'title', 'version', 'workspaceId'].sort());
});

test('every replacement uses a fresh AES-GCM nonce and returns defensive field copies', async () => {
  const { cache, storage } = await fixture(); const input = brief();
  await cache.put(binding, input); const first = [...storage.records.values()][0].slice();
  input.receiptIds.push('later');
  assert.deepEqual((await cache.read(binding, input.id))?.receiptIds, ['receipt1']);
  const cached = (await cache.read(binding, input.id))!; cached.receiptIds.push('clientChange');
  assert.deepEqual((await cache.read(binding, input.id))?.receiptIds, ['receipt1']);
  await cache.put(binding, brief()); const second = [...storage.records.values()][0];
  assert.notDeepEqual(first.slice(1, 13), second.slice(1, 13));
  assert.notDeepEqual(first, second);
});

test('an encrypted cache survives client restart without deriving or recreating its protected key', async () => {
  const { cache, storage, keys } = await fixture(); await cache.put(binding, brief());
  const restarted = new EncryptedBriefCache({ crypto, storage, keys, now: () => initialTime });
  assert.equal((await restarted.read(binding, 'brief1'))?.summary, brief().summary);
  assert.deepEqual(keys.requested[0], binding);
});

test('expiry removes the snapshot at the exact TTL boundary and missing records stay absent', async () => {
  const { cache, storage, advance } = await fixture({ ttlMs: 1000 });
  await cache.put(binding, brief()); advance(999);
  assert.equal((await cache.read(binding, 'brief1'))?.id, 'brief1'); advance(1);
  assert.equal(await cache.read(binding, 'brief1'), undefined);
  assert.equal(storage.records.size, 0);
  assert.equal(await cache.read(binding, 'missing'), undefined);
});

test('tampered ciphertext, nonce, and format fail closed and remove the affected snapshot', async () => {
  const { cache, storage } = await fixture();
  for (const offset of [0, 1, 35]) {
    await cache.put(binding, brief()); const [id, bytes] = [...storage.records][0];
    bytes[offset] ^= 1;
    await assert.rejects(cache.read(binding, 'brief1'), invalid);
    assert.equal(storage.records.has(id), false);
  }
});

test('ciphertext transplanted across workspace, member, device, or epoch cannot be read even with the same key', async () => {
  const { cache, storage } = await fixture();
  await cache.put(binding, brief()); const original = [...storage.records.values()][0].slice();
  for (const other of [
    { ...binding, workspaceId: 'otherWorkspace' }, { ...binding, memberId: 'otherMember' },
    { ...binding, deviceId: 'otherDevice' }, { ...binding, epoch: 2 },
  ]) {
    assert.equal(await cache.read(other, 'brief1'), undefined);
    const destination = await recordKey(other, 'brief1');
    await storage.set(destination, original);
    await assert.rejects(cache.read(other, 'brief1'), invalid);
    assert.equal(storage.records.has(destination), false);
  }
  assert.equal((await cache.read(binding, 'brief1'))?.id, 'brief1');
});

test('a renamed record cannot impersonate another brief under the same device binding', async () => {
  const { cache, storage } = await fixture(); await cache.put(binding, brief());
  const destination = await recordKey(binding, 'brief2'); await storage.set(destination, [...storage.records.values()][0]);
  await assert.rejects(cache.read(binding, 'brief2'), invalid);
  assert.equal(storage.records.has(destination), false);
});

test('missing, revoked, wrong, and exportable keys cannot decrypt cached data or write new snapshots', async () => {
  const { cache, storage, keys } = await fixture(); const originalKey = keys.key;
  const wrongKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const exportableKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  for (const unusable of [undefined, wrongKey, exportableKey]) {
    keys.key = originalKey; await cache.put(binding, brief()); keys.key = unusable;
    await assert.rejects(cache.read(binding, 'brief1'), invalid);
    assert.equal(storage.records.size, 0);
  }
  keys.key = undefined; await assert.rejects(cache.put(binding, brief()), invalid);
  keys.key = exportableKey; await assert.rejects(cache.put(binding, brief()), invalid);
  assert.equal(storage.records.size, 0);
});

test('invalid brief, workspace mismatch, invalid binding, and oversized UTF-8 content are rejected before storage', async () => {
  const { cache, storage } = await fixture({ maxRecordBytes: 1024, maxTotalBytes: 1024 });
  for (const input of [
    { ...brief(), workspaceId: 'elsewhere' }, { ...brief(), receiptIds: ['bad/id'] },
    { ...brief(), summary: '😀'.repeat(300) },
  ]) await assert.rejects(cache.put(binding, input), invalid);
  await assert.rejects(cache.put({ ...binding, epoch: 0 }, brief()), invalid);
  await assert.rejects(cache.read(binding, '../brief'), invalid);
  assert.equal(storage.records.size, 0);
});

test('configured retention and size budgets have finite hard limits', async () => {
  const { storage, keys } = await fixture();
  for (const options of [
    { ttlMs: 0 }, { ttlMs: Infinity }, { ttlMs: NaN }, { ttlMs: 7 * 86400000 + 1 },
    { maxEntries: 0 }, { maxEntries: 51 }, { maxEntries: 1.5 },
    { maxRecordBytes: 128 * 1024 + 1 }, { maxTotalBytes: 2 * 1024 * 1024 + 1 },
    { maxRecordBytes: 2048, maxTotalBytes: 1024 },
  ]) assert.throws(() => new EncryptedBriefCache({ crypto, storage, keys, ...options }), invalid);
});

test('entry and total-byte budgets evict oldest authenticated snapshots, including after restart', async () => {
  const count = await fixture({ maxEntries: 2 });
  await count.cache.put(binding, brief('first')); count.advance(1);
  await count.cache.put(binding, brief('second')); count.advance(1);
  const restarted = new EncryptedBriefCache({ crypto, storage: count.storage, keys: count.keys, now: count.time, maxEntries: 2 });
  await restarted.put(binding, brief('third'));
  assert.equal(await restarted.read(binding, 'first'), undefined);
  assert.equal((await restarted.read(binding, 'second'))?.id, 'second');
  assert.equal((await restarted.read(binding, 'third'))?.id, 'third');
  const bytes = await fixture({ maxEntries: 10, maxRecordBytes: 1024, maxTotalBytes: 1024 });
  await bytes.cache.put(binding, brief('large1', 'x'.repeat(400))); bytes.advance(1);
  await bytes.cache.put(binding, brief('large2', 'x'.repeat(400)));
  assert.equal(await bytes.cache.read(binding, 'large1'), undefined);
  assert.equal((await bytes.cache.read(binding, 'large2'))?.id, 'large2');
  assert.equal([...bytes.storage.records.values()].reduce((size, record) => size + record.byteLength, 0) <= 1024, true);
});

test('put removes expired, corrupt, and previous-binding entries before retaining new data', async () => {
  const { cache, storage, advance } = await fixture({ ttlMs: 1000 });
  await cache.put(binding, brief('expired')); advance(1000);
  await cache.put(binding, brief('newer'));
  assert.equal(await cache.read(binding, 'expired'), undefined);
  const corruptId = await recordKey(binding, 'corrupt'); await storage.set(corruptId, new Uint8Array(30));
  const newerBinding = { ...binding, epoch: 2 }; advance(1);
  await cache.put(newerBinding, brief('current'));
  assert.equal(storage.records.size, 1);
  assert.equal(await cache.read(binding, 'newer'), undefined);
  assert.equal((await cache.read(newerBinding, 'current'))?.id, 'current');
});

test('authenticated payload validation rejects impossible retention, future cache timestamps, and wrong brief ids', async () => {
  const { cache, storage, keys } = await fixture({ ttlMs: 1000 });
  const normal = { ...brief(), cachedAt: new Date(initialTime).toISOString(), expiresAt: new Date(initialTime + 1000).toISOString() };
  for (const changed of [
    { ...normal, expiresAt: new Date(initialTime + 1001).toISOString() },
    { ...normal, cachedAt: new Date(initialTime + 1).toISOString() },
    { ...normal, expiresAt: 'not-a-date' }, { ...normal, cachedAt: [] }, { ...normal, id: 'otherBrief' },
  ]) {
    await storage.set(await recordKey(binding, 'brief1'), await encryptedPayload(binding, 'brief1', changed, keys.key!));
    await assert.rejects(cache.read(binding, 'brief1'), invalid);
    assert.equal(storage.records.size, 0);
  }
});

test('clear erases storage and protected keys after an already-started put and rejects subsequent offline writes', async () => {
  const { cache, storage, keys } = await fixture();
  let release!: () => void; let entered!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const normalSet = storage.set.bind(storage);
  storage.set = async (id, bytes) => { entered(); await paused; await normalSet(id, bytes); };
  const put = cache.put(binding, brief()); await started;
  const clear = cache.clear(); release(); await Promise.all([put, clear]);
  assert.equal(storage.records.size, 0); assert.equal(keys.key, undefined); assert.equal(keys.clearCount, 1);
  assert.equal(await cache.read(binding, 'brief1'), undefined);
  await assert.rejects(cache.put(binding, brief()), invalid);
});

test('clear attempts both erasure adapters and reports failure without exposing adapter details', async () => {
  const { cache, storage, keys } = await fixture(); await cache.put(binding, brief());
  storage.clear = () => { throw new Error('sensitive adapter diagnostic'); };
  await assert.rejects(cache.clear(), invalid);
  assert.equal(keys.key, undefined); assert.equal(keys.clearCount, 1);
  await assert.rejects(cache.read(binding, 'brief1'), invalid);
  assert.equal(storage.records.size, 0);
});

test('storage is erased even if protected-key erasure fails; provider exceptions remain opaque', async () => {
  const { cache, storage, keys } = await fixture(); await cache.put(binding, brief());
  keys.clear = () => { throw new Error('secret key adapter diagnostic'); };
  await assert.rejects(cache.clear(), invalid);
  assert.equal(storage.records.size, 0);
  keys.getKey = () => { throw new Error('secret key provider diagnostic'); };
  await assert.rejects(cache.put(binding, brief()), invalid);
  assert.equal(storage.records.size, 0);
});

test('malformed or excessive opaque storage indexes are cleared and cannot bypass cache budgets', async () => {
  const { cache, storage } = await fixture();
  for (const ids of [['../outside'], Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(64, '0')), ['0'.repeat(64), '0'.repeat(64)]]) {
    storage.list = async () => ids;
    await assert.rejects(cache.put(binding, brief()), invalid);
    assert.equal(storage.records.size, 0);
  }
});

test('list recovers briefs after restart in newest-first order without persisting plaintext metadata', async () => {
  const { cache, storage, keys, advance, time } = await fixture();
  await cache.put(binding, brief('older', 'Private older summary')); advance(1);
  const newerInput = { ...brief('newer', 'Private newer summary'), credential: 'NO_CREDENTIAL', approval: { token: 'NO_APPROVAL_TOKEN' } };
  await cache.put(binding, newerInput);
  const persisted = [...storage.records].map(([id, bytes]) => [id, bytes.slice()] as const);
  const restarted = new EncryptedBriefCache({ crypto, storage, keys, now: time });
  const snapshots = await restarted.list(binding);
  assert.deepEqual(snapshots.map(snapshot => snapshot.id), ['newer', 'older']);
  assert.deepEqual([...storage.records], persisted);
  assert.equal(storage.records.size, 2);
  for (const [id, bytes] of storage.records) {
    assert.match(id, /^[a-f0-9]{64}$/);
    const text = new TextDecoder().decode(bytes);
    for (const privateValue of ['older', 'newer', 'Private older summary', 'Private newer summary', 'NO_CREDENTIAL', 'NO_APPROVAL_TOKEN', 'cachedAt', 'expiresAt']) {
      assert.equal(id.includes(privateValue) || text.includes(privateValue), false);
    }
  }
  snapshots[0].receiptIds.push('localMutation'); snapshots[0].summary = 'changed'; snapshots.pop();
  const secondList = await restarted.list(binding);
  assert.deepEqual(secondList.map(snapshot => snapshot.id), ['newer', 'older']);
  assert.deepEqual(secondList[0].receiptIds, ['receipt1']);
  assert.equal(secondList[0].summary, 'Private newer summary');
  assert.deepEqual(Object.keys(secondList[0]).sort(), ['cachedAt', 'expiresAt', 'generatedAt', 'id', 'receiptIds', 'summary', 'title', 'version', 'workspaceId'].sort());
});

test('list removes expired, tampered, and wrong-binding snapshots while returning valid current-binding briefs', async () => {
  const { cache, storage, keys, advance } = await fixture({ ttlMs: 1000 });
  await cache.put(binding, brief('expired')); advance(200);
  await cache.put(binding, brief('valid'));
  const tamperedId = await recordKey(binding, 'tampered');
  const payload = { ...brief('tampered'), cachedAt: new Date(initialTime + 200).toISOString(), expiresAt: new Date(initialTime + 1200).toISOString() };
  const tampered = await encryptedPayload(binding, 'tampered', payload, keys.key!); tampered[35] ^= 1;
  await storage.set(tamperedId, tampered);
  const other = { ...binding, epoch: 2 };
  const otherId = await recordKey(other, 'otherBinding');
  await storage.set(otherId, await encryptedPayload(other, 'otherBinding', { ...payload, id: 'otherBinding' }, keys.key!));
  advance(800);
  assert.deepEqual((await cache.list(binding)).map(snapshot => snapshot.id), ['valid']);
  assert.equal(storage.records.size, 1);
  assert.equal(storage.records.has(tamperedId), false); assert.equal(storage.records.has(otherId), false);
  advance(200);
  assert.deepEqual(await cache.list(binding), []); assert.equal(storage.records.size, 0);
});

test('list respects tighter entry and byte budgets after restart, evicting oldest snapshots', async () => {
  const { cache, storage, keys, time, advance } = await fixture();
  for (const id of ['oldest', 'middle', 'newest']) { await cache.put(binding, brief(id, 'x'.repeat(400))); advance(1); }
  const countBound = new EncryptedBriefCache({ crypto, storage, keys, now: time, maxEntries: 2 });
  assert.deepEqual((await countBound.list(binding)).map(snapshot => snapshot.id), ['newest', 'middle']);
  assert.equal(storage.records.size, 2);
  const byteBound = new EncryptedBriefCache({ crypto, storage, keys, now: time, maxRecordBytes: 1024, maxTotalBytes: 1024 });
  assert.deepEqual((await byteBound.list(binding)).map(snapshot => snapshot.id), ['newest']);
  assert.equal(storage.records.size, 1);
  assert.equal([...storage.records.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0) <= 1024, true);
});

test('list reports a locked or unavailable key without recreating it or revealing adapter diagnostics', async () => {
  const { cache, storage, keys } = await fixture(); await cache.put(binding, brief());
  const protectedKey = keys.key; keys.key = undefined;
  await assert.rejects(cache.list(binding), invalid);
  assert.equal(storage.records.size, 1); assert.equal(keys.key, undefined);
  keys.key = protectedKey;
  assert.equal((await cache.list(binding))[0].id, 'brief1');
  keys.getKey = () => { throw new Error('private platform key details'); };
  await assert.rejects(cache.list(binding), invalid);
  assert.equal(storage.records.size, 1);
});

test('list serializes with writes and revocation cleanup, and validates scope and storage index', async () => {
  const { cache, storage, keys } = await fixture();
  let release!: () => void; let entered!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const normalSet = storage.set.bind(storage);
  storage.set = async (id, bytes) => { entered(); await paused; await normalSet(id, bytes); };
  const put = cache.put(binding, brief()); await started;
  const list = cache.list(binding); const clear = cache.clear(); const afterClear = cache.list(binding);
  release(); await put;
  assert.equal((await list)[0].id, 'brief1'); await clear;
  assert.deepEqual(await afterClear, []); assert.equal(storage.records.size, 0); assert.equal(keys.key, undefined);
  await assert.rejects(cache.list({ ...binding, epoch: 0 }), invalid);
  storage.list = async () => ['plaintext-brief-index'];
  await assert.rejects(cache.list(binding), invalid);
});
