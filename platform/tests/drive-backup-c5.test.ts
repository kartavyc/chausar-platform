// C5 task 24: Google Drive backup, built up to the OAuth client, against a stand-in Google on 127.0.0.1. Any real fetch fails
// the test (helpers/no-net.ts wraps what the module may reach). With no client id every method answers DRIVE_NOT_SET_UP and
// no call goes anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { DRIVE_FOLDER, DRIVE_SCOPE, DriveBackup, driveClientFrom, type DriveTokens } from '../runtime/drive-backup.ts';
import { Engine } from '../runtime/engine.ts';
import { memoryDeviceKeyStore } from '../runtime/device-custody.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };
const body = (request: IncomingMessage) => new Promise<Buffer>(resolve => { const parts: Buffer[] = []; request.on('data', part => parts.push(part)); request.on('end', () => resolve(Buffer.concat(parts))); request.on('error', () => resolve(Buffer.concat(parts))); });

type File = { id: string; name: string; parents: string[]; mimeType?: string; bytes?: Buffer };
function standIn(t: any) {
  const state = {
    challenge: null as string | null, verifiers: [] as string[], tokenForms: [] as URLSearchParams[], files: [] as File[], sessions: new Map<string, { name: string; parents: string[]; received: Buffer }>(),
    cutNext: false, revoked: false, cuts: 0, requests: [] as string[], next: 1,
  };
  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url!, 'http://127.0.0.1');
    state.requests.push(`${request.method} ${url.pathname}`);
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) => { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(JSON.stringify(value)); };
    if (url.pathname === '/token') {
      const form = new URLSearchParams((await body(request)).toString());
      state.tokenForms.push(form);
      if (form.get('grant_type') === 'authorization_code') {
        state.verifiers.push(form.get('code_verifier') ?? '');
        return json(200, { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 });
      }
      if (state.revoked) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: 'access-2', expires_in: 3600 });
    }
    if (request.headers.authorization !== 'Bearer access-1' && request.headers.authorization !== 'Bearer access-2' && !url.pathname.startsWith('/session/')) return json(401, { error: 'unauthorized' });
    if (url.pathname === '/files' && request.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const named = /name = '([^']+)'/.exec(q)?.[1];
      const found = state.files.filter(file => (!parent || file.parents.includes(parent)) && (!named || file.name === named));
      return json(200, { files: found.map(({ id, name }) => ({ id, name })) });
    }
    if (url.pathname === '/files' && request.method === 'POST') {
      const meta = JSON.parse((await body(request)).toString());
      const file: File = { id: `id-${state.next++}`, name: meta.name, parents: meta.parents ?? [], mimeType: meta.mimeType };
      state.files.push(file);
      return json(200, { id: file.id });
    }
    if (url.pathname.startsWith('/files/') && request.method === 'DELETE') {
      state.files = state.files.filter(file => file.id !== url.pathname.slice('/files/'.length));
      response.writeHead(204); return response.end();
    }
    if (url.pathname === '/upload' && request.method === 'POST') {
      const meta = JSON.parse((await body(request)).toString());
      const id = `s${state.next++}`;
      state.sessions.set(id, { name: meta.name, parents: meta.parents, received: Buffer.alloc(0) });
      const port = (server.address() as AddressInfo).port;
      response.writeHead(200, { location: `http://127.0.0.1:${port}/session/${id}` });
      return response.end();
    }
    if (url.pathname.startsWith('/session/') && request.method === 'PUT') {
      const session = state.sessions.get(url.pathname.slice('/session/'.length))!;
      const range = String(request.headers['content-range']);
      const asking = /^bytes \*\/(\d+)$/.exec(range);
      if (asking) {
        response.writeHead(308, session.received.length ? { range: `bytes=0-${session.received.length - 1}` } : {});
        return response.end();
      }
      const chunk = await body(request);
      const [, from, to, total] = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)!;
      assert.equal(Number(from), session.received.length, 'each chunk starts where the last one stopped');
      assert.equal(Number(to) - Number(from) + 1, chunk.length);
      if (state.cutNext) { state.cutNext = false; state.cuts++; session.received = Buffer.concat([session.received, chunk]); return request.socket.destroy(); }
      session.received = Buffer.concat([session.received, chunk]);
      if (session.received.length < Number(total)) { response.writeHead(308, { range: `bytes=0-${session.received.length - 1}` }); return response.end(); }
      const file: File = { id: `id-${state.next++}`, name: session.name, parents: session.parents, bytes: session.received };
      state.files.push(file);
      return json(200, { id: file.id });
    }
    return json(404, { error: 'not found' });
  });
  return new Promise<{ state: typeof state; endpoints: any }>(resolve => server.listen(0, '127.0.0.1', () => {
    t.after(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve({ state, endpoints: { auth: `${base}/auth`, token: `${base}/token`, files: `${base}/files`, upload: `${base}/upload` } });
  }));
}
function memoryTokens(): DriveTokens & { value: string | null } {
  return { value: null, async read() { return this.value; }, async write(text: string) { this.value = text; }, async remove() { this.value = null; } };
}
/** Acts as the owner's browser: Google sends it back to the loopback address with a code. */
async function signIn(drive: DriveBackup, state: { challenge: string | null }) {
  const { url } = await drive.connect();
  const auth = new URL(url);
  state.challenge = auth.searchParams.get('code_challenge');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('scope'), DRIVE_SCOPE);
  assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file', 'drive.file only');
  assert.equal(auth.searchParams.get('access_type'), 'offline');
  const redirect = new URL(auth.searchParams.get('redirect_uri')!);
  assert.equal(redirect.hostname, '127.0.0.1');
  const wrong = await fetch(`${redirect.href}?code=stolen&state=not-the-state`);
  assert.equal(wrong.status, 400, 'another state is refused');
  const back = await fetch(`${redirect.href}?code=the-code&state=${auth.searchParams.get('state')}`);
  assert.equal(back.status, 200);
  await drive.connected();
}

