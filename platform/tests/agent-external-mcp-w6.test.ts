import test from 'node:test';
import assert from 'node:assert/strict';
import { owner, seedBlueprint, seedOrder, seedRun, setup } from './venture-views-env.ts';
import { getAgentSettings, setAgentSettings } from '../runtime/venture/agent-runtime/settings-methods.ts';
import { createExternalMcpTools } from '../runtime/venture/agent-runtime/external-mcp.ts';
import { JobCapability } from '../runtime/venture/agent-runtime/scope.ts';
import { fileURLToPath } from 'node:url';
import { agreeClientAiConsent, getClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { decideAgentApproval } from '../runtime/venture/agent-runtime/approvals.ts';
import { findRecord } from '../runtime/venture/records.ts';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { connectExternalClient } from '../runtime/venture/agent-runtime/external-client.ts';
import { setMcpCredential } from '../runtime/venture/agent-runtime/external-credentials.ts';

async function fixture() {
  const env = await setup(); await seedBlueprint(env);
  const view = await getAgentSettings(env.deps, owner, {});
  view.settings.mcpServers = [{ id: 'sample', name: 'Sample', transport: 'stdio', command: process.execPath, args: [] }];
  await setAgentSettings(env.deps, owner, { settings: view.settings, approveMcpConfiguration: true });
  const venture = env.store.read().conversations.find(row => row.kind === 'venture-record');
  const abort = new AbortController(); let active = true;
  const capability = new JobCapability({ jobId: 'job1', runId: 'run1', ventureId: venture.id, orderId: 'order1', clientId: 'client1', agentId: 'delivery', memberId: owner.memberId, epoch: owner.epoch, consentId: 'consent1', consentRevision: 1, generation: 1 }, owner, () => { if (!active) throw Object.assign(new Error('closed'), { code: 'JOB_CLOSED' }); });
  return { ...env, abort, capability, close: () => { active = false; abort.abort(); } };
}
test('external tools are discoverable but every call waits for exact approval even with a read-only annotation', async () => {
  const env = await fixture(); let calls = 0, approval: any;
  const description = { name: 'sample_read', description: 'Read sample', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } };
  const proxy = createExternalMcpTools(env.deps, owner, env.capability, { signal: env.abort.signal, guard: () => env.capability.assert(),
    connect: async () => ({ list: async () => [description], call: async (_name, args) => { calls++; return { content: [{ type: 'text', text: args.text }] }; }, close: async () => undefined }),
    approve: async request => { approval = request; assert.equal(calls, 0); return true; } });
  const listing: any = await proxy.tools[0]!.call({ serverId: 'sample', query: '' }, owner);
  assert.equal(calls, 0); assert.equal(listing.tools.length, 1);
  const result: any = await proxy.tools[1]!.call({ serverId: 'sample', tool: 'sample_read', fingerprint: listing.tools[0].fingerprint, arguments: { text: 'Harmless sample' } }, owner);
  assert.equal(calls, 1); assert.equal(approval.kind, 'external-tool');
  assert.deepEqual(approval.arguments.input, { text: 'Harmless sample' });
  assert.equal(approval.arguments.description, description.description);
  assert.equal(result.untrusted, true); await proxy.close();
});
test('changed descriptions, configuration and revoked scope cannot use an earlier approval', async () => {
  const env = await fixture(); let calls = 0, description = 'Before';
  const proxy = createExternalMcpTools(env.deps, owner, env.capability, { signal: env.abort.signal, guard: () => env.capability.assert(),
    connect: async () => ({ list: async () => [{ name: 'sample', description, inputSchema: { type: 'object' } }], call: async () => { calls++; return {}; }, close: async () => undefined }),
    approve: async () => { description = 'Changed'; return true; } });
  const listing: any = await proxy.tools[0]!.call({ serverId: 'sample', query: '' }, owner);
  await assert.rejects(async () => await proxy.tools[1]!.call({ serverId: 'sample', tool: 'sample', fingerprint: listing.tools[0].fingerprint, arguments: {} }, owner), { code: 'MCP_TOOL_CHANGED' });
  assert.equal(calls, 0);
  const settings = (await getAgentSettings(env.deps, owner, {})).settings; settings.mcpServers = [];
  await setAgentSettings(env.deps, owner, { settings, approveMcpConfiguration: true });
  await assert.rejects(async () => await proxy.tools[0]!.call({ serverId: 'sample', query: '' }, owner), { code: 'MCP_CONFIGURATION_CHANGED' });
  env.close(); await proxy.close(); assert.equal(calls, 0);
});

