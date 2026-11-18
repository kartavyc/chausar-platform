import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import ipcContract from '../../app/desktop/ipc-contract.cjs';
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
  assert.deepEqual(METHODS.filter((method: string) => method.startsWith('phone.')), []);
  for (const method of ['phone.invite', 'phone.sessions', 'phone.revoke', 'phone.conversation.offer', 'phone.*', 'phone.chat.start', 'phone.pairing.accept', 'pairing.accept', 'session.validate', 'chat.start']) {
    assert.throws(() => validateRequest({ method, payload: {} }), code('INVALID_REQUEST'));
  }
  for (const input of [{ method: 'os.execute', payload: {} }, { method: 'workspace.status', payload: [] }, { method: 'workspace.status', payload: new Date() }, { method: 'workspace.status', payload: { number: NaN } }, { method: 'workspace.status', payload: {}, extra: true }, { method: 'workspace.status', payload: JSON.parse('{"__proto__": {"admin":true}}') }]) assert.throws(() => validateRequest(input), code('INVALID_REQUEST'));
  const cyclic: any = {}; cyclic.self = cyclic;
  assert.throws(() => validateRequest({ method: 'workspace.status', payload: cyclic }), code('INVALID_REQUEST'));
  let invoked = false; const getter = { get secret() { invoked = true; return 'secret'; } };
  assert.throws(() => validateRequest({ method: 'workspace.status', payload: getter }), code('INVALID_REQUEST')); assert.equal(invoked, false);
  assert.throws(() => validateRequest({ method: 'venture.files.add', payload: { content: 'x'.repeat(2_000_000) } }), code('REQUEST_TOO_LARGE'));
  assert.throws(() => validateRequest({ method: 'venture.files.add', payload: { repeated: Array(50).fill('x'.repeat(100_000)) } }), code('REQUEST_TOO_LARGE'));
  assert.throws(() => validateRequest({ method: 'venture.files.add', payload: { sparse: Array(1_000_000_000) } }), code('INVALID_REQUEST'));
  let deep: any = {}; for (let i = 0; i < 34; i++) deep = { child: deep };
  assert.throws(() => validateRequest({ method: 'workspace.status', payload: deep }), code('INVALID_REQUEST'));
  const source = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  const implemented = [...source.matchAll(/(?:case\s+|method === )'([a-z][a-zA-Z]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)'/g)].map(match => match[1]);
  assert.ok(implemented.includes('workspace.backups.drive.status'), 'Deeply nested methods must be included in the contract comparison.');
  // C5 tasks 21, 23: these two name a path, so only main asks them, after its own pick (keep-files.cjs): the decision is no.
  const mainOnly = ['workspace.import', 'workspace.backups.copyTo'];
  assert.deepEqual([...METHODS].sort(), [...new Set(implemented)].filter(method => !mainOnly.includes(method)).sort(), 'Engine additions need an explicit desktop contract decision.');
});

