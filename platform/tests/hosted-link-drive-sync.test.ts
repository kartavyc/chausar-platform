import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, type EngineOptions } from '../runtime/engine.ts';
import { DRIVE_FILES, DRIVE_SCOPE, DRIVE_UPLOAD, HEAD_FILE_NAME } from '../runtime/hosted-link/drive-transport.ts';
import { driveHostOptions } from '../runtime/hosted-link/drive-sync.ts';
import type { FetchReply } from '../runtime/hosted-link/client.ts';
import { ConnectorCredentialStore } from '../runtime/connectors-ext/credentials.ts';
import { hostedLinkModule } from '../runtime/modules/lane-hosted-link.ts';
import { SyncService } from '../runtime/sync.ts';
import type { SyncTransport } from '../runtime/sync.ts';
import { FileSyncWriterAdmission } from '../runtime/sync-writer-admission.ts';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// Synthetic only: an in-memory Drive v3 (copied from hosted-link-drive.test.ts, plus the head-name query used to adopt
// a folder), labelled fixture keys and a synthetic access token. No network, no real Google account.
const TOKEN = 'synthetic-drive-file-token';
const passphrase = 'Synthetic drive sync fixture passphrase';
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const reply = (status: number, body: unknown): FetchReply => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, headers: { get: name => name === 'content-length' ? String(Buffer.byteLength(text)) : null },
    text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
};
class FakeDrive {
  files = new Map<string, { name: string; parents: string[]; mimeType: string; content: string }>();
  urls: string[] = [];
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
      file.content = body; return reply(200, { id: m[1] });
    }
    if (init.method === 'GET' && parsed.pathname === '/drive/v3/files' && parsed.searchParams.has('q')) {
      const q = /^name = '([a-f0-9]{64}\.json|chausar-sync-head\.json)' and '([A-Za-z0-9_-]+)' in parents and trashed = false$/.exec(parsed.searchParams.get('q')!);
      assert.ok(q, 'Only exact record or head-name queries in the app folder.');
      return reply(200, { files: [...this.files].filter(([, f]) => f.name === q[1] && f.parents.includes(q[2])).map(([id, f]) => ({ id, name: f.name })) });
    }
    return reply(404, { error: { code: 404 } });
  };
  id() { return `drive${(++this.#n).toString().padStart(6, '0')}AbCdEfGh`; }
}

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'chausar-hosted-link-drive-sync-')));
  const engines = new Set<Engine>();
  t.after(async () => { for (const engine of engines) await engine.close(); await rm(root, { recursive: true, force: true }); });
  const storage = installSyntheticProductionStorage(root, ['source', 'receiver', 'staged', 'plain'], t.mock);
  const drive = new FakeDrive(), time = Date.now(), clock = () => new Date(time);
  // The installed app's broker over the connectors-ext sealed store, with the fake Drive as its HTTP.
  const built = driveHostOptions({ directory: root, demo: false, env: {} }) as { drive: Record<string, unknown> };
  const modules = { 'hosted-link': { drive: { ...built.drive, fetch: drive.fetch, clock } } };
  const credentials = new ConnectorCredentialStore(join(root, 'connector-credentials'));
  const engineFor = (sync?: EngineOptions['sync']) => { const engine = new Engine({ directory: root, ...storage, modules, ...(sync ? { sync } : {}) }); engines.add(engine); return engine; };
  /** Stands in for connectors-ext's Google sign-in: a google-workspace connection with a sealed drive.file credential. */
  const signIn = async (engine: Engine, scopes: string[] = [DRIVE_SCOPE]) => {
    const connection = await engine.request('connectorsx.connect', { group: 'google-workspace', road: 'file', company: 'Synthetic Drive Sync' });
    credentials.set(connection.sourceId, { kind: 'oauth', system: 'google', provider: 'google', accessToken: TOKEN, refreshToken: null, expiresAt: null, scopes, settings: {}, storedAt: new Date().toISOString() });
    return connection;
  };
  /** A workspace created and signed in without sync, then reopened by a device with identity and reviewed writer admission. */
  const device = async (folder: string, deviceId: string) => {
    const bootstrap = engineFor();
    await bootstrap.request('workspace.create', { folder, name: `Synthetic ${folder}`, passphrase, demo: false, pack: 'services' });
    const connection = await signIn(bootstrap);
    const workspaceId = bootstrap.vault!.read().workspace.id, vaultId = bootstrap.vault!.vaultId;
    await bootstrap.close(); engines.delete(bootstrap);
    const admissionDirectory = join(root, `writer-${folder}`); await mkdir(admissionDirectory);
    const keys = generateKeyPairSync('ed25519'), signerId = `${deviceId}-signer`;
    const writerAdmission = new FileSyncWriterAdmission({ directory: admissionDirectory, workspaceId, vaultId, deviceId, clock });
    const sync: EngineOptions['sync'] = { enabled: false, mode: 'single-writer', deviceId, signerId, signingKey: keys.privateKey, clock, leaseTtlMs: 60000, writerAdmission };
    const engine = engineFor(sync);
    await engine.request('workspace.open', { folder, passphrase });
    const status = await engine.request('sync.writer.status');
    await engine.request('sync.writer.review', { expectedFence: status.fence, expectedStateDigest: status.localStateDigest, deviceId, memberId: 'owner', epoch: 1,
      expiresAt: new Date(time + 120000).toISOString(), reason: 'Explicit synthetic owner review of this local writer.' });
    return { engine, workspaceId, vaultId, connection, sync, signerId };
  };
  return { root, drive, storage, modules, credentials, engineFor, signIn, device };
}
const recorded = (engine: Engine) => (engine.vault!.read().extensions?.['hosted-link'] as any)?.drive ?? null;
const vaultBytes = async (root: string, folder: string) => {
  const files = await readdir(join(root, folder), { recursive: true, withFileTypes: true });
  return (await Promise.all(files.filter(f => f.isFile()).map(f => readFile(join(f.parentPath, f.name))))).map(b => b.toString('latin1')).join('\n');
};

