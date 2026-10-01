import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { openBrowserBriefStore } from '../../app/companion/shared/adapters.ts';
import { EncryptedBriefCache } from '../runtime/phone/cache.ts';
import type { Brief, DeviceBinding } from '../runtime/phone/contracts.ts';

const crypto = webcrypto as unknown as Crypto;
const binding: DeviceBinding = { workspaceId: 'workspace1', memberId: 'member1', deviceId: 'device1', epoch: 1 };
const databaseName = 'fixture-only-brief-cache';
const now = Date.parse('2026-09-30T12:00:00.000Z');
const invalid = (error: unknown) => error instanceof Error && error.message === 'CACHE_INVALID';

/**
 * An asynchronous fixture for the IndexedDB subset used by this adapter.
 * It clones values, serializes transactions, stages writes until commit, allows
 * request-success callbacks to enqueue operations, and rolls back aborts.
 * This does not model browser quota, process crashes, or actual IDB persistence.
 */
class FixtureRequest {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
}
type FixtureDatabaseState = {
  stores: Map<string, Map<string, unknown>>;
  transactions: FixtureTransaction[];
  running: boolean;
  createdStores: number;
  closedConnections: number;
  failNextWriteCommit: boolean;
  pauseNextCommit?: { entered: () => void; resume: Promise<void> };
};
class FixtureTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private draft = new Map<string, unknown>();
  private requests: { request: FixtureRequest; execute: () => unknown }[] = [];
  private state: FixtureDatabaseState;
  private storeName: string;
  private mode: IDBTransactionMode;
  constructor(state: FixtureDatabaseState, storeName: string, mode: IDBTransactionMode) { this.state = state; this.storeName = storeName; this.mode = mode; }
  objectStore(name: string) {
    assert.equal(name, this.storeName);
    const request = (execute: () => unknown) => {
      const item = new FixtureRequest(); this.requests.push({ request: item, execute }); return item;
    };
    const write = () => { if (this.mode !== 'readwrite') throw new Error('Readonly fixture transaction'); };
    return {
      get: (key: string) => request(() => structuredClone(this.draft.get(key))),
      getAllKeys: () => request(() => [...this.draft.keys()]),
      put: (value: unknown, key: string) => {
        write(); const copied = structuredClone(value);
        return request(() => { this.draft.set(key, copied); return key; });
      },
      add: (value: unknown, key: string) => {
        write(); const copied = structuredClone(value);
        return request(() => { if (this.draft.has(key)) throw new Error('ConstraintError'); this.draft.set(key, copied); return key; });
      },
      delete: (key: string) => { write(); return request(() => { this.draft.delete(key); }); },
      clear: () => { write(); return request(() => { this.draft.clear(); }); },
    };
  }
  run(done: () => void) {
    this.draft = structuredClone(this.state.stores.get(this.storeName)!);
    const fail = () => { this.onabort?.(); done(); };
    const commit = () => {
      if (this.mode === 'readwrite' && this.state.failNextWriteCommit) {
        this.state.failNextWriteCommit = false; fail(); return;
      }
      if (this.mode === 'readwrite') this.state.stores.set(this.storeName, this.draft);
      this.oncomplete?.(); done();
    };
    const step = () => {
      const item = this.requests.shift();
      if (!item) {
        const pause = this.state.pauseNextCommit; this.state.pauseNextCommit = undefined;
        if (pause) { pause.entered(); void pause.resume.then(commit); } else commit();
        return;
      }
      try { item.request.result = item.execute(); item.request.onsuccess?.(); }
      catch (error) { item.request.error = error; item.request.onerror?.(); this.onerror?.(); fail(); return; }
      setImmediate(step);
    };
    setImmediate(step);
  }
}
class FixtureDatabase {
  private closed = false;
  private state: FixtureDatabaseState;
  private enqueue: (transaction: FixtureTransaction) => void;
  constructor(state: FixtureDatabaseState, enqueue: (transaction: FixtureTransaction) => void) { this.state = state; this.enqueue = enqueue; }
  createObjectStore(name: string) {
    if (this.state.stores.has(name)) throw new Error('ConstraintError');
    this.state.stores.set(name, new Map()); this.state.createdStores++;
  }
  transaction(name: string, mode: IDBTransactionMode) {
    if (this.closed || !this.state.stores.has(name)) throw new Error('InvalidStateError');
    const transaction = new FixtureTransaction(this.state, name, mode); this.enqueue(transaction); return transaction;
  }
  close() { if (!this.closed) { this.closed = true; this.state.closedConnections++; } }
}
class FixtureIDBFactory {
  private databases = new Map<string, FixtureDatabaseState>();
  failOpen = false;
  open(name: string, version: number) {
    assert.equal(version, 1);
    const request = new FixtureRequest();
    setImmediate(() => {
      if (this.failOpen) { request.error = new Error('Fixture unavailable'); request.onerror?.(); return; }
      let state = this.databases.get(name); const upgrade = !state;
      if (!state) {
        state = { stores: new Map(), transactions: [], running: false, createdStores: 0, closedConnections: 0, failNextWriteCommit: false };
        this.databases.set(name, state);
      }
      const owner = state;
      request.result = new FixtureDatabase(owner, transaction => {
        owner.transactions.push(transaction); queueMicrotask(() => this.pump(owner));
      });
      if (upgrade) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
  asFactory(): IDBFactory { return this as unknown as IDBFactory; }
  state(name = databaseName) { return this.databases.get(name)!; }
  snapshot(store: 'briefs' | 'keys') { return structuredClone(this.state().stores.get(store)!); }
  private pump(state: FixtureDatabaseState) {
    if (state.running) return;
    const transaction = state.transactions.shift(); if (!transaction) return;
    state.running = true;
    transaction.run(() => { state.running = false; this.pump(state); });
  }
}

async function fingerprint(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new TextEncoder().encode('fixture key continuity check')));
}
const sampleBrief: Brief = { id: 'brief1', workspaceId: binding.workspaceId, version: 'v1', generatedAt: new Date(now - 1000).toISOString(), title: 'Private owner brief', summary: 'A private business summary', receiptIds: ['receipt1'] };

test('browser-store fixture persists nonexportable AES-GCM keys across reopened connections', async () => {
  const fixture = new FixtureIDBFactory();
  const first = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  assert.equal(await first.keys.getKey(binding), undefined);
  await first.provision(binding);
  const original = (await first.keys.getKey(binding))!;
  assert.equal(original.type, 'secret'); assert.equal(original.extractable, false);
  assert.deepEqual(original.algorithm, { name: 'AES-GCM', length: 256 });
  assert.deepEqual([...original.usages].sort(), ['decrypt', 'encrypt']);
  await assert.rejects(crypto.subtle.exportKey('raw', original));
  const stored = [...fixture.snapshot('keys')][0];
  assert.match(stored[0], /^[a-f0-9]{64}$/);
  assert.equal((stored[1] as CryptoKey).extractable, false);
  first.close();
  const reopened = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  await reopened.provision(binding);
  const restored = (await reopened.keys.getKey(binding))!;
  assert.notEqual(restored, original);
  assert.deepEqual(await fingerprint(restored), await fingerprint(original));
  await assert.rejects(crypto.subtle.exportKey('raw', restored));
  assert.equal(fixture.state().createdStores, 2); assert.equal(fixture.state().closedConnections, 1);
  reopened.close();
});

test('concurrent provisioning retains exactly one existing key for a binding', async () => {
  const fixture = new FixtureIDBFactory();
  const first = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  const second = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? first : second).provision(binding)));
  assert.equal(fixture.snapshot('keys').size, 1);
  const original = (await first.keys.getKey(binding))!;
  await Promise.all([first.provision(binding), second.provision(binding)]);
  assert.equal(fixture.snapshot('keys').size, 1);
  assert.deepEqual(await fingerprint((await second.keys.getKey(binding))!), await fingerprint(original));
  first.close(); second.close();
});

