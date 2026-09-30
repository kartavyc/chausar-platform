import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { PluginService, inspectWasm } from '../runtime/plugins.ts';
import { LearningService, redactStructure } from '../runtime/learning.ts';
import { MCPService, MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';

class Store implements StateStore {
  state: State = initialState('Extension test', true); queue = Promise.resolve(); read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> { const run = this.queue.then(async () => { const draft = structuredClone(this.state); const result = await change(draft); draft.revision += 1; this.state = draft; return result; }); this.queue = run.then(() => {}, () => {}); return run; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const constant = '0061736d010000000105016000017f030201000707010372756e00000a06010400412a0b';
const base64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');
const manifest = { id: 'constant-answer', name: 'Constant number demo', version: '1.0.0', runtime: 'wasm', entrypoint: 'run', capabilities: [], sourceIds: [], maxMemoryPages: 16, timeoutMs: 1500 };
const section = (id: number, bytes: number[]) => [id, bytes.length, ...bytes];
const wasm = (sections: number[][]) => Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, ...sections.flat()]).toString('base64');
const string = (value: string) => [value.length, ...Buffer.from(value)];
function imported(module = 'chausar', name = 'read_count') { return wasm([section(1, [1, 0x60, 0, 1, 0x7f]), section(2, [1, ...string(module), ...string(name), 0, 0]), section(3, [1, 0]), section(7, [1, ...string('run'), 0, 1]), section(10, [1, 4, 0, 0x10, 0, 0x0b])]); }

test('actual dedicated WASM process runs an explicitly enabled pure plugin', async () => {
  const store = new Store(); const plugins = new PluginService(store); const installed = await plugins.install(owner, { manifest, moduleBase64: base64(constant) });
  assert.equal(installed.status, 'disabled'); assert.equal(Object.hasOwn(installed, 'moduleBase64'), false); await assert.rejects(plugins.run(owner, installed.id), { code: 'PLUGIN_DISABLED' });
  await plugins.enable(owner, installed.id, installed.digest); const output = await plugins.run(owner, installed.id); assert.equal(output.result, 42); assert.equal(output.memoryPages, 0); assert.equal(store.state.plugins[0].runs[0].outcome, 'success');
});
test('JavaScript runtimes, unknown permissions and undeclared imports are refused before execution', async () => {
  const plugins = new PluginService(new Store());
  for (const runtime of ['js', 'vm', 'vm2', 'javascript']) await assert.rejects(plugins.install(owner, { manifest: { ...manifest, runtime }, moduleBase64: base64(constant) }), { code: 'UNSUPPORTED_PLUGIN_RUNTIME' });
  await assert.rejects(plugins.install(owner, { manifest: { ...manifest, allowNetwork: true }, moduleBase64: base64(constant) }), { code: 'INVALID_MANIFEST' });
  await assert.rejects(plugins.install(owner, { manifest, moduleBase64: imported() }), { code: 'CAPABILITY_MISMATCH' });
  await assert.rejects(plugins.install(owner, { manifest: { ...manifest, capabilities: ['read_count'] }, moduleBase64: imported('wasi_snapshot_preview1') }), { code: 'UNSUPPORTED_IMPORT' });
});
test('host functions expose only a pre-authorized scoped scalar, never keys or network', async () => {
  const store = new Store(); const plugins = new PluginService(store, { read_count: { description: 'A published count', sourceIds: ['published'], value: () => 7 } });
  await assert.rejects(plugins.install(owner, { manifest: { ...manifest, capabilities: ['read_count'] }, moduleBase64: imported() }), { code: 'CAPABILITY_MISMATCH' });
  const installed = await plugins.install(owner, { manifest: { ...manifest, capabilities: ['read_count'], sourceIds: ['published'] }, moduleBase64: imported() }); await plugins.enable(owner, installed.id, installed.digest); assert.equal((await plugins.run(owner, installed.id)).result, 7);
  store.state.sourceRules.push({ sourceId: 'published', allow: false }); await assert.rejects(plugins.run(owner, installed.id), { code: 'SOURCE_REVOKED' });
});
test('unbounded and excessive WASM memories are rejected; infinite loops hit process deadline', async () => {
  const header = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  assert.throws(() => inspectWasm(Buffer.concat([header, Buffer.from(section(5, [1, 0, 1]))]), 16), { code: 'UNBOUNDED_MEMORY' });
  assert.throws(() => inspectWasm(Buffer.concat([header, Buffer.from(section(5, [1, 1, 1, 17]))]), 16), { code: 'MEMORY_LIMIT' });
  const infinite = wasm([section(1, [1, 0x60, 0, 1, 0x7f]), section(3, [1, 0]), section(7, [1, ...string('run'), 0, 0]), section(10, [1, 9, 0, 3, 0x40, 0x0c, 0, 0x0b, 0x41, 42, 0x0b])]);
  const store = new Store(); const plugins = new PluginService(store); const p = await plugins.install(owner, { manifest: { ...manifest, timeoutMs: 350 }, moduleBase64: infinite }); await plugins.enable(owner, p.id, p.digest); await assert.rejects(plugins.run(owner, p.id), /PLUGIN_TIMEOUT/); assert.equal(store.state.plugins[0].runs[0].outcome, 'refused');
});
test('plugin byte and permission edits invalidate exact approval', async () => {
  const store = new Store(); const plugins = new PluginService(store); const p = await plugins.install(owner, { manifest, moduleBase64: base64(constant) }); await plugins.enable(owner, p.id, p.digest); store.state.plugins[0].manifest.capabilities.push('steal_key'); await assert.rejects(plugins.run(owner, p.id), { code: 'PREVIEW_CHANGED' });
});
test('generated miniapps are data-only, require current published receipts and refuse scripts', () => {
  const store = new Store(); store.state.receipts.push({ id: 'receipt1', memberId: 'owner', epoch: 1, totalMinor: '4200', sourceIds: ['source1'], verified: true }); const plugins = new PluginService(store);
  const miniapp = plugins.miniappDescriptor(owner, { title: 'Dashboard', cards: [{ kind: 'metric', title: 'Billed', receiptId: 'receipt1' }] }); assert.equal(miniapp.executableCode, false); assert.equal(miniapp.iframe.sandbox, '');
  assert.throws(() => plugins.miniappDescriptor(owner, { title: 'Injected', cards: [{ kind: 'metric', title: 'Billed', receiptId: 'receipt1', script: 'fetch(secret)' } as any] }), { code: 'INVALID_MINIAPP' });
  store.state.sourceRules.push({ sourceId: 'source1', roles: ['accountant'] }); assert.throws(() => plugins.miniappDescriptor(owner, { title: 'Dashboard', cards: [{ kind: 'metric', title: 'Billed', receiptId: 'receipt1' }] }), { code: 'SOURCE_REVOKED' });
});

const localDecision = { kind: 'mapping' as const, choice: 'accepted' as const, reasonCode: 'type_match' as const, fields: [{ name: 'amount', type: 'decimal' as const }, { name: 'Kartavy personal email', type: 'string' as const }], reportShape: 'invoice' as const, details: { customerName: 'Private Customer', amount: 1234567, invoiceId: 'ACME-200' }, sourceIds: ['source1'] };
test('learning logs full decisions locally but sharing is a strict structure allowlist', async () => {
  const store = new Store(); const learning = new LearningService(store); const event = await learning.recordDecision(owner, localDecision); assert.equal((event.input.details as any).customerName, 'Private Customer'); const preview = await learning.preview(owner, [event.id]);
  const serialized = JSON.stringify(preview.payload); for (const secret of ['Private Customer', '1234567', 'ACME-200', 'Kartavy', 'source1']) assert.equal(serialized.includes(secret), false);
  assert.deepEqual(redactStructure(localDecision).fields, [{ name: 'amount', type: 'decimal' }]); await assert.rejects(learning.consent(owner, preview.id, preview.digest), { code: 'SHARING_DISABLED' });
});
test('consent is exact, immutable and exporter-disabled by default', async () => {
  const store = new Store(); const learning = new LearningService(store); const event = await learning.recordDecision(owner, localDecision); const preview = await learning.preview(owner, [event.id]); await learning.setSharing(owner, true);
  await assert.rejects(learning.consent(owner, preview.id, 'wrong'), { code: 'PREVIEW_CHANGED' }); const consent = await learning.consent(owner, preview.id, preview.digest); assert.equal(consent.immutable, true); assert.equal(learning.receipts(owner)[0].integrityValid, true);
  await assert.rejects(learning.share(owner, consent.id), { code: 'EXPORT_UNAVAILABLE' });
});
test('changed decisions and tainted or phone consent cannot authorize sharing', async () => {
  const store = new Store(); const learning = new LearningService(store); const event = await learning.recordDecision(owner, localDecision); const preview = await learning.preview(owner, [event.id]); await learning.setSharing(owner, true);
  await assert.rejects(learning.consent({ ...owner, sourceTainted: true }, preview.id, preview.digest), { code: 'APP_CONSENT_REQUIRED' }); await assert.rejects(learning.consent({ ...owner, channel: 'phone' }, preview.id, preview.digest), { code: 'APP_CONSENT_REQUIRED' });
  store.state.learning.find(e => e.id === event.id).input.choice = 'rejected'; await assert.rejects(learning.consent(owner, preview.id, preview.digest), { code: 'PREVIEW_CHANGED' });
});
test('outbound consent is attempted once and receipts record only the exact redacted payload', async () => {
  const store = new Store(); let sends = 0; const learning = new LearningService(store, { exporter: { receiver: 'test-fixture', send: async () => { sends += 1; return { reference: 'accepted-fixture' }; } } });
  const event = await learning.recordDecision(owner, localDecision); const preview = await learning.preview(owner, [event.id]); await learning.setSharing(owner, true); const consent = await learning.consent(owner, preview.id, preview.digest); const receipt = await learning.share(owner, consent.id); assert.equal(receipt.outcome, 'sent'); assert.equal(receipt.digest, preview.digest);
  await assert.rejects(learning.share(owner, consent.id), { code: 'EXPORT_ALREADY_ATTEMPTED' }); assert.equal(sends, 1); assert.ok(learning.receipts(owner).every(r => r.integrityValid)); assert.equal(JSON.stringify(receipt.payload).includes('Private Customer'), false);
});
test('sharing switch and current source policy gate an already consented export', async () => {
  const store = new Store(); let sends = 0; const learning = new LearningService(store, { exporter: { receiver: 'test', send: async () => { sends += 1; return { reference: 'never' }; } } });
  const event = await learning.recordDecision(owner, localDecision); const preview = await learning.preview(owner, [event.id]); await learning.setSharing(owner, true); const consent = await learning.consent(owner, preview.id, preview.digest); store.state.sourceRules.push({ sourceId: 'source1', allow: false }); await assert.rejects(learning.share(owner, consent.id), { code: 'SOURCE_REVOKED' }); assert.equal(sends, 0);
});

function mcpSetup() { const store = new Store(); let requested: Context | undefined; const receipt = { id: 'receipt-mcp', memberId: 'owner', epoch: 1, verified: true, totalMinor: '4200', sourceIds: ['source1'] }; store.state.receipts.push(receipt); const mcp = new MCPService(store, { calculations: [{ name: 'billed', description: 'Billed total in minor units', inputSchema: { type: 'object', additionalProperties: false, properties: { branch: { type: 'string' } } }, calculate: (_args, context) => { requested = context; return { value: '4200', receipt }; } }] }); return { store, mcp, requested: () => requested }; }
async function initialize(mcp: MCPService) { const response = await mcp.handle(owner, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'test', version: '1' } } }); assert.equal((response?.result as any).protocolVersion, MCP_PROTOCOL_VERSION); assert.equal(await mcp.handle(owner, { jsonrpc: '2.0', method: 'notifications/initialized' }), null); }
test('MCP requires initialized handshake and advertises exclusively read-only registered calculations', async () => {
  const f = mcpSetup(); assert.equal((await f.mcp.handle(owner, { jsonrpc: '2.0', id: 0, method: 'tools/list' }))?.error?.data?.code, 'NOT_INITIALIZED'); await initialize(f.mcp);
  const list = await f.mcp.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/list' }); const tools = (list!.result as any).tools; assert.equal(tools.length, 1); assert.equal(tools[0].annotations.readOnlyHint, true);
  const call = await f.mcp.handle(owner, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'billed', arguments: {} } }); assert.equal((call!.result as any).structuredContent.value, '4200'); assert.equal((call!.result as any).structuredContent.receipt.id, 'receipt-mcp'); assert.equal(f.requested()?.channel, 'mcp');
  assert.equal((await f.mcp.handle(owner, { jsonrpc: '2.0', id: 4, method: 'actions.execute' }))?.error?.code, -32601);
});
test('MCP refuses arbitrary expressions, unregistered tools and stale source grants', async () => {
  const f = mcpSetup(); await initialize(f.mcp);
  assert.equal((await f.mcp.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'eval', arguments: { code: 'process.env' } } }))?.error?.code, -32602);
  assert.equal((await f.mcp.handle(owner, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'billed', arguments: { expression: 'secrets' } } }))?.error?.code, -32602);
  f.store.state.sourceRules.push({ sourceId: 'source1', allow: false }); assert.equal((await f.mcp.handle(owner, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'billed', arguments: {} } }))?.error?.data?.code, 'SOURCE_REVOKED');
});
test('MCP prevents receipt scope replay and revocation rejects a previously initialized session', async () => {
  const f = mcpSetup(); await initialize(f.mcp); f.store.state.receipts[0].memberId = 'accountant'; const call = await f.mcp.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'billed', arguments: {} } }); assert.equal(call?.error?.data?.code, 'RECEIPT_FORBIDDEN');
  f.store.state.members[0].epoch += 1; assert.equal((await f.mcp.handle(owner, { jsonrpc: '2.0', id: 3, method: 'tools/list' }))?.error?.data?.code, 'ACCESS_REVOKED');
});
test('MCP never presents a numeric value absent from its engine receipt', async () => {
  const f = mcpSetup(); f.mcp.calculations.get('billed')!.calculate = () => ({ value: '999999', receipt: f.store.state.receipts[0] }); await initialize(f.mcp);
  const output = await f.mcp.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'billed', arguments: {} } }); assert.equal((output!.result as any).isError, true);
});