test('IPC sender requires the owned window main frame and exact document', () => {
  const mainFrame = { url: 'chausar://app/index.html' }, contents = { mainFrame };
  assertTrustedSender({ sender: contents, senderFrame: mainFrame }, contents);
  for (const event of [{ sender: {}, senderFrame: mainFrame }, { sender: contents, senderFrame: { url: mainFrame.url } }, { sender: contents, senderFrame: null }]) assert.throws(() => assertTrustedSender(event, contents), code('UNTRUSTED_SENDER'));
  mainFrame.url += '?attacker'; assert.throws(() => assertTrustedSender({ sender: contents, senderFrame: mainFrame }, contents), code('UNTRUSTED_SENDER'));
  assert.deepEqual(publicError(new Error('bounded')), { code: 'REQUEST_FAILED', message: 'bounded' });
  assert.equal(publicError({ code: 'bad-code', message: 'x'.repeat(1000), stack: 'private' }).message.length, 512);
  // Words the engine wrote for the owner (owner: true, set only by the engine's own refusals) arrive whole: a consent
  // the owner must read is never cut mid-sentence. They are still bounded, and anything unflagged keeps the short bound.
  const consent = 'Chats send your message and what Chausar reads to answer it. '.repeat(14);
  assert.ok(consent.length > 512);
  assert.deepEqual(publicError({ code: 'CHAT_CONSENT_REQUIRED', message: consent, owner: true }), { code: 'CHAT_CONSENT_REQUIRED', message: consent, owner: true });
  assert.equal(publicError({ code: 'CHAT_CONSENT_REQUIRED', message: 'y'.repeat(9000), owner: true }).message.length, 4096);
  for (const flag of [undefined, false, 'yes', 1]) assert.equal(publicError({ code: 'CHAT_CONSENT_REQUIRED', message: consent, owner: flag }).message.length, 512, String(flag));
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

// Found on the first real run of the Mac app (14 Nov 2026): Electron copies an error thrown across its context bridge
// with its message alone, so a refusal's code and owner flag never reached the page. `settled` answers the outcome of
// one bridge call as plain data, which crosses whole.
test('the bridge answers a refusal as plain data, so its code survives a bridge that keeps only an error\'s message', async () => {
  const source = await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8');
  const ipc = new EventEmitter() as any; let api: any;
  // As Electron's context bridge passes values on: data is cloned, and a rejection becomes a new Error with the message only.
  const asElectron = (value: any) => Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, typeof entry !== 'function' ? entry
    : (...args: unknown[]) => { const out = (entry as Function)(...args); return typeof out?.then === 'function' ? Promise.resolve(out).then(answer => (answer === undefined ? answer : structuredClone(answer)), error => { throw new Error(error?.message); }) : out; }]));
  vm.runInNewContext(source, { require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { api = asElectron(value); } } }) });
  const sent: any[] = [];
  ipc.invoke = async (channel: string, input: unknown) => { sent.push([channel, structuredClone(input)]); return { ok: false, error: { code: 'CHAT_CONSENT_REQUIRED', message: 'Agree first.', owner: true } }; };
  // The thrown error is what the page used to get: the words, and no code.
  await assert.rejects(api.request('venture.chief.thread.send', { text: 'Hello' }), (error: any) => error.message === 'Agree first.' && error.code === undefined);
  assert.deepEqual(await api.settled('request', 'venture.chief.thread.send', { text: 'Hello' }), { ok: false, error: { code: 'CHAT_CONSENT_REQUIRED', message: 'Agree first.', owner: true } });
  assert.deepEqual(sent.at(-1), ['chausar:request', { method: 'venture.chief.thread.send', payload: { text: 'Hello' } }]);
  ipc.invoke = async () => ({ ok: true, result: { open: false } });
  assert.deepEqual(await api.settled('request', 'workspace.status'), { ok: true, result: { open: false } });
  // Another call of the bridge the same way, with its own refusal.
  ipc.invoke = async () => ({ ok: false, error: { code: 'BACKGROUND_UNAVAILABLE', message: 'Not here.' } });
  assert.deepEqual(await api.settled('setBackground', { startAtLogin: true }), { ok: false, error: { code: 'BACKGROUND_UNAVAILABLE', message: 'Not here.' } });
  // Only the bridge's own calls: never itself, a listener, or a name it does not have.
  let invoked = 0; ipc.invoke = async () => { invoked += 1; return { ok: true }; };
  for (const name of ['settled', 'onEvent', 'onEngineStatus', 'firstPaint', 'constructor', 'toString', '__proto__', 'nothing', '', 7, null]) {
    assert.deepEqual(await api.settled(name, 'request', 'workspace.status'), { ok: false, error: { code: 'INVALID_REQUEST', message: 'That is not a desktop request.' } });
  }
  assert.equal(invoked, 0);
});

// ---------------------------------------------------------------------------
// One-shot C5 task 26: each request's timing: the method, the milliseconds and the bytes, never what was asked or answered.
// ---------------------------------------------------------------------------

