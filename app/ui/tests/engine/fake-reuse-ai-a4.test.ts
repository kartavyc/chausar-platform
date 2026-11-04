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
    const agreedAt = (await client.request('venture.models.connect', { presetId: 'claude-code-cli', consentDigest: claude.consentDigest } as never)).connections[0]!.consentedAt;
    await client.request('venture.client.add', { name: 'Priya Sample', email: 'priya@example.com', countryCode: 'IN' } as never);
    await client.request('workspace.lock', {});
    await client.request('workspace.create', { name: 'Gallery Studio', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: 'Photography for parties and shops in Pune', countryCode: 'IN', workingName: 'Gallery Studio', reuseAi: true });
    const status = await client.request('venture.models.status', {});
    expect([status.tiers.fast.presetId, status.tiers.main.presetId]).toEqual(['claude-code-cli', 'claude-code-cli']);
    const decisions = await client.request('venture.decisions.list', {});
    // A4 review round 2: the note is Chausar's, and the connection keeps the time the owner agreed in Pune Frames.
    expect(decisions.decisions.filter((item) => item.action === 'reuse-ai').map((item) => [item.who, item.line, item.mine])).toEqual([['chausar', 'This business uses the same AI as Pune Frames.', false]]);
    expect(status.connections.map((item) => item.consentedAt)).toEqual([agreedAt]);
    expect(await client.request('venture.client.list', {})).toEqual([]);
    await expect(client.request('venture.create', { idea: 'Photography for parties and shops', countryCode: 'IN', reuseAi: false } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });

  // A4 review round 2 (M2), as core/venture.ts and the engine's custody/ai-setup.json: the setup goes when the business
  // that saved it disconnects that AI, or is deleted, so no later gallery business takes it or names that business.
  it.each(['disconnect', 'delete'] as const)('after Pune Frames is set to %s, a gallery business starts with no AI', async (way) => {
    const engine = new FakeEngine({ fresh: true });
    const client = createFakeClient(engine);
    await client.request('workspace.create', { name: 'Pune Frames', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: 'Photography for parties and shops in Pune', countryCode: 'IN', workingName: 'Pune Frames' });
    const claude = (await client.request('venture.models.presets', {})).find((preset) => preset.id === 'claude-code-cli')!;
    const connected = await client.request('venture.models.connect', { presetId: 'claude-code-cli', consentDigest: claude.consentDigest } as never);
    if (way === 'disconnect') {
      await client.request('venture.models.disconnect', { connectionId: connected.connections[0]!.id } as never);
      await client.request('workspace.lock', {});
    } else {
      await client.request('workspace.delete', { confirmation: 'Pune Frames' } as never);
    }
    await client.request('workspace.create', { name: 'Gallery Studio', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: 'Photography for parties and shops in Pune', countryCode: 'IN', workingName: 'Gallery Studio', reuseAi: true });
    const status = await client.request('venture.models.status', {});
    expect([status.tiers.fast.presetId, status.tiers.main.presetId]).toEqual(['built-in-templates', 'built-in-templates']);
    expect(JSON.stringify(await client.request('venture.decisions.list', {}))).not.toContain('Pune');
  });
});