test('connect creates the Drive folder, the core sync publishes through it, and a second device stages a restore from it', async t => {
  const f = await fixture(t);
  const source = await f.device('source', 'synthetic-drive-source-device');
  const before = await source.engine.request('hosted.drive.status');
  assert.equal(before.connected, false); assert.equal(before.attachment, 'not-connected'); assert.equal(before.signIn, 'available');
  assert.equal(before.sync.transport, null);

  const connected = await source.engine.request('hosted.drive.connect', { folderName: 'Synthetic Chausar sync' });
  assert.equal(connected.created, true); assert.equal(connected.attachment, 'attached'); assert.equal(connected.connectionId, source.connection.id);
  assert.equal(f.drive.files.get(connected.folderId)!.name, 'Synthetic Chausar sync');
  assert.equal(f.drive.files.get(connected.headFileId)!.name, HEAD_FILE_NAME);
  // The folder ids are in the vault namespace; the token is in none of the state, nor in the vault files on disk.
  const kept = recorded(source.engine);
  assert.equal(kept.folderId, connected.folderId); assert.equal(kept.headFileId, connected.headFileId); assert.equal(kept.workspaceId, source.workspaceId);
  assert.equal(JSON.stringify(source.engine.vault!.read()).includes(TOKEN), false);
  assert.equal(source.engine.vault!.read().activity.filter((a: any) => a.event === 'hosted.drive.connected').length, 1);
  await assert.rejects(source.engine.request('hosted.drive.connect', {}), { code: 'DRIVE_ALREADY_CONNECTED' });

  const syncStatus = await source.engine.request('sync.status');
  assert.equal(syncStatus.transport, 'google-drive'); assert.equal(syncStatus.enabled, false);
  await assert.rejects(source.engine.request('sync.preview'), { code: 'SYNC_DISABLED' });
  await source.engine.request('sync.enable', { enabled: true });
  const preview = await source.engine.request('sync.preview'), approval = await source.engine.request('sync.approve', { id: preview.id });
  const pushed = await source.engine.request('sync.push', { previewId: preview.id, approvalId: approval.id });
  assert.equal(pushed.receipt.status, 'completed');
  const records = [...f.drive.files.values()].filter(file => file.parents.includes(connected.folderId) && file.name !== HEAD_FILE_NAME);
  assert.deepEqual(records.map(file => file.name), [`${pushed.head.recordHash}.json`]);
  assert.equal(JSON.parse(f.drive.files.get(connected.headFileId)!.content).head.recordHash, pushed.head.recordHash);
  assert.equal(f.drive.urls.some(url => url.includes(TOKEN)), false);
  assert.equal((await vaultBytes(f.root, 'source')).includes(TOKEN), false);
  const identity = await source.engine.request('sync.identity');

  // A second device with its own workspace adopts the same folder only by naming the source workspace, then stages a restore.
  const receiver = await f.device('receiver', 'synthetic-drive-receiver-device');
  await assert.rejects(receiver.engine.request('hosted.drive.connect', { folderId: connected.folderId }), { code: 'SYNC_WORKSPACE_MISMATCH' });
  assert.equal(recorded(receiver.engine), null);
  const adopted = await receiver.engine.request('hosted.drive.connect', { folderId: connected.folderId, expectedWorkspaceId: source.workspaceId });
  assert.equal(adopted.created, false); assert.equal(adopted.headFileId, connected.headFileId); assert.equal(adopted.workspaceId, source.workspaceId);
  await receiver.engine.request('sync.enable', { enabled: true });
  await receiver.engine.request('sync.trust', { signerId: identity.signerId, publicKey: identity.publicKey, memberId: 'owner', epoch: 1 });
  // The receiver cannot publish its own workspace into the source's folder.
  await assert.rejects(receiver.engine.request('sync.preview'), { code: 'SYNC_REPLAY' });
  const staged = await receiver.engine.request('sync.pull', { folder: 'staged', passphrase, expectedWorkspaceId: source.workspaceId });
  assert.equal(staged.liveAuthorityChanged, false); assert.equal(staged.receipt.recordHash, pushed.head.recordHash);
  assert.equal(receiver.engine.vault!.read().workspace.id, receiver.workspaceId);
  await receiver.engine.close();
  const inspector = f.engineFor();
  await inspector.request('workspace.open', { folder: 'staged', passphrase });
  assert.equal(inspector.vault!.read().workspace.id, source.workspaceId); assert.equal(inspector.vault!.vaultId, source.vaultId);
  await inspector.close();

  // After the vault reopens the core SyncService is new; status attaches the recorded folder again.
  await source.engine.request('workspace.lock');
  await source.engine.request('workspace.open', { folder: 'source', passphrase });
  assert.equal((await source.engine.request('sync.status')).transport, null);
  assert.equal((await source.engine.request('hosted.drive.status')).attachment, 'attached');
  assert.equal((await source.engine.request('sync.status')).transport, 'google-drive');

  // Disconnect clears the record, detaches and turns sync off; Drive files stay.
  await source.engine.request('sync.enable', { enabled: true });
  const gone = await source.engine.request('hosted.drive.disconnect');
  assert.equal(gone.disconnected, true); assert.equal(gone.filesKept, true); assert.equal(gone.attachment, 'not-connected');
  assert.equal(recorded(source.engine), null);
  const after = await source.engine.request('sync.status'); assert.equal(after.transport, null); assert.equal(after.enabled, false);
  await assert.rejects(source.engine.request('sync.preview'), { code: 'SYNC_DISABLED' });
  assert.equal((await source.engine.request('hosted.drive.status')).connected, false);
  assert.ok(f.drive.files.has(connected.headFileId));
});

