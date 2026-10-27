// P6: the venture host on its own, with fake package loaders and the venture test store. No engine, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, DRAFT_METHODS, METHOD_OWNERS, PRE_VAULT_METHODS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type {
  GitHubFixture, GitHubTransport, ModelPort, ModelPortOptions, ModelTransport, VentureDeps, VentureEngineServices, VentureHandlerTable,
  VentureHostOptions, VenturePackageId, VentureStorage,
} from '../runtime/venture/contracts.ts';
import { createSecretShelf, missingHandlers, PACKAGE_LOADERS, VentureHost, type VenturePackageModule } from '../runtime/venture/host.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const services = {
  calculator: { calculate: async () => { throw new Error('not used'); }, receipt: () => { throw new Error('not used'); } },
  ontology: { current: () => null, publish: async () => { throw new Error('not used'); } },
  trust: { updatePolicy: async () => { throw new Error('not used'); } },
} as VentureEngineServices;
const baseOptions: VentureHostOptions & { demo: boolean; storage: VentureStorage } = { demo: true, storage: 'experimental-file', host: 'test' };

const noTransport: ModelTransport = {
  replay: false,
  http: async () => { throw new Error('No network in tests.'); },
  process: async () => { throw new Error('No processes in tests.'); },
};

function fakePort(label: string): ModelPort {
  return {
    status: () => ({ label } as any),
    presets: () => [{ id: 'built-in-templates', label } as any],
    checkCli: async () => {},
    generate: async () => { throw new Error('not used'); },
    preview: async () => null,
    runPreview: async () => { throw new Error('not used'); },
  };
}

/** A models module whose port factory records how often it was asked for a port. */
function modelsModule(counter: { ports: number; replays: unknown[] } = { ports: 0, replays: [] }): VenturePackageModule {
  return {
    handlers: {},
    createModelPort: (options: ModelPortOptions) => { counter.ports += 1; return fakePort(`port-${counter.ports}:${options.transport.replay}`); },
    defaultModelTransport: () => noTransport,
    createReplayTransport: (fixture: unknown) => { counter.replays.push(fixture); return { ...noTransport, replay: true }; },
  };
}

type Loaders = Record<VenturePackageId, () => Promise<VenturePackageModule>>;
/** No package loaded: the six packages, the four Ink v2 wave 4 added and the one wave 5 added (5-0: playbooks). */
const NO_CALLS: Record<VenturePackageId, number> = { core: 0, models: 0, money: 0, build: 0, delivery: 0, views: 0, agents: 0, chief: 0, network: 0, notify: 0, playbooks: 0 };
function loaders(overrides: Partial<Loaders> = {}): { loaders: Loaders; calls: Record<VenturePackageId, number> } {
  const calls: Record<VenturePackageId, number> = { core: 0, models: 0, money: 0, build: 0, delivery: 0, views: 0, agents: 0, chief: 0, network: 0, notify: 0, playbooks: 0 };
  const base: Loaders = {
    core: async () => ({ handlers: {} }),
    models: async () => modelsModule(),
    money: async () => ({ handlers: {} }),
    build: async () => ({ handlers: {} }),
    delivery: async () => ({ handlers: {} }),
    views: async () => ({ handlers: {} }),
    agents: async () => ({ handlers: {} }),
    chief: async () => ({ handlers: {} }),
    network: async () => ({ handlers: {} }),
    notify: async () => ({ handlers: {} }),
    // 5-0: the playbooks package Ink v2 wave 5 added.
    playbooks: async () => ({ handlers: {} }),
  };
  const merged = { ...base, ...overrides };
  const counted = Object.fromEntries((Object.keys(merged) as VenturePackageId[]).map(id => [id, () => { calls[id] += 1; return merged[id](); }])) as Loaders;
  return { loaders: counted, calls };
}

const handlers = (table: Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>) => table as VentureHandlerTable;
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

