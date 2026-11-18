// What the newest Windows build showed with a real AI (15 Nov 2026, third round): "Call the first offer Cafe mug sets,
// and I do not sell to hotels yet." added "Cafe mug sets" as a new offer and left "Handmade pottery for cafes" where it
// was; an agent was taken off the team after a message about capacity; and the sentence that says what changed mixed
// two voices ("It is just you and one helper, we can do about six visits a day."). Each is held by code here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aboutTask } from '../runtime/venture/core/about.ts';
import { aboutBefore, cardOffersKept, cardTeamKept } from '../runtime/venture/core/about-before.ts';
import { followUpReply, planChanges } from '../runtime/venture/core/about-reply.ts';
import { renamesAsked } from '../runtime/venture/core/offer-rename.ts';
import { ownerVoice } from '../runtime/venture/core/owner-voice.ts';
import { KEEPER_JOINS } from '../runtime/venture/agents/order-agents-core.ts';
import { KEEPER_NAME } from '../runtime/venture/views/keeper.ts';
import { planSections, ORDER_AGENT_JOINS, type PlanParts } from '../runtime/venture/views/plan-sections.ts';
import { OFFER_UNITS, UNIT_WORDS, UNIT_CHOICE_LINE, isOfferUnit, modelOfUnit, speaksOfUnit } from '../runtime/venture/core/offer-units.ts';

const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';
const MORE = 'I can make about 200 pieces a month and I am in Koregaon Park.';
const RENAME = 'Call the first offer Cafe mug sets, and I do not sell to hotels yet.';
const WAY = {
  customer: 'Cafes and hotels in Pune pay for handmade mugs and bowls in bulk.',
  reach: 'A list of cafes and hotels in Pune, then a first message you send to each one.',
  teamDoes: 'Drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make the pottery, set the prices and send each message.',
  firstWeek: ['Decide the designs and your price for each offer.', 'Approve the first list of cafes.', 'Send the first messages.'],
};
// The potter's card on Windows, as the AI wrote it.
const CAFES = { name: 'Handmade pottery for cafes', line: 'Handmade mugs and bowls made in bulk for cafes.' };
const HOTELS = { name: 'Handmade pottery for hotels', line: 'Handmade mugs and bowls made in bulk for hotels.' };
const SETS = { name: 'Cafe mug sets', line: 'Sets of handmade mugs for cafes.', unit: 'set' as const };
const LEADS = { name: 'Lead finder', job: 'Keeps your list of possible cafe customers.', duties: ['Lists possible cafe customers', 'Tracks lead follow ups'], reads: ['clients', 'trackers'], department: 'sales' };
const ORDERS = { name: 'Order coordinator', job: 'Keeps pottery order details in one place for you.', duties: ['Tracks pottery order status for you', 'Flags late order steps for you'], reads: ['orders', 'notes'], department: 'operations' };
const card = (change: Record<string, unknown> = {}) => aboutBefore({
  turns: [{ from: 'owner', text: POTTER }, { from: 'you', text: 'What quantities can you make?' }],
  plan: { familyId: null, professionId: null, name: 'Pune Handmade Pottery', offers: [CAFES, HOTELS].map(offer => ({ ...offer, kept: true, yours: false })), way: WAY, team: [LEADS, ORDERS].map(agent => ({ ...agent, left: false })), ...change },
});
const answer = (change: Record<string, unknown> = {}) => ({ familyId: null, professionId: null, offers: [CAFES, HOTELS], countryCode: null, evidence: null, reply: 'Which glazes do you offer?', way: WAY, team: [LEADS, ORDERS], needs: [], name: 'Pune Handmade Pottery', ...change });
const names = (offers: readonly { name: string }[]) => offers.map(offer => offer.name);

// ---------------------------------------------------------------------------
// Item 2: a rename the owner asks for is read by code
// ---------------------------------------------------------------------------

