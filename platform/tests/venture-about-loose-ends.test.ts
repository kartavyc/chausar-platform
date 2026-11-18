// Four loose ends of About you, each seen live on the owner's Codex (14 and 15 Nov 2026):
//   - a product manager starting a consultancy was filed under Teaching and coaching as a "senior mentor": a field
//     attaches its own rules and templates, so the AI is told to prefer no field over a loose fit;
//   - a placeholder the AI wrote in the way ("Not yet known; where will you find and reach founders?") stayed in the
//     plan beside the facts the owner then gave: a way line holds statements only, and the question goes in the reply;
//   - the reply asked for the country it had just read from "I am in Bengaluru": the country is never asked for;
//   - after "I do not sell to hotels yet" the lines of the two untouched offers still said "for cafes and hotels": an
//     untouched offer keeps its name, and its line may change when the message bears on what the offers say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ABOUT_INSTRUCTIONS, aboutTask, keptReply } from '../runtime/venture/core/about.ts';
import { aboutBefore, cardOffersKept } from '../runtime/venture/core/about-before.ts';
import { keptWay } from '../runtime/venture/core/way.ts';

const PM = 'I am a product manager with eight years at SaaS startups. I want to start a consultancy that helps early stage founders with product strategy and roadmaps.';
const MORE = 'I am in Bengaluru and can take three clients at a time. Most of my network is fintech founders.';
const WAY = {
  customer: 'Early stage founders at SaaS startups pay for product strategy and roadmap consulting.',
  reach: 'Founders in your own network first, then founders found from public sources.',
  teamDoes: 'Drafts proposals and messages for you to approve and send, and keeps a lead list.',
  youDo: 'You bring the product experience, set your own prices and send each message.',
  firstWeek: ['Shape your strategy and roadmap service as you want it, with your own price.', 'Draft an introduction for you to approve and send.'],
};
const OFFERS = [
  { name: 'Product strategy consulting', line: 'Help early stage founders shape product strategy for their startups.' },
  { name: 'Product roadmap planning', line: 'Work with founders to create clear product roadmaps.' },
];
const answer = (change: Record<string, unknown> = {}) => ({ familyId: null, professionId: null, offers: OFFERS, countryCode: null, evidence: null, reply: 'I suggested two offers. Who will you reach first?', way: WAY, team: [], needs: [], name: null, ...change });

test('the field: the AI is told to choose one only when the work is plainly that kind, and that a loose fit is worse than none', () => {
  assert.match(ABOUT_INSTRUCTIONS, /choose a supplied profession family only when the work the owner sells is plainly that kind of work/);
  assert.match(ABOUT_INSTRUCTIONS, /a loose fit is worse than none/);
  // The list has no field for advising a business: said outright, since the nearest field brought the wrong rules live
  // (a startup advisor was filed as a financial planner, a management consultant under research).
  assert.match(ABOUT_INSTRUCTIONS, /as with advising or consulting businesses on strategy, operations or funding/);
  // Clear work outside the list still keeps its offers with no field, as before.
  assert.match(ABOUT_INSTRUCTIONS, /none of the listed families fits/);
  assert.match(ABOUT_INSTRUCTIONS, /still suggest offers/);
  const kept = aboutTask({ text: PM, file: null }).validate(answer());
  assert.equal(kept.familyId, null);
  assert.equal(kept.professionId, null);
  assert.deepEqual(kept.offers, OFFERS);
  assert.deepEqual(kept.way, WAY);
});

test('a way holds statements: a question or a "not yet known" is taken out of a line, and a line that was only that fails the way', () => {
  const placeholder = 'Not yet known; where will you find and reach founders?';
  // The live line of the follow-up: the facts stay, the placeholder goes.
  assert.equal(keptWay({ ...WAY, reach: `You are in Bengaluru. Most of your network is fintech founders. ${placeholder}` })!.reach, 'You are in Bengaluru. Most of your network is fintech founders.');
  // A line with nothing but the placeholder is no line: the way is not kept, and the read stands without one.
  assert.equal(keptWay({ ...WAY, reach: placeholder }), null);
  for (const empty of ['To be decided.', 'TBD', 'Where will you find them?', 'Not known yet. Not yet decided.']) assert.equal(keptWay({ ...WAY, customer: empty }), null, empty);
  // A step that is a question is dropped; a week of nothing else fails the way.
  assert.deepEqual(keptWay({ ...WAY, firstWeek: ['Shape your service with your own price.', 'Where will you look for founders?'] })!.firstWeek, ['Shape your service with your own price.']);
  assert.equal(keptWay({ ...WAY, firstWeek: ['Where will you look for founders?'] }), null);
  // Plain statements are untouched, with their own punctuation.
  assert.deepEqual(keptWay(WAY), WAY);
  const plain = 'Find possible cafes from public sources and contacts you provide; focus on Pune.';
  assert.equal(keptWay({ ...WAY, reach: plain })!.reach, plain);
});

