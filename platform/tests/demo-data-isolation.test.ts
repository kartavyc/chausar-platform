import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { authorize, audit, check, ChausarError, hash, initialState, newId, now, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { digest } from '../runtime/actions.ts';
import { assertSourceAccess, trustFingerprint } from '../runtime/trust.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { ImportService, demoCsv, demoRecipe, importPublicRecord } from '../runtime/ingest.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { EngineConnectorService, type EngineConnectorOptions, type EngineConnectorProfile } from '../runtime/engine-connectors.ts';
import { ConnectorCapabilityRegistry, type ConnectorCapability, type ConnectorOperationScope, type SyntheticConnectorEvidence } from '../runtime/connector-framework/index.ts';
import { conversationPurpose } from '../runtime/conversation-purpose.ts';
import { invoiceConnectorId, invoiceJobType } from '../runtime/invoice-follow-up.ts';
import type { ConnectorService, HttpRequest } from '../runtime/connectors.ts';
import type { Engine, EngineOptions } from '../runtime/engine.ts';
import { secondAskGate } from '../runtime/gateway-auth/second-ask.ts';

// Actual Engine/legacy connector source with in-memory custody and authored
// ports only. Host imports are removed from the VM; no network, database,
// provider, native helper, user profile or credential store can run.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const disabled = { code: 'DEMO_SOURCE_READ_DISABLED' };
class MemoryStore implements StateStore {
  state = initialState('SYNTHETIC data isolation fixture', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft); draft.revision++; this.state = draft; return result;
  }
}
type EngineFixture = Pick<Engine, 'options' | 'services' | 'request' | 'requestAs' | 'context'> & { attach(store: StateStore): Promise<void> };
type EngineConstructor = new (options: EngineOptions) => EngineFixture;
const tally = { connector: 'tally-prime', sourceId: 'synthetic-tally', company: 'SYNTHETIC Company', endpoint: 'http://127.0.0.1:9000/' };
const zoho = { connector: 'zoho-books', sourceId: 'synthetic-books', organizationId: '9001', endpoint: 'https://www.zohoapis.com/books/v3' };

async function engineVm() {
  const calls = { http: 0, timers: 0, clearedTimers: 0, credential: 0 };
  const requests: Array<{ url: string; method: HttpRequest['method']; redirect: string }> = [];
  const connectorSource = await readFile(new URL('../runtime/connectors.ts', import.meta.url), 'utf8');
  const connectorCode = stripTypeScriptTypes(connectorSource.replace(/^import .*$/gm, '')).replace(/^export /gm, '');
  const LegacyConnector = vm.runInNewContext(`${connectorCode}\nConnectorService`, {
    authorize, audit, check, hash, newId, now, assertSourceAccess, trustFingerprint, ImportService,
    structuredClone, Buffer, TextDecoder, URL, AbortController,
    setTimeout: () => { calls.timers++; return 0; }, clearTimeout: () => { calls.clearedTimers++; },
    fetch: async (url: string, input: { method: HttpRequest['method']; redirect: string }) => {
      calls.http++; requests.push({ url, method: input.method, redirect: input.redirect });
      const text = url.startsWith('http://127.0.0.1:9000/')
        ? '<ENVELOPE><VOUCHER /></ENVELOPE>'
        : JSON.stringify({ code: 0, invoices: [{ invoice_id: '90001', date: '2026-09-01', sub_total: '10.50', currency_code: 'INR' }],
          page_context: { page: 1, has_more_page: false } });
      const bytes = Buffer.from(text); let delivered = false;
      return { status: 200, url, redirected: false, headers: { get: () => null }, body: { getReader: () => ({
        read: async () => { if (delivered) return { done: true }; delivered = true; return { done: false, value: bytes }; },
        cancel: async () => {},
      }) } };
    },
  }, { filename: 'synthetic-legacy-data-isolation.vm.js' }) as typeof ConnectorService;
  const source = await readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8');
  const code = stripTypeScriptTypes(source.slice(source.indexOf('export type EngineBackupCustodyOptions'))).replace('export class Engine', 'class Engine');
  const directoryBindings: string[] = [];
  class SyntheticService {
    options: unknown;
    constructor(_store: unknown, options: unknown = {}) { this.options = options; }
  }
  const globals: Record<string, unknown> = {
    AsyncLocalStorage, resolve, join, authorize, audit, check, ChausarError, hash, newId, now, structuredClone, conversationPurpose, invoiceConnectorId, invoiceJobType, digest,
    compareVersions: () => 0, OntologyService, ImportService, CalculatorService, EngineConnectorService,
    ConnectorService: LegacyConnector, importPublicRecord, installedConversationSynthesisCodec: {},
    safeDirectory: async (path: string) => { directoryBindings.push(path); return path; },
    createWorkspaceInterchangeLocalPorts: () => ({ ports: {} }),
    // No engine modules are installed in this isolated composition.
    engineModules: [], moduleMethods: new Map(),
    // The core actions' money gate (core-gateway-auth), the real one.
    secondAskGate,
  };
  for (const name of new Set([...code.matchAll(/new ([A-Z][a-zA-Z]+)/g)].map(match => match[1]))) {
    if (!Object.hasOwn(globals, name) && !['Set', 'Map', 'Error', 'URL'].includes(name)) globals[name] = SyntheticService;
  }
  const Engine = vm.runInNewContext(`${code}\nEngine`, globals, { filename: 'synthetic-engine-data-isolation.vm.js' }) as EngineConstructor;
  return { Engine, calls, requests, directoryBindings, credentialBroker: async () => { calls.credential++; return 'synthetic-fixture-only'; } };
}