test('a rename by position or by exact name is read by code; anything else is left to the AI', () => {
  const live = [CAFES, HOTELS, { name: 'Bulk bowls' }];
  const asked = (said: string) => renamesAsked(said, live).renames.map(rename => [rename.at, rename.to]);
  assert.deepEqual(asked(RENAME), [[0, 'Cafe mug sets']]);
  assert.equal(renamesAsked(RENAME, live).rest, 'and I do not sell to hotels yet.', 'the rest of the message is still read');
  assert.deepEqual(asked('Please rename the second offer to Hotel bowl sets.'), [[1, 'Hotel bowl sets']]);
  assert.deepEqual(asked('name the last offer "Big serving bowls" please'), [[2, 'Big serving bowls']]);
  assert.deepEqual(asked('Call my first one Mugs and bowls for cafes'), [[0, 'Mugs and bowls for cafes']], 'an "and" inside a name stays in it');
  assert.deepEqual(asked('Change the name of the third offer to Serving bowls and add a tea set too.'), [[2, 'Serving bowls']]);
  assert.deepEqual(asked('Rename Handmade pottery for hotels to Hotel tableware.'), [[1, 'Hotel tableware']]);
  assert.deepEqual(asked('rename "bulk bowls" as Soup bowls'), [[2, 'Soup bowls']], 'the exact name, in any case');
  assert.deepEqual(asked('Call the first offer cafe mug sets'), [[0, 'Cafe mug sets']], 'a name starts with a capital');
  assert.deepEqual(asked('Call the first offer Cafe mugs. Rename the second offer to Hotel mugs.'), [[0, 'Cafe mugs'], [1, 'Hotel mugs']]);
  // Not safely readable: no such place, a name that is not on the card, an amount in the name, nothing asked.
  for (const said of ['Call the fourth offer Tea sets.', 'Rename the mugs to Studio mugs.', 'Call the first offer Mugs at 500 rupees', 'Call it Pune Pottery.', 'Rename the business to Pune Pottery.', MORE,
    'Call the first offer Handmade pottery for hotels.', 'Call the first offer x']) assert.deepEqual(asked(said), [], said);
  assert.equal(renamesAsked(MORE, live).rest, MORE);
});

test('"Call the first offer Cafe mug sets" renames the first offer, whatever the AI did with it', () => {
  const before = card();
  // What the AI did on Windows: a new offer, the first one left, the hotels offer gone.
  assert.deepEqual(cardOffersKept(before, RENAME, [CAFES, SETS]), [SETS], 'renamed in place, with the line and unit the AI wrote for the new name; hotels went at the owner\'s word');
  // The AI did it right: nothing to mend.
  assert.deepEqual(cardOffersKept(before, RENAME, [SETS, HOTELS]), [SETS, HOTELS]);
  // The AI ignored the rename: code applies it. The old line still fits a name that names the same thing.
  assert.deepEqual(cardOffersKept(before, 'Call the first offer Cafe pottery sets.', [CAFES, HOTELS]), [{ ...CAFES, name: 'Cafe pottery sets' }, HOTELS]);
  // A new name that is another thing: the old line is not kept under it.
  assert.deepEqual(cardOffersKept(before, 'Call the first offer Glaze workshops.', [CAFES, HOTELS])[0], { name: 'Glaze workshops', line: '' });
  // The AI wrote the new name somewhere else and kept everything: the old first offer goes, nothing is added.
  assert.deepEqual(names(cardOffersKept(before, 'Call the first offer Cafe mug sets.', [CAFES, HOTELS, SETS])), ['Cafe mug sets', HOTELS.name]);
  // The AI used the rename to drop or add another offer: neither stands, since the message says nothing of them.
  assert.deepEqual(names(cardOffersKept(before, 'Call the first offer Cafe mug sets.', [SETS])), ['Cafe mug sets', HOTELS.name], 'an offer the message does not speak of is put back');
  assert.deepEqual(names(cardOffersKept(before, 'Call the first offer Cafe mug sets.', [SETS, HOTELS, { name: 'Glaze workshops', line: 'Workshops.' }])), ['Cafe mug sets', HOTELS.name], 'nor is one added');
  assert.deepEqual(names(cardOffersKept(before, 'Call the first offer Cafe mug sets and add glaze workshops too.', [SETS, HOTELS, { name: 'Glaze workshops', line: 'Workshops.' }])), ['Cafe mug sets', HOTELS.name, 'Glaze workshops'], 'one the rest of the message asks for stands');
  // The second offer by position, with the first dropped unasked: both hold their places.
  assert.deepEqual(names(cardOffersKept(before, 'Rename the second offer to Hotel tableware.', [{ name: 'Hotel tableware', line: 'Tableware for hotels.' }])), [CAFES.name, 'Hotel tableware']);
  // The line of an offer the rename is not about is not reworded because of it.
  assert.equal(cardOffersKept(before, 'Call the first offer Cafe mug sets.', [SETS, { ...HOTELS, line: 'Mug sets for hotels.' }])[1]!.line, HOTELS.line);
});

