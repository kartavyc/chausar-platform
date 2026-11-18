// Chausar lead source contracts, original tests inspired by revenue-squad (MIT).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_WORDS, OSM_ASK_MS, OSM_BUDGET_MS, osmLeads } from '../runtime/venture/customers/sources/osm.ts';
import { NominatimCities } from '../runtime/venture/customers/sources/nominatim.ts';
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
// Found live on 14 Nov 2026: overpass-api.de answered "at capacity, retry with backoff" (502) on some tries and data on
// others, and one try gave the owner "did not answer". Found live on 16 Nov 2026 (the Windows tour, then again from a
// Mac): one of the service's two servers answered 502 at once, the other took the request into its queue and answered
// 200 with 15 places after 29.4 s, 4.4 s after the 25 s limit this code then had gave up on it; the third try met 502.
// So: one ask outlasts the server's queue and its own time limit, a busy answer is asked again after a growing wait at
// the service's next address, and every ask and wait together stay inside one budget.
const BOX = [19, 72, 20, 73] as [number, number, number, number];
const PLACES = Buffer.from(JSON.stringify({ elements: [{ type: 'node', id: 12, lat: 19.05, lon: 72.85, tags: { name: 'Lotus Bakery', shop: 'bakery' } }] }));
type Answer = number | 'timeout' | 'failed';
/** Runs one read on a stand-in clock: a wait and a timed-out ask both move it on, as they would the real one. */
async function mapRead(answers: Answer[], addresses = ['93.184.216.34']) {
  let clock = 0, sends = 0;
  const waits: number[] = [], asked: { address: string; timeoutMs: number }[] = [];
  const net = { resolve: async () => addresses.map(address => ({ address, family: 4 as const })), send: async (target: any) => {
    const answer = answers[Math.min(sends, answers.length - 1)]!;
    sends += 1;
    asked.push({ address: target.address, timeoutMs: target.timeoutMs });
    if (answer === 'timeout') { clock += target.timeoutMs; throw Object.assign(new Error('The site did not answer in time.'), { code: 'NET_TIMEOUT' }); }
    if (answer === 'failed') throw Object.assign(new Error('Chausar could not reach the site.'), { code: 'NET_FAILED' });
    return { status: answer, headers: {}, body: answer === 200 ? PLACES : Buffer.from('busy') };
  } };
  const result = await osmLeads({ box: BOX, vertical: 'shop=bakery', count: 10 }, net, { wait: async ms => { waits.push(ms); clock += ms; }, now: () => clock })
    .then(rows => rows.length as number | string, error => `${error.code}: ${error.message}`);
  return { result, sends, waits, asked };
}
const brief = (read: Awaited<ReturnType<typeof mapRead>>) => ({ result: read.result, sends: read.sends, waits: read.waits });

test('one ask of the map outlasts the server queue and the query\'s own time limit', async () => {
  let url = '';
  const net = { resolve, send: async (target: any) => {
    url = decodeURIComponent(target.url.href);
    assert.ok(target.timeoutMs > OSM_ASK_MS - 1000 && target.timeoutMs <= OSM_ASK_MS, `asked with ${target.timeoutMs} ms`);
    return { status: 200, headers: {}, body: PLACES };
  } };
  assert.equal((await osmLeads({ box: BOX, vertical: 'shop=bakery', count: 10 }, net)).length, 1);
  const serverSeconds = Number(/\[timeout:(\d+)\]/.exec(url)?.[1]);
  assert.equal(serverSeconds, 20);
  // The 16 Nov answer came after 29.4 s; an ask must outlast the query's own limit and a queue at least as long again.
  assert.ok(OSM_ASK_MS >= serverSeconds * 1000 * 2 + 15_000, 'an ask waits through the queue and the run');
  assert.ok(OSM_BUDGET_MS > OSM_ASK_MS, 'the budget leaves room for a second ask');
});

test('a busy map service is asked again with a growing wait, at its next address, inside one budget', async () => {
  const busy = `LEAD_SOURCE_UNAVAILABLE: ${MAP_WORDS.busy}`;
  assert.deepEqual(brief(await mapRead([502, 504, 200])), { result: 1, sends: 3, waits: [2000, 4000] });
  // The 16 Nov case: the first address says busy at once, the next one answers.
  const turned = await mapRead([502, 200], ['93.184.216.34', '93.184.216.35']);
  assert.deepEqual([turned.result, turned.asked.map(item => item.address)], [1, ['93.184.216.34', '93.184.216.35']]);
  // A connection that failed is a read that never ran: asked again the same way.
  assert.deepEqual(brief(await mapRead(['failed', 200])), { result: 1, sends: 2, waits: [2000] });
  // Busy every time: four asks, then the owner is told it is busy, in words that say what to do.
  assert.deepEqual(brief(await mapRead([502])), { result: busy, sends: 4, waits: [2000, 4000, 8000] });
  // An ask the server took and never answered used its whole time. One more fits the budget, with what is left of it.
  const slow = await mapRead(['timeout']);
  assert.deepEqual(brief(slow), { result: busy, sends: 2, waits: [2000] });
  assert.deepEqual(slow.asked.map(item => Math.round(item.timeoutMs / 1000)), [OSM_ASK_MS / 1000, (OSM_BUDGET_MS - OSM_ASK_MS - 2000) / 1000]);
  assert.deepEqual(brief(await mapRead(['timeout', 200])), { result: 1, sends: 2, waits: [2000] });
  // Slow down (429) is not tried again: the fetch policy pauses that site.
  assert.deepEqual(brief(await mapRead([429, 200])), { result: `LEAD_SOURCE_UNAVAILABLE: ${MAP_WORDS.slowDown}`, sends: 1, waits: [] });
  assert.deepEqual(brief(await mapRead([400])), { result: `LEAD_SOURCE_UNAVAILABLE: ${MAP_WORDS.failed}`, sends: 1, waits: [] });
  for (const words of Object.values(MAP_WORDS)) assert.doesNotMatch(words, /—/);
});

test('an answer that says the server ran out of time is not read as "found nothing"', async () => {
  const net = { resolve, send: async () => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 21 seconds.' })) }) };
  await assert.rejects(osmLeads({ box: BOX, vertical: 'shop=bakery', count: 10 }, net), (error: any) => error.code === 'LEAD_SOURCE_UNAVAILABLE' && error.message === MAP_WORDS.ranOut);
});
