// The way to earn. Onboarding used to end in up to three offers: what to sell, never how the owner earns from it. Now the
// owner's AI also proposes the way: who pays, how they are reached, what the team does, what only the owner does, and
// the first week in order. It is kept with the business, and Chats plan from it. One rule comes with it (founder, 14 Nov
// 2026): customers are not looked for or written to until what is sold is ready (the plan accepted, every offer priced
// by the owner), and then only with the owner's approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aboutTask } from '../runtime/venture/core/about.ts';
import { WAY_CAPABILITIES, WAY_FIELDS, keptWay } from '../runtime/venture/core/way.ts';
import { offerReadiness } from '../runtime/venture/core/way-ready.ts';
import { assertSchemaSafe } from '../runtime/venture/models/schema.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { engineFor, connectPair } from './fixtures/venture/compose-unit/harness.ts';
import { anthropicEntry } from './fixtures/venture/compose-unit/plans.ts';
import { answer, chatConsent, chiefBusiness, priceOffer, scriptChief, text } from './venture-chief-helpers.ts';
import { owner } from './venture-judge-helpers.ts';

const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk wholesale orders from cafes and hotels in Pune.';
const WAY = {
  customer: 'Independent cafes and small hotels in Pune that buy tableware in bulk.',
  reach: 'A list of cafes found from public listings, then a first message you send to each owner.',
  teamDoes: 'Finds the cafes, drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make the samples, set the prices, send each message and take the calls.',
  firstWeek: ['Decide the set sizes and your price for each offer.', 'Photograph three sample sets.', 'Approve the first list of cafes.', 'Send the first five messages.'],
};
const OFFERS = [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes' }];

test('the way has five plain parts, and the schema the AI is held to passes the model schema rule', () => {
  assert.deepEqual([...WAY_FIELDS], ['customer', 'reach', 'teamDoes', 'youDo']);
  const task = aboutTask({ text: POTTER, file: null });
  assert.doesNotThrow(() => assertSchemaSafe(task.schema));
  assert.ok(JSON.stringify(task.schema).includes('"firstWeek"'));
  // The AI is told what the team can really do, so the way never promises what Chausar cannot run.
  assert.deepEqual((task.input as any).capabilities, [...WAY_CAPABILITIES]);
  assert.ok(WAY_CAPABILITIES.every(line => !/\d/.test(line)));
  assert.match(task.instructions, /The first step makes what is sold ready/);
});

test('keptWay keeps a whole way as written and drops one that is thin, priced, linked or malformed', () => {
  assert.deepEqual(keptWay(WAY), WAY);
  assert.deepEqual(keptWay({ ...WAY, customer: '  Cafes   in Pune.  ' })!.customer, 'Cafes in Pune.');
  // Counts and sizes are fine; a price is the owner's to set, so a way that names one is not kept.
  assert.ok(keptWay({ ...WAY, reach: 'Write to 10 cafes that seat 40 or more.' }));
  for (const bad of [
    null, 'a way', { ...WAY, customer: '' }, { ...WAY, firstWeek: [] }, { ...WAY, firstWeek: 'Do it all.' }, { ...WAY, extra: 'x' },
    { ...WAY, youDo: 'Charge ₹500 a mug.' }, { ...WAY, reach: 'Sign up at https://example.com first.' }, { ...WAY, teamDoes: 'x'.repeat(401) },
    { ...WAY, firstWeek: [...WAY.firstWeek, 'Five.', 'Six.', 'Seven.'] }, { ...WAY, teamDoes: 'Share stock tips with guaranteed returns to clients.' },
  ]) assert.equal(keptWay(bad), null, JSON.stringify(bad).slice(0, 70));
  // Empty everywhere is how the AI says it has too little to go on yet.
  assert.equal(keptWay({ customer: '', reach: '', teamDoes: '', youDo: '', firstWeek: [] }), null);
});

test('about.read carries the way the AI proposed; a read without one, or with a broken one, still stands', async t => {
  const base = { familyId: null, professionId: null, offers: OFFERS, countryCode: null, evidence: null, reply: 'Where are you based?' };
  const { engine } = await engineFor(t, { responses: [
    anthropicEntry('decide', { ...base, way: WAY }, [POTTER, 'familyId', 'untrusted']),
    anthropicEntry('decide', { ...base, way: { ...WAY, youDo: 'Charge ₹500 a mug.' } }, [POTTER, 'familyId', 'untrusted']),
    anthropicEntry('decide', base, [POTTER, 'familyId', 'untrusted']),
  ] });
  await connectPair(engine);
  const first = await engine.request('venture.about.read', { text: POTTER }) as any;
  assert.deepEqual(first.way, WAY);
  assert.deepEqual(first.offers, OFFERS);
  const second = await engine.request('venture.about.read', { text: POTTER }) as any;
  assert.equal(second.way, undefined, 'a way that names a price is dropped, and the rest of the read stands');
  assert.deepEqual(second.offers, OFFERS);
  const third = await engine.request('venture.about.read', { text: POTTER }) as any;
  assert.equal(third.way, undefined);
});

test('the way is kept with the business, read back, replaced and taken away through the owner profile', async () => {
  const env = await chiefBusiness();
  const kept = await env.call('venture.owner.set', { way: WAY });
  assert.deepEqual(kept.way, WAY);
  assert.deepEqual((await env.call('venture.owner.get', {})).way, WAY);
  assert.deepEqual(listRecords(env.store.read(), 'venture-owner-profile').at(-1)!.way, WAY);
  // Setting another field leaves it; a broken way is refused; null takes it away.
  await env.call('venture.owner.set', { firstName: 'Asha' });
  assert.deepEqual((await env.call('venture.owner.get', {})).way, WAY);
  await assert.rejects(env.call('venture.owner.set', { way: { ...WAY, customer: '' } }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
  assert.equal((await env.call('venture.owner.set', { way: null })).way, undefined);
});

test('what is sold is ready once the plan is accepted and every offer has the owner price; until then it says what is missing', async () => {
  const env = await chiefBusiness();
  const { state, venture } = { state: env.store.read(), venture: listRecords(env.store.read(), 'venture-record')[0]! };
  const before = offerReadiness(state, venture);
  assert.equal(typeof before.ready, 'boolean');
  if (!before.ready) assert.ok(before.missing.length >= 1 && before.missing.every(line => typeof line === 'string' && line.length > 0));
  await priceOffer(env, '118400');
  const after = offerReadiness(env.store.read(), listRecords(env.store.read(), 'venture-record')[0]!);
  assert.ok(after.missing.length <= before.missing.length, 'pricing an offer never adds to what is missing');
  assert.equal(after.ready, after.missing.length === 0);
});

test('Chats plan from the kept way and are told whether what is sold is ready before customers are looked for', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  await env.call('venture.owner.set', { way: WAY });
  const tasks = scriptChief(env, [answer([text('First, set your prices.')])]);
  await env.chief('venture.chief.thread.send', { text: 'What should I do next?' });
  const business = (tasks[0]!.input as any).business;
  assert.deepEqual(business.way, WAY);
  const readiness = offerReadiness(env.store.read(), listRecords(env.store.read(), 'venture-record')[0]!);
  assert.equal(business.offerReady, readiness.ready);
  if (!readiness.ready) assert.deepEqual(business.offerMissing, readiness.missing);
  const { CHIEF_INSTRUCTIONS } = await import('../runtime/venture/chief/answer.ts');
  assert.match(CHIEF_INSTRUCTIONS, /While business\.offerReady is false/);
  assert.match(CHIEF_INSTRUCTIONS, /do not propose finding or contacting customers/);
  assert.ok(owner);
});
