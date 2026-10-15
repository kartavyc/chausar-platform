/**
 * The places in the rail, per shell.
 *   guided / books : the seven places
 *   simple         : Today, Ask, Work, More (More holds the other four; nothing is lost)
 *   enterprise     : the seven, plus Company for whoever administers the installation
 *   ca-firm        : Today, Clients, Work, Reports, Tools, Trust. No Ask and no Books at
 *                    the firm's level, because there are no books at that level.
 * Names are text keys; places.ts holds no words a person reads.
 *
 * In the enterprise version a role's grant list gates everything the same way: which
 * places are in the rail, which sub-places are under them, which place a key goes to,
 * and which incoming address is honoured. A gated role starts in its first permitted
 * sub-place. If it has no permitted places, its incoming address resolves to no access.
 */

import type { Address, PlaceId, View } from './presentation.ts';
import { SEVEN_PLACES, type SevenPlace } from './routes.ts';
import { laneSubPlaces } from '../places/subplaces/index.ts';

export interface SubPlace {
  id: string;
  nameKey: string;
}

export interface Place {
  id: PlaceId;
  nameKey: string;
  subs: ReadonlyArray<SubPlace>;
}

export type ShellKind = 'desktop' | 'enterprise' | 'ca-firm';

export interface ShellConfig {
  kind: ShellKind;
  view: View;
  /** Enterprise only: this person administers the installation. */
  administers?: boolean | undefined;
  /** Enterprise only: the grants a role holds, as "place.sub". Absent means all. */
  allowed?: ReadonlySet<string> | undefined;
}

const sub = (place: string, id: string): SubPlace => ({ id, nameKey: `SH-01.sub.${place}.${id}` });

/** Sub-places the lanes add (places/subplaces/<lane>.ts), after the authored ones of that place. */
function withLaneSubs(shell: ShellKind, id: PlaceId, authored: ReadonlyArray<SubPlace>): ReadonlyArray<SubPlace> {
  const added = Object.values(laneSubPlaces).flat()
    .filter((s) => s.place === id && (s.shells ?? ['desktop']).includes(shell) && !authored.some((a) => a.id === s.id))
    .map((s) => sub(id, s.id));
  return added.length === 0 ? authored : [...authored, ...added];
}

const DESKTOP_AUTHORED: Record<SevenPlace, ReadonlyArray<SubPlace>> = {
  today: [sub('today', 'today'), sub('today', 'activity')],
  ask: [sub('ask', 'new'), sub('ask', 'saved'), sub('ask', 'whatifs'), sub('ask', 'decisions'), sub('ask', 'checks'), sub('ask', 'notyet')],
  work: [sub('work', 'approvals'), sub('work', 'jobs'), sub('work', 'actions'), sub('work', 'cando')],
  books: [
    sub('books', 'sources'),
    sub('books', 'meanings'),
    sub('books', 'accounts'),
    sub('books', 'customers'),
    sub('books', 'history'),
    sub('books', 'memory'),
  ],
  reports: [sub('reports', 'packs'), sub('reports', 'weekahead'), sub('reports', 'lessons'), sub('reports', 'duedates'), sub('reports', 'exports')],
  tools: [sub('tools', 'smallapps'), sub('tools', 'plugins'), sub('tools', 'assistants'), sub('tools', 'phone')],
  trust: [
    sub('trust', 'rules'),
    sub('trust', 'people'),
    sub('trust', 'models'),
    sub('trust', 'network'),
    sub('trust', 'record'),
    sub('trust', 'sharing'),
    sub('trust', 'vault'),
  ],
};

const DESKTOP = Object.fromEntries(SEVEN_PLACES.map((p) => [p, withLaneSubs('desktop', p, DESKTOP_AUTHORED[p])])) as Record<SevenPlace, ReadonlyArray<SubPlace>>;

