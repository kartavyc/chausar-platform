// Chausar finding customers: the search brief (customers/find-brief.ts). Who to look for, where, and with what, as
// the owner approves it. Pure functions: seeded from the kept way to earn, checked exactly, and put into the words of
// the approval card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { briefFromWords, briefWords, categoryFor, checkBrief, kindsNamed, MAP_GAPS, MAP_PLACES_ONLY, namesPlaces, PLACE_KINDS, seedBrief } from '../runtime/venture/customers/find-brief.ts';
import { OSM_TAG } from '../runtime/venture/customers/sources/osm.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

test('a kind of place is read from plain words, the most exact first; words with no public listing kind give none', () => {
  assert.equal(categoryFor('Cafes and restaurants that buy tableware in bulk'), 'amenity=cafe');
  assert.equal(categoryFor('Coffee shops near colleges'), 'amenity=cafe');
  assert.equal(categoryFor('Early stage startups that need a product plan'), 'office=it');
  assert.equal(categoryFor('Office teams who order lunch every day'), 'office=company');
  assert.equal(categoryFor('Beauty parlours and salons'), 'shop=beauty');
  assert.equal(categoryFor('Parents of school children'), 'amenity=school');
  assert.equal(categoryFor('People who love pottery'), null);
  assert.equal(categoryFor(''), null);
  assert.ok(PLACE_KINDS.every(kind => OSM_TAG.test(kind.tag) && kind.label.length > 0), 'every kind is a tag the public map search takes');
  assert.equal(new Set(PLACE_KINDS.map(kind => kind.tag)).size, PLACE_KINDS.length);
});

test('the brief is seeded from the kept way to earn and left for the owner to finish', () => {
  const seeded = seedBrief({ customer: 'Cafes in Pune that buy handmade tableware in bulk', reach: 'Visit them and send a sample photo.' }, 'India');
  assert.deepEqual(seeded, { who: 'Cafes in Pune that buy handmade tableware in bulk', place: 'Pune', category: 'amenity=cafe', count: 10, source: { kind: 'public-map' } });
  // A country is not a city, and no way kept is an empty brief the owner fills in.
  assert.equal(seedBrief({ customer: 'Startups in India that need a product plan', reach: 'Through founders I know.' }, 'India').place, '');
  assert.deepEqual(seedBrief(undefined, 'India'), { who: '', place: '', category: '', count: 10, source: { kind: 'public-map' } });
  assert.equal(seedBrief({ customer: 'People who love pottery', reach: 'Weekend markets in Navi Mumbai' }, 'India').place, 'Navi Mumbai');
});

// Found live on Windows, 15 Nov 2026 (P1-10): with no AI the kept way names no city, and "Find customers" opened with
// an empty city though the owner had written "cafes and hotels in Pune".
test('the city and the kind are also read from the owner\'s own about words, and left empty when unsure', () => {
  const potter = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';
  // No way kept: the owner's own words give the city and the kind they sell to; who to look for stays theirs to write.
  assert.deepEqual(seedBrief(undefined, 'India', potter), { who: '', place: 'Pune', category: 'amenity=cafe', count: 10, source: { kind: 'public-map' } });
  // A way that names the places but no city: its own lines lead, and the about words fill only what it lacks.
  const noCity = { customer: 'Small hotels and cafes that buy tableware in bulk.', reach: 'Visits with samples.' };
  assert.deepEqual(seedBrief(noCity, 'India', potter), { who: noCity.customer, place: 'Pune', category: 'tourism=hotel', count: 10, source: { kind: 'public-map' } });
  // Customers who are not places on a map: nothing is guessed from the about words.
  const online = { customer: 'Creators and small brands who need clean edits and designs on time.', reach: 'Through people you know and your own page.' };
  assert.deepEqual(seedBrief(online, 'India', potter), { who: online.customer, place: '', category: '', count: 10, source: { kind: 'public-map' } });
  // The way's own city and kind are never replaced by the about words.
  const kept = { customer: 'Offices and housing societies in Lucknow', reach: 'Visits and calls.' };
  assert.deepEqual([seedBrief(kept, 'India', potter).place, seedBrief(kept, 'India', potter).category], ['Lucknow', 'office=company']);
  // Unsure is empty: a language, a month or a tool after "in" is no city, and a place the owner works at is no customer.
  for (const words of ['I translate scripts in Hindi and English for creators.', 'I started in March and work in Excel.', 'I work in India for clients everywhere.']) assert.equal(seedBrief(undefined, 'India', words).place, '', words);
  assert.equal(seedBrief(undefined, 'India', 'I work at an office and teach yoga in the evenings in Indore.').category, '');
  assert.equal(seedBrief(undefined, 'India', 'I work at an office and teach yoga in the evenings in Indore.').place, 'Indore');
  assert.equal(seedBrief(undefined, 'India', 'I repair ACs and fridges and want yearly contracts with offices and housing societies in Lucknow.').category, 'office=company');
});