test('the reply says "I renamed A to B" for a rename the owner asked for, and nothing about offers that did not change', () => {
  const before = card();
  const after = { offers: cardOffersKept(before, RENAME, [CAFES, SETS]), way: WAY, team: [LEADS, ORDERS] };
  assert.equal(followUpReply({ before, said: RENAME, after, reply: 'Which glazes do you offer?' }),
    'I renamed Handmade pottery for cafes to Cafe mug sets. I took out Handmade pottery for hotels. Which glazes do you offer?');
  const kept = { offers: cardOffersKept(before, 'Call the first offer Cafe mug sets.', [CAFES, HOTELS, SETS]), way: WAY, team: [LEADS, ORDERS] };
  assert.equal(followUpReply({ before, said: 'Call the first offer Cafe mug sets.', after: kept, reply: null }), 'I renamed Handmade pottery for cafes to Cafe mug sets. The plan looks ready to keep.');
  // A rename further down, after an offer above it went at the owner's word: still a rename, not "added" and "took out".
  const three = card({ offers: [CAFES, HOTELS, { name: 'Bulk bowls', line: 'Bowls in bulk.' }].map(offer => ({ ...offer, kept: true, yours: false })) });
  const said = 'Call the last offer Soup bowls, and I do not sell to hotels yet.';
  const moved = cardOffersKept(three, said, [CAFES, { name: 'Soup bowls', line: 'Soup bowls in bulk.' }]);
  assert.deepEqual(names(moved), [CAFES.name, 'Soup bowls']);
  assert.deepEqual(planChanges(three.plan, { offers: moved, way: WAY, team: [LEADS, ORDERS] }, said).slice(0, 2), ['I renamed Bulk bowls to Soup bowls.', 'I took out Handmade pottery for hotels.']);
});

test('about.read: the potter\'s third message renames the first offer in the answer the owner gets', () => {
  const task = aboutTask({ text: RENAME, file: null, before: card() });
  const kept = task.validate(answer({ offers: [CAFES, SETS] }));
  assert.deepEqual(names(kept.offers), ['Cafe mug sets']);
  assert.match(kept.reply!, /^I renamed Handmade pottery for cafes to Cafe mug sets\. I took out Handmade pottery for hotels\./);
  assert.doesNotMatch(kept.reply!, /I added the offer/);
});

// ---------------------------------------------------------------------------
// Item 2: an agent on the card is held the way an offer is
// ---------------------------------------------------------------------------