function connectorFixture() {
  const at = Date.now(), calls = { grants: 0, reader: 0 };
  const domain = { company: 'SYNTHETIC Company', dataset: 'sales', branches: ['main'], period: { from: '2026-09-01', to: '2026-09-30' } };
  const readOperation: ConnectorOperationScope = { connectorId: 'synthetic-isolation', connectorVersion: '1', operationId: 'read-sales', kind: 'read', transport: 'api',
    applicability: { applicationVersion: '1', edition: 'fixture', module: 'sales', configuration: 'synthetic-only', deploymentProfile: 'synthetic' } };
  const importOperation: ConnectorOperationScope = { ...readOperation, operationId: 'import-sales', kind: 'import', transport: 'file' };
  const readCapabilities: ConnectorCapability[] = ['authentication-expiry', 'raw-provenance', 'coverage', 'freshness'];
  const readDigest = digest('synthetic-isolation-reader'), importDigest = digest('synthetic-isolation-decoder');
  const operations = [readOperation, importOperation];
  const evidence: SyntheticConnectorEvidence[] = operations.map((scope, index) => ({
    id: `synthetic-isolation-evidence-${index}`, scope, assertions: ['operation', ...(index === 0 ? readCapabilities : [])],
    observedAt: new Date(at - 1000).toISOString(), expiresAt: new Date(at + 60_000).toISOString(),
    artifact: { sha256: digest('authored synthetic data regression'), reference: 'platform/tests/demo-data-isolation.test.ts' },
    notes: ['Authored fixture only; no real source qualification.'], environment: 'synthetic',
    provenance: { kind: 'synthetic-fixture', generatorVersion: 'v1' }, implementationDigest: index === 0 ? readDigest : importDigest,
  }));
  const registry = new ConnectorCapabilityRegistry(operations.map((scope, index) => ({ scope, implemented: true,
    capabilities: index === 0 ? readCapabilities : [], evidenceIds: [evidence[index].id], limitations: ['Synthetic fixture only.'],
    implementationDigest: index === 0 ? readDigest : importDigest })), evidence);
  const row = { id: 'synthetic-sale', revision: '1', kind: 'sale', date: '2026-09-01', amount: '1050', currency: 'INR', branch: 'main' };
  const schemaSha256 = digest(Object.keys(row));
  const profile: EngineConnectorProfile = {
    id: 'synthetic-sales', title: 'Authored synthetic sales', sourceId: 'synthetic-managed', companyId: 'synthetic-company', domain,
    environment: 'synthetic', syntheticFixture: true, readOperation, importOperation,
    readImplementationDigest: readDigest, importImplementationDigest: importDigest, contentTypes: ['application/json'], maximumSourceAgeMs: 60_000,
    decoder: { id: 'synthetic-json', version: '1', schemaSha256, identityNamespace: 'synthetic-sales', identityFields: ['id', 'revision'],
      resourceIdentityFields: ['id', 'kind'], revisionOrder: { kind: 'unqualified' }, businessFields: Object.keys(row), deliveryFields: [], decode: text => JSON.parse(text) },
    reader: { operation: readOperation, environment: 'synthetic', mode: 'api', sideEffects: 'none', retrySafety: 'single-attempt', retryOwner: 'dispatcher',
      requiredAuthScopes: ['sales.read'], pagination: { kind: 'none' }, readPage: async request => {
        calls.reader++; assert.equal(request.dataScope?.company, domain.company);
        return { content: Buffer.from(JSON.stringify([row])), contentType: 'application/json', schemaFingerprint: schemaSha256, rowCount: 1,
          continuation: { kind: 'complete' }, source: { reportReference: 'synthetic-report', generatedAtMs: at, snapshotId: 'synthetic-snapshot',
            completeness: 'reported-complete', totalRows: 1 } };
      } },
  };
  const options: EngineConnectorOptions = { registry, profiles: [profile], clock: { nowMs: () => at, setTimer: () => () => {}, sleep: async () => {} },
    authorizeRead: async (_ctx, scope, grantedScopes) => { calls.grants++; return { scope, authorityRevision: 'synthetic-host-grant',
      grantedScopes, expiresAtMs: at + 60_000, credentialReference: null }; } };
  return { options, calls };
}

