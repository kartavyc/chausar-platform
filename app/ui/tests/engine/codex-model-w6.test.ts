import { expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { MODEL_PRESETS } from '../../src/engine/fixtures-business';
import type { ModelStatusLite } from '../../src/engine/types';

it('Codex has an owner-editable model, preserves its default, and validates the exact model id', async () => {
  const preset = MODEL_PRESETS.find(item => item.id === 'codex-cli')!;
  const original = structuredClone(preset);
  try {
    expect(preset.model).toBe('gpt-6-luna');
    expect(preset.modelEditable).toBe(true);
    // This synthetic computer has a reviewed install; no real CLI runs in the fake.
    preset.availability = 'unverified';
    const engine = new FakeEngine();
    const payload = { presetId: preset.id, consentDigest: preset.consentDigest, model: 'synthetic-owner-model' };
    for (const model of [null, 123, '', 'spaces are invalid']) {
      await expect(engine.request('venture.models.connect', { ...payload, model } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    }
    const connected = await engine.request('venture.models.connect', payload) as ModelStatusLite;
    expect(connected.tiers.fast.model).toBe('synthetic-owner-model');
    expect(preset.model).toBe('gpt-6-luna');
  } finally { Object.assign(preset, original); }
});
