import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { authorize, audit, check, ChausarError, hash, initialState, newId, now, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ModelGateway, type GatewayOptions, type ModelRequest, type RouteKind } from '../runtime/gateway.ts';
import { conversationPurpose } from '../runtime/conversation-purpose.ts';
import { invoiceConnectorId, invoiceJobType } from '../runtime/invoice-follow-up.ts';
import { secondAskGate } from '../runtime/gateway-auth/second-ask.ts';
import { EngineEventBus } from '../runtime/core-sync-jobs/event-bus.ts';
import { RequestAudits } from '../runtime/core-sync-jobs/request-audits.ts';

// In-memory state and authored fake ports only. The VM removes host imports so
// no native services, user profiles, database or credential helpers can run.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const disabled = { code: 'DEMO_PROVIDER_DISABLED' };
class MemoryStore implements StateStore {
  state = initialState('SYNTHETIC isolation fixture', true);
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return change(this.state); }
}
function ports() {
  const calls = { http: 0, process: 0, credential: 0, authority: 0 };
  const options: GatewayOptions = {
    demo: true,
    http: async () => { calls.http++; throw new Error('Unexpected synthetic HTTP dispatch'); },
    process: async () => { calls.process++; throw new Error('Unexpected synthetic CLI dispatch'); },
    credentialBroker: async () => { calls.credential++; throw new Error('Unexpected credential retrieval'); },
    conversationContinuation: () => { calls.authority++; throw new Error('Unexpected continuation resolution'); },
    conversationSynthesis: () => { calls.authority++; throw new Error('Unexpected synthesis resolution'); },
  };
  return { calls, options };
}

for (const kind of ['codex-cli', 'claude-cli', 'openai-responses', 'openai-compatible', 'ollama', 'managed'] as RouteKind[]) {
  test(`demo refuses later ${kind} configuration before storing route or credentials`, async () => {
    const store = new MemoryStore(), { calls, options } = ports(), gateway = new ModelGateway(store, options);
    const before = structuredClone(store.state);
    await assert.rejects(gateway.configureRoute(owner, { id: 'synthetic-route', kind, model: 'synthetic-model',
      endpoint: 'https://synthetic-provider.invalid/v1/responses' }, 'synthetic-unused-secret'), disabled);
    assert.deepEqual(store.state, before);
    assert.deepEqual(calls, { http: 0, process: 0, credential: 0, authority: 0 });
  });
}

for (const purpose of ['analysis', 'business-context', 'conversation', 'conversation-synthesis'] as ModelRequest['purpose'][]) {
  test(`immutable demo mode refuses ${purpose} preview and dispatch regardless of mutable options or send policy`, async () => {
    const store = new MemoryStore(), { calls, options } = ports(), gateway = new ModelGateway(store, options);
    options.demo = false; gateway.options = { ...options, demo: false };
    store.state.workspace.demo = false;
    // Historical route/approval records and caller-supplied flags grant no mode change.
    store.state.routes.push({ id: 'synthetic-historical-route', kind: 'ollama', enabled: true,
      endpoint: 'http://127.0.0.1:11434/api/chat', credentialEnv: 'CHAUSAR_SYNTHETIC_UNUSED', priority: 0 });
    store.state.modelReceipts.push({ id: 'synthetic-reviewed-preview', kind: 'model-preview', purpose, status: 'preview',
      costReservedMinor: '0', approvalRequired: true }, { id: 'synthetic-reviewed-approval', kind: 'outbound-approval', used: false });
    for (const send of ['nothing', 'shape', 'samples'] as const) {
      store.state.policy.send = send;
      const before = structuredClone(store.state);
      const request = { question: 'What was billed?', routeId: 'synthetic-historical-route', purpose,
        questionDisclosure: 'verbatim' as const, toolTurnId: 'synthetic-turn', continuationId: 'synthetic-continuation' };
      await assert.rejects(gateway.preview(owner, request), disabled);
      await assert.rejects(gateway.execute(owner, request), disabled);
      await assert.rejects(gateway.execute(owner, { ...request, previewId: 'synthetic-reviewed-preview', approvalId: 'synthetic-reviewed-approval' }), disabled);
      await assert.rejects(gateway.configureRoute(owner, { kind: 'ollama', model: 'synthetic-later-route' }), disabled);
      assert.deepEqual(store.state, before, 'no receipt, budget reservation or approval consumption');
    }
    assert.equal(gateway.listRoutes(owner)[0].credentialConfigured, false);
    assert.deepEqual(calls, { http: 0, process: 0, credential: 0, authority: 0 });
  });
}

