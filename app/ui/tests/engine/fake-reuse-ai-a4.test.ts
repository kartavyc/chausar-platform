import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// A4 fix round (founder, 4 Nov), as the engine's core/venture.ts reuseAi: a business made from the Start gallery takes the
// newest Codex or Claude Code connection of another business, says so in its decisions, and nothing else.
describe('fake: a gallery business reuses the AI already set up', () => {
  it('copies the Claude Code connection of the business that set it up, with the decision, and no clients', async () => {
    const engine = new FakeEngine({ fresh: true });
    const client = createFakeClient(engine);
    await client.request('workspace.create', { name: 'Pune Frames', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: 'Photography for parties and shops in Pune', countryCode: 'IN', workingName: 'Pune Frames' });
    const presets = await client.request('venture.models.presets', {});
    const claude = presets.find((preset) => preset.id === 'claude-code-cli')!;
    await client.request('venture.models.connect', { presetId: 'claude-code-cli', consentDigest: claude.consentDigest } as never);
    await client.request('venture.client.add', { name: 'Priya Sample', email: 'priya@example.com', countryCode: 'IN' } as never);
    await client.request('workspace.lock', {});
    await client.request('workspace.create', { name: 'Gallery Studio', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: 'Photography for parties and shops in Pune', countryCode: 'IN', workingName: 'Gallery Studio', reuseAi: true });
    const status = await client.request('venture.models.status', {});
    expect([status.tiers.fast.presetId, status.tiers.main.presetId]).toEqual(['claude-code-cli', 'claude-code-cli']);
    const decisions = await client.request('venture.decisions.list', {});
    expect(decisions.decisions.map((item) => item.line)).toContain('You decided: Uses the same AI as Pune Frames.');
    expect(await client.request('venture.client.list', {})).toEqual([]);
    await expect(client.request('venture.create', { idea: 'Photography for parties and shops', countryCode: 'IN', reuseAi: false } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });
});
