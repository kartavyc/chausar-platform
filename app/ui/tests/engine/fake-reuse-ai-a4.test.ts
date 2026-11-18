import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// A4 fix round (founder, 4 Nov): a new business takes the newest Codex or Claude Code connection of another business,
// says so in its decisions, and nothing else. Since 15 Nov 2026 it does so before the vault, in the new business's
// draft (the engine's draft/handlers.ts aiReuse), so every new business gets the same conversational first run; the
// old Start gallery and venture.create's reuseAi are gone.
describe('fake: a new business reuses the AI already set up, through its draft', () => {
  const IDEA = 'Photography for parties and shops in Pune';
  async function puneFrames() {
    const engine = new FakeEngine({ fresh: true });
    const client = createFakeClient(engine);
    await client.request('workspace.create', { name: 'Pune Frames', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Pune Frames' });
    const claude = (await client.request('venture.models.presets', {})).find((preset) => preset.id === 'claude-code-cli')!;
    const connected = await client.request('venture.models.connect', { presetId: 'claude-code-cli', consentDigest: claude.consentDigest } as never);
    return { client, connected };
  }

  it('connects the Claude Code of the business that set it up in the new draft, and the new business keeps it with the decision and no clients', async () => {
    const { client, connected } = await puneFrames();
    const agreedAt = connected.connections[0]!.consentedAt;
    await client.request('venture.client.add', { name: 'Priya Sample', email: 'priya@example.com', countryCode: 'IN' } as never);
    // The status names the open business's folder, which the window comes back to.
    expect((await client.request('workspace.status', {})).folder).toBe('pune-frames');
    // While a business is open the draft desk answers nothing, as the engine's does.
    await expect(client.request('venture.ai.reuse', {})).rejects.toMatchObject({ code: 'VENTURE_EXISTS' });
    await client.request('workspace.lock', {});
    expect((await client.request('venture.ai.status', {})).connections).toEqual([]);
    const reused = await client.request('venture.ai.reuse', {});
    expect(reused.reused).toEqual({ from: 'Pune Frames' });
    expect([reused.tiers.fast.presetId, reused.tiers.main.presetId, reused.tiers.main.usable]).toEqual(['claude-code-cli', 'claude-code-cli', true]);
    expect(reused.connections.map((item) => item.consentedAt)).toEqual([agreedAt]);
    // Asked again it answers the same and connects nothing twice.
    const again = await client.request('venture.ai.reuse', {});
    expect([again.reused, again.connections.length]).toEqual([{ from: 'Pune Frames' }, 1]);
    await expect(client.request('venture.ai.reuse', { extra: 1 } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });

    await client.request('workspace.create', { name: 'Second Studio', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Second Studio' });
    const status = await client.request('venture.models.status', {});
    expect([status.tiers.fast.presetId, status.tiers.main.presetId]).toEqual(['claude-code-cli', 'claude-code-cli']);
    const decisions = await client.request('venture.decisions.list', {});
    // A4 review round 2: the note is Chausar's, and the connection keeps the time the owner agreed in Pune Frames.
    expect(decisions.decisions.filter((item) => item.action === 'reuse-ai').map((item) => [item.who, item.line, item.mine])).toEqual([['chausar', 'This business uses the same AI as Pune Frames.', false]]);
    expect(status.connections.map((item) => item.consentedAt)).toEqual([agreedAt]);
    expect(await client.request('venture.client.list', {})).toEqual([]);
    // venture.create takes the idea, the country and a name, and nothing else.
    await client.request('workspace.lock', {});
    await client.request('workspace.create', { name: 'Third Studio', pack: 'services', folder: null } as never);
    await expect(client.request('venture.create', { idea: IDEA, countryCode: 'IN', reuseAi: true } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });

  it('a business made without asking takes no AI, and a draft the owner disconnected takes none either', async () => {
    const { client } = await puneFrames();
    await client.request('workspace.lock', {});
    await client.request('workspace.create', { name: 'Plain Studio', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Plain Studio' });
    expect((await client.request('venture.models.status', {})).tiers.main.presetId).toBe('built-in-templates');
    await client.request('workspace.lock', {});
    const reused = await client.request('venture.ai.reuse', {});
    await client.request('venture.ai.disconnect', { connectionId: reused.connections[0]!.id } as never);
    await client.request('workspace.create', { name: 'No AI Studio', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'No AI Studio' });
    expect((await client.request('venture.models.status', {})).tiers.main.presetId).toBe('built-in-templates');
    expect(JSON.stringify(await client.request('venture.decisions.list', {}))).not.toContain('reuse-ai');
  });

  // A4 review round 2 (M2), as the engine's custody/ai-setup.json: the setup goes when the business that saved it
  // disconnects that AI, or is deleted, so no later business takes it or names that business.
  it.each(['disconnect', 'delete'] as const)('after Pune Frames is set to %s, a new business starts with no AI', async (way) => {
    const { client, connected } = await puneFrames();
    if (way === 'disconnect') {
      await client.request('venture.models.disconnect', { connectionId: connected.connections[0]!.id } as never);
      await client.request('workspace.lock', {});
    } else {
      await client.request('workspace.delete', { confirmation: 'Pune Frames' } as never);
    }
    const reused = await client.request('venture.ai.reuse', {});
    expect([reused.reused, reused.connections]).toEqual([null, []]);
    await client.request('workspace.create', { name: 'Second Studio', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Second Studio' });
    const status = await client.request('venture.models.status', {});
    expect([status.tiers.fast.presetId, status.tiers.main.presetId]).toEqual(['built-in-templates', 'built-in-templates']);
    expect(JSON.stringify(await client.request('venture.decisions.list', {}))).not.toContain('Pune');
  });
});
