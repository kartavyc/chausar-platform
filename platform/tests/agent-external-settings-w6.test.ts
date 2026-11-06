import test from 'node:test';
import assert from 'node:assert/strict';
import { owner, seedBlueprint, setup } from './venture-views-env.ts';
import { getAgentSettings, setAgentSettings } from '../runtime/venture/agent-runtime/settings-methods.ts';
import { defaultAiSettings, validateAiSettings } from '../runtime/venture/agent-runtime/settings.ts';
import { setMcpCredential } from '../runtime/venture/agent-runtime/external-credentials.ts';

const server = { id: 'sample', name: 'Sample tools', transport: 'stdio', command: process.execPath, args: ['sample.mjs'] };
test('external server configuration requires exact owner standing approval and never launches while saving', async () => {
  const env = await setup(); await seedBlueprint(env);
  const initial = await getAgentSettings(env.deps, owner, {});
  const settings = { ...initial.settings, mcpServers: [server] };
  await assert.rejects(setAgentSettings(env.deps, owner, { settings }), { code: 'MCP_CONFIGURATION_APPROVAL_REQUIRED' });
  const saved = await setAgentSettings(env.deps, owner, { settings, approveMcpConfiguration: true });
  assert.deepEqual(saved.settings.mcpServers, [server]);
  assert.ok(env.store.read().conversations.some(row => row.kind === 'venture-decision' && row.reason.includes('external tool configuration')));
  await assert.rejects(setAgentSettings(env.deps, { ...owner, channel: 'mcp' }, { settings, approveMcpConfiguration: true }), { code: 'APP_APPROVAL_REQUIRED' });
  await assert.rejects(setAgentSettings(env.deps, owner, { settings: { ...settings, mcpServers: [{ ...server, args: ['different.mjs'] }] } }), { code: 'MCP_CONFIGURATION_APPROVAL_REQUIRED' });
  assert.deepEqual((await getAgentSettings(env.deps, owner, {})).settings, saved.settings);
});
test('MCP settings contain only explicit endpoints and arguments, never inline credentials or shell text', () => {
  const base = defaultAiSettings();
  for (const value of [
    { ...server, command: 'node server.mjs' }, { ...server, env: { TOKEN: 'secret' } },
    { ...server, args: ['--api-key', 'not-a-real-secret'] },
    { id: 'remote', name: 'Remote', transport: 'http', url: 'https://name:password@example.com/mcp' },
    { id: 'remote', name: 'Remote', transport: 'http', url: 'https://example.com/mcp?token=anything' },
    { id: 'remote', name: 'Remote', transport: 'http', url: 'http://example.com/mcp' },
  ]) assert.throws(() => validateAiSettings({ ...base, mcpServers: [value] }), { code: 'INVALID_VENTURE_REQUEST' });
  assert.equal(validateAiSettings({ ...base, mcpServers: [{ id: 'local', name: 'Local', transport: 'http', url: 'http://127.0.0.1:1234/mcp' }] }).mcpServers.length, 1);
});

test('external tokens remain in the host shelf and replacement invalidates the old server configuration', async () => {
  const env = await setup(); await seedBlueprint(env); const saved = new Map<string, string>();
  env.deps.credentials = { get: async (_workspace, key) => saved.get(key) ?? null, set: async (_workspace, key, value) => { saved.set(key, value); }, delete: async (_workspace, key) => { saved.delete(key); } };
  const settings = { ...defaultAiSettings(), mcpServers: [server] };
  await setAgentSettings(env.deps, owner, { settings, approveMcpConfiguration: true });
  const token = ['synthetic', 'external', 'credential'].join('-');
  await setMcpCredential(env.deps, owner, { serverId: 'sample', token });
  assert.equal(saved.get(`mcp:${env.venture.id}:sample`), token);
  assert.ok(!JSON.stringify(env.store.read()).includes(token));
  const before = (await getAgentSettings(env.deps, owner, {})).settings.mcpServers[0]!;
  await setMcpCredential(env.deps, owner, { serverId: 'sample', token: token + '-changed' });
  const after = (await getAgentSettings(env.deps, owner, {})).settings.mcpServers[0]!;
  assert.notDeepEqual(after, before);
  await assert.rejects(setMcpCredential(env.deps, { ...owner, channel: 'mcp' }, { serverId: 'sample', token }), { code: 'APP_APPROVAL_REQUIRED' });
  await setMcpCredential(env.deps, owner, { serverId: 'sample', token: null });
  assert.equal(saved.size, 0);
});

test('same server identifiers in different businesses never share a protected token reference', async () => {
  const first = await setup(), second = await setup(); await seedBlueprint(first); await seedBlueprint(second);
  await second.store.update(state => { state.workspace.id = first.store.read().workspace.id; });
  const values = new Map<string, string>();
  const credentials = { get: async (workspace: string, name: string) => values.get(`${workspace}:${name}`) ?? null,
    set: async (workspace: string, name: string, value: string) => { values.set(`${workspace}:${name}`, value); }, delete: async (workspace: string, name: string) => { values.delete(`${workspace}:${name}`); } };
  first.deps.credentials = credentials; second.deps.credentials = credentials;
  for (const env of [first, second]) await setAgentSettings(env.deps, owner, { settings: { ...defaultAiSettings(), mcpServers: [server] }, approveMcpConfiguration: true });
  await setMcpCredential(first.deps, owner, { serverId: 'sample', token: 'first-business-sample' });
  await setMcpCredential(second.deps, owner, { serverId: 'sample', token: 'second-business-sample' });
  const a = (await getAgentSettings(first.deps, owner, {})).settings.mcpServers[0]!, b = (await getAgentSettings(second.deps, owner, {})).settings.mcpServers[0]!;
  assert.notEqual(a.credentialRef, b.credentialRef); assert.equal(values.size, 2);
  await assert.rejects(setAgentSettings(first.deps, owner, { settings: { ...defaultAiSettings(), mcpServers: [b] }, approveMcpConfiguration: true }), { code: 'INVALID_VENTURE_REQUEST' });
});