test('createSecretShelf keeps secrets in memory and clear() empties it', () => {
  const shelf = createSecretShelf();
  assert.equal(shelf.get('model:anthropic-haiku-5-5'), null);
  shelf.set('model:anthropic-haiku-5-5', 'sk-ant-test-not-a-real-key-0000');
  shelf.set('github:demo-owner/ledger-cafe-books', 'github_pat_test_not_a_real_token_00');
  assert.equal(shelf.has('model:anthropic-haiku-5-5'), true);
  assert.equal(shelf.get('model:anthropic-haiku-5-5'), 'sk-ant-test-not-a-real-key-0000');
  assert.equal(JSON.stringify(shelf).includes('sk-ant'), false);
  shelf.delete('model:anthropic-haiku-5-5');
  assert.equal(shelf.has('model:anthropic-haiku-5-5'), false);
  shelf.clear();
  assert.equal(shelf.get('github:demo-owner/ledger-cafe-books'), null);
});

test('PACKAGE_LOADERS has one loader per package and missingHandlers lists what each owner lacks', () => {
  // 5-0 added playbooks (Ink v2 wave 5).
  assert.deepEqual(Object.keys(PACKAGE_LOADERS).sort(), ['agents', 'build', 'chief', 'core', 'delivery', 'models', 'money', 'network', 'notify', 'playbooks', 'views']);
  const all = missingHandlers({});
  assert.equal(all.length, VENTURE_METHODS.length - PRE_VAULT_METHODS.length - DRAFT_METHODS.length);
  for (const method of [...PRE_VAULT_METHODS, ...DRAFT_METHODS]) assert.equal(all.includes(method), false, method);
  const fn = async () => null;
  const full = Object.fromEntries((['core', 'models', 'money', 'build', 'delivery', 'views', 'agents', 'chief', 'network', 'notify', 'playbooks'] as VenturePackageId[]).map(id => [id,
    Object.fromEntries(VENTURE_METHODS.filter(m => METHOD_OWNERS[m] === id && !PRE_VAULT_METHODS.includes(m) && !DRAFT_METHODS.includes(m)).map(m => [m, fn]))]));
  assert.deepEqual(missingHandlers(full), []);
  // A handler registered in the wrong package's table does not count, and neither does a value that is not a function.
  const misplaced = { ...full, core: { ...full.core, 'venture.get': 'not a function' }, money: { ...full.money, 'venture.events': fn } } as any;
  delete misplaced.core['venture.events'];
  assert.deepEqual(missingHandlers(misplaced).sort(), ['venture.events', 'venture.get']);
});

test('a package that fails to load answers NOT_BUILT_YET for its own methods only, and a later call retries it', async () => {
  let moneyReady = false;
  const { loaders: fake, calls } = loaders({
    core: async () => ({ handlers: handlers({ 'venture.get': async () => 'core answered' }) }),
    money: async () => {
      if (!moneyReady) throw new SyntaxError('Unexpected end of input (a half-written file)');
      return { handlers: handlers({ 'venture.client.list': async () => ['client'] }) };
    },
  });
  const host = new VentureHost(new VentureTestStore(), services, baseOptions, fake);
  await assert.rejects(host.request(owner, 'venture.client.list', {}), code('NOT_BUILT_YET'));
  await assert.rejects(host.request(owner, 'venture.order.list', {}), code('NOT_BUILT_YET'));
  assert.equal(await host.request(owner, 'venture.get', {}), 'core answered');
  assert.equal(calls.money, 2, 'a failed load is forgotten, so each call tries again');
  moneyReady = true;
  assert.deepEqual(await host.request(owner, 'venture.client.list', {}), ['client']);
  assert.deepEqual(await host.request(owner, 'venture.client.list', {}), ['client']);
  assert.equal(calls.money, 3, 'a successful load is remembered');
  assert.equal(calls.core, 1);
});

test('a loader that throws synchronously or returns no handler table counts as not built', async () => {
  const { loaders: fake } = loaders({
    build: (() => { throw new Error('sync throw'); }) as any,
    delivery: async () => ({ notHandlers: {} } as any),
  });
  const host = new VentureHost(new VentureTestStore(), services, baseOptions, fake);
  await assert.rejects(host.request(owner, 'venture.build.status', {}), code('NOT_BUILT_YET'));
  await assert.rejects(host.request(owner, 'venture.capabilities', {}), code('NOT_BUILT_YET'));
});