/** Enterprise sub-places (enterprise.md part 3). Renamed ones replace the desktop entry. */
const ENTERPRISE_AUTHORED: Record<SevenPlace | 'company', ReadonlyArray<SubPlace>> = {
  today: DESKTOP_AUTHORED.today,
  ask: [...DESKTOP_AUTHORED.ask, sub('ask', 'plans')],
  work: [...DESKTOP_AUTHORED.work, sub('work', 'cases'), sub('work', 'agents')],
  books: [
    sub('books', 'sources'),
    sub('books', 'meanings'),
    sub('books', 'accounts'),
    sub('books', 'records'),
    sub('books', 'history'),
    sub('books', 'memory'),
    sub('books', 'issues'),
    sub('books', 'companies'),
  ],
  reports: [sub('reports', 'packs'), sub('reports', 'briefs'), sub('reports', 'duedates'), sub('reports', 'exports'), sub('reports', 'sent')],
  tools: [sub('tools', 'smallapps'), sub('tools', 'plugins'), sub('tools', 'assistants'), sub('tools', 'planning')],
  trust: [
    ...DESKTOP_AUTHORED.trust,
    sub('trust', 'access'),
    sub('trust', 'markings'),
    sub('trust', 'retention'),
    sub('trust', 'channels'),
  ],
  company: [
    sub('company', 'signin'),
    sub('company', 'health'),
    sub('company', 'recovery'),
    sub('company', 'keys'),
    sub('company', 'support'),
    sub('company', 'computers'),
    sub('company', 'quality'),
    sub('company', 'build'),
    sub('company', 'licence'),
  ],
};
const ENTERPRISE = Object.fromEntries(([...SEVEN_PLACES, 'company'] as const).map((p) => [p, withLaneSubs('enterprise', p, ENTERPRISE_AUTHORED[p])])) as Record<SevenPlace | 'company', ReadonlyArray<SubPlace>>;

const place = (id: PlaceId, subs: ReadonlyArray<SubPlace>): Place => ({ id, nameKey: `SH-01.place.${id}`, subs });

const CA_FIRM_AUTHORED: ReadonlyArray<Place> = [
  place('today', []),
  place('clients', []),
  place('work', [sub('work', 'cosign'), sub('work', 'many'), sub('work', 'questions')]),
  place('reports', [sub('reports', 'handover')]),
  place('tools', [sub('tools', 'library'), sub('tools', 'invite')]),
  place('trust', [sub('trust', 'people'), sub('trust', 'firmname')]),
];
const CA_FIRM: ReadonlyArray<Place> = CA_FIRM_AUTHORED.map((p) => ({ ...p, subs: withLaneSubs('ca-firm', p.id, p.subs) }));

/** The grant list in force, or undefined when nothing is gated by one. */
function grants(config: ShellConfig): ReadonlySet<string> | undefined {
  return config.kind === 'enterprise' ? config.allowed : undefined;
}

/** Whether a sub-place may be used in this shell. */
export function subAllowed(config: ShellConfig, id: PlaceId, subId: string): boolean {
  const allowed = grants(config);
  return authoredSubs(config, id).some((s) => s.id === subId) && (allowed === undefined || allowed.has(`${id}.${subId}`));
}

/** The authored enterprise sub-places. An unknown grant cannot enable a place. */
function enterpriseSubs(id: PlaceId): ReadonlyArray<SubPlace> {
  if (id === 'company') return ENTERPRISE.company;
  const canonical = SEVEN_PLACES.find((p) => p === id);
  return canonical === undefined ? [] : ENTERPRISE[canonical];
}

function authoredSubs(config: ShellConfig, id: PlaceId): ReadonlyArray<SubPlace> {
  if (config.kind === 'enterprise') return enterpriseSubs(id);
  if (config.kind === 'ca-firm') return CA_FIRM.find((p) => p.id === id)?.subs ?? [];
  const canonical = SEVEN_PLACES.find((p) => p === id);
  return canonical === undefined ? [] : DESKTOP[canonical];
}

/** Whether the grant list reaches a place at all: it holds at least one of its
 *  authored sub-places. Today follows the same grant rules as every other place. */
function placeGranted(config: ShellConfig, id: PlaceId): boolean {
  const allowed = grants(config);
  return allowed === undefined || enterpriseSubs(id).some((s) => allowed.has(`${id}.${s.id}`));
}