test('a brief is exact: who, a city, a listing kind for the public map, a count from one to fifty, and one source', () => {
  const good = { who: 'Cafes that buy tableware', place: ' Pune ', category: 'amenity=cafe', count: 10, source: { kind: 'public-map' } };
  assert.deepEqual(checkBrief(good), { ...good, place: 'Pune' });
  assert.throws(() => checkBrief({ ...good, extra: true }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkBrief({ ...good, who: '' }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkBrief({ ...good, place: 'P' }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkBrief({ ...good, place: 'Pune\nDelhi' }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkBrief({ ...good, category: 'shop=bakery];out;' }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkBrief({ ...good, category: '' }), (error: any) => code('LEAD_SOURCE_REQUIRED')(error) && /public map/.test(error.message));
  for (const count of [0, 51, 2.5, '10']) assert.throws(() => checkBrief({ ...good, count }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkBrief({ ...good, source: { kind: 'everywhere' } }), code('INVALID_VENTURE_REQUEST'));
  const connected = { who: 'Startups that need a product plan', place: 'Bengaluru', category: '', count: 20, source: { kind: 'connected', serverId: 'sample-leads', tool: 'search_companies', arguments: { query: 'startups in Bengaluru', limit: 20 } } };
  assert.deepEqual(checkBrief(connected), connected, 'a connected tool needs no listing kind');
  assert.throws(() => checkBrief({ ...connected, source: { ...connected.source, serverId: 'Bad Id' } }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkBrief({ ...connected, source: { ...connected.source, tool: '' } }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkBrief({ ...connected, source: { ...connected.source, arguments: ['a'] } }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkBrief({ ...connected, source: { ...connected.source, arguments: { text: 'x'.repeat(9000) } } }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => checkBrief({ ...connected, source: { ...connected.source, extra: 1 } }), code('INVALID_VENTURE_REQUEST'));
});

test('the chief writes a brief as plain words, "who in city", and code makes the exact brief or says why not', () => {
  assert.deepEqual(briefFromWords('cafes in Pune', ''), { brief: { who: 'cafes', place: 'Pune', category: 'amenity=cafe', count: 10, source: { kind: 'public-map' } } });
  assert.deepEqual(briefFromWords('Cafes and bakeries that buy in bulk in Navi Mumbai', '25'), { brief: { who: 'Cafes and bakeries that buy in bulk', place: 'Navi Mumbai', category: 'amenity=cafe', count: 25, source: { kind: 'public-map' } } });
  assert.match((briefFromWords('cafes', '') as { reason: string }).reason, /city/);
  assert.match((briefFromWords('people who love pottery in Pune', '') as { reason: string }).reason, /public map/);
  assert.match((briefFromWords('cafes in Pune', '500') as { reason: string }).reason, /fifty/);
  assert.match((briefFromWords('cafes in Pune', 'ten') as { reason: string }).reason, /fifty/);
});

// Found live on Windows, 15 Nov 2026: a technician whose plan sells to offices and housing societies was offered a
// search for "companies in Lucknow", and a translator whose customers are YouTube creators got a map search form.
test('the kinds follow the plan\'s own customers: offices and housing societies are kinds, in the order the plan names them', () => {
  const technician = 'Offices and housing societies pay for yearly AC and fridge maintenance; homes pay for repairs and servicing.';
  assert.deepEqual(kindsNamed(technician), ['office=company', 'building=apartments']);
  assert.equal(categoryFor('housing societies'), 'building=apartments');
  assert.equal(categoryFor('Apartment blocks and gated societies'), 'building=apartments');
  assert.equal(categoryFor('Townships and housing colonies'), 'landuse=residential');
  assert.equal(categoryFor('Tech parks and office buildings'), 'building=office');
  assert.equal(categoryFor('A flat fee for every visit'), null, 'a flat fee is not a flat');
  assert.deepEqual(kindsNamed('Cafes buying bulk pottery orders.'), ['amenity=cafe']);
  // People, channels and online businesses are not places on a map.
  const translator = 'YouTube creators and small production houses pay for Hindi-English translation and video subtitles.';
  assert.deepEqual(kindsNamed(translator), []);
  assert.equal(namesPlaces(translator), false);
  assert.equal(namesPlaces('Busy parents who want weekend tuition'), false);
  assert.equal(namesPlaces(technician), true);
  // Places of no listed kind are still places: the owner, or the chief, picks the nearest kind.
  assert.equal(namesPlaces('Local shops that need a simple website'), true);
  assert.match(MAP_PLACES_ONLY, /^The public map lists places only/);
  // The card's words for each: what the search finds, and plainly what it will not.
  const offices = briefWords({ who: 'offices', place: 'Lucknow', category: 'office=company', count: 20, source: { kind: 'public-map' } });
  assert.equal(offices.title, 'Find possible customers: company offices in Lucknow');
  assert.equal(offices.looks, `Looks on OpenStreetMap, a public map, for up to 20 company offices in Lucknow, and reads each one's own website for a contact email. ${MAP_GAPS}`);
  const societies = briefWords({ who: 'housing societies', place: 'Lucknow', category: 'building=apartments', count: 20, source: { kind: 'public-map' } });
  assert.equal(societies.title, 'Find possible customers: apartment blocks in Lucknow');
  assert.match(societies.looks, /for up to 20 apartment blocks in Lucknow.* It lists apartment blocks by name, not a housing society's office or committee\. /);
  assert.deepEqual(briefFromWords('housing societies in Lucknow', '20'), { brief: { who: 'housing societies', place: 'Lucknow', category: 'building=apartments', count: 20, source: { kind: 'public-map' } } });
  // Every added tag is on the closed list the map search takes; nothing opens "building" or "landuse" as a whole.
  for (const tag of ['building=apartments', 'building=office', 'building=commercial', 'landuse=residential']) assert.ok(OSM_TAG.test(tag), tag);
  for (const tag of ['building=yes', 'building=house', 'landuse=farmland', 'highway=residential', 'building=apartments];out;']) assert.equal(OSM_TAG.test(tag), false, tag);
  assert.throws(() => checkBrief({ who: 'Every building', place: 'Lucknow', category: 'building=yes', count: 10, source: { kind: 'public-map' } }), code('INVALID_VENTURE_REQUEST'));
});

test('the card says exactly where it looks and how many, in plain words with no em dash', () => {
  const words = briefWords({ who: 'Cafes that buy tableware', place: 'Pune', category: 'amenity=cafe', count: 10, source: { kind: 'public-map' } });
  assert.equal(words.title, 'Find possible customers: cafes in Pune');
  assert.equal(words.looks, `Looks on OpenStreetMap, a public map, for up to 10 cafes in Pune, and reads each one\'s own website for a contact email. ${MAP_GAPS}`);
  assert.equal(MAP_GAPS, 'It finds only places listed there by name, so some will be missing.');
  const tool = briefWords({ who: 'Startups that need a product plan', place: 'Bengaluru', category: '', count: 20, source: { kind: 'connected', serverId: 'sample-leads', tool: 'search_companies', arguments: { query: 'startups' } } }, 'Sample leads');
  assert.equal(tool.title, 'Find possible customers in Bengaluru with Sample leads');
  assert.equal(tool.looks, 'Calls Sample leads once, its tool search_companies, with exactly the inputs shown, keeps up to 20 of the businesses it returns, and reads each one\'s own website for a contact email.');
  assert.equal(/—/.test(JSON.stringify([words, tool])), false);
});
