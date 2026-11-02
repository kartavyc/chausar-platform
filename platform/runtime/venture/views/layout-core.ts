// Chausar venture launcher, UI as data (wave 6, package 6H3, decision D40): the block library and the pure rules for a
// place's layout. The engine (views/layout.ts) stores one record per change; the fake engine imports this same file, so
// both answer the same. A layout is data: block ids from this library, plain-word names and saved views. It never holds
// code, styles or markup, and a stored layout that no longer fits the library is read back as far as it still fits.
//
// Guardrails (D40, and the founder's "never fake a capability" and "no money arithmetic in the UI"):
// - Blocks that hold an approval, a question waiting for the owner, a hard stop or a money total always show, keep
//   their slot and keep their name. Only the other blocks move, and they move among the other blocks' slots.
// - A block with figures is renamed only to one of its listed names that mean the same.
// - A block without figures never takes a money word, a digit, another block's name or more words than its own name,
//   so a page never shows more words at rest after a layout change than before it.
// - Every block is shown by default, so showing a block only puts back what was there.
import { ChausarError, check } from '../../portable.ts';

export const LAYOUT_PLACES = ['today', 'money'] as const;
export type LayoutPlace = typeof LAYOUT_PLACES[number];
/** Why a block always shows. */
export type LayoutKeep = 'approval' | 'question' | 'hard-stop' | 'money';
export type LayoutBlockDef = {
  id: string;
  /** The block's own name, as the page shows it (or as the owner knows it, for a block without a heading). */
  name: string;
  keep?: LayoutKeep;
  /** A block with figures: the only names it may take besides its own. */
  aliases?: readonly string[];
  /** A block with no heading of its own to rename (the greeting, notices). */
  fixedName?: true;
};
export type LayoutPlaceDef = { title: string; href: string; blocks: readonly LayoutBlockDef[] };

/**
 * The library. Today: the greeting with what needs you, notices (storage and pause), the goal card, the team, the cards
 * that need you, working now, earlier, ideas, the mini apps pinned to Today (6H1). Money (the overview): the headline tiles, owed with cash ahead, and the
 * two folds under them.
 */
export const LAYOUT_LIBRARY: Readonly<Record<LayoutPlace, LayoutPlaceDef>> = Object.freeze({
  today: {
    title: 'Today', href: '#/today', blocks: [
      { id: 'greeting', name: 'Greeting', keep: 'question', fixedName: true },
      { id: 'notices', name: 'Notices', keep: 'hard-stop', fixedName: true },
      { id: 'goal', name: 'Goal', keep: 'money' },
      { id: 'team', name: 'Team at work' },
      { id: 'needs', name: 'Needs you', keep: 'approval' },
      { id: 'working', name: 'Working now' },
      { id: 'earlier', name: 'Earlier' },
      { id: 'ideas', name: 'Ideas' },
      // 6H1's mini apps pinned to Today (PinnedApps draws nothing when none is pinned). Its heading is 6H1's own.
      { id: 'apps', name: 'Pinned apps', fixedName: true },
    ],
  },
  money: {
    title: 'Money', href: '#/money', blocks: [
      { id: 'glance', name: 'Money at a glance', keep: 'money' },
      { id: 'owed', name: 'Owed and cash ahead', keep: 'money' },
      { id: 'flow', name: 'In and out', aliases: ['Money flow', 'Ins and outs'] },
      { id: 'weeks', name: 'Due soon', aliases: ['Due next', 'Coming due'] },
    ],
  },
});

export const KEEP_WHY: Readonly<Record<LayoutKeep, string>> = Object.freeze({
  approval: 'Approvals always show.',
  question: 'Questions waiting for you always show.',
  'hard-stop': 'Stops and pauses always show.',
  money: 'Money totals always show.',
});

