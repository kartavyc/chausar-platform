import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { FAMILIES } from '../../../../platform/runtime/venture/core/families';

// Work outside the listed fields with no AI connected, as the engine answers it (core/about.ts with core/own-offer.ts;
// platform/tests/venture-about-own-work.test.ts holds the same answers): the owner's words are the idea, there is no
// field, the owner names what they sell, and the kept offers are told by the owner.
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';

describe('fake About you without an AI: work outside the listed fields', () => {
  it('keeps the owner words with no field, takes at most one row from them and invents nothing', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    expect(await client.request('venture.about.read', { text: POTTER })).toEqual({
      family: null, profession: null, offers: [{ name: 'Pottery', line: '' }], country: null, evidence: null, idea: POTTER, source: 'keywords', ownOffers: true,
      // A plain name from the owner's own words, so the Name box never starts as the plan's label (core/business-name.ts).
      name: 'Pottery',
    });
    const typed = await client.request('venture.about.read', { text: 'I want to help families plan weekend trips around Coorg.' });
    expect(typed).toEqual({ family: null, profession: null, offers: [], country: null, evidence: null, idea: 'I want to help families plan weekend trips around Coorg.', source: 'keywords', ownOffers: true });
    // Too little to keep: no idea and no mark.
    expect(await client.request('venture.about.read', { text: 'qwertyuiopasdf' })).toEqual({ family: null, profession: null, offers: [], country: null, evidence: null, idea: null, source: 'keywords' });
    // A listed field reads as before.
    const listed = await client.request('venture.about.read', { text: 'I am a chartered accountant for small shops.' });
    expect(listed.family?.id).toBe('money-tax');
    expect(listed.ownOffers).toBeUndefined();
    expect(listed.offers).toEqual(FAMILIES.find((family) => family.id === 'money-tax')!.offers);
  });

  it('a follow-up keeps the rows the owner typed, and the idea is everything they said', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    const before = { turns: [{ from: 'owner' as const, text: POTTER }], plan: { familyId: null, professionId: null, name: null, offers: [{ name: 'Cafe mug sets', line: 'Hand thrown mugs', kept: true, yours: true }], way: null, team: [] } };
    const read = await client.request('venture.about.read', { text: 'I can make about 200 pieces a month.', before });
    expect(read).toEqual({
      family: null, profession: null, offers: [{ name: 'Cafe mug sets', line: 'Hand thrown mugs' }], country: null, evidence: null,
      idea: `${POTTER} I can make about 200 pieces a month.`, source: 'keywords', ownOffers: true, name: 'Pottery',
    });
  });

  it('a picked field still shows its template offers', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    const pick = await client.request('venture.about.pick', { familyId: 'creative', text: POTTER });
    expect(pick.source).toBe('tile');
    expect(pick.ownOffers).toBeUndefined();
    expect(pick.offers).toEqual(FAMILIES.find((family) => family.id === 'creative')!.offers);
  });

  it('the kept card of typed offers is told by the owner; the rest of the plan stays the built-in one', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    await client.request('workspace.create', { name: 'Koregaon Park Pottery', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: POTTER, countryCode: 'IN' } as never);
    let view = await client.request('venture.interview.next', { useTemplate: true });
    for (const question of view.interview.questions) view = await client.request('venture.interview.answer', { questionId: question.id, answer: question.required ? (question.kind === 'yesno' ? { yes: false } : { choiceId: question.choices[0]!.id }) : { skipped: true } } as never);
    await expect(client.request('venture.blueprint.draft', { useTemplate: true, shown: { name: 'Pottery', by: 'chausar', offers: [{ name: 'Mugs', line: '' }] } } as never))
      .rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Say who wrote the plan you kept: model, template or owner.' });
    const shown = { name: 'Koregaon Park Pottery', by: 'owner' as const, offers: [{ name: 'Cafe mug sets', line: 'Hand thrown mugs in sets for cafes' }, { name: 'Bowls', line: '' }] };
    const plan = (await client.request('venture.blueprint.draft', { useTemplate: true, shown })).blueprint;
    expect(plan.offers.map((offer) => [offer.name.value, offer.description.value])).toEqual([['Cafe mug sets', 'Hand thrown mugs in sets for cafes'], ['Bowls', 'Bowls']]);
    for (const offer of plan.offers) {
      expect([offer.name.label, offer.name.by]).toEqual(['told-by-you', 'owner']);
      expect([offer.description.label, offer.description.by]).toEqual(['told-by-you', 'owner']);
      expect(offer.pricing.unitPriceMinor).toBeNull();
    }
    expect(plan.source).toBe('template');
    expect([plan.name.value, plan.name.by]).toEqual(['Koregaon Park Pottery', 'template']);
  });
});
