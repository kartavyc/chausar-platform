// Ink v2 wave 4, package 4G1 (W3's U20, spec 5.7): the sequenced event stream. Every run event frame on IPC and on
// /api/events carries seq, its place in the business's event log, and notify.new alone carries count; venture.events
// { afterSeq } returns exactly the frames a client missed, shaped as they were pushed, so a client that reconnects
// replays the gap. The venture host refreshes the notification centre after a commit that changed the queue, and on the
// engine's tick; the desktop preload passes every run event type with seq and count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { ChausarError } from '../runtime/contracts.ts';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { VENTURE_RUN_EVENT_TYPES } from '../runtime/venture/contracts.ts';
import type { ModelTransport, QueueList, VentureDeps, VentureRunEvent } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { PACKAGE_LOADERS, VentureHost } from '../runtime/venture/host.ts';
import { handlers as core } from '../runtime/venture/core/index.ts';
import { runEventFromActor, sseFrame } from '../runtime/venture/views/events.ts';
import ipcContract from '../../app/desktop/ipc-contract.cjs';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import { owner, setup } from './venture-views-env.ts';

const AT = '2026-10-15T10:00:00.000Z';

function silentTransport(): ModelTransport {
  return {
    replay: true,
    http: async () => { throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.'); },
    process: async request => request.purpose === 'version-check' ? { exitCode: 0, stdout: 'synthetic recording' } : Promise.reject(new ChausarError('FIXTURE_MISSING', 'No recording in this test.')),
  };
}

test('the venture host: every frame carries its seq, notify.new alone a count, and a commit that changed the queue refreshes the centre first', async () => {
  const env = await setup();
  const heard: VentureRunEvent[][] = [];
  const loaders = {
    ...PACKAGE_LOADERS,
    views: async () => ({ handlers: { 'venture.runs.list': async (deps: VentureDeps) => {
      await ventureAction(deps, owner, 'prepare', 'test.events', tx => { tx.emit('client-added', {}); tx.emit('run.done', { runId: 'delivery_1', count: 4 }); });
      return { runs: [] };
    } } }),
  };
  const host = new VentureHost(env.store, env.deps.services, {
    demo: true, storage: 'experimental-file', host: 'test', modelTransport: silentTransport(), clock: env.deps.clock, workspace: env.workspace,
    notify: events => { heard.push(events); },
  }, loaders as typeof PACKAGE_LOADERS);
  await host.request(owner, 'venture.runs.list', {});
  const logged = listRecords(env.store.read(), 'venture-event', env.venture.id).sort((a, b) => a.seq - b.seq);
  const seqOf = (name: string) => logged.find(event => event.name === name)!.seq;
  // The run's frames, then (after the centre was refreshed, before the request answered) the centre's notify.new.
  assert.deepEqual(heard, [
    [
      { type: 'run.done', businessId: 'main', runId: 'delivery_1', at: env.now(), seq: seqOf('run.done') },
      { type: 'queue.changed', businessId: 'main', at: env.now(), seq: seqOf('queue.changed') },
    ],
    [{ type: 'notify.new', businessId: 'main', at: env.now(), seq: seqOf('notify.new'), count: 1 }],
  ]);
  assert.equal(listRecords(env.store.read(), 'venture-notification', env.venture.id).length, 1, 'written before the request answered');
  // A tick between requests refreshes too: nothing new, nothing said.
  assert.equal(await host.notifyTick(owner), true);
  assert.equal(heard.length, 2);
  host.close();
  assert.equal(await host.notifyTick(owner), null, 'a closed host does nothing');
});

test('the venture host lets the notification centre look one at a time, however many ticks and requests ask at once', async () => {
  const env = await setup();
  let active = 0, most = 0, looks = 0;
  const loaders = {
    ...PACKAGE_LOADERS,
    notify: async () => ({ handlers: {}, notifyRefresh: async () => {
      active += 1; looks += 1; most = Math.max(most, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
    } }),
  };
  const host = new VentureHost(env.store, env.deps.services, {
    demo: true, storage: 'experimental-file', host: 'test', modelTransport: silentTransport(), clock: env.deps.clock, workspace: env.workspace, notify: () => {},
  }, loaders as typeof PACKAGE_LOADERS);
  assert.deepEqual(await Promise.all([host.notifyTick(owner), host.notifyTick(owner), host.notifyTick(owner)]), [true, true, true]);
  assert.deepEqual([looks, most], [3, 1]);
  host.close();
});

test('venture.events { afterSeq } returns exactly the missed frames, shaped as they were pushed', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'prepare', 'one', tx => { tx.emit('run.started', { runId: 'delivery_1' }); });
  const { lastSeq } = await core['venture.events']!(env.deps, owner, { limit: 1 }) as { lastSeq: number };
  await ventureAction(env.deps, owner, 'prepare', 'two', tx => { tx.emit('client-added', {}); tx.emit('run.waiting', { runId: 'delivery_1' }); });
  await ventureAction(env.deps, owner, 'read', 'three', tx => { tx.emit('notify.new', { count: 3 }); });
  const replay = await core['venture.events']!(env.deps, owner, { afterSeq: lastSeq }) as { events: { seq: number; name: string }[]; frames: VentureRunEvent[]; firstSeq: number };
  assert.deepEqual(replay.events.map(event => event.name), ['client-added', 'run.waiting', 'queue.changed', 'notify.new']);
  // firstSeq: the oldest event the log still keeps, so a client whose afterSeq is older knows events were trimmed.
  assert.equal(replay.firstSeq, listRecords(env.store.read(), 'venture-event', env.venture.id).reduce((low, event) => Math.min(low, event.seq), Infinity));
  assert.deepEqual(replay.frames, [
    { type: 'run.waiting', businessId: 'main', runId: 'delivery_1', at: env.now(), seq: lastSeq + 2 },
    { type: 'queue.changed', businessId: 'main', at: env.now(), seq: lastSeq + 3 },
    { type: 'notify.new', businessId: 'main', at: env.now(), seq: lastSeq + 4, count: 3 },
  ]);
  assert.deepEqual(env.published.slice(-2).flat().filter(event => event.seq > lastSeq).map(event => event.seq), [lastSeq + 1, lastSeq + 2, lastSeq + 3, lastSeq + 4]);
  assert.deepEqual((await core['venture.events']!(env.deps, owner, { afterSeq: lastSeq + 4 }) as { frames: unknown[] }).frames, []);
});

