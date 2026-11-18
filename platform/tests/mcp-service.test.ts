import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { inspectWasm } from '../runtime/plugins.ts';
import { MCPService, MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';

class Store implements StateStore {
  state: State = initialState('Extension test', true); queue = Promise.resolve(); read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> { const run = this.queue.then(async () => { const draft = structuredClone(this.state); const result = await change(draft); draft.revision += 1; this.state = draft; return result; }); this.queue = run.then(() => {}, () => {}); return run; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const section = (id: number, bytes: number[]) => [id, bytes.length, ...bytes];

test('unbounded and excessive WASM memories are rejected before a module is compiled', () => {
  const header = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  assert.throws(() => inspectWasm(Buffer.concat([header, Buffer.from(section(5, [1, 0, 1]))]), 16), { code: 'UNBOUNDED_MEMORY' });
  assert.throws(() => inspectWasm(Buffer.concat([header, Buffer.from(section(5, [1, 1, 1, 17]))]), 16), { code: 'MEMORY_LIMIT' });
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