test('workspace, member, device, and epoch changes each provision a different opaque scoped key', async () => {
  const fixture = new FixtureIDBFactory(); const store = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  await store.provision(binding); const original = await fingerprint((await store.keys.getKey(binding))!);
  for (const other of [
    { ...binding, workspaceId: 'workspace2' }, { ...binding, memberId: 'member2' },
    { ...binding, deviceId: 'device2' }, { ...binding, epoch: 2 },
  ]) {
    assert.equal(await store.keys.getKey(other), undefined);
    await store.provision(other);
    assert.notDeepEqual(await fingerprint((await store.keys.getKey(other))!), original);
  }
  assert.equal(fixture.snapshot('keys').size, 5);
  for (const id of fixture.snapshot('keys').keys()) assert.match(id, /^[a-f0-9]{64}$/);
  store.close();
});

test('opaque byte storage copies inputs and outputs and persists both typed arrays and ArrayBuffers', async () => {
  const fixture = new FixtureIDBFactory(); let store = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  const id = 'a'.repeat(64); const input = new Uint8Array([1, 2, 3]);
  const write = store.storage.set(id, input); input[0] = 99; await write;
  assert.deepEqual(await store.storage.get(id), new Uint8Array([1, 2, 3]));
  const returned = (await store.storage.get(id))!; returned[1] = 77;
  assert.deepEqual(await store.storage.get(id), new Uint8Array([1, 2, 3]));
  assert.deepEqual(await store.storage.list(), [id]);
  store.close(); store = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  assert.deepEqual(await store.storage.get(id), new Uint8Array([1, 2, 3]));
  const bufferId = 'b'.repeat(64);
  fixture.state().stores.get('briefs')!.set(bufferId, new Uint8Array([4, 5, 6]).buffer);
  const bufferRead = (await store.storage.get(bufferId))!; bufferRead[0] = 0;
  assert.deepEqual(await store.storage.get(bufferId), new Uint8Array([4, 5, 6]));
  await store.storage.remove(id); assert.equal(await store.storage.get(id), undefined);
  assert.deepEqual(await store.storage.list(), [bufferId]);
  store.close();
});

