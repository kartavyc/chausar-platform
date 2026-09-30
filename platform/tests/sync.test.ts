import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Vault } from '../runtime/vault.ts';
import { initialState, ChausarError, now } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { SyncService, snapshotHash } from '../runtime/sync.ts';
import type { SyncTransport, SyncHead, SyncLease, SyncSnapshot } from '../runtime/sync.ts';
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const code = (name: string) => (e: any) => e.code === name;
class MemoryStore implements StateStore { state: State = initialState('Receiver'); read() { return this.state; } async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); } }
class FencedTransport implements SyncTransport {
  kind = 'injected-ciphertext-store'; head: SyncHead | null = null; lease: SyncLease | null = null; fence = 0; records = new Map<string, SyncSnapshot>(); puts = 0;
  async getHead() { return structuredClone(this.head); }
  async acquireLease(input: any) {
    if (this.lease && Date.parse(this.lease.expiresAt) > Date.parse(input.now) && this.lease.deviceId !== input.deviceId) return null;
    this.lease = { deviceId: input.deviceId, memberId: input.memberId, epoch: input.epoch, fence: ++this.fence, token: `lease-${this.fence}`, expiresAt: new Date(Date.parse(input.now) + input.ttlMs).toISOString() }; return structuredClone(this.lease);
  }
  async put(input: any) {
    if (!this.lease || input.lease.fence !== this.lease.fence || input.lease.token !== this.lease.token || Date.parse(this.lease.expiresAt) <= Date.parse(input.now)) throw new ChausarError('FENCE_REJECTED', 'Stale writer lease.');
    if ((this.head?.recordHash || null) !== input.expectedHeadHash) throw new ChausarError('SYNC_CAS_CONFLICT', 'Head changed.');
    this.puts++; this.records.set(input.recordHash, structuredClone(input.snapshot)); this.head = { recordHash: input.recordHash, workspaceId: input.snapshot.workspaceId, vaultId: input.snapshot.vaultId, revision: input.snapshot.revision, sequence: input.snapshot.sequence, fence: input.lease.fence }; return structuredClone(this.head);
  }
  async get(recordHash: string) { return structuredClone(this.records.get(recordHash) || null); }
}
async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-sync-tests-')); const result = await Vault.create({ directory: join(directory, 'sender'), storage: 'experimental-file', name: 'Private company', passphrase: 'strong sender passphrase' });
  t.after(async () => { await result.vault.close(); await rm(directory, { recursive: true, force: true }); });
  await result.vault.update(state => { state.facts.push({ id: 'private_fact', entityId: 'private_invoice', sourceId: 'books', sourceRow: 1, kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: now(), supersededAt: null, branch: 'Mumbai', fields: { customerName: 'PRIVATE PERSONAL CUSTOMER', amountMinor: '678900' } }); });
  const transport = new FencedTransport(); const sender = new SyncService(result.vault, { transport, deviceId: 'sender-device', enabled: true }); return { directory, vault: result.vault, sender, transport };
}
async function publish(sender: SyncService) { const preview = await sender.preview(owner); const approval = await sender.approve(owner, preview.id); return { preview, approval, result: await sender.push(owner, { previewId: preview.id, approvalId: approval.id }) }; }