test('a handler placed in the wrong package table is never reached', async () => {
  let reached = false;
  const { loaders: fake } = loaders({
    core: async () => ({ handlers: handlers({ 'venture.client.add': async () => { reached = true; return 'wrong owner'; } }) }),
  });
  const host = new VentureHost(new VentureTestStore(), services, baseOptions, fake);
  await assert.rejects(host.request(owner, 'venture.client.add', { name: 'Cafe Aroma Demo' }), code('NOT_BUILT_YET'));
  assert.equal(reached, false);
});

test('unknown names and the pre-vault methods are refused by request', async () => {
  const { loaders: fake, calls } = loaders();
  const host = new VentureHost(new VentureTestStore(), services, baseOptions, fake);
  for (const method of ['venture.nope', 'workspace.status', 'venture', '', 'venture.countries', 'venture.preview', 'venture.playbooks.list', '__proto__']) {
    await assert.rejects(host.request(owner, method, {}), code('INVALID_VENTURE_REQUEST'), method);
  }
  assert.deepEqual(calls, NO_CALLS);
});

test('every app-only method refuses phone, MCP and tainted contexts before any loader runs', async () => {
  const { loaders: fake, calls } = loaders();
  const host = new VentureHost(new VentureTestStore(), services, baseOptions, fake);
  const contexts: Context[] = [
    { ...owner, channel: 'phone' },
    { ...owner, channel: 'mcp' },
    { memberId: 'owner', role: 'owner', epoch: 1 },
    { ...owner, sourceTainted: true },
  ];
  // The draft methods never reach the host (the engine's draft desk checks the app channel itself).
  for (const method of APP_ONLY_METHODS.filter(m => !DRAFT_METHODS.includes(m))) for (const ctx of contexts) {
    await assert.rejects(host.request(ctx, method, {}), code('APP_APPROVAL_REQUIRED'), `${method} ${JSON.stringify(ctx)}`);
  }
  for (const method of DRAFT_METHODS) await assert.rejects(host.request(owner, method, {}), code('INVALID_VENTURE_REQUEST'), method);
  assert.deepEqual(calls, NO_CALLS);
});

test('constructing a host calls no loader, no factory and touches no file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-venture-host-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { loaders: fake, calls } = loaders();
  let factoryCalls = 0;
  const modelReplayPath = join(directory, 'missing-model-replay.json');
  const githubReplayPath = join(directory, 'missing-github-replay.json');
  const host = new VentureHost(new VentureTestStore(), services, { ...baseOptions, modelReplayPath, githubReplayPath }, fake);
  const withFactory = new VentureHost(new VentureTestStore(), services,
    { ...baseOptions, githubTransport: () => { factoryCalls += 1; throw new Error('factory called'); } }, fake);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(host instanceof VentureHost && withFactory instanceof VentureHost);
  assert.deepEqual(calls, NO_CALLS);
  assert.equal(factoryCalls, 0);
  await assert.rejects(access(modelReplayPath));
  await assert.rejects(access(githubReplayPath));
});

test('handlers get the deps the spec names, and an empty payload arrives as {}', async () => {
  const seen: { value: { deps: VentureDeps; payload: unknown } | null } = { value: null };
  const { loaders: fake } = loaders({
    core: async () => ({ handlers: handlers({ 'venture.get': async (deps, _ctx, payload) => { seen.value = { deps, payload }; return null; } }) }),
  });
  const store = new VentureTestStore();
  const clock = () => new Date('2026-10-15T10:00:00.000Z');
  const host = new VentureHost(store, services, { demo: false, storage: 'postgres', clock }, fake);
  await host.request(owner, 'venture.get', undefined);
  assert.ok(seen.value);
  const { deps, payload } = seen.value;
  assert.deepEqual(payload, {});
  assert.equal(deps.store, store);
  assert.equal(deps.services, services);
  assert.equal(deps.clock, clock);
  assert.equal(deps.host, 'test');
  assert.equal(deps.demo, false);
  assert.equal(deps.storage, 'postgres');
  assert.equal(deps.github.kind, 'github-api');
  assert.deepEqual(deps.models.status(owner), { label: 'port-1:false' });
});

