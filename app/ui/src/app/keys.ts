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
  const chord: Chord = {
    e,
    space,
    ctrl,
    plainCtrl: ctrl && !e.altKey && !e.shiftKey,
    plainAlt: e.altKey && !ctrl && !e.shiftKey,
    bare: !ctrl && !e.altKey && !e.shiftKey,
  };
  for (const entry of KEY_MAP) {
    const found = entry.match?.(chord) ?? null;
    if (found) return found;
  }
  return null;
}

/** The chord flags a matcher reads. */
interface Chord {
  readonly e: KeyboardEvent;
  readonly space: boolean;
  readonly ctrl: boolean;
  readonly plainCtrl: boolean;
  readonly plainAlt: boolean;
  readonly bare: boolean;
}

/**
 * The complete keyboard map (main design, part 11): the one list. The frame's handler reads
 * the global chords from it through `match` (readGlobalKey above), and Help (SH-12) draws
 * every entry from it, so the two never disagree. An entry without `match` belongs to a
 * nearer control (a list's rows and Enter, the driving stop key the native host owns) and
 * is listed so a person can find it. Key names are the same in every language.
 */
export interface KeyMapEntry {
  readonly id: 'ask' | 'place' | 'rows' | 'open' | 'close' | 'adjacent' | 'primary' | 'talk' | 'stop-driving' | 'region' | 'help';
  readonly windows: string;
  readonly mac: string;
  /** What the key does, as a text key. */
  readonly textKey: string;
  readonly match?: (c: Chord) => GlobalKey | null;
}

export const KEY_MAP: ReadonlyArray<KeyMapEntry> = [
  { id: 'ask', windows: 'Ctrl K', mac: 'Cmd K', textKey: 'SH-12.key.ask',
    match: (c) => (c.plainCtrl && (c.e.key === 'k' || c.e.key === 'K') ? { kind: 'ask' } : null) },
  { id: 'place', windows: 'Ctrl 1 to Ctrl 7', mac: 'Cmd 1 to Cmd 7', textKey: 'SH-12.key.place',
    match: (c) => (c.plainCtrl && c.e.key.length === 1 && c.e.key >= '1' && c.e.key <= '7' ? { kind: 'place', index: Number(c.e.key) - 1 } : null) },
  { id: 'rows', windows: 'Up, Down', mac: 'Up, Down', textKey: 'SH-12.key.rows' },
  { id: 'open', windows: 'Enter', mac: 'Enter', textKey: 'SH-12.key.open' },
  { id: 'close', windows: 'Esc', mac: 'Esc', textKey: 'SH-12.key.close',
    match: (c) => (c.e.key === 'Escape' && c.bare ? { kind: 'escape' } : null) },
  { id: 'adjacent', windows: 'Alt Down, Alt Up', mac: 'Option Down, Option Up', textKey: 'SH-12.key.adjacent',
    match: (c) => (!c.plainAlt ? null : c.e.key === 'ArrowDown' ? { kind: 'adjacent', delta: 1 } : c.e.key === 'ArrowUp' ? { kind: 'adjacent', delta: -1 } : null) },
  { id: 'primary', windows: 'Ctrl Enter', mac: 'Cmd Enter', textKey: 'SH-12.key.primary',
    match: (c) => (c.plainCtrl && c.e.key === 'Enter' ? { kind: 'primary' } : null) },
  { id: 'talk', windows: 'Ctrl Space', mac: 'Option Space', textKey: 'SH-12.key.talk',
    match: (c) => (c.plainCtrl && c.space && !c.e.repeat ? { kind: 'talk', phase: 'start' } : null) },
  { id: 'stop-driving', windows: 'Ctrl Alt Pause', mac: 'Cmd Option Pause', textKey: 'SH-12.key.stop' },
  { id: 'region', windows: 'F6, Shift F6', mac: 'F6, Shift F6', textKey: 'SH-12.key.region',
    match: (c) => (c.e.key === 'F6' && !c.ctrl && !c.e.altKey ? { kind: 'region', backwards: c.e.shiftKey } : null) },
  { id: 'help', windows: 'Ctrl /', mac: 'Cmd /', textKey: 'SH-12.key.help',
    match: (c) => (c.plainCtrl && c.e.key === '/' ? { kind: 'help' } : null) },
];

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
