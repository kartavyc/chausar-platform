import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { AboutBeforeLite, AboutReadLite, BlueprintViewLite, QueueItemView } from '../../src/engine/types';
import { KEEPER_JOINS } from '../../../../platform/runtime/venture/agents/order-agents-core';
import { READY_LINE } from '../../../../platform/runtime/venture/core/about-reply';

// The third round on Windows (15 Nov 2026), as the engine now answers it (platform/tests/venture-about-round3.test.ts,
// venture-owner-unit-round3.test.ts). The fake answers the same, from the same code where the code is shared: a rename
// the owner asks for renames that offer and nothing else; the card's agents hold; the owner's own unit applies on Save
// with an Undo; Keeper is listed on the plan the owner reads; and an offer can be priced per word or per page.
const STUDIO = 'I run a small weekend photography studio in Pune.';

async function withAi() {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  const options = await client.request('venture.ai.options', {});
  const preset = options.presets.find((row) => row.id === 'claude-code-cli')!;
  await client.request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
  return client;
}
const beforeOf = (read: AboutReadLite, said: string): AboutBeforeLite => ({
  turns: [{ from: 'owner', text: said }, ...(read.reply ? [{ from: 'you' as const, text: read.reply }] : [])],
  plan: {
    familyId: read.family?.id ?? null, professionId: read.profession?.id ?? null, name: read.name ?? null,
    offers: read.offers.map((offer) => ({ ...offer, kept: true, yours: false })),
    way: read.way ?? null,
    team: (read.team ?? []).map(({ digest: _digest, ...card }) => ({ ...card, left: false })),
  },
});

describe('fake About you: a rename and the team in a follow-up', () => {
  it('renames the offer the owner names by place or by its exact name, and no other offer changes', async () => {
    const client = await withAi();
    const first = await client.request('venture.about.read', { text: STUDIO });
    const names = first.offers.map((offer) => offer.name);
    const byPlace = await client.request('venture.about.read', { text: 'Rename the second offer to Wedding albums, and I am free on weekends only.', before: beforeOf(first, STUDIO) });
    expect(byPlace.offers.map((offer) => offer.name)).toEqual([names[0], 'Wedding albums', names[2]]);
    expect(byPlace.reply).toBe(`I renamed ${names[1]} to Wedding albums. ${READY_LINE}`);
    const byName = await client.request('venture.about.read', { text: `Rename ${names[2]} to Monthly photo plan.`, before: beforeOf(first, STUDIO) });
    expect(byName.offers.map((offer) => offer.name)).toEqual([names[0], names[1], 'Monthly photo plan']);
    expect(byName.reply).toBe(`I renamed ${names[2]} to Monthly photo plan. ${READY_LINE}`);
  });

  it('keeps every agent on the card through a message about something else', async () => {
    const client = await withAi();
    const first = await client.request('venture.about.read', { text: STUDIO });
    expect(first.team!.length).toBeGreaterThan(0);
    const next = await client.request('venture.about.read', { text: 'I can take about ten shoots a month.', before: beforeOf(first, STUDIO) });
    expect(next.team!.map((agent) => agent.name)).toEqual(first.team!.map((agent) => agent.name));
    expect(next.reply).not.toMatch(/off the team/);
  });
});

describe('fake plan: the owner\'s own unit, and Keeper on the plan sheet', () => {
  it('a unit the owner saves applies at once with the engine\'s line and Undo; the unit an offer already has changes nothing', async () => {
    const client = createFakeClient(new FakeEngine());
    const plan = await client.request('venture.blueprint.get', {}) as BlueprintViewLite;
    const offer = plan.blueprint.offers[0]!;
    const save = (unit: string) => client.request('venture.blueprint.update', { patch: { offers: [{ id: offer.id, unit }] }, ownerSave: true } as never);
    const set = await save('visit');
    expect(set.blueprint.status).toBe('accepted');
    expect(set.blueprint.offers[0]!.pricing.quantityUnit).toBe('visit');
    expect(set.decided!.line).toBe(`You set ${offer.name.value} to be priced per visit.`);
    const same = await save('visit');
    expect(same.decided).toBeUndefined();
    expect(same.blueprint.id).toBe(set.blueprint.id);
    expect(same.blueprint.status).toBe('accepted');
    expect(await client.request('venture.queue.undo', { rowId: set.decided!.undoRowId! })).toEqual({ restored: true, line: `You took back the new unit for ${offer.name.value}.` });
    const back = await client.request('venture.blueprint.get', {}) as BlueprintViewLite;
    expect(back.blueprint.offers[0]!.pricing.quantityUnit).toBe(offer.pricing.quantityUnit);
    expect(back.blueprint.status).toBe('accepted');
    // Not the owner's own Save: it waits, as before.
    const waits = await client.request('venture.blueprint.update', { patch: { offers: [{ id: offer.id, unit: 'page' }] } });
    expect(waits.blueprint.status).toBe('draft');
    expect(waits.blueprint.offers[0]!.pricing.quantityUnit).toBe('page');
  });

  it('the plan the owner reads lists Keeper with the agents that join', async () => {
    const client = createFakeClient(new FakeEngine());
    const plan = await client.request('venture.blueprint.get', {}) as BlueprintViewLite;
    const sheet = await client.request('venture.queue.view', { kind: 'plan', id: plan.blueprint.id }) as QueueItemView & { sections: { heading: string; lines: string[] }[] };
    const team = sheet.sections.find((section) => section.heading === 'Your team');
    if (team) expect(team.lines.some((line) => line.startsWith(`Keeper: ${KEEPER_JOINS.does}`))).toBe(true);
    else expect(sheet.sections.some((section) => section.lines.some((line) => line.startsWith('Keeper:')))).toBe(false);
  });
});
