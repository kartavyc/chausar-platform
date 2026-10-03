import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { fork, type ChildProcess, type ForkOptions } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import ipcContract from '../../app/desktop/ipc-contract.cjs';
import type { PhoneSessionInvite, PhoneSessionMetadata } from '../runtime/engine-phone-sessions.ts';
import type { SessionGrant } from '../runtime/phone/contracts.ts';
const { METHODS, validateRequest, assertTrustedSender, publicError } = ipcContract;

class Child extends EventEmitter {
  connected = true; sent: any[] = []; disconnects = 0; kills = 0; failSend = false; ignoreDisconnect = false;
  send(value: any, callback: (error?: Error) => void) { this.sent.push(value); callback(this.failSend ? new Error('send failed') : undefined); }
  disconnect() { this.disconnects++; this.connected = false; this.emit('disconnect'); if (!this.ignoreDisconnect) queueMicrotask(() => this.emit('exit', 0, null)); }
  kill() { this.kills++; this.connected = false; queueMicrotask(() => this.emit('exit', 137, 'SIGKILL')); return true; }
}
function setup(options: any = {}) {
  const child = new Child(); let launch: any;
  const harness = new EngineHarness({ workerPath: '/owned/worker.ts', environment: { CHAUSAR_DEMO: '1' }, startupTimeoutMs: 2000, shutdownTimeoutMs: 30, requestTimeoutMs: 30, forkProcess: (path: string, args: string[], config: any) => { launch = { path, args, config }; return child; }, ...options });
  return { child, harness, launch: () => launch };
}
async function ready(context: ReturnType<typeof setup>) { const start = context.harness.start(); context.child.emit('message', { ready: true }); await start; }
const code = (expected: string) => (error: any) => error.code === expected;

test('desktop accepts only explicit engine methods and bounded plain JSON payloads', async () => {
  assert.deepEqual(validateRequest({ method: 'workspace.status' }), { method: 'workspace.status', payload: {} });
  const ownerPhoneMethods = ['phone.invite', 'phone.sessions', 'phone.revoke', 'phone.conversation.offer'];
  assert.deepEqual(METHODS.filter((method: string) => method.startsWith('phone.')), ownerPhoneMethods);
  for (const method of ownerPhoneMethods) assert.deepEqual(validateRequest({ method, payload: {} }), { method, payload: {} });
  for (const method of ['phone.*', 'phone.chat.start', 'phone.pairing.accept', 'pairing.accept', 'session.validate', 'chat.start']) {
    assert.throws(() => validateRequest({ method, payload: {} }), code('INVALID_REQUEST'));
  }
  for (const input of [{ method: 'os.execute', payload: {} }, { method: 'workspace.status', payload: [] }, { method: 'workspace.status', payload: new Date() }, { method: 'workspace.status', payload: { number: NaN } }, { method: 'workspace.status', payload: {}, extra: true }, { method: 'workspace.status', payload: JSON.parse('{"__proto__": {"admin":true}}') }]) assert.throws(() => validateRequest(input), code('INVALID_REQUEST'));
  const cyclic: any = {}; cyclic.self = cyclic;
  assert.throws(() => validateRequest({ method: 'workspace.status', payload: cyclic }), code('INVALID_REQUEST'));
  let invoked = false; const getter = { get secret() { invoked = true; return 'secret'; } };
  assert.throws(() => validateRequest({ method: 'workspace.status', payload: getter }), code('INVALID_REQUEST')); assert.equal(invoked, false);
  assert.throws(() => validateRequest({ method: 'sources.preview', payload: { content: 'x'.repeat(2_000_000) } }), code('REQUEST_TOO_LARGE'));
  assert.throws(() => validateRequest({ method: 'sources.preview', payload: { repeated: Array(50).fill('x'.repeat(100_000)) } }), code('REQUEST_TOO_LARGE'));
  assert.throws(() => validateRequest({ method: 'sources.preview', payload: { sparse: Array(1_000_000_000) } }), code('INVALID_REQUEST'));
  let deep: any = {}; for (let i = 0; i < 34; i++) deep = { child: deep };
  assert.throws(() => validateRequest({ method: 'workspace.status', payload: deep }), code('INVALID_REQUEST'));
  const source = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  const implemented = [...source.matchAll(/(?:case\s+|method === )'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)'/g)].map(match => match[1]);
  assert.ok(implemented.includes('jobs.calendar.configure'), 'Nested calendar methods must be included in the contract comparison.');
  assert.ok(implemented.includes('workspace.backup.v2.restoreInert'), 'Versioned archive methods must be included in the contract comparison.');
  assert.deepEqual([...METHODS].sort(), [...new Set(implemented)].sort(), 'Engine additions need an explicit desktop contract decision.');
});

