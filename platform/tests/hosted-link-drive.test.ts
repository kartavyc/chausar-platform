import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoogleDriveSyncTransport, createDriveSyncFolder, DRIVE_FILES, DRIVE_UPLOAD } from '../runtime/hosted-link/drive-transport.ts';
import type { FetchReply } from '../runtime/hosted-link/client.ts';
import { SyncService, snapshotHash } from '../runtime/sync.ts';
import type { SyncLease } from '../runtime/sync.ts';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { Vault } from '../runtime/vault.ts';
import { encryptedFixture } from './fixtures/sync-file-transport-worker.ts';

// Synthetic only: an in-memory Drive v3 with the four endpoints the transport uses. No network.
const TOKEN = 'synthetic-drive-file-token';
const START = Date.parse('2026-10-14T06:00:00.000Z');
const reply = (status: number, body: unknown): FetchReply => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, headers: { get: name => name === 'content-length' ? String(Buffer.byteLength(text)) : null },
    text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
};
class FakeDrive {
  files = new Map<string, { name: string; parents: string[]; mimeType: string; content: string }>();
  urls: string[] = [];
  /** Runs after each head write lands, to stand in for a second writer racing this one. */
  afterHeadWrite?: (id: string) => void;
  #n = 0;
  fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }): Promise<FetchReply> => {
    this.urls.push(url);
    if (init.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: { code: 401 } });
    const parsed = new URL(url), body = typeof init.body === 'string' ? init.body : init.body ? Buffer.from(init.body).toString('utf8') : '';
    let m: RegExpExecArray | null;
    if (init.method === 'POST' && url === `${DRIVE_FILES}?fields=id`) {
      const meta = JSON.parse(body); const id = this.id(); this.files.set(id, { name: meta.name, parents: meta.parents ?? [], mimeType: meta.mimeType, content: '' }); return reply(200, { id });
    }
    if (init.method === 'POST' && url === `${DRIVE_UPLOAD}?uploadType=multipart&fields=id`) {
      const boundary = /^multipart\/related; boundary=([A-Za-z0-9]+)$/.exec(init.headers['content-type'])![1];
      const parts = body.split(`--${boundary}`).slice(1, -1).map(part => part.replace(/^\r\n/, '').replace(/\r\n$/, ''));
      assert.equal(parts.length, 2);
      const [metaPart, mediaPart] = parts.map(part => part.slice(part.indexOf('\r\n\r\n') + 4));
      const meta = JSON.parse(metaPart); const id = this.id();
      for (const parent of meta.parents ?? []) assert.ok(this.files.has(parent), 'Parent folder exists.');
      this.files.set(id, { name: meta.name, parents: meta.parents ?? [], mimeType: meta.mimeType, content: mediaPart }); return reply(200, { id });
    }
    if (init.method === 'GET' && (m = /^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/.exec(parsed.pathname)) && parsed.searchParams.get('alt') === 'media') {
      const file = this.files.get(m[1]); return file ? reply(200, file.content) : reply(404, { error: { code: 404 } });
    }
    if (init.method === 'PATCH' && (m = /^\/upload\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/.exec(parsed.pathname)) && parsed.searchParams.get('uploadType') === 'media') {
      const file = this.files.get(m[1]); if (!file) return reply(404, { error: { code: 404 } });
      file.content = body; this.afterHeadWrite?.(m[1]); return reply(200, { id: m[1] });
    }
    if (init.method === 'GET' && parsed.pathname === '/drive/v3/files' && parsed.searchParams.has('q')) {
      const q = /^name = '([a-f0-9]{64}\.json)' and '([A-Za-z0-9_-]+)' in parents and trashed = false$/.exec(parsed.searchParams.get('q')!);
      assert.ok(q, 'Only exact record-name queries in the app folder.');
      return reply(200, { files: [...this.files].filter(([, f]) => f.name === q[1] && f.parents.includes(q[2])).map(([id, f]) => ({ id, name: f.name })) });
    }
    return reply(404, { error: { code: 404 } });
  };
  id() { return `drive${(++this.#n).toString().padStart(6, '0')}AbCdEfGh`; }
}
async function fixture(identity = { workspaceId: 'workspace', vaultId: 'vault' }, hostClock = false) {
  const drive = new FakeDrive(); let time = START;
  const ids = await createDriveSyncFolder(drive.fetch, () => TOKEN, identity);
  const make = () => new GoogleDriveSyncTransport({ ...ids, ...identity, fetch: drive.fetch, accessToken: async () => TOKEN, clock: hostClock ? () => new Date() : () => new Date(time) });
  return { drive, ids, transport: make(), make, advance: (ms: number) => { time += ms; } };
}
const leaseInput = (deviceId = 'device-a') => ({ deviceId, memberId: 'owner', epoch: 1, now: new Date(START).toISOString(), ttlMs: 60000 });
const publication = (lease: SyncLease, snapshot = encryptedFixture(lease)) => ({ lease, expectedHeadHash: snapshot.previousHash, snapshot, recordHash: snapshotHash(snapshot), now: new Date(START).toISOString() });

