import test from 'node:test';
import assert from 'node:assert/strict';
import { ventureHostEnv } from '../runtime/venture/host-env.ts';
import { availabilityOf, claudeTermsOpen, presetSpec } from '../runtime/venture/models/presets.ts';
import { cliGateOpen } from '../runtime/venture/models/cli-look.ts';
import { delegateGateOpen } from '../runtime/venture/delivery/harness/delegate.ts';
import type { AiOptionsView, AiStatusView } from '../runtime/venture/onboarding-contracts.ts';
import type { ModelPreset } from '../runtime/venture/contracts.ts';
import { engineFor, PASSPHRASE } from './fixtures/venture/compose-unit/harness.ts';

test('wave 6: Claude is enabled by default at the environment, model and installed-tool boundaries', () => {
  assert.equal(ventureHostEnv({}, { demo: false, host: 'desktop' }).claudeCodeTerms, 'accepted');
  assert.equal(claudeTermsOpen(undefined), true);
  assert.equal(cliGateOpen('claude-code', undefined), true);
  assert.equal(delegateGateOpen('claude-code', undefined), true);
  assert.equal(availabilityOf('claude-code-cli', { claudeFound: true, codexProfile: false }).availability, 'unverified');
  assert.equal(ventureHostEnv({ CHAUSAR_CLAUDE_CODE_TERMS: 'pending' }, { demo: false, host: 'desktop' }).claudeCodeTerms, 'pending');
  assert.equal(claudeTermsOpen('pending'), false);
  assert.equal(cliGateOpen('claude-code', 'pending'), false);
  assert.equal(delegateGateOpen('claude-code', 'pending'), false);
});

test('wave 6: directly constructed hosts offer and connect Claude without a terms override, before and after vault creation', async t => {
  const { engine } = await engineFor(t);
  const options = await engine.request('venture.ai.options', {}) as AiOptionsView;
  assert.equal(options.options.find(option => option.id === 'claude-code')?.canConnect, true);
  const claude = options.presets.find(preset => preset.id === 'claude-code-cli')!;
  const connected = await engine.request('venture.ai.connect', { presetId: claude.id, consentDigest: claude.consentDigest }) as AiStatusView;
  assert.equal(connected.tiers.main.presetId, 'claude-code-cli');
  await engine.request('workspace.create', { name: 'Synthetic default Claude', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: 'Bookkeeping for cafes', countryCode: 'IN', workingName: 'Synthetic default Claude' });
  const presets = await engine.request('venture.models.presets', {}) as ModelPreset[];
  assert.equal(presets.some(preset => preset.id === 'claude-code-cli'), true);
  await engine.request('venture.models.connect', { presetId: claude.id, consentDigest: claude.consentDigest });
});

test('wave 6: pending hides Claude choices and forged direct connections are still refused', async t => {
  const { engine } = await engineFor(t, { claudeCodeTerms: 'pending' });
  const options = await engine.request('venture.ai.options', {}) as AiOptionsView;
  assert.equal(options.options.some(option => option.id === 'claude-code'), false);
  assert.equal(options.presets.some(preset => preset.id === 'claude-code-cli'), false);
  const request = { presetId: 'claude-code-cli', consentDigest: presetSpec('claude-code-cli').consentDigest };
  await assert.rejects(engine.request('venture.ai.connect', request), { code: 'PRESET_UNAVAILABLE' });
  await engine.request('workspace.create', { name: 'Synthetic disabled Claude', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: 'Bookkeeping for cafes', countryCode: 'IN', workingName: 'Synthetic disabled Claude' });
  const presets = await engine.request('venture.models.presets', {}) as ModelPreset[];
  assert.equal(presets.some(preset => preset.id === 'claude-code-cli'), false);
  await assert.rejects(engine.request('venture.models.connect', request), { code: 'PRESET_UNAVAILABLE' });
});
