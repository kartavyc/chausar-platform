/**
 * The shell adapter (SH-03, SH-13): turns a validated `todayx.shell` reply into the banner
 * items the frame draws, and a `todayx.capabilities` group into the "not built yet" state.
 * Pure: no React, no bridge, no clock. Dates and counts are formatted here through
 * `format/`, so a banner never builds a date in a component.
 *
 * Banners keep the fixed order (driving, demo clock, read only, sending closed, jobs
 * paused, update needed, no connection). An action is attached only when the host supplied
 * its callback, so a banner never offers what nobody can do. The lock screen shows no
 * banner; first run shows only Update needed and Demo clock.
 */

import type { CapabilitiesReply, ShellBanner, ShellBannerKind, ShellReply } from '../bridge/todayx-contract.ts';
import { SHELL_BANNER_ORDER } from '../bridge/todayx-contract.ts';
import { date } from '../format/dates.ts';
import { count } from '../format/counts.ts';
import { pluralSelector } from './plural.ts';
import type { BannerItem, BannerKind, Language, ScreenState } from './presentation.ts';

/** The fixed order banners stack in. */
export const BANNER_ORDER: ReadonlyArray<BannerKind> = SHELL_BANNER_ORDER;

/** At most this many banners are shown; the rest fold into "and N more". */
export const BANNERS_SHOWN = 2;

/** The one action each banner may offer, as callbacks the host supplies. */
export interface ShellBannerActions {
  stopDriving?: (() => void) | undefined;
  openDemoClock?: (() => void) | undefined;
  askForPen?: (() => void) | undefined;
  checkRestored?: (() => void) | undefined;
  dismissJobsPaused?: (() => void) | undefined;
  update?: (() => void) | undefined;
}

const ACTION_OF: Readonly<Record<ShellBannerKind, keyof ShellBannerActions | null>> = {
  driving: 'stopDriving',
  'demo-clock': 'openDemoClock',
  'read-only': 'askForPen',
  'sending-closed': 'checkRestored',
  'jobs-paused': 'dismissJobsPaused',
  'update-needed': 'update',
  'no-connection': null,
};

/** An ISO date or instant, shown day first. Only the calendar date is used. */
function day(iso: string, language: Language): string {
  return date(iso.slice(0, 10), 'short', language);
}

function item(b: ShellBanner, language: Language): BannerItem {
  switch (b.kind) {
    case 'driving':
      return { kind: b.kind, values: { program: b.program } };
    case 'demo-clock':
      return { kind: b.kind, values: { date: day(b.date, language) } };
    case 'read-only':
      return { kind: b.kind, values: { holder: b.holder } };
    case 'sending-closed':
      return { kind: b.kind, values: { date: day(b.restoredFrom, language), count: pluralSelector(b.unchecked), display: count(b.unchecked) } };
    case 'update-needed':
      if (b.reason === 'withdrawn') return { kind: b.kind, textKey: 'SH-03.update-needed.withdrawn' };
      return b.date === null ? { kind: b.kind, textKey: 'SH-03.update-needed.undated' } : { kind: b.kind, values: { date: day(b.date, language) } };
    case 'jobs-paused':
    case 'no-connection':
      return { kind: b.kind };
  }
}

/** Sort into the fixed order, one banner per kind (the first of a kind wins). */
export function orderBanners<T extends { readonly kind: BannerKind }>(items: ReadonlyArray<T>): T[] {
  const seen = new Set<BannerKind>();
  return [...items]
    .filter((b) => BANNER_ORDER.includes(b.kind))
    .sort((a, b) => BANNER_ORDER.indexOf(a.kind) - BANNER_ORDER.indexOf(b.kind))
    .filter((b) => (seen.has(b.kind) ? false : (seen.add(b.kind), true)));
}

/** The validated shell reply as banner items, in order, with formatted words. A demo clock
 *  banner on a real workspace is dropped: a real workspace can never show it. */
export function shellBanners(reply: ShellReply, language: Language, actions: ShellBannerActions = {}): BannerItem[] {
  const out: BannerItem[] = [];
  for (const b of reply.banners) {
    if (b.kind === 'demo-clock' && !reply.workspace.demo) continue;
    const base = item(b, language);
    const name = ACTION_OF[b.kind];
    const onPress = name === null ? undefined : actions[name];
    out.push(onPress ? { ...base, action: { onPress } } : base);
  }
  return orderBanners(out);
}

/** Split ordered banners into the ones shown and the ones folded into "and N more". */
export function foldBanners<T extends { readonly kind: BannerKind }>(items: ReadonlyArray<T>, shown: number = BANNERS_SHOWN): { shown: T[]; folded: T[] } {
  const ordered = orderBanners(items);
  return { shown: ordered.slice(0, shown), folded: ordered.slice(shown) };
}

/** First run shows only Update needed and Demo clock. */
export function firstRunBanners<T extends { readonly kind: BannerKind }>(items: ReadonlyArray<T>): T[] {
  return orderBanners(items).filter((b) => b.kind === 'update-needed' || b.kind === 'demo-clock');
}

/** The lock screen shows no banner. */
export function lockScreenBanners(): BannerItem[] {
  return [];
}

/** Which banners a surface may show: the frame all, first run two kinds, the lock none. */
export function bannersFor<T extends { readonly kind: BannerKind }>(surface: 'frame' | 'first-run' | 'lock', items: ReadonlyArray<T>): T[] {
  if (surface === 'lock') return [];
  return surface === 'first-run' ? firstRunBanners(items) : orderBanners(items);
}

/** The demo clock control's state, from the shell reply. */
export type DemoClockState =
  | { readonly kind: 'real' }
  | { readonly kind: 'not-set' }
  | { readonly kind: 'set'; readonly date: string; readonly display: string };

export function demoClockState(reply: ShellReply, language: Language): DemoClockState {
  if (!reply.workspace.demo) return { kind: 'real' };
  return reply.clock.mode === 'demo' ? { kind: 'set', date: reply.clock.date, display: day(reply.clock.date, language) } : { kind: 'not-set' };
}

/** A start date a person typed: a real calendar date, YYYY-MM-DD, or null. */
export function startDate(typed: string): string | null {
  const v = typed.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/**
 * SH-13: the "not built yet" state for one capability group, or null when it is live or
 * not listed. The day is the one the group names; the missing part is the group's name.
 */
export function notBuiltFromCapabilities(reply: CapabilitiesReply, group: string): ScreenState | null {
  const g = reply.groups.find((x) => x.group === group);
  if (g === undefined || g.state === 'live') return null;
  const reasonCode = g.state === 'partial' ? 'CAPABILITY_PARTIAL' : 'CAPABILITY_MISSING';
  const capability = g.day === null ? { state: g.state, reasonCode } : { state: g.state, reasonCode, expectedDay: g.day };
  return { kind: 'not-built', capability, part: g.group };
}