test('demo guard precedes default HTTP, subprocess, temporary files and environment credentials', async () => {
  const source = await readFile(new URL('../runtime/gateway.ts', import.meta.url), 'utf8');
  const code = stripTypeScriptTypes(source.slice(source.indexOf('export const DEFAULT_OPERATIONS'))).replace(/^export /gm, '');
  let effects = 0;
  const refuse = () => { effects++; throw new Error('A real host effect crossed the synthetic VM boundary'); };
  const Gateway = vm.runInNewContext(`${code}\nModelGateway`, {
    authorize, audit, check, ChausarError, hash, newId, now, structuredClone,
    fetch: refuse, spawn: refuse, mkdtemp: refuse, writeFile: refuse, rm: refuse, tmpdir: refuse,
    process: { env: new Proxy({}, { get: refuse }) },
  }, { filename: 'synthetic-gateway-isolation.vm.js' });
  for (const kind of ['codex-cli', 'claude-cli', 'openai-responses', 'openai-compatible', 'ollama', 'managed']) {
    const store = new MemoryStore(); store.state.policy.send = 'samples';
    store.state.routes.push({ id: 'synthetic-persisted-route', kind, enabled: true, priority: 0,
      credentialEnv: 'CHAUSAR_SYNTHETIC_CREDENTIAL' });
    const gateway = new Gateway(store, { demo: true });
    gateway.options.demo = false;
    await assert.rejects(gateway.execute(owner, { question: 'What was billed?', routeId: 'synthetic-persisted-route' }), disabled);
    assert.equal(gateway.listRoutes(owner)[0].credentialConfigured, false);
  }
  assert.equal(effects, 0);
});

test('normal gateway still requires its real send policy and exact one-use approval', async () => {
  const store = new MemoryStore(); let calls = 0;
  store.state.facts.push({ id: 'synthetic-fact', entityId: 'synthetic-invoice', sourceId: 'synthetic-books', sourceRow: 1,
    kind: 'invoice', validFrom: '2026-09-01', validTo: null, learnedAt: now(), supersededAt: null, fields: { amountMinor: '100' } });
  const gateway = new ModelGateway(store, { http: async request => {
    calls++;
    assert.equal(request.endpoint, 'https://synthetic-provider.invalid/v1/responses');
    return { status: 200, endpoint: request.endpoint, body: JSON.stringify({ output: [{ type: 'message',
      content: [{ type: 'output_text', text: '{"operation":"billed"}' }] }] }) };
  } });
  await gateway.configureRoute(owner, { id: 'synthetic-normal-route', kind: 'openai-responses', model: 'synthetic-model',
    endpoint: 'https://synthetic-provider.invalid/v1/responses' }, 'synthetic-fixture-only');
  await assert.rejects(gateway.execute(owner, { question: 'billed' }), { code: 'SEND_DISABLED' });
  assert.equal(calls, 0);
  store.state.policy.send = 'shape';
  const preview = await gateway.preview(owner, { question: 'What revenue did SYNTHETIC PRIVATE BUSINESS earn 12345678900?' });
  await assert.rejects(gateway.execute(owner, { previewId: preview.id }), { code: 'OUTBOUND_APPROVAL_REQUIRED' });
  assert.equal(calls, 0);
  const approval = await gateway.approveOutbound(owner, preview.id);
  const result = await gateway.execute(owner, { previewId: preview.id, approvalId: approval.id });
  assert.equal(result.kind, 'analysis'); assert.equal(result.plan?.operation, 'billed'); assert.equal(calls, 1);
  await assert.rejects(gateway.execute(owner, { previewId: preview.id, approvalId: approval.id }), { code: 'PREVIEW_NOT_FOUND' });
  assert.equal(calls, 1);
});