test('headless desktop worker joins exact owner phone methods to its actual synthetic Vault', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-desktop-phone-owner-'));
  const workerPath = join(directory, 'synthetic-worker.mjs');
  // Trusted, disposable host fixture: owner requests use the production worker
  // loop. Signed companion HTTP is fed to the real Engine handler in memory,
  // without a socket, a renderer transport alias, or a live model provider.
  await writeFile(workerPath, `
import { Readable } from 'node:stream';
import { Engine } from ${JSON.stringify(new URL('../runtime/engine.ts', import.meta.url).href)};
import { runEngineWorker } from ${JSON.stringify(new URL('../runtime/worker.ts', import.meta.url).href)};
let providerCalls = 0;
const engine = new Engine({ directory: ${JSON.stringify(directory)}, demo: true, storage: 'experimental-file', gateway: {
  http: async () => { providerCalls++; throw new Error('Synthetic provider must not dispatch in the owner bridge test.'); },
} });
process.on('message', async message => {
  if (message?.kind !== 'synthetic-companion-http') return;
  const request = Readable.from([Buffer.from(message.body)]);
  Object.assign(request, { method: 'POST', url: '/api/companion/rpc', headers: message.headers,
    rawHeaders: Object.entries(message.headers).flat() });
  const response = { statusCode: 0, setHeader() {}, end(body) {
    process.send?.({ kind: 'synthetic-companion-result', id: message.id,
      status: this.statusCode, body: JSON.parse(body), providerCalls });
  } };
  await engine.handleCompanionHttp(request, response);
});
runEngineWorker(engine);
`, 'utf8');
  const launched: { child?: ChildProcess } = {};
  const harness = new EngineHarness({ workerPath, environment: {}, startupTimeoutMs: 10000,
    requestTimeoutMs: 10000, shutdownTimeoutMs: 10000, forkProcess: (path, args, options) => {
      const child = fork(path, args, options as ForkOptions); launched.child = child; return child;
    } });
  t.after(async () => {
    await harness.stop();
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert.ok(basename(target).startsWith('chausar-desktop-phone-owner-'));
    await rm(target, { recursive: true, force: true });
  });
  await harness.start();
  const mainFrame = { url: 'chausar://app/index.html' }, contents = { mainFrame };
  const owner = <T = unknown>(method: string, payload: Record<string, unknown> = {}): Promise<T> => {
    assertTrustedSender({ sender: contents, senderFrame: mainFrame }, contents);
    return harness.request(method, payload) as Promise<T>;
  };
  await owner('workspace.create', { name: 'SYNTHETIC desktop phone owner business', folder: 'fixture',
    passphrase: 'SYNTHETIC disposable desktop phone passphrase', demo: false, pack: 'ecommerce' });
  await owner('sources.import', { sourceId: 'synthetic-owner-sale', format: 'csv',
    content: 'id,kind,date,amount,currency,branch,status\nsynthetic-sale,sale,2026-09-05,12000,INR,main,delivered',
    expectedTotals: { rowCount: 1, amountMinor: '12000' }, recipe: {
      version: 1, id: 'synthetic-owner-recipe', system: 'synthetic-csv', edition: '1',
      scope: { company: 'SYNTHETIC desktop phone owner business', branches: ['main'] }, bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
        { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch', 'status'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
      ], allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject',
    } });
  await owner('models.configure', { config: { id: 'synthetic-owner-phone-route', kind: 'openai-responses',
    model: 'synthetic-fixture-only', endpoint: 'https://synthetic-owner-phone.invalid/v1/responses',
    budgetMinor: '0', maxCostMinor: '0' }, secret: 'synthetic-fixture-only' });
  await owner('trust.update', { send: 'shape' });
  const keys = generateKeyPairSync('ed25519'), deviceId = 'synthetic-owner-phone', keyId = 'synthetic-owner-key';
  const devicePublicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  const invite = await owner<PhoneSessionInvite>('phone.invite', { memberId: 'owner', deviceId, keyId, channel: 'web', devicePublicKey,
    capabilities: ['chat'], inviteTtlMs: 60000, sessionTtlMs: 600000 });
  assert.deepEqual(await owner('phone.sessions'), []);
  const proof = sign(null, Buffer.from(JSON.stringify(['chausar-phone-pairing-v1', invite.inviteCode,
    deviceId, 'web', keyId, devicePublicKey])), keys.privateKey).toString('base64url');
  const body = JSON.stringify({ protocolVersion: 1, method: 'pairing.accept', payload: {
    inviteCode: invite.inviteCode, deviceId, channel: 'web', devicePublicKey, proof,
  } });
  const timestamp = new Date().toISOString(), nonce = randomBytes(32).toString('base64url');
  const bytes = Buffer.from(JSON.stringify(['chausar-phone-request-v1', 'POST', '/api/companion/rpc',
    deviceId, keyId, timestamp, nonce, null, Buffer.byteLength(body)]) + '\n' + body);
  const headers = { 'content-type': 'application/json', 'x-chausar-device': deviceId, 'x-chausar-key': keyId,
    'x-chausar-time': timestamp, 'x-chausar-nonce': nonce,
    'x-chausar-proof': sign(null, bytes, keys.privateKey).toString('base64url') };
  assert.ok(launched.child); const child = launched.child;
  const pair = await new Promise<{ status: number; body: { result?: SessionGrant; error?: { code: string } }; providerCalls: number }>((resolvePair, reject) => {
    const id = 'synthetic-owner-pair';
    const cleanup = () => { clearTimeout(timer); child.removeListener('message', receive); };
    const receive = (message: any) => {
      if (message?.kind !== 'synthetic-companion-result' || message.id !== id) return;
      cleanup(); resolvePair(message);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Synthetic in-memory pairing timed out.')); }, 10000);
    child.on('message', receive);
    child.send({ kind: 'synthetic-companion-http', id, body, headers }, error => { if (error) { cleanup(); reject(error); } });
  });
  assert.equal(pair.status, 200); assert.equal(pair.body.error, undefined); assert.equal(pair.providerCalls, 0);
  assert.ok(pair.body.result); const grant = pair.body.result, sessionId = grant.authority.sessionId;
  assert.notEqual(grant.credential, invite.inviteCode);
  const metadata = await owner<PhoneSessionMetadata[]>('phone.sessions');
  assert.equal(metadata.length, 1); assert.equal(metadata[0].sessionId, sessionId);
  assert.deepEqual(Object.keys(metadata[0]).sort(), ['binding', 'capabilities', 'channel', 'expiresAt', 'keyId', 'revoked', 'sessionId']);
  const request = { purpose: 'conversation', questionDisclosure: 'verbatim', routeId: 'synthetic-owner-phone-route',
    question: 'SYNTHETIC: calculate September revenue from the reviewed source.',
    sourceIds: ['synthetic-owner-sale'], period: { from: '2026-09-01', to: '2026-09-30' } };
  const preview = await owner<{ id: string }>('models.preview', request);
  const approval = await owner<{ id: string }>('models.approve', { id: preview.id });
  const offerInput = { sessionId, request: { ...request, previewId: preview.id, approvalId: approval.id } };
  const offer = await owner<{ sessionId: string; previewId: string }>('phone.conversation.offer', offerInput);
  assert.equal(offer.sessionId, sessionId); assert.equal(offer.previewId, preview.id);
  assert.deepEqual(await owner('phone.revoke', { sessionId }), { sessionId, revoked: true });
  assert.equal((await owner<PhoneSessionMetadata[]>('phone.sessions'))[0].revoked, true);
  await assert.rejects(owner('phone.conversation.offer', offerInput), code('ACCESS_REVOKED'));
  assert.throws(() => validateRequest({ method: 'chat.start', payload: {} }), code('INVALID_REQUEST'));
});