test('an agent goes only when the owner\'s message speaks of it or of its work, or the owner left it out', () => {
  const before = card();
  const back = (agent: { name: string }) => ({ ...agent });
  const kept = (said: string, team: readonly { name: string }[], from = before) => cardTeamKept(from, said, team, back).map(agent => agent.name);
  // Seen on Windows: a message about capacity, and "I took Order coordinator off the team".
  assert.deepEqual(kept(MORE, [LEADS]), ['Lead finder', 'Order coordinator']);
  assert.deepEqual(kept('It is just me and one helper, we can do about six visits a day.', [ORDERS]), ['Lead finder', 'Order coordinator'], 'put back in its own place');
  // One shared word is by chance ("orders" in a message about something else); the agent stays.
  assert.deepEqual(kept('Most orders come in winter.', [LEADS]), ['Lead finder', 'Order coordinator']);
  // The owner spoke of it: by its name, by the team, or of its work in two words or more.
  assert.deepEqual(kept('I do not need the order coordinator.', [LEADS]), ['Lead finder']);
  assert.deepEqual(kept('One agent is enough for now.', [LEADS]), ['Lead finder']);
  assert.deepEqual(kept('I track order status myself in a notebook.', [LEADS]), ['Lead finder']);
  // Seen in the live check of this round: "I do not sell to hotels yet" and an agent whose whole job is hotel leads.
  // The owner said what they do not do, and it is that agent's work: one shared word is enough then.
  const hotels = { name: 'Dev', job: 'Tracks hotel leads for you.', duties: ['Lists hotel leads for you', 'Drafts hotel outreach for you'], reads: ['clients'], left: false };
  const withHotels = card({ team: [{ ...LEADS, left: false }, hotels] });
  assert.deepEqual(kept('Call the first offer Cafe mug sets, and I do not sell to hotels yet.', [LEADS], withHotels), ['Lead finder']);
  assert.deepEqual(kept('Hotels pay late, in my experience.', [LEADS], withHotels), ['Lead finder', 'Dev'], 'a plain fact with one shared word takes nobody off');
  // Replaced unasked by another agent in its place: the card's agent returns there. Asked for: the new one stands.
  const packer = { name: 'Packing planner', job: 'Keeps your packing lists.', duties: ['Lists packing materials for you'], reads: ['notes'] };
  assert.deepEqual(kept(MORE, [LEADS, packer]), ['Lead finder', 'Order coordinator']);
  assert.deepEqual(kept('I need help planning the packing lists.', [LEADS, packer]), ['Lead finder', 'Packing planner']);
  // An agent the owner left out is not put back; nor is one the hire rules no longer pass; a first read is untouched.
  const left = card({ team: [{ ...LEADS, left: false }, { ...ORDERS, left: true }] });
  assert.deepEqual(kept(MORE, [LEADS], left), ['Lead finder']);
  assert.deepEqual(cardTeamKept(before, MORE, [LEADS], () => null).map(agent => agent.name), ['Lead finder']);
  assert.deepEqual(cardTeamKept(null, MORE, [LEADS], back as never), [LEADS]);
});

// Seen in the live check of this round (15 Nov 2026, the owner's Codex): after "I can make about 200 pieces a month and
// I am in Koregaon Park" one duty came back as "Lists ..." where the card said "Finds ...", and the reply said "I
// changed what Lead agent does".
test('an agent that stays keeps its job and duties, unless the message bears on what is sold, who buys or its own work', () => {
  const before = card();
  const back = (agent: { name: string; job: string; duties: string[] }) => ({ ...agent });
  const reworded = { ...LEADS, job: 'Keeps the list of cafe prospects for you.', duties: ['Finds possible cafe customers from public records', 'Tracks lead follow ups'] };
  const kept = (said: string) => cardTeamKept(before, said, [reworded, ORDERS], back)[0]!;
  // A capacity and a place: nothing about the customers, the offers or the agent's work. The card's words hold.
  assert.deepEqual([kept(MORE).job, kept(MORE).duties], [LEADS.job, LEADS.duties]);
  // "I do not sell to hotels yet" is about who buys: what the AI corrected stands.
  assert.deepEqual(kept('I do not sell to hotels yet.').duties, reworded.duties);
  // So is a message about the agent's own work, or about the team.
  assert.deepEqual(kept('Follow ups should go out every Friday.').duties, reworded.duties);
  assert.deepEqual(kept('Make the team simpler.').duties, reworded.duties);
  // An agent whose card no longer passes the hire rules is left as the answer wrote it.
  assert.deepEqual(cardTeamKept(before, MORE, [reworded, ORDERS], () => null)[0]!.duties, reworded.duties);
  // The reply then says nothing changed for the agent.
  const task = aboutTask({ text: MORE, file: null, before: card() });
  const answered = task.validate(answer({ team: [reworded, ORDERS] }));
  assert.deepEqual(answered.team!.map(agent => agent.duties), [LEADS.duties, ORDERS.duties]);
  assert.doesNotMatch(answered.reply!, /I changed what/);
});

test('about.read: a message about capacity takes no agent off the team, and the reply does not say it did', () => {
  const task = aboutTask({ text: MORE, file: null, before: card() });
  const kept = task.validate(answer({ team: [LEADS] }));
  assert.deepEqual(kept.team!.map(agent => agent.name), ['Lead finder', 'Order coordinator']);
  assert.doesNotMatch(kept.reply!, /off the team/);
  // Asked for, it goes, and the reply says so.
  const asked = aboutTask({ text: 'I do not need the order coordinator.', file: null, before: card() }).validate(answer({ team: [LEADS] }));
  assert.deepEqual(asked.team!.map(agent => agent.name), ['Lead finder']);
  assert.match(asked.reply!, /I took Order coordinator off the team\./);
});