async function engineVm() {
  const source = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  const code = stripTypeScriptTypes(source.slice(source.indexOf('export type EngineBackupCustodyOptions'))).replace('export class Engine', 'class Engine');
  const filesystemCalls: string[] = [];
  class SyntheticService {
    options: unknown;
    constructor(_store: unknown, options: unknown = {}) { this.options = options; }
  }
  const globals: Record<string, unknown> = {
    AsyncLocalStorage, resolve, join, authorize, audit, check, ChausarError, hash, newId, now, structuredClone, conversationPurpose, invoiceConnectorId, invoiceJobType, Object,
    compareVersions: () => 0, ModelGateway, installedConversationSynthesisCodec: {},
    safeDirectory: async (path: string) => { filesystemCalls.push(path); return path; },
    createWorkspaceInterchangeLocalPorts: () => ({ ports: {} }),
    // No engine modules are installed in this isolated composition.
    engineModules: [], moduleMethods: new Map(),
    // The core actions' money gate (core-gateway-auth), the real one.
    secondAskGate,
    // Secret custody and PIN unlock (core-gateway-auth) follow the vault; this composition installs none.
    gatewayAuthVaultAttached: async () => {}, gatewayAuthVaultClosed: () => {}, pinUnlockCustody: async () => { throw new Error('No PIN unlock in this composition.'); },
    // core-sync-jobs (round 4): the real event bus and request audits.
    EngineEventBus, RequestAudits,
  };
  for (const name of new Set([...code.matchAll(/new ([A-Z][a-zA-Z]+)/g)].map(match => match[1]))) {
    if (!Object.hasOwn(globals, name) && !['Set', 'Map', 'Error', 'URL'].includes(name)) globals[name] = SyntheticService;
  }
  const Engine = vm.runInNewContext(`${code}\nEngine`, globals, { filename: 'synthetic-engine-isolation.vm.js' });
  return { Engine, filesystemCalls };
}

test('actual Engine composition keeps demo guard through option mutation, reattach and every model RPC path', async () => {
  const { Engine, filesystemCalls } = await engineVm(), { options: gatewayOptions, calls } = ports();
  let speechCalls = 0;
  const engine = new Engine({ directory: '/synthetic-profile', demo: true, gateway: { ...gatewayOptions, demo: false } });
  engine.options.demo = false; engine.options.gateway.demo = false;
  for (let attach = 0; attach < 2; attach++) {
    const store = new MemoryStore(); store.state.policy.send = 'samples';
    await engine.attach(store);
    const refuseSpeech = () => { speechCalls++; throw new Error('Unexpected speech provider access'); };
    engine.services.speech = { providers: () => [], configure: refuseSpeech, preview: refuseSpeech,
      approve: refuseSpeech, transcribe: refuseSpeech };
    engine.services.gateway.options.demo = false;
    const before = structuredClone(store.state);
    await assert.rejects(engine.request('models.configure', { config: { kind: 'ollama', model: 'synthetic-model' } }), disabled);
    await assert.rejects(engine.request('models.test', { demo: false }), disabled);
    await assert.rejects(engine.request('models.preview', { question: 'billed', routeId: 'synthetic-route' }), disabled);
    await assert.rejects(engine.request('conversation.ask', { question: 'What was billed?', routeId: 'synthetic-route' }), disabled);
    await assert.rejects(engine.request('conversation.ask', { question: 'What was billed?', purpose: 'conversation',
      routeId: 'synthetic-route', questionDisclosure: 'verbatim' }), disabled);
    await assert.rejects(engine.request('conversation.synthesis.run', { id: 'synthetic-turn',
      previewId: 'synthetic-preview', approvalId: 'synthetic-approval' }), disabled);
    for (const method of ['speech.configure', 'speech.preview', 'speech.approve', 'speech.transcribe']) {
      await assert.rejects(engine.request(method, { demo: false }), disabled);
    }
    assert.deepEqual(await engine.request('speech.list'), []);
    assert.deepEqual(store.state, before);
  }
  assert.deepEqual(filesystemCalls, [resolve('/synthetic-profile'), resolve('/synthetic-profile')], 'only the fake directory binding runs');
  assert.deepEqual(calls, { http: 0, process: 0, credential: 0, authority: 0 });
  assert.equal(speechCalls, 0);
});