test('no client id: every method answers DRIVE_NOT_SET_UP and no call goes anywhere', async t => {
  const fetched = t.mock.method(globalThis, 'fetch', async () => { throw new Error('a call went out'); });
  const drive = new DriveBackup({ clientId: null, tokens: memoryTokens() });
  await assert.rejects(drive.status(), code('DRIVE_NOT_SET_UP'));
  await assert.rejects(drive.connect(), code('DRIVE_NOT_SET_UP'));
  await assert.rejects(drive.disconnect(), code('DRIVE_NOT_SET_UP'));
  await assert.rejects(drive.upload('chausar-w-1-auto.backup', Buffer.from('x'), 'w'), code('DRIVE_NOT_SET_UP'));
  assert.equal(fetched.mock.callCount(), 0);
  assert.deepEqual(driveClientFrom({ name: 'chausar', chausarGoogleClientId: '' }), { clientId: null, clientSecret: null });
  assert.deepEqual(driveClientFrom({ chausarGoogleClientId: 'abc.apps.googleusercontent.com', chausarGoogleClientSecret: 's' }), { clientId: 'abc.apps.googleusercontent.com', clientSecret: 's' });
  assert.deepEqual(driveClientFrom(null), { clientId: null, clientSecret: null });
});

test('sign-in: the PKCE verifier is sent and matches its challenge; the refresh token goes to the store and nowhere else', async t => {
  const { state, endpoints } = await standIn(t), tokens = memoryTokens();
  const drive = new DriveBackup({ clientId: 'client', tokens, endpoints });
  assert.equal((await drive.status()).state, 'not-connected');
  await signIn(drive, state);
  assert.equal(createHash('sha256').update(state.verifiers[0]!).digest('base64url'), state.challenge);
  assert.ok(state.verifiers[0]!.length >= 43, 'a long verifier');
  assert.equal(JSON.parse(tokens.value!).refresh, 'refresh-1');
  assert.equal((await drive.status()).state, 'connected');
  await drive.disconnect();
  assert.equal(tokens.value, null);
  assert.equal((await drive.status()).state, 'not-connected');
});

