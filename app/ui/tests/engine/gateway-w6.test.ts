import { it, expect } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
it('the sample OpenRouter connection keeps the selected provider model and rejects path-like model text', async () => {
  const engine = createFakeClient(new FakeEngine());
  const presets = await engine.request('venture.models.presets', {});
  const preset = presets.find(row => row.id === 'openrouter'); expect(preset).toBeTruthy();
  const payload = { presetId: 'openrouter', consentDigest: preset!.consentDigest, apiKey: 'synthetic-credential-not-a-provider-key', model: 'openai/gpt-6-luna' };
  const result = await engine.request('venture.models.connect', payload);
  expect(result.tiers.main.model).toBe(payload.model);
  await expect(engine.request('venture.models.connect', { ...payload, model: '../outside' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
});
