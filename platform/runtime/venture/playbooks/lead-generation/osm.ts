// Chausar local prospects. Protocol ideas: revenue-squad (MIT); OSM API docs (CC BY-SA); no source code copied.
import { check } from '../../../contracts.ts';
import { politeFetch, type PoliteNet } from '../../build/fetch-policy.ts';
export type CityBox = [number, number, number, number];
export type Prospect = { osmId: string | null; placeId?: string | null; name: string; address: string; website: string | null; sourceUrl: string; licence: string; emails?: string[] };
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors, ODbL';
/** Validates south, west, north and east without silently broadening the city. */
export function cityBox(value: unknown): CityBox {
  check(Array.isArray(value) && value.length === 4 && value.every(Number.isFinite), 'INVALID_VENTURE_REQUEST', 'Choose a city bounding box.');
  const [s, w, n, e] = value as number[];
  check(s >= -90 && n <= 90 && w >= -180 && e <= 180 && s < n && w < e && n - s <= 5 && e - w <= 5, 'INVALID_VENTURE_REQUEST', 'Choose a single city, not a country.');
  return [s, w, n, e];
}
/** Reads a bounded Overpass query, retaining source and licence on every returned prospect. */
export async function osmLeads(input: { box: CityBox; vertical: string; count: number }, net: PoliteNet = {}): Promise<Prospect[]> {
  const box = cityBox(input.box);
  check(typeof input.vertical === 'string' && /^(?:shop|amenity|craft|office)=[a-z_]{1,50}$/.test(input.vertical), 'INVALID_VENTURE_REQUEST', 'Use an OSM tag such as shop=bakery.');
  check(Number.isInteger(input.count) && input.count >= 1 && input.count <= 50, 'INVALID_VENTURE_REQUEST', 'Choose a daily count from one to fifty.');
  const [key, value] = input.vertical.split('=');
  const query = `[out:json][timeout:20];nwr["${key}"="${value}"](${box.join(',')});out center tags ${input.count * 3};`;
  const response = await politeFetch({ url: `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, maxBytes: 1_000_000, timeoutMs: 25000 }, net);
  check(response.status === 200, 'LEAD_SOURCE_UNAVAILABLE', 'The lead source did not answer. Try later or enter a referral.');
  let parsed: any;
  try { parsed = JSON.parse(response.body.toString('utf8')); } catch { check(false, 'LEAD_SOURCE_UNAVAILABLE', 'The lead source returned unreadable data.'); }
  check(Array.isArray(parsed.elements) && parsed.elements.length <= 1000, 'LEAD_SOURCE_UNAVAILABLE', 'The lead source returned too much data.');
  return parsed.elements.filter((row: any) => {
    const lat = row.lat ?? row.center?.lat, lon = row.lon ?? row.center?.lon;
    return /^(node|way|relation)$/.test(row.type) && Number.isSafeInteger(row.id) && row.id > 0 && typeof row.tags?.name === 'string' && row.tags.name.trim() && row.tags[key] === value && lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3];
  }).slice(0, input.count).map((row: any) => ({
    osmId: `${row.type}/${row.id}`, name: row.tags.name.trim().slice(0, 200),
    address: ['addr:housenumber', 'addr:street', 'addr:city', 'addr:postcode'].map(key => row.tags[key]).filter((v: unknown) => typeof v === 'string').join(', ').slice(0, 400),
    website: /^(https?:\/\/)/.test(row.tags.website ?? row.tags['contact:website'] ?? '') ? (row.tags.website ?? row.tags['contact:website']) : null,
    sourceUrl: `https://www.openstreetmap.org/${row.type}/${row.id}`, licence: OSM_ATTRIBUTION,
  }));
}