test('upload: resumes after a cut, into one Chausar backups folder, keeping 5, and touches nothing else', async t => {
  const { state, endpoints } = await standIn(t), tokens = memoryTokens();
  const drive = new DriveBackup({ clientId: 'client', tokens, endpoints, chunkBytes: 1024 });
  await signIn(drive, state);
  const bytes = Buffer.alloc(5000, 7);
  state.cutNext = true;
  await drive.upload('chausar-w-1-auto.backup', bytes, 'w');
  assert.equal(state.cuts, 1, 'the cut happened');
  const stored = state.files.find(file => file.name === 'chausar-w-1-auto.backup')!;
  assert.deepEqual(stored.bytes, bytes, 'whole, byte for byte, after the cut');
  const folders = state.files.filter(file => file.name === DRIVE_FOLDER);
  assert.equal(folders.length, 1);
  assert.deepEqual(stored.parents, [folders[0]!.id]);

  state.files.push({ id: 'someone-elses', name: 'chausar-other-1-auto.backup', parents: [folders[0]!.id] }, { id: 'owners', name: 'notes.txt', parents: [folders[0]!.id] });
  for (let at = 2; at <= 7; at++) await drive.upload(`chausar-w-${at}-auto.backup`, Buffer.from([at]), 'w');
  assert.equal(state.files.filter(file => file.name === DRIVE_FOLDER).length, 1, 'one folder, found again');
  assert.deepEqual(state.files.filter(file => file.name.startsWith('chausar-w-')).map(file => file.name).sort(), [3, 4, 5, 6, 7].map(at => `chausar-w-${at}-auto.backup`));
  assert.ok(state.files.some(file => file.id === 'someone-elses') && state.files.some(file => file.id === 'owners'));
});

test('a revoked token says Connect Google Drive again, and forgets what it held', async t => {
  const { state, endpoints } = await standIn(t), tokens = memoryTokens();
  const first = new DriveBackup({ clientId: 'client', tokens, endpoints });
  await signIn(first, state);
  state.revoked = true;
  const later = new DriveBackup({ clientId: 'client', tokens, endpoints });
  await assert.rejects(later.upload('chausar-w-1-auto.backup', Buffer.from('x'), 'w'), (error: any) => {
    assert.equal(error.code, 'DRIVE_RECONNECT');
    assert.equal(error.message, 'Connect Google Drive again.');
    return true;
  });
  assert.equal(tokens.value, null);
});

test('the engine: no client id answers DRIVE_NOT_SET_UP; connected, an automatic backup goes up as ciphertext only', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-drive-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const none = new Engine({ directory: join(directory, 'a'), demo: true, storage: 'experimental-file', workspaceCustody: { deviceKeys: memoryDeviceKeyStore(), autoBackups: true }, drive: { clientId: null } });
  t.after(() => none.close().catch(() => {}));
  await none.request('workspace.create', { name: 'No Drive Shop', pack: 'services', folder: null });
  for (const method of ['status', 'connect', 'disconnect']) await assert.rejects(none.request(`workspace.backups.drive.${method}`, {}), code('DRIVE_NOT_SET_UP'));

  const { state, endpoints } = await standIn(t), tokens = memoryTokens();
  const clock = { now: Date.parse('2026-10-18T09:00:00.000Z') };
  const engine = new Engine({ directory: join(directory, 'b'), demo: true, storage: 'experimental-file', workspaceCustody: { deviceKeys: memoryDeviceKeyStore(), autoBackups: true, clock: () => clock.now }, drive: { clientId: 'client', endpoints, tokens, chunkBytes: 4096 } });
  t.after(() => engine.close().catch(() => {}));
  await engine.request('workspace.create', { name: 'Rosetta Drive Shop', pack: 'services', folder: null });
  assert.equal((await engine.request('workspace.backups.drive.status', {})).state, 'not-connected');
  const { url } = await engine.request('workspace.backups.drive.connect', {});
  const auth = new URL(url);
  await fetch(`${auth.searchParams.get('redirect_uri')}?code=the-code&state=${auth.searchParams.get('state')}`);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await engine.request('workspace.backups.drive.status', {})).state, 'connected');
  await engine.tick();
  const uploaded = state.files.filter(file => /\.backup$/.test(file.name));
  assert.equal(uploaded.length, 1);
  const text = uploaded[0]!.bytes!.toString('utf8');
  assert.equal(JSON.parse(text).backupFormat, 'chausar.backup.v1');
  assert.ok(!text.includes('Rosetta'));
  const status = await engine.request('workspace.backups.drive.status', {});
  assert.equal(status.problem, null);
  assert.equal(status.lastCopiedAt, new Date(clock.now).toISOString());
  await engine.tick();
  assert.equal(state.files.filter(file => /\.backup$/.test(file.name)).length, 1, 'one upload for one backup');
  // No token, refresh or code anywhere on disk beside the vault.
  const card = await readFile(join(directory, 'b', 'custody', 'cards', 'rosetta-drive-shop.json'), 'utf8');
  assert.ok(!card.includes('refresh-1') && !card.includes('access-1'));
});