test('demo refuses legacy Tally HTTP and Zoho credentials after mode metadata mutation and reattach', async () => {
  const { Engine, calls, credentialBroker, directoryBindings } = await engineVm();
  const launch: EngineOptions = { directory: '/synthetic-data-profile', demo: true, connectorCredentials: credentialBroker };
  const engine = new Engine(launch); launch.demo = false;
  for (let attach = 0; attach < 2; attach++) {
    const store = new MemoryStore(); store.state.workspace.demo = false; await engine.attach(store);
    engine.options.demo = false;
    for (const send of ['nothing', 'shape', 'samples'] as const) {
      store.state.policy.send = send; const before = structuredClone(store.state);
      for (const input of [tally, zoho]) await assert.rejects(engine.request('sources.fetch', { ...input, demo: false }), disabled);
      assert.deepEqual(store.state, before, 'no fetched content, receipt, import or activity is retained');
    }
    engine.services.connectorRuntime.close();
  }
  assert.deepEqual(calls, { http: 0, timers: 0, clearedTimers: 0, credential: 0 });
  assert.deepEqual(directoryBindings, [resolve('/synthetic-data-profile'), resolve('/synthetic-data-profile')], 'only authored directory binding runs');
});

test('demo refuses an installed qualified host reader before grants and acquisition effects', async () => {
  const { Engine, calls } = await engineVm(), fixture = connectorFixture();
  const engine = new Engine({ directory: '/synthetic-data-profile', demo: true, connectorRuntime: fixture.options });
  for (let attach = 0; attach < 2; attach++) {
    const store = new MemoryStore(); store.state.workspace.demo = false; await engine.attach(store); engine.options.demo = false;
    const profiles = await engine.request('connectors.profiles', {}); assert.equal(profiles[0].read.permitted, true);
    const before = structuredClone(store.state);
    await assert.rejects(engine.request('connectors.read', { profileId: 'synthetic-sales' }), disabled);
    assert.deepEqual(store.state, before); engine.services.connectorRuntime.close();
  }
  assert.deepEqual(fixture.calls, { grants: 0, reader: 0 });
  assert.deepEqual(calls, { http: 0, timers: 0, clearedTimers: 0, credential: 0 });
});

test('normal Engine preserves actual legacy read admission and bounded synthetic transport', async () => {
  const { Engine, calls, requests, credentialBroker } = await engineVm();
  const engine = new Engine({ directory: '/synthetic-production-fixture', demo: false, connectorCredentials: credentialBroker });
  const store = new MemoryStore(); await engine.attach(store);
  const tallyRead = await engine.request('sources.fetch', tally), zohoRead = await engine.request('sources.fetch', zoho);
  assert.equal(tallyRead.receipt.rows, 1); assert.equal(zohoRead.receipt.rows, 1);
  assert.deepEqual(calls, { http: 2, timers: 2, clearedTimers: 2, credential: 1 });
  assert.deepEqual(requests.map(request => [request.method, request.redirect]), [['POST', 'error'], ['GET', 'error']]);
  assert.equal(store.state.receipts.length, 2); assert.equal(store.state.facts.length, 0); assert.equal(store.state.imports.length, 0);
  store.state.sourceRules.push({ sourceId: zoho.sourceId, revoked: true });
  await assert.rejects(engine.request('sources.fetch', zoho), { code: 'SOURCE_REVOKED' });
  assert.deepEqual(calls, { http: 2, timers: 2, clearedTimers: 2, credential: 1 });
  engine.services.connectorRuntime.close();
});