test('installed MCP SDK runs a real harmless local stdio sample behind exact approval', async t => {
  const env = await fixture();
  const settings = (await getAgentSettings(env.deps, owner, {})).settings;
  settings.mcpServers = [{ id: 'sample', name: 'Harmless local sample', transport: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/mcp-harmless-w6.mjs', import.meta.url))] }];
  await setAgentSettings(env.deps, owner, { settings, approveMcpConfiguration: true });
  let approvals = 0;
  const proxy = createExternalMcpTools(env.deps, owner, env.capability, { signal: env.abort.signal, guard: () => env.capability.assert(), approve: async request => { approvals++; assert.deepEqual(request.arguments.input, { text: 'Harmless local sample' }); return true; } });
  t.after(() => proxy.close());
  const listing: any = await proxy.tools[0]!.call({ serverId: 'sample', query: 'echo' }, owner);
  assert.equal(approvals, 0); assert.equal(listing.tools[0].name, 'echo_sample');
  const result: any = await proxy.tools[1]!.call({ serverId: 'sample', tool: 'echo_sample', fingerprint: listing.tools[0].fingerprint, arguments: { text: 'Harmless local sample' } }, owner);
  assert.equal(approvals, 1); assert.equal(result.result.content[0].text, 'Harmless local sample');
});

test('production approval persistence holds the external call and owner decline never dispatches', async t => {
  const env = await setup(); const { client, order } = await seedOrder(env, await seedBlueprint(env)); const run = await seedRun(env, order, {});
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  const consent = await getClientAiConsent(env.deps, owner, { clientId: client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: client.id, disclosureDigest: consent.disclosureDigest });
  const settings = (await getAgentSettings(env.deps, owner, {})).settings;
  settings.mcpServers = [{ id: 'sample', name: 'Sample', transport: 'stdio', command: process.execPath, args: [] }];
  await setAgentSettings(env.deps, owner, { settings, approveMcpConfiguration: true });
  const abort = new AbortController(), job = await createNativeJob(env.deps, owner, run.id, { agentId: 'delivery', sections: ['Reply'], check: () => undefined, signal: abort.signal });
  t.after(() => job.close()); let called = 0;
  const proxy = createExternalMcpTools(env.deps, owner, job.capability, { signal: abort.signal, guard: state => { job.assertState(state); },
    connect: async () => ({ list: async () => [{ name: 'echo', description: 'Synthetic tool', inputSchema: { type: 'object' } }], call: async () => { called++; return {}; }, close: async () => undefined }) });
  t.after(() => proxy.close());
  const listing: any = await proxy.tools[0]!.call({ serverId: 'sample', query: '' }, owner);
  const call = proxy.tools[1]!.call({ serverId: 'sample', tool: 'echo', fingerprint: listing.tools[0].fingerprint, arguments: { sample: 'no effect' } }, owner);
  const rejected = assert.rejects(async () => await call, { code: 'MCP_CALL_DECLINED' });
  for (let n = 0; n < 100 && !findRecord(env.store.read(), 'venture-delivery-run', run.id)!.agentJob!.pendingApproval; n++) await new Promise(resolve => setTimeout(resolve, 5));
  const pending = findRecord(env.store.read(), 'venture-delivery-run', run.id)!.agentJob!.pendingApproval!;
  assert.ok(pending); assert.equal(called, 0);
  assert.deepEqual(pending.request.arguments.input, { sample: 'no effect' });
  await decideAgentApproval(env.deps, owner, { runId: run.id, digest: pending.digest, decision: 'deny' });
  await rejected; assert.equal(called, 0);
});

test('installed SDK connects to a real local Streamable HTTP server without redirects or outside traffic', async t => {
  const connections = new Set<Server>();
  const http = createServer(async (request, response) => {
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    const server = new Server({ name: 'chausar-local-http-sample', version: '1.0.0' }, { capabilities: { tools: {} } });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo_sample', description: 'Synthetic local sample only', inputSchema: { type: 'object' } }] }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'Harmless HTTP sample' }] }));
    connections.add(server); response.on('close', () => { void server.close(); connections.delete(server); });
    await server.connect(transport); await transport.handleRequest(request, response);
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const server of connections) await server.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); });
  const address = http.address(); assert.ok(address && typeof address === 'object');
  const abort = new AbortController();
  const client = await connectExternalClient({ id: 'local', name: 'Local sample', transport: 'http', url: `http://127.0.0.1:${address.port}/mcp` }, abort.signal);
  t.after(() => client.close());
  assert.equal((await client.list(abort.signal))[0]!.name, 'echo_sample');
  const result: any = await client.call('echo_sample', {}, abort.signal);
  assert.equal(result.content[0].text, 'Harmless HTTP sample');
});

test('external server replies cannot leak protected tokens through object keys', async () => {
  const env = await fixture(), token = ['synthetic', 'private', 'token'].join('-');
  let saved: string | null = null;
  env.deps.credentials = { get: async () => saved, set: async (_workspace, _name, value) => { saved = value; }, delete: async () => { saved = null; } };
  await setMcpCredential(env.deps, owner, { serverId: 'sample', token });
  const proxy = createExternalMcpTools(env.deps, owner, env.capability, { signal: env.abort.signal, guard: () => env.capability.assert(), approve: async () => true,
    connect: async () => ({ list: async () => [{ name: 'echo', inputSchema: { type: 'object' } }], call: async () => ({ [token]: { [token]: token } }), close: async () => undefined }) });
  const listing: any = await proxy.tools[0]!.call({ serverId: 'sample', query: '' }, owner);
  const result = await proxy.tools[1]!.call({ serverId: 'sample', tool: 'echo', fingerprint: listing.tools[0].fingerprint, arguments: {} }, owner);
  assert.ok(!JSON.stringify(result).includes(token)); await proxy.close();
});
