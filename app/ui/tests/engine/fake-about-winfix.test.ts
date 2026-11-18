import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { fakeOrderAgents } from '../../src/engine/fake-order-agents';
import type { AboutBeforeLite, AboutReadLite } from '../../src/engine/types';
import { teamCardDigest } from '../../../../platform/runtime/venture/agents/team-proposal';
import { DELIVERY_JOB, OWN_ORDER_JOB } from '../../../../platform/runtime/venture/agents/order-agents-core';
import { ORDER_AGENT_JOINS, OWN_ORDER_LINES } from '../../../../platform/runtime/venture/views/plan-sections';
import { READY_LINE } from '../../../../platform/runtime/venture/core/about-reply';

// What the Windows walk found (15 Nov 2026), as the engine now answers it (platform/tests/venture-about-winfix.test.ts,
// venture-offer-units.test.ts): each offer has a unit the owner changes; a read that found offers always has a name and
// never a plan label; proposed agents name a department and are hired there; the agents that do each order are shown
// beside the team; and a follow-up's reply is what really changed, by code. The fake answers the same, from the same code.
const STUDIO = 'I run a small weekend photography studio in Pune.';
const TRANSLATOR = 'I am a translator: I translate between Hindi and English and make subtitles for videos in Bhopal.';

async function withAi() {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  const options = await client.request('venture.ai.options', {});
  const preset = options.presets.find((row) => row.id === 'claude-code-cli')!;
  await client.request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
  return client;
}
const beforeOf = (read: AboutReadLite, said: string, change: Partial<AboutBeforeLite['plan']> = {}): AboutBeforeLite => ({
  turns: [{ from: 'owner', text: said }, ...(read.reply ? [{ from: 'you' as const, text: read.reply }] : [])],
  plan: {
    familyId: read.family?.id ?? null, professionId: read.profession?.id ?? null, name: read.name ?? null,
    offers: read.offers.map((offer) => ({ ...offer, kept: true, yours: false })),
    way: read.way ?? null,
    team: (read.team ?? []).map(({ digest: _digest, ...card }) => ({ ...card, left: false })),
    ...change,
  },
});
const classify = () => 'other';

