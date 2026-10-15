import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fork, type ForkOptions } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { audit, type Context } from '../runtime/contracts.ts';
import { EngineEventBus } from '../runtime/core-sync-jobs/event-bus.ts';
import { eventKinds, eventMethods, EVENTS_PAGE } from '../runtime/core-sync-jobs/events-methods.ts';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import ipcContract from '../../app/desktop/ipc-contract.cjs';

const passphrase = 'Core sync jobs synthetic passphrase 2026';
const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => error?.code === expected;

async function engineWith(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-sync-events-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Core Sync Events Shop', passphrase, demo: false, pack: 'ecommerce', folder: 'main' });
  return engine;
}
/** `events.subscribe` through the module seam, as the engine will run it once the lane module lists it. */
const subscribe = (engine: Engine, payload: Record<string, unknown> = {}, ctx: Context = OWNER): Promise<any> =>
  engine.withContext(ctx, () => eventMethods['events.subscribe']!.handler(ctx, payload, engine.moduleHost('core-sync-jobs', ctx)));
const record = (engine: Engine, event: string, details: Record<string, unknown> = { memberId: 'owner' }) => engine.vault!.update(state => { audit(state, event, details); });

test('event kinds: every event is activity, its type adds the screens it touches', () => {
  assert.deepEqual(eventKinds('action.prepared'), ['activity', 'actions', 'approvals']);
  assert.deepEqual(eventKinds('job.step'), ['activity', 'jobs', 'approvals']);
  assert.deepEqual(eventKinds('import.done'), ['activity', 'sources', 'books']);
  assert.deepEqual(eventKinds('connector.read'), ['activity', 'sources', 'books']);
  assert.deepEqual(eventKinds('dictionary.published'), ['activity', 'books', 'approvals']);
  assert.deepEqual(eventKinds('answer.receipt'), ['activity', 'answers']);
  assert.deepEqual(eventKinds('calculation.completed'), ['activity', 'answers']);
  assert.deepEqual(eventKinds('member.joined'), ['activity', 'trust']);
  assert.deepEqual(eventKinds('device.joined'), ['activity', 'devices']);
  assert.deepEqual(eventKinds('vault.backup.done'), ['activity', 'workspace']);
  assert.deepEqual(eventKinds('release.update.checked'), ['activity', 'workspace']);
  assert.deepEqual(eventKinds('workspace.locked'), ['activity', 'workspace']);
  assert.deepEqual(eventKinds('lesson.decided'), ['activity', 'lessons', 'approvals']);
  assert.deepEqual(eventKinds('reminder.drafted'), ['activity']);
  assert.equal(eventMethods['events.subscribe']!.permission, 'read');
  assert.equal(eventMethods['events.subscribe']!.phone, false);
});

test('events.subscribe: a head cursor first, then what came after it, oldest first, filtered by kind', async t => {
  const engine = await engineWith(t);
  const head = await subscribe(engine);
  assert.deepEqual(Object.keys(head).sort(), ['cursor', 'events', 'more']);
  assert.deepEqual(head.events, []); assert.equal(head.more, false); assert.match(head.cursor, /^[A-Za-z0-9_-]+$/);
  const quiet = await subscribe(engine, { after: head.cursor });
  assert.deepEqual(quiet.events, []); assert.equal(quiet.more, false);

  await record(engine, 'action.prepared', { memberId: 'owner', actionId: 'action_00000000-0000-0000-0000-000000000001', payloadText: 'never travels' });
  await record(engine, 'job.step-dispatched', { memberId: 'owner' });
  await record(engine, 'source.imported', { memberId: 'owner' });
  const all = await subscribe(engine, { after: head.cursor });
  assert.deepEqual(all.events.map((e: any) => e.type), ['action.prepared', 'job.step', 'import.done']);
  for (const event of all.events) assert.deepEqual(Object.keys(event).sort(), ['at', 'id', 'kinds', 'type']);
  assert.deepEqual(all.events[2].kinds, ['activity', 'sources', 'books']);
  assert.ok(!JSON.stringify(all).includes('never travels'));
  // A kind filter delivers only matching events but still moves past the rest.
  const books = await subscribe(engine, { after: head.cursor, kinds: ['books'] });
  assert.deepEqual(books.events.map((e: any) => e.type), ['import.done']);
  assert.deepEqual((await subscribe(engine, { after: books.cursor })).events, []);
  const approvals = await subscribe(engine, { after: head.cursor, kinds: ['approvals', 'lessons'] });
  assert.deepEqual(approvals.events.map((e: any) => e.type), ['action.prepared', 'job.step']);
  assert.deepEqual((await subscribe(engine, { after: all.cursor })).events, []);
  // A head taken now starts after everything recorded so far.
  assert.deepEqual((await subscribe(engine, { after: (await subscribe(engine)).cursor })).events, []);
});

