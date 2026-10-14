/**
 * Adapter for the models-ext lane's `smallapps.*` methods, which may not exist yet.
 * The shapes below are this screen's assumption (the lane's task brief); the coordinator
 * adapts them here, in one place, at merge. Every reply is checked into the view types.
 */
import type { FigureOrMissing } from '../../../app/presentation.ts';
import { figure } from '../../trust/kit/figure.ts';
import { bool, list, oneOf, optStr, rec, str, strings } from '../../trust/kit/validate.ts';
import { id, when } from '../validate.ts';

export const SMALLAPPS = {
  list: 'smallapps.list', make: 'smallapps.make', create: 'smallapps.create', get: 'smallapps.get',
  rebuild: 'smallapps.rebuild', view: 'smallapps.view', act: 'smallapps.act',
} as const;
export const FOLLOW_UP_BOOK = 'follow-up-book';

export interface Uses { readonly calculations: readonly string[]; readonly actions: readonly string[] }
function uses(value: unknown, path: string): Uses {
  const u = rec(value, path);
  return { calculations: strings(u['calculations'], `${path}.calculations`, 100), actions: strings(u['actions'], `${path}.actions`, 100) };
}

export type AppState = 'making' | 'made' | 'stale' | 'blocked' | 'refused';
export interface AppRow { readonly id: string; readonly title: string; readonly state: AppState; readonly reason: string | null; readonly madeFrom: string; readonly madeOn: string; readonly uses: Uses }
export function appRow(value: unknown, path = 'reply'): AppRow {
  const a = rec(value, path);
  return {
    id: id(a['id'], `${path}.id`), title: str(a['title'], `${path}.title`, 200),
    state: oneOf(a['state'], `${path}.state`, ['making', 'made', 'stale', 'blocked', 'refused'] as const),
    reason: optStr(a['reason'], `${path}.reason`, 1000), madeFrom: str(a['madeFrom'], `${path}.madeFrom`, 1000), madeOn: when(a['madeOn'], `${path}.madeOn`), uses: uses(a['uses'], `${path}.uses`),
  };
}
export function appList(value: unknown): readonly AppRow[] { return list(rec(value)['apps'], 'reply.apps', appRow, 500); }

export interface Draft { readonly draftId: string; readonly title: string; readonly uses: Uses; readonly refused: string | null }
export function draft(value: unknown): Draft {
  const r = rec(value);
  return { draftId: id(r['draftId'], 'reply.draftId'), title: str(r['title'], 'reply.title', 200), uses: uses(r['uses'], 'reply.uses'), refused: optStr(r['refused'], 'reply.refused', 1000) };
}

export type Card =
  | { readonly kind: 'metric'; readonly title: string; readonly figure: FigureOrMissing }
  | { readonly kind: 'table'; readonly title: string; readonly rows: readonly { readonly label: string; readonly figure: FigureOrMissing }[] }
  | { readonly kind: 'action'; readonly title: string; readonly actionId: string };
function card(value: unknown, path: string): Card {
  const c = rec(value, path);
  const kind = oneOf(c['kind'], `${path}.kind`, ['metric', 'table', 'action'] as const), title = str(c['title'], `${path}.title`, 200);
  if (kind === 'metric') return { kind, title, figure: figure(c['figure'], `${path}.figure`) };
  if (kind === 'table') return { kind, title, rows: list(c['rows'], `${path}.rows`, (v, p) => { const r = rec(v, p); return { label: str(r['label'], `${p}.label`, 200), figure: figure(r['figure'], `${p}.figure`) }; }, 50) };
  return { kind, title, actionId: id(c['actionId'], `${path}.actionId`) };
}
export interface App extends Omit<AppRow, 'reason'> { readonly changed: readonly string[]; readonly textRemoved: boolean; readonly cards: readonly Card[] }
export function app(value: unknown): App {
  const r = rec(value), row = appRow({ ...r, reason: null });
  return { ...row, changed: r['changed'] === undefined ? [] : strings(r['changed'], 'reply.changed', 50), textRemoved: bool(r['textRemoved'], 'reply.textRemoved'), cards: list(r['cards'], 'reply.cards', card, 20) };
}

export interface Entry { readonly id: string; readonly customer: string; readonly date: string; readonly said: string; readonly next: string | null }
export function entries(value: unknown): readonly Entry[] {
  return list(rec(value)['entries'], 'reply.entries', (v, p) => {
    const e = rec(v, p);
    return { id: id(e['id'], `${p}.id`), customer: str(e['customer'], `${p}.customer`, 200), date: when(e['date'], `${p}.date`), said: str(e['said'], `${p}.said`, 2000), next: e['next'] === null ? null : when(e['next'], `${p}.next`) };
  }, 2000);
}