test('the installed app shape (no sync options) connects and attaches, and sync.enable still needs device configuration', async t => {
  const f = await fixture(t), engine = f.engineFor();
  await engine.request('workspace.create', { folder: 'plain', name: 'Synthetic installed', passphrase, demo: false, pack: 'services' });
  await assert.rejects(engine.request('hosted.drive.connect', {}), { code: 'DRIVE_SIGN_IN_REQUIRED' });
  // A Google sign-in without drive.file does not count.
  await f.signIn(engine, ['https://www.googleapis.com/auth/calendar.readonly']);
  assert.equal((await engine.request('hosted.drive.status')).signIn, 'required');
  await assert.rejects(engine.request('hosted.drive.connect', {}), { code: 'DRIVE_SIGN_IN_REQUIRED' });
  assert.equal(f.drive.urls.length, 0);
  await f.signIn(engine);
  const connected = await engine.request('hosted.drive.connect', {});
  assert.equal(connected.attachment, 'attached');
  assert.equal(f.drive.files.get(connected.folderId)!.name, 'Chausar encrypted sync');
  assert.equal((await engine.request('sync.status')).transport, 'google-drive');
  await assert.rejects(engine.request('sync.enable', { enabled: true }), { code: 'SYNC_WRITER_ADMISSION_REQUIRED' });
  await assert.rejects(engine.request('sync.preview'), { code: 'SYNC_DISABLED' });
  // Adopting a folder that this app cannot see is refused before anything is recorded.
  await engine.request('hosted.drive.disconnect');
  await assert.rejects(engine.request('hosted.drive.connect', { folderId: 'unknownFolder123' }), { code: 'DRIVE_FOLDER_NOT_FOUND' });
  assert.equal(recorded(engine), null);
  // Adopting its own folder again works without creating anything.
  const files = f.drive.files.size;
  const again = await engine.request('hosted.drive.connect', { folderId: connected.folderId });
  assert.equal(again.created, false); assert.equal(again.headFileId, connected.headFileId); assert.equal(f.drive.files.size, files);
  // Removing the sign-in leaves the folder recorded but unattached after reopen.
  for (const item of (engine.vault!.read().extensions?.['connectors-ext'] as any).connections) f.credentials.remove(item.sourceId);
  await engine.request('workspace.lock'); await engine.request('workspace.open', { folder: 'plain', passphrase });
  const status = await engine.request('hosted.drive.status');
  assert.equal(status.connected, true); assert.equal(status.attachment, 'sign-in-required'); assert.equal(status.signIn, 'required');
  assert.equal((await engine.request('sync.status')).transport, null);
});