test('IPC sender requires the owned window main frame and exact document', () => {
  const mainFrame = { url: 'chausar://app/index.html' }, contents = { mainFrame };
  assertTrustedSender({ sender: contents, senderFrame: mainFrame }, contents);
  for (const event of [{ sender: {}, senderFrame: mainFrame }, { sender: contents, senderFrame: { url: mainFrame.url } }, { sender: contents, senderFrame: null }]) assert.throws(() => assertTrustedSender(event, contents), code('UNTRUSTED_SENDER'));
  mainFrame.url += '?attacker'; assert.throws(() => assertTrustedSender({ sender: contents, senderFrame: mainFrame }, contents), code('UNTRUSTED_SENDER'));
  assert.deepEqual(publicError(new Error('bounded')), { code: 'REQUEST_FAILED', message: 'bounded' });
  assert.equal(publicError({ code: 'bad-code', message: 'x'.repeat(1000), stack: 'private' }).message.length, 512);
});

test('worker launch hides windows, uses owned paths, and sends correlated requests', async () => {
  const context = setup(); await ready(context);
  assert.equal(context.launch().config.windowsHide, true); assert.equal(context.launch().config.shell, false);
  assert.equal(context.launch().config.env.ELECTRON_RUN_AS_NODE, '1'); assert.deepEqual(context.launch().config.stdio, ['ignore', 'ignore', 'ignore', 'ipc']);
  const result = context.harness.request('workspace.status');
  context.child.emit('message', { id: 'unrecognized', result: 'ignored' });
  context.child.emit('message', { id: context.child.sent[0].id, result: { open: false } });
  assert.deepEqual(await result, { open: false }); assert.equal(context.harness.waiting.size, 0);
  assert.equal((await context.harness.stop()).graceful, true); assert.equal(context.child.disconnects, 1);
  await assert.rejects(context.harness.start(), code('ENGINE_RESTART_REFUSED'));
});