test('the Drive transport is narrowly scoped, stores one head and one file per record, and reads them back', async () => {
  const { drive, ids, transport } = await fixture();
  assert.equal(transport.kind, 'google-drive'); assert.equal(transport.experimental, true);
  assert.deepEqual(transport.scope, { fileIds: [ids.folderId, ids.headFileId], broadAccess: false });
  assert.equal(drive.files.get(ids.folderId)!.mimeType, 'application/vnd.google-apps.folder');
  assert.equal(await transport.getHead(), null);
  assert.equal(await transport.get('0'.repeat(64)), null);
  const lease = (await transport.acquireLease(leaseInput()))!;
  assert.equal(lease.fence, 1);
  const input = publication(lease), head = await transport.put(input);
  assert.deepEqual(head, { recordHash: input.recordHash, workspaceId: 'workspace', vaultId: 'vault', revision: 1, sequence: 1, fence: 1 });
  assert.deepEqual(await transport.getHead(), head);
  assert.deepEqual(await transport.get(input.recordHash), input.snapshot);
  assert.equal([...drive.files.values()].filter(f => f.name === `${input.recordHash}.json` && f.parents.includes(ids.folderId)).length, 1);
  // Publishing the same record again reuses the file; a second snapshot advances the chain.
  const second = encryptedFixture(lease, { revision: 2, sequence: 2, previousHash: input.recordHash, marker: 5 });
  assert.equal((await transport.put(publication(lease, second))).sequence, 2);
  await assert.rejects(transport.put(publication(lease, second)), { code: 'SYNC_CAS_CONFLICT' });
  for (const url of drive.urls) { assert.equal(url.includes(TOKEN), false); assert.ok(url.startsWith(DRIVE_FILES) || url.startsWith(DRIVE_UPLOAD)); }
});

test('an active lease excludes another device until it expires; a stale lease cannot publish', async () => {
  const { transport, make, advance } = await fixture();
  const first = (await transport.acquireLease(leaseInput()))!;
  assert.equal(await make().acquireLease(leaseInput('device-b')), null);
  advance(61000);
  const second = (await make().acquireLease(leaseInput('device-b')))!;
  assert.ok(second.fence > first.fence);
  await assert.rejects(transport.put(publication(first)), { code: 'FENCE_REJECTED' });
  await assert.rejects(transport.put({ ...publication(second), snapshot: encryptedFixture(first) }), { code: 'SYNC_CORRUPT' });
  advance(61000);
  await assert.rejects(make().put(publication(second)), { code: 'FENCE_REJECTED' });
});

test('without compare-and-swap a racing writer is caught by the read-back', async () => {
  const { drive, ids, transport } = await fixture();
  const lease = (await transport.acquireLease(leaseInput()))!;
  drive.afterHeadWrite = id => {
    const file = drive.files.get(id)!, head = JSON.parse(file.content);
    if (head.head) { head.head.recordHash = 'f'.repeat(64); file.content = JSON.stringify(head); }
  };
  await assert.rejects(transport.put(publication(lease)), { code: 'SYNC_HEAD_MISMATCH' });
  drive.afterHeadWrite = id => {
    const file = drive.files.get(id)!, head = JSON.parse(file.content);
    if (head.lease?.deviceId === 'device-a') { head.lease = { ...head.lease, deviceId: 'device-z', token: 'racing-writer-token' }; file.content = JSON.stringify(head); }
  };
  assert.equal(await transport.acquireLease(leaseInput()), null);
  assert.equal(ids.headFileId.length > 0, true);
});

