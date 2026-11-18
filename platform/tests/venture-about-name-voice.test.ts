// Two things the first live run on a Mac showed (14 Nov 2026). A potter's business was named "Service business", the
// built-in plan's label, everywhere: the AI read now proposes a short plain name from the owner's own words, checked by
// code, which the owner can type over. And the words the AI wrote about the team came out in the owner's voice turned
// around ("Drafts sales materials for my approval"): the screens speak to the owner as "you", so the AI is asked for
// that voice and code turns the rest, while the hire check reads both voices the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ABOUT_INSTRUCTIONS, aboutTask } from '../runtime/venture/core/about.ts';
import { keptBusinessName } from '../runtime/venture/core/business-name.ts';
import { ownerVoice } from '../runtime/venture/core/owner-voice.ts';
import { checkTeamHire } from '../runtime/venture/agents/hire-check.ts';
import { keptTeamWith, teamCardDigest } from '../runtime/venture/agents/team-proposal.ts';
import { assertSchemaSafe } from '../runtime/venture/models/schema.ts';
import { engineFor, connectPair } from './fixtures/venture/compose-unit/harness.ts';
import { anthropicEntry } from './fixtures/venture/compose-unit/plans.ts';

const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';
const WAY = {
  customer: 'Cafe owners in Pune who buy tableware in bulk.',
  reach: 'A list of cafes in Pune, then a first message you send to each one.',
  teamDoes: 'Drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make the pottery, set the prices and send each message.',
  firstWeek: ['Decide the designs and your price for each offer.', 'Approve the first list of cafes.'],
};
const OFFERS = [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes' }];
const answer = (change: Record<string, unknown> = {}) => ({ familyId: null, professionId: null, offers: OFFERS, countryCode: null, evidence: null, reply: 'Where are you based?', way: WAY, team: [], ...change });
const role = (job: string, duties: string[]) => ({ name: 'Mira', job, duties, reads: ['plan'], department: 'operations' });

test('a business name the AI proposes is kept only when it is short, plain and claims nothing', () => {
  for (const good of ['Koregaon Park Pottery', "Asha's pottery", 'Pune Mug Studio', 'Rao & Sons Tiffins']) assert.equal(keptBusinessName(good), good);
  assert.equal(keptBusinessName('  Koregaon   Park Pottery '), 'Koregaon Park Pottery');
  for (const [why, bad] of [
    ['nothing', ''], ['one letter', 'K'], ['not text', 42], ['null', null],
    ['too long', 'The Koregaon Park Handmade Pottery and Tableware Studio of Pune'],
    ['too many words', 'Koregaon Park Mugs Bowls And Plates'],
    ['a link', 'potter.example.com'], ['a link', 'https://pots.example'],
    ['two lines', 'Koregaon Park\nPottery'],
    ['a number', 'Pottery 24x7'], ['an amount', 'Mugs under ₹500'],
    ['a claim', 'Best Pune Pottery'], ['a claim', 'Certified Pottery Studio'], ['a claim', "Pune's Number One Potter"], ['a claim', 'Guaranteed Returns Desk'],
    ['a legal form nobody registered', 'Pune Pottery Pvt Ltd'], ['a legal form nobody registered', 'Rao Advisors LLP'],
    ['a hard stop', 'Stock Tips Daily'], ['a hard stop', 'Fake Reviews Shop'],
  ] as const) assert.equal(keptBusinessName(bad), null, `${why}: ${String(bad)}`);
});

test('the name is part of the About you task: a strict field, one short instruction, and a bad name never fails the read', () => {
  const task = aboutTask({ text: POTTER, file: null });
  assert.doesNotThrow(() => assertSchemaSafe(task.schema));
  const schema = task.schema as any;
  assert.deepEqual(schema.properties.name, { type: ['string', 'null'] });
  assert.ok(schema.required.includes('name'));
  assert.match(ABOUT_INSTRUCTIONS, /As name, propose a short plain name for the business from the owner words, with no claims\./);
  // The name is proposed, never asked for: the reply's own rule says so, beside the country (venture-about-loose-ends.test.ts).
  assert.match(ABOUT_INSTRUCTIONS, /Never ask for their country \(Chausar reads it itself\), a business name or anything they already said\./);
  assert.equal(task.validate(answer({ name: 'Koregaon Park Pottery' })).name, 'Koregaon Park Pottery');
  // A bad name is never kept, and the read is never left without one: code builds a plain name from the owner's own
  // words (core/business-name.ts fallbackBusinessName; "I make pottery by hand" gives "Pottery").
  for (const bad of ['Best Pune Pottery', null, 7, 'potter.example.com']) {
    const kept = task.validate(answer({ name: bad }));
    assert.equal(kept.name, 'Pottery', String(bad));
    assert.deepEqual(kept.offers, OFFERS);
  }
  // An answer written before the field existed still stands, named the same way.
  assert.equal(task.validate(answer()).name, 'Pottery');
});

test('about.read carries the name beside offers and an idea; a listed field with no AI keeps its own label', async t => {
  const { engine } = await engineFor(t, { responses: [
    anthropicEntry('decide', answer({ name: 'Koregaon Park Pottery' }), [POTTER]),
    anthropicEntry('decide', answer({ name: 'Best Pune Pottery' }), [POTTER]),
    anthropicEntry('decide', answer({ offers: [], way: { customer: '', reach: '', teamDoes: '', youDo: '', firstWeek: [] }, name: 'Koregaon Park Pottery' }), [POTTER]),
  ] });
  const plain = await engine.request('venture.about.read', { text: 'I am a chartered accountant and I file GST returns for small shops.' }) as any;
  assert.equal(plain.source, 'keywords');
  assert.equal(plain.name, undefined);
  await connectPair(engine);
  assert.equal((await engine.request('venture.about.read', { text: POTTER }) as any).name, 'Koregaon Park Pottery');
  assert.equal((await engine.request('venture.about.read', { text: POTTER }) as any).name, 'Pottery', 'a name with a claim is dropped for a plain one from the owner\'s words');
  assert.equal((await engine.request('venture.about.read', { text: POTTER }) as any).name, undefined, 'no name without something to sell');
});

test('the owner voice: words the AI wrote about the owner are said to the owner, as every screen speaks', () => {
  for (const [written, shown] of [
    ['Drafts sales materials for my approval', 'Drafts sales materials for your approval'],
    ['Reminds me about follow-ups', 'Reminds you about follow-ups'],
    ['Lists design choices from my notes', 'Lists design choices from your notes'],
    ['Flags replies that need my attention', 'Flags replies that need your attention'],
    ['Prepares what I ask for', 'Prepares what you ask for'],
    ['Checks the list when I am away', 'Checks the list when you are away'],
    ["Tracks what I'm waiting on", "Tracks what you're waiting on"],
    ['I approve and send every message myself.', 'You approve and send every message yourself.'],
    ['My contacts and public sources. I send each message.', 'Your contacts and public sources. You send each message.'],
    ['Find cafes through contacts I provide, then prepare outreach for my approval.', 'Find cafes through contacts you provide, then prepare outreach for your approval.'],
    // Already in that voice, or about nobody: unchanged, so the turn is safe to run twice.
    ['Drafts quotes for your approval.', 'Drafts quotes for your approval.'],
    ['Tracks order status', 'Tracks order status'],
    ['Lists home and family customers', 'Lists home and family customers'],
  ] as const) {
    assert.equal(ownerVoice(written), shown);
    assert.equal(ownerVoice(shown), shown);
  }
});

test('the hire check reads both voices the same: the owner is "me" in their own words and "you" in the AI\'s', () => {
  const passes = (duty: string) => assert.doesNotThrow(() => checkTeamHire(role('Keeps the lead list.', [duty]) as never, { agentNames: [] }), duty);
  const refused = (duty: string, code: string) => assert.throws(() => checkTeamHire(role('Keeps the lead list.', [duty]) as never, { agentNames: [] }), { code }, duty);
  for (const [mine, yours] of [
    ['Reminds me about follow-ups', 'Reminds you about follow-ups'],
    ['Tells me when a client replies', 'Tells you when a client replies'],
    ['Sends me the weekly list', 'Sends you the weekly list'],
    ['Asks me before anything goes out', 'Asks you before anything goes out'],
    ['Shares the summary with me', 'Shares the summary with you'],
    ['Posts the update once I approve', 'Posts the update once you approve'],
    ['Flags replies that need my attention', 'Flags replies that need your attention'],
    ['Lists invoices for me to send', 'Lists invoices for you to send'],
  ] as const) { passes(mine); passes(yours); passes(ownerVoice(mine)); assert.equal(ownerVoice(mine), yours); }
  // Outward acts stay refused in either voice.
  for (const duty of ['Reminds clients to pay', 'Sends quotes to cafes', 'Emails your clients each week', 'Sends invoices without your approval', 'Sends invoices without asking you']) refused(duty, 'HIRE_FLOOR');
  refused('Promotes your legal practice online', 'HIRE_HARD_STOP');
});

test('a proposed team comes out in the owner voice, each card with the digest of the words the owner reads', () => {
  const written = [
    { name: 'Arun', job: 'Drafts sales materials for my approval', duties: ['Drafts offer descriptions from my notes', 'Reminds me about follow-ups'], reads: ['plan', 'notes'] },
    { name: 'Leena', job: 'Tracks pottery orders', duties: ['Tracks order status', 'Flags replies that need my attention'], reads: ['orders'] },
  ];
  const team = keptTeamWith(checkTeamHire, written);
  assert.deepEqual(team.map(({ digest: _digest, ...agent }) => agent), [
    { name: 'Arun', job: 'Drafts sales materials for your approval', duties: ['Drafts offer descriptions from your notes', 'Reminds you about follow-ups'], reads: ['plan', 'notes'], department: 'sales' },
    { name: 'Leena', job: 'Tracks pottery orders', duties: ['Tracks order status', 'Flags replies that need your attention'], reads: ['orders'], department: 'operations' },
  ]);
  for (const agent of team) assert.equal(agent.digest, teamCardDigest(agent));
  // A hard stop written in the owner's voice is still caught before the words are turned.
  assert.deepEqual(keptTeamWith(checkTeamHire, [{ ...written[1], duties: ['Drafts posts that advertise my legal practice'] }]), []);
  // The AI is asked for that voice in the first place, for the team and the way alike.
  assert.match(ABOUT_INSTRUCTIONS, /says "you" for the owner, never "me"/);
  assert.doesNotMatch(ABOUT_INSTRUCTIONS, /calls the owner "me"/);
});

test('the way the AI proposes is said to the owner too', () => {
  const task = aboutTask({ text: POTTER, file: null });
  const kept = task.validate(answer({ way: { ...WAY, reach: 'Find cafes through contacts I provide, then prepare outreach for my approval.', youDo: 'I set my own prices and send every message myself.', firstWeek: ['Define the mugs I want to sell.'] } }));
  assert.equal(kept.way!.reach, 'Find cafes through contacts you provide, then prepare outreach for your approval.');
  assert.equal(kept.way!.youDo, 'You set your own prices and send every message yourself.');
  assert.deepEqual(kept.way!.firstWeek, ['Define the mugs you want to sell.']);
});

test('about.read says when the profession question has nothing to ask: a field, no listed profession, and no tool switched off', async t => {
  const { ownKindOfWork } = await import('../runtime/venture/core/about.ts');
  assert.equal(ownKindOfWork('creative', null), true);
  assert.equal(ownKindOfWork('creative', 'photographer'), false);
  assert.equal(ownKindOfWork(null, null), false, 'work outside the listed fields has no question to skip');
  // An advocate's outreach is off: in that field the owner still picks, so the rule is never missed.
  assert.equal(ownKindOfWork('licensed', null), false);
  const { engine } = await engineFor(t, { responses: [
    anthropicEntry('decide', answer({ familyId: 'creative' }), [POTTER]),
    anthropicEntry('decide', answer({ familyId: 'creative', professionId: 'photographer' }), [POTTER]),
    anthropicEntry('decide', answer({ familyId: 'licensed' }), [POTTER]),
  ] });
  const plain = await engine.request('venture.about.read', { text: 'Freelance video editing and design work for creators.' }) as any;
  assert.equal(plain.ownKind, undefined, 'keywords read nothing, so the owner is asked');
  await connectPair(engine);
  assert.equal((await engine.request('venture.about.read', { text: POTTER }) as any).ownKind, true);
  assert.equal((await engine.request('venture.about.read', { text: POTTER }) as any).ownKind, undefined);
  assert.equal((await engine.request('venture.about.read', { text: POTTER }) as any).ownKind, undefined);
});