test('demo mode refuses connect and attaches nothing', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chausar-hosted-link-drive-sync-demo-')));
  const drive = new FakeDrive();
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'hosted-link': { drive: { fetch: drive.fetch, accessToken: () => TOKEN } } } });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic demo', passphrase, demo: true, pack: 'services' });
  await assert.rejects(engine.requestAs(owner, 'hosted.drive.connect', {}), { code: 'DEMO_EXTERNAL_DISABLED' });
  const status = await engine.requestAs(owner, 'hosted.drive.status', {});
  assert.equal(status.demo, true); assert.equal(status.attachment, 'unavailable'); assert.equal(status.signIn, 'unavailable');
  assert.equal(drive.urls.length, 0);
  assert.deepEqual(hostedLinkModule.hostOptions!({ directory, demo: true, env: {} }), {});
});

test('the core seam attaches only a narrowly scoped Drive transport and never replaces a host-configured one', () => {
  class MemoryStore implements StateStore {
    state: State = initialState('Synthetic seam'); read() { return this.state; }
    async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return change(this.state); }
  }
  const store = new MemoryStore(), ctx: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
  const fake = (kind: string, scope?: SyncTransport['scope']): SyncTransport => ({ kind, scope, getHead: async () => null, acquireLease: async () => null,
    put: async () => { throw new Error('unused'); }, get: async () => null });
  const sync = new SyncService(store);
  assert.throws(() => sync.attachTransport(fake('google-drive', { fileIds: ['folderId123', 'headFileId1'], broadAccess: true })), { code: 'SYNC_SCOPE_DENIED' });
  assert.throws(() => sync.attachTransport(fake('google-drive', { fileIds: [] , broadAccess: false })), { code: 'SYNC_SCOPE_DENIED' });
  assert.throws(() => sync.attachTransport(fake('google-drive')), { code: 'SYNC_SCOPE_DENIED' });
  assert.throws(() => sync.attachTransport(fake('file', { fileIds: ['x'], broadAccess: false })), { code: 'SYNC_SCOPE_DENIED' });
  const narrow = fake('google-drive', { fileIds: ['folderId123', 'headFileId1'], broadAccess: false });
  sync.attachTransport(narrow); sync.enable(ctx, true);
  assert.equal(sync.status(ctx).transport, 'google-drive');
  sync.attachTransport(null);
  assert.deepEqual([sync.status(ctx).transport, sync.status(ctx).enabled], [null, false]);
  const configured = new SyncService(store, { transport: fake('file') });
  assert.throws(() => configured.attachTransport(narrow), { code: 'SYNC_TRANSPORT_CONFIGURED' });
  assert.throws(() => configured.attachTransport(null), { code: 'SYNC_TRANSPORT_CONFIGURED' });
  assert.equal(configured.status(ctx).transport, 'file');
});

test('the installed app builds the Drive broker over the connectors-ext credential store, holding no token', () => {
  const built = hostedLinkModule.hostOptions!({ directory: '/synthetic-app', demo: false, env: {} }) as any;
  assert.equal(typeof built.drive.credentialBroker, 'function');
  assert.ok(built.drive.credentialStore instanceof ConnectorCredentialStore);
  assert.deepEqual(Object.keys(built.drive).sort(), ['credentialBroker', 'credentialStore']);
});
