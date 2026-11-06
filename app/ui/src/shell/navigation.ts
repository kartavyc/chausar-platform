/**
 * Moving around: places, filters and the one sheet, all through the hash so Back works and a link can be shared.
 * Opening a sheet remembers the control that opened it; closing the sheet puts focus back there, or on the same
 * row when the list re-rendered in between.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { formatHash, parseHash, type PlaceId, type Route } from './routes';

let origin: { element: HTMLElement | null; rowId: string | null; again?: string } = { element: null, rowId: null };

/** Release detached private DOM and row identities when Forget resets the frame. */
export function forgetFocusOrigin(): void {
  origin = { element: null, rowId: null };
}

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}
const snapshot = () => window.location.hash;

export function currentRoute(): Route {
  return parseHash(window.location.hash);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => parseHash(hash), [hash]);
}

export function navigate(route: Route): void {
  const next = formatHash(route);
  if (window.location.hash !== next) window.location.hash = next;
}

export function goTo(place: PlaceId, sub?: string, query: Record<string, string> = {}): void {
  const route: Route = { place, query };
  if (sub) route.sub = sub;
  navigate(route);
}

/** Change the place's filters, keeping the place, sub and sheet. */
export function setQuery(query: Record<string, string>): void {
  navigate({ ...currentRoute(), query });
}

/**
 * `tab` names a tab inside the sheet (the agent panel's Chat, W4 4B3: `?sheet=agent:editor&tab=chat`). It belongs to
 * the sheet: opening another sheet without one, or closing the sheet, takes it out of the address.
 */
export function openSheet(kind: string, id: string, from?: Element | null, tab?: string): void {
  rememberOpener((from ?? document.activeElement) as HTMLElement | null);
  const route = currentRoute();
  const { tab: _old, ...query } = route.query;
  navigate({ ...route, query: tab ? { ...query, tab } : query, sheet: { kind, id } });
}

/**
 * The control that opens the next sheet, as openSheet keeps it: the command bar (C2) opens a sheet by its href and
 * keeps itself as the opener, so closing the sheet puts focus back in the bar. `again` finds the opener drawn anew
 * when the sheet opened on another page.
 */
export function rememberOpener(element: HTMLElement | null, again?: string): void {
  origin = { element: element && element !== document.body ? element : null, rowId: element?.closest?.('[data-row-id]')?.getAttribute('data-row-id') ?? null, ...(again ? { again } : {}) };
}

export function closeSheet(): void {
  const route = currentRoute();
  if (!route.sheet) return;
  delete route.sheet;
  delete route.query.tab;
  navigate(route);
}

/** Called by a sheet when it unmounts. Only a real close moves focus: a sheet that is replaced by the next one (or
 *  by its own loaded version) leaves focus to the new sheet's title. */
export function returnFocus(): void {
  if (currentRoute().sheet) return;
  const { element, rowId, again } = origin;
  origin = { element: null, rowId: null };
  if (element?.isConnected) { element.focus(); return; }
  // The opener was drawn again on the new page (the command bar in each page header): focus goes to the new one.
  const redrawn = again ? document.querySelector<HTMLElement>(again) : null;
  if (redrawn) { redrawn.focus(); return; }
  if (rowId) {
    const row = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(rowId)}"]`);
    row?.focus();
  }
}
