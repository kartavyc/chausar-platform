/**
 * Adapter for the jobs-ext lane's autonomy methods (TR-05 Do and the Do row of TR-01):
 * `jobsx.autonomy`, `jobsx.setAutonomy`, `jobsx.autonomyPreset`, `jobsx.caps`, `jobsx.setCaps`,
 * as written in `platform/runtime/jobs-ext/autonomy-methods.ts` on that lane. Every reply is
 * checked into this screen's view types; engine-written words (kind titles, the always-waits
 * list) are data shown as text.
 */
import { ShapeError, bool, int, list, oneOf, rec, str, strings } from '../kit/validate.ts';
import type { Rec } from '../kit/validate.ts';

export const JOBS = {
  autonomy: 'jobsx.autonomy', setAutonomy: 'jobsx.setAutonomy', preset: 'jobsx.autonomyPreset', caps: 'jobsx.caps', setCaps: 'jobsx.setCaps',
} as const;

/** The three presets a person can choose; `custom` is what the switches read after a change by hand. */
export const PRESET_CHOICES = ['ask-everything', 'routine', 'all-but-always-waits'] as const;
export type PresetChoice = (typeof PRESET_CHOICES)[number];
export type Preset = PresetChoice | 'custom';
export type Impact = 'reversible' | 'message' | 'money' | 'destructive';

/** The daily count a kind may run, as jobs-ext allows it. */
export const DAILY_COUNT = { min: 1, max: 100 } as const;

export interface DoKind {
  readonly kind: string; readonly title: string; readonly impact: Impact; readonly switchable: boolean; readonly on: boolean;
  readonly dailyCount: number; readonly usedToday: number; readonly agreement: { readonly approved: number; readonly declined: number };
}
/** The limits jobs-ext keeps; `null` where the reply leaves one out. */
export interface Caps {
  readonly reminderPerCustomerPerDay: number; readonly reminderPerDay: number; readonly activeJobCap: number;
  readonly failureLimit: number | null; readonly groupMax: number | null;
}
export type CapKey = 'reminderPerCustomerPerDay' | 'reminderPerDay' | 'activeJobCap' | 'failureLimit' | 'groupMax';
/** The range jobs-ext accepts for each limit, so a typed value is checked before it is sent. */
export const CAP_RANGE: Readonly<Record<CapKey, readonly [number, number]>> = {
  reminderPerCustomerPerDay: [1, 5], reminderPerDay: [1, 200], activeJobCap: [1, 50], failureLimit: [1, 10], groupMax: [1, 50],
};
export interface Autonomy {
  readonly master: boolean; readonly preset: Preset; readonly kinds: readonly DoKind[];
  readonly alwaysWaits: { readonly intro: string; readonly items: readonly string[] }; readonly caps: Caps;
}

function count(value: unknown, path: string): number {
  const n = int(value, path);
  if (n < 0) throw new ShapeError(path);
  return n;
}
function optCount(value: unknown, path: string): number | null {
  return value === undefined || value === null ? null : count(value, path);
}

export function caps(value: unknown, path = 'reply'): Caps {
  const c: Rec = rec(value, path);
  return {
    reminderPerCustomerPerDay: count(c['reminderPerCustomerPerDay'], `${path}.reminderPerCustomerPerDay`),
    reminderPerDay: count(c['reminderPerDay'], `${path}.reminderPerDay`),
    activeJobCap: count(c['activeJobCap'], `${path}.activeJobCap`),
    failureLimit: optCount(c['failureLimit'], `${path}.failureLimit`),
    groupMax: optCount(c['groupMax'], `${path}.groupMax`),
  };
}

function kind(value: unknown, path: string): DoKind {
  const k = rec(value, path), a = rec(k['agreement'], `${path}.agreement`);
  const name = str(k['kind'], `${path}.kind`, 300);
  if (name.length === 0) throw new ShapeError(`${path}.kind`);
  const switchable = bool(k['switchable'], `${path}.switchable`), on = bool(k['on'], `${path}.on`);
  if (on && !switchable) throw new ShapeError(`${path}.on`);
  return {
    kind: name, title: str(k['title'], `${path}.title`, 300), impact: oneOf(k['impact'], `${path}.impact`, ['reversible', 'message', 'money', 'destructive'] as const),
    switchable, on, dailyCount: count(k['dailyCount'], `${path}.dailyCount`), usedToday: count(k['usedToday'], `${path}.usedToday`),
    agreement: { approved: count(a['approved'], `${path}.agreement.approved`), declined: count(a['declined'], `${path}.agreement.declined`) },
  };
}

/** `jobsx.autonomy` → the Do screen. */
export function autonomy(reply: unknown): Autonomy {
  const r = rec(reply), w = rec(r['alwaysWaits'], 'reply.alwaysWaits');
  return {
    master: bool(r['master'], 'reply.master'),
    preset: oneOf(r['preset'], 'reply.preset', [...PRESET_CHOICES, 'custom'] as const),
    kinds: list(r['kinds'], 'reply.kinds', kind, 2000),
    alwaysWaits: { intro: str(w['intro'], 'reply.alwaysWaits.intro', 500), items: strings(w['items'], 'reply.alwaysWaits.items', 50) },
    caps: caps(r['caps'], 'reply.caps'),
  };
}

/** `jobsx.setAutonomy` → the one kind it changed. */
export function kindChanged(reply: unknown): { readonly kind: string; readonly on: boolean; readonly dailyCount: number } {
  const r = rec(reply);
  return { kind: str(r['kind'], 'reply.kind', 300), on: bool(r['on'], 'reply.on'), dailyCount: count(r['dailyCount'], 'reply.dailyCount') };
}

/** `jobsx.autonomyPreset` → the preset and the kinds it switched on. */
export function presetChanged(reply: unknown): { readonly preset: PresetChoice; readonly on: readonly string[] } {
  const r = rec(reply);
  return { preset: oneOf(r['preset'], 'reply.preset', PRESET_CHOICES), on: strings(r['on'], 'reply.on', 2000) };
}

/** A typed limit, or null when it is not a whole number inside the range jobs-ext accepts. */
export function typedCount(typed: string, [low, high]: readonly [number, number]): number | null {
  const t = typed.trim();
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n >= low && n <= high ? n : null;
}