/** The rules the AI reads with the screen (ui_read_screen), in plain words. */
export const LAYOUT_RULES: readonly string[] = Object.freeze([
  'Approvals, questions waiting for the owner, stops and money totals always show, keep their place and keep their name.',
  'A block with figures takes only one of its listed names.',
  'Other names use plain words only: no digits, no money words, no other block\'s name, and no more words than the block\'s own name.',
  'Every change is labelled as made by you and the owner can undo it. Settings, approvals and limits are not changed here.',
  'Layouts hold block ids and names only, never code or styles.',
]);

export const MAX_VIEWS = 5;
const MAX_NAME = 32;
const MAX_VIEW_NAME = 24;
const VIEW_WORDS = 3;
const WORDS = /^[A-Za-z][A-Za-z'&-]*(?: [A-Za-z'&-]+)*$/;
/** A block without figures never takes one of these words: a heading must not pass itself off as a figure. */
const MONEY_WORDS = new Set([
  'money', 'rupee', 'rupees', 'rs', 'inr', 'usd', 'dollar', 'dollars', 'total', 'totals', 'profit', 'profits', 'revenue', 'income',
  'earned', 'earnings', 'earning', 'paid', 'pay', 'owed', 'owe', 'owes', 'due', 'balance', 'cash', 'invoiced', 'invoice', 'invoices',
  'received', 'spent', 'spend', 'cost', 'costs', 'tax', 'gst', 'fee', 'fees', 'price', 'prices', 'amount', 'amounts', 'margin', 'margins',
  'loss', 'losses', 'sales', 'sale', 'budget', 'figures', 'figure',
]);

export type LayoutArrangement = { order: string[]; hidden: string[]; names: Record<string, string> };
export type LayoutSavedView = LayoutArrangement & { id: string; name: string };
export type LayoutState = LayoutArrangement & { views: LayoutSavedView[] };
export type LayoutBy = 'owner' | 'ai';
export type LayoutChange =
  | { op: 'hide' | 'show'; block: string }
  | { op: 'move'; block: string; to: number }
  | { op: 'rename'; block: string; name: string | null }
  | { op: 'save-view'; name: string }
  | { op: 'use-view' | 'delete-view'; view: string }
  | { op: 'reset' }
  /** Undo: back to a stored layout of this place, or to the library's own. */
  | { op: 'restore'; to: string }
  /** The owner keeps what their AI changed (the app only). */
  | { op: 'keep' };
export type LayoutRequest = { place: LayoutPlace; change: LayoutChange };
export type LayoutBlockView = {
  id: string; name: string; defaultName: string; shown: boolean; keep: LayoutKeep | null; why: string | null;
  movable: boolean; rename: 'free' | 'aliases' | 'fixed'; aliases: string[];
};

const invalid = (message: string): never => { throw new ChausarError('INVALID_VENTURE_REQUEST', message); };
const plainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const wordsOf = (text: string) => text.split(' ').filter(Boolean).length;

export function layoutPlace(value: unknown): LayoutPlace {
  check(typeof value === 'string' && (LAYOUT_PLACES as readonly string[]).includes(value), 'LAYOUT_UNKNOWN_PLACE', 'Only Today and Money can be arranged so far.');
  return value as LayoutPlace;
}
export function blockOf(place: LayoutPlace, id: unknown): LayoutBlockDef {
  const block = LAYOUT_LIBRARY[place].blocks.find(item => item.id === id);
  check(block, 'LAYOUT_UNKNOWN_BLOCK', `That part is not on ${LAYOUT_LIBRARY[place].title}.`);
  return block;
}
const movableIds = (place: LayoutPlace) => LAYOUT_LIBRARY[place].blocks.filter(block => !block.keep).map(block => block.id);

export function defaultLayout(place: LayoutPlace): LayoutState {
  return { order: movableIds(place), hidden: [], names: {}, views: [] };
}

/** One request object with exactly these keys. */
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainObject(value)) invalid('Send one change object.');
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) invalid('Send the fields this change needs and nothing else.');
  return record;
}