test('events.subscribe: pages of 200 with more, and a trimmed cursor record replays its time rather than missing events', async t => {
  const engine = await engineWith(t);
  const head = await subscribe(engine);
  await engine.vault!.update(state => { for (let i = 0; i < EVENTS_PAGE + 5; i++) audit(state, 'job.step-settled', { memberId: 'owner' }); });
  const first = await subscribe(engine, { after: head.cursor });
  assert.equal(first.events.length, EVENTS_PAGE); assert.equal(first.more, true);
  const second = await subscribe(engine, { after: first.cursor });
  assert.equal(second.events.length, 5); assert.equal(second.more, false);
  assert.equal(new Set([...first.events, ...second.events].map((e: any) => e.id)).size, EVENTS_PAGE + 5);

  await record(engine, 'action.settled');
  const cursor = (await subscribe(engine)).cursor;
  const last = engine.vault!.read().activity.at(-1)!;
  await record(engine, 'action.approved');
  // Retention drops the cursor's own record: the next events are still delivered.
  await engine.vault!.update(state => { state.activity = state.activity.filter(item => item.id !== last.id); });
  const after = await subscribe(engine, { after: cursor });
  assert.ok(after.events.some((e: any) => e.type === 'action.approved'));
  assert.ok(!after.events.some((e: any) => e.id === last.id));
});

test('events.subscribe refuses a malformed or foreign cursor, an unknown kind and unknown fields', async t => {
  const engine = await engineWith(t);
  const head = await subscribe(engine);
  const other = Buffer.from(JSON.stringify(['e1', 'workspace_other', '', ''])).toString('base64url');
  for (const payload of [{ after: 'not a cursor' }, { after: '' }, { after: 42 }, { after: Buffer.from('[1,2]').toString('base64url') }, { after: other },
    { kinds: ['nonsense'] }, { kinds: [] }, { kinds: 'books' }, { after: head.cursor, extra: true }])
    await assert.rejects(subscribe(engine, payload), code('INVALID_EVENTS_REQUEST'), JSON.stringify(payload));
});

test('events.subscribe shows a member only what activity shows them', async t => {
  const engine = await engineWith(t);
  const member = await engine.request('members.add', { id: 'events-accountant', name: 'Synthetic accountant', role: 'accountant', branches: ['*'] });
  const accountant: Context = { memberId: member.id, role: 'accountant', epoch: member.epoch, channel: 'desktop' };
  const head = await subscribe(engine, {}, accountant);
  await record(engine, 'action.prepared', { memberId: 'owner' });
  await record(engine, 'action.approved', { memberId: member.id });
  const seen = await subscribe(engine, { after: head.cursor }, accountant);
  assert.deepEqual(seen.events.map((e: any) => e.type), ['action.approved']);
  const owner = await subscribe(engine, { after: (await subscribe(engine)).cursor });
  assert.deepEqual(owner.events, []);
});

test('the engine bus bumps only when the workspace or its revision changes', async t => {
  const bus = new EngineEventBus(), heard: number[] = [];
  const off = bus.on(seq => heard.push(seq)); bus.on(() => { throw new Error('a broken listener is ignored'); });
  bus.observe(null); bus.observe({ workspaceId: 'w', revision: 1 }); bus.observe({ workspaceId: 'w', revision: 1 });
  bus.observe({ workspaceId: 'w', revision: 2 }); bus.observe({ workspaceId: 'v', revision: 2 }); bus.observe(null); bus.observe(null);
  assert.deepEqual(heard, [1, 2, 3, 4]); assert.equal(bus.seq, 4);
  off(); bus.observe({ workspaceId: 'w', revision: 3 }); assert.deepEqual(heard, [1, 2, 3, 4]);

  const engine = await engineWith(t), seqs: number[] = [];
  engine.events.on(seq => seqs.push(seq));
  const start = engine.events.seq;
  await engine.request('workspace.status'); await subscribe(engine); await engine.request('activity.list');
  assert.equal(engine.events.seq, start, 'reads publish nothing');
  await engine.request('trust.update', { send: 'shape' });
  assert.equal(engine.events.seq, start + 1);
  await engine.request('workspace.lock');
  assert.equal(engine.events.seq, start + 2); assert.equal(engine.events.last, null);
  await engine.request('workspace.open', { folder: 'main', passphrase });
  assert.equal(engine.events.seq, start + 3); assert.deepEqual(seqs, [start + 1, start + 2, start + 3]);
  await engine.tick(); assert.equal(engine.events.seq, start + 3);
});

class Child extends EventEmitter {
  connected = true; sent: any[] = [];
  send(value: any, callback: (error?: Error) => void) { this.sent.push(value); callback(); }
  disconnect() { this.connected = false; queueMicrotask(() => this.emit('exit', 0, null)); }
  kill() { this.connected = false; queueMicrotask(() => this.emit('exit', 137, 'SIGKILL')); return true; }
}

