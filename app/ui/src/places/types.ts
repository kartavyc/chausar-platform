/**
 * Place modules: the extension seam for lane-owned screens.
 *
 * The host asks each registered module, in order, whether it draws an address. The first
 * module that answers yes renders the page. A module owns no transport of its own: it calls
 * the engine only through `rpc`, which the trusted host supplies, and every reply is
 * untrusted data that the module validates before drawing. Figures are never calculated
 * here: the module formats what the engine sent and every known figure opens its receipt.
 */
import type { ReactNode } from 'react';
import type { Address, Language, View } from '../app/presentation.ts';

export interface PlaceRpc {
  /** A named engine request. Rejects with an Error carrying a short `code`. */
  request(method: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface PlaceMember { readonly id: string; readonly role: string }

export interface PlaceRenderProps {
  readonly address: Address;
  readonly language: Language;
  readonly view: View;
  readonly member: PlaceMember;
  /** A viewer seat: draw no control that changes anything. */
  readonly viewer: boolean;
  readonly rpc: PlaceRpc;
  /** Whether this exact address is still the live authorized surface. Check before showing a reply. */
  live(address: Address): boolean;
  /** Open the receipt sheet for an engine receipt id. */
  openReceipt(id: string): void;
  /** Navigate to another address (null closes the sheet). */
  navigate(address: Address | null): void;
  /**
   * Ask to open an outside address (SH-10). The host shows the full address as text and opens
   * it in the browser only after the person presses "Open in your browser"; it never opens on
   * its own and the app window never goes there. Absent: draw the address as text only.
   */
  readonly openLink?: ((url: string) => void) | undefined;
  /**
   * Set what the ask line is about (SH-04, BK-12 "ask about this record"): it shows "About: <label>"
   * with a way to clear it, and a question asked then carries `ref` as data. Null clears it. The host
   * clears it when the person leaves this place. Absent: the host has no ask line here.
   */
  readonly setAbout?: ((about: { label: string; ref: { kind: string; id: string } } | null) => void) | undefined;
  /**
   * BK-04 (frame-today): the FR-07 "Bring a file" flow, bound to the host's file chooser and
   * engine port. Returns the flow to draw where the place wants it; `onTaken` runs after a file
   * is taken in. Absent (a viewer seat): draw no "Bring a file" control.
   */
  readonly bringFile?: ((options?: { readonly onTaken?: (() => void) | undefined }) => ReactNode) | undefined;
  /**
   * Live refresh (core-sync-jobs, round 4): call `onEvent` when the workspace records an event of one of these kinds,
   * so the screen re-reads what it shows. An event names only its type code and kinds, never values. Returns the
   * unsubscribe function; call it when the screen goes. Absent: the host offers no live refresh.
   */
  readonly subscribe?: ((kinds: readonly LiveEventKind[], onEvent: (event: LiveEvent) => void) => () => void) | undefined;
}

/** The kinds of change a screen can listen for (`events.subscribe`). Every event is `activity`. */
export type LiveEventKind = 'activity' | 'approvals' | 'actions' | 'jobs' | 'sources' | 'books' | 'answers' | 'trust' | 'devices' | 'workspace' | 'lessons';
export interface LiveEvent { readonly id: string; readonly at: string; readonly type: string; readonly kinds: readonly LiveEventKind[] }

export interface PlaceModule {
  readonly id: string;
  /** True when this module draws the address. Decided by place and sub-place only. */
  handles(address: Address): boolean;
  render(props: PlaceRenderProps): ReactNode;
}

/** A tiny per-module text catalogue: every word a person reads, in English and Hindi. */
export type Catalogue<K extends string> = { readonly en: Readonly<Record<K, string>>; readonly hi: Readonly<Record<K, string>> };
export function words<K extends string>(catalogue: Catalogue<K>, language: Language): Readonly<Record<K, string>> {
  return catalogue[language] ?? catalogue.en;
}
