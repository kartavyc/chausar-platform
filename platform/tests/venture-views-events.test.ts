// P1-A: run events. They join VENTURE_EVENTS, are emitted from the run and queue paths, published only after the
// commit, pushed to the desktop window over IPC, and streamed to the web over Server-Sent Events at GET /api/events.
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
import { VENTURE_EVENTS, VENTURE_RUN_EVENT_TYPES } from '../runtime/venture/contracts.ts';
import type { DeliveryRunRecord, ModelTransport, QueueList, VentureDeps, VentureRunEvent } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { PACKAGE_LOADERS, VentureHost } from '../runtime/venture/host.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { runEventFromActor, sseFrame } from '../runtime/venture/views/events.ts';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import ipcContract from '../../app/desktop/ipc-contract.cjs';
import { owner, seedBlueprint, seedOrder, setup } from './venture-views-env.ts';

const names = (env: { store: { read(): any } }) => listRecords(env.store.read(), 'venture-event').sort((a, b) => a.seq - b.seq).map(event => event.name);

test('the run events join VENTURE_EVENTS, after every older event: the six of P1-A, the eight of Ink v2 wave 4, the three of wave 5', () => {
  assert.deepEqual([...VENTURE_RUN_EVENT_TYPES], [
    'run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed',
    'agent.message', 'chief.message', 'proposal.created', 'notify.new', 'pipeline.changed', 'run.stopped', 'run.call', 'keeper.ran',
    // 5-0 added chain.changed, desk.changed and idea.changed (Ink v2 wave 5).
    'chain.changed', 'desk.changed', 'idea.changed',
  ]);
  assert.deepEqual(VENTURE_EVENTS.slice(-17), [...VENTURE_RUN_EVENT_TYPES]);
});

test('a delivery run emits run.started and run.waiting, a review run.done, each followed by one queue.changed, published after the commit', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  env.published.length = 0;
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  const run = env.published.find(batch => batch.some(event => event.name === 'run.started'))!;
  assert.deepEqual(run.map(event => event.name), ['run.started', 'delivery-ready', 'run.waiting', 'queue.changed']);
  assert.ok(run.every(event => (event.data as any)?.runId === outline.id || event.name === 'queue.changed'));
  await delivery['venture.delivery.review']!(env.deps, owner, { runId: outline.id, verdict: 'accepted' });
  assert.deepEqual(env.published.at(-1)!.map(event => event.name), ['delivery-reviewed', 'run.done', 'queue.changed']);
  assert.ok(names(env).includes('run.done'));
});

test('ventureAction publishes nothing for a rolled-back write and adds queue.changed only after queue events', async () => {
  const env = await setup();
  env.published.length = 0;
  await assert.rejects(ventureAction(env.deps, owner, 'prepare', 'boom', tx => { tx.emit('run.done', { runId: 'delivery_x' }); throw new Error('stop'); }), /stop/);
  assert.equal(env.published.length, 0);
  await ventureAction(env.deps, owner, 'prepare', 'client', tx => { tx.emit('client-added', {}); });
  assert.deepEqual(env.published.at(-1)!.map(event => event.name), ['client-added']);
  await ventureAction(env.deps, owner, 'prepare', 'two', tx => { tx.emit('invoice-prepared', {}); tx.emit('run.failed', { runId: 'delivery_x' }); });
  assert.deepEqual(env.published.at(-1)!.map(event => event.name), ['invoice-prepared', 'run.failed', 'queue.changed']);
  // A listener that throws never undoes the commit.
  env.deps.publish = () => { throw new Error('listener failed'); };
  await ventureAction(env.deps, owner, 'prepare', 'three', tx => { tx.emit('run.step', { runId: 'delivery_x' }); });
  assert.equal(names(env).at(-1), 'run.step');
});

