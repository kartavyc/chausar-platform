/**
 * Hash addresses. Every screen and every open sheet has an address.
 *   #/today                       a place
 *   #/work/approvals              a sub-place
 *   #/work/approvals?sheet=ap-12  with a sheet open
 * The same addresses become paths in the browser version; nothing here reads the bridge.
 * An unknown place gives a clean Today address: foreign sub-places and sheet ids are
 * dropped with it, so an address cannot carry action context into the wrong place.
 */

import type { Address, PlaceId } from './presentation.ts';

export type SevenPlace = 'today' | 'ask' | 'work' | 'books' | 'reports' | 'tools' | 'trust';

export const SEVEN_PLACES: ReadonlyArray<SevenPlace> = ['today', 'ask', 'work', 'books', 'reports', 'tools', 'trust'];

const KNOWN: ReadonlySet<string> = new Set<string>([...SEVEN_PLACES, 'company', 'clients', 'more', 'first-run']);

function isPlaceId(s: string): s is PlaceId {
  return KNOWN.has(s);
}

const SEGMENT = /^[a-z][a-z0-9-]{0,63}$/;
/** Engine references are opaque ids, including prefix_<UUID>. They cannot contain
 *  path separators, query syntax or encoded characters. Sub-places remain slugs. */
const SHEET_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;

export function parseAddress(hash: string): Address {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryParts = raw.split('?');
  const pathPart = queryParts[0];
  const queryPart = queryParts[1];
  const segments = (pathPart ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const placeRaw = segments[0] ?? 'today';
  if (!isPlaceId(placeRaw)) return { place: 'today' };
  const place: PlaceId = placeRaw;

  const subRaw = segments[1];
  const sub = subRaw !== undefined && SEGMENT.test(subRaw) ? subRaw : undefined;

  let sheet: string | undefined;
  const canonicalPath = `/${place}${sub === undefined ? '' : `/${sub}`}`;
  // Keep useful place/list navigation after a malformed route, but never carry an
  // action reference out of extra path segments or ambiguous query context.
  if (pathPart === canonicalPath && queryParts.length === 2 && queryPart?.startsWith('sheet=')) {
    const candidate = queryPart.slice('sheet='.length);
    const match = SHEET_ID.exec(candidate);
    if (match?.[0] === candidate) sheet = candidate;
  }

  const out: Address = { place };
  if (sub !== undefined) out.sub = sub;
  if (sheet !== undefined) out.sheet = sheet;
  return out;
}

export function formatAddress(a: Address): string {
  let s = `#/${a.place}`;
  if (a.sub) s += `/${a.sub}`;
  if (a.sheet) s += `?sheet=${a.sheet}`;
  return s;
}

export function sameAddress(a: Address, b: Address): boolean {
  return a.place === b.place && a.sub === b.sub && a.sheet === b.sheet;
}

export function withoutSheet(a: Address): Address {
  const out: Address = { place: a.place };
  if (a.sub !== undefined) out.sub = a.sub;
  return out;
}

export function withSheet(a: Address, sheet: string): Address {
  return { ...withoutSheet(a), sheet };
}
