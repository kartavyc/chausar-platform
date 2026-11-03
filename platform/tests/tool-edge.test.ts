// A2: the two slips models make at the tool edge are accepted, and nothing else is coerced: null for a field that was
// left out (when the field may be left out and does not take null), and an array sent as JSON text (when the field is an
// array). Required fields, numbers, strings, nested values and every other shape are still refused as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MCPService, MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';
import { acceptModelSlips } from '../runtime/tool-edge.ts';
import { VentureTestStore } from './venture-test-store.ts';
import type { Context } from '../runtime/contracts.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const schema = {
  type: 'object', additionalProperties: false, required: ['title'],
  properties: {
    title: { type: 'string', maxLength: 80 }, note: { type: 'string', maxLength: 200 }, tags: { type: 'array', maxItems: 5 },
    count: { type: 'integer' }, maybe: { type: ['string', 'null'] }, inner: { type: 'object' },
  },
};

test('null for an optional field is a field left out; an array sent as text is the array', () => {
  assert.deepEqual(acceptModelSlips(schema, { title: 'Draft', note: null }), { title: 'Draft' });
  assert.deepEqual(acceptModelSlips(schema, { title: 'Draft', tags: '["a","b"]' }), { title: 'Draft', tags: ['a', 'b'] });
  assert.deepEqual(acceptModelSlips(schema, { title: 'Draft', tags: ' [ ] ' }), { title: 'Draft', tags: [] });
});

test('nothing else is coerced', () => {
  const same = (value: Record<string, unknown>) => assert.deepEqual(acceptModelSlips(schema, value), value);
  same({ title: null });                              // a required field stays null, and is refused
  same({ title: 'Draft', maybe: null });              // a field that takes null keeps it
  same({ title: 'Draft', count: '3' });               // a number as text stays text
  same({ title: '["a"]' });                           // a string field holding brackets stays a string
  same({ title: 'Draft', tags: 'a, b' });             // text that is not a JSON array stays text
  same({ title: 'Draft', tags: '{"a":1}' });          // a JSON object is not an array
  same({ title: 'Draft', inner: { tags: '["a"]', note: null } }); // nested values are not touched
  same({ title: 'Draft', extra: null });              // an unknown field is left for the check to refuse
  assert.equal(acceptModelSlips(schema, 'not an object'), 'not an object');
  assert.deepEqual(acceptModelSlips(schema, ['x']), ['x']);
});

test('through a job tool: the two slips pass, anything else is still refused', async () => {
  const seen: unknown[] = [];
  const mcp = new MCPService(new VentureTestStore(), { calculations: [], tools: [{ name: 'save_note', description: 'Save a note.', inputSchema: schema, readOnly: false, call: async args => { seen.push(args); return { ok: true }; } }] });
  await mcp.handle(owner, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'scripted-agent', version: '1' } } });
  await mcp.handle(owner, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = (args: Record<string, unknown>) => mcp.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'save_note', arguments: args } });
  assert.equal((await call({ title: 'Draft', note: null, tags: '["a"]' }))?.error, undefined);
  assert.deepEqual(seen, [{ tags: ['a'], title: 'Draft' }]);
  assert.equal((await call({ title: null }))?.error?.data?.code, 'INVALID_ARGUMENTS');
  assert.equal((await call({ title: 'Draft', count: '3' }))?.error?.data?.code, 'INVALID_ARGUMENTS');
  assert.equal((await call({ title: 'Draft', tags: 'a, b' }))?.error?.data?.code, 'INVALID_ARGUMENTS');
});