test('about.read: a first answer whose reach is only a question keeps no way; a follow-up keeps the facts and drops the placeholder', () => {
  const placeholder = 'Not yet known; where will you find and reach founders?';
  const first = aboutTask({ text: PM, file: null }).validate(answer({ way: { ...WAY, reach: placeholder }, team: [{ name: 'Maya', job: 'Keeps your founder lead list current', duties: ['Lists possible founder customers'], reads: ['clients'] }] }));
  assert.equal(first.way, undefined);
  assert.equal(first.team, undefined, 'no team without a way');
  assert.equal(first.reply, 'I suggested two offers. Who will you reach first?', 'the question lives in the reply');
  const before = aboutBefore({ turns: [{ from: 'owner', text: PM }], plan: { familyId: null, professionId: null, name: null, offers: OFFERS.map(offer => ({ ...offer, kept: true, yours: false })), way: WAY, team: [] } });
  const next = aboutTask({ text: MORE, file: null, before }).validate(answer({ way: { ...WAY, reach: `You are in Bengaluru. Most of your network is fintech founders. ${placeholder}` } }));
  assert.equal(next.way!.reach, 'You are in Bengaluru. Most of your network is fintech founders.');
});

test('the instructions keep questions out of the way and out of what is already known', () => {
  assert.match(ABOUT_INSTRUCTIONS, /Write every part of way as plain statements, never a question or "not yet known"/);
  // A part the owner has not spoken of is proposed, not left empty (seen live: a way with two empty parts kept no way).
  assert.match(ABOUT_INSTRUCTIONS, /where the owner has not said, propose the usual way for such work and ask in reply/);
  // With its reason: asked without one, the AI still asked for the country in two of twelve live answers.
  assert.match(ABOUT_INSTRUCTIONS, /Never ask for their country \(Chausar reads it itself\), a business name or anything they already said\./);
  assert.doesNotMatch(ABOUT_INSTRUCTIONS, /[—–]/);
});

test('the reply never asks for the country or a business name: a question that only asks for one is taken out', () => {
  assert.equal(keptReply('I updated your reach to Bengaluru and noted you can take three clients at a time. What country is your business based in?'), 'I updated your reach to Bengaluru and noted you can take three clients at a time.');
  assert.equal(keptReply('Which country are you in? Who will you reach first?'), 'Who will you reach first?');
  // Seen live: the question hung on a statement after a semicolon, and a name was asked for instead of proposed.
  assert.equal(keptReply('I suggested separate maths and science tuition offers; what country is Indiranagar in?'), 'I suggested separate maths and science tuition offers.');
  assert.equal(keptReply('I suggested these two workshop offers. What business name would you like to use?'), 'I suggested these two workshop offers.');
  assert.equal(keptReply('What would you like to call your business? Who will you reach first?'), 'Who will you reach first?');
  // Seen live on the final pass: the country asked for together with the city of a place the owner had named.
  assert.equal(keptReply('I suggest morning yoga classes. What city and country is Koramangala in for your business?'), 'I suggest morning yoga classes.');
  // A reply that was only that question is no reply.
  assert.equal(keptReply('What country is your business based in?'), null);
  // A question about anything else stands, and so does a statement that names a country.
  for (const kept of ['Where are you based?', 'I read that you are in India. Who will you reach first?', 'Which city will you start in?', 'What name do your customers know your mugs by?', 'I kept the list; you check it first.',
    // Where the customers are is a fair question: only the owner's own country is never asked for.
    'Which country do your customers live in?', 'What country will you ship to first?']) assert.equal(keptReply(kept), kept);
  // A question that asks two things cannot be cut by code: the instruction holds it.
  const two = 'What country is your business based in, and where will you find founders to reach?';
  assert.equal(keptReply(two), two);
});