test('normal Engine keeps speech provider delegation and service consent checks', async () => {
  const { Engine } = await engineVm(), engine = new Engine({ directory: '/synthetic-profile', demo: false });
  await engine.attach(new MemoryStore());
  const calls: string[] = [];
  engine.services.speech = Object.fromEntries(['providers', 'configure', 'preview', 'approve', 'transcribe'].map(method => [method,
    (context: Context) => { assert.deepEqual({ ...context }, owner); calls.push(method); return `synthetic-${method}`; }]));
  for (const method of ['configure', 'preview', 'approve', 'transcribe']) {
    assert.equal(await engine.request(`speech.${method}`, {}), `synthetic-${method}`);
  }
  assert.equal(await engine.request('speech.list'), 'synthetic-providers');
  assert.deepEqual(calls, ['configure', 'preview', 'approve', 'transcribe', 'providers']);
});

for (const entrypoint of ['server', 'worker'] as const) {
  test(`${entrypoint} demo startup skips provider and keychain activation; production retains host admission`, async () => {
    const source = await readFile(new URL(`../runtime/${entrypoint}.ts`, import.meta.url), 'utf8');
    const name = entrypoint === 'server' ? 'createServerEngine' : 'createWorkerEngine';
    const start = source.indexOf(`export async function ${name}`);
    const end = entrypoint === 'server' ? source.indexOf('\nif (process.argv[1]', start) : source.indexOf('\n/** Trusted host entry point.', start);
    const code = stripTypeScriptTypes(source.slice(start, end)).replace('export async function', 'async function');
    const admissions: unknown[] = [];
    class SyntheticEngine { options: unknown; constructor(options: unknown) { this.options = options; } }
    const load = vm.runInNewContext(`${code}\n${name}`, {
      Engine: SyntheticEngine, resolve, engineJobOptions: () => undefined, desktopSyncOptions: async () => undefined, desktopJobOptions: () => ({ durableJobs: undefined, jobCalendar: undefined }),
      loadCodexCliHostGateway: async (environment: unknown, dependencies: unknown) => { admissions.push(['gateway', environment, dependencies]); return { demo: false }; },
      loadEngineKeychain: async (_environment: unknown, _dependencies: unknown, demo: boolean) => { admissions.push(['keychain', demo]); return undefined; },
    });
    const environment = { CHAUSAR_DEMO: '1', CHAUSAR_VAULT_DIRECTORY: '/synthetic-profile/vaults',
      CHAUSAR_CODEX_CLI_EVIDENCE_FILE: '/synthetic-never-read/codex-cli-host.json' };
    const dependencies = { readArtifact: () => { throw new Error('Do not read synthetic provider evidence'); },
      executableSha256: () => { throw new Error('Do not inspect a synthetic executable'); },
      readKeychainManifest: () => { throw new Error('Do not inspect synthetic custody evidence'); },
      keychain: { store: () => { throw new Error('Do not enroll synthetic native custody'); },
        retrieve: () => { throw new Error('Do not retrieve synthetic native custody'); },
        remove: () => { throw new Error('Do not remove synthetic native custody'); } } };
    const demo = await (entrypoint === 'server' ? load(environment, ['--demo'], dependencies) : load(environment, dependencies));
    assert.equal(demo.options.demo, true); assert.equal(demo.options.gateway, undefined); assert.equal(demo.options.keychain, undefined);
    assert.deepEqual(admissions, []);
    admissions.length = 0;
    const productionEnvironment = { ...environment, CHAUSAR_DEMO: '0' };
    const production = await (entrypoint === 'server' ? load(productionEnvironment, [], dependencies) : load(productionEnvironment, dependencies));
    assert.equal(production.options.demo, false); assert.equal(production.options.gateway.demo, false);
    assert.deepEqual(admissions, [['gateway', productionEnvironment, dependencies], ['keychain', false]]);
  });
}
