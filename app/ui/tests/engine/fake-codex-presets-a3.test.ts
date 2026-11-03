import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { ModelPresetLite } from '../../src/engine/types';

/*
 * One-shot A3 (L1 from the A2 final review): the fake's Codex in the preset list answers as the engine's
 * models/presets.ts availabilityOf does. The fake desktop has the bundled Codex in use by default:
 *   in use, its own look says signed out   needs-setup, in the engine's signed-out words (cliSignedOutWords);
 *   in use and signed in                   unverified, AVAILABILITY_REASONS.codexReady;
 *   no setup in use (the owner's own Codex found, waiting for the yes)  needs-setup, AVAILABILITY_REASONS.codexMissing.
 */

const SIGNED_OUT = 'Codex 0.166.0 is on this computer but not signed in. Open a terminal, run codex login, then check again.';
const READY = 'Uses the reviewed Codex install.';
const MISSING = "Chausar's reviewed setup for Codex isn't on this computer yet. Use an OpenAI key for now.";

async function codexPreset(engine: FakeEngine, method: 'venture.models.presets' | 'venture.ai.options'): Promise<ModelPresetLite> {
  const answer = await engine.request(method, {});
  const presets = (Array.isArray(answer) ? answer : (answer as { presets: ModelPresetLite[] }).presets) as ModelPresetLite[];
  return presets.find((preset) => preset.id === 'codex-cli')!;
}

describe('the fake Codex preset, as the engine words it (A3 L1)', () => {
  it('the bundled Codex in use, signed out: the engine\'s signed-out words, not "use an OpenAI key"', async () => {
    const engine = new FakeEngine();
    for (const method of ['venture.models.presets', 'venture.ai.options'] as const) {
      const codex = await codexPreset(engine, method);
      expect(codex).toMatchObject({ availability: 'needs-setup', availabilityReason: SIGNED_OUT });
    }
  });

  it('in use and signed in: unverified, "Uses the reviewed Codex install."', async () => {
    const engine = new FakeEngine();
    engine.firstRun.signIn();
    expect(await codexPreset(engine, 'venture.models.presets')).toMatchObject({ availability: 'unverified', availabilityReason: READY });
  });

  it('no setup in use: needs-setup with the missing-setup words, signed in or not', async () => {
    const engine = new FakeEngine();
    engine.firstRun.reviewCodex();
    expect(await codexPreset(engine, 'venture.models.presets')).toMatchObject({ availability: 'needs-setup', availabilityReason: MISSING });
    engine.firstRun.signIn();
    expect(await codexPreset(engine, 'venture.models.presets')).toMatchObject({ availability: 'needs-setup', availabilityReason: MISSING });
  });

  it('a signed-out Codex cannot be connected; a signed-in one can', async () => {
    const engine = new FakeEngine();
    const codex = await codexPreset(engine, 'venture.models.presets');
    await expect(engine.request('venture.models.connect', { presetId: 'codex-cli', consentDigest: codex.consentDigest })).rejects.toMatchObject({ code: 'PRESET_UNAVAILABLE', message: SIGNED_OUT });
    engine.firstRun.signIn();
    await expect(engine.request('venture.models.connect', { presetId: 'codex-cli', consentDigest: codex.consentDigest })).resolves.toBeTruthy();
  });

  it('the hosted app still lists Codex as unavailable', async () => {
    const engine = new FakeEngine({ hosted: true });
    expect(await codexPreset(engine, 'venture.models.presets')).toMatchObject({ availability: 'unavailable' });
  });
});
