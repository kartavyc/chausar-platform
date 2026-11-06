/**
 * The one list of where the owner can go (C1, the seam for C2's Ctrl K bar and C4): the rail's places, Settings and
 * its pages in their four groups, and the sub-pages of Money, Clients and Work. Each entry is a title key and an
 * address; `goToHref` goes there through the hash, so Back works. Pure apart from `goToHref`: no engine, no request.
 * A new page joins here (and in its place), never in a second list.
 */

import { navigate } from './navigation';
import { parseHash, RAIL_PLACES } from './routes';
import { SETTINGS_HREF, settingsFor, type SettingsGroupId } from './settings';

export type NavArea = 'place' | 'money' | 'clients' | 'work' | 'settings';

export interface NavEntry {
  /** Unique: the place id, or `<area>/<sub>`. */
  id: string;
  /** The title's text key. */
  title: string;
  href: string;
  area: NavArea;
  /** A settings page's group. */
  group?: SettingsGroupId | undefined;
}

/** Money's pages in the order of its tabs (Businesses shows only with two or more businesses). */
export const MONEY_PAGES = ['overview', 'invoices', 'bills', 'books', 'margins', 'spend', 'journal', 'businesses'] as const;
/** Money's tabs that sit in the row; the rest are under More at every width (C1 task 3). */
export const MONEY_PRIMARY = ['overview', 'invoices', 'bills'] as const;
export const CLIENTS_PAGES = ['clients', 'pipeline', 'network'] as const;

/** Every entry, in rail order, then Settings. `venture` decides Your CA (only on the CA firm playbook). */
export function navEntries(venture?: { playbook?: { id: string } | null | undefined } | null): NavEntry[] {
  const places: NavEntry[] = RAIL_PLACES.map((place) => ({ id: place, title: `place.${place}`, href: `#/${place}`, area: 'place' }));
  const money: NavEntry[] = MONEY_PAGES.map((sub) => ({ id: `money/${sub}`, title: `money.sub.${sub}`, href: sub === 'overview' ? '#/money' : `#/money/${sub}`, area: 'money' }));
  const clients: NavEntry[] = CLIENTS_PAGES.map((sub) => ({ id: `clients/${sub}`, title: `clients.sub.${sub}`, href: sub === 'clients' ? '#/clients' : `#/clients/${sub}`, area: 'clients' }));
  const work: NavEntry[] = [{ id: 'work/ideas', title: 'kit-rules.chip', href: '#/work/ideas', area: 'work' }];
  const settings: NavEntry[] = [
    { id: 'business', title: 'place.business', href: SETTINGS_HREF, area: 'settings' },
    ...settingsFor(venture).flatMap((group) => group.pages.map((p): NavEntry => ({ id: `business/${p.sub}`, title: p.title, href: p.href, area: 'settings', group: group.id }))),
  ];
  return [...places, ...money, ...clients, ...work, ...settings];
}

/** Go to one entry's address (or any `#/...` address), through the hash. */
export function goToHref(href: string): void {
  navigate(parseHash(href));
}