test('normal Engine preserves installed reader qualification, role and current source guards', async () => {
  const { Engine } = await engineVm(), fixture = connectorFixture();
  const engine = new Engine({ directory: '/synthetic-production-fixture', demo: false, connectorRuntime: fixture.options });
  const store = new MemoryStore(); await engine.attach(store);
  const read = await engine.request('connectors.read', { profileId: 'synthetic-sales' });
  assert.equal(read.syntheticFixture, true); assert.equal(read.liveVerified, false); assert.equal(read.receipt.rows, 1);
  assert.ok(fixture.calls.grants > 0); assert.equal(fixture.calls.reader, 1);
  const authorizedGrants = fixture.calls.grants;
  await engine.request('connectors.releaseRead', { acquisitionId: read.acquisitionId });
  store.state.members.push({ id: 'viewer', name: 'Synthetic viewer', role: 'viewer', epoch: 1, active: true, branches: ['main'] });
  await assert.rejects(engine.requestAs({ memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' }, 'connectors.read',
    { profileId: 'synthetic-sales' }), { code: 'FORBIDDEN' });
  store.state.sourceRules.push({ sourceId: 'synthetic-managed', revoked: true });
  await assert.rejects(engine.request('connectors.read', { profileId: 'synthetic-sales' }), { code: 'SOURCE_REVOKED' });
  assert.deepEqual(fixture.calls, { grants: authorizedGrants, reader: 1 }); engine.services.connectorRuntime.close();
});

test('demo keeps data-only recipe review, explicit local import and exact calculations available', async () => {
  const { Engine, calls } = await engineVm(), engine = new Engine({ directory: '/synthetic-data-profile', demo: true });
  const store = new MemoryStore(); await engine.attach(store); await engine.request('ontology.publish', { draft: 'ecommerce' });
  const proposal = await engine.request('sources.recipe', { connector: 'csv', sourceId: 'synthetic-local', company: 'SYNTHETIC Company', edition: '1',
    fields: ['id', 'date', 'amount', 'currency'], evidence: { reportId: 'synthetic-local-report', sha256: hash('synthetic-report') } });
  const accepted = await engine.request('sources.accept', { proposalId: proposal.id,
    resolutions: { amountMinor: { source: 'amount', meaning: 'Synthetic net amount in rupees' } } });
  assert.equal(accepted.status, 'accepted');
  const input = { sourceId: 'synthetic-local', format: 'csv', content: demoCsv, recipe: structuredClone(demoRecipe),
    expectedTotals: { rowCount: 10, amountMinor: '1230000' } };
  const preview = await engine.request('sources.preview', input); assert.equal(preview.accepted, true);
  const imported = await engine.request('sources.import', input); assert.equal(imported.totalsMinor, '1230000');
  const receipt = await engine.request('calculation.run', { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(receipt.totalMinor, '300000'); assert.deepEqual(await engine.request('receipts.get', { id: receipt.id }), receipt);
  assert.deepEqual(calls, { http: 0, timers: 0, clearedTimers: 0, credential: 0 }); engine.services.connectorRuntime.close();
});

test('demo refusal retains current authority checks before either acquisition method', async () => {
  const { Engine, calls } = await engineVm(), fixture = connectorFixture();
  const engine = new Engine({ directory: '/synthetic-data-profile', demo: true, connectorRuntime: fixture.options });
  const store = new MemoryStore(); await engine.attach(store); store.state.members[0].epoch++;
  await assert.rejects(engine.request('sources.fetch', tally), { code: 'ACCESS_REVOKED' });
  await assert.rejects(engine.request('connectors.read', { profileId: 'synthetic-sales' }), { code: 'ACCESS_REVOKED' });
  assert.deepEqual(calls, { http: 0, timers: 0, clearedTimers: 0, credential: 0 });
  assert.deepEqual(fixture.calls, { grants: 0, reader: 0 }); engine.services.connectorRuntime.close();
});
