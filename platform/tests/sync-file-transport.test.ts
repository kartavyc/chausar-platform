import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, unlink } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSyncTransport } from '../runtime/sync-file-transport.ts';
import { SyncService, snapshotHash } from '../runtime/sync.ts';
import type { SyncLease, SyncSnapshot } from '../runtime/sync.ts';
import { hash, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { Vault } from '../runtime/vault.ts';
import { encryptedFixture } from './fixtures/sync-file-transport-worker.ts';

const start = '2026-10-01T12:00:00.000Z';
const code = (expected: string) => (error: any) => error.code === expected;
async function fixture(t: TestContext, limits: { maxBlobBytes?: number; maxLeaseTtlMs?: number } = {}) {
  const temporaryRoot = resolve(tmpdir());
  if (process.platform === 'win32') assert.match(temporaryRoot, /^C:\\/i, 'These fixtures must use C-only temporary directories.');
  const directory = await mkdtemp(join(temporaryRoot, 'chausar-sync-file-fixture-'));
  t.after(async () => {
    assert.ok(relative(temporaryRoot, directory).startsWith('chausar-sync-file-fixture-'));
    await rm(directory, { recursive: true, force: true });
  });
  let time = new Date(start);
  const options = { directory, workspaceId: 'workspace', vaultId: 'vault', clock: () => time, ...limits };
  return { directory, options, transport: new FileSyncTransport(options), advance: (ms: number) => { time = new Date(time.getTime() + ms); }, setTime: (value: string) => { time = new Date(value); } };
}
const leaseInput = (deviceId = 'device-a', now = start, ttlMs = 1000) => ({ deviceId, memberId: 'owner', epoch: 1, now, ttlMs });
async function lease(transport: FileSyncTransport): Promise<SyncLease> { const value = await transport.acquireLease(leaseInput()); assert.ok(value); return value; }
const publication = (value: SyncLease, snapshot = encryptedFixture(value), expectedHeadHash: string | null = snapshot.previousHash) => ({ lease: value, expectedHeadHash, snapshot, recordHash: snapshotHash(snapshot), now: start });

test('file transport starts empty and returns independent immutable encrypted records', async t => {
  const { transport, directory } = await fixture(t);
  assert.equal(transport.kind, 'local-file-ciphertext-store');
  assert.equal(await transport.getHead(), null);
  assert.equal(await transport.get('0'.repeat(64)), null);
  const current = await lease(transport), input = publication(current), head = await transport.put(input);
  assert.deepEqual(head, { recordHash: input.recordHash, workspaceId: 'workspace', vaultId: 'vault', revision: 1, sequence: 1, fence: current.fence });
  const originalBytes = await readFile(join(directory, 'blobs', `${input.recordHash}.json`), 'utf8');
  const returned = (await transport.get(input.recordHash))!; returned.signature = 'changed'; head.revision = 999;
  assert.deepEqual(await transport.get(input.recordHash), input.snapshot);
  assert.equal((await transport.getHead())!.revision, 1);
  assert.equal(await readFile(join(directory, 'blobs', `${input.recordHash}.json`), 'utf8'), originalBytes);
});

test('active lease binds device, member and epoch; renewal rotates token and fence across restart', async t => {
  const { transport, options } = await fixture(t);
  const first = await lease(transport);
  assert.equal(await transport.acquireLease(leaseInput('other-device')), null);
  assert.equal(await transport.acquireLease({ ...leaseInput(), memberId: 'other-member' }), null);
  assert.equal(await transport.acquireLease({ ...leaseInput(), epoch: 2 }), null);
  const restarted = new FileSyncTransport(options), renewed = await lease(restarted);
  assert.ok(renewed.fence > first.fence); assert.notEqual(renewed.token, first.token);
  await assert.rejects(transport.put(publication(first)), code('FENCE_REJECTED'));
  await restarted.put(publication(renewed));
  assert.equal((await transport.getHead())!.fence, renewed.fence);
});

test('exact lease fields are required and caller timestamps cannot advance trusted expiry', async t => {
  const { transport, advance } = await fixture(t);
  const current = await lease(transport), future = '2099-01-01T00:00:00.000Z';
  assert.equal(await transport.acquireLease(leaseInput('other-device', future)), null);
  for (const mutation of [{ token: `${current.token}-changed` }, { expiresAt: future }, { memberId: 'other' }, { epoch: 2 }, { deviceId: 'other' }, { fence: current.fence + 1 }]) {
    await assert.rejects(transport.put(publication({ ...current, ...mutation })), code('FENCE_REJECTED'));
  }
  advance(1000);
  await assert.rejects(transport.put({ ...publication(current), now: start }), code('FENCE_REJECTED'));
  const next = await transport.acquireLease(leaseInput('other-device', start)); assert.ok(next);
  assert.ok(next.fence > current.fence); assert.equal(next.expiresAt, '2026-10-01T12:00:02.000Z');
});

test('clock regression is retained durably and rejected by a restarted transport', async t => {
  const { transport, options, advance, setTime } = await fixture(t);
  await lease(transport); advance(500); await lease(transport);
  setTime(start);
  await assert.rejects(new FileSyncTransport(options).acquireLease(leaseInput()), code('SYNC_CLOCK_REGRESSED'));
});

test('a rejected expired publication durably prevents lease resurrection after a clock rewind', async t => {
  const { transport, options, advance, setTime } = await fixture(t), current = await lease(transport);
  advance(1001); await assert.rejects(transport.put(publication(current)), code('FENCE_REJECTED'));
  setTime('2026-10-01T12:00:00.001Z');
  await assert.rejects(new FileSyncTransport(options).put(publication(current)), code('SYNC_CLOCK_REGRESSED'));
});

test('expiry during the final durable commit boundary refuses the head and retains an unpublished blob', async t => {
  const { options, advance } = await fixture(t); let armed = false;
  const transport = new FileSyncTransport({ ...options, fault: point => { if (armed && point === 'before-state-commit') advance(1001); } });
  const current = await lease(transport), input = publication(current); armed = true;
  await assert.rejects(transport.put(input), code('FENCE_REJECTED'));
  const reader = new FileSyncTransport(options);
  assert.equal(await reader.getHead(), null); assert.deepEqual(await reader.get(input.recordHash), input.snapshot);
});

test('missing authority after durable identity initialization refuses fence reset', async t => {
  const { transport, options, directory } = await fixture(t); await lease(transport);
  await unlink(join(directory, 'authority.json'));
  const restarted = new FileSyncTransport(options);
  await assert.rejects(restarted.getHead(), code('SYNC_STORE_CORRUPT'));
  await assert.rejects(restarted.acquireLease(leaseInput()), code('SYNC_STORE_CORRUPT'));
});

test('an interrupted identity-marker initialization cannot silently create a fresh authority', async t => {
  const { transport, directory } = await fixture(t); await mkdir(join(directory, 'blobs'));
  await writeFile(join(directory, 'store.json'), JSON.stringify({ format: 'chausar.file-sync.v1', storeId: '00000000-0000-0000-0000-000000000001', workspaceId: 'workspace', vaultId: 'vault' }));
  await assert.rejects(transport.getHead(), code('SYNC_STORE_CORRUPT'));
  await assert.rejects(transport.acquireLease(leaseInput()), code('SYNC_STORE_CORRUPT'));
});

test('head CAS, strict revision and contiguous sequence reject stale publication', async t => {
  const { transport } = await fixture(t);
  const current = await lease(transport), first = publication(current); await transport.put(first);
  await assert.rejects(transport.put(publication(current, encryptedFixture(current, { revision: 2 }))), code('SYNC_CAS_CONFLICT'));
  for (const options of [{ revision: 1, sequence: 2 }, { revision: 0, sequence: 2 }, { revision: 2, sequence: 3 }]) {
    const candidate = encryptedFixture(current, { ...options, previousHash: first.recordHash });
    await assert.rejects(transport.put(publication(current, candidate)), code('SYNC_REPLAY'));
  }
  const next = publication(current, encryptedFixture(current, { revision: 2, sequence: 2, previousHash: first.recordHash }));
  await transport.put(next); assert.deepEqual(await transport.get(first.recordHash), first.snapshot);
  assert.equal((await transport.getHead())!.recordHash, next.recordHash);
});

test('workspace and vault identity are persisted and cannot be changed by a new adapter', async t => {
  const { transport, options } = await fixture(t);
  const current = await lease(transport);
  for (const candidate of [encryptedFixture(current, { workspaceId: 'other-workspace' }), encryptedFixture(current, { vaultId: 'other-vault' })]) {
    await assert.rejects(transport.put(publication(current, candidate)), code('SYNC_WORKSPACE_MISMATCH'));
  }
  for (const identity of [{ workspaceId: 'other-workspace' }, { vaultId: 'other-vault' }]) {
    await assert.rejects(new FileSyncTransport({ ...options, ...identity }).getHead(), code('SYNC_WORKSPACE_MISMATCH'));
  }
  assert.equal(await transport.getHead(), null);
});

test('bounds, snapshot digest, payload envelope and opaque metadata are enforced before publication', async t => {
  const { transport, directory } = await fixture(t), current = await lease(transport);
  const good = encryptedFixture(current);
  await assert.rejects(transport.put({ ...publication(current), recordHash: '0'.repeat(64) }), code('SYNC_CORRUPT'));
  const badDigest = { ...good, ciphertextDigest: '0'.repeat(64) };
  await assert.rejects(transport.put(publication(current, badDigest)), code('SYNC_CORRUPT'));
  const plaintext = Buffer.from(JSON.stringify({ backupFormat: 'chausar.backup.v1', envelope: { format: 'chausar.vault.v1', id: 'vault', revision: 1, rawKey: 'plaintext-key', snapshot: { plaintext: 'private facts' } } })).toString('base64');
  await assert.rejects(transport.put(publication(current, { ...good, ciphertextBase64: plaintext, ciphertextDigest: hash(plaintext) })), code('SYNC_CORRUPT'));
  const wrongSnapshotIdentity = { ...good, memberId: 'different-owner' };
  await assert.rejects(transport.put(publication(current, wrongSnapshotIdentity)), code('FENCE_REJECTED'));
  assert.equal(await transport.getHead(), null);
  assert.equal((await readdir(join(directory, 'blobs'))).filter(name => name.endsWith('.json')).length, 0);
  const bounded = await fixture(t, { maxBlobBytes: 100, maxLeaseTtlMs: 10 });
  await assert.rejects(bounded.transport.acquireLease(leaseInput()));
  const short = await bounded.transport.acquireLease(leaseInput('device-a', start, 10)); assert.ok(short);
  await assert.rejects(bounded.transport.put(publication(short)), code('SYNC_TOO_LARGE'));
});

test('existing corrupt blob is never overwritten and persisted authority corruption fails closed', async t => {
  const { transport, directory } = await fixture(t), current = await lease(transport), input = publication(current);
  await transport.put(input);
  const blobPath = join(directory, 'blobs', `${input.recordHash}.json`);
  await writeFile(blobPath, '{"tampered":true}');
  await assert.rejects(transport.get(input.recordHash), code('SYNC_CORRUPT'));
  assert.equal(await readFile(blobPath, 'utf8'), '{"tampered":true}');
  await writeFile(join(directory, 'authority.json'), '{"partial":');
  await assert.rejects(transport.getHead(), code('SYNC_STORE_CORRUPT'));
  await assert.rejects(transport.acquireLease(leaseInput()), code('SYNC_STORE_CORRUPT'));
});

test('lost acknowledgment leaves a discoverable committed publication with no implicit retry', async t => {
  const { options, directory } = await fixture(t);
  let armed = false, puts = 0;
  const transport = new FileSyncTransport({ ...options, fault: point => { if (armed && point === 'after-state-commit') { puts++; throw new Error('Authored fixture lost acknowledgment.'); } } });
  const current = await lease(transport), input = publication(current); armed = true;
  await assert.rejects(transport.put(input), /lost acknowledgment/);
  const restarted = new FileSyncTransport(options);
  assert.equal((await restarted.getHead())!.recordHash, input.recordHash);
  assert.deepEqual(await restarted.get(input.recordHash), input.snapshot); assert.equal(puts, 1);
  assert.equal((await readdir(join(directory, 'blobs'))).filter(name => name.endsWith('.json')).length, 1);
});

test('SyncService publishes a real Vault.backup and verifies a staged restore through the file transport', async t => {
  const { directory } = await fixture(t), storeDirectory = join(directory, 'dedicated-store'); await mkdir(storeDirectory);
  const { vault } = await Vault.create({ directory: join(directory, 'sender-vault'), storage: 'experimental-file', name: 'Local fixture company', passphrase: 'strong fixture passphrase' });
  const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
  let restored: Vault | undefined;
  try {
    await vault.update(state => { state.facts.push({ id: 'private-fact', entityId: 'invoice', sourceId: 'books', sourceRow: 1, kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: start, supersededAt: null, branch: 'Mumbai', fields: { customerName: 'PRIVATE FIXTURE CUSTOMER', amountMinor: '67890123' } }); });
    const backupFile = join(directory, 'bootstrap-identity.backup.json'); await vault.backup(backupFile);
    const vaultId = JSON.parse(await readFile(backupFile, 'utf8')).envelope.id;
    const transport = new FileSyncTransport({ directory: storeDirectory, workspaceId: vault.read().workspace.id, vaultId });
    const sender = new SyncService(vault, { transport, deviceId: 'sender-fixture', enabled: true });
    const preview = await sender.preview(owner), approval = await sender.approve(owner, preview.id);
    const pushed = await sender.push(owner, { previewId: preview.id, approvalId: approval.id });
    const snapshot = (await transport.get(pushed.head.recordHash))!, bytes = Buffer.from(snapshot.ciphertextBase64, 'base64').toString('utf8');
    assert.equal(bytes.includes('PRIVATE FIXTURE CUSTOMER'), false); assert.equal(bytes.includes('67890123'), false);
    assert.equal(JSON.parse(bytes).backupFormat, 'chausar.backup.v1'); assert.equal(snapshot.ciphertextDigest, preview.digest);
    assert.equal(pushed.receipt.status, 'completed'); assert.equal(pushed.receipt.payloadBase64, undefined);
    class MemoryStore implements StateStore {
      state: State = initialState('Local receiver fixture'); read() { return this.state; }
      async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return change(this.state); }
    }
    const receiver = new SyncService(new MemoryStore(), { transport, deviceId: 'receiver-fixture', enabled: true, workspaceId: vault.read().workspace.id });
    receiver.trustDevice(owner, { ...sender.identity(owner), memberId: 'owner', epoch: 1 });
    const pulled = await receiver.pull(owner, { directory: join(directory, 'staged-restore'), passphrase: 'strong fixture passphrase' }); restored = pulled.stagedVault;
    assert.equal(pulled.liveAuthorityChanged, false);
    assert.equal(restored.read().facts[0].fields.customerName, 'PRIVATE FIXTURE CUSTOMER');
    assert.equal(vault.read().facts.length, 1);
  } finally { await restored?.close(); await vault.close(); }
});