test('an untouched offer keeps its name, and its line changes only when the message bears on what the offers say', () => {
  const card = [
    { name: 'Handmade mug orders', line: 'Handmade pottery mugs for cafes and hotels.' },
    { name: 'Handmade bowl orders', line: 'Handmade pottery bowls for cafes and hotels.' },
    { name: 'Custom pottery orders', line: "Handmade pottery made to a cafe or hotel's specifications." },
  ];
  const before = aboutBefore({ turns: [{ from: 'owner', text: 'I make pottery by hand and want bulk orders from cafes and hotels in Pune.' }], plan: { familyId: null, professionId: null, name: null, offers: card.map(offer => ({ ...offer, kept: true, yours: false })), way: null, team: [] } });
  // The live case: hotels are gone, so every line that named them may be corrected, and the first offer is renamed as asked.
  const corrected = [
    { name: 'Cafe mug sets', line: 'Handmade pottery mug sets for cafes.' },
    { name: 'Handmade bowl orders', line: 'Handmade pottery bowls for cafes.' },
    { name: 'Custom pottery orders', line: "Handmade pottery made to a cafe's specifications." },
  ];
  assert.deepEqual(cardOffersKept(before, 'Call the first offer Cafe mug sets, and I do not sell to hotels yet.', corrected), corrected);
  assert.deepEqual(cardOffersKept(before, 'I do not sell to hotels yet.', [card[0]!, corrected[1]!, corrected[2]!]), [card[0], corrected[1], corrected[2]]);
  // Seen live on the second pass: one line said "hospitality businesses", shares no word with "hotels", and its
  // correction was put back. A message that bears on any offer of the card frees every line: code cannot judge what
  // is true, only whether the message is about what is sold or who buys it.
  const hospitality = aboutBefore({ turns: [{ from: 'owner', text: 'I make pottery by hand and want bulk orders from cafes and hotels in Pune.' }], plan: { familyId: null, professionId: null, name: null, offers: [card[0]!, { name: 'Bulk pottery orders', line: 'Custom bulk orders of handmade pottery for hospitality businesses.' }].map(offer => ({ ...offer, kept: true, yours: false })), way: null, team: [] } });
  const narrowed = [{ name: 'Handmade mug orders', line: 'Handmade pottery mugs for cafes.' }, { name: 'Bulk pottery orders', line: 'Custom bulk orders of handmade pottery for cafes.' }];
  assert.deepEqual(cardOffersKept(hospitality, 'I do not sell to hotels yet.', narrowed), narrowed);
  // Who pays is on the way, not always in an offer line: a message that bears on it frees the lines too.
  const WAY = { customer: 'Cafes and hotels that buy tableware in bulk.', reach: 'A list you check first.', teamDoes: 'Drafts each message.', youDo: 'Make the pottery.', firstWeek: ['Decide your prices.'] };
  const onWay = aboutBefore({ turns: [{ from: 'owner', text: 'I make pottery.' }], plan: { familyId: null, professionId: null, name: null, offers: [{ name: 'Bulk pottery orders', line: 'Custom orders for hospitality businesses.', kept: true, yours: false }], way: WAY, team: [] } });
  assert.deepEqual(cardOffersKept(onWay, 'I do not sell to hotels yet.', [{ name: 'Bulk pottery orders', line: 'Custom orders for cafes.' }]), [{ name: 'Bulk pottery orders', line: 'Custom orders for cafes.' }]);
  // A message about something else: a line the AI reworded unasked is put back, word for word.
  const churned = [card[0]!, { name: 'Handmade bowl orders', line: 'Bowls thrown in Koregaon Park.' }, card[2]!];
  assert.deepEqual(cardOffersKept(before, 'I can make about 200 pieces a month and I am in Koregaon Park.', churned), card);
  // An offer with no line yet takes the line the answer wrote.
  const bare = aboutBefore({ turns: [{ from: 'owner', text: 'I make pottery.' }], plan: { familyId: null, professionId: null, name: null, offers: [{ name: 'Cafe mug sets', line: '', kept: true, yours: true }], way: null, team: [] } });
  assert.deepEqual(cardOffersKept(bare, 'I am in Koregaon Park.', [{ name: 'Cafe mug sets', line: 'Mugs for cafes.' }]), [{ name: 'Cafe mug sets', line: 'Mugs for cafes.' }]);
  // Small words shared by the message and a line ("with", "from", "your") are no reason to change it.
  const plain = aboutBefore({ turns: [{ from: 'owner', text: 'I bake.' }], plan: { familyId: null, professionId: null, name: null, offers: [{ name: 'Party cakes', line: 'Cakes made with your own design.' }].map(offer => ({ ...offer, kept: true, yours: false })), way: null, team: [] } });
  assert.deepEqual(cardOffersKept(plain, 'I work from home with my sister.', [{ name: 'Party cakes', line: 'Cakes baked at home.' }]), [{ name: 'Party cakes', line: 'Cakes made with your own design.' }]);
});

test('the instructions let the AI correct a line the new message makes untrue, and still hold every name', () => {
  assert.match(ABOUT_INSTRUCTIONS, /Never rename an offer or an agent the message does not speak of/);
  assert.match(ABOUT_INSTRUCTIONS, /make the plan agree with the message: correct every offer line, way part and duty it makes untrue/);
  assert.match(ABOUT_INSTRUCTIONS, /marked yours/);
});
