// Chausar lead sources shared by every business (customers/sources): collecting, ranking, and what a connected tool's
// answer may become. Pure functions; nothing here touches a network or a store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectProspects } from '../runtime/venture/customers/sources/collect.ts';
import { prospectRank, rankProspects, type Prospect } from '../runtime/venture/customers/sources/prospect.ts';
import { connectedLicence, prospectsFromTool, refuseForbiddenLeadCall } from '../runtime/venture/customers/sources/connected.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const prospect = (i: number, extra: Partial<Prospect> = {}): Prospect => ({ osmId: `node/${i}`, name: `Cafe ${i}`, address: `Road ${i}`, website: `https://cafe${i}.example`, sourceUrl: `https://www.openstreetmap.org/node/${i}`, licence: '© OpenStreetMap contributors, ODbL', ...extra });

test('collecting keeps only new, allowed prospects, up to the count, and never guesses an email', async () => {
  let asked = 0;
  const enriched: string[] = [];
  const result = await collectProspects({ count: 3, existing: [prospect(1)] }, {
    source: async count => { asked = count; return [1, 2, 3, 4, 5, 6].map(i => prospect(i)); },
    enrich: async url => {
      enriched.push(url);
      if (url.includes('cafe3')) throw new Error('robots refused');
      return { emails: [`hello@${new URL(url).hostname}`, 'blocked@elsewhere.example'], pages: [url] };
    },
    allowed: async row => row.osmId !== 'node/2' && !(row.emails ?? []).includes('blocked@elsewhere.example'),
  });
  assert.equal(asked, 3);
  assert.deepEqual(result.prospects.map(row => row.osmId), ['node/3', 'node/4', 'node/5'], 'the known one and the blocked one are left out');
  assert.deepEqual(result.prospects[0]!.emails, [], 'a site that could not be read gives no email');
  assert.deepEqual(result.prospects[1]!.emails, ['hello@cafe4.example'], 'an address the owner may not write to is not kept');
  assert.equal(result.withEmail, 2);
  assert.deepEqual(result.skipped, { known: 1, blocked: 1 });
  assert.equal(enriched.includes('https://cafe2.example'), false, 'a blocked business is not even read');
  await assert.rejects(collectProspects({ count: 0, existing: [] }, { source: async () => [], enrich: async () => ({ emails: [], pages: [] }), allowed: async () => true }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(collectProspects({ count: 51, existing: [] }, { source: async () => [], enrich: async () => ({ emails: [], pages: [] }), allowed: async () => true }), code('INVALID_VENTURE_REQUEST'));
});

test('ranking puts the most checkable first and keeps the source order within a rank', () => {
  const rows = [
    prospect(1, { website: null, address: '' }),
    prospect(2, { emails: ['owner@gmail.com'] }),
    prospect(3, { website: null }),
    prospect(4, { emails: ['hello@cafe4.example'] }),
    prospect(5),
    prospect(6, { emails: ['team@mail.cafe6.example'] }),
  ];
  assert.deepEqual(rows.map(prospectRank), [0, 3, 1, 4, 2, 4]);
  const ranked = rankProspects(rows);
  assert.deepEqual(ranked.map(row => row.osmId), ['node/4', 'node/6', 'node/2', 'node/5', 'node/3', 'node/1']);
  assert.notEqual(ranked[0], rows[3], 'the rows are copies');
  assert.equal(rows[0]!.osmId, 'node/1', 'the input keeps its order');
});

test('a connected tool answer becomes prospects only from what it holds: a name and a web page, never a made-up contact', () => {
  const answer = { content: [{ type: 'text', text: JSON.stringify({ results: [
    { name: 'Lotus Cafe', website: 'https://lotus.example/', email: 'Hello@Lotus.example', address: '12 Lake Road, Pune' },
    { title: 'Brew Room', url: 'https://brew.example/about', location: { city: 'Pune' } },
    { name: 'No page here', email: 'x@nopage.example' },
    { name: 'Bad email', website: 'https://bad.example', email: 'not an email' },
    { name: 'Odd link', website: 'ftp://files.example' },
    { company: 'Second Lotus', domain: 'lotus.example' },
    'just words',
  ] }) }] };
  const rows = prospectsFromTool(answer, { server: 'Sample leads' });
  assert.deepEqual(rows.map(row => row.name), ['Lotus Cafe', 'Brew Room', 'Bad email', 'Second Lotus']);
  assert.deepEqual(rows[0], { osmId: null, name: 'Lotus Cafe', address: '12 Lake Road, Pune', website: 'https://lotus.example/', sourceUrl: 'https://lotus.example/', licence: connectedLicence('Sample leads'), emails: ['hello@lotus.example'] });
  assert.equal(connectedLicence('Sample leads'), 'From Sample leads, a tool you connected. Its own terms apply.');
  assert.equal(rows[1]!.sourceUrl, 'https://brew.example/about');
  assert.equal(rows[1]!.website, null, 'a listing page is where it was found, not the business own site');
  assert.deepEqual(rows[1]!.emails, []);
  assert.equal(rows[1]!.address, '', 'an address that is not plain text is left out');
  assert.deepEqual(rows[2]!.emails, [], 'a field that is not an email address is dropped, not repaired');
  assert.equal(rows[3]!.website, 'https://lotus.example/', 'a bare domain is that site');
  // The same list as structured content, and a plain array, read the same way.
  assert.equal(prospectsFromTool({ structuredContent: { items: [{ name: 'A', url: 'https://a.example' }] } }, { server: 'S' }).length, 1);
  assert.equal(prospectsFromTool([{ name: 'A', url: 'https://a.example' }], { server: 'S' }).length, 1);
  // Nothing readable is no prospects, never an error that hides a charge.
  assert.deepEqual(prospectsFromTool({ content: [{ type: 'text', text: 'Sorry, nothing found.' }] }, { server: 'S' }), []);
  assert.deepEqual(prospectsFromTool({ isError: true, content: [{ type: 'text', text: '[{"name":"A","url":"https://a.example"}]' }] }, { server: 'S' }), []);
  // At most a hundred rows are read from one answer.
  const many = Array.from({ length: 300 }, (_, i) => ({ name: `N${i}`, url: `https://n${i}.example` }));
  assert.equal(prospectsFromTool(many, { server: 'S' }).length, 100);
});

test('a connected lead call that names LinkedIn, or asks to get round a site, is refused whatever the owner approves', () => {
  const tool = { name: 'search_places', description: 'Search public business listings.' };
  refuseForbiddenLeadCall(tool, { query: 'cafes in Pune' });
  assert.throws(() => refuseForbiddenLeadCall({ name: 'linkedin_people_search', description: 'Find people.' }, {}), code('LEAD_SOURCE_FORBIDDEN'));
  assert.throws(() => refuseForbiddenLeadCall(tool, { query: 'site:linkedin.com/in founders in Pune' }), code('LEAD_SOURCE_FORBIDDEN'));
  assert.throws(() => refuseForbiddenLeadCall({ name: 'scrape', description: 'Solves CAPTCHAs and rotates proxies to avoid blocks.' }, {}), code('LEAD_SOURCE_FORBIDDEN'));
  assert.throws(() => refuseForbiddenLeadCall(tool, { options: { stealth: true } }), code('LEAD_SOURCE_FORBIDDEN'));
  assert.throws(() => refuseForbiddenLeadCall(tool, { query: 'cafes', bypassRobots: true }), code('LEAD_SOURCE_FORBIDDEN'));
});