test('when the models package fails to load, core still answers and model calls refuse NOT_BUILT_YET', async () => {
  const { loaders: fake, calls } = loaders({
    models: async () => { throw new Error('half-written models package'); },
    core: async () => ({ handlers: handlers({
      'venture.get': async () => 'core answered',
      'venture.events': async (deps, ctx) => deps.models.status(ctx),
      'venture.interview.next': async deps => deps.models.presets(),
    }) }),
  });
  const host = new VentureHost(new VentureTestStore(), services, baseOptions, fake);
  assert.equal(await host.request(owner, 'venture.get', {}), 'core answered');
  await assert.rejects(host.request(owner, 'venture.events', {}), code('NOT_BUILT_YET'));
  await assert.rejects(host.request(owner, 'venture.interview.next', {}), code('NOT_BUILT_YET'));
  await assert.rejects(host.request(owner, 'venture.models.status', {}), code('NOT_BUILT_YET'));
  assert.ok(calls.models >= 3, 'each request tries the models package again');
});

test('two first requests share one model port, and the port is built from the injected transport', async () => {
  const counter = { ports: 0, replays: [] as unknown[] };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { loaders: fake, calls } = loaders({
    models: async () => { await gate; return modelsModule(counter); },
    core: async () => ({ handlers: handlers({ 'venture.get': async deps => deps.models.status(owner) }) }),
  });
  const host = new VentureHost(new VentureTestStore(), services, { ...baseOptions, modelTransport: { ...noTransport, replay: true } }, fake);
  const both = Promise.all([host.request(owner, 'venture.get', {}), host.request(owner, 'venture.get', {})]);
  release();
  const [first, second] = await both;
  assert.deepEqual(first, { label: 'port-1:true' });
  assert.deepEqual(second, { label: 'port-1:true' });
  assert.equal(counter.ports, 1);
  assert.equal(calls.models, 1);
  assert.deepEqual(await host.request(owner, 'venture.get', {}), { label: 'port-1:true' });
  assert.equal(counter.ports, 1);
});

test('replay files are read on first use: a missing model recording fails only model calls until it appears', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-venture-host-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const counter = { ports: 0, replays: [] as unknown[] };
  const { loaders: fake } = loaders({
    models: async () => modelsModule(counter),
    core: async () => ({ handlers: handlers({
      'venture.get': async () => 'core answered',
      'venture.events': async deps => deps.models.presets(),
    }) }),
  });
  const modelReplayPath = join(directory, 'model-replay.json');
  const host = new VentureHost(new VentureTestStore(), services, { ...baseOptions, modelReplayPath }, fake);
  assert.equal(await host.request(owner, 'venture.get', {}), 'core answered');
  await assert.rejects(host.request(owner, 'venture.events', {}), (error: any) => {
    assert.equal(error.code, 'NOT_BUILT_YET');
    assert.match(error.message, /recording could not be read/);
    return true;
  });
  assert.equal(counter.ports, 0);
  const fixture = { label: 'synthetic recording', note: 'Hand-written for this test.', responses: [] };
  await writeFile(modelReplayPath, JSON.stringify(fixture));
  assert.deepEqual(await host.request(owner, 'venture.events', {}), [{ id: 'built-in-templates', label: 'port-1:true' }]);
  assert.deepEqual(counter.replays, [fixture]);
});

