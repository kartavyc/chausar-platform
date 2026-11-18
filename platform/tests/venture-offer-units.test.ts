// The unit an offer is priced in (seen in the real app on Windows, 15 Nov 2026: a monthly creative plan, a yearly
// maintenance contract, mug sets and subtitles were all priced "per project"). An offer is priced in one of a fixed
// list of units; the way it is charged (per month, per project, per hour) follows from the unit. The owner sets it; the
// owner's AI may suggest it for an offer it proposes, never a price, and code checks the suggestion against the list.
// Every place that shows a price reads the unit from the offer. Money stays BigInt minor units: quantity times price.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OFFER_UNIT, OFFER_UNITS, UNIT_WORDS, isOfferUnit, keptOfferUnit, modelOfUnit, speaksOfUnit, unitOfModel } from '../runtime/venture/core/offer-units.ts';
import { PRICING_MODELS, UNIT_OF } from '../runtime/venture/core/interview.ts';
import { ABOUT_INSTRUCTIONS, aboutTask } from '../runtime/venture/core/about.ts';
import { aboutBefore, cardOffersKept } from '../runtime/venture/core/about-before.ts';
import { carryOver, offerPricing } from '../runtime/venture/core/blueprint.ts';
import { FAMILIES } from '../runtime/venture/core/families.ts';
import { assertSchemaSafe } from '../runtime/venture/models/schema.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { engineFor, connectPair, answerInterview, PASSPHRASE } from './fixtures/venture/compose-unit/harness.ts';
import { anthropicEntry } from './fixtures/venture/compose-unit/plans.ts';

const TECHNICIAN = 'I repair and service ACs and fridges in Lucknow. I want yearly maintenance contracts from offices and housing societies.';
const WAY = {
  customer: 'Offices and housing societies in Lucknow pay for yearly maintenance.',
  reach: 'A list of offices and societies you check, then a proposal you send to each one.',
  teamDoes: 'Drafts each proposal and keeps track of who replied.',
  youDo: 'Do the repairs, set your own prices and send every proposal.',
  firstWeek: ['Decide what a yearly contract covers and your price for it.', 'Approve the first list of offices.'],
};
const answer = (offers: unknown[], change: Record<string, unknown> = {}) => ({ familyId: 'local-services', professionId: null, offers, countryCode: null, evidence: null, reply: 'What does a contract cover?', way: WAY, team: [], needs: [], name: 'Lucknow AC Service', ...change });

test('the units are a fixed list; each belongs to one way of charging, and the three old units are unchanged', () => {
  assert.deepEqual([...OFFER_UNITS], ['project', 'month', 'year', 'hour', 'visit', 'piece', 'set', 'minute', 'word', 'page']);
  assert.equal(DEFAULT_OFFER_UNIT, 'project');
  // Every business made before units: its unit is its model's own, exactly as it was stored.
  for (const model of PRICING_MODELS) {
    assert.equal(unitOfModel(model), UNIT_OF[model]);
    assert.equal(modelOfUnit(UNIT_OF[model]), model);
    assert.deepEqual(offerPricing(model, null), { model, quantityUnit: UNIT_OF[model], unitPriceMinor: null, unitPriceLabel: 'not-set', defaultQuantity: '1' });
  }
  // Only a month repeats monthly and only an hour is hourly: every other unit is a one-off charge counted in that unit.
  assert.deepEqual(OFFER_UNITS.map(modelOfUnit), ['project', 'monthly', 'project', 'hourly', 'project', 'project', 'project', 'project', 'project', 'project']);
  for (const unit of OFFER_UNITS) assert.equal(UNIT_WORDS[unit], `per ${unit}`);
  assert.ok(isOfferUnit('piece') && !isOfferUnit('kilo') && !isOfferUnit(null));
  // A suggestion code does not know is per project, never a refusal.
  for (const unknown of ['kilo', '', null, undefined, 7, 'Per Piece']) assert.equal(keptOfferUnit(unknown), 'project');
  assert.equal(keptOfferUnit('minute'), 'minute');
  assert.deepEqual(offerPricing('project', '50000', 'piece'), { model: 'project', quantityUnit: 'piece', unitPriceMinor: '50000', unitPriceLabel: 'told-by-you', defaultQuantity: '1' });
});