describe('fake About you: units, names, departments and one team', () => {
  it('an offer carries the unit it is priced in where that is not per project, and a follow-up keeps the card\'s', async () => {
    const client = await withAi();
    const tile = await client.request('venture.about.pick', { familyId: 'creative' });
    expect(tile.offers.map((offer) => [offer.name, offer.unit])).toEqual([['Video edits', 'piece'], ['Design work', 'piece'], ['Monthly creative plan', 'month']]);
    const first = await client.request('venture.about.read', { text: STUDIO });
    expect(first.offers.find((offer) => offer.name === 'Monthly creative plan')?.unit).toBe('month');
    // The owner chose per hour for the first offer on the card: a follow-up about something else keeps it.
    const before = beforeOf(first, STUDIO);
    before.plan.offers[0]!.unit = 'hour';
    const next = await client.request('venture.about.read', { text: 'I can take about ten shoots a month.', before });
    expect(next.offers.map((offer) => offer.unit)).toEqual(['hour', 'piece', 'month']);
    await expect(client.request('venture.about.read', { text: 'More.', before: { ...before, plan: { ...before.plan, offers: [{ ...before.plan.offers[0]!, unit: 'kilo' as never }] } } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });

  it('a read with offers always has a name, and a plan label sent back as the card\'s name is never returned', async () => {
    const client = await withAi();
    // No place in the words, so the stand-in AI proposes no name: code builds one from the first offer.
    const first = await client.request('venture.about.read', { text: 'I run a small weekend photography studio.' });
    expect(first.name).toBe(first.offers[0]!.name);
    const stuck = await client.request('venture.about.read', { text: 'I can take about ten shoots a month.', before: beforeOf(first, 'I run a small weekend photography studio.', { name: 'Creative studio' }) });
    expect(stuck.name).toBe(first.offers[0]!.name);
    const own = await client.request('venture.about.read', { text: 'I can take about ten shoots a month.', before: beforeOf(first, 'I run a small weekend photography studio.', { name: 'Pune Weekend Shoots' }) });
    expect(own.name).toBe('Pune Weekend Shoots');
    // Without an AI, work outside the listed fields is named from the owner's own words.
    const plain = createFakeClient(new FakeEngine({ fresh: true }));
    const potter = await plain.request('venture.about.read', { text: 'I make pottery by hand, mostly mugs and bowls, for cafes in Pune.' });
    expect([potter.ownOffers, potter.name]).toEqual([true, 'Pottery']);
  });

  it('each proposed agent names a department, its digest covers it, and it is hired there', async () => {
    const client = await withAi();
    const read = await client.request('venture.about.read', { text: STUDIO });
    expect(read.team!.map((agent) => [agent.name, agent.department])).toEqual([['Asha', 'sales'], ['Kabir', 'sales'], ['Meera', 'operations']]);
    for (const agent of read.team!) {
      expect(Object.keys(agent)).toEqual(['name', 'job', 'duties', 'reads', 'department', 'digest']);
      expect(agent.digest).toBe(teamCardDigest(agent as never));
    }
    // A follow-up returns the cards as they are, departments and all.
    expect((await client.request('venture.about.read', { text: 'I can take about ten shoots a month.', before: beforeOf(read, STUDIO) })).team).toEqual(read.team);
    const sample = createFakeClient(new FakeEngine());
    const hired = await sample.request('venture.agents.hire.team', { agents: read.team! });
    expect(hired.hired.map((view) => [view.role?.name, view.department])).toEqual([['Asha', 'sales'], ['Kabir', 'sales'], ['Meera', 'operations']]);
    const team = await sample.request('venture.team.list', {});
    expect(team.agents.filter((agent) => agent.hired).map((agent) => [agent.name, agent.department])).toEqual([['Asha', 'sales'], ['Kabir', 'sales'], ['Meera', 'operations']]);
    // A card changed after its digest is not the card the owner read.
    await expect(sample.request('venture.agents.hire.team', { agents: [{ ...read.team![0]!, name: 'Dev', department: 'marketing' }] })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
  });

  it('the agents that will do each order are named beside the way: a playbook\'s own, else the one delivery agent', async () => {
    expect(fakeOrderAgents(TRANSLATOR, classify)).toEqual({ flagship: true, agents: [{ name: 'Translator', does: 'Drafts each source block with the locked glossary.' }, { name: 'Checker', does: 'Reads meaning and flags uncertainty without changing the source.' }], code: [] });
    expect(fakeOrderAgents('I repair ACs.', () => 'local-services')).toEqual({ flagship: false, agents: [{ name: 'Bookings agent', does: DELIVERY_JOB }] });
    expect(fakeOrderAgents('I make pottery.', classify)).toEqual({ flagship: false, agents: [{ name: 'Delivery agent', does: OWN_ORDER_JOB }] });
    const client = await withAi();
    const read = await client.request('venture.about.read', { text: TRANSLATOR });
    expect(read.way).toBeTruthy();
    expect(read.orderAgents!.map((agent) => agent.name)).toEqual(['Translator', 'Checker']);
    // Keywords and a tile carry none: there is no way to show them beside.
    const plain = createFakeClient(new FakeEngine({ fresh: true }));
    expect((await plain.request('venture.about.read', { text: TRANSLATOR })).orderAgents).toBeUndefined();
    expect((await plain.request('venture.about.pick', { familyId: 'writing' })).orderAgents).toBeUndefined();
  });

  it('a follow-up\'s reply is what changed, by code: nothing, or the rename the owner asked for', async () => {
    const client = await withAi();
    const first = await client.request('venture.about.read', { text: STUDIO });
    const same = await client.request('venture.about.read', { text: 'I can take about ten shoots a month.', before: beforeOf(first, STUDIO) });
    expect(same.reply).toBe(`I did not change the plan. ${READY_LINE}`);
    const renamed = await client.request('venture.about.read', { text: 'Call the first offer Family portraits.', before: beforeOf(first, STUDIO) });
    expect(renamed.reply).toBe(`I renamed ${first.offers[0]!.name} to Family portraits. ${READY_LINE}`);
  });
});

describe('fake plan: units on the kept card, on the plan and on the sheet', () => {
  async function kept(offers: { name: string; line: string; unit?: string }[]) {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    await client.request('workspace.create', { name: 'Lucknow AC Service', pack: 'services', folder: null });
    await client.request('venture.create', { idea: 'I repair and service ACs and fridges in Lucknow for offices.', countryCode: 'IN', workingName: 'Lucknow AC Service' });
    let view = await client.request('venture.interview.next', { useTemplate: true });
    for (let guard = 0; guard < 12; guard++) {
      const question = view.interview.questions.find((q) => q.answer === null);
      if (!question) break;
      const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0]!.id } : question.id === 'q_tax' ? { yes: false, assumed: true } : { skipped: true };
      view = await client.request('venture.interview.answer', { questionId: question.id, answer: answer as never });
    }
    const plan = await client.request('venture.blueprint.draft', { useTemplate: true, shown: { name: 'Lucknow AC Service', by: 'template', offers } } as never);
    return { client, plan };
  }
  const pricing = (plan: { blueprint: { offers: { name: { value: string }; pricing: { model: string; quantityUnit: string } }[] } }) => plan.blueprint.offers.map((offer) => [offer.name.value, offer.pricing.model, offer.pricing.quantityUnit]);

  it('keeps each offer in the unit the card showed, and the owner changes it on the plan with the engine\'s words', async () => {
    const { client, plan } = await kept([{ name: 'AC and fridge repairs', line: 'Repairs for homes and offices.', unit: 'visit' }, { name: 'Yearly maintenance contracts', line: 'Planned maintenance for offices.', unit: 'year' }, { name: 'Monthly service plan', line: 'A visit every month.', unit: 'month' }]);
    expect(pricing(plan)).toEqual([['AC and fridge repairs', 'project', 'visit'], ['Yearly maintenance contracts', 'project', 'year'], ['Monthly service plan', 'monthly', 'month']]);
    const update = (patch: unknown) => client.request('venture.blueprint.update', { patch } as never);
    expect(pricing(await update({ offers: [{ id: 'offer_1', unit: 'hour' }] }))[0]).toEqual(['AC and fridge repairs', 'hourly', 'hour']);
    expect(pricing(await update({ offers: [{ id: 'offer_1', unit: 'piece' }] }))[0]).toEqual(['AC and fridge repairs', 'project', 'piece']);
    const choose = { code: 'INVALID_VENTURE_REQUEST', message: 'Choose per project, per month, per year, per hour, per visit, per piece, per set, per minute, per word or per page.' };
    await expect(update({ offers: [{ id: 'offer_1', unit: 'kilo' }] })).rejects.toMatchObject(choose);
    await expect(update({ offers: [{ id: 'offer_1', unit: 'year', pricingModel: 'monthly' }] })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Send the unit or the way of charging, not both.' });
    const added = await update({ addOffer: { name: 'Gas refill', description: 'A refill during a visit.', pricingModel: 'project', unit: 'piece' } });
    expect(pricing(added).at(-1)).toEqual(['Gas refill', 'project', 'piece']);
    await expect(update({ addOffer: { name: 'Night call', description: 'A late visit.', pricingModel: 'monthly', unit: 'visit' } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'A price per visit is charged per project.' });
    // A card with no units is per project, as before; a unit outside the list is refused.
    expect(pricing((await kept([{ name: 'AC repairs', line: 'Repairs for homes.' }])).plan)).toEqual([['AC repairs', 'project', 'project']]);
    await expect(kept([{ name: 'AC repairs', line: '', unit: 'kilo' }])).rejects.toMatchObject(choose);
  });

  it('the plan sheet prices each offer in its unit, lists the agents that do each order, and says how an order goes', async () => {
    const { client, plan } = await kept([{ name: 'Yearly maintenance contracts', line: 'Planned maintenance for offices.', unit: 'year' }]);
    const priced = await client.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', unitPrice: '2100' }] } });
    const sheet = await client.request('venture.queue.view', { kind: 'plan', id: priced.blueprint.id });
    const lines = (heading: string) => sheet.sections.find((section) => section.heading === heading)?.lines ?? [];
    expect(lines('What you sell')[0]).toMatch(/^Yearly maintenance contracts: .* per year\. /);
    expect(JSON.stringify(sheet.sections)).not.toContain('per project');
    // The agent that will do each order, said to join when the plan is accepted.
    expect(lines('Your team')[0]).toBe(`${fakeOrderAgents(plan.blueprint.name.value, () => plan.blueprint.serviceType).agents[0]!.name}: ${fakeOrderAgents(plan.blueprint.name.value, () => plan.blueprint.serviceType).agents[0]!.does} ${ORDER_AGENT_JOINS}`);
    expect(OWN_ORDER_LINES.length).toBe(4);
  });
});
