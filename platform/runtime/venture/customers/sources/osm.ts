// Chausar local prospects, shared by every business (customers/find-run.ts) and the lead generation playbook.
// Protocol ideas: revenue-squad (MIT); OSM API docs (CC BY-SA); no source code copied.
import { check } from '../../../contracts.ts';
import { politeFetch, type PoliteNet } from '../../build/fetch-policy.ts';
import { systemResolver } from '../../core/net-guard.ts';
import { OSM_ATTRIBUTION, type Prospect } from './prospect.ts';
export type CityBox = [number, number, number, number];
/**
 * One OpenStreetMap tag for a kind of place, such as shop=bakery. Only these keys name businesses a visitor can find.
 * Four more tags are allowed by name, and no other value of their keys (building=yes would be every building): named
 * apartment blocks, office and commercial buildings, and named housing areas, which a business that serves offices and
 * housing societies sells to (customers/find-brief.ts PLACE_KINDS; checked on taginfo, 15 Nov 2026).
 */
export const OSM_TAG = /^(?:(?:shop|amenity|craft|office|tourism|leisure)=[a-z_]{1,50}|building=(?:apartments|office|commercial)|landuse=residential)$/;
/** Validates south, west, north and east without silently broadening the city. */
export function cityBox(value: unknown): CityBox {
  check(Array.isArray(value) && value.length === 4 && value.every(Number.isFinite), 'INVALID_VENTURE_REQUEST', 'Choose a city bounding box.');
  const [s, w, n, e] = value as number[];
  check(s >= -90 && n <= 90 && w >= -180 && e <= 180 && s < n && w < e && n - s <= 5 && e - w <= 5, 'INVALID_VENTURE_REQUEST', 'Choose a single city, not a country.');
  return [s, w, n, e];
}
/**
 * The public Overpass service (overpass-api.de) is shared and often full. What it does then, as seen live:
 * - 14 Nov 2026: it answers 502, 503 or 504 at once, and its own words ask for another try after a growing wait.
 * - 16 Nov 2026 (a Windows owner's search for company offices in Indore, then the same from a Mac): of its two
 *   servers one answered 502 at once ("all query workers are busy and the request queue is full"); the other took the
 *   request into its queue and answered 200 with 15 places after 29.4 s. This code then gave an ask 25 s, so it hung
 *   up 4.4 s before the answer, asked a third time, met 502 and told the owner the source did not answer. The query
 *   was never the trouble: it is small, and the server's own limit for it is 20 s once it starts.
 * So one ask now waits through the queue and the run (OSM_ASK_MS); a busy answer or a failed connection is asked again
 * after a growing wait, at the service's next address when its name has more than one; and every ask and wait
 * together stay inside one budget (OSM_BUDGET_MS), so a search always ends. An ask the server took and did not answer
 * is asked once more only if the budget still holds a whole run. A 429 is not tried again: the fetch policy pauses a
 * site that says slow down. Every ask is a read, safe to repeat, paced per site by the fetch policy as before.
 */