test('the AI names a unit for each offer it proposes, from the list only, and never a price', () => {
  const task = aboutTask({ text: TECHNICIAN, file: null });
  const offer = (task.schema as any).properties.offers.items;
  assert.deepEqual(offer.required, ['name', 'line', 'unit']);
  assert.deepEqual(offer.properties.unit, { type: 'string', enum: [...OFFER_UNITS] });
  assert.doesNotThrow(() => assertSchemaSafe(task.schema));
  assert.match(ABOUT_INSTRUCTIONS, /as unit how that trade charges for it/);
  assert.match(ABOUT_INSTRUCTIONS, /prices are always set by the owner/);
  const read = task.validate(answer([
    { name: 'AC and fridge repairs', line: 'Repairs for homes and offices.', unit: 'visit' },
    { name: 'Yearly maintenance contracts', line: 'Planned maintenance for offices.', unit: 'year' },
    { name: 'Spare parts', line: 'Parts fitted during a repair.', unit: 'kilo' },
  ]));
  assert.deepEqual(read.offers.map(item => item.unit), ['visit', 'year', undefined], 'a unit outside the list is per project: an offer with no unit');
  // An answer written before units (no unit at all) still reads: every offer is per project.
  assert.deepEqual(task.validate(answer([{ name: 'AC repairs', line: 'Repairs for homes.' }])).offers, [{ name: 'AC repairs', line: 'Repairs for homes.' }]);
  assert.deepEqual(task.validate(answer([{ name: 'AC repairs', line: 'Repairs for homes.', unit: 'project' }])).offers, [{ name: 'AC repairs', line: 'Repairs for homes.' }], 'per project is written as no unit');
  // A unit is one of the list's words: an amount in its place is not kept, and the offer still is.
  assert.equal(task.validate(answer([{ name: 'AC repairs', line: 'Repairs for homes.', unit: 'Rs 500 per visit' }])).offers[0]!.unit, undefined);
});

test('in a follow-up the unit on the card holds unless the owner speaks of how the offer is charged', () => {
  const card = { turns: [{ from: 'owner', text: TECHNICIAN }], plan: { familyId: 'local-services', professionId: null, name: 'Lucknow AC Service', way: WAY, team: [],
    offers: [{ name: 'AC and fridge repairs', line: 'Repairs for homes and offices.', kept: true, yours: false, unit: 'visit' }, { name: 'Yearly maintenance contracts', line: 'Planned maintenance for offices.', kept: true, yours: false, unit: 'year' }] } };
  const before = aboutBefore(card);
  assert.deepEqual(before.plan.offers.map(item => item.unit), ['visit', 'year']);
  // What the AI is given names the unit, so it returns it with the plan.
  assert.deepEqual((aboutTask({ text: 'I have one helper.', file: null, before }).input as any).before.plan.offers.map((item: any) => item.unit), ['visit', 'year']);
  const wrote: { name: string; line: string; unit?: 'month' }[] = [{ name: 'AC and fridge repairs', line: 'Repairs for homes and offices.' }, { name: 'Yearly maintenance contracts', line: 'Planned maintenance for offices.', unit: 'month' }];
  assert.deepEqual(cardOffersKept(before, 'I have one helper and we can handle about six visits a day.', wrote).map(item => item.unit), ['visit', 'year'], 'a message about something else changes no unit');
  const bare: { name: string; line: string; unit?: 'month' }[] = wrote.map(({ name, line }) => ({ name, line }));
  assert.deepEqual(cardOffersKept(before, 'I have one helper.', bare).map(item => item.unit), ['visit', 'year'], 'also when the answer names none');
  assert.deepEqual(cardOffersKept(before, 'Charge the contracts monthly, not yearly.', [{ name: wrote[0]!.name, line: wrote[0]!.line }, wrote[1]!]).map(item => item.unit), [undefined, 'month'], 'the owner spoke of the unit, so the answer stands');
  // An offer renamed at the owner's word is a changed offer: the unit the answer gives it stands.
  assert.deepEqual(cardOffersKept(before, 'Call the first offer Cooling service plans.', [{ name: 'Cooling service plans', line: 'Planned visits for homes.', unit: 'month' as const }, bare[1]!]).map(item => [item.name, item.unit]), [['Cooling service plans', 'month'], ['Yearly maintenance contracts', 'year']]);
  assert.ok(speaksOfUnit('I charge per piece') && speaksOfUnit('bill it by the minute') && speaksOfUnit('a yearly contract') && !speaksOfUnit('I have one helper and a van'));
  // A card sent by a window that knows no units is still a card: its offers are per project.
  const old = aboutBefore({ ...card, plan: { ...card.plan, offers: card.plan.offers.map(({ unit: _unit, ...rest }) => rest) } });
  assert.deepEqual(old.plan.offers.map(item => item.unit), ['project', 'project']);
  assert.throws(() => aboutBefore({ ...card, plan: { ...card.plan, offers: [{ ...card.plan.offers[0]!, unit: 'kilo' }] } }), { code: 'INVALID_VENTURE_REQUEST' });
});

