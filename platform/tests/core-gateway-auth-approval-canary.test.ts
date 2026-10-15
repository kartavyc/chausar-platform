import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { demoCsv, demoRecipe, ImportService } from '../runtime/ingest.ts';
import { LearningService } from '../runtime/learning.ts';
import { learningExtModule } from '../runtime/modules/lane-learning-ext.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import type { IntakeRequest } from '../runtime/learning-ext/sharing.ts';
import { guardOutbound, UNATTRIBUTED_OUTBOUND } from '../runtime/plugins.ts';
import { AllowanceRouteClient, allowanceRouteFor, initialHostedLinkState } from '../runtime/hosted-link/service.ts';
import { HostedClient, type FetchReply } from '../runtime/hosted-link/client.ts';
import { newKey } from '../runtime/hosted-link/seal.ts';
import { rawPublicKey } from '../runtime/smallapps/plugin-format.ts';
import type { TransportRequest, TransportResponse } from '../runtime/smallapps/plugin-network.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// Synthetic only: injected transports, a temp-directory vault and an in-memory store. Nothing reaches a network.
// The trust lane's leak check is registered when the engine's module registry loads (imported through engine.ts).
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const passphrase = 'Synthetic canary coverage passphrase';
const GSTIN = '27AAPFU0939F1ZV', MAIL = 'ravi.k@shop.example.in';
const TRUST = 'reports-tools-trust';

class Store implements StateStore {
  state: State;
  constructor(demo = false) { this.state = initialState('Synthetic canary shop', demo); }
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const plant = (state: State, value: string) => { (state.extensions ??= {})[TRUST] = { reports: {}, trust: {}, tools: { canary: { value, plantedAt: '2026-10-15T00:00:00.000Z', alert: null } } }; };
const blocked = (state: State) => (state.extensions as any)?.[TRUST]?.tools?.canary?.blocked;

test('guardOutbound runs the registered leak check: the planted value and GSTINs, mail and phone numbers from the books stop a call', async () => {
  const store = new Store();
  store.state.facts.push({ id: 'fact_1', entityId: 'cust-1', sourceId: 'books', sourceRow: 1, kind: 'customer', validFrom: '2026-01-01', validTo: null, learnedAt: '2026-01-01T00:00:00.000Z', supersededAt: null,
    fields: { gstin: GSTIN, mail: MAIL, phone: '+91 98765 43210' } });
  const call = (payload: string) => guardOutbound(store, UNATTRIBUTED_OUTBOUND, { channel: 'allowance', receiptId: 'req_synthetic_1', endpoint: '/v1/allowance/complete', payload });
  await call('{"messages":[{"role":"user","content":"Summarise the month."}]}');
  for (const leak of [GSTIN, MAIL, '9876543210', '98765-43210']) await assert.rejects(call(`{"content":"customer ${leak}"}`), code('CANARY_BLOCKED'), leak);
  plant(store.state, 'CANARY-synthetic000000000000');
  await assert.rejects(call('{"content":"CANARY-synthetic000000000000"}'), code('CANARY_BLOCKED'));
  assert.equal(blocked(store.state).callId, 'req_synthetic_1');
  await assert.rejects(guardOutbound(store, owner, { channel: 'mail' as any, receiptId: 'x', endpoint: '/', payload: '' }), code('INVALID_OUTBOUND'));
});

// --- Plugin network calls --------------------------------------------------------------------------
const section = (id: number, bytes: number[]) => [id, bytes.length, ...bytes];
const str = (value: string) => [value.length, ...Buffer.from(value)];
/** memory + alloc(len) -> 1024 + run(ptr, len) -> len & 255. */
const echo = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, ...section(1, [2, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 1, 0x7f]), ...section(3, [2, 0, 1]), ...section(5, [1, 1, 1, 1]),
  ...section(7, [3, ...str('memory'), 2, 0, ...str('alloc'), 0, 0, ...str('run'), 0, 1]), ...section(10, [2, 5, 0, 0x41, 0x80, 0x08, 0x0b, 8, 0, 0x20, 1, 0x41, 0xff, 0x01, 0x71, 0x0b])]).toString('base64');
const manifest = (id: string) => ({ id, name: 'Canary test', version: '1.0.0', runtime: 'wasm', entrypoint: 'run', capabilities: [], sourceIds: [], maxMemoryPages: 16, timeoutMs: 2000 });