test('the harness forwards only a safe sequence number and keeps pending requests intact', async () => {
  assert.equal(ipcContract.EVENT_CHANNEL, 'chausar:engine-event');
  const child = new Child();
  const harness = new EngineHarness({ workerPath: '/owned/worker.ts', environment: {}, startupTimeoutMs: 2000, requestTimeoutMs: 2000, shutdownTimeoutMs: 30, forkProcess: () => child });
  const heard: any[] = []; harness.on('engine-event', (event: any) => heard.push(event));
  const start = harness.start(); child.emit('message', { ready: true }); await start;
  const pending = harness.request('workspace.status');
  const id = child.sent[0].id;
  for (const message of [{ kind: 'engine-event', seq: -1 }, { kind: 'engine-event', seq: 1.5 }, { kind: 'engine-event', seq: '3' }, { kind: 'engine-event', seq: Number.MAX_SAFE_INTEGER + 2 },
    { kind: 'engine-event', id, seq: 9 }])
    child.emit('message', message);
  child.emit('message', { kind: 'engine-event', seq: 7, private: 'not forwarded' });
  assert.deepEqual(heard, [{ seq: 7 }]); assert.equal(Object.isFrozen(heard[0]), true);
  // The malformed message carrying the request's id was a reply without a result, never an event.
  await assert.rejects(pending, code('INVALID_ENGINE_REPLY'));
  await harness.stop();
});

test('a real worker pushes a coalesced engine-event after a write', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-sync-worker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workerPath = join(directory, 'worker.ts');
  await writeFile(workerPath, `
import { Engine } from ${JSON.stringify(new URL('../runtime/engine.ts', import.meta.url).href)};
import { runEngineWorker } from ${JSON.stringify(new URL('../runtime/worker.ts', import.meta.url).href)};
runEngineWorker(new Engine({ directory: ${JSON.stringify(join(directory, 'data'))}, demo: true, storage: 'experimental-file' }));
`, 'utf8');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['path', 'systemroot', 'windir', 'temp', 'tmp', 'userprofile'].includes(name.toLowerCase())));
  const harness = new EngineHarness({ workerPath, environment, startupTimeoutMs: 15000, requestTimeoutMs: 15000, shutdownTimeoutMs: 15000,
    forkProcess: (path: string, args: string[], options: ForkOptions) => fork(path, args, options) });
  t.after(() => harness.stop());
  const heard: { seq: number }[] = []; harness.on('engine-event', (event: { seq: number }) => heard.push(event));
  await harness.start();
  await harness.request('workspace.status', {});
  await new Promise(accept => setTimeout(accept, 400));
  assert.equal(heard.length, 0, 'a read pushes nothing');
  await harness.request('workspace.create', { name: 'Core Sync Worker Shop', passphrase, demo: false, pack: 'ecommerce', folder: 'main' });
  await harness.request('trust.update', { send: 'shape' }); await harness.request('trust.update', { send: 'nothing' });
  await new Promise(accept => setTimeout(accept, 700));
  assert.ok(heard.length >= 1 && heard.length <= 3, JSON.stringify(heard));
  assert.ok(heard.every(event => Number.isSafeInteger(event.seq) && Object.keys(event).length === 1));
  assert.ok(heard.at(-1)!.seq >= 3, 'the last push carries the latest sequence number');
});

test('the preload hands the renderer only a frozen safe sequence number and removes only its own listener', async () => {
  const source = await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8');
  const ipc = new EventEmitter() as any; ipc.invoke = async () => ({ ok: true, result: {} }); let api: any;
  vm.runInNewContext(source, { require: (module: string) => { assert.equal(module, 'electron'); return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { api = value; } } }; } });
  assert.throws(() => api.onEngineEvent('not a function'), { name: 'TypeError' });
  const heard: any[] = []; const remove = api.onEngineEvent((value: any) => heard.push(value));
  const status = api.onEngineStatus(() => {});
  for (const value of [{ seq: -1 }, { seq: 2.5 }, { seq: '4' }, null, undefined, { seq: Number.MAX_SAFE_INTEGER + 2 }]) ipc.emit('chausar:engine-event', {}, value);
  ipc.emit('chausar:engine-event', {}, { seq: 5, private: 'not forwarded' });
  assert.equal(heard.length, 1); assert.deepEqual(Object.keys(heard[0]), ['seq']); assert.equal(heard[0].seq, 5); assert.equal(Object.isFrozen(heard[0]), true);
  remove(); assert.equal(ipc.listenerCount('chausar:engine-event'), 0); assert.equal(ipc.listenerCount('chausar:engine-status'), 1); status();
});
