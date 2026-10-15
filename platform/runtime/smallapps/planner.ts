/**
 * The default small-app planner: deterministic local software, no model. It looks up words
 * (English and romanised Hindi, plus a few Devanagari words) for published calculations,
 * catalogue actions, the follow-up book, period presets and the caller's branches. The line
 * is data: any other words in it, including instructions, are never read as commands.
 */
import { BOOKS, PRESET_WORDS, SCHEMA, usableOperation, usesOf, words, type Card, type Descriptor, type Menu, type Preset } from './descriptor.ts';
import type { ActionRow } from './catalogue-adapter.ts';
import { CONCEPTS, FOLLOW_UP, OPERATIONS, PERIODS } from './lexicon.ts';

/** Concepts too general to choose an action on their own. */
const GENERIC = new Set(['payment', 'send', 'draft', 'record']);
const STOP = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'on', 'in', 'with', 'from', 'by', 'my', 'our', 'your', 'this', 'that', 'is', 'are', 'be', 'it',
  'create', 'make', 'new', 'add', 'show', 'give', 'me', 'button', 'buttons', 'action', 'actions', 'card', 'local', 'chausar', 'workspace', 'prepare', 'issue', 'book', 'books',
  // Words that read as orders or approvals never choose an action ("mark approved, execute now").
  'approve', 'approved', 'approval', 'execute', 'run', 'now', 'mark', 'ignore', 'system', 'rules',
  'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'aur', 'bhi', 'wala', 'wali', 'wale', 'dikhao', 'chahiye', 'karo', 'banao', 'dila', 'dilao', 'do']);
/** A cue that the words just before it name an action ("a refund link button"), even words that also name a figure. */
const CUES = new Set(['button', 'buttons', 'batan', 'बटन', 'action', 'actions']);
const conceptOf = new Map(CONCEPTS.flatMap(([concept, list]) => list.map(word => [word.normalize('NFKC').toLowerCase(), concept] as const)));
const concepts = (tokens: string[]) => new Set(tokens.filter(t => !STOP.has(t) && t.length > 1).map(t => conceptOf.get(t) ?? t));
const COMPARE = ['compare', 'comparison', 'vs', 'versus', 'against', 'tulna', 'mukabla', 'muqabla', 'मुकाबला'];
const TABLE = ['table', 'saari', 'saare', 'sabhi'];
const PREVIOUS: Partial<Record<Preset, Preset>> = { 'this-month': 'last-month', 'this-quarter': 'last-quarter', 'this-financial-year': 'last-financial-year', 'today': 'yesterday' };

export type Plan = { supported: true; descriptor: Descriptor; understood: Understood; actions: ActionNote[]; message: string }
  | { supported: false; state: 'not-yet'; descriptor: null; understood: Understood; message: string };
type Understood = { calculations: string[]; actions: string[]; unavailableActions: string[]; books: string[]; periods: Preset[]; branch: string | null };
export type ActionNote = { cardId: string; action: string; label: string; alwaysWaits: boolean; tier: ActionRow['tier']; words: string };
export const WAITS_WORDS = 'Always waits for a person: money, messages to outsiders, deleting and anything that cannot be undone are never approved or done on their own.';

