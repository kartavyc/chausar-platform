// Chausar enrichment and dedupe behavior. Ideas from revenue-squad and scraper-kit (MIT); no copied code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSite } from '../runtime/venture/playbooks/lead-generation/enrich.ts';
import { dedupeProspects } from '../runtime/venture/playbooks/lead-generation/dedupe.ts';
test('enrichment honours robots, reads homepage plus three same-host contact pages and keeps three useful emails', async () => {
  const visited: string[] = [];
  const result = await enrichSite('https://lotus.example', { resolve: async () => [{ address: '93.184.216.34', family: 4 }], send: async target => {
    visited.push(target.url.href);
    const body = target.url.pathname === '/robots.txt' ? 'User-agent: *\nDisallow: /private' : '<p>hello@lotus.example help@gmail.com sales@lotus.example noreply@lotus.example logo@2x.png jobs@lotus.example</p><a href="/contact">Contact</a><a href="/about">About</a><a href="https://other.example/contact">Elsewhere</a><a href="/support">Support</a><a href="/private">Contact</a>';
    return { status: 200, headers: {}, body: Buffer.from(body) };
  } });
  assert.deepEqual(result.emails, ['hello@lotus.example', 'sales@lotus.example', 'jobs@lotus.example']);
  assert.equal(result.pages.length, 4);
  assert.equal(visited.some(url => url.includes('other.example')), false);
  await assert.rejects(enrichSite('https://justdial.com/shops'), { code: 'FETCH_POLICY_REFUSED' });
});
test('robots refusal makes no page request', async () => {
  const paths: string[] = [];
  await assert.rejects(enrichSite('https://lotus.example', { resolve: async () => [{ address: '93.184.216.34', family: 4 }], send: async target => {
    paths.push(target.url.pathname);
    return { status: 200, headers: {}, body: Buffer.from('User-agent: *\nDisallow: /') };
  } }), { code: 'ROBOTS_REFUSED' });
  assert.deepEqual(paths, ['/robots.txt']);
});
test('dedupe uses stable place ids first, then domain, then normalised name and address', () => {
  const row = (extra: any = {}) => ({ name: 'Lotus Bakery', address: '12 Lake Road', website: null, osmId: null, sourceUrl: 'https://lotus.example', licence: 'Owner source', ...extra });
  const rows = [row({ osmId: 'node/1', website: 'https://a.example' }), row({ osmId: 'node/1', name: 'Renamed' }), row({ website: 'https://www.a.example/contact' }), row({ name: ' lotus   bakery ', address: '12 LAKE ROAD' }), row({ name: 'Different', address: 'Elsewhere' })];
  assert.deepEqual(dedupeProspects(rows).map(r => r.name), ['Lotus Bakery', 'Different']);
});
