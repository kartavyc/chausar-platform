// A4 fix round (founder, 4 Nov): a business made from the Start gallery reuses the AI set up in another business on this
// computer: the Codex or Claude Code connection and the agents' models only, from the newest setup. The new business
// keeps its own folder, vault and memory: no file, client, note, call or consent of the other business appears in it.
// A4 review round 2 (H2, M2): the reuse passes every gate venture.models.connect runs, with the agreement the owner gave
// there and when it was given; the kept setup goes when its business disconnects that AI or is deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { engineFor, PASSPHRASE } from './fixtures/venture/compose-unit/harness.ts';
import { aiSetupOf, readAiSetup, rememberAiSetup, type AiSetupNote } from '../runtime/venture/models/ai-setup.ts';
import { presetSpec } from '../runtime/venture/models/presets.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as core } from '../runtime/venture/core/index.ts';
import { handlers as models } from '../runtime/venture/models/index.ts';
import { ChausarError } from '../runtime/contracts.ts';
import { defaultAiSettings } from '../runtime/venture/agent-runtime/settings.ts';
import { owner } from './venture-judge-helpers.ts';
import { setup } from './venture-views-env.ts';

const IDEA = 'A weekend photography studio in Pune for birthday parties and shop product photos.';
const AGREED = '2026-10-01T09:00:00.000Z';
type Preset = 'codex-cli' | 'claude-code-cli';
type Gates = { availability?: 'unverified' | 'needs-setup' | 'unavailable'; cli?: 'ok' | 'signed-out'; terms?: 'accepted' | 'pending' };

function noteFor(presetId: Preset, over: Partial<AiSetupNote['connections'][number]> = {}): AiSetupNote {
  const base = defaultAiSettings();
  return {
    format: 'chausar.ai-setup.v1', from: { workspaceId: 'workspace_pune', name: 'Pune Frames' }, at: '2026-11-01T09:00:00.000Z',
    connections: [{
      presetId, routeKind: presetId === 'codex-cli' ? 'codex-cli' : 'claude-cli', model: presetId === 'codex-cli' ? 'gpt-6-luna' : null, tiers: ['fast', 'main'],
      consentDigest: presetSpec(presetId).consentDigest, consentedAt: AGREED, ...over,
    }],
    models: { codex: { quick: base.codex.quick, main: { model: 'gpt-6.1-terra', effort: 'max' } }, claude: { quick: base.claude.quick, main: base.claude.main } },
  };
}

/** connect's gates as a test gives them: the presets' availability, the tool's own check, and Claude Code's terms. */
function gate(env: Awaited<ReturnType<typeof setup>>, gates: Gates) {
  const availability = gates.availability ?? 'unverified';
  Object.assign(env.models, {
    presets: () => (['codex-cli', 'claude-code-cli'] as const).map(id => ({ ...presetSpec(id), id, availability, availabilityReason: `This AI is ${availability} here.` })),
    checkCli: async () => { if (gates.cli === 'signed-out') throw new ChausarError('CLI_UNAVAILABLE', 'Sign in to the tool first.'); },
  });
  (env.deps as { claudeCodeTerms?: 'accepted' | 'pending' }).claudeCodeTerms = gates.terms ?? 'accepted';
}

/** A workspace with no business yet, the kept note, and connect's gates as given; then a gallery business. */
async function gallery(note: AiSetupNote | null, gates: Gates = {}, reuseAi = true) {
  const env = await setup();
  await env.store.update(state => { state.conversations = state.conversations.filter(record => record?.kind !== 'venture-record'); });
  env.deps.aiSetup = { read: async () => note, write: async () => {}, clear: async () => {} };
  gate(env, gates);
  await core['venture.create']!(env.deps, owner, { idea: IDEA, countryCode: 'IN', workingName: 'Gallery Studio', ...(reuseAi ? { reuseAi: true } : {}) });
  const state = env.store.read();
  return { connections: listRecords(state, 'venture-model-connection'), decisions: listRecords(state, 'venture-decision'), venture: listRecords(state, 'venture-record')[0]!, clients: listRecords(state, 'venture-client') };
}