function filterAllowed(config: ShellConfig, p: Place): Place {
  if (grants(config) === undefined) return p;
  return { ...p, subs: p.subs.filter((s) => subAllowed(config, p.id, s.id)) };
}

/** The entries listed in the rail, in order. */
export function railPlaces(config: ShellConfig): ReadonlyArray<Place> {
  if (config.kind === 'ca-firm') {
    return CA_FIRM;
  }
  if (config.kind === 'enterprise') {
    const ids: ReadonlyArray<SevenPlace | 'company'> = [...SEVEN_PLACES, 'company'];
    return ids.filter((id) => placeAllowed(config, id)).map((id) => filterAllowed(config, place(id, ENTERPRISE[id])));
  }
  if (config.view === 'simple') {
    return [
      place('today', DESKTOP.today),
      place('ask', DESKTOP.ask),
      place('work', DESKTOP.work),
      place('more', []),
    ];
  }
  return SEVEN_PLACES.map((id) => place(id, DESKTOP[id]));
}

/** What More holds in the Simple view: the other four, as rows, with no lost access. */
export function morePlaces(): ReadonlyArray<Place> {
  return [
    place('books', DESKTOP.books),
    place('reports', DESKTOP.reports),
    place('tools', DESKTOP.tools),
    place('trust', DESKTOP.trust),
  ];
}

/** The rail entry that is "here" for a place. In Simple, More stays the entry for the
 *  four places it holds; everywhere else a place is its own entry. */
export function railEntry(config: ShellConfig, id: PlaceId): PlaceId {
  if (config.kind === 'desktop' && config.view === 'simple' && morePlaces().some((p) => p.id === id)) return 'more';
  return id;
}

/** Only Today carries a count. The CA firm's Clients also carries one, as drawn. */
export function railCountShown(config: ShellConfig, id: PlaceId): boolean {
  return placeAllowed(config, id) && (id === 'today' || (config.kind === 'ca-firm' && id === 'clients'));
}

/** Ctrl 1 to Ctrl 7 go to a place. In every desktop view they are the seven places,
 *  so Books stays one keystroke away in Simple. The CA firm has six. */
export function keyPlaces(config: ShellConfig): ReadonlyArray<PlaceId> {
  if (config.kind === 'ca-firm') return ['today', 'clients', 'work', 'reports', 'tools', 'trust'];
  return SEVEN_PLACES;
}

/** Whether a place may be shown in this shell at all. Guards the rail, the keys and the
 *  address bar. */
export function placeAllowed(config: ShellConfig, id: PlaceId): boolean {
  if (id === 'more') return config.kind === 'desktop' && config.view === 'simple';
  if (id === 'company') return config.kind === 'enterprise' && config.administers === true && placeGranted(config, id);
  if (id === 'clients') return config.kind === 'ca-firm';
  if (config.kind === 'ca-firm') return id !== 'ask' && id !== 'books';
  return placeGranted(config, id);
}

/** A clean default address from the permitted rail, with no prior sheet context. */
function defaultAddress(config: ShellConfig, id?: PlaceId): Address | null {
  if (id !== undefined && grants(config) === undefined) {
    return placeAllowed(config, id) ? { place: id } : null;
  }
  const offered = railPlaces(config);
  const target = id === undefined ? offered[0] : offered.find((p) => p.id === id);
  if (target === undefined) return null;
  const first = target.subs[0];
  if (grants(config) !== undefined) {
    return first === undefined ? null : { place: target.id, sub: first.id };
  }
  return { place: target.id };
}

/** The address this shell honours. A denied place goes to the first permitted place;
 *  a denied or bare gated sub-place goes to that place's first permitted sub-place.
 *  Repaired contexts lose their old sheet. No grants means no private address. */
export function resolveAddress(config: ShellConfig, a: Address): Address | null {
  if (!placeAllowed(config, a.place)) return defaultAddress(config);
  if ((a.sub !== undefined && !subAllowed(config, a.place, a.sub)) || (a.sub === undefined && grants(config) !== undefined)) {
    return defaultAddress(config, a.place);
  }
  return a;
}
