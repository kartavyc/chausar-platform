// Ink v2 wave 4, package 4J8 ("Add this to {business}"): offers the owner adds to the plan. A suggestion may propose one
// (words and how it is charged, never a price); the owner applies it with venture.blueprint.update { addOffer } and
// accepts the plan. The offer is a venture-owner-offer record with a stable id, so "Rewrite with AI" keeps it with its
// price; it starts with no price, so Today's "Set your prices" names it; the owner can take it out again (removeOffer),
// unless an open order uses it. A flagship playbook's own offers stay as they are. Synthetic recordings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintModelOutput, BlueprintView, Json, ModelHttpRequest, ModelProcessRequest, ModelReplayFixture, PlanSuggestionView } from '../runtime/venture/contracts.ts';
import { DOG_COMPOSE, DOG_DECIDE, DOG_TEXT, MODELS, planEntries, replay } from './fixtures/venture/compose-unit/plans.ts';
import { PASSPHRASE, compose, connectPair, engineFor } from './fixtures/venture/compose-unit/harness.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const ASK = 'Add night walks for vets who work night shifts.';
const NIGHT = { name: 'Night walks', description: 'Late walks while you are on a night shift.', pricingModel: 'project' as const };

/** An Anthropic Messages answer for one purpose on the main tier, as a replay entry. */
function entry(purpose: 'plan-suggest' | 'blueprint', value: unknown, mustInclude: string[] = []): ModelReplayFixture['responses'][number] {
  return {
    purpose, kind: 'anthropic-messages', model: MODELS.main, status: 200, mustInclude,
    body: {
      id: `msg_synthetic_${purpose}`, type: 'message', role: 'assistant', model: MODELS.main,
      content: [{ type: 'text', text: JSON.stringify(value) }], stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 900, output_tokens: 300 },
    } as Json,
  };
}

/** The AI's words for "Rewrite with AI" on the dog walking plan: its own two offers and four steps, no added offer. */
const REWRITE: Omit<BlueprintModelOutput, 'approvals'> = {
  name: 'Shift Paws Leeds', oneLiner: 'Dog walks around the shifts nurses work in Leeds.', customer: 'Nurses in Leeds on long or late shifts.',
  offers: [
    { id: 'offer_1', name: 'Weekly walks', description: 'Regular walks on the days you work.' },
    { id: 'offer_2', name: 'Holiday cover', description: 'Daily visits while you are away.' },
  ],
  steps: [
    { id: 'step_1', title: 'Agree the walk times' }, { id: 'step_2', title: 'Walk the dogs' },
    { id: 'step_3', title: 'Reply to owners' }, { id: 'step_4', title: 'Get paid' },
  ],
};

async function business(t: any, extra: ModelReplayFixture['responses']) {
  const inner = replay([...planEntries(DOG_TEXT, DOG_DECIDE, DOG_COMPOSE), ...extra]);
  const transport = { replay: true, http: (request: ModelHttpRequest) => inner.http(request), process: (request: ModelProcessRequest) => inner.process(request) };
  const { engine } = await engineFor(t, { transport });
  await connectPair(engine);
  const { plan } = await compose(engine, DOG_TEXT, 'GB');
  await engine.request('workspace.create', { name: 'Shift Paws Leeds', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: DOG_TEXT, countryCode: 'GB', workingName: 'Shift Paws Leeds', composeId: plan.composeId, composedDigest: plan.digest });
  return engine;
}

const latest = async (engine: any) => (await engine.request('venture.blueprint.get', {}) as BlueprintView).blueprint;