test('pre-ready exit rejects startup immediately and a stalled startup terminates its worker', async () => {
  const exited = setup(); const start = exited.harness.start(); exited.child.emit('exit', 1, null);
  await assert.rejects(start, code('ENGINE_EXITED')); assert.equal(exited.harness.state, 'failed'); await exited.harness.stop();
  const stalled = setup({ startupTimeoutMs: 20 });
  await assert.rejects(stalled.harness.start(), code('ENGINE_START_TIMEOUT')); assert.equal(stalled.child.kills, 1); await stalled.harness.stop();
});

test('crash, send failure, timeout and overload remove pending requests without replay', async () => {
  const context = setup({ maxPending: 1 }); await ready(context);
  const first = context.harness.request('workspace.status');
  await assert.rejects(context.harness.request('workspace.status'), code('ENGINE_BUSY'));
  await assert.rejects(first, code('REQUEST_TIMEOUT')); assert.equal(context.harness.waiting.size, 0);
  context.child.failSend = true; await assert.rejects(context.harness.request('workspace.status'), code('ENGINE_SEND_FAILED'));
  context.child.failSend = false; const crashed = context.harness.request('workspace.status'); context.child.emit('exit', 2, null);
  await assert.rejects(crashed, code('ENGINE_EXITED')); assert.equal(context.child.sent.length, 3);
  await assert.rejects(context.harness.request('workspace.status'), code('ENGINE_UNAVAILABLE')); await context.harness.stop();
});

test('shutdown is idempotent and forces a stalled worker without accepting new work', async () => {
  const context = setup(); await ready(context); context.child.ignoreDisconnect = true;
  const pending = context.harness.request('workspace.status'); const stop = context.harness.stop();
  assert.equal(context.harness.stop(), stop); await assert.rejects(pending, code('ENGINE_STOPPING'));
  await assert.rejects(context.harness.request('workspace.status'), code('ENGINE_UNAVAILABLE'));
  assert.equal((await stop).forced, true); assert.equal(context.child.kills, 1); assert.equal(context.harness.state, 'stopped');
});

test('sandbox bridge unwraps typed envelopes and removes only its status listener', async () => {
  const source = await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8');
  const ipc = new EventEmitter() as any; ipc.invoke = async () => ({ ok: true, result: { open: false } }); let api: any;
  vm.runInNewContext(source, { require: (module: string) => { assert.equal(module, 'electron'); return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { assert.equal(name, 'chausar'); api = value; } } }; } });
  assert.equal((await api.request('workspace.status')).open, false);
  ipc.invoke = async () => ({ ok: false, error: { code: 'VAULT_BUSY', message: 'Wait.' } }); await assert.rejects(api.request('workspace.status'), code('VAULT_BUSY'));
  let status: any; const remove = api.onEngineStatus((value: any) => { status = value; }); ipc.emit('chausar:engine-status', {}, { healthy: false, state: 'failed', private: 'not forwarded' });
  assert.equal(status.state, 'failed'); assert.equal(status.private, undefined); assert.equal(Object.isFrozen(status), true); remove(); assert.equal(ipc.listenerCount('chausar:engine-status'), 0);
});