test('views/events: an actor frame keeps seq, count only on notify.new; an SSE frame names its seq as the event id', () => {
  const waiting = runEventFromActor({ seq: 5, name: 'run.waiting', data: { runId: 'delivery_1', count: 9 }, at: AT }, 'b1');
  assert.deepEqual(waiting, { type: 'run.waiting', businessId: 'b1', runId: 'delivery_1', at: AT, seq: 5 });
  assert.deepEqual(runEventFromActor({ seq: 6, name: 'notify.new', data: { count: 3, title: 'Asha owes INR 9,000.00' }, at: AT }, 'b1'),
    { type: 'notify.new', businessId: 'b1', at: AT, seq: 6, count: 3 });
  assert.deepEqual(runEventFromActor({ seq: 7, name: 'notify.new', data: { count: -1 }, at: AT }, 'b1'), { type: 'notify.new', businessId: 'b1', at: AT, seq: 7 });
  assert.deepEqual(runEventFromActor({ seq: 1.5, name: 'queue.changed', data: {}, at: AT }, 'b1'), { type: 'queue.changed', businessId: 'b1', at: AT });
  assert.equal(sseFrame(waiting!), `id: 5\ndata: ${JSON.stringify(waiting)}\n\n`);
  const plain: VentureRunEvent = { type: 'queue.changed', businessId: 'b1', at: AT };
  assert.equal(sseFrame(plain), `data: ${JSON.stringify(plain)}\n\n`);
});

