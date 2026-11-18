// Words that said two things at once in the newest Windows build (15 Nov 2026, third round):
//   - a hired agent's "Can do" page: "Works: Lists possible cafe customers" beside "Off: Can't search the web, find
//     customers or contact anyone";
//   - its chat sent the owner to "Clients, Find customers" while a search card was already waiting on Today;
//   - Monid's row said "Use the public map search, which needs nothing" right under the note that the map does not fit
//     a business whose customers are not places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { owner, seedBlueprint, setup } from './venture-views-env.ts';
import { ANSWER_INSTRUCTIONS, searchWaitingOf } from '../runtime/venture/agents/answer.ts';
import { HIRED_PAGE_WORDS, hiredCapabilityPage } from '../runtime/venture/agents/hired-capabilities.ts';
import { leadsFindPropose, leadsFindView } from '../runtime/venture/customers/find-methods.ts';
import { MEANWHILE_NO_MAP, NO_LEAD_TOOL, NO_LEAD_TOOL_ONLY, sourceRows } from '../runtime/venture/customers/find-words.ts';
import { neededGroups } from '../runtime/venture/core/needs-data.ts';
import { ownerSet } from '../runtime/venture/core/owner.ts';
import { currentVenture } from '../runtime/venture/records.ts';

const PLACES = { customer: 'Cafes in Pune that buy handmade tableware in bulk', reach: 'Visit them with samples.', teamDoes: 'Finds cafes and drafts each note.', youDo: 'Visit and send each note.', firstWeek: ['Price the tableware sets.'] };
const PEOPLE = { customer: 'YouTube creators and small production houses pay for Hindi-English translation and video subtitles.', reach: 'Find potential YouTube creators through contacts you provide.', teamDoes: 'Drafts each message.', youDo: 'Send each message.', firstWeek: ['Prepare sample subtitles.'] };
const BRIEF = { who: 'Cafes that buy handmade tableware in bulk', place: 'Pune', category: 'amenity=cafe', count: 3, source: { kind: 'public-map' as const } };

async function ready() {
  const env = await setup();
  await seedBlueprint(env, { status: 'accepted', price2: '250000' });
  return env;
}

test('a duty that sounds like a search says what the agent really does: it lists what a search found or the owner added', () => {
  const page = hiredCapabilityPage({ id: 'hire_1', duties: ['Lists possible cafe customers', 'Lists cafes in Pune from public listings', 'Lists cafe leads for you to review.', 'Tracks lead follow ups', 'Lists your clients\' open orders', 'Lists who owes you each week'], reads: [{ read: 'clients' }] });
  assert.equal(HIRED_PAGE_WORDS.listsOnly, 'Only the ones a search found or you added: it does not search.');
  assert.deepEqual(page.canDo.slice(0, 6), [
    `Lists possible cafe customers. ${HIRED_PAGE_WORDS.listsOnly}`,
    `Lists cafes in Pune from public listings. ${HIRED_PAGE_WORDS.listsOnly}`,
    `Lists cafe leads for you to review. ${HIRED_PAGE_WORDS.listsOnly}`,
    'Tracks lead follow ups.',
    'Lists your clients\' open orders.',
    'Lists who owes you each week.',
  ]);
  // The page no longer says it works at what the same page says is off.
  assert.match(page.off.join(' '), /Can't search the web, find customers or contact anyone\./);
  for (const line of page.canDo) if (/customers|listings|leads for/.test(line) && /^Lists/.test(line) && !/your clients/.test(line)) assert.match(line, /it does not search\.$/, line);
});

test('the chat is told of a search that already waits on Today, so it names that card and not the way to start one', async () => {
  const env = await ready();
  const ventureId = currentVenture(env.store.read())!.id;
  assert.equal(searchWaitingOf(env.store.read(), ventureId), null, 'no card, nothing is said');
  const proposed = await leadsFindPropose(env.deps, owner, { brief: BRIEF });
  const waiting = searchWaitingOf(env.store.read(), ventureId);
  assert.equal(waiting, proposed.title);
  assert.equal(waiting, 'Find possible customers: cafes in Pune');
  for (const words of [/When searchWaiting is given/, /already waits on Today for the owner's approval/, /name it/, /not to Clients/]) assert.match(ANSWER_INSTRUCTIONS, words);
  // The standing way to start a search is still said for when none waits.
  assert.match(ANSWER_INSTRUCTIONS, /the owner starts it from Clients, under Find customers/);
  assert.doesNotMatch(ANSWER_INSTRUCTIONS, /—/);
});

test('customers who are not places: no line recommends the public map', async () => {
  const offered = [{ id: 'monid', name: 'Monid', about: 'Finds people and companies.' }];
  // The map fits: the standing words, as before.
  const fits = sourceRows([], offered);
  assert.equal(fits[1]!.meanwhile, 'Use the public map search, which needs nothing.');
  // It does not: the row says what really works meanwhile.
  const not = sourceRows([], offered, { mapFits: false });
  assert.equal(not[1]!.meanwhile, MEANWHILE_NO_MAP);
  assert.equal(MEANWHILE_NO_MAP, 'Add people you already know in Clients.');
  assert.doesNotMatch(JSON.stringify(not.filter(row => row.id !== 'public-map')), /public map/i);
  const saved = sourceRows([{ id: 'srv_1', name: 'My lead tool' }], [], { mapFits: false });
  assert.equal(saved[1]!.meanwhile, MEANWHILE_NO_MAP);

  const env = await ready();
  await ownerSet(env.deps, owner, { way: PLACES });
  const places = await leadsFindView(env.deps, owner, {});
  assert.equal(places.note, NO_LEAD_TOOL);
  assert.match(places.sources[1]!.meanwhile!, /public map search/);
  await ownerSet(env.deps, owner, { way: PEOPLE });
  const people = await leadsFindView(env.deps, owner, {});
  assert.match(people.mapNote!, /^The public map lists places only/);
  assert.equal(people.note, NO_LEAD_TOOL_ONLY);
  assert.equal(NO_LEAD_TOOL_ONLY, 'No lead tool is connected.');
  assert.equal(people.sources.find(source => source.id === 'monid')!.meanwhile, MEANWHILE_NO_MAP);
  // The services step lists the same rows: Monid's way under the map's note says the same.
  const groups = neededGroups(['find-customers'], 'IN', [], people.sources, { 'find-customers': people.mapNote! });
  const monid = groups[0]!.ways.find(way => way.id === 'monid')!;
  assert.equal(monid.meanwhile, MEANWHILE_NO_MAP);
  assert.doesNotMatch(`${monid.meanwhile} ${monid.waitsOn}`, /public map/i);
});