test('C5 task 26: a request writes one timing line holding no payload text', async t => {
  const { mkdtemp: makeFolder, realpath } = await import('node:fs/promises');
  const { createRequire } = await import('node:module');
  const { createDiagnostics } = createRequire(import.meta.url)('../../app/desktop/diagnostics.cjs');
  const folder = await makeFolder(join(await realpath(tmpdir()), 'chausar-rpc-c5-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const log = createDiagnostics({ folder });
  const context = setup({ onTiming: (line: unknown) => { void log.line('rpc.jsonl', line); } });
  await ready(context);
  const asked = context.harness.request('venture.files.add', { content: 'secret-marker in the request' });
  const { id } = context.child.sent.at(-1);
  context.child.emit('message', { id, result: { text: 'secret-marker in the answer' } });
  assert.deepEqual(await asked, { text: 'secret-marker in the answer' });
  const refused = context.harness.request('venture.files.add', { content: 'secret-marker again' });
  context.child.emit('message', { id: context.child.sent.at(-1).id, error: { code: 'NOT_ALLOWED', message: 'secret-marker in the words' } });
  await assert.rejects(refused, code('NOT_ALLOWED'));
  await log.flushed();
  const text = await readFile(join(folder, 'rpc.jsonl'), 'utf8');
  assert.equal(text.includes('secret-marker'), false);
  const lines = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.length, 2);
  const { at: _a, ms: first, ...rest } = lines[0];
  assert.ok(Number.isInteger(first) && first >= 0);
  assert.deepEqual(rest, { method: 'venture.files.add', requestBytes: Buffer.byteLength(JSON.stringify({ content: 'secret-marker in the request' })), answerBytes: Buffer.byteLength(JSON.stringify({ text: 'secret-marker in the answer' })), ok: true });
  assert.equal(lines[1].ok, false);
  assert.equal(lines[1].code, 'NOT_ALLOWED');
  assert.equal(lines[1].answerBytes, 0);
});

test('C5 task 26: the host hooks write no timing line, and a broken timing writer changes nothing', async () => {
  const seen: unknown[] = [];
  const context = setup({ onTiming: (line: unknown) => { seen.push(line); throw new Error('no disk'); } });
  await ready(context);
  const hook = context.harness.prepareUpdateInstall({ backup: false });
  context.child.emit('message', { id: context.child.sent.at(-1).id, result: { busy: false, openDataSchema: null, backup: 'skipped' } });
  await hook;
  assert.deepEqual(seen, []);
  const asked = context.harness.request('workspace.status');
  context.child.emit('message', { id: context.child.sent.at(-1).id, result: { open: false } });
  assert.deepEqual(await asked, { open: false });
  assert.equal(seen.length, 1);
});

// ---------------------------------------------------------------------------
// One-shot C5 task 29: a dead worker fails what was pending; nothing is kept to send to the next one.
// ---------------------------------------------------------------------------

test('C5 task 29: a pending approval fails when the worker dies, and a harness said to be reconnecting refuses in plain words', async () => {
  const context = setup({ requestTimeoutMs: 1000 });
  await ready(context);
  const statuses: unknown[] = [];
  context.harness.on('status', (status: unknown) => statuses.push(status));
  const approval = context.harness.request('venture.queue.decide', { id: 'x', decision: 'approve' });
  const sent = context.child.sent.length;
  context.child.connected = false;
  context.child.emit('exit', 1, null);
  await assert.rejects(approval, code('ENGINE_EXITED'));
  assert.equal(context.child.sent.length, sent, 'not sent again');
  context.harness.reconnecting();
  assert.equal(context.harness.state, 'reconnecting');
  assert.deepEqual(statuses.at(-1), { state: 'reconnecting', healthy: false });
  await assert.rejects(context.harness.request('workspace.status'), (error: any) => error.code === 'ENGINE_UNAVAILABLE' && /reconnecting/i.test(error.message));
});
