/**
 * Adapter for the models-ext lane's small-app methods (TL-01..TL-03), as written in
 * `platform/runtime/smallapps/methods.ts` on that lane: `smallapps.list`, `propose`, `create`,
 * `get`, `open`, `rebuild`, `remove`, `pressAction` and the follow-up book's `records.list`,
 * `records.add`, `records.update` and `records.history`. Every reply is checked into this
 * screen's view types. A small app's description is plain data with labels and published
 * references; labels are shown as text nodes, never as markup, and nothing in it is ever run.
 * Every number comes from a calculation receipt and opens it.
 */
import type { FigureOrMissing } from '../../../app/presentation.ts';
import type { MissingState } from '../../../bridge/presentation.ts';
import { figure } from '../../trust/kit/figure.ts';
import { ShapeError, bool, int, list, oneOf, optStr, rec, str, strings, type Rec } from '../../trust/kit/validate.ts';
import { id, when } from '../validate.ts';

export const SMALLAPPS = {
  list: 'smallapps.list', propose: 'smallapps.propose', create: 'smallapps.create', get: 'smallapps.get', open: 'smallapps.open',
  rebuild: 'smallapps.rebuild', remove: 'smallapps.remove', press: 'smallapps.pressAction',
  records: 'smallapps.records.list', add: 'smallapps.records.add', update: 'smallapps.records.update', history: 'smallapps.records.history',
} as const;
/** The sheet id of the follow-up book, beside the apps' own ids (which start `smallapp_`). */
export const FOLLOW_UP_BOOK = 'follow-up-book';

export interface Uses { readonly calculations: readonly string[]; readonly actions: readonly string[]; readonly books: readonly string[] }
function uses(value: unknown, path: string): Uses {
  const u = rec(value, path);
  return { calculations: strings(u['calculations'], `${path}.calculations`, 100), actions: strings(u['actions'], `${path}.actions`, 100), books: strings(u['books'] ?? [], `${path}.books`, 10) };
}

export type AppState = 'made' | 'stale';
export interface AppRow {
  readonly id: string; readonly title: string; readonly version: number; readonly createdBy: string; readonly createdAt: string;
  readonly uses: Uses; readonly state: AppState; readonly reasons: readonly string[];
}
export function appRow(value: unknown, path = 'reply'): AppRow {
  const a = rec(value, path);
  const outOfDate = bool(a['outOfDate'], `${path}.outOfDate`);
  return {
    id: id(a['id'], `${path}.id`), title: str(a['title'], `${path}.title`, 200), version: int(a['version'], `${path}.version`),
    createdBy: str(a['createdBy'], `${path}.createdBy`, 200), createdAt: when(a['createdAt'], `${path}.createdAt`), uses: uses(a['uses'], `${path}.uses`),
    state: outOfDate ? 'stale' : 'made', reasons: strings(a['outOfDateReasons'] ?? [], `${path}.outOfDateReasons`, 50),
  };
}
export function appList(value: unknown): readonly AppRow[] { return list(rec(value)['apps'], 'reply.apps', appRow, 500); }

/** A card as described (no values): its label, and the calculation or action it names. */
interface Described { readonly id: string; readonly kind: string; readonly label: string; readonly operations: readonly string[] }
function described(value: unknown, path: string): Described {
  const c = rec(value, path), kind = oneOf(c['kind'], `${path}.kind`, ['metric', 'table', 'comparison', 'action', 'records'] as const);
  const operations = kind === 'table' ? list(c['rows'], `${path}.rows`, (v, p) => str(rec(v, p)['operation'], `${p}.operation`, 100), 8)
    : kind === 'action' ? [`${str(c['connector'], `${path}.connector`, 100)}/${str(c['operation'], `${path}.operation`, 100)}`]
    : kind === 'records' ? [] : [str(c['operation'], `${path}.operation`, 100)];
  return { id: id(c['id'], `${path}.id`), kind, label: str(c['label'], `${path}.label`, 200), operations };
}
/** The name a calculation goes by on this app: the label of the first card or row that reads it. */
function calculationNames(descriptor: Rec, path: string, calculations: readonly string[]): string[] {
  const cards = list(descriptor['cards'], `${path}.cards`, (v, p) => v, 20).map((v, i) => rec(v, `${path}.cards[${i}]`));
  const names = new Map<string, string>();
  cards.forEach((c, i) => {
    const p = `${path}.cards[${i}]`;
    if (c['kind'] === 'table') list(c['rows'], `${p}.rows`, (v, q) => rec(v, q), 8).forEach((r, j) => { const op = str(r['operation'], `${p}.rows[${j}].operation`, 100); if (!names.has(op)) names.set(op, str(r['label'], `${p}.rows[${j}].label`, 200)); });
    else if (c['kind'] === 'metric' || c['kind'] === 'comparison') { const op = str(c['operation'], `${p}.operation`, 100); if (!names.has(op)) names.set(op, str(c['label'], `${p}.label`, 200)); }
  });
  return calculations.map((op) => names.get(op) ?? op);
}

