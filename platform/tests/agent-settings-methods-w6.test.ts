import test from 'node:test';
import assert from 'node:assert/strict';
import { code, owner, seedBlueprint, setup } from './venture-views-env.ts';
import { getAgentSettings, setAgentSettings } from '../runtime/venture/agent-runtime/settings-methods.ts';
import { agentSettingsOf, driverSettingsFor } from '../runtime/venture/agent-runtime/settings.ts';
import type { VentureDeps } from '../runtime/venture/contracts.ts';

test('saved AI settings feed the driver, remain business-owned and record the owner change', async () => {
  const env = await setup(); await seedBlueprint(env);
  const initial = await getAgentSettings(env.deps, owner, {});
  assert.ok(initial.agents.length);
  initial.settings.codex.main.model = 'explicit-owner-model';
  initial.settings.agentAutoReview[initial.agents[0]!.id] = false;
  const saved = await setAgentSettings(env.deps, owner, { settings: initial.settings });
  assert.deepEqual((await getAgentSettings(env.deps, owner, {})).settings, saved.settings);
  const venture = env.store.read().conversations.find(row => row.kind === 'venture-record');
  assert.equal(driverSettingsFor(agentSettingsOf(env.store.read(), venture.id), 'codex', 'main', initial.agents[0]!.id).autoReview, false);
  assert.equal(driverSettingsFor(saved.settings, 'codex', 'main', initial.agents[0]!.id).model, 'explicit-owner-model');
  assert.ok(env.store.read().activity.some(row => JSON.stringify(row).includes('agentSettings.set')));
});

test('AI settings refuse non-owner sources, unknown agents, extra fields and unsafe permissions without saving', async () => {
  const env = await setup(); await seedBlueprint(env);
  const view = await getAgentSettings(env.deps, owner, {});
  for (const ctx of [{ ...owner, channel: 'mcp' as const }, { ...owner, sourceTainted: true }, { ...owner, channel: 'phone' as const }]) {
    await assert.rejects(setAgentSettings(env.deps, ctx, { settings: view.settings }), code('APP_APPROVAL_REQUIRED'));
  }
  await assert.rejects(setAgentSettings(env.deps, owner, { settings: { ...view.settings, agentAutoReview: { unknown: false } } }), code('AGENT_NOT_FOUND'));
  await assert.rejects(setAgentSettings(env.deps, owner, { settings: view.settings, auto: true }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(getAgentSettings(env.deps, owner, { extra: true }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(setAgentSettings(env.deps, owner, { settings: { ...view.settings, claude: { ...view.settings.claude, shell: true } } }), code('AI_SETTING_UNSUPPORTED'));
  assert.deepEqual((await getAgentSettings(env.deps, owner, {})).settings, view.settings);
});

// C1 task 13: the view carries Codex's own model list, in its order, so Connections can offer it; never the fixed ids.
test('AI settings carry the models Codex lists, or null when there is no list', async () => {
  const env = await setup(); await seedBlueprint(env);
  const listed = (models: VentureDeps['models']['codexModels']) => ({ ...env.deps, models: Object.assign(Object.create(Object.getPrototypeOf(env.deps.models)), env.deps.models, { codexModels: models }) });
  const codex = listed(async () => ({ route: 'gpt-6-luna', quick: 'gpt-6-luna', main: 'gpt-6.1-terra', listed: ['gpt-6.1-terra', 'gpt-6-luna'], source: 'codex' as const }));
  const view = await getAgentSettings(codex, owner, {});
  assert.deepEqual(view.models, { codex: ['gpt-6.1-terra', 'gpt-6-luna'] });
  assert.deepEqual(Object.keys(view), ['settings', 'boundaries', 'agents', 'models']);
  const saved = await setAgentSettings(codex, owner, { settings: view.settings });
  assert.deepEqual(saved.models, { codex: ['gpt-6.1-terra', 'gpt-6-luna'] });
  assert.deepEqual((await getAgentSettings(listed(undefined), owner, {})).models, { codex: null });
  assert.deepEqual((await getAgentSettings(listed(async () => ({ route: 'a', quick: 'a', main: 'b', listed: null, source: 'fallback' as const })), owner, {})).models, { codex: null });
  assert.deepEqual((await getAgentSettings(listed(async () => { throw new Error('codex is not here'); }), owner, {})).models, { codex: null });
  // No new input: the request stays exact.
  await assert.rejects(getAgentSettings(codex, owner, { models: true }), code('INVALID_VENTURE_REQUEST'));
});