test('the setup kept from a business holds its Codex or Claude Code connection, the agreement given there, and nothing of its records', async () => {
  const env = await setup();
  const settings = defaultAiSettings();
  settings.codex.main.model = 'gpt-6.1-terra';
  settings.mcpServers = [];
  await ventureAction(env.deps, owner, 'admin', 'seed.ai', tx => {
    tx.put({ ...tx.base('venture-model-connection'), presetId: 'codex-cli', routeKind: 'codex-cli', model: 'gpt-6-luna', endpoint: null, tiers: ['fast', 'main'], consentDigest: presetSpec('codex-cli').consentDigest, consentedAt: AGREED, monthlyCapMicros: '5000000', status: 'connected' } as never);
    tx.put({ ...tx.base('venture-model-connection'), presetId: 'anthropic-haiku-5-5', routeKind: 'anthropic-messages', model: 'claude-haiku-5-5', endpoint: null, tiers: ['fast'], consentDigest: 'd'.repeat(64), consentedAt: AGREED, monthlyCapMicros: '5000000', status: 'connected' } as never);
    tx.put({ ...tx.base('venture-client'), name: 'Priya Sample', email: 'priya@example.com' } as never);
    tx.touch({ aiSettings: settings } as never);
  });
  let written: AiSetupNote | null = null;
  env.deps.aiSetup = { read: async () => written, write: async note => { written = note; }, clear: async () => { written = null; } };
  await rememberAiSetup(env.deps);
  assert.ok(written);
  const note = written as AiSetupNote;
  assert.deepEqual(note.connections, [{ presetId: 'codex-cli', routeKind: 'codex-cli', model: 'gpt-6-luna', tiers: ['fast', 'main'], consentDigest: presetSpec('codex-cli').consentDigest, consentedAt: AGREED }], 'a key preset never carries over');
  assert.equal(note.models.codex.main.model, 'gpt-6.1-terra');
  assert.equal(note.from.name, 'Ledger Cafe Books');
  assert.equal(JSON.stringify(note).includes('Priya'), false);
  assert.deepEqual(Object.keys(note).sort(), ['at', 'connections', 'format', 'from', 'models']);
  assert.deepEqual(readAiSetup(JSON.parse(JSON.stringify(note))), note);
  const connection = note.connections[0]!;
  for (const bad of [
    { ...note, extra: 1 },
    { ...note, connections: [{ ...connection, presetId: 'anthropic-haiku-5-5', routeKind: 'anthropic-messages' }] },
    { ...note, connections: [{ ...connection, consentedAt: 'last week' }] },
    { ...note, connections: [{ ...connection, consentDigest: 'not a digest' }] },
    { ...note, connections: [{ presetId: 'codex-cli', routeKind: 'codex-cli', model: 'gpt-6-luna', tiers: ['fast', 'main'] }] },
    { ...note, models: { ...note.models, codex: { ...note.models.codex, main: { model: 'x y', effort: 'high' } } } },
  ]) {
    assert.equal(readAiSetup(bad), null, JSON.stringify(bad.connections));
  }
  assert.equal(aiSetupOf({ ...env.deps, store: (await setup()).store }), null, 'no Codex or Claude Code: nothing to keep');
});

test('a gallery business that passes every connect gate takes the AI, with the agreement and its time, and a note from Chausar', async () => {
  for (const presetId of ['codex-cli', 'claude-code-cli'] as const) {
    const { connections, decisions, venture, clients } = await gallery(noteFor(presetId));
    assert.deepEqual(connections.map(item => [item.presetId, item.status, item.consentDigest, item.consentedAt]), [[presetId, 'connected', presetSpec(presetId).consentDigest, AGREED]], presetId);
    assert.deepEqual(venture.aiSettings?.codex.main, { model: 'gpt-6.1-terra', effort: 'max' });
    assert.deepEqual(decisions.map(item => [item.who, item.reason]), [['chausar', 'This business uses the same AI as Pune Frames.']]);
    assert.deepEqual(clients, []);
  }
});

test('a connect gate that fails, or an agreement to words that changed since, leaves the gallery business with no AI and no note', async () => {
  const cases: [string, AiSetupNote, Gates][] = [
    ['Claude Code terms closed', noteFor('claude-code-cli'), { terms: 'pending' }],
    ['Codex needs its setup again', noteFor('codex-cli'), { availability: 'needs-setup' }],
    ['the tool is signed out', noteFor('codex-cli'), { cli: 'signed-out' }],
    ['the preset is unavailable', noteFor('claude-code-cli'), { availability: 'unavailable' }],
    ['the agreed words changed', noteFor('codex-cli', { consentDigest: 'e'.repeat(64) }), {}],
  ];
  for (const [name, note, gates] of cases) {
    const { connections, decisions, venture } = await gallery(note, gates);
    assert.deepEqual([connections.length, decisions.length, venture.aiSettings ?? null], [0, 0, null], name);
  }
});