test('about.read carries each offer\'s unit; the field\'s own starting offers name theirs where the name says it', async t => {
  const { engine } = await engineFor(t, { responses: [anthropicEntry('decide', answer([{ name: 'AC and fridge repairs', line: 'Repairs for homes and offices.', unit: 'visit' }, { name: 'Yearly maintenance contracts', line: 'Planned maintenance for offices.', unit: 'year' }]), [TECHNICIAN])] });
  const plain = await engine.request('venture.about.pick', { familyId: 'creative' }) as any;
  assert.deepEqual(plain.offers.map((item: any) => [item.name, item.unit]), [['Video edits', 'piece'], ['Design work', 'piece'], ['Monthly creative plan', 'month']]);
  await connectPair(engine);
  const read = await engine.request('venture.about.read', { text: TECHNICIAN }) as any;
  assert.deepEqual(read.offers.map((item: any) => [item.name, item.unit]), [['AC and fridge repairs', 'visit'], ['Yearly maintenance contracts', 'year']]);
  // A starting offer names its unit where its own name says it; every other one is per project (no unit).
  for (const family of FAMILIES) for (const offer of family.offers) {
    assert.ok(offer.unit === undefined || (isOfferUnit(offer.unit) && offer.unit !== 'project'), `${family.id} ${offer.name}`);
    if (/^Monthly\b/.test(offer.name)) assert.equal(offer.unit, 'month', offer.name);
    if (/\bhours\b/.test(offer.name)) assert.equal(offer.unit, 'hour', offer.name);
    if (/\bvisits\b/.test(offer.name)) assert.equal(offer.unit, 'visit', offer.name);
  }
});

// Found in the real app (16 Nov 2026): picking "Teaching and coaching" with no words gave "Weekly classes", "One to one
// sessions" and "Progress reports", each "per project". A starting offer that is not a project carries the unit that fits
// it, from the units the engine knows; only one piece of work with a start and an end stays per project.
test('each field\'s starting offers carry the unit that fits them; only real projects are per project', async t => {
  const units: Record<string, [string, string][]> = {
    'money-tax': [['Monthly books', 'month'], ['GST returns', 'month'], ['Income tax returns', 'year']],
    teaching: [['Weekly classes', 'month'], ['One to one sessions', 'hour'], ['Progress reports', 'month']],
    creative: [['Video edits', 'piece'], ['Design work', 'piece'], ['Monthly creative plan', 'month']],
    writing: [['Blog articles', 'piece'], ['Newsletter issues', 'piece'], ['Translation', 'word']],
    'local-services': [['Booked visits', 'visit'], ['Packages', 'set'], ['Event planning', 'project']],
    documents: [['Tender responses', 'project'], ['SOPs and handbooks', 'project'], ['Project reports', 'project']],
    research: [['Research reports', 'project'], ['Monthly MIS', 'month'], ['Lead lists', 'project']],
    people: [['Resume rewrite', 'project'], ['Job search help', 'month'], ['Hiring support', 'project']],
    'shop-office': [['Support desk', 'month'], ['Marketplace listings', 'month'], ['Assistant hours', 'hour']],
    tech: [['Small websites', 'project'], ['App testing', 'project'], ['IT help', 'hour']],
    licensed: [['Consultations', 'visit'], ['Follow ups', 'month'], ['Review packs', 'project']],
  };
  assert.deepEqual(Object.fromEntries(FAMILIES.map(family => [family.id, family.offers.map(offer => [offer.name, offer.unit ?? 'project'])])), units);
  // What the owner sees on the card for a field picked with no words: the unit each offer will be priced in.
  const { engine } = await engineFor(t);
  const teaching = await engine.request('venture.about.pick', { familyId: 'teaching' }) as any;
  assert.deepEqual(teaching.offers.map((item: any) => [item.name, UNIT_WORDS[(item.unit ?? 'project') as keyof typeof UNIT_WORDS]]), [['Weekly classes', 'per month'], ['One to one sessions', 'per hour'], ['Progress reports', 'per month']]);
});

