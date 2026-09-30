import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';

class Child extends EventEmitter {
  connected = true; sent: any[] = []; disconnects = 0;
  send(message: any, callback: (error?: Error) => void) { this.sent.push(message); callback(); }
  disconnect() { this.disconnects++; this.connected = false; queueMicrotask(() => this.emit('exit', 0, null)); }
  kill() { this.connected = false; queueMicrotask(() => this.emit('exit', 137, 'SIGKILL')); return true; }
}
async function setup() {
  const child = new Child();
  const harness = new EngineHarness({ workerPath: '/owned/worker.ts', environment: {}, forkProcess: () => child, lifecycleTimeoutMs: 20, requestTimeoutMs: 100, shutdownTimeoutMs: 100 });
  const start = harness.start(); child.emit('message', { ready: true }); await start;
  return { child, harness };
}
const state = { awake: true, windowOpen: false, backgroundEnabled: true };
const code = (expected: string) => (error: any) => error.code === expected;

test('host lifecycle is private, correlated and resolved only by the matching acknowledgement', async () => {
  const { child, harness } = await setup();
  await assert.rejects(harness.request('host.lifecycle', state), code('INVALID_REQUEST'));
  const updated = harness.updateJobLifecycle(state), ordinary = harness.request('workspace.status');
  assert.equal(child.sent[0].kind, 'host-lifecycle'); assert.deepEqual(child.sent[0].state, state);
  assert.notEqual(child.sent[0].id, child.sent[1].id);
  child.emit('message', { id: child.sent[1].id, result: { open: false } });
  assert.deepEqual(await ordinary, { open: false }); assert.equal(harness.waiting.size, 1);
  child.emit('message', { id: 'other-id', kind: 'host-lifecycle', applied: true, result: { applied: true } });
  assert.equal(harness.waiting.size, 1);
  child.emit('message', { id: child.sent[0].id, kind: 'host-lifecycle', applied: true, result: { applied: true } });
  assert.deepEqual(await updated, { applied: true }); await harness.stop();
});

test('invalid lifecycle shape never reaches the worker and a wrong acknowledgement stops it', async () => {
  const { child, harness } = await setup();
  await assert.rejects(harness.updateJobLifecycle({ ...state, extra: true } as any), code('INVALID_JOB_LIFECYCLE'));
  assert.equal(child.sent.length, 0);
  const updated = harness.updateJobLifecycle(state);
  child.emit('message', { id: child.sent[0].id, result: { applied: true } });
  await assert.rejects(updated, code('INVALID_JOB_LIFECYCLE_ACK'));
  assert.equal(child.disconnects, 1); assert.notEqual(harness.state, 'ready'); await harness.stop();
});

test('missing lifecycle acknowledgement drains the worker without replay or stale scheduling', async () => {
  const { child, harness } = await setup();
  await assert.rejects(harness.updateJobLifecycle(state), code('JOB_LIFECYCLE_TIMEOUT'));
  assert.equal(child.sent.length, 1); assert.equal(child.disconnects, 1); assert.equal(harness.waiting.size, 0);
  await assert.rejects(harness.request('workspace.status'), code('ENGINE_UNAVAILABLE')); await harness.stop();
});

test('real worker acknowledges host state and exposes it through the product job status', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-desktop-lifecycle-'));
  const harness = new EngineHarness({ workerPath: fileURLToPath(new URL('../runtime/worker.ts', import.meta.url)), environment: { SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), TMP: tmpdir(), CHAUSAR_DEMO: '1', CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_UPDATE_PUBLIC_KEY: '' } });
  t.after(async () => { await harness.stop(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  await harness.start(); assert.deepEqual(await harness.updateJobLifecycle(state), { applied: true });
  await harness.request('workspace.create', { folder: 'lifecycle', name: 'Synthetic lifecycle test', passphrase: 'synthetic-lifecycle-passphrase' });
  const status = await harness.request('jobs.types') as { lifecycle: typeof state };
  assert.deepEqual(status.lifecycle, state);
  const asleep = { awake: false, windowOpen: false, backgroundEnabled: true };
  await harness.updateJobLifecycle(asleep);
  assert.deepEqual((await harness.request('jobs.types') as { lifecycle: typeof state }).lifecycle, asleep);
});
