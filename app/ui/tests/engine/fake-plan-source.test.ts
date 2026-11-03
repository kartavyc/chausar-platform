import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// One-shot A1 (row 3), as the engine's core/blueprint.ts: words the owner writes make the plan the owner's, so
// "Written from built-in templates, not by AI" shows only on a plan the templates wrote; a price changes no words.
describe('fake plan source', () => {
  it('a price leaves the source; a name, an offer word or an added offer makes it the owner\'s', async () => {
    const client = createFakeClient(new FakeEngine());
    const start = (await client.request('venture.blueprint.get', {}))!.blueprint;
    const offer = start.offers.find((item) => item.pricing.unitPriceMinor !== null) ?? start.offers[0]!;
    const priced = await client.request('venture.blueprint.update', { patch: { offers: [{ id: offer.id, unitPrice: '4500' }] } });
    expect(priced.blueprint.source).toBe(start.source);
    const named = await client.request('venture.blueprint.update', { patch: { name: 'Pune Frames Studio' } });
    expect(named.blueprint.source).toBe('owner');
  });
});

// A1 re-review, as core/blueprint.ts blueprintDraft: the kept card goes only with the built-in plan.
describe('fake plan draft with the kept card', () => {
  it('refuses shown without useTemplate, in the engine words', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    await client.request('workspace.create', { name: 'Kept Shop', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: 'Photography for parties and shops in Pune', countryCode: 'IN' } as never);
    const shown = { name: 'Pune Frames Studio', by: 'model' as const, offers: [{ name: 'Party photos', line: 'Photos of the party.' }] };
    await expect(client.request('venture.blueprint.draft', { shown })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'The plan you kept is saved with the built-in plan only.' });
    await expect(client.request('venture.blueprint.draft', { useTemplate: false, shown })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'The plan you kept is saved with the built-in plan only.' });
  });
});
