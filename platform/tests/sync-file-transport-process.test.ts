import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { FileSyncTransport } from '../runtime/sync-file-transport.ts';
import type { FileSyncFaultPoint } from '../runtime/sync-file-transport.ts';
import { snapshotHash } from '../runtime/sync.ts';
import type { SyncLease } from '../runtime/sync.ts';
import { encryptedFixture } from './fixtures/sync-file-transport-worker.ts';

// Local OS-process fixtures qualify this filesystem protocol only. No cloud folder,
// second machine, remote peer, hosted custody or power-loss qualification is implied.
const start = '2026-10-01T12:00:00.000Z';
const worker = fileURLToPath(new URL('./fixtures/sync-file-transport-worker.ts', import.meta.url));
const leaseInput = (deviceId = 'device-a', now = start) => ({ deviceId, memberId: 'owner', epoch: 1, now, ttlMs: 1000 });
const publication = (lease: SyncLease, marker = 3, revision = 1, previousHash: string | null = null, sequence = 1) => {
  const snapshot = encryptedFixture(lease, { marker, revision, previousHash, sequence });
  return { lease, expectedHeadHash: previousHash, snapshot, recordHash: snapshotHash(snapshot), now: start };
};
type Result = { type: 'result'; id: number; ok: boolean; result?: any; code?: string; message?: string };
class Peer {
  child: ChildProcess; errors = ''; nextId = 0; messages: any[] = []; waits = new Set<{ accepts: (message: any) => boolean; resolve: (message: any) => void; reject: (error: Error) => void }>();
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>; exited = false;
  constructor(directory: string, time = start) {
    this.child = spawn(process.execPath, [worker, JSON.stringify({ directory, time })], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    this.child.stderr!.on('data', bytes => { this.errors += String(bytes); });
    this.child.on('message', message => {
      const waiting = [...this.waits].find(item => item.accepts(message));
      if (waiting) { this.waits.delete(waiting); waiting.resolve(message); } else this.messages.push(message);
    });
    this.exit = new Promise(resolveExit => this.child.once('exit', (code, signal) => {
      this.exited = true;
      for (const pending of this.waits) pending.reject(new Error(`Local fixture exited (${code ?? signal}): ${this.errors}`));
      this.waits.clear(); resolveExit({ code, signal });
    }));
    this.child.on('error', error => { for (const pending of this.waits) pending.reject(error); this.waits.clear(); });
  }
  event(accepts: (message: any) => boolean): Promise<any> {
    const index = this.messages.findIndex(accepts);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    if (this.exited) return Promise.reject(new Error(`Local fixture already exited: ${this.errors}`));
    return new Promise((resolveMessage, reject) => {
      const item = { accepts, resolve: (message: any) => { clearTimeout(timer); resolveMessage(message); }, reject: (error: Error) => { clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => { this.waits.delete(item); reject(new Error(`Local fixture deadline: ${this.errors}`)); }, 10000);
      this.waits.add(item);
    });
  }
  async ready() { await this.event(message => message.type === 'ready'); return this; }
  operation(op: 'lease' | 'put' | 'head' | 'get', input?: any, options: { time?: string; faultPoint?: FileSyncFaultPoint; faultAction?: 'pause' | 'crash' } = {}): Promise<Result> {
    const id = ++this.nextId, result = this.event(message => message.type === 'result' && message.id === id);
    this.child.send({ type: 'operation', id, op, input, ...options }); return result;
  }
  release() { this.child.send({ type: 'release' }); }
  async close() { if (!this.exited) this.child.kill(); await this.exit; }
}
async function fixture(t: TestContext) {
  const temporaryRoot = resolve(tmpdir());
  if (process.platform === 'win32') assert.match(temporaryRoot, /^C:\\/i, 'These process fixtures must use C-only temporary directories.');
  const directory = await mkdtemp(join(temporaryRoot, 'chausar-sync-process-fixture-')), peers: Peer[] = [];
  t.after(async () => {
    await Promise.all(peers.map(peer => peer.close()));
    assert.ok(relative(temporaryRoot, directory).startsWith('chausar-sync-process-fixture-'));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, transport: new FileSyncTransport({ directory, workspaceId: 'workspace', vaultId: 'vault', clock: () => new Date(start) }),
    peer: async (time = start) => { const peer = new Peer(directory, time); peers.push(peer); return peer.ready(); } };
}
function success(result: Result) { assert.equal(result.ok, true, `${result.code}: ${result.message}`); return result.result; }

test('independent processes cannot acquire a competing lease while one process holds the atomic lock', async t => {
  const { peer, transport } = await fixture(t), first = await peer(), second = await peer();
  const acquisition = first.operation('lease', leaseInput(), { faultPoint: 'after-lock', faultAction: 'pause' });
  await first.event(message => message.type === 'fault' && message.point === 'after-lock');
  const blocked = await second.operation('lease', leaseInput('device-b'));
  assert.equal(blocked.ok, false); assert.equal(blocked.code, 'SYNC_STORE_BUSY');
  first.release(); const admitted = success(await acquisition) as SyncLease;
  assert.ok(admitted.fence > 0);
  assert.equal(success(await second.operation('lease', leaseInput('device-b'))), null);
  assert.equal(await transport.getHead(), null);
});

test('two process publishers sharing the current exact lease cannot both win an empty-head CAS', async t => {
  const { peer, transport } = await fixture(t), first = await peer(), second = await peer();
  const lease = success(await first.operation('lease', leaseInput())) as SyncLease;
  const a = publication(lease, 10), b = publication(lease, 20);
  const results = await Promise.all([first.operation('put', a), second.operation('put', b)]);
  const winners = results.filter(result => result.ok), losers = results.filter(result => !result.ok);
  assert.equal(winners.length, 1); assert.equal(losers.length, 1);
  assert.ok(['SYNC_CAS_CONFLICT', 'SYNC_STORE_BUSY'].includes(losers[0].code!));
  const winner = winners[0].result, rejectedInput = winner.recordHash === a.recordHash ? b : a;
  assert.equal((await transport.getHead())!.recordHash, winner.recordHash);
  const retry = await second.operation('put', rejectedInput);
  assert.equal(retry.ok, false); assert.equal(retry.code, 'SYNC_CAS_CONFLICT');
});

test('a delayed process writer is rejected after expiry, replacement writer and restart', async t => {
  const { peer, directory } = await fixture(t), old = await peer();
  const first = success(await old.operation('lease', leaseInput())) as SyncLease;
  const laterTime = '2026-10-01T12:00:02.000Z', fresh = await peer(laterTime);
  const next = success(await fresh.operation('lease', leaseInput('device-b', start))) as SyncLease;
  assert.ok(next.fence > first.fence);
  const committed = publication(next, 20); success(await fresh.operation('put', committed)); await fresh.close();
  const restarted = await peer(laterTime);
  const renewed = success(await restarted.operation('lease', leaseInput('device-b'))) as SyncLease;
  assert.ok(renewed.fence > next.fence);
  const delayed = await old.operation('put', publication(first, 30), { time: laterTime });
  assert.equal(delayed.ok, false); assert.equal(delayed.code, 'FENCE_REJECTED');
  assert.equal(success(await restarted.operation('head')).recordHash, committed.recordHash);
  const independent = new FileSyncTransport({ directory, workspaceId: 'workspace', vaultId: 'vault', clock: () => new Date(laterTime) });
  assert.equal((await independent.getHead())!.recordHash, committed.recordHash);
});

test('process crash while holding the lock before a lease transition preserves the durable fence', async t => {
  const { peer, transport } = await fixture(t), initial = await transport.acquireLease(leaseInput()); assert.ok(initial);
  const crashed = await peer();
  const unfinished = crashed.operation('lease', leaseInput(), { faultPoint: 'after-lock', faultAction: 'crash' });
  void unfinished.catch(() => {});
  await crashed.event(message => message.type === 'fault'); assert.equal((await crashed.exit).code, 86);
  const survivor = await peer(), recovered = success(await survivor.operation('lease', leaseInput())) as SyncLease;
  assert.equal(recovered.fence, initial.fence + 1); assert.notEqual(recovered.token, initial.token);
  const delayed = await survivor.operation('put', publication(initial));
  assert.equal(delayed.ok, false); assert.equal(delayed.code, 'FENCE_REJECTED');
  assert.equal(await transport.getHead(), null);
});

for (const faultPoint of ['after-blob', 'before-state-commit'] as const) {
  test(`process crash at ${faultPoint} leaves an immutable orphan without publishing its head`, async t => {
    const { peer, transport, directory } = await fixture(t), crashed = await peer();
    const initial = success(await crashed.operation('lease', leaseInput())) as SyncLease, orphan = publication(initial, 10);
    const unfinished = crashed.operation('put', orphan, { faultPoint, faultAction: 'crash' }); void unfinished.catch(() => {});
    await crashed.event(message => message.type === 'fault' && message.point === faultPoint); assert.equal((await crashed.exit).code, 86);
    assert.equal(await transport.getHead(), null);
    assert.deepEqual(await transport.get(orphan.recordHash), orphan.snapshot);
    const survivor = await peer(), current = success(await survivor.operation('lease', leaseInput())) as SyncLease;
    assert.ok(current.fence > initial.fence);
    const committed = publication(current, 20); success(await survivor.operation('put', committed));
    assert.equal((await transport.getHead())!.recordHash, committed.recordHash);
    assert.deepEqual(await transport.get(orphan.recordHash), orphan.snapshot);
    assert.equal((await readdir(join(directory, 'blobs'))).filter(name => name.endsWith('.json')).length, 2);
  });
}

test('process crash after head commit preserves exact outcome for read-only acknowledgment reconciliation', async t => {
  const { peer, transport, directory } = await fixture(t), crashed = await peer();
  const initial = success(await crashed.operation('lease', leaseInput())) as SyncLease, committed = publication(initial);
  const unfinished = crashed.operation('put', committed, { faultPoint: 'after-state-commit', faultAction: 'crash' }); void unfinished.catch(() => {});
  await crashed.event(message => message.type === 'fault' && message.point === 'after-state-commit'); assert.equal((await crashed.exit).code, 86);
  const survivor = await peer(), recoveredHead = success(await survivor.operation('head'));
  assert.equal(recoveredHead.recordHash, committed.recordHash); assert.equal(recoveredHead.fence, initial.fence);
  assert.deepEqual(success(await survivor.operation('get', { recordHash: committed.recordHash })), committed.snapshot);
  assert.equal((await transport.getHead())!.recordHash, committed.recordHash);
  assert.equal((await readdir(join(directory, 'blobs'))).filter(name => name.endsWith('.json')).length, 1);
  const renewed = success(await survivor.operation('lease', leaseInput())) as SyncLease;
  assert.ok(renewed.fence > initial.fence);
  const resubmission = await survivor.operation('put', { ...committed, lease: renewed });
  assert.equal(resubmission.ok, false); assert.equal(resubmission.code, 'SYNC_CAS_CONFLICT');
});
