import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import { agentSettingsOf, defaultAiSettings, driverSettingsFor, validateAiSettings } from '../runtime/venture/agent-runtime/settings.ts';

test('AI settings retain exact D11 models and research-only network defaults', () => {
  const settings = defaultAiSettings();
  assert.deepEqual(settings.codex.quick, { model: 'gpt-6-luna', effort: 'high' });
  assert.deepEqual(settings.codex.main, { model: 'gpt-6.1-terra', effort: 'high' });
  assert.deepEqual(settings.claude.quick, { model: 'claude-haiku-5-5', effort: 'high' });
  assert.deepEqual(settings.claude.main, { model: 'claude-sonnet-5-5', effort: 'high' });
  assert.equal(settings.claude.fallbackModel, 'claude-haiku-5-5');
  assert.equal(settings.codex.fallbackModel, undefined);
  assert.deepEqual(driverSettingsFor(settings, 'codex', 'quick', 'chief'), { model: 'gpt-6-luna', effort: 'high', autoReview: true, network: false, webSearch: false, shell: false });
  assert.equal(driverSettingsFor(settings, 'claude', 'main', 'chief', true).network, true);
  assert.equal(driverSettingsFor(settings, 'claude', 'main', 'chief', true).webSearch, true);
  assert.equal(driverSettingsFor(settings, 'claude', 'quick', 'chief').fallbackModel, undefined);
});

test('owner model, effort and agent approval choices reach the actual driver settings without fallback', () => {
  const settings = defaultAiSettings();
  settings.codex.main = { model: 'owner-unavailable-model', effort: 'low' };
  settings.agentAutoReview.chief = false;
  settings.codex.network = 'on'; settings.codex.webSearch = 'off';
  const clean = validateAiSettings(settings);
  assert.deepEqual(driverSettingsFor(clean, 'codex', 'main', 'chief'), { model: 'owner-unavailable-model', effort: 'low', autoReview: false, network: true, webSearch: false, shell: false });
  assert.equal(driverSettingsFor(clean, 'codex', 'main', 'writer').autoReview, true);
  settings.codex.main.model = 'mutated'; assert.equal(clean.codex.main.model, 'owner-unavailable-model');
});

test('AI settings refuse malformed data, credential fields and unsupported execution permissions', () => {
  const invalid = (change: (settings: any) => void, code = 'INVALID_VENTURE_REQUEST') => {
    const settings = defaultAiSettings(); change(settings);
    assert.throws(() => validateAiSettings(settings), (error: any) => error.code === code);
  };
  invalid(s => { s.codex.quick.model = ' model '; });
  invalid(s => { s.codex.main.effort = 'invented'; });
  invalid(s => { s.autoReview = 'true'; });
  invalid(s => { s.agentAutoReview.chief = 1; });
  invalid(s => { s.codex.apiKey = 'synthetic'; });
  invalid(s => { s.codex.network = 'off'; s.codex.webSearch = 'on'; });
  invalid(s => { s.codex.fallbackModel = 'gpt-other'; });
  invalid(s => { s.claude.fallbackModel = 'invalid model with spaces'; });
  invalid(s => { s.claude.shell = true; }, 'AI_SETTING_UNSUPPORTED');
  invalid(s => { s.mcpServers = [{ command: 'unreviewed' }]; });
  invalid(s => { s.jobRoot = '..'; });
});

test('the owner can explicitly choose a supported Claude fallback without changing the default', () => {
  const settings = defaultAiSettings(); settings.claude.fallbackModel = 'claude-owner-model';
  assert.equal(driverSettingsFor(settings, 'claude', 'main', 'delivery').fallbackModel, 'claude-owner-model');
  assert.equal(defaultAiSettings().claude.fallbackModel, 'claude-haiku-5-5');
});

test('AI settings load only the selected business and return independent values', () => {
  const state = initialState('Settings fixture');
  const saved = defaultAiSettings(); saved.codex.main.model = 'chosen-model';
  state.conversations.push({ kind: 'venture-record', id: 'one', aiSettings: saved }, { kind: 'venture-record', id: 'two' });
  assert.equal(agentSettingsOf(state, 'one').codex.main.model, 'chosen-model');
  const another = agentSettingsOf(state, 'two'); another.codex.main.model = 'mutation';
  assert.equal(agentSettingsOf(state, 'two').codex.main.model, 'gpt-6.1-terra');
  assert.throws(() => agentSettingsOf(state, 'missing'), (error: any) => error.code === 'VENTURE_NOT_FOUND');
});