test('desktop: the preload passes every run event type with seq, and count on notify.new only, as frozen copies', async () => {
  const source = await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8');
  const ipc = new EventEmitter() as any; ipc.invoke = async () => ({ ok: true, result: {} }); let api: any;
  vm.runInNewContext(source, { require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { api = value; } } }) });
  const received: any[] = [];
  const remove = api.onEvent((event: unknown) => received.push(event));
  for (const type of VENTURE_RUN_EVENT_TYPES) ipc.emit('chausar:venture-event', {}, { type, businessId: 'main', at: AT, seq: 4, private: 'dropped' });
  assert.deepEqual(received.map(event => event.type), [...VENTURE_RUN_EVENT_TYPES]);
  assert.ok(received.every(event => event.seq === 4 && !('private' in event) && Object.isFrozen(event)));
  received.length = 0;
  ipc.emit('chausar:venture-event', {}, { type: 'notify.new', businessId: 'main', at: AT, seq: 9, count: 3 });
  ipc.emit('chausar:venture-event', {}, { type: 'run.done', businessId: 'main', at: AT, seq: 10, count: 3 });
  ipc.emit('chausar:venture-event', {}, { type: 'run.done', businessId: 'main', at: AT, seq: -1 });
  ipc.emit('chausar:venture-event', {}, { type: 'notify.new', businessId: 'main', at: AT, count: 2.5 });
  assert.deepEqual(received.map(event => ({ ...event })), [{ type: 'notify.new', businessId: 'main', at: AT, seq: 9, count: 3 }]);
  // The same rule as the main process's check.
  const { validateVentureEvent } = ipcContract as any;
  assert.equal(validateVentureEvent({ type: 'run.done', businessId: 'main', at: AT, seq: 10, count: 3 }), null);
  remove();
});

