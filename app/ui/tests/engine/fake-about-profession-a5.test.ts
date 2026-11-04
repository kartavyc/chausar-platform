import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { PROFESSIONS } from '../../../../platform/runtime/venture/core/professions';

// One-shot A5 (founder answer 3a), as the engine's core/about.ts: the AI's read names the owner's exact profession (one
// of the catalogue's, in the field it picked), keywords and tiles pick none, and the field tiles list their professions.
async function withAi() {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  const options = await client.request('venture.ai.options', {});
  const preset = options.presets.find((row) => row.id === 'claude-code-cli')!;
  await client.request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
  return client;
}

describe('fake About you: the exact profession (A5)', () => {
  it('the AI read picks the profession its words name, inside the field it picked', async () => {
    const client = await withAi();
    const advocate = await client.request('venture.about.read', { text: 'I am an advocate in Pune and want to help small firms with contracts.' });
    expect(advocate.family?.id).toBe('licensed');
    expect(advocate.profession).toEqual({ id: 'advocate', label: 'Advocate' });
    const chef = await client.request('venture.about.read', { text: 'I run a home chef tiffin service for office workers.' });
    expect(chef.profession).toEqual({ id: 'home-chef-tiffin', label: 'Home chef or tiffin' });
    // Words that name no profession of the field pick none: the owner chooses.
    const vague = await client.request('venture.about.read', { text: 'I do some legal work for people near me.' });
    expect(vague.family?.id).toBe('licensed');
    expect(vague.profession).toBeNull();
  });

  it('keywords (no AI) and a tile pick no profession', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    expect((await client.request('venture.about.read', { text: 'I am an advocate in Pune and want to help small firms.' })).profession).toBeNull();
    expect((await client.request('venture.about.pick', { familyId: 'licensed' })).profession).toBeNull();
  });

  it('each field tile lists its professions in the catalogue order', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    const { families } = await client.request('venture.about.families', {});
    for (const family of families) expect(family.professions).toEqual(PROFESSIONS.filter((item) => item.family === family.id).map(({ id, label }) => ({ id, label })));
  });
});
