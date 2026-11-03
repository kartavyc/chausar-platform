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

// A1 re-review, as core/blueprint.ts aboutReadCalled: the AI's label stands only when the AI read the owner first.
describe('fake plan draft: who wrote the kept card', () => {
  async function keep(withAi: boolean, named: (callId: string | undefined) => string | undefined = (callId) => callId, offers?: { name: string; line: string }[]) {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    const key = ['test', 'key', 'value'].join('-');
    let callId: string | undefined;
    let answered = [{ name: 'Party photos', line: 'Photos of the party.' }];
    if (withAi) {
      await client.request('venture.ai.connect', { presetId: 'openai-gpt-6-luna', consentDigest: 'consent-openai', apiKey: key, tiers: ['fast', 'main'] } as never);
      const read = await client.request('venture.about.read', { text: 'I run a small weekend photography studio in Pune.' });
      expect(read.source).toBe('ai');
      callId = read.callId;
      answered = read.offers.map((offer) => ({ name: offer.name, line: offer.line }));
    }
    await client.request('workspace.create', { name: 'Kept Shop', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: 'Photography for parties and shops in Pune', countryCode: 'IN' } as never);
    let view = await client.request('venture.interview.next', { useTemplate: true });
    for (const question of view.interview.questions) view = await client.request('venture.interview.answer', { questionId: question.id, answer: question.required ? (question.kind === 'yesno' ? { yes: false } : { choiceId: question.choices[0]!.id }) : { skipped: true } } as never);
    const id = named(callId);
    const shown = { name: 'Pune Frames Studio', by: 'model' as const, ...(id ? { callId: id } : {}), offers: offers ?? answered };
    return (await client.request('venture.blueprint.draft', { useTemplate: true, shown })).blueprint;
  }
  it('labels the words the AI’s only after an AI about read, else the template’s', async () => {
    expect((await keep(true)).source).toBe('model');
    const plain = await keep(false);
    expect(plain.source).toBe('template');
    // A1 final check: the card must name the read that reached this business; another id, or none, is template.
    expect((await keep(true, () => 'modelcall_about_lost')).source).toBe('template');
    expect((await keep(true, () => undefined)).source).toBe('template');
    expect(plain.offers[0]!.name.by).toBe('template');
  });
  it('A2: the AI label needs the offers that read answered; a card with other offers is template', async () => {
    expect((await keep(true, (callId) => callId, [{ name: 'Wedding films', line: 'Films of the wedding day.' }])).source).toBe('template');
  });
  it('A2: refuses a bad call id before the offers, in the engine order', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    await client.request('workspace.create', { name: 'Kept Shop', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: 'Photography for parties and shops in Pune', countryCode: 'IN' } as never);
    const four = ['a', 'b', 'c', 'd'].map((letter) => ({ name: `Offer ${letter}`, line: 'Plain words.' }));
    await expect(client.request('venture.blueprint.draft', { useTemplate: true, shown: { name: 'Pune Frames', by: 'model', callId: 'bad id!', offers: four } } as never))
      .rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Send the id of the reading that wrote the plan.' });
  });
});
