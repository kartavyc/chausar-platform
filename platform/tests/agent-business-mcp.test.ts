// Chausar agent runtime: an owner-connected MCP server used for the business itself, with no client order
// (agent-runtime/business-mcp.ts, BusinessWorkScope). The same rules as inside a job hold: a tool on Chausar's checked
// read-only list runs, every other call needs the owner's approval of exactly that call, a changed tool asks again.
// No client data exists in this scope, and none can be put into a call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { code, owner, seedBlueprint, seedOrder, setup } from './venture-views-env.ts';
import { getAgentSettings, setAgentSettings } from '../runtime/venture/agent-runtime/settings-methods.ts';
import { BusinessCapability } from '../runtime/venture/agent-runtime/scope.ts';
import { openBusinessMcp } from '../runtime/venture/agent-runtime/business-mcp.ts';
import { argumentsDigest, type CheckedEntry } from '../runtime/venture/agent-runtime/mcp-policy.ts';
import { sunraServerReference } from '../runtime/venture/media/sunra.ts';
import type { ExternalTool } from '../runtime/venture/agent-runtime/external-client.ts';

const SAMPLE = { id: 'sample', name: 'Sample leads', transport: 'stdio' as const, command: process.execPath, args: [] as string[] };
const SEARCH: ExternalTool = { name: 'search_places', description: 'Search public business listings.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, annotations: { readOnlyHint: true } };

async function fixture(servers: unknown[] = [SAMPLE]) {
  const env = await setup();
  const blueprint = await seedBlueprint(env, { status: 'accepted' });
  const view = await getAgentSettings(env.deps, owner, {});
  view.settings.mcpServers = servers as typeof view.settings.mcpServers;
  await setAgentSettings(env.deps, owner, { settings: view.settings, approveMcpConfiguration: true });
  const abort = new AbortController();
  let active = true;
  const capability = new BusinessCapability({ workId: 'search1', ventureId: env.venture.id, purpose: 'find-customers', memberId: owner.memberId, epoch: owner.epoch }, owner, () => { if (!active) throw Object.assign(new Error('closed'), { code: 'JOB_CLOSED' }); });
  const state = { calls: [] as Record<string, unknown>[], tool: structuredClone(SEARCH), connects: [] as unknown[] };
  const connect = async (_server: unknown, _signal: AbortSignal, _token?: string, options?: unknown) => {
    state.connects.push(options);
    return { list: async () => [structuredClone(state.tool)], call: async (_name: string, args: Record<string, unknown>) => { state.calls.push(args); return { content: [{ type: 'text', text: '[]' }] }; }, close: async () => undefined };
  };
  return { ...env, blueprint, capability, abort, state, connect, stop: () => { active = false; } };
}

test('the business scope names no order, no client and no consent', async () => {
  const env = await fixture();
  assert.deepEqual(Object.keys(env.capability.scope).sort(), ['epoch', 'memberId', 'purpose', 'ventureId', 'workId']);
  assert.equal(env.capability.context.channel, 'desktop', 'the engine runs it for the owner inside the app; no AI holds it');
});

test('a call that is not on the checked read-only list runs only with the owner approval of exactly that call', async () => {
  const env = await fixture();
  const mcp = openBusinessMcp(env.deps, env.capability, { signal: env.abort.signal, connect: env.connect });
  assert.deepEqual(mcp.servers(), [{ id: 'sample', name: 'Sample leads' }]);
  const input = { query: 'cafes in Pune' };
  const look = await mcp.look({ serverId: 'sample', tool: 'search_places', arguments: input });
  assert.equal(look.approval, 'every-call', 'the server calling its own tool read-only grants nothing');
  assert.equal(look.argumentsDigest, argumentsDigest(input));
  assert.equal(look.description, 'Search public business listings.');
  assert.equal(env.state.calls.length, 0, 'looking lists the tools and calls nothing');
  await assert.rejects(mcp.prepare({ serverId: 'sample', tool: 'search_places', arguments: input, approved: null }), code('MCP_APPROVAL_REQUIRED'));
  await assert.rejects(mcp.prepare({ serverId: 'sample', tool: 'search_places', arguments: { query: 'cafes in Mumbai' }, approved: look }), code('MCP_ARGUMENTS_CHANGED'));
  await assert.rejects(mcp.prepare({ serverId: 'sample', tool: 'no_such_tool', arguments: input, approved: look }), code('MCP_TOOL_CHANGED'));
  await assert.rejects(mcp.prepare({ serverId: 'elsewhere', tool: 'search_places', arguments: input, approved: look }), code('MCP_SERVER_NOT_FOUND'));
  const ready = await mcp.prepare({ serverId: 'sample', tool: 'search_places', arguments: input, approved: look });
  assert.equal(ready.approval, 'owner-approved');
  assert.equal(env.state.calls.length, 0, 'preparing checks everything and still calls nothing');
  assert.deepEqual(await ready.send(), { content: [{ type: 'text', text: '[]' }] });
  assert.deepEqual(env.state.calls, [input]);
  // The tool changed its description after the owner approved: the approval no longer covers it.
  env.state.tool.description = 'Search listings and send each one a message.';
  await assert.rejects(mcp.prepare({ serverId: 'sample', tool: 'search_places', arguments: input, approved: look }), code('MCP_TOOL_CHANGED'));
  assert.equal(env.state.calls.length, 1);
  await mcp.close();
});

test('a tool on the checked read-only list runs with no approval; a server question has nowhere to go and is never asked', async () => {
  const env = await fixture();
  const checkedList: CheckedEntry[] = [{ server: { stdio: { command: SAMPLE.command, args: [] } }, checkedOn: '2026-11-14', tools: [{ tool: 'search_places', description: 'Search public business listings.', properties: ['query'] }] }];
  const mcp = openBusinessMcp(env.deps, env.capability, { signal: env.abort.signal, connect: env.connect, checkedList });
  assert.equal((await mcp.look({ serverId: 'sample', tool: 'search_places', arguments: { query: 'cafes' } })).approval, 'checked-read-only');
  const ready = await mcp.prepare({ serverId: 'sample', tool: 'search_places', arguments: { query: 'cafes' }, approved: null });
  assert.equal(ready.approval, 'checked-read-only');
  await ready.send();
  assert.equal(env.state.calls.length, 1);
  assert.deepEqual(env.state.connects, [{}], 'connected with no way for the server to ask the owner anything');
  assert.deepEqual(await mcp.tools('sample'), [{ name: 'search_places', description: 'Search public business listings.', approval: 'checked-read-only' }]);
  await mcp.close();
});

test('no client data exists in the business scope: inputs that name a client are refused before anything connects', async () => {
  const env = await fixture();
  const { client } = await seedOrder(env, env.blueprint);
  const mcp = openBusinessMcp(env.deps, env.capability, { signal: env.abort.signal, connect: env.connect });
  await assert.rejects(mcp.look({ serverId: 'sample', tool: 'search_places', arguments: { query: `businesses like ${client.name.toUpperCase()}` } }), code('CLIENT_AI_CONSENT_REQUIRED'));
  await assert.rejects(mcp.prepare({ serverId: 'sample', tool: 'search_places', arguments: { query: 'x', notes: { like: [client.name] } }, approved: null }), code('CLIENT_AI_CONSENT_REQUIRED'));
  assert.equal(env.state.connects.length, 0);
  assert.equal(env.state.calls.length, 0);
  // The handle has no way to read a client, an order or a file: only servers, tools, look, prepare and close.
  assert.deepEqual(Object.keys(mcp).sort(), ['close', 'look', 'prepare', 'servers', 'tools']);
  await mcp.close();
});

test('a server whose rules need a client order is refused here; a closed scope and changed settings end the use', async () => {
  const sunra = sunraServerReference('/usr/local/bin/npx');
  const env = await fixture([SAMPLE, sunra]);
  const mcp = openBusinessMcp(env.deps, env.capability, { signal: env.abort.signal, connect: env.connect });
  await assert.rejects(mcp.look({ serverId: 'sunra', tool: 'submit', arguments: {} }), code('MCP_ORDER_ONLY'));
  await assert.rejects(mcp.tools('sunra'), code('MCP_ORDER_ONLY'));
  assert.equal(env.state.connects.length, 0);
  const look = await mcp.look({ serverId: 'sample', tool: 'search_places', arguments: { query: 'cafes' } });
  const settings = (await getAgentSettings(env.deps, owner, {})).settings;
  settings.mcpServers = [];
  await setAgentSettings(env.deps, owner, { settings, approveMcpConfiguration: true });
  await assert.rejects(mcp.prepare({ serverId: 'sample', tool: 'search_places', arguments: { query: 'cafes' }, approved: look }), code('MCP_CONFIGURATION_CHANGED'));
  env.stop();
  const again = openBusinessMcp(env.deps, env.capability, { signal: env.abort.signal, connect: env.connect });
  assert.throws(() => again.servers(), code('JOB_CLOSED'));
  assert.equal(env.state.calls.length, 0);
});
