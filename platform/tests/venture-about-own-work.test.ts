// Without an AI, work outside the listed fields was a dead end (seen in the real app, 15 Nov 2026): a potter who chose
// "Continue without AI for now" was told "I could not tell your field from that", and the closest field gave a template
// plan selling "Video edits". The keyword reader knows only the listed fields. Now words that are clear enough to keep
// and match no field are the plan's idea as written, with no field, and the owner names what they sell: at most one row
// is taken from their own words by code, nothing is invented, and the kept offers are labelled as told by the owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownIdea, ownOfferFrom } from '../runtime/venture/core/own-offer.ts';
import { aboutBefore, cardOffersHeld } from '../runtime/venture/core/about-before.ts';
import { FAMILIES } from '../runtime/venture/core/families.ts';
import { engineFor, PASSPHRASE } from './fixtures/venture/compose-unit/harness.ts';

const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';

/** The template interview answered as the first run answers it (places/onboarding/flow.ts answerFor). */
async function interview(engine: { request(method: string, payload?: unknown): Promise<any> }) {
  let view = await engine.request('venture.interview.next', { useTemplate: true });
  const asked = new Set<string>();
  for (let guard = 0; guard < 12; guard++) {
    const question = view.interview.questions.find((q: any) => q.answer === null && !asked.has(q.id));
    if (!question) break;
    asked.add(question.id);
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id }
      : question.id === 'q_tax' ? { yes: false, assumed: true }
        : question.id === 'q_tax_rate' ? { rate: question.prefill }
          : { skipped: true };
    view = await engine.request('venture.interview.answer', { questionId: question.id, answer });
  }
}

test('the owner\'s own words are an idea when they are clear enough to keep, and never otherwise', () => {
  assert.equal(ownIdea(POTTER), POTTER);
  assert.equal(ownIdea('  Handmade   pottery\nfor cafes '), 'Handmade pottery for cafes');
  // Too little to keep: one word, a few letters, nothing.
  for (const thin of ['', '   ', 'asdfghjklqwerty', 'Pottery', 'a b c d e f g']) assert.equal(ownIdea(thin), null, thin);
  assert.equal(ownIdea(`I make pottery ${'and more '.repeat(400)}`)!.length <= 2000, true);
});