test('sync is off by default and multi-writer mode is refused', async () => {
  const store = new MemoryStore(); const sync = new SyncService(store, { transport: new FencedTransport() }); await assert.rejects(sync.preview(owner), code('SYNC_DISABLED'));
  assert.throws(() => new SyncService(store, { mode: 'multi-writer' }), code('MULTIWRITER_UNSUPPORTED'));
});
test('signed publication contains opaque Vault.backup bytes and exact approved digest', async t => {
  const { sender, transport } = await fixture(t); const { preview, result } = await publish(sender); const snapshot = transport.records.get(result.head.recordHash)!;
  const blob = Buffer.from(snapshot.ciphertextBase64, 'base64').toString('utf8'); assert.equal(blob.includes('PRIVATE PERSONAL CUSTOMER'), false); assert.equal(blob.includes('678900'), false); assert.equal(JSON.parse(blob).backupFormat, 'chausar.backup.v1'); assert.equal(snapshot.ciphertextDigest, preview.digest); assert.equal(snapshotHash(snapshot), result.head.recordHash);
  assert.equal(result.receipt.payloadBase64, undefined); assert.equal(transport.puts, 1); assert.equal(result.head.fence, 1);
});
test('another device cannot publish while the first writer lease is active', async t => {
  const { sender, transport, vault } = await fixture(t); const second = new SyncService(vault, { transport, deviceId: 'second-device', enabled: true });
  const a = await sender.preview(owner); const aa = await sender.approve(owner, a.id); const b = await second.preview(owner); const bb = await second.approve(owner, b.id);
  await sender.push(owner, { previewId: a.id, approvalId: aa.id }); await assert.rejects(second.push(owner, { previewId: b.id, approvalId: bb.id }), code('WRITER_LEASE_DENIED')); assert.equal(transport.puts, 1);
});
test('expired writer lease cannot overwrite a newer fenced CAS head', async t => {
  const { sender, transport, vault } = await fixture(t); let clock = new Date(); const second = new SyncService(vault, { transport, deviceId: 'second-device', enabled: true, clock: () => clock });
  const a = await sender.preview(owner); const aa = await sender.approve(owner, a.id); const b = await second.preview(owner); const bb = await second.approve(owner, b.id); await sender.push(owner, { previewId: a.id, approvalId: aa.id }); clock = new Date(clock.getTime() + 120000);
  await assert.rejects(second.push(owner, { previewId: b.id, approvalId: bb.id }), code('SYNC_CAS_CONFLICT')); assert.equal(transport.puts, 1); assert.equal(transport.fence, 2);
});
test('member/source revocation after preview prevents outbound encrypted copy', async t => {
  const { sender, vault, transport } = await fixture(t); const preview = await sender.preview(owner); const approval = await sender.approve(owner, preview.id); await vault.update(state => { state.policy.allowedSources = []; });
  await assert.rejects(sender.push(owner, { previewId: preview.id, approvalId: approval.id }), code('SOURCE_REVOKED')); assert.equal(transport.puts, 0);
});
test('verified pull stages into a new vault and refuses replay without overwriting sender', async t => {
  const { sender, vault, transport, directory } = await fixture(t); await publish(sender); const store = new MemoryStore(); const receiver = new SyncService(store, { transport, deviceId: 'receiver', enabled: true, workspaceId: vault.read().workspace.id });
  const identity = sender.identity(owner); receiver.trustDevice(owner, { ...identity, memberId: 'owner', epoch: 1 });
  const result = await receiver.pull(owner, { directory: join(directory, 'restored'), passphrase: 'strong sender passphrase' }); t.after(async () => result.stagedVault.close());
  assert.equal(result.liveAuthorityChanged, false); assert.equal(result.stagedVault.read().facts[0].fields.customerName, 'PRIVATE PERSONAL CUSTOMER'); assert.equal(vault.read().facts.length, 1);
  await assert.rejects(receiver.pull(owner, { directory: join(directory, 'replayed'), passphrase: 'strong sender passphrase' }), code('SYNC_REPLAY'));
});
test('truncated encrypted history fails before any restore', async t => {
  const { sender, vault, transport, directory } = await fixture(t); const first = await publish(sender); await publish(sender); transport.records.delete(first.result.head.recordHash);
  const receiver = new SyncService(new MemoryStore(), { transport, enabled: true, workspaceId: vault.read().workspace.id }); const identity = sender.identity(owner); receiver.trustDevice(owner, { ...identity, memberId: 'owner', epoch: 1 });
  await assert.rejects(receiver.pull(owner, { directory: join(directory, 'truncated'), passphrase: 'strong sender passphrase' }), code('SYNC_LOG_TRUNCATED'));
});
test('untrusted signature and changed encrypted payload fail before restore', async t => {
  const { sender, vault, transport, directory } = await fixture(t); const { result } = await publish(sender); const receiver = new SyncService(new MemoryStore(), { transport, enabled: true, workspaceId: vault.read().workspace.id });
  await assert.rejects(receiver.pull(owner, { directory: join(directory, 'untrusted'), passphrase: 'strong sender passphrase' }), code('UNTRUSTED_DEVICE'));
  receiver.trustDevice(owner, { ...sender.identity(owner), memberId: 'owner', epoch: 1 }); const record = transport.records.get(result.head.recordHash)!; record.ciphertextBase64 += 'changed';
  await assert.rejects(receiver.pull(owner, { directory: join(directory, 'corrupt'), passphrase: 'strong sender passphrase' }), code('SYNC_CORRUPT'));
});
test('transport atomically rejects a superseded fence even if an old writer retries', async () => {
  const transport = new FencedTransport(); const now = new Date().toISOString(); const first = await transport.acquireLease({ deviceId: 'a', memberId: 'owner', epoch: 1, now, ttlMs: 1000 }); const later = new Date(Date.parse(now) + 2000).toISOString(); await transport.acquireLease({ deviceId: 'b', memberId: 'owner', epoch: 1, now: later, ttlMs: 1000 });
  await assert.rejects(transport.put({ lease: first, expectedHeadHash: null, recordHash: 'fake', snapshot: {}, now: later }), code('FENCE_REJECTED')); assert.equal(transport.puts, 0);
});