test('a folder for another workspace, a missing sign-in and an unpicked file id are refused', async () => {
  const { drive, ids } = await fixture();
  const other = new GoogleDriveSyncTransport({ ...ids, workspaceId: 'another', vaultId: 'vault', fetch: drive.fetch, accessToken: () => TOKEN });
  await assert.rejects(other.getHead(), { code: 'SYNC_WORKSPACE_MISMATCH' });
  const signedOut = new GoogleDriveSyncTransport({ ...ids, workspaceId: 'workspace', vaultId: 'vault', fetch: drive.fetch, accessToken: () => 'synthetic-not-the-right-token' });
  await assert.rejects(signedOut.getHead(), { code: 'SYNC_ACCESS_DENIED' });
  const offline = new GoogleDriveSyncTransport({ ...ids, workspaceId: 'workspace', vaultId: 'vault', fetch: async () => { throw new TypeError('offline'); }, accessToken: () => TOKEN });
  await assert.rejects(offline.getHead(), { code: 'SYNC_UNREACHABLE' });
  assert.throws(() => new GoogleDriveSyncTransport({ ...ids, headFileId: ids.folderId, workspaceId: 'workspace', vaultId: 'vault', fetch: drive.fetch, accessToken: () => TOKEN }), { code: 'SYNC_SCOPE_DENIED' });
});

test('SyncService publishes a real Vault.backup through Drive and verifies a staged restore', async (t: TestContext) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chausar-hosted-link-drive-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { vault } = await Vault.create({ directory: join(directory, 'sender-vault'), storage: 'experimental-file', name: 'Synthetic Drive company', passphrase: 'Synthetic drive fixture passphrase' });
  const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
  let restored: Vault | undefined;
  try {
    await vault.update(state => { state.facts.push({ id: 'private-fact', entityId: 'invoice', sourceId: 'books', sourceRow: 1, kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: '2026-10-01T00:00:00.000Z', supersededAt: null, fields: { customerName: 'PRIVATE DRIVE CUSTOMER', amountMinor: '4455667788' } }); });
    const bootstrap = join(directory, 'identity.backup.json'); await vault.backup(bootstrap);
    const vaultId = JSON.parse(await readFile(bootstrap, 'utf8')).envelope.id;
    const { drive, transport, make } = await fixture({ workspaceId: vault.read().workspace.id, vaultId }, true);
    const sender = new SyncService(vault, { transport, deviceId: 'sender-fixture', enabled: true });
    const preview = await sender.preview(owner), approval = await sender.approve(owner, preview.id);
    const pushed = await sender.push(owner, { previewId: preview.id, approvalId: approval.id });
    assert.equal(pushed.receipt.status, 'completed');
    const stored = [...drive.files.values()].map(f => f.content).join('\n');
    assert.equal(Buffer.from(stored).includes('PRIVATE DRIVE CUSTOMER'), false);
    for (const file of drive.files.values()) if (file.name.endsWith('.json') && file.name !== 'chausar-sync-head.json') {
      const bytes = Buffer.from(JSON.parse(file.content).ciphertextBase64, 'base64').toString('utf8');
      assert.equal(bytes.includes('PRIVATE DRIVE CUSTOMER'), false); assert.equal(bytes.includes('4455667788'), false);
    }
    class MemoryStore implements StateStore {
      state: State = initialState('Synthetic receiver'); read() { return this.state; }
      async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return change(this.state); }
    }
    const receiver = new SyncService(new MemoryStore(), { transport: make(), deviceId: 'receiver-fixture', enabled: true, workspaceId: vault.read().workspace.id });
    receiver.trustDevice(owner, { ...sender.identity(owner), memberId: 'owner', epoch: 1 });
    const pulled = await receiver.pull(owner, { directory: join(directory, 'staged-restore'), passphrase: 'Synthetic drive fixture passphrase' }); restored = pulled.stagedVault;
    assert.equal(restored.read().facts[0].fields.customerName, 'PRIVATE DRIVE CUSTOMER');
    assert.equal(pulled.liveAuthorityChanged, false);
  } finally { await restored?.close(); await vault.close(); }
});
