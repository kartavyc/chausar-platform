import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
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
  const implemented = [...source.matchAll(/(?:case\s+|method === )'([a-z]+(?:\.[a-zA-Z]+)+)'/g)].map(match => match[1]);
  assert.ok(implemented.includes('jobs.calendar.configure'), 'Nested calendar methods must be included in the contract comparison.');
  assert.deepEqual([...METHODS].sort(), [...new Set(implemented)].sort(), 'Engine additions need an explicit desktop contract decision.');
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
