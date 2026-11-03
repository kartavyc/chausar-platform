// W6 6F5 (D34): the owner's choice to let Codex or Claude Code use the Gmail connection they made in ChatGPT or Claude.
// Off by default, a plain true or false per tool, and passed to the driver only when on, so every other setting and
// every saved settings file reads as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAiSettings, driverSettingsFor, validateAiSettings } from '../runtime/venture/agent-runtime/settings.ts';

test('6F5: the Gmail connection setting is off by default, a boolean per tool, and reaches the driver only when on', () => {
  const settings = defaultAiSettings();
  assert.equal(settings.codex.connectors, undefined);
  assert.equal(driverSettingsFor(settings, 'codex', 'main', 'chief').connectors, undefined);
  const on = structuredClone(settings); on.codex.connectors = true;
  const clean = validateAiSettings(on);
  assert.equal(clean.codex.connectors, true);
  assert.equal(clean.claude.connectors, undefined);
  assert.equal(driverSettingsFor(clean, 'codex', 'quick', 'chief').connectors, true);
  assert.equal(driverSettingsFor(clean, 'claude', 'main', 'chief').connectors, undefined);
  const off = structuredClone(settings); off.claude.connectors = false;
  assert.equal(validateAiSettings(off).claude.connectors, false);
  assert.equal(driverSettingsFor(validateAiSettings(off), 'claude', 'main', 'chief').connectors, undefined);
  for (const bad of ['yes', 1, null]) {
    const wrong = structuredClone(settings) as any; wrong.codex.connectors = bad;
    assert.throws(() => validateAiSettings(wrong), { code: 'INVALID_VENTURE_REQUEST' });
  }
});

test('6F5: the job prompt allows a send only through the owner\'s Gmail connection, only when it is on with a plan login', async () => {
  const { jobPrompt } = await import('../runtime/venture/agent-runtime/runner.ts');
  const base = { model: 'm', effort: 'high' as const, autoReview: true, network: false, webSearch: false, shell: false };
  assert.match(jobPrompt(base), /Never send, post, pay/);
  assert.doesNotMatch(jobPrompt(base), /Gmail/);
  assert.doesNotMatch(jobPrompt({ ...base, connectors: true }, { apiKey: ['synthetic', 'credential'].join('-') }), /Gmail/, 'a key route never uses connectors');
  const on = jobPrompt({ ...base, connectors: true });
  assert.match(on, /Gmail/);
  assert.match(on, /exact/);
  assert.match(on, /mail app/, 'without a connection the owner keeps the ready draft in their mail app');
});