test('a setup kept but no reuseAi (the first run), or no setup at all, gives no AI', async () => {
  for (const [note, reuseAi] of [[noteFor('codex-cli'), false], [null, true]] as const) {
    const { connections, decisions } = await gallery(note, {}, reuseAi);
    assert.deepEqual([connections.length, decisions.length], [0, 0], String(reuseAi));
  }
});

test('the kept setup goes when the business that saved it disconnects that AI, and stays when another business does', async () => {
  for (const savedHere of [true, false]) {
    const env = await setup();
    gate(env, {});
    const connection = await ventureAction(env.deps, owner, 'admin', 'seed.ai', tx => tx.put({ ...tx.base('venture-model-connection'), presetId: 'codex-cli', routeKind: 'codex-cli', model: 'gpt-6-luna', endpoint: null, tiers: ['fast', 'main'], consentDigest: presetSpec('codex-cli').consentDigest, consentedAt: AGREED, monthlyCapMicros: '5000000', status: 'connected' } as never)) as unknown as { id: string };
    let written: AiSetupNote | null = savedHere ? null : noteFor('codex-cli');
    env.deps.aiSetup = { read: async () => written, write: async note => { written = note; }, clear: async () => { written = null; } };
    if (savedHere) await rememberAiSetup(env.deps);
    assert.ok(written);
    await models['venture.models.disconnect']!(env.deps, owner, { connectionId: connection.id });
    assert.equal(written === null, savedHere, savedHere ? 'saved here: cleared' : 'saved by Pune Frames: kept');
  }
});

test('deleting the business that saved the setup clears it, so its name never reaches a new business', async t => {
  const { engine, directory } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Pune Frames', passphrase: PASSPHRASE, pack: 'services', folder: null });
  const first = await engine.request('workspace.status', {}) as { workspace: { id: string } };
  await engine.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Pune Frames' });
  await mkdir(join(directory, 'custody'), { recursive: true });
  const path = join(directory, 'custody', 'ai-setup.json');
  await writeFile(path, JSON.stringify({ ...noteFor('codex-cli'), from: { workspaceId: first.workspace.id, name: 'Pune Frames' } }));
  await engine.request('workspace.delete', { confirmation: 'Pune Frames' });
  await assert.rejects(readFile(path, 'utf8'), (error: { code?: string }) => error.code === 'ENOENT');

  await engine.request('workspace.create', { name: 'Gallery Studio', passphrase: PASSPHRASE, pack: 'services', folder: null });
  await engine.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Gallery Studio', reuseAi: true });
  const status = await engine.request('venture.models.status', {}) as { tiers: Record<'fast' | 'main', { presetId: string }> };
  assert.deepEqual([status.tiers.fast.presetId, status.tiers.main.presetId], ['built-in-templates', 'built-in-templates']);
  assert.equal(JSON.stringify(await engine.request('venture.decisions.list', {})).includes('Pune'), false);
});

test('deleting another business keeps the setup a business still open saved', async t => {
  const { engine, directory } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Plain Studio', passphrase: PASSPHRASE, pack: 'services', folder: null });
  const path = join(directory, 'custody', 'ai-setup.json');
  await mkdir(join(directory, 'custody'), { recursive: true });
  const kept = JSON.stringify(noteFor('codex-cli'));
  await writeFile(path, kept);
  await engine.request('workspace.delete', { confirmation: 'Plain Studio' });
  assert.equal(await readFile(path, 'utf8'), kept);
});

// A4 review round 3: a kept setup's jobs are checked against the preset's own jobs, by the check connect runs. Both AI
// apps suggest fast and main today, so the test narrows Codex's list for its length and puts it back.
test('a kept setup asking a job the preset does not suggest gives no AI; one it suggests carries over', async () => {
  const tiers = presetSpec('codex-cli').tiers as unknown as string[];
  // A5 (A4 leftover): put back exactly what the preset held, whatever that is.
  const found = [...tiers];
  tiers.splice(0, tiers.length, 'main');
  try {
    const refused = await gallery(noteFor('codex-cli'));
    assert.deepEqual([refused.connections.length, refused.decisions.length], [0, 0]);
    const kept = await gallery(noteFor('codex-cli', { tiers: ['main'] }));
    assert.deepEqual(kept.connections.map(item => item.tiers), [['main']]);
  } finally { tiers.splice(0, tiers.length, ...found); }
  assert.deepEqual(presetSpec('codex-cli').tiers, found);
});