/** A technician's business kept from the card, each offer with the unit the card showed. */
async function keptBusiness(t: any, offers: { name: string; line: string; unit?: string }[]) {
  const { engine } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Lucknow AC Service', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: TECHNICIAN, countryCode: 'IN', workingName: 'Lucknow AC Service' });
  await answerInterview(engine);
  const view = await engine.request('venture.blueprint.draft', { useTemplate: true, shown: { name: 'Lucknow AC Service', by: 'template', offers } }) as any;
  return { engine, view };
}
const pricing = (view: any) => view.blueprint.offers.map((offer: any) => [offer.name.value, offer.pricing.model, offer.pricing.quantityUnit]);

test('the kept card\'s offers are priced in the units it showed; a card with no units is per project as before', async t => {
  const { view } = await keptBusiness(t, [
    { name: 'AC and fridge repairs', line: 'Repairs for homes and offices.', unit: 'visit' },
    { name: 'Yearly maintenance contracts', line: 'Planned maintenance for offices.', unit: 'year' },
    { name: 'Monthly service plan', line: 'A visit every month.', unit: 'month' },
  ]);
  assert.deepEqual(pricing(view), [['AC and fridge repairs', 'project', 'visit'], ['Yearly maintenance contracts', 'project', 'year'], ['Monthly service plan', 'monthly', 'month']]);
  for (const offer of view.blueprint.offers) assert.equal(offer.pricing.unitPriceMinor, null, 'never a price from the card');
  const old = await keptBusiness(t, [{ name: 'AC and fridge repairs', line: 'Repairs for homes and offices.' }]);
  assert.deepEqual(pricing(old.view), [['AC and fridge repairs', 'project', 'project']]);
  const { engine } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Lucknow AC Service', passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: TECHNICIAN, countryCode: 'IN', workingName: 'Lucknow AC Service' });
  await answerInterview(engine);
  await assert.rejects(engine.request('venture.blueprint.draft', { useTemplate: true, shown: { name: 'Lucknow AC Service', by: 'template', offers: [{ name: 'AC repairs', line: '', unit: 'kilo' }] } }),
    { code: 'INVALID_VENTURE_REQUEST', message: 'Choose per project, per month, per year, per hour, per visit, per piece, per set, per minute, per word or per page.' });
});

test('the owner changes an offer\'s unit on the plan; its way of charging follows, and the price is never touched', async t => {
  const { engine } = await keptBusiness(t, [{ name: 'AC and fridge repairs', line: 'Repairs for homes and offices.', unit: 'visit' }, { name: 'Yearly maintenance contracts', line: 'Planned maintenance for offices.' }]);
  const update = (patch: unknown) => engine.request('venture.blueprint.update', { patch }) as Promise<any>;
  await update({ offers: [{ id: 'offer_2', unitPrice: '2100' }] });
  const yearly = await update({ offers: [{ id: 'offer_2', unit: 'year' }] });
  assert.deepEqual(pricing(yearly), [['AC and fridge repairs', 'project', 'visit'], ['Yearly maintenance contracts', 'project', 'year']]);
  assert.equal(yearly.blueprint.offers[1].pricing.unitPriceMinor, '210000', 'the owner\'s price stays as typed');
  assert.equal(yearly.blueprint.offers[1].name.value, 'Yearly maintenance contracts', 'a unit changes no words');
  // A month is charged monthly and an hour hourly; the old way of saying it still works and takes the model's own unit.
  assert.deepEqual(pricing(await update({ offers: [{ id: 'offer_2', unit: 'month' }] }))[1], ['Yearly maintenance contracts', 'monthly', 'month']);
  assert.deepEqual(pricing(await update({ offers: [{ id: 'offer_1', unit: 'hour' }] }))[0], ['AC and fridge repairs', 'hourly', 'hour']);
  assert.deepEqual(pricing(await update({ offers: [{ id: 'offer_1', pricingModel: 'project' }] }))[0].slice(1), ['project', 'project']);
  const choose = { code: 'INVALID_VENTURE_REQUEST', message: 'Choose per project, per month, per year, per hour, per visit, per piece, per set, per minute, per word or per page.' };
  await assert.rejects(update({ offers: [{ id: 'offer_1', unit: 'kilo' }] }), choose);
  await assert.rejects(update({ offers: [{ id: 'offer_1', unit: 'year', pricingModel: 'monthly' }] }), { code: 'INVALID_VENTURE_REQUEST', message: 'Send the unit or the way of charging, not both.' });
  // An offer the owner adds may name its unit; without one it is priced in its model's own, as before.
  const added = await update({ addOffer: { name: 'Gas refill', description: 'A refill during a visit.', pricingModel: 'project', unit: 'piece' } });
  assert.deepEqual(pricing(added).at(-1), ['Gas refill', 'project', 'piece']);
  await assert.rejects(update({ addOffer: { name: 'Night call', description: 'A late visit.', pricingModel: 'monthly', unit: 'visit' } }), { code: 'INVALID_VENTURE_REQUEST', message: 'A price per visit is charged per project.' });
  const plainAdd = await update({ addOffer: { name: 'Night call', description: 'A late visit.', pricingModel: 'hourly' } });
  assert.deepEqual(pricing(plainAdd).at(-1), ['Night call', 'hourly', 'hour']);
  // A later change of words keeps the added offer's unit: its record holds it.
  const reworded = await update({ offers: [{ id: 'offer_own_1', name: 'Gas refills' }] });
  assert.deepEqual(pricing(reworded).find((row: any) => row[0] === 'Gas refills'), ['Gas refills', 'project', 'piece']);
});