test('a first row is taken from the owner\'s own words only where code can do that safely; else there is none', () => {
  assert.deepEqual(ownOfferFrom(POTTER), { name: 'Pottery', line: '' });
  assert.deepEqual(ownOfferFrom('I sell handmade soaps and candles online.'), { name: 'Handmade soaps', line: '' });
  assert.deepEqual(ownOfferFrom('For ten years I repair bicycles in Indiranagar.'), { name: 'Bicycles', line: '' });
  assert.deepEqual(ownOfferFrom('We bake eggless cakes for birthdays'), { name: 'Eggless cakes', line: '' });
  // Not a thing that is sold, an amount, a vague word, or no such sentence: no row, and the owner types it.
  for (const none of [
    'I make sure every client is happy.', 'I make a living from odd jobs around town.', 'I sell 500 rupee thalis near the station.',
    'I make things people like.', 'I do not make anything yet, I only repair.', 'I want to start something of my own in Pune.',
    'I sell stock tips with guaranteed returns to my friends.', 'I make it work for small shops.',
    // An adverb, a clause or a mark is no thing either.
    'I sell well in my area.', 'I sell directly to shops.', 'I sell what I bake.', 'I cook for parties.', 'I paint.', 'I sell on Amazon.',
    // A longer run of words is a sentence, not a name: nothing is taken, and it is never cut short.
    'I make hand painted pure mulberry silk scarves.',
  ]) assert.equal(ownOfferFrom(none), null, none);
  assert.deepEqual(ownOfferFrom('I make hand painted silk scarves with block prints for boutiques.'), { name: 'Hand painted silk scarves', line: '' });
  assert.deepEqual(ownOfferFrom('I print t-shirts for college fests.'), { name: 'T-shirts', line: '' });
  assert.deepEqual(ownOfferFrom('I make handmade soaps like lavender and rose.'), { name: 'Handmade soaps', line: '' });
  // Every row it makes passes the card's own rule: plain words with no digit, currency or link.
  for (const words of [POTTER, 'I sell handmade soaps and candles online.']) assert.doesNotMatch(ownOfferFrom(words)!.name, /[\p{N}\p{Sc}]|:\/\//u);
});

test('about.read without an AI: clear work outside the listed fields keeps the owner\'s words, with no field and nothing invented', async t => {
  const { engine } = await engineFor(t);
  const read = await engine.request('venture.about.read', { text: POTTER }) as any;
  assert.equal(read.source, 'keywords');
  assert.equal(read.family, null);
  assert.equal(read.profession, null);
  assert.equal(read.idea, POTTER, 'the plan starts from the owner\'s own words');
  assert.equal(read.ownOffers, true, 'the owner names what they sell');
  assert.deepEqual(read.offers, [{ name: 'Pottery', line: '' }], 'one row, from their own words');
  // The way to earn, the team and the needs are the AI's: none without one.
  for (const part of ['way', 'team', 'needs', 'reply', 'callId', 'ownKind', 'orderAgents']) assert.equal(read[part], undefined, part);
  // The name is code's, from the owner's own words, so the Name box never starts as "Service business".
  assert.equal(read.name, 'Pottery');
  // No row where code cannot take one safely: the list is empty and the owner types.
  const typed = await engine.request('venture.about.read', { text: 'I want to help families plan weekend trips around Coorg.' }) as any;
  assert.equal(typed.family, null);
  assert.equal(typed.ownOffers, true);
  assert.deepEqual(typed.offers, []);
  assert.equal(typed.idea, 'I want to help families plan weekend trips around Coorg.');
  // Too little to keep: no idea, and the card cannot be kept.
  const thin = await engine.request('venture.about.read', { text: 'qwertyuiopasdf' }) as any;
  assert.equal(thin.idea, null);
  assert.equal(thin.ownOffers, undefined);
  // A listed field still reads as before, with its template offers and no such mark.
  const listed = await engine.request('venture.about.read', { text: 'I am a chartered accountant for small shops.' }) as any;
  assert.equal(listed.family.id, 'money-tax');
  assert.equal(listed.ownOffers, undefined);
  assert.deepEqual(listed.offers, FAMILIES.find(family => family.id === 'money-tax')!.offers);
});

test('without an AI nobody changes the card: what the owner typed holds through a follow-up and through a new field', () => {
  const plan = (familyId: string | null, offers: { name: string; line: string; kept: boolean; yours: boolean }[]) => aboutBefore({ turns: [{ from: 'owner', text: POTTER }], plan: { familyId, professionId: null, name: null, offers, way: null, team: [] } });
  const mugs = { name: 'Cafe mug sets', line: 'Hand thrown mugs', kept: true, yours: true };
  const creative = FAMILIES.find(family => family.id === 'creative')!.offers.map(offer => ({ ...offer }));
  // The same field (here none): the card holds whole, and an unticked row stays out.
  assert.deepEqual(cardOffersHeld(plan(null, [mugs, { name: 'Bowls', line: '', kept: false, yours: true }]), null, [{ name: 'Pottery', line: '' }]), [{ name: 'Cafe mug sets', line: 'Hand thrown mugs' }]);
  // Nothing kept on the card yet: the base stands (the row from their words, or the field's templates).
  assert.deepEqual(cardOffersHeld(plan(null, []), null, [{ name: 'Pottery', line: '' }]), [{ name: 'Pottery', line: '' }]);
  // A new field: the owner's own rows first, then the field's templates, three at most.
  assert.deepEqual(cardOffersHeld(plan(null, [mugs]), 'creative', creative).map(offer => offer.name), ['Cafe mug sets', creative[0]!.name, creative[1]!.name]);
  // A template row the owner never typed does not follow them into another field.
  assert.deepEqual(cardOffersHeld(plan('teaching', [{ name: 'Weekly classes', line: '', kept: true, yours: false }]), 'creative', creative), creative);
  // A listed field, the same on both reads: an offer the owner renamed holds, where the templates used to come back.
  const taught = [{ name: 'Evening maths batches', line: 'Small batches with notes and practice work', kept: true, yours: true }, { name: 'One to one sessions', line: 'Focused help on what the learner needs', kept: true, yours: false }];
  assert.deepEqual(cardOffersHeld(plan('teaching', taught), 'teaching', FAMILIES.find(family => family.id === 'teaching')!.offers.map(offer => ({ ...offer }))).map(offer => offer.name), ['Evening maths batches', 'One to one sessions']);
  // A first read has no card.
  assert.deepEqual(cardOffersHeld(null, null, creative), creative);
});

test('about.read without an AI: a follow-up keeps the rows the owner typed', async t => {
  const { engine } = await engineFor(t);
  const before = { turns: [{ from: 'owner', text: POTTER }], plan: { familyId: null, professionId: null, name: null, offers: [{ name: 'Cafe mug sets', line: 'Hand thrown mugs', kept: true, yours: true }], way: null, team: [] } };
  const read = await engine.request('venture.about.read', { text: 'I can make about 200 pieces a month.', before }) as any;
  assert.equal(read.family, null);
  assert.equal(read.ownOffers, true);
  assert.deepEqual(read.offers, [{ name: 'Cafe mug sets', line: 'Hand thrown mugs' }]);
  assert.equal(read.idea, `${POTTER} I can make about 200 pieces a month.`);
});

test('about.pick: a listed field still shows its template offers, as starting examples the owner changes on the card', async t => {
  const { engine } = await engineFor(t);
  const pick = await engine.request('venture.about.pick', { familyId: 'creative', text: POTTER }) as any;
  assert.equal(pick.source, 'tile');
  assert.equal(pick.family.id, 'creative');
  assert.equal(pick.ownOffers, undefined);
  assert.deepEqual(pick.offers, FAMILIES.find(family => family.id === 'creative')!.offers);
});

test('a business kept with no AI and no field works after setup: the owner\'s offers on the plan, told by them, and the generic first moves', async t => {
  const { engine } = await engineFor(t);
  const read = await engine.request('venture.about.read', { text: POTTER }) as any;
  // The card as the owner kept it: two things they typed, one with a line.
  const card = { name: 'Koregaon Park Pottery', by: 'owner', offers: [{ name: 'Cafe mug sets', line: 'Hand thrown mugs in sets for cafes' }, { name: 'Bowls', line: '' }] };
  await engine.request('workspace.create', { name: card.name, passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: read.idea, countryCode: 'IN', workingName: card.name });
  await interview(engine);
  await engine.request('venture.blueprint.draft', { useTemplate: true, shown: card });

  const plan = (await engine.request('venture.blueprint.get', {}) as any).blueprint;
  assert.deepEqual(plan.offers.map((offer: any) => [offer.name.value, offer.description.value]), [['Cafe mug sets', 'Hand thrown mugs in sets for cafes'], ['Bowls', 'Bowls']]);
  // The owner typed them: labelled as told by the owner, never as the template's or an AI's words.
  for (const offer of plan.offers) {
    assert.deepEqual([offer.name.label, offer.name.by], ['told-by-you', 'owner']);
    assert.deepEqual([offer.description.label, offer.description.by], ['told-by-you', 'owner']);
    assert.equal(offer.pricing.unitPriceMinor, null, 'prices are the owner\'s, set later');
  }
  assert.equal(plan.source, 'template', 'the rest of the plan is the built-in one');
  assert.equal(plan.name.value, card.name);
  for (const family of FAMILIES) for (const offer of family.offers) assert.ok(!plan.offers.some((kept: any) => kept.name.value === offer.name), `${offer.name} is no template offer of this plan`);

  // The side-work question is asked for work outside the listed fields, and no field is on the profile.
  const check = await engine.request('venture.compliance.get', { profession: 'own-work' }) as any;
  assert.equal(check.profession.id, 'own-work');
  // Connect what your business needs falls back to the general list: nothing was kept.
  const needs = await engine.request('venture.needs.list', {}) as any;
  assert.deepEqual(needs.groups, []);
  assert.ok(needs.needs.length > 0);

  // Today's plan: the generic starter moves, from code alone.
  const today = await engine.request('venture.chief.plan.get', {}) as any;
  assert.deepEqual(today.moves.map((move: any) => move.text).slice(0, 3), ['Accept your plan', 'Set your prices', 'Add your first client']);
  assert.equal(today.next.title, 'Read your plan and accept it.');
  const row = (await engine.request('venture.queue.list', {}) as any).rows.find((item: any) => item.kind === 'plan');
  assert.ok(row, 'the kept plan waits on Today');
  assert.equal(row.line, 'Cafe mug sets and Bowls.');
});

test('the side-work question reads through the engine with a business open, as it does before one exists', async t => {
  const { engine } = await engineFor(t);
  const first = await engine.request('venture.compliance.get', { profession: 'own-work' }) as any;
  assert.equal(first.recorded, null);
  await engine.request('workspace.create', { name: 'Pottery', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: POTTER, countryCode: 'IN', workingName: 'Pottery' });
  // It was refused here ("This venture request is not supported"), so Business, Your profession could not open.
  const open = await engine.request('venture.compliance.get', { profession: 'own-work' }) as any;
  assert.equal(open.digest, first.digest);
  await engine.request('venture.compliance.set', { profession: 'own-work', sideWork: 'no-day-job', digest: open.digest });
  const recorded = await engine.request('venture.compliance.get', {}) as any;
  assert.equal(recorded.profession.id, 'own-work');
  assert.equal(recorded.recorded.sideWork, 'no-day-job');
});

test('the kept card says who wrote it: model, template or owner, and nothing else', async t => {
  const { engine } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Pottery', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: POTTER, countryCode: 'IN', workingName: 'Pottery' });
  await interview(engine);
  await assert.rejects(engine.request('venture.blueprint.draft', { useTemplate: true, shown: { name: 'Pottery', by: 'chausar', offers: [{ name: 'Mugs', line: '' }] } }), { code: 'INVALID_VENTURE_REQUEST', message: 'Say who wrote the plan you kept: model, template or owner.' });
  // The owner's offers are held to the same rule as any card offer: words only.
  await assert.rejects(engine.request('venture.blueprint.draft', { useTemplate: true, shown: { name: 'Pottery', by: 'owner', offers: [{ name: 'Mugs at 500', line: '' }] } }), { code: 'INVALID_VENTURE_REQUEST' });
});