export interface ActionNote { readonly cardId: string; readonly action: string; readonly label: string; readonly alwaysWaits: boolean }
function actionNote(value: unknown, path: string): ActionNote {
  const a = rec(value, path);
  return { cardId: id(a['cardId'], `${path}.cardId`), action: str(a['action'], `${path}.action`, 200), label: str(a['label'], `${path}.label`, 200), alwaysWaits: bool(a['alwaysWaits'], `${path}.alwaysWaits`) };
}

/** What `smallapps.propose` planned from one line: the permission list before anything is made, or why not yet. */
export type Proposal =
  | { readonly supported: true; readonly title: string; readonly uses: Uses; readonly calculationNames: readonly string[]; readonly actions: readonly ActionNote[]; readonly descriptor: Rec }
  | { readonly supported: false; readonly message: string };
export function proposal(value: unknown): Proposal {
  const r = rec(value);
  if (!bool(r['supported'], 'reply.supported')) return { supported: false, message: str(r['message'], 'reply.message', 2000) };
  const d = rec(r['descriptor'], 'reply.descriptor'), u = uses(d['uses'], 'reply.descriptor.uses');
  return {
    supported: true, title: str(d['title'], 'reply.descriptor.title', 200), uses: u,
    calculationNames: calculationNames(d, 'reply.descriptor', u.calculations), actions: list(r['actions'], 'reply.actions', actionNote, 20),
    // Sent back to `smallapps.create` exactly as planned; the engine checks it again against the menu.
    descriptor: d,
  };
}

/** `smallapps.get` (and `create`, `rebuild`): the app as described, with what made it and when. */
export interface App extends AppRow {
  readonly request: string | null; readonly digest: string; readonly calculationNames: readonly string[];
  readonly actions: readonly ActionNote[]; readonly cards: readonly Described[]; readonly updatedAt: string;
}
export function app(value: unknown, path = 'reply'): App {
  const r = rec(value, path), row = appRow(r, path), d = rec(r['descriptor'], `${path}.descriptor`);
  return {
    ...row, request: optStr(r['request'], `${path}.request`, 500), digest: str(r['digest'], `${path}.digest`, 200), updatedAt: when(r['updatedAt'], `${path}.updatedAt`),
    calculationNames: calculationNames(d, `${path}.descriptor`, row.uses.calculations), actions: list(r['actions'] ?? [], `${path}.actions`, actionNote, 20),
    cards: list(d['cards'], `${path}.descriptor.cards`, described, 20),
  };
}
export function rebuilt(value: unknown): { readonly rebuilt: boolean; readonly app: App } {
  const r = rec(value);
  return { rebuilt: bool(r['rebuilt'], 'reply.rebuilt'), app: app(r['app'], 'reply.app') };
}
export function removedApp(value: unknown): { readonly removed: true } {
  if (rec(value)['removed'] !== true) throw new ShapeError('reply.removed');
  return { removed: true };
}

// ---- an opened app: every value from the calculator, as the person who opened it ----

const MISSING: Readonly<Record<string, MissingState>> = {
  'absent': 'absent', 'not loaded yet': 'not-loaded-yet', 'withheld': 'withheld', 'not applicable': 'not-applicable', 'unknown': 'unknown',
};
export type Value =
  | { readonly kind: 'figures'; readonly receiptId: string; readonly items: readonly { readonly key: string; readonly label: string; readonly figure: FigureOrMissing }[]; readonly partial: boolean; readonly gaps: readonly string[] }
  | { readonly kind: 'missing'; readonly figure: FigureOrMissing; readonly receiptId: string | null };
function valueOf(v: unknown, path: string): Value {
  const x = rec(v, path), state = oneOf(x['state'], `${path}.state`, ['figure', 'missing'] as const);
  if (state === 'missing') {
    const said = str(x['missing'], `${path}.missing`, 40), missing = MISSING[said];
    if (missing === undefined) throw new ShapeError(`${path}.missing`);
    return { kind: 'missing', figure: { kind: 'missing', missing }, receiptId: x['receiptId'] === undefined || x['receiptId'] === null ? null : id(x['receiptId'], `${path}.receiptId`) };
  }
  const receiptId = id(x['receiptId'], `${path}.receiptId`);
  const items = list(x['figures'], `${path}.figures`, (f, p) => {
    const g = rec(f, p), unit = oneOf(g['unit'], `${p}.unit`, ['money', 'basis-points'] as const);
    // Basis points are hundredths of a percent, which is what a percent figure carries.
    return { key: str(g['key'], `${p}.key`, 100), label: str(g['label'], `${p}.label`, 200),
      figure: figure({ kind: unit === 'money' ? 'money' : 'percent', exact: g['minor'], receiptId, labels: [] }, p) };
  }, 20);
  const completeness = str(x['completeness'], `${path}.completeness`, 40);
  const gaps = strings(x['gaps'] ?? [], `${path}.gaps`, 50);
  return { kind: 'figures', receiptId, items, partial: completeness === 'partial' || gaps.length > 0, gaps };
}