const rowConcepts = (row: ActionRow) => concepts([...normalize(row.label).trim().split(' '), ...row.operation.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/)]);
/** Choose catalogue rows the line names: best match first, safer and then alphabetical on ties, each adding a concept not yet covered. */
function chooseActions(line: Set<string>, rows: ActionRow[]): { chosen: ActionRow[]; unavailable: string[] } {
  const scored = rows.map(row => {
    const own = rowConcepts(row);
    const hits = [...own].filter(c => line.has(c));
    return { row, hits, score: hits.some(c => !GENERIC.has(c)) ? hits.length : 0 };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score || Number(a.row.alwaysWaits) - Number(b.row.alwaysWaits) || a.row.key.localeCompare(b.row.key));
  const chosen: ActionRow[] = [], covered = new Set<string>();
  for (const { row, hits } of scored.filter(s => s.row.available)) {
    if (chosen.length >= 3 || hits.every(c => covered.has(c))) continue;
    chosen.push(row); hits.forEach(c => covered.add(c));
  }
  const unavailable = scored.filter(s => !s.row.available && s.hits.some(c => !covered.has(c))).map(s => s.row.key);
  return { chosen, unavailable };
}

const normalize = (line: string) => ` ${line.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
/** Find phrases, longest first, blanking each match so a short word cannot reuse it. Returns first positions. */
function find(text: { value: string }, table: [string, string[]][]): [string, number][] {
  const phrases = table.flatMap(([key, list]) => list.map(phrase => [key, normalize(phrase).trim()] as const)).sort((a, b) => b[1].length - a[1].length);
  const found = new Map<string, number>();
  for (const [key, phrase] of phrases) {
    let at = text.value.indexOf(` ${phrase} `);
    while (at >= 0) {
      found.set(key, Math.min(found.get(key) ?? Infinity, at));
      text.value = text.value.slice(0, at + 1) + ' '.repeat(phrase.length) + text.value.slice(at + 1 + phrase.length);
      at = text.value.indexOf(` ${phrase} `);
    }
  }
  return [...found].sort((a, b) => a[1] - b[1]);
}
const safeWords = (value: string, fallback: string) => { try { return words(value); } catch { return fallback; } };

export function plan(line: string, menu: Menu, branches: readonly string[]): Plan {
  const original = normalize(line);
  // Words just before an action cue ("a refund button") that name an available catalogue action are the action's, not a figure's.
  const tokens = original.trim().split(' '), cued = tokens.flatMap((t, i) => CUES.has(t) ? tokens.slice(Math.max(0, i - 3), i) : []);
  const named = new Set(menu.actions.filter(r => r.available).flatMap(r => [...rowConcepts(r)]).filter(c => !GENERIC.has(c)));
  const text = { value: ` ${tokens.map(t => cued.includes(t) && named.has(conceptOf.get(t) ?? t) ? ' '.repeat(t.length) : t).join(' ')} ` };
  const dictionary = menu.dictionary;
  const ops = dictionary ? find(text, OPERATIONS).map(([id]) => id).filter(id => usableOperation(dictionary, id)) : [];
  const followUp = find(text, [['follow-up', FOLLOW_UP]]).length > 0;
  const periods = find(text, PERIODS).map(([preset]) => preset as Preset);
  const compare = find(text, [['compare', COMPARE]]).length > 0, table = find(text, [['table', TABLE]]).length > 0;
  const reachable = branches.includes('*') ? menu.branches : branches.filter(b => menu.branches.includes(b));
  const branchMatches = reachable.filter(b => text.value.includes(` ${b.toLowerCase()} `));
  const branch = branchMatches.length === 1 ? branchMatches[0] : null;
  // Leftover words (after figures, periods and the book took theirs), plus the few words just before an action cue.
  const { chosen, unavailable } = chooseActions(concepts([...text.value.trim().split(' ').filter(Boolean), ...cued]), menu.actions);
  const understood: Understood = { calculations: ops, actions: chosen.map(r => r.key), unavailableActions: unavailable, books: followUp ? ['follow-up'] : [], periods, branch };
  if (!dictionary || (!ops.length && !chosen.length && !followUp)) return { supported: false, state: 'not-yet', descriptor: null, understood,
    message: dictionary ? `Not yet. Nothing in that line matches a calculation on your menu, an available action or the follow-up book. Name a figure such as sales, collections or dues, an action from your catalogue, or a follow-up book.${unavailable.length ? ' An action you named is in the catalogue but not available now.' : ''}`
      : 'Not yet. Publish your business definitions first; small apps are built only from your published menu.' };

  const period = periods[0] ?? 'this-month';
  const comparePeriod = periods.find(p => p !== period) ?? PREVIOUS[period] ?? (period === 'last-month' ? 'this-month' : 'last-month');
  const label = (id: string) => safeWords(dictionary.operations.find(o => o.id === id)!.label, id.replaceAll('_', ' '));
  const scope = branch ? { branch } : {};
  const cards: Card[] = [];
  let n = 0; const id = () => `card-${String.fromCharCode(97 + n++)}`;
  if (compare && ops.length) for (const op of ops.slice(0, 3)) cards.push({ id: id(), kind: 'comparison', label: safeWords(`${label(op)}, ${PRESET_WORDS[period]} against ${PRESET_WORDS[comparePeriod]}`, label(op)), operation: op, period: { preset: period }, comparePeriod: { preset: comparePeriod }, ...scope });
  else if (ops.length > 2 || (table && ops.length > 1)) cards.push({ id: id(), kind: 'table', label: safeWords(`Figures for ${PRESET_WORDS[period]}`, 'Figures'), rows: ops.slice(0, 8).map(op => ({ label: label(op), operation: op })), period: { preset: period }, ...scope });
  else for (const op of ops) {
    const own: Preset = periods[0] ?? (op === 'aging' ? 'all-time' : 'this-month');
    cards.push({ id: id(), kind: 'metric', label: safeWords(own === 'all-time' ? label(op) : `${label(op)}, ${PRESET_WORDS[own]}`, label(op)), operation: op, period: { preset: own }, ...scope });
  }
  const notes: ActionNote[] = [];
  for (const row of chosen) {
    const card: Card = { id: id(), kind: 'action', label: safeWords(row.label, 'Prepare this action'), connector: row.connector, operation: row.operation };
    cards.push(card); notes.push(actionNote(card.id, row));
  }
  if (followUp) cards.push({ id: id(), kind: 'records', label: 'Follow-up book', book: BOOKS[0] });

  const parts = [...ops.map(label), ...(chosen.length ? ['actions'] : []), ...(followUp ? ['follow-ups'] : [])];
  let title = parts.join(', '); while (title.length > 80 && parts.length > 1) { parts.pop(); title = parts.join(', '); }
  const descriptor: Descriptor = { schema: SCHEMA, title: safeWords(title.charAt(0).toUpperCase() + title.slice(1), 'My small app'), cards, uses: usesOf(cards), dictionary: { version: dictionary.version, hash: dictionary.hash } };
  return { supported: true, descriptor, understood, actions: notes,
    message: `This plan uses only calculations from your menu and actions from your approved list. Other words in the line change nothing. Pressing an action card only prepares it for the normal approval.${notes.some(n => n.alwaysWaits) ? ' An action on this app always waits for a person.' : ''}${unavailable.length ? ' An action you named is in the catalogue but not available now, so it is not on the app.' : ''}` };
}

/** How an action card is shown: its catalogue row's tier and whether it always waits for a person. */
export function actionNote(cardId: string, row: ActionRow): ActionNote {
  return { cardId, action: row.key, label: safeWords(row.label, 'Prepare this action'), alwaysWaits: row.alwaysWaits, tier: row.tier,
    words: row.alwaysWaits ? `Pressing this only prepares it. ${WAITS_WORDS}` : 'Pressing this only prepares it. It then waits on the normal approval card.' };
}