test('owner offers: suggested, applied and accepted; named by Set your prices; kept with its price by Rewrite with AI; then taken out', async t => {
  const suggestion = { oneLiner: DOG_COMPOSE.oneLiner, customer: DOG_COMPOSE.customer, offers: DOG_COMPOSE.offers.map((offer, index) => ({ id: `offer_${index + 1}`, name: offer.name, description: offer.description })), addOffers: [NIGHT] };
  const engine = await business(t, [entry('plan-suggest', suggestion, ['chausar-plan-suggest-v1']), entry('blueprint', REWRITE), entry('blueprint', REWRITE)]);
  const suggested = await engine.request('venture.blueprint.suggest', { text: ASK }) as PlanSuggestionView;
  assert.deepEqual(suggested.patch, { addOffer: NIGHT }, 'only the new offer: the other words came back the same');
  assert.deepEqual(suggested.changes.map(change => [change.field, change.after, change.line]), [
    ['offer-added', 'Night walks', 'A new offer, Night walks, charged per project: Late walks while you are on a night shift. It has no price until you set one.'],
  ]);

  // Applied by the owner, bound to the plan it read, then accepted.
  const applied = (await engine.request('venture.blueprint.update', { patch: suggested.patch, basedOn: suggested.basedOn }) as BlueprintView).blueprint;
  const added = applied.offers.at(-1)!;
  assert.deepEqual([added.id, added.addedByOwner, added.name, added.description, added.pricing.model, added.pricing.unitPriceMinor, added.block], [
    'offer_own_1', true, { value: 'Night walks', label: 'told-by-you', by: 'owner' }, { value: NIGHT.description, label: 'told-by-you', by: 'owner' }, 'project', null, undefined,
  ]);
  assert.deepEqual(applied.offers.slice(0, -1).map(offer => offer.id), ['offer_1', 'offer_2'], "the plan's own offers stay as they were");
  await engine.request('venture.blueprint.accept', { digest: applied.digest });

  // It has no price, so Today's setup row names it.
  const setup = (await engine.request('venture.queue.list', {}) as any).rows.find((row: any) => row.kind === 'setup' && /no price yet/.test(row.line));
  assert.ok(setup && /Night walks/.test(setup.line), JSON.stringify(setup));

  // The owner prices it and accepts; Rewrite with AI keeps it, its words and its price.
  const priced = (await engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_own_1', unitPrice: '1500' }] } }) as BlueprintView).blueprint;
  await engine.request('venture.blueprint.accept', { digest: priced.digest });
  const rewritten = (await engine.request('venture.blueprint.draft', {}) as BlueprintView).blueprint;
  assert.equal(rewritten.oneLiner.value, REWRITE.oneLiner, 'the AI rewrote the plan');
  const kept = rewritten.offers.find(offer => offer.id === 'offer_own_1')!;
  assert.deepEqual([kept.addedByOwner, kept.name.value, kept.name.label, kept.pricing.unitPriceMinor, kept.pricing.model], [true, 'Night walks', 'told-by-you', '150000', 'project']);

  // Taken out again: gone from the plan, and the next rewrite does not bring it back.
  const removed = (await engine.request('venture.blueprint.update', { patch: { removeOffer: { id: 'offer_own_1' } } }) as BlueprintView).blueprint;
  assert.equal(removed.offers.some(offer => offer.id === 'offer_own_1'), false);
  await engine.request('venture.blueprint.accept', { digest: removed.digest });
  assert.equal((await engine.request('venture.blueprint.draft', {}) as BlueprintView).blueprint.offers.some(offer => offer.id === 'offer_own_1'), false);
  // A later offer never takes the old id.
  const again = (await engine.request('venture.blueprint.update', { patch: { addOffer: { ...NIGHT, name: 'Weekend walks' } } }) as BlueprintView).blueprint;
  assert.equal(again.offers.at(-1)!.id, 'offer_own_2');
});

test('owner offers: words hold no price or number, the plan\'s own offers stay, and an open order keeps its offer in', async t => {
  const engine = await business(t, []);
  for (const addOffer of [
    { ...NIGHT, description: 'Late walks for a small fee.' }, { ...NIGHT, name: 'Walks at five' }, { ...NIGHT, description: 'Late walks from 1k.' },
    { ...NIGHT, description: 'The first walk is on us.' },
  ]) {
    await assert.rejects(engine.request('venture.blueprint.update', { patch: { addOffer } }), (error: any) => {
      assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
      assert.match(error.message, /can't hold a price or a number\. Set the price under Set your prices\.$/);
      return true;
    }, JSON.stringify(addOffer));
  }
  for (const addOffer of [{ ...NIGHT, pricingModel: 'weekly' }, { name: 'Night walks' }, { ...NIGHT, price: '500' }]) {
    await assert.rejects(engine.request('venture.blueprint.update', { patch: { addOffer } }), code('INVALID_VENTURE_REQUEST'), JSON.stringify(addOffer));
  }
  await assert.rejects(engine.request('venture.blueprint.update', { patch: { removeOffer: { id: 'offer_1' } } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(engine.request('venture.blueprint.update', { patch: { removeOffer: { id: 'offer_own_9' } } }), code('OFFER_NOT_FOUND'));
  for (const name of ['Night walks', 'Weekend walks', 'Puppy visits', 'Vet visits', 'Key holding']) await engine.request('venture.blueprint.update', { patch: { addOffer: { ...NIGHT, name } } });
  await assert.rejects(engine.request('venture.blueprint.update', { patch: { addOffer: { ...NIGHT, name: 'Cat visits' } } }), (error: any) => {
    assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
    assert.equal(error.message, 'Your plan holds five offers you added. Take one out first.');
    return true;
  });
  const records = (await engine.request('venture.blueprint.get', {}) as BlueprintView).blueprint.offers.filter(offer => offer.addedByOwner);
  assert.deepEqual(records.map(offer => offer.id), ['offer_own_1', 'offer_own_2', 'offer_own_3', 'offer_own_4', 'offer_own_5']);

  // An open order on an added offer keeps it in the plan.
  const priced = (await engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_own_1', unitPrice: '1500' }] } }) as BlueprintView).blueprint;
  await engine.request('venture.blueprint.accept', { digest: priced.digest });
  const client = await engine.request('venture.client.add', { name: 'Meera Shah', email: 'meera@example.com', countryCode: 'GB' }) as { id: string };
  await engine.request('venture.order.create', { clientId: client.id, offerId: 'offer_own_1', request: 'Two late walks next week, please.' });
  await assert.rejects(engine.request('venture.blueprint.update', { patch: { removeOffer: { id: 'offer_own_1' } } }), (error: any) => {
    assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
    assert.equal(error.message, 'An open order uses this offer. Deliver or cancel it first.');
    return true;
  });
});

test('owner offers: on a flagship playbook\'s plan the playbook\'s offers stay untouched, and a rewrite keeps the added one', async t => {
  const { engine } = await engineFor(t, { transport: replay([]) });
  await engine.request('workspace.create', { name: 'Lumen Studio', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: 'Run a YouTube channel that explains personal finance in plain words', countryCode: 'IN', workingName: 'Lumen Studio' });
  let interview = await engine.request('venture.interview.next', { useTemplate: true }) as any;
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await engine.request('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = (await engine.request('venture.blueprint.draft', { useTemplate: true }) as BlueprintView).blueprint;
  const playbookOffers = drafted.offers.map(offer => ({ id: offer.id, playbookOffer: offer.playbookOffer, name: offer.name, description: offer.description }));
  const added = (await engine.request('venture.blueprint.update', { patch: { addOffer: { name: 'Podcast clips', description: 'Clips from a podcast for coaches.', pricingModel: 'project' } } }) as BlueprintView).blueprint;
  assert.deepEqual(added.offers.filter(offer => !offer.addedByOwner).map(offer => ({ id: offer.id, playbookOffer: offer.playbookOffer, name: offer.name, description: offer.description })), playbookOffers);
  const rewritten = (await engine.request('venture.blueprint.draft', { useTemplate: true }) as BlueprintView).blueprint;
  assert.deepEqual(rewritten.offers.filter(offer => !offer.addedByOwner).map(offer => ({ id: offer.id, playbookOffer: offer.playbookOffer, name: offer.name, description: offer.description })), playbookOffers);
  assert.deepEqual(rewritten.offers.filter(offer => offer.addedByOwner).map(offer => [offer.id, offer.name.value]), [['offer_own_1', 'Podcast clips']]);

  // An order on the added offer takes intake as the playbook's own offer does: on YouTube, the footage rights.
  const priced = (await engine.request('venture.blueprint.update', { patch: { offers: rewritten.offers.map(offer => ({ id: offer.id, unitPrice: '1500' })) } }) as BlueprintView);
  assert.ok(priced.intake?.offer_own_1?.rights.length, 'the plan asks the added offer\'s intake, rights included');
  await engine.request('venture.blueprint.accept', { digest: priced.blueprint.digest });
  const client = await engine.request('venture.client.add', { name: 'Meera Shah', email: 'meera@example.com', countryCode: 'IN' }) as { id: string };
  const order = (intake?: unknown) => engine.request('venture.order.create', { clientId: client.id, offerId: 'offer_own_1', request: 'Clips from my podcast episode, please.', ...(intake ? { intake } : {}) });
  await assert.rejects(order(), code('RIGHTS_REQUIRED'));
  await assert.rejects(order({ format: 'long' }), code('RIGHTS_REQUIRED'));
  const made = await order({ rights: { basis: 'own-footage', holder: 'Meera Shah' }, format: 'long' }) as { intake?: { rights?: { basis: string; recordedAt: string } } };
  assert.equal(made.intake?.rights?.basis, 'own-footage');
  assert.ok(made.intake?.rights?.recordedAt, 'the rights are recorded at intake');
});