test('storage writes resolve after transaction commit and an aborted commit does not persist request success', async () => {
  const fixture = new FixtureIDBFactory(); const store = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  let entered!: () => void; let resume!: () => void;
  const commitReached = new Promise<void>(resolve => { entered = resolve; });
  const resumeCommit = new Promise<void>(resolve => { resume = resolve; });
  fixture.state().pauseNextCommit = { entered, resume: resumeCommit };
  let resolved = false; const id = 'c'.repeat(64);
  const write = store.storage.set(id, new Uint8Array([1])).then(() => { resolved = true; });
  await commitReached;
  assert.equal(resolved, false); assert.equal(fixture.snapshot('briefs').has(id), false);
  resume(); await write;
  assert.equal(resolved, true); assert.equal(fixture.snapshot('briefs').has(id), true);
  fixture.state().failNextWriteCommit = true;
  await assert.rejects(store.storage.set(id, new Uint8Array([2])), invalid);
  assert.deepEqual(await store.storage.get(id), new Uint8Array([1]));
  store.close();
});

test('encrypted brief cache integrates with reopened fixture storage and revocation clears both dedicated stores', async () => {
  const fixture = new FixtureIDBFactory(); let store = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  await store.provision(binding);
  let cache = new EncryptedBriefCache({ crypto, storage: store.storage, keys: store.keys, now: () => now });
  await cache.put(binding, sampleBrief);
  const storedBriefs = fixture.snapshot('briefs'); assert.equal(storedBriefs.size, 1);
  for (const [id, value] of storedBriefs) {
    assert.match(id, /^[a-f0-9]{64}$/); assert.equal(value instanceof Uint8Array, true);
    const text = new TextDecoder().decode(value as Uint8Array);
    for (const privateValue of [sampleBrief.title, sampleBrief.summary, sampleBrief.id, binding.workspaceId, binding.memberId, binding.deviceId]) assert.equal(text.includes(privateValue) || id.includes(privateValue), false);
  }
  store.close(); store = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  cache = new EncryptedBriefCache({ crypto, storage: store.storage, keys: store.keys, now: () => now });
  assert.deepEqual((await cache.list(binding)).map(brief => brief.id), ['brief1']);
  assert.equal((await cache.read(binding, 'brief1'))?.summary, sampleBrief.summary);
  await cache.clear();
  assert.equal(fixture.snapshot('briefs').size, 0); assert.equal(fixture.snapshot('keys').size, 0);
  assert.equal(await store.keys.getKey(binding), undefined); assert.deepEqual(await cache.list(binding), []);
  await assert.rejects(cache.put(binding, sampleBrief), invalid);
  store.close();
});

test('opening a failed fixture database reports CACHE_INVALID', async () => {
  const fixture = new FixtureIDBFactory(); fixture.failOpen = true;
  await assert.rejects(openBrowserBriefStore(fixture.asFactory(), crypto, databaseName), invalid);
});

test('key provisioning reports an aborted transaction without persisting its candidate key', async () => {
  const fixture = new FixtureIDBFactory(); const store = await openBrowserBriefStore(fixture.asFactory(), crypto, databaseName);
  fixture.state().failNextWriteCommit = true;
  await assert.rejects(store.provision(binding), invalid);
  assert.equal(await store.keys.getKey(binding), undefined); assert.equal(fixture.snapshot('keys').size, 0);
  await store.provision(binding);
  assert.equal((await store.keys.getKey(binding))?.extractable, false);
  store.close();
});
