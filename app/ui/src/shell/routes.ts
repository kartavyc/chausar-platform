/**
 * The address is the hash: #/<place>[/<sub>][?sheet=<kind>:<id>&<filter>=<value>].
 * Anything that does not parse lands on Today; a sheet that does not parse is dropped.
 */

/** W4 4C2: Chats, the owner's talk with Chausar as chief of staff, comes second, after Today. */
export const RAIL_PLACES = ['today', 'chats', 'team', 'work', 'clients', 'money', 'connections'] as const;
/** approve: the standalone approval page (W4 4G4, O11), `#/approve/next` or `#/approve/<rowId>`; no rail item. */
export const OTHER_PLACES = ['business', 'onboarding', 'approve'] as const;
export type PlaceId = (typeof RAIL_PLACES)[number] | (typeof OTHER_PLACES)[number];

export interface SheetRef { kind: string; id: string }
export interface Route { place: PlaceId; sub?: string; sheet?: SheetRef; query: Record<string, string> }

const PLACE_SET = new Set<string>([...RAIL_PLACES, ...OTHER_PLACES]);
const SEGMENT = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SHEET_KIND = /^[a-z][a-z-]{0,31}$/;
const SHEET_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const QUERY_KEY = /^[a-z][a-zA-Z0-9-]{0,31}$/;

export function parseHash(hash: string): Route {
  const today: Route = { place: 'today', query: {} };
  if (!hash.startsWith('#/')) return today;
  const [path = '', search = ''] = hash.slice(2).split('?', 2);
  const [place, ...rest] = path.split('/').filter(Boolean);
  if (!place || !PLACE_SET.has(place)) return today;
  const route: Route = { place: place as PlaceId, query: {} };
  const sub = rest.join('/');
  if (sub && rest.every((part) => SEGMENT.test(part))) route.sub = sub;
  // The approval page names one Today row by its id, which the engine spells like a sheet id (`run:R_1:q2`).
  else if (place === 'approve' && rest.length === 1) {
    let id = rest[0]!;
    try { id = decodeURIComponent(id); } catch { id = ''; }
    if (SHEET_ID.test(id)) route.sub = id;
  }
  const params = new URLSearchParams(search);
  for (const [key, value] of params) {
    if (key === 'sheet') {
      const at = value.indexOf(':');
      const kind = value.slice(0, at);
      const id = value.slice(at + 1);
      if (at > 0 && SHEET_KIND.test(kind) && SHEET_ID.test(id)) route.sheet = { kind, id };
    } else if (QUERY_KEY.test(key) && value.length <= 128) {
      route.query[key] = value;
    }
  }
  return route;
}

export function formatHash(route: Route): string {
  const path = `#/${route.place}${route.sub ? `/${route.sub}` : ''}`;
  const params = new URLSearchParams();
  if (route.sheet) params.set('sheet', `${route.sheet.kind}:${route.sheet.id}`);
  for (const [key, value] of Object.entries(route.query)) params.set(key, value);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