const BUSY = new Set([502, 503, 504]);
/** The query's own time limit at the server, in seconds, written into the query. */
const QUERY_SECONDS = 20;
/** How long one ask waits: the server's queue, then the run. */
export const OSM_ASK_MS = 60_000;
/** Every ask and every wait of one read, together. */
export const OSM_BUDGET_MS = 90_000;
const TRY_WAITS_MS = Object.freeze([2000, 4000, 8000]);
/** An ask is not started with less than a whole run left. */
const MIN_ASK_MS = (QUERY_SECONDS + 5) * 1000;
/** What the owner reads when the map gave no list. Each says what to do next; none blames the owner. */
export const MAP_WORDS = Object.freeze({
  busy: 'The public map is busy right now, so it gave no list. Nothing was added and nothing was sent. Try again in a few minutes, or add a lead you know yourself.',
  slowDown: 'The public map asked Chausar to slow down, so it gave no list. Nothing was added and nothing was sent. Try again later, or add a lead you know yourself.',
  ranOut: 'The public map ran out of time on this search, so it gave no list. Try a smaller city or another kind of place, or try again later.',
  failed: 'The public map could not answer this search. Nothing was added and nothing was sent. Try again later, or add a lead you know yourself.',
  unreadable: 'The public map sent an answer Chausar could not read. Nothing was added. Try again later.',
  tooMuch: 'The public map sent more than Chausar reads for one search. Try a smaller city or another kind of place.',
});
export type OsmOptions = { wait?: (ms: number) => Promise<void>; /** A steady clock in milliseconds, for the budget. */ now?: () => number };
/** Reads a bounded Overpass query, retaining source and licence on every returned prospect. */
export async function osmLeads(input: { box: CityBox; vertical: string; count: number }, net: PoliteNet = {}, options: OsmOptions = {}): Promise<Prospect[]> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? (() => performance.now());
  const box = cityBox(input.box);
  check(typeof input.vertical === 'string' && OSM_TAG.test(input.vertical), 'INVALID_VENTURE_REQUEST', 'Use an OSM tag such as shop=bakery.');
  check(Number.isInteger(input.count) && input.count >= 1 && input.count <= 50, 'INVALID_VENTURE_REQUEST', 'Choose a daily count from one to fifty.');
  const [key, value] = input.vertical.split('=');
  const query = `[out:json][timeout:${QUERY_SECONDS}];nwr["${key}"="${value}"](${box.join(',')});out center tags ${input.count * 3};`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
  const lookup = net.resolve ?? systemResolver;
  /** One ask. turn: which of the name's addresses leads, so a second ask goes to the service's next server. */
  const ask = (turn: number, timeoutMs: number) => politeFetch({ url, maxBytes: 1_000_000, timeoutMs }, {
    ...net, resolve: async host => { const found = await lookup(host); const at = found.length ? turn % found.length : 0; return [...found.slice(at), ...found.slice(0, at)]; },
  });
  const started = now();
  const left = () => OSM_BUDGET_MS - (now() - started);
  let response: Awaited<ReturnType<typeof ask>> | undefined;
  for (let attempt = 0; ; attempt += 1) {
    response = undefined;
    try {
      response = await ask(attempt, Math.min(OSM_ASK_MS, left()));
      if (!BUSY.has(response.status)) break;
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code !== 'NET_TIMEOUT' && code !== 'NET_FAILED') throw error;
    }
    const pause = TRY_WAITS_MS[attempt];
    if (pause === undefined || left() - pause < MIN_ASK_MS) break;
    await wait(pause);
  }
  check(response && !BUSY.has(response.status), 'LEAD_SOURCE_UNAVAILABLE', MAP_WORDS.busy);
  check(response.status !== 429, 'LEAD_SOURCE_UNAVAILABLE', MAP_WORDS.slowDown);
  check(response.status === 200, 'LEAD_SOURCE_UNAVAILABLE', MAP_WORDS.failed);
  let parsed: any;
  try { parsed = JSON.parse(response.body.toString('utf8')); } catch { check(false, 'LEAD_SOURCE_UNAVAILABLE', MAP_WORDS.unreadable); }
  // The server ran out of its own time or room: it then answers 200 with a remark and a list cut short or empty.
  check(!(typeof parsed?.remark === 'string' && /runtime error/i.test(parsed.remark)), 'LEAD_SOURCE_UNAVAILABLE', MAP_WORDS.ranOut);
  check(Array.isArray(parsed?.elements), 'LEAD_SOURCE_UNAVAILABLE', MAP_WORDS.unreadable);
  check(parsed.elements.length <= 1000, 'LEAD_SOURCE_UNAVAILABLE', MAP_WORDS.tooMuch);
  return parsed.elements.filter((row: any) => {
    const lat = row.lat ?? row.center?.lat, lon = row.lon ?? row.center?.lon;
    return /^(node|way|relation)$/.test(row.type) && Number.isSafeInteger(row.id) && row.id > 0 && typeof row.tags?.name === 'string' && row.tags.name.trim() && row.tags[key] === value && lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3];
  }).slice(0, input.count).map((row: any) => ({
    osmId: `${row.type}/${row.id}`, name: row.tags.name.trim().slice(0, 120),
    address: ['addr:housenumber', 'addr:street', 'addr:city', 'addr:postcode'].map(key => row.tags[key]).filter((v: unknown) => typeof v === 'string').join(', ').slice(0, 400),
    website: /^(https?:\/\/)/.test(row.tags.website ?? row.tags['contact:website'] ?? '') ? (row.tags.website ?? row.tags['contact:website']) : null,
    sourceUrl: `https://www.openstreetmap.org/${row.type}/${row.id}`, licence: OSM_ATTRIBUTION,
  }));
}
