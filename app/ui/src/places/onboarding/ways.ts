import type { GalleryWay } from '../../parts/Gallery';
import type { DeptId } from '../../parts/Avatar';
import type { IconName } from '../../parts/icons';
import type { DepartmentId, WayCategory, WaysView, WayView } from '../../engine/types';

/**
 * One way to earn on Start, in the shape the Gallery part draws (D-Start's `.way`). Every string in it is the
 * engine's: W4 4J21 maps `venture.playbooks.list` onto it (one tile per registered playbook, W5 adds the rest), and
 * the price range always reads "model estimate". Board sample ways never stand in for it. The fields past GalleryWay
 * are what the filters, the sort and a tile's Start read: the category id, the hours as numbers, and the sentence a
 * tile's Start puts in the box (never sent).
 */
export interface WayData extends GalleryWay {
  categoryId?: string | undefined;
  minHours?: number | undefined;
  maxHours?: number | undefined;
  starter?: string | undefined;
}

/** A filter chip: the engine's id, its words and its count. */
export interface WayFilter { id: string; label: string; count: number }

/** The gallery's slot on Start: the ways, the one featured tile (the good fit, W4 4C), and what a tile's Start does
 *  (W4 4J21). `categories` and `upTo` are the engine's chips and counts (4J8); without them no filter row shows. */
export interface WaysSlot {
  ways: readonly WayData[];
  featured?: string | undefined;
  onStart: (id: string) => void;
  categories?: readonly WayFilter[] | undefined;
  upTo?: (WayFilter & { maxHours: number }) | undefined;
}

/** The slot when it holds at least one way; an empty list is no gallery. */
export function waysToShow(slot: WaysSlot | undefined): WaysSlot | undefined {
  return slot && slot.ways.length > 0 ? slot : undefined;
}

/** The engine's department ids (4A1) as the department tints the parts draw. */
const DEPT: Readonly<Record<DepartmentId, DeptId>> = { sales: 'sales', marketing: 'mkt', production: 'prod', money: 'money', operations: 'ops' };

/** A way's icon: its own playbook's where it has one, else its category's. */
const PLAYBOOK_ICON: Readonly<Record<string, IconName>> = { youtube: 'youtube' };
const CATEGORY_ICON: Readonly<Record<WayCategory, IconName>> = {
  content: 'file-pen', marketing: 'megaphone', 'money-and-tax': 'receipt-text', 'shops-and-firms': 'briefcase',
};

/** One engine way as a tile, in the owner's language (the engine sends every shown word in Hindi too, `hi`). */
export function wayData(way: WayView, language: 'en' | 'hi', categories: WaysView['categories']): WayData {
  const words = language === 'hi' ? way.hi : null;
  const category = categories.find((item) => item.id === way.category);
  return {
    id: way.id,
    name: words?.label ?? way.label,
    line: words?.line ?? way.line,
    icon: PLAYBOOK_ICON[way.playbook] ?? CATEGORY_ICON[way.category] ?? 'briefcase',
    dept: DEPT[way.department],
    category: category ? (language === 'hi' ? category.hi : category.label) : undefined,
    categoryId: way.category,
    running: way.yours[0]?.name,
    hours: words?.hours ?? way.hours,
    hoursEstimate: way.hoursEstimate,
    minHours: way.minHours,
    maxHours: way.maxHours,
    youDo: words?.youDo ?? way.youDo,
    team: { names: words?.team ?? way.team.map((member) => member.role), line: words?.teamLine ?? way.teamLine },
    pay: { range: words?.pay ?? way.clientsPay.text, per: (words?.per ?? way.clientsPay.per) || undefined, source: words?.source ?? way.clientsPay.source },
    needs: words ? [words.needs.ai, words.needs.connections] : [way.needs.ai, way.needs.connections],
    starter: words?.starter ?? way.starter,
  };
}

/** The engine's list as the gallery's slot (without what a tile's Start does, which the page adds). */
export function waysSlotOf(view: WaysView, language: 'en' | 'hi', featured: string | null): Omit<WaysSlot, 'onStart'> {
  return {
    ways: view.ways.map((way) => wayData(way, language, view.categories)),
    featured: featured ?? undefined,
    categories: view.categories.map((item) => ({ id: item.id, label: language === 'hi' ? item.hi : item.label, count: item.count })),
    upTo: { id: 'up-to', label: language === 'hi' ? view.upTo.hi : view.upTo.label, count: view.upTo.count, maxHours: view.upTo.maxHours },
  };
}

export type WaySort = 'best-fit' | 'fewest-hours' | 'name';
export const WAY_SORTS: readonly WaySort[] = ['best-fit', 'fewest-hours', 'name'];

/**
 * The ways in one of the gallery's orders, as the engine orders them (core/ways.ts orderWays): best fit puts the fit
 * first and keeps the rest as given; fewest hours goes by the most hours a week, then the fewest, then the name; name
 * goes by the shown name in the owner's language (Hindi by hi-IN collation).
 */
export function orderWays(ways: readonly WayData[], by: WaySort, fitWayId: string | undefined, language: 'en' | 'hi'): WayData[] {
  const locale = language === 'hi' ? 'hi-IN' : 'en-IN';
  const byName = (a: WayData, b: WayData) => a.name.localeCompare(b.name, locale);
  const list = [...ways];
  if (by === 'name') return list.sort(byName);
  if (by === 'fewest-hours') return list.sort((a, b) => (a.maxHours ?? 0) - (b.maxHours ?? 0) || (a.minHours ?? 0) - (b.minHours ?? 0) || byName(a, b));
  const fit = list.findIndex((way) => way.id === fitWayId);
  return fit < 0 ? list : [list[fit]!, ...list.slice(0, fit), ...list.slice(fit + 1)];
}

/** The ways one chip shows: all, one category, or those that need at most the "Up to" hours (they read maxHours). */
export function filterWays(ways: readonly WayData[], chip: string, upTo: WaysSlot['upTo']): WayData[] {
  if (chip === 'all') return [...ways];
  if (upTo && chip === upTo.id) return ways.filter((way) => way.maxHours !== undefined && way.maxHours <= upTo.maxHours);
  return ways.filter((way) => way.categoryId === chip);
}
