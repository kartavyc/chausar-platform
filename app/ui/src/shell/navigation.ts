/**
 * Moving around: places, filters and the one sheet, all through the hash so Back works and a link can be shared.
 * Opening a sheet remembers the control that opened it; closing the sheet puts focus back there, or on the same
 * row when the list re-rendered in between.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { formatHash, parseHash, type PlaceId, type Route } from './routes';

let origin: { element: HTMLElement | null; rowId: string | null } = { element: null, rowId: null };

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

export function openSheet(kind: string, id: string, from?: Element | null): void {
  const element = (from ?? document.activeElement) as HTMLElement | null;
  origin = { element: element && element !== document.body ? element : null, rowId: element?.closest?.('[data-row-id]')?.getAttribute('data-row-id') ?? null };
  navigate({ ...currentRoute(), sheet: { kind, id } });
}

export function closeSheet(): void {
  const route = currentRoute();
  if (!route.sheet) return;
  delete route.sheet;
  navigate(route);
}

/** Called by a sheet when it unmounts. Only a real close moves focus: a sheet that is replaced by the next one (or
 *  by its own loaded version) leaves focus to the new sheet's title. */
export function returnFocus(): void {
  if (currentRoute().sheet) return;
  const { element, rowId } = origin;
  origin = { element: null, rowId: null };
  if (element?.isConnected) { element.focus(); return; }
  if (rowId) {
    const row = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(rowId)}"]`);
    row?.focus();
  }
}