function silentTransport(): ModelTransport {
  return {
    replay: true,
    http: async () => { throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.'); },
    process: async request => request.purpose === 'version-check' ? { exitCode: 0, stdout: 'synthetic recording' } : Promise.reject(new ChausarError('FIXTURE_MISSING', 'No recording in this test.')),
  };
}

test('the venture host turns committed run events into VentureRunEvents for its business, and nothing else', async () => {
  const env = await setup();
  const heard: VentureRunEvent[][] = [];
  const loaders = {
    ...PACKAGE_LOADERS,
    views: async () => ({ handlers: { 'venture.runs.list': async (deps: VentureDeps) => {
      await ventureAction(deps, owner, 'prepare', 'test.events', tx => { tx.emit('client-added', {}); tx.emit('run.done', { runId: 'delivery_1' }); });
      return { runs: [] };
    } } }),
  };
  const host = new VentureHost(env.store, env.deps.services, {
    demo: true, storage: 'experimental-file', host: 'test', modelTransport: silentTransport(), clock: env.deps.clock, workspace: env.workspace,
    notify: events => { heard.push(events); },
  }, loaders as typeof PACKAGE_LOADERS);
  await host.request(owner, 'venture.runs.list', {});
  // Each frame carries its seq (Ink v2 wave 4, 4G1); the queue changed, so the notification centre looked and said so.
  assert.deepEqual(heard, [[
    { type: 'run.done', businessId: 'main', runId: 'delivery_1', at: env.now(), seq: 2 },
    { type: 'queue.changed', businessId: 'main', at: env.now(), seq: 3 },
  ], [
    { type: 'notify.new', businessId: 'main', at: env.now(), seq: 4, count: 1 },
  ]]);
  host.close();
});

test('views/events: an actor event becomes a VentureRunEvent and one SSE frame; other events are dropped', () => {
  assert.equal(runEventFromActor({ seq: 4, name: 'invoice-issued', data: {}, at: '2026-10-15T10:00:00.000Z' }, 'b1'), null);
  const event = runEventFromActor({ seq: 5, name: 'run.waiting', data: { runId: 'delivery_1', secret: 'x' }, at: '2026-10-15T10:00:00.000Z' }, 'b1');
  assert.deepEqual(event, { type: 'run.waiting', businessId: 'b1', runId: 'delivery_1', at: '2026-10-15T10:00:00.000Z', seq: 5 });
  assert.equal(sseFrame(event!), `id: 5\ndata: ${JSON.stringify(event)}\n\n`);
});

test('engine and local server: run events reach onVentureEvent and stream over GET /api/events with the rpc bearer only', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-views-events-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', venture: { host: 'test', modelTransport: silentTransport() } });
  const app = createLocalServer(engine);
  t.after(async () => { await app.close(5000).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  const { origin, token } = await app.listen();
  await engine.request('workspace.create', { name: 'Ledgerline', passphrase: 'long-enough-passphrase', pack: 'services' });
  await engine.request('venture.create', { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN' });
  const heard: VentureRunEvent[] = [];
  const off = engine.onVentureEvent(event => heard.push(event));

  const refused = await fetch(`${origin}/api/events`);
  assert.equal(refused.status, 401);
  const controller = new AbortController();
  const stream = await fetch(`${origin}/api/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type') ?? '', /^text\/event-stream/);
  assert.match(stream.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const until = async (pattern: RegExp) => {
    while (!pattern.test(text)) { const { value, done } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
  };
  await until(/retry: /);

  const queue = await engine.request('venture.queue.list', {}) as QueueList;
  const ai = queue.rows.find(row => row.title === 'Connect your AI')!;
  assert.equal(ai.businessId, 'main');
  await engine.request('venture.queue.decide', { id: ai.id, digest: ai.digest, action: 'later' });
  await until(/"queue\.changed"/);
  const frame = text.split('\n\n').find(block => block.includes('queue.changed'))!;
  const pushed = JSON.parse(frame.slice(frame.indexOf('data: ') + 6));
  assert.deepEqual(Object.keys(pushed).sort(), ['at', 'businessId', 'seq', 'type']);
  assert.deepEqual([pushed.type, pushed.businessId], ['queue.changed', 'main']);
  assert.deepEqual(heard.map(event => [event.type, event.businessId]), [['queue.changed', 'main']]);
  controller.abort();
  off();
});

test('desktop: the worker message becomes a validated harness event, and the preload hands the window frozen copies only', async () => {
  const { validateVentureEvent, VENTURE_EVENT_CHANNEL } = ipcContract as any;
  assert.equal(VENTURE_EVENT_CHANNEL, 'chausar:venture-event');
  const good = { type: 'run.done', businessId: 'main', runId: 'delivery_1', at: '2026-10-15T10:00:00.000Z' };
  assert.deepEqual(validateVentureEvent({ ...good, private: 'dropped' }), good);
  assert.deepEqual(validateVentureEvent({ type: 'queue.changed', businessId: 'main', at: '2026-10-15T10:00:00.000Z' }), { type: 'queue.changed', businessId: 'main', at: '2026-10-15T10:00:00.000Z' });
  for (const bad of [null, [], { ...good, type: 'run.exploded' }, { ...good, businessId: 7 }, { ...good, at: 'yesterday' }, { ...good, runId: 'x'.repeat(300) }]) assert.equal(validateVentureEvent(bad), null);

  class Child extends EventEmitter { connected = true; send(_value: unknown, callback: () => void) { callback(); } disconnect() {} kill() { return true; } }
  const child = new Child();
  const harness = new EngineHarness({ workerPath: '/owned/worker.ts', environment: {}, forkProcess: () => child as any });
  const started = harness.start(); child.emit('message', { ready: true }); await started;
  const events: unknown[] = [];
  harness.on('venture-event', (event: unknown) => events.push(event));
  child.emit('message', { kind: 'venture-event', event: { ...good, private: 'dropped' } });
  child.emit('message', { kind: 'venture-event', event: { type: 'nope' } });
  assert.deepEqual(events, [good]);
  assert.ok(Object.isFrozen(events[0]));

  const source = await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8');
  const ipc = new EventEmitter() as any; ipc.invoke = async () => ({ ok: true, result: {} }); let api: any;
  vm.runInNewContext(source, { require: (name: string) => { assert.equal(name, 'electron'); return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { api = value; } } }; } });
  assert.deepEqual(Object.keys(api).sort(), ['onEngineStatus', 'onEvent', 'openExternal', 'pickNetworkFile', 'request', 'saveMoneyExport', 'saveReport']);
  const received: any[] = [];
  const remove = api.onEvent((event: unknown) => received.push(event));
  ipc.emit('chausar:venture-event', {}, { ...good, private: 'dropped' });
  ipc.emit('chausar:venture-event', {}, { type: 'run.exploded', businessId: 'main', at: good.at });
  assert.deepEqual(received.map(event => ({ ...event })), [good]);
  assert.ok(Object.isFrozen(received[0]));
  remove();
  assert.equal(ipc.listenerCount('chausar:venture-event'), 0);
  assert.throws(() => api.onEvent('not a function'), /Use a function for run events/);
});

test('hosted server: GET /api/events needs the session and the page bearer, and streams run events for the open business only', async t => {
  const { request: httpRequest } = await import('node:http');
  const { randomBytes } = await import('node:crypto');
  const { HostedApp } = await import('../runtime/hosted/app.ts');
  const { HostedCustody } = await import('../runtime/hosted/custody.ts');
  const { FileDirectory } = await import('../runtime/hosted/directory.ts');
  const { DEFAULT_LIMITS } = await import('../runtime/hosted/limits.ts');
  const { DevOutbox } = await import('../runtime/hosted/mailer.ts');
  const { createHostedServer } = await import('../runtime/hosted/server.ts');
  const { createReplayTransport } = await import('../runtime/venture/models/index.ts');
  const ORIGIN = 'http://localhost:4398', HOST = 'localhost:4398';
  const folder = await mkdtemp(join(tmpdir(), 'chausar-views-hosted-'));
  const custody = HostedCustody.fromKey(randomBytes(32).toString('base64url'));
  const directory = await FileDirectory.open(folder, custody);
  const outbox = new DevOutbox();
  const modelFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/model-replay.json', import.meta.url), 'utf8'));
  const app = new HostedApp({
    root: folder, rp: { id: 'localhost', name: 'Chausar', origin: ORIGIN }, directory, custody, mailer: outbox, limits: DEFAULT_LIMITS, version: '0.1.0-preview.1',
    modelTransport: createReplayTransport(modelFixture), githubTransport: { kind: 'fixture', read: async () => ({ status: 404, etag: null, body: '{}', rateRemaining: null }) },
  } as any);
  const http = createHostedServer(app, { origin: ORIGIN, tls: { kind: 'none' }, trustProxy: false, maxBodyBytes: DEFAULT_LIMITS.maxBodyBytes });
  const { port } = await http.listen('127.0.0.1', 0);
  t.after(async () => { await http.close(); await rm(folder, { recursive: true, force: true }); });

  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; json: any }>((resolve, reject) => {
    const base: Record<string, string> = { Host: HOST };
    if (method === 'POST') Object.assign(base, { Origin: ORIGIN, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' });
    if (jar.size) base.Cookie = cookie();
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...base, ...headers } }, res => {
      for (const line of [res.headers['set-cookie'] ?? []].flat()) { const [pair] = line.split(';'); const at = pair.indexOf('='); jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim()); }
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => { let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode ?? 0, json }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
  await send('GET', '/');
  await send('POST', '/api/auth/magic-link', { email: 'cafe@example.com' });
  await send('POST', '/api/auth/magic-link/verify', { token: new URL(outbox.latest('cafe@example.com')!.link).hash.replace('#signin=', '') });
  const bearer = (await send('GET', '/api/hosted/session')).json.token as string;
  const rpc = async (method: string, payload: unknown = {}) => {
    const reply = await send('POST', '/api/rpc', { method, payload }, { Authorization: `Bearer ${bearer}` });
    assert.equal(reply.status, 200, JSON.stringify(reply.json));
    return reply.json.result;
  };
  const created = await rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  await rpc('venture.create', { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN' });

  assert.equal((await send('GET', '/api/events')).status, 401, 'the cookie alone is not enough');
  const frames: any[] = [];
  let buffer = '';
  const stream = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: '/api/events', headers: { Host: HOST, Cookie: cookie(), Authorization: `Bearer ${bearer}` } }, res => {
    assert.equal(res.statusCode, 200);
    res.setEncoding('utf8');
    res.on('data', chunk => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n\n')) >= 0) { const block = buffer.slice(0, at); buffer = buffer.slice(at + 2); const data = /^data: (.+)$/m.exec(block)?.[1]; if (data) frames.push(JSON.parse(data)); }
    });
  });
  stream.on('error', () => {});
  stream.end();
  await new Promise(resolve => setTimeout(resolve, 100));
  const queue = await rpc('venture.queue.list') as QueueList;
  const ai = queue.rows.find(row => row.title === 'Connect your AI')!;
  assert.equal(ai.businessId, created.businessId, 'rows name the hosted business');
  await rpc('venture.queue.decide', { id: ai.id, digest: ai.digest, action: 'later' });
  for (let i = 0; i < 100 && !frames.length; i++) await new Promise(resolve => setTimeout(resolve, 20));
  stream.destroy();
  assert.deepEqual(frames.map(frame => [frame.type, frame.businessId]), [['queue.changed', created.businessId]]);
  assert.deepEqual(Object.keys(frames[0]).sort(), ['at', 'businessId', 'seq', 'type']);
});
