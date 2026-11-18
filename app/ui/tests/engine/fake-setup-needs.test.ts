import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { NEED_IDS, businessNeeds, keptNeeds, neededGroups } from '../../../../platform/runtime/venture/core/needs-data';
import { sourceRows } from '../../../../platform/runtime/venture/customers/find-words';
import { CURATED_MCP_SERVERS } from '../../../../platform/runtime/venture/agent-runtime/mcp-registry';

// What the plan needs, as the engine answers it (core/about.ts beside the way, core/owner.ts, core/needs.ts): the
// fake's About you read names needs from the fixed list, the owner profile keeps them checked, and venture.needs.list
// answers the kept needs with the same ways, labels and words, or the field's list when none was kept.
const MONID = CURATED_MCP_SERVERS.find((entry) => entry.id === 'monid')!;
const LISTED = sourceRows([], [MONID]);

async function withAi() {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  const options = await client.request('venture.ai.options', {});
  const preset = options.presets.find((row) => row.id === 'claude-code-cli')!;
  await client.request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
  return client;
}

describe('fake About you: the needs beside the way', () => {
  it('an AI read names up to four listed needs with its way; keywords and a tile name none', async () => {
    const read = await (await withAi()).request('venture.about.read', { text: 'I am an advocate in Pune and want to help small firms with contracts.' });
    expect(read.way).toBeTruthy();
    expect(read.needs!.length).toBeGreaterThanOrEqual(1);
    expect(read.needs!.length).toBeLessThanOrEqual(4);
    expect(keptNeeds(read.needs)).toEqual(read.needs);
    for (const need of read.needs!) expect(NEED_IDS).toContain(need);
    const plain = createFakeClient(new FakeEngine({ fresh: true }));
    expect((await plain.request('venture.about.read', { text: 'I am an advocate in Pune and want to help small firms.' })).needs).toBeUndefined();
    expect((await plain.request('venture.about.pick', { familyId: 'licensed' })).needs).toBeUndefined();
  });
});

describe('fake venture.owner.set and venture.needs.list: the plan\'s needs', () => {
  it('keeps listed needs only, once each, and takes them away with null, with the engine\'s refusal for a value that is no list', async () => {
    const client = createFakeClient(new FakeEngine());
    const kept = await client.request('venture.owner.set', { needs: ['find-customers', 'spaceship', 'payments', 'find-customers'] as never });
    expect(kept.needs).toEqual(['find-customers', 'payments']);
    expect((await client.request('venture.owner.set', { firstName: 'Asha' })).needs).toEqual(['find-customers', 'payments']);
    await expect(client.request('venture.owner.set', { needs: 'payments' as never })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Send what your business needs as a list.' });
    expect((await client.request('venture.owner.set', { needs: null })).needs).toBeUndefined();
  });

  it('answers the kept needs with the engine\'s own groups, and the field\'s list when none is kept', async () => {
    const client = createFakeClient(new FakeEngine());
    const before = await client.request('venture.needs.list', {});
    expect(before.groups).toEqual([]);
    expect(before.needs).toEqual(businessNeeds(before.family?.id as never, 'IN', []));
    for (const need of before.needs) expect(['set-up', 'none', 'manual']).toContain(need.action);
    const needs = ['find-customers', 'write-to-customers', 'designs-documents', 'payments'] as const;
    await client.request('venture.owner.set', { needs: [...needs] });
    const list = await client.request('venture.needs.list', {});
    expect(list.needs).toEqual([]);
    expect(list.family).toEqual(before.family);
    expect(list.groups).toEqual(neededGroups(needs, 'IN', [], LISTED));
    expect(list.groups.map((group) => group.ways.map((way) => [way.id, way.label, way.action]))).toEqual([
      [['public-map', 'read', 'none'], ['monid', 'planned', 'set-up']],
      // WhatsApp stands beside email with its card's own label, planned (the engine's NEED_WAYS, 15 Nov 2026).
      [['gmail', 'handoff', 'none'], ['whatsapp', 'planned', 'manual']],
      [['canva', 'planned', 'set-up']],
      [['razorpay', 'planned', 'manual']],
    ]);
    await client.request('venture.owner.set', { needs: null });
    expect(await client.request('venture.needs.list', {})).toEqual(before);
  });

  it('says what is chosen and what can be chosen, and keeps every need the owner ticks, as the engine does', async () => {
    // platform/tests/venture-needs-change.test.ts holds the same answers for the engine.
    const client = createFakeClient(new FakeEngine());
    const before = await client.request('venture.needs.list', {});
    expect(before.chosen).toEqual([]);
    expect(before.choices).toEqual([...NEED_IDS]);
    const mine = ['find-customers', 'write-to-customers', 'designs-documents', 'appointments'] as const;
    expect((await client.request('venture.owner.set', { needs: [...mine] })).needs).toEqual(mine);
    let list = await client.request('venture.needs.list', {});
    expect(list.chosen).toEqual(mine);
    expect(list.groups.map((group) => group.id)).toEqual(mine);
    // All five: the owner's own choice has no ceiling; only the AI's answer is cut to four.
    expect((await client.request('venture.owner.set', { needs: [...NEED_IDS] })).needs).toEqual([...NEED_IDS]);
    list = await client.request('venture.needs.list', {});
    expect(list.chosen).toEqual([...NEED_IDS]);
    expect(list.groups.map((group) => group.id)).toEqual([...NEED_IDS]);
    expect(keptNeeds([...NEED_IDS])).toHaveLength(4);
    await client.request('venture.owner.set', { needs: [] });
    list = await client.request('venture.needs.list', {});
    expect(list.chosen).toEqual([]);
    expect(list.groups).toEqual([]);
    expect(list.needs).toEqual(before.needs);
  });

  it('a saved lead tool is listed as finding customers lists it', async () => {
    const client = createFakeClient(new FakeEngine());
    await client.request('venture.owner.set', { needs: ['find-customers'] });
    const view = await client.request('venture.agentSettings.get', {});
    await client.request('venture.agentSettings.set', { settings: { ...view.settings, mcpServers: [structuredClone(MONID.server)] }, approveMcpConfiguration: true });
    const sources = (await client.request('venture.leads.find.view', {})).sources;
    expect(sources.map((source) => [source.id, source.label, source.usable])).toEqual([['public-map', 'read', true], ['monid', 'planned', true]]);
    const [group] = (await client.request('venture.needs.list', {})).groups;
    expect(group!.ways.map((way) => [way.id, way.label, way.action, way.waitsOn])).toEqual([['public-map', 'read', 'none', null], ['monid', 'planned', 'set-up', sources[1]!.waitsOn]]);
    expect(group!.ways[1]!.connect.mcpServerId).toBe('monid');
  });
});