test('the GitHub recording fills {{briefId}} from the store and deps.github.kind is fixture', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-venture-host-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const githubReplayPath = join(directory, 'github-sync.json');
  const fixture: GitHubFixture = { label: 'synthetic recording', responses: {
    '/repos/demo-owner/demo/contents/AGENTS.md': { status: 200, etag: null, body: 'chausar-brief-id: {{briefId}}\n' },
  } };
  await writeFile(githubReplayPath, JSON.stringify(fixture));
  const created: GitHubFixture[] = [];
  const buildModule: VenturePackageModule = {
    handlers: handlers({
      'venture.build.sync': async deps => {
        const before = deps.github.kind;
        const response = await deps.github.read({ path: '/repos/demo-owner/demo/contents/AGENTS.md', accept: 'raw', etag: null, token: null });
        return { before, after: deps.github.kind, body: response.body };
      },
    }),
    defaultGitHubTransport: () => { throw new Error('the real transport must not be used with a recording'); },
    createFixtureGitHubTransport: (data: GitHubFixture, vars: () => Record<string, string>): GitHubTransport => {
      created.push(data);
      return { kind: 'fixture', read: async request => {
        const entry = data.responses[request.path];
        return { status: entry.status, etag: entry.etag, body: String(entry.body).replaceAll('{{briefId}}', vars().briefId), rateRemaining: null };
      } };
    },
  };
  const store = new VentureTestStore();
  await store.update(state => {
    state.conversations.push({ id: 'brief_1', kind: 'venture-brief', ventureId: 'venture_1', briefId: 'chb_aaaa1111' });
    state.conversations.push({ id: 'brief_2', kind: 'venture-brief', ventureId: 'venture_1', briefId: 'chb_bbbb2222' });
  });
  const { loaders: fake } = loaders({ build: async () => buildModule });
  const host = new VentureHost(store, services, { ...baseOptions, githubReplayPath }, fake);
  const result = await host.request(owner, 'venture.build.sync', {}) as { before: string; after: string; body: string };
  assert.deepEqual(result, { before: 'fixture', after: 'fixture', body: 'chausar-brief-id: chb_bbbb2222\n' });
  assert.equal(created.length, 1);
  await host.request(owner, 'venture.build.sync', {});
  assert.equal(created.length, 1, 'the transport is chosen once per host');
});

test('a missing GitHub recording refuses GITHUB_READ_FAILED, and an injected factory gets the store', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-venture-host-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const read = { 'venture.build.sync': async (deps: VentureDeps) => (await deps.github.read({ path: '/repos/a/b', accept: 'json', etag: null, token: null })).body };
  const buildModule: VenturePackageModule = { handlers: handlers(read), createFixtureGitHubTransport: () => { throw new Error('not reached'); }, defaultGitHubTransport: () => { throw new Error('not reached'); } };
  const { loaders: fake } = loaders({ build: async () => buildModule });
  const missing = new VentureHost(new VentureTestStore(), services, { ...baseOptions, githubReplayPath: join(directory, 'missing.json') }, fake);
  await assert.rejects(missing.request(owner, 'venture.build.sync', {}), code('GITHUB_READ_FAILED'));

  const store = new VentureTestStore();
  const seenStores: unknown[] = [];
  const injected = new VentureHost(store, services, { ...baseOptions, githubTransport: given => {
    seenStores.push(given);
    return { kind: 'fixture', read: async () => ({ status: 200, etag: null, body: 'from the injected transport', rateRemaining: null }) };
  } }, fake);
  assert.equal(await injected.request(owner, 'venture.build.sync', {}), 'from the injected transport');
  assert.deepEqual(seenStores, [store]);
});

test('close() clears the secret shelf, drops the port and refuses later requests', async () => {
  const captured: { shelf: VentureDeps['secrets'] | null } = { shelf: null };
  const counter = { ports: 0, replays: [] as unknown[] };
  const { loaders: fake } = loaders({
    models: async () => modelsModule(counter),
    core: async () => ({ handlers: handlers({ 'venture.get': async deps => { captured.shelf = deps.secrets; deps.secrets.set('model:anthropic-haiku-5-5', 'sk-ant-test-not-a-real-key-0000'); return deps.models.status(owner); } }) }),
  });
  const host = new VentureHost(new VentureTestStore(), services, { ...baseOptions, modelTransport: noTransport }, fake);
  assert.deepEqual(await host.request(owner, 'venture.get', {}), { label: 'port-1:false' });
  assert.ok(captured.shelf);
  const secrets = captured.shelf;
  assert.equal(secrets.has('model:anthropic-haiku-5-5'), true);
  host.close();
  assert.equal(secrets.has('model:anthropic-haiku-5-5'), false);
  assert.equal(secrets.get('model:anthropic-haiku-5-5'), null);
  await assert.rejects(host.request(owner, 'venture.get', {}), code('VAULT_LOCKED'));
  assert.equal(counter.ports, 1);
});