export interface Entry {
  readonly id: string; readonly who: string; readonly when: string; readonly said: string; readonly status: 'open' | 'done' | 'dropped';
  readonly version: number; readonly at: string; readonly withheld: number;
}
function entry(value: unknown, path: string): Entry {
  const e = rec(value, path);
  return {
    id: id(e['id'], `${path}.id`), who: str(e['who'], `${path}.who`, 200), when: when(e['when'], `${path}.when`), said: str(e['said'], `${path}.said`, 2000),
    status: oneOf(e['status'], `${path}.status`, ['open', 'done', 'dropped'] as const), version: int(e['version'], `${path}.version`), at: when(e['at'], `${path}.at`),
    withheld: e['versionsWithheld'] === undefined ? 0 : int(e['versionsWithheld'], `${path}.versionsWithheld`),
  };
}

export type OpenCard =
  | { readonly kind: 'metric'; readonly id: string; readonly label: string; readonly value: Value }
  | { readonly kind: 'comparison'; readonly id: string; readonly label: string; readonly current: Value; readonly previous: Value }
  | { readonly kind: 'table'; readonly id: string; readonly label: string; readonly rows: readonly { readonly label: string; readonly value: Value }[] }
  | { readonly kind: 'action'; readonly id: string; readonly label: string; readonly alwaysWaits: boolean; readonly press: 'unavailable' | 'read-only' | 'prepares-for-approval' }
  | { readonly kind: 'records'; readonly id: string; readonly label: string; readonly entries: readonly Entry[] };
function openCard(value: unknown, path: string): OpenCard {
  const c = rec(value, path), kind = oneOf(c['kind'], `${path}.kind`, ['metric', 'table', 'comparison', 'action', 'records'] as const);
  const cardId = id(c['id'], `${path}.id`), label = str(c['label'], `${path}.label`, 200);
  switch (kind) {
    case 'metric': return { kind, id: cardId, label, value: valueOf(c['value'], `${path}.value`) };
    case 'comparison': return { kind, id: cardId, label, current: valueOf(c['current'], `${path}.current`), previous: valueOf(c['previous'], `${path}.previous`) };
    case 'table': return { kind, id: cardId, label, rows: list(c['rows'], `${path}.rows`, (v, p) => { const r = rec(v, p); return { label: str(r['label'], `${p}.label`, 200), value: valueOf(r['value'], `${p}.value`) }; }, 8) };
    case 'action': return { kind, id: cardId, label, alwaysWaits: bool(c['alwaysWaits'], `${path}.alwaysWaits`), press: oneOf(c['press'], `${path}.press`, ['unavailable', 'read-only', 'prepares-for-approval'] as const) };
    case 'records': return { kind, id: cardId, label, entries: list(c['entries'], `${path}.entries`, entry, 2000) };
  }
}
export interface Opened { readonly id: string; readonly onDate: string; readonly cards: readonly OpenCard[] }
export function opened(value: unknown): Opened {
  const r = rec(value);
  return { id: id(r['id'], 'reply.id'), onDate: when(r['onDate'], 'reply.onDate'), cards: list(r['cards'], 'reply.cards', openCard, 20) };
}

export interface Pressed { readonly actionId: string; readonly alwaysWaits: boolean }
export function pressed(value: unknown): Pressed {
  const r = rec(value), a = rec(r['action'], 'reply.action'), approval = rec(r['approval'], 'reply.approval');
  if (approval['waits'] !== true) throw new ShapeError('reply.approval.waits');
  return { actionId: id(a['id'], 'reply.action.id'), alwaysWaits: bool(approval['alwaysWaits'], 'reply.approval.alwaysWaits') };
}

// ---- the follow-up book ----

export function book(value: unknown): readonly Entry[] { return list(rec(value)['entries'], 'reply.entries', entry, 2000); }
export function entryChanged(value: unknown): Entry { return entry(rec(value)['entry'], 'reply.entry'); }
export interface History {
  readonly versions: readonly { readonly version: number; readonly at: string; readonly who: string; readonly when: string; readonly said: string; readonly status: Entry['status'] }[];
  readonly withheld: number;
}
export function history(value: unknown): History {
  const r = rec(value);
  return {
    versions: list(r['versions'], 'reply.versions', (v, p) => {
      const x = rec(v, p);
      return { version: int(x['version'], `${p}.version`), at: when(x['at'], `${p}.at`), who: str(x['who'], `${p}.who`, 200), when: when(x['when'], `${p}.when`),
        said: str(x['said'], `${p}.said`, 2000), status: oneOf(x['status'], `${p}.status`, ['open', 'done', 'dropped'] as const) };
    }, 200),
    withheld: int(r['versionsWithheld'], 'reply.versionsWithheld'),
  };
}