/** A change as sent, checked to the letter. Unknown ops and extra fields are refused. */
export function parseChange(value: unknown): LayoutChange {
  if (!plainObject(value) || typeof (value as Record<string, unknown>).op !== 'string') invalid('Send one change with its op.');
  const op = (value as Record<string, unknown>).op;
  const str = (record: Record<string, unknown>, key: string, max = 200) => {
    if (typeof record[key] !== 'string' || (record[key] as string).length > max) invalid(`${key} must be short text.`);
    return record[key] as string;
  };
  switch (op) {
    case 'hide': case 'show': { const r = exact(value, ['op', 'block']); return { op, block: str(r, 'block') }; }
    case 'move': {
      const r = exact(value, ['op', 'block', 'to']);
      if (!Number.isSafeInteger(r.to) || (r.to as number) < 0 || (r.to as number) > 20) invalid('to is a slot number from 0.');
      return { op, block: str(r, 'block'), to: r.to as number };
    }
    case 'rename': {
      const r = exact(value, ['op', 'block', 'name']);
      if (r.name !== null && typeof r.name !== 'string') invalid('name is text, or null for the block\'s own name.');
      return { op, block: str(r, 'block'), name: r.name === null ? null : str(r, 'name') };
    }
    case 'save-view': { const r = exact(value, ['op', 'name']); return { op, name: str(r, 'name') }; }
    case 'use-view': case 'delete-view': { const r = exact(value, ['op', 'view']); return { op, view: str(r, 'view') }; }
    case 'restore': { const r = exact(value, ['op', 'to']); return { op, to: str(r, 'to') }; }
    case 'reset': case 'keep': exact(value, ['op']); return { op };
    default: return invalid('That change is not one a layout takes.');
  }
}

/** Every name another block in this place goes by, other than this block's own. */
function takenNames(place: LayoutPlace, except: string): Set<string> {
  const taken = new Set<string>();
  for (const block of LAYOUT_LIBRARY[place].blocks) {
    if (block.id === except) continue;
    taken.add(block.name.toLowerCase());
    for (const alias of block.aliases ?? []) taken.add(alias.toLowerCase());
  }
  return taken;
}

/** A plain-words name: letters, spaces, apostrophes, ampersands and hyphens, one space between words. */
function plainName(raw: string, max: number): string {
  const name = raw.trim();
  check(name.length > 0 && name.length <= max && WORDS.test(name), 'LAYOUT_NAME', `Use plain words, up to ${max} letters, with no digits or symbols.`);
  return name;
}

