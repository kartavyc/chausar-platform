// Chausar lead source contracts, original tests inspired by revenue-squad (MIT).
import test from 'node:test';
import assert from 'node:assert/strict';
import { osmLeads } from '../runtime/venture/playbooks/lead-generation/osm.ts';
import { NominatimCities } from '../runtime/venture/playbooks/lead-generation/nominatim.ts';
const resolve = async () => [{ address: '93.184.216.34', family: 4 as const }];
test('Overpass bounds requests and responses and keeps ODbL attribution', async () => {
  let url = '';
  const net = { resolve, send: async (target: any) => {
    url = target.url.href;
    assert.match(target.headers['user-agent'], /^Chausar\//);
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ elements: [
      { type: 'node', id: 12, lat: 19.05, lon: 72.85, tags: { name: 'Lotus Bakery', shop: 'bakery', website: 'https://lotus.example', 'addr:street': 'Lake Road' } },
      { type: 'node', id: 13, lat: 18, lon: 70, tags: { name: 'Outside city', shop: 'bakery' } },
    ] })) };
  } };
  const rows = await osmLeads({ box: [19, 72, 20, 73], vertical: 'shop=bakery', count: 10 }, net);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].osmId, 'node/12');
  assert.equal(rows[0].licence, '© OpenStreetMap contributors, ODbL');
  assert.equal(rows[0].sourceUrl, 'https://www.openstreetmap.org/node/12');
  assert.match(decodeURIComponent(url), /19,72,20,73/);
  await assert.rejects(osmLeads({ box: [19, 72, 20, 73], vertical: 'shop=bakery];out;', count: 10 }, net), { code: 'INVALID_VENTURE_REQUEST' });
});
test('Nominatim serialises callers, spaces requests and caches queries', async () => {
  let now = 0;
  const calls: number[] = [];
  const cities = new NominatimCities({ now: () => now, wait: async (ms: number) => { now += ms; }, net: { resolve, send: async target => {
    calls.push(now);
    assert.match(target.headers['user-agent'], /^Chausar\//);
    return { status: 200, headers: {}, body: Buffer.from('[{"boundingbox":["19","20","72","73"]}]') };
  } } });
  const boxes = await Promise.all([cities.find('Mumbai'), cities.find('Indore'), cities.find('Mumbai')]);
  assert.deepEqual(boxes[0], [19, 72, 20, 73]);
  assert.deepEqual(calls, [0, 1000]);
});