test('engine and local server: frames over GET /api/events carry seq; an open stream counts as the owner watching; the tick refreshes the centre', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-events-seq-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', venture: { host: 'test', modelTransport: silentTransport() } });
  const app = createLocalServer(engine);
  t.after(async () => { await app.close(5000).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  const { origin, token } = await app.listen();
  await engine.request('workspace.create', { name: 'Ledgerline', passphrase: 'long-enough-passphrase', pack: 'services' });
  await engine.request('venture.create', { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN' });
  const notifications = () => listRecords((engine as any).vault.read(), 'venture-notification');
  // The tick: no stream open, so what needs the owner is told outside the app (quiet hours off: this test runs at any hour).
  await engine.request('venture.notify.settings', { quietHours: null });
  await engine.tick();
  assert.ok(notifications().length > 0);
  assert.ok(notifications().every(record => record.alert === 'sent'));

  const controller = new AbortController();
  const stream = await fetch(`${origin}/api/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const until = async (pattern: RegExp) => {
    while (!pattern.test(text)) { const { value, done } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
  };
  await until(/retry: /);
  const queue = await engine.request('venture.queue.list', {}) as QueueList;
  const row = queue.rows.find(item => item.title === 'Connect your AI')!;
  const before = notifications().length;
  // A question appears while the owner's stream is open (the evidence ledger asks for a field Chausar cannot see).
  await ventureAction({ store: (engine as any).vault, clock: () => new Date() } as unknown as VentureDeps, engine.context, 'prepare', 'seed.ask', tx => {
    tx.put({
      ...tx.base('venture-evidence'), subject: 'business', field: 'gstin', value: '', type: 'needs-your-data', claimedType: 'needs-your-data', strength: 'weak',
      scoreBp: 0, claim: 'needs-your-data', source: 'Chausar cannot see it.', by: 'engine', runId: null, toolCallId: null, flag: null, applied: false, appliedAt: null,
    } as any);
  });
  await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'later' });
  await until(/"queue\.changed"[\s\S]*\n\n/);
  const block = text.split('\n\n').find(part => part.includes('queue.changed'))!;
  const frame = JSON.parse(block.slice(block.indexOf('data: ') + 6));
  assert.deepEqual(Object.keys(frame).sort(), ['at', 'businessId', 'seq', 'type']);
  assert.match(block, new RegExp(`^id: ${frame.seq}\\n`, 'm'));
  const replay = await engine.request('venture.events', { afterSeq: frame.seq - 1 }) as { frames: VentureRunEvent[] };
  assert.deepEqual(replay.frames[0], frame);
  // Rows that appear while the stream is open were on screen: never alerted later.
  const added = notifications().slice(before);
  assert.deepEqual(added.map(record => [record.rowKind, record.alert]), [['question', 'seen']]);
  controller.abort();
});

/** A question Chausar asks for a field it cannot see (the evidence ledger): one more row on Today. */
async function seedAsk(engine: Engine, field: string) {
  await ventureAction({ store: (engine as any).vault, clock: () => new Date() } as unknown as VentureDeps, engine.context, 'prepare', 'seed.ask', tx => {
    tx.put({
      ...tx.base('venture-evidence'), subject: 'business', field, value: '', type: 'needs-your-data', claimedType: 'needs-your-data', strength: 'weak',
      scoreBp: 0, claim: 'needs-your-data', source: 'Chausar cannot see it.', by: 'engine', runId: null, toolCallId: null, flag: null, applied: false, appliedAt: null,
    } as any);
  });
}

test('only the owner\'s stream counts as the owner watching: a member\'s stream does not; the desktop reports a focused window', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-events-watch-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', venture: { host: 'test', modelTransport: silentTransport() } });
  const app = createLocalServer(engine);
  const { origin, token } = await app.listen();
  const streams: AbortController[] = [];
  t.after(async () => { for (const stream of streams) stream.abort(); await app.close(5000).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  const rpc = async (method: string, payload: unknown = {}, bearer = token) => {
    const reply = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, payload }) });
    const body = await reply.json() as any;
    assert.equal(reply.status, 200, JSON.stringify(body));
    return body.result;
  };
  const open = async (bearer: string) => {
    const controller = new AbortController(); streams.push(controller);
    const stream = await fetch(`${origin}/api/events`, { headers: { authorization: `Bearer ${bearer}` }, signal: controller.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    let text = '';
    while (!/retry: /.test(text)) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
    return controller;
  };
  await rpc('workspace.create', { name: 'Ledgerline', passphrase: 'long-enough-passphrase', pack: 'services' });
  await rpc('venture.create', { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN' });
  await rpc('venture.notify.settings', { quietHours: null });
  const invited = await rpc('auth.invite', { name: 'Delhi reader', role: 'viewer', branches: ['Delhi'] });
  const member = await rpc('auth.accept', { token: invited.token });
  const notifications = () => listRecords((engine as any).vault.read(), 'venture-notification');
  const newest = () => notifications().at(-1)!;
  const later = async () => {
    const row = (await rpc('venture.queue.list') as QueueList).rows.find(item => item.kind === 'setup' || item.kind === 'question')!;
    await rpc('venture.queue.decide', { id: row.id, digest: row.digest, action: 'later' });
  };

  // A member's stream is open: not the owner watching, so a new question goes outside the app.
  const memberStream = await open(member.token);
  await seedAsk(engine, 'gstin');
  await later();
  assert.deepEqual([newest().rowKind, newest().alert], ['question', 'sent']);
  memberStream.abort();
  // The owner's own stream: what comes while it is open was on screen.
  const ownerStream = await open(token);
  await seedAsk(engine, 'pan');
  await later();
  assert.deepEqual([newest().rowKind, newest().alert], ['question', 'seen']);
  ownerStream.abort();
  await new Promise(resolve => setTimeout(resolve, 50));

  // The desktop window: shown, not minimised and focused is watching; focus lost starts the 2 minutes.
  engine.updateOwnerWatching(true);
  await seedAsk(engine, 'udyam');
  await later();
  assert.deepEqual([newest().rowKind, newest().alert], ['question', 'seen']);
  engine.updateOwnerWatching(false);
});

test('desktop: the engine harness passes the window\'s watching state to the worker as a plain notice', async () => {
  const sent: unknown[] = [];
  class Child extends EventEmitter { connected = true; send(value: unknown, callback: () => void) { sent.push(value); callback(); } disconnect() {} kill() { return true; } }
  const child = new Child();
  const harness = new EngineHarness({ workerPath: '/owned/worker.ts', environment: {}, forkProcess: () => child as any });
  assert.equal(harness.reportWatching(true), false, 'not before the engine is ready');
  const started = harness.start(); child.emit('message', { ready: true }); await started;
  assert.equal(harness.reportWatching(true), true);
  assert.equal(harness.reportWatching(false), true);
  assert.equal(harness.reportWatching('yes' as unknown as boolean), false);
  assert.deepEqual(sent, [{ kind: 'host-watching', watching: true }, { kind: 'host-watching', watching: false }]);
});