/** The name a block may take, or null for its own. Throws for a locked block, a figure's other meaning or a bad name. */
export function checkedName(place: LayoutPlace, block: LayoutBlockDef, raw: string | null): string | null {
  check(!block.keep && !block.fixedName, 'LAYOUT_LOCKED', block.keep ? `${block.name} keeps its name. ${KEEP_WHY[block.keep]}` : `${block.name} has no name to change.`);
  if (raw === null || raw.trim() === block.name) return null;
  if (block.aliases) {
    const alias = block.aliases.find(item => item === raw.trim());
    check(alias, 'LAYOUT_FIGURE_NAME', `${block.name} shows figures, so it takes only a name that means the same: ${block.aliases.join(', ')}.`);
    return alias;
  }
  const name = plainName(raw, MAX_NAME);
  check(wordsOf(name) <= wordsOf(block.name), 'LAYOUT_NAME', `Use at most ${wordsOf(block.name) === 1 ? 'one word' : `${wordsOf(block.name)} words`}, so the page does not grow.`);
  check(!name.toLowerCase().split(/[ -]/).some(word => MONEY_WORDS.has(word.replace(/'s$/, ''))), 'LAYOUT_NAME', 'This part shows no figures, so its name cannot sound like money.');
  check(!takenNames(place, block.id).has(name.toLowerCase()), 'LAYOUT_NAME', 'Another part already goes by that name.');
  return name;
}

/**
 * A stored arrangement read back against today's library: unknown ids dropped, a movable block the record does not
 * know (added to the library later) placed last and shown, names that no longer pass dropped.
 */
export function normalizeArrangement(place: LayoutPlace, value: Partial<LayoutArrangement> | undefined): LayoutArrangement {
  const movable = movableIds(place);
  const order = [...new Set((Array.isArray(value?.order) ? value.order : []).filter(id => movable.includes(id)))];
  for (const id of movable) if (!order.includes(id)) order.push(id);
  const hidden = [...new Set((Array.isArray(value?.hidden) ? value.hidden : []).filter(id => movable.includes(id)))];
  const names: Record<string, string> = {};
  for (const [id, name] of Object.entries(plainObject(value?.names) ? value.names : {})) {
    const block = LAYOUT_LIBRARY[place].blocks.find(item => item.id === id);
    if (!block || typeof name !== 'string') continue;
    try { const ok = checkedName(place, block, name); if (ok) names[id] = ok; } catch { /* A name that no longer passes is dropped. */ }
  }
  return { order, hidden, names };
}
export function normalizeLayout(place: LayoutPlace, value: Partial<LayoutState> | undefined): LayoutState {
  const views = (Array.isArray(value?.views) ? value.views : []).filter(view => plainObject(view) && typeof view.id === 'string' && typeof view.name === 'string')
    .slice(0, MAX_VIEWS).map(view => ({ id: view.id, name: view.name, ...normalizeArrangement(place, view) }));
  return { ...normalizeArrangement(place, value), views };
}

const arrangementOf = (state: LayoutState): LayoutArrangement => ({ order: [...state.order], hidden: [...state.hidden], names: { ...state.names } });
export const nameIn = (state: LayoutArrangement, block: LayoutBlockDef) => state.names[block.id] ?? block.name;
const subject = (by: LayoutBy) => (by === 'ai' ? 'Your AI' : 'You');

/** The blocks in the order the page draws them: locked blocks in their own slots, the rest in the owner's order. */
export function describeBlocks(place: LayoutPlace, state: LayoutState): LayoutBlockView[] {
  const order = [...state.order];
  return LAYOUT_LIBRARY[place].blocks.map(slot => {
    const block = slot.keep ? slot : blockOf(place, order.shift());
    return {
      id: block.id, name: nameIn(state, block), defaultName: block.name, shown: !state.hidden.includes(block.id),
      keep: block.keep ?? null, why: block.keep ? KEEP_WHY[block.keep] : null, movable: !block.keep,
      rename: block.keep || block.fixedName ? 'fixed' : block.aliases ? 'aliases' : 'free', aliases: [...(block.aliases ?? [])],
    } satisfies LayoutBlockView;
  });
}

/**
 * Apply one change (not restore or keep, which need the stored records) and say what happened, as the person who did
 * it. Throws LAYOUT_LOCKED, LAYOUT_NAME, LAYOUT_FIGURE_NAME, LAYOUT_UNKNOWN_BLOCK, LAYOUT_UNKNOWN_VIEW, LAYOUT_VIEWS_FULL.
 */
export function applyChange(place: LayoutPlace, current: LayoutState, change: LayoutChange, by: LayoutBy): { state: LayoutState; line: string } {
  const state: LayoutState = structuredClone(current);
  const who = subject(by);
  switch (change.op) {
    case 'hide': case 'show': {
      const block = blockOf(place, change.block);
      check(!block.keep, 'LAYOUT_LOCKED', `${block.name} always shows. ${KEEP_WHY[block.keep!]}`);
      state.hidden = change.op === 'hide' ? [...new Set([...state.hidden, block.id])] : state.hidden.filter(id => id !== block.id);
      return { state, line: `${who} ${change.op === 'hide' ? 'hid' : 'showed'} ${nameIn(state, block)}.` };
    }
    case 'move': {
      const block = blockOf(place, change.block);
      check(!block.keep, 'LAYOUT_LOCKED', `${block.name} keeps its place. ${KEEP_WHY[block.keep!]}`);
      if (change.to >= state.order.length) invalid(`to is a slot from 0 to ${state.order.length - 1}.`);
      state.order = state.order.filter(id => id !== block.id);
      state.order.splice(change.to, 0, block.id);
      return { state, line: `${who} moved ${nameIn(state, block)}.` };
    }
    case 'rename': {
      const block = blockOf(place, change.block);
      const before = nameIn(state, block);
      const name = checkedName(place, block, change.name);
      if (name === null) delete state.names[block.id]; else state.names[block.id] = name;
      return { state, line: name === null ? `${who} put back the name ${block.name}.` : `${who} renamed ${before} to ${name}.` };
    }
    case 'save-view': {
      const name = plainName(change.name, MAX_VIEW_NAME);
      check(wordsOf(name) <= VIEW_WORDS, 'LAYOUT_NAME', `Name a view in at most ${VIEW_WORDS} words.`);
      check(!state.views.some(view => view.name.toLowerCase() === name.toLowerCase()), 'LAYOUT_NAME', 'A view already has that name.');
      check(state.views.length < MAX_VIEWS, 'LAYOUT_VIEWS_FULL', `Keep at most ${MAX_VIEWS} views. Delete one first.`);
      const next = state.views.reduce((max, view) => Math.max(max, Number(/^v(\d+)$/.exec(view.id)?.[1] ?? 0)), 0) + 1;
      state.views.push({ id: `v${next}`, name, ...arrangementOf(state) });
      return { state, line: `${who} saved the view ${name}.` };
    }
    case 'use-view': case 'delete-view': {
      const view = state.views.find(item => item.id === change.view);
      check(view, 'LAYOUT_UNKNOWN_VIEW', 'That view was not found.');
      if (change.op === 'delete-view') {
        state.views = state.views.filter(item => item.id !== view.id);
        return { state, line: `${who} deleted the view ${view.name}.` };
      }
      Object.assign(state, normalizeArrangement(place, view));
      return { state, line: `${who} switched to the view ${view.name}.` };
    }
    case 'reset': return { state: { ...defaultLayout(place), views: state.views }, line: `${who} reset ${LAYOUT_LIBRARY[place].title}.` };
    default: return invalid('Undo and Keep are answered by the engine.');
  }
}

export const restoreLine = (by: LayoutBy) => `${subject(by)} undid the change.`;
export const KEEP_LINE = "You kept your AI's changes.";

/** True when the arrangement differs from the library's own (views aside). */
export function isCustom(place: LayoutPlace, state: LayoutState): boolean {
  const base = defaultLayout(place);
  return state.hidden.length > 0 || Object.keys(state.names).length > 0 || state.order.join() !== base.order.join();
}

/** The line for the AI's offer of a place (founder, 2 November 2026): the app shows a link; only the owner opens it. */
export const goLine = (title: string) => `Your AI suggests ${title}.`;

/** Places the AI may offer, and the sub-page words it may add (Money's pages, Business pages and the like). */
export const NAV_PLACES: readonly { id: string; title: string }[] = Object.freeze([
  { id: 'today', title: 'Today' }, { id: 'chats', title: 'Chats' }, { id: 'team', title: 'Team' }, { id: 'work', title: 'Work' },
  { id: 'clients', title: 'Clients' }, { id: 'money', title: 'Money' }, { id: 'connections', title: 'Connections' }, { id: 'business', title: 'Business' },
]);
export function navigation(place: unknown, sub: unknown): { href: string; title: string } {
  const found = NAV_PLACES.find(item => item.id === place);
  check(found, 'LAYOUT_UNKNOWN_PLACE', 'That is not a place in Chausar.');
  check(sub === undefined || sub === '' || (typeof sub === 'string' && /^[a-z][a-z-]{0,30}$/.test(sub)), 'LAYOUT_UNKNOWN_PLACE', 'That is not a page in Chausar.');
  return { href: sub ? `#/${found.id}/${sub}` : `#/${found.id}`, title: found.title };
}
