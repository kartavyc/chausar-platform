/**
 * The keys that work everywhere (main design, part 11).
 *   Ctrl K          go to the ask line
 *   Ctrl 1 to 7     go to a place
 *   Esc             close the sheet, from anywhere, even inside a field
 *   Alt Down / Up   next and previous item while a sheet is open
 *   Ctrl Enter      the main action of the sheet. Never for money, which always asks again.
 *   F6              move between the rail, the page, the sheet and the ask line
 *   Ctrl /          show the list of keys
 *   Ctrl Space      hold to talk (only when voice is supplied and on)
 * Up/Down/Enter inside a list belong to RowList, not here.
 *
 * A key release never repeats an action. The only thing a release can mean is the end of
 * hold-to-talk, and it means that whichever key of the chord comes up first: Space with
 * Ctrl already released, or Ctrl with Space still down. The frame ignores an end when
 * nothing is held.
 *
 * A press is ignored while text is being composed (IME), when something nearer already
 * consumed it, and when it carries a modifier the chord does not name.
 */

export type GlobalKey =
  | { kind: 'ask' }
  | { kind: 'place'; index: number }
  | { kind: 'escape' }
  | { kind: 'adjacent'; delta: -1 | 1 }
  | { kind: 'primary' }
  | { kind: 'region'; backwards: boolean }
  | { kind: 'help' }
  | { kind: 'talk'; phase: 'start' | 'end' };

/** Translate a key event into a named intent, or null when it is an ordinary key. */
export function readGlobalKey(e: KeyboardEvent): GlobalKey | null {
  const space = e.code === 'Space' || e.key === ' ';

  if (e.type === 'keyup') {
    return space || e.key === 'Control' || e.key === 'Meta' ? { kind: 'talk', phase: 'end' } : null;
  }
  if (e.type !== 'keydown') return null;
  if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return null;

  const ctrl = e.ctrlKey || e.metaKey;
  const plainCtrl = ctrl && !e.altKey && !e.shiftKey;
  const plainAlt = e.altKey && !ctrl && !e.shiftKey;
  const bare = !ctrl && !e.altKey && !e.shiftKey;

  if (plainCtrl && (e.key === 'k' || e.key === 'K')) return { kind: 'ask' };
  if (plainCtrl && e.key.length === 1 && e.key >= '1' && e.key <= '7') return { kind: 'place', index: Number(e.key) - 1 };
  if (plainCtrl && e.key === '/') return { kind: 'help' };
  if (plainCtrl && e.key === 'Enter') return { kind: 'primary' };
  if (plainCtrl && space) return e.repeat ? null : { kind: 'talk', phase: 'start' };
  if (e.key === 'F6' && !ctrl && !e.altKey) return { kind: 'region', backwards: e.shiftKey };
  if (e.key === 'Escape' && bare) return { kind: 'escape' };
  if (plainAlt && e.key === 'ArrowDown') return { kind: 'adjacent', delta: 1 };
  if (plainAlt && e.key === 'ArrowUp') return { kind: 'adjacent', delta: -1 };
  return null;
}

/** The regions F6 cycles through, in order. Missing regions are skipped. */
export const REGION_ORDER = ['rail', 'page', 'sheet', 'ask'] as const;
export type RegionId = (typeof REGION_ORDER)[number];

/** With no current region, or one that is no longer on the screen, F6 starts at the
 *  first region and Shift F6 at the last. */
export function nextRegion(current: RegionId | null, present: ReadonlySet<RegionId>, backwards: boolean): RegionId | null {
  const order = REGION_ORDER.filter((r) => present.has(r));
  if (order.length === 0) return null;
  const i = current ? order.indexOf(current) : -1;
  if (i === -1) return (backwards ? order[order.length - 1] : order[0]) ?? null;
  const step = backwards ? -1 : 1;
  return order[(i + step + order.length) % order.length] ?? null;
}