async function shop(t: TestContext, options: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-canary-'));
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock), modules: { 'models-ext': options } });
  t.after(async () => { try { await engine.request('workspace.lock'); } catch { /* already locked */ } await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Canary Shop', passphrase, demo: false, pack: 'ecommerce' });
  return engine;
}

test('a plugin request carrying the planted value is stopped before its approval is spent; nothing is sent', async t => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seen: TransportRequest[] = [];
  const transport = async (request: TransportRequest): Promise<TransportResponse> => { seen.push(request); return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }; };
  const engine = await shop(t, { publisherKeys: [{ publisherId: 'acme', publicKey: rawPublicKey(publicKey) }], pluginSigningKey: { publisherId: 'acme', privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() }, pluginTransport: transport, pluginCredentials: () => null });
  const tools = { tools: [{ name: 'rate', inputSchema: { type: 'object', properties: { currency: { type: 'string', pattern: '^[A-Z]{3}$' } }, required: ['currency'], additionalProperties: false } },
    { name: 'submit', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 500 } }, required: ['text'] } }] };
  const wrapped = await engine.request('smallapps.pluginWrap', { kind: 'mcpServer', publisherId: 'acme', name: 'rates', toolsList: tools, version: '1.0.0', sign: true,
    code: { rate: { manifest: manifest('rate-echo'), moduleBase64: echo } },
    requests: { rate: [{ method: 'GET', site: 'api.rates.example', path: '/v1/rate/{currency}', body: 'none', maxResponseBytes: 2048, timeoutMs: 2000 }],
      submit: [{ method: 'POST', site: 'api.rates.example', path: '/v1/submit', body: 'arguments', maxResponseBytes: 2048, timeoutMs: 2000 }] } });
  const installed = await engine.request('smallapps.pluginInstall', { document: wrapped.document });
  await engine.request('plugins.enable', installed.code[0].enableWith);
  const policy = (await engine.request('trust.get', {})).policy;
  await engine.request('trust.update', { policy: { ...policy, send: 'shape' } });
  await engine.request('smallapps.pluginGrant', { id: installed.id, digest: installed.digest, sites: ['api.rates.example'] });
  await engine.request('trustx.plantCanary');
  const canary = (engine.vault!.read().extensions as any)[TRUST].tools.canary.value as string;
  const prepareApprove = async (text: string) => {
    const preview = await engine.request('smallapps.pluginPrepareRemote', { id: installed.id, tool: 'submit', arguments: { text } });
    const approved = await engine.request('smallapps.pluginApproveRemote', { previewId: preview.previewId, digest: preview.digest });
    return { preview, approved };
  };
  const remote = () => (engine.vault!.read().extensions as any)['models-ext'].plugins.remote;

  const leaking = await prepareApprove(`Please look up ${canary}`);
  await assert.rejects(engine.request('smallapps.pluginCallRemote', { previewId: leaking.preview.previewId, approvalId: leaking.approved.approvalId }), code('CANARY_BLOCKED'));
  assert.equal(seen.length, 0, 'Nothing was sent.');
  assert.equal(remote().approvals.find((a: any) => a.id === leaking.approved.approvalId).used, false, 'The approval is not spent.');
  assert.equal(remote().previews.find((p: any) => p.id === leaking.preview.previewId).status, 'prepared');
  assert.equal(remote().receipts.length, 0);
  assert.equal(blocked(engine.vault!.read()).callId, leaking.preview.previewId);
  // Asking again is stopped again: the approval never carries the protected value out.
  await assert.rejects(engine.request('smallapps.pluginCallRemote', { previewId: leaking.preview.previewId, approvalId: leaking.approved.approvalId }), code('CANARY_BLOCKED'));
  assert.equal(seen.length, 0);

  const clean = await prepareApprove('Please look up the rate card.');
  const sent = await engine.request('smallapps.pluginCallRemote', { previewId: clean.preview.previewId, approvalId: clean.approved.approvalId });
  assert.equal(seen.length, 1); assert.equal(seen[0].body, JSON.stringify({ text: 'Please look up the rate card.' })); assert.match(sent.receiptId, /^xremotereceipt_/);
});