test('every place a price is shown reads the unit from the offer, and the calculator counts in it', async t => {
  const { engine } = await keptBusiness(t, [{ name: 'Cafe mug sets', line: 'Handmade mugs for cafes.', unit: 'set' }, { name: 'Yearly maintenance contracts', line: 'Planned maintenance for offices.', unit: 'year' }]);
  await engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_1', unitPrice: '1500' }, { id: 'offer_2', unitPrice: '2100' }] } });
  const view = await engine.request('venture.blueprint.get', {}) as any;
  const receipt = await engine.request('venture.price.quote', { offerId: 'offer_1', quantity: '12' }) as any;
  assert.equal(receipt.figures.find((figure: any) => figure.key === 'unit').label, 'Price per set');
  assert.match(receipt.explanation, /^12 x set at /);
  assert.equal(receipt.totalMinor, String(12n * 150000n), 'twelve sets at the owner\'s price, in minor units');
  // The plan the owner reads before accepting, and Today's price row.
  const sheet = await engine.request('venture.queue.view', { kind: 'plan', id: view.blueprint.id }) as any;
  const sells = sheet.sections.find((section: any) => section.heading === 'What you sell').lines;
  assert.match(sells[0], /^Cafe mug sets: .* per set\. /);
  assert.match(sells[1], /^Yearly maintenance contracts: .* per year\. /);
  assert.ok(!JSON.stringify(sheet.sections).includes('per project'));
  assert.equal(typeof (viewHandlers as any)['venture.queue.view'], 'function');
});

test('a rewrite before the plan is accepted keeps the first offer\'s unit while it is still charged the same way', () => {
  const structure = (model: 'project' | 'monthly') => ({ serviceType: 'other' as const, offers: [{ id: 'offer_1', pricing: offerPricing(model, '150000') }, { id: 'offer_2', pricing: offerPricing('project', null) }], steps: [], approvals: 2, backOffice: { taxId: null, taxState: null, sacCode: null, lutConfirmed: false, taxRegistered: { value: false, label: 'assumption', by: 'engine' }, taxRateBps: '0', taxRateBy: 'not-registered', invoiceKind: 'invoice', taxMode: 'gst', taxLabel: 'GST', currency: 'INR', taxInvoiceReady: false, taxInvoiceMissing: [], paymentRail: 'razorpay', invoicePrefix: 'INV' }, starterConnectorIds: [] }) as any;
  const previous = { offers: [{ id: 'offer_1', pricing: offerPricing('project', '150000', 'set') }, { id: 'offer_2', pricing: offerPricing('project', null, 'piece') }], backOffice: structure('project').backOffice } as any;
  const country = { code: 'IN', currency: 'INR', tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', invoiceKind: 'tax-invoice' }, paymentRails: ['razorpay'] } as any;
  const next = carryOver(structure('project'), previous, false, country);
  assert.deepEqual(next.offers.map(offer => offer.pricing.quantityUnit), ['set', 'piece']);
  // The interview now says per month: the unit of another way of charging does not follow it there.
  assert.deepEqual(carryOver(structure('monthly'), previous, false, country).offers.map(offer => offer.pricing.quantityUnit), ['month', 'piece']);
});