// ---------------------------------------------------------------------------
// Item 6: one voice in the sentence that says what changed
// ---------------------------------------------------------------------------

test('words about the owner are said to the owner, "we", "our" and "us" too', () => {
  assert.equal(ownerVoice('It is just me and one helper, we can do about six visits a day.'), 'It is just you and one helper, you can do about six visits a day.');
  assert.equal(ownerVoice('We are two people. Our kiln is small, so call us first. We\'re closed on Mondays and we\'ve no van.'), 'You are two people. Your kiln is small, so call you first. You\'re closed on Mondays and you\'ve no van.');
  assert.equal(ownerVoice('We do the firing ourselves; the glaze recipes are ours.'), 'You do the firing yourselves; the glaze recipes are yours.');
  // Safe to run twice, and words with those letters inside are left alone.
  const once = ownerVoice('We were in Pune and we\'ll deliver; we\'d rather not ship.');
  assert.equal(once, 'You were in Pune and you\'ll deliver; you\'d rather not ship.');
  assert.equal(ownerVoice(once), once);
  assert.equal(ownerVoice('Answer weekly. The hours are flexible. Use the bus.'), 'Answer weekly. The hours are flexible. Use the bus.');
  // What the team does is the team's own voice: its "we" is not the owner.
  assert.equal(ownerVoice('We draft each message for my approval.', { team: true }), 'We draft each message for your approval.');
});

test('the way the AI wrote reaches the owner in one voice, and so does the sentence that quotes it', () => {
  const said = 'It is just me and one helper, we can do about six visits a day.';
  const task = aboutTask({ text: said, file: null, before: card() });
  const kept = task.validate(answer({ way: { ...WAY, youDo: `${WAY.youDo} ${said}` } }));
  assert.equal(kept.way!.youDo, `${WAY.youDo} It is just you and one helper, you can do about six visits a day.`);
  assert.match(kept.reply!, /^I added to what you do: It is just you and one helper, you can do about six visits a day\./);
  assert.doesNotMatch(kept.reply!, /\bwe\b/i);
});

// ---------------------------------------------------------------------------
// Item 7: every agent that joins with the plan is listed
// ---------------------------------------------------------------------------

test('Keeper joins with the plan, so the plan the owner reads lists it, with what it does in plain words', () => {
  assert.equal(KEEPER_JOINS.name, KEEPER_NAME);
  assert.match(KEEPER_JOINS.does, /backups/);
  assert.match(KEEPER_JOINS.does, /not AI/);
  const parts = (joined: boolean): PlanParts => ({
    customer: { value: 'Cafes' }, serviceType: 'other', offers: [], steps: [], approvals: [],
    tax: { label: 'GST', registered: false, assumed: false, invoiceKind: 'invoice', missing: [] }, way: WAY, team: [],
    orderAgents: { agents: [{ name: 'Delivery agent', does: 'Drafts the reply to each order for you to check.' }], joined },
  } as unknown as PlanParts);
  const team = (joined: boolean) => planSections(parts(joined)).find(section => section.heading === 'Your team')!.lines;
  assert.ok(team(false).includes(`Keeper: ${KEEPER_JOINS.does} ${ORDER_AGENT_JOINS}`));
  assert.ok(team(true).includes(`Keeper: ${KEEPER_JOINS.does}`));
});

// ---------------------------------------------------------------------------
// Item 9: per word and per page
// ---------------------------------------------------------------------------

test('an offer can be priced per word or per page: one-off charges, counted in that unit', () => {
  for (const unit of ['word', 'page'] as const) {
    assert.ok(isOfferUnit(unit));
    assert.ok((OFFER_UNITS as readonly string[]).includes(unit));
    assert.equal(modelOfUnit(unit), 'project');
    assert.equal(UNIT_WORDS[unit], `per ${unit}`);
    assert.match(UNIT_CHOICE_LINE, new RegExp(`per ${unit}`));
    assert.ok(speaksOfUnit(`I charge per ${unit}.`));
  }
  assert.equal(OFFER_UNITS[0], 'project', 'the list still starts with per project');
});
