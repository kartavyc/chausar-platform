// A4 fix round (founder, 4 Nov): a business made from the Start gallery reuses the AI set up in another business on this
// computer: the Codex or Claude Code connection and the agents' models only, from the newest setup. The new business
// keeps its own folder, vault and memory: no file, client, note, call or consent of the other business appears in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { engineFor, PASSPHRASE } from './fixtures/venture/compose-unit/harness.ts';
import { aiSetupOf, readAiSetup, rememberAiSetup, type AiSetupNote } from '../runtime/venture/models/ai-setup.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { defaultAiSettings } from '../runtime/venture/agent-runtime/settings.ts';
import { owner } from './venture-judge-helpers.ts';
import { setup } from './venture-views-env.ts';

const IDEA = 'A weekend photography studio in Pune for birthday parties and shop product photos.';

test('the setup kept from a business holds its Codex or Claude Code connection and models, and nothing of its records', async () => {
  const env = await setup();
  const settings = defaultAiSettings();
  settings.codex.main.model = 'gpt-6.1-terra';
  settings.mcpServers = [];
  await ventureAction(env.deps, owner, 'admin', 'seed.ai', tx => {
    tx.put({ ...tx.base('venture-model-connection'), presetId: 'codex-cli', routeKind: 'codex-cli', model: 'gpt-6-luna', endpoint: null, tiers: ['fast', 'main'], consentDigest: 'c'.repeat(64), consentedAt: tx.now, monthlyCapMicros: '5000000', status: 'connected' } as never);
    tx.put({ ...tx.base('venture-model-connection'), presetId: 'anthropic-haiku-5-5', routeKind: 'anthropic-messages', model: 'claude-haiku-5-5', endpoint: null, tiers: ['fast'], consentDigest: 'd'.repeat(64), consentedAt: tx.now, monthlyCapMicros: '5000000', status: 'connected' } as never);
    tx.put({ ...tx.base('venture-client'), name: 'Priya Sample', email: 'priya@example.com' } as never);
    tx.touch({ aiSettings: settings } as never);
  });
  let written: AiSetupNote | null = null;
  env.deps.aiSetup = { read: async () => written, write: async note => { written = note; } };
  await rememberAiSetup(env.deps);
  assert.ok(written);
  const note = written as AiSetupNote;
  assert.deepEqual(note.connections, [{ presetId: 'codex-cli', routeKind: 'codex-cli', model: 'gpt-6-luna', tiers: ['fast', 'main'] }], 'a key preset never carries over');
  assert.equal(note.models.codex.main.model, 'gpt-6.1-terra');
  assert.equal(note.from.name, 'Ledger Cafe Books');
  assert.equal(JSON.stringify(note).includes('Priya'), false);
  assert.deepEqual(Object.keys(note).sort(), ['at', 'connections', 'format', 'from', 'models']);
  assert.deepEqual(readAiSetup(JSON.parse(JSON.stringify(note))), note);
  for (const bad of [{ ...note, extra: 1 }, { ...note, connections: [{ ...note.connections[0], presetId: 'anthropic-haiku-5-5', routeKind: 'anthropic-messages' }] }, { ...note, models: { ...note.models, codex: { ...note.models.codex, main: { model: 'x y', effort: 'high' } } } }]) {
    assert.equal(readAiSetup(bad), null);
  }
  assert.equal(aiSetupOf({ ...env.deps, store: (await setup()).store }), null, 'no Codex or Claude Code: nothing to keep');
});

test('a business made from the gallery reuses the newest setup, says so, and holds nothing else of the other business', async t => {
  const { engine, directory } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Pune Frames', passphrase: PASSPHRASE, pack: 'services', folder: null });
  const first = await engine.request('workspace.status', {}) as { workspace: { id: string } };
  await engine.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Pune Frames' });
  await engine.request('venture.client.add', { name: 'Priya Sample', email: 'priya@example.com', countryCode: 'IN' });
  // As Pune Frames wrote it when the owner connected Codex there (models/ai-setup.ts rememberAiSetup).
  const models = defaultAiSettings();
  const note: AiSetupNote = {
    format: 'chausar.ai-setup.v1', from: { workspaceId: first.workspace.id, name: 'Pune Frames' }, at: new Date().toISOString(),
    connections: [{ presetId: 'codex-cli', routeKind: 'codex-cli', model: 'gpt-6-luna', tiers: ['fast', 'main'] }],
    models: { codex: { quick: { model: 'gpt-6-luna', effort: 'high' }, main: { model: 'gpt-6.1-terra', effort: 'max' } }, claude: { quick: models.claude.quick, main: models.claude.main } },
  };
  await mkdir(join(directory, 'custody'), { recursive: true });
  await writeFile(join(directory, 'custody', 'ai-setup.json'), JSON.stringify(note));
  const before = new Set(await readdir(directory));
  await engine.request('workspace.lock', {});

  await engine.request('workspace.create', { name: 'Gallery Studio', passphrase: PASSPHRASE, pack: 'services', folder: null });
  await engine.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Gallery Studio', reuseAi: true });
  const status = await engine.request('venture.models.status', {}) as { tiers: Record<'fast' | 'main', { presetId: string; model: string | null }> };
  assert.deepEqual([status.tiers.fast.presetId, status.tiers.main.presetId], ['codex-cli', 'codex-cli']);
  const settings = await engine.request('venture.agentSettings.get', {}) as { settings: { codex: { main: { model: string; effort: string } }; mcpServers: unknown[] } };
  assert.deepEqual(settings.settings.codex.main, { model: 'gpt-6.1-terra', effort: 'max' });
  assert.deepEqual(settings.settings.mcpServers, []);
  const decisions = await engine.request('venture.decisions.list', {}) as { decisions: { line: string }[] };
  assert.ok(decisions.decisions.some(item => item.line === 'You decided: Uses the same AI as Pune Frames.'), JSON.stringify(decisions.decisions.map(item => item.line)));
  // Nothing else of Pune Frames: no client, no call, no chat consent; its folder is untouched and nothing was copied.
  assert.deepEqual(await engine.request('venture.client.list', {}), []);
  const calls = await engine.request('venture.ai.calls', {}).catch(() => null) as { calls?: unknown[] } | null;
  assert.ok(!calls?.calls?.length);
  const threads = await engine.request('venture.chief.threads', {}) as { consent: { state: string } };
  assert.notEqual(threads.consent.state, 'given');
  const added = (await readdir(directory)).filter(name => !before.has(name));
  assert.equal(added.length, 1, `only the new business's own folder: ${added}`);
  const files = await readdir(join(directory, added[0]!), { recursive: true });
  for (const file of files) assert.equal(String(file).toLowerCase().includes('pune'), false, String(file));
  assert.equal((await readFile(join(directory, 'custody', 'ai-setup.json'), 'utf8')).includes('Priya'), false);
});

test('without reuseAi, or with no setup kept, a new business starts with no AI', async t => {
  const { engine } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Plain Studio', passphrase: PASSPHRASE, pack: 'services', folder: null });
  await engine.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Plain Studio', reuseAi: true });
  const status = await engine.request('venture.models.status', {}) as { tiers: Record<'fast' | 'main', { presetId: string }> };
  assert.deepEqual([status.tiers.fast.presetId, status.tiers.main.presetId], ['built-in-templates', 'built-in-templates']);
});