// --- The learning upload ---------------------------------------------------------------------------
test('a learning batch whose exact body carries a protected value is settled as refused with CANARY_BLOCKED; nothing is sent', async () => {
  const store = new Store(); const learning = new LearningService(store);
  await new OntologyService(store).publish(owner, 'ecommerce');
  await new ImportService(store).commit(owner, { sourceId: 'demo-export', format: 'csv', content: demoCsv, recipe: structuredClone(demoRecipe), expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
  await learning.setSharing(owner, true);
  const requests: IntakeRequest[] = [];
  const transport = async (request: IntakeRequest) => { requests.push(request); return { status: 200, body: JSON.stringify({ reference: `batch-ref-${requests.length}`, accepted: 1, credits: 1 }) }; };
  const host: ModuleHost = { store, services: { learning }, demo: false, directory: '', options: { intake: { url: 'https://intake.example.com', transport } },
    call: async (method, payload) => { assert.equal(method, 'learning.sharing'); return learning.setSharing(owner, payload.enabled === true); } };
  const call = (method: string, payload: Record<string, unknown> = {}): Promise<any> => learningExtModule.methods[method].handler(owner, payload, host) as Promise<any>;
  // The contributor name goes in the body; here it is the very value the owner protected.
  await call('learningx.creditName', { publicName: 'Ravi Traders' });
  plant(store.state, 'Ravi Traders');
  let preview = await call('learningx.preview', {}), consent = await call('learningx.consent', { previewId: preview.id, digest: preview.digest });
  const refused = await call('learningx.submit', { consentId: consent.id });
  assert.deepEqual([refused.status, refused.refusal], ['refused', 'CANARY_BLOCKED']);
  assert.equal(requests.length, 0, 'Nothing was sent.');
  assert.equal(blocked(store.state).callId, refused.id);
  await assert.rejects(call('learningx.settle', { batchId: refused.id }), code('BATCH_SETTLED'), 'A blocked batch is never re-sent.');
  // Its decisions are free again: a clean batch goes.
  await call('learningx.creditName', { publicName: null });
  preview = await call('learningx.preview', {}); consent = await call('learningx.consent', { previewId: preview.id, digest: preview.digest });
  const sent = await call('learningx.submit', { consentId: consent.id });
  assert.equal(sent.status, 'sent'); assert.equal(requests.length, 1); assert.equal(requests[0].body!.includes('Ravi Traders'), false);
});

// --- The hosted allowance client -------------------------------------------------------------------
const ORIGIN = 'https://relay.chausar.test';
function reply(status: number, body: unknown): FetchReply {
  const raw = JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, headers: { get: (name: string) => name.toLowerCase() === 'content-length' ? String(Buffer.byteLength(raw)) : null }, text: async () => raw, arrayBuffer: async () => new TextEncoder().encode(raw).buffer as ArrayBuffer };
}
const request = (content: string) => ({ requestId: 'req_synthetic_allowance', route: 'anthropic' as const, model: 'claude-synthetic', messages: [{ role: 'user' as const, content }], maxOutputTokens: 200 });

test('the allowance route checks the exact JSON body before sending; a GSTIN, mail or phone from the books stops it', async () => {
  const store = new Store();
  store.state.facts.push({ id: 'fact_1', entityId: 'cust-1', sourceId: 'books', sourceRow: 1, kind: 'customer', validFrom: '2026-01-01', validTo: null, learnedAt: '2026-01-01T00:00:00.000Z', supersededAt: null,
    fields: { gstin: GSTIN, mail: MAIL, phone: '9876543210' } });
  store.state.extensions = { 'hosted-link': { ...initialHostedLinkState(), relayKey: newKey(),
    pairing: { accountId: 'account_synthetic', deviceId: 'device_synthetic', sessionToken: 's'.repeat(40), sessionExpiresAt: '2027-01-01T00:00:00.000Z', pairedAt: '2026-10-01T00:00:00.000Z', phoneMasked: '+91******3210' } } };
  const sent: { url: string; body: unknown }[] = [];
  const fetch = async (url: string, init: { body?: string | Uint8Array }) => {
    sent.push({ url, body: init.body });
    const parsed = JSON.parse(String(init.body));
    return reply(200, { requestId: parsed.requestId, text: 'Synthetic answer.', usage: { inputTokens: 3, outputTokens: 2 }, costPaise: '1', balancePaise: '100', route: parsed.route, model: parsed.model, pricingCheckedOn: '2026-10-01' });
  };
  const host: ModuleHost = { store, services: {}, demo: false, directory: '', options: { origin: ORIGIN, fetch }, call: async () => { throw new Error('not used'); } };
  const route = allowanceRouteFor(host);
  for (const leak of [GSTIN, MAIL, '+91 98765-43210']) await assert.rejects(route.complete(request(`Write to ${leak} about the bill.`)), code('CANARY_BLOCKED'), leak);
  assert.equal(sent.length, 0, 'Nothing was sent.');
  plant(store.state, 'CANARY-synthetic111111111111');
  await assert.rejects(route.complete({ ...request('Summarise.'), system: 'Keep CANARY-synthetic111111111111 private.' }), code('CANARY_BLOCKED'));
  assert.equal(blocked(store.state).callId, 'req_synthetic_allowance'); assert.equal(sent.length, 0);
  const done = await route.complete(request('Summarise the month in one line.'));
  assert.equal(sent.length, 1); assert.equal(sent[0].url, `${ORIGIN}/v1/allowance/complete`); assert.equal(done.receipt.requestBody, sent[0].body);
  // The guard sees exactly the bytes the client sends.
  const seenBodies: string[] = [];
  const direct = new AllowanceRouteClient({ client: new HostedClient({ origin: ORIGIN, fetch }), sessionToken: () => 's'.repeat(40), guard: body => { seenBodies.push(body); } });
  const exact = await direct.complete(request('Count the open invoices.'));
  assert.equal(seenBodies[0], exact.receipt.requestBody);
});
