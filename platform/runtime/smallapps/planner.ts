/**
 * The default small-app planner: deterministic local software, no model. It looks up words
 * (English and romanised Hindi, plus a few Devanagari words) for published calculations,
 * catalogue actions, the follow-up book, period presets and the caller's branches. The line
 * is data: any other words in it, including instructions, are never read as commands.
 */
import { BOOKS, PRESET_WORDS, SCHEMA, usableOperation, usesOf, words, type Card, type Descriptor, type Menu, type Preset } from './descriptor.ts';

const OPERATIONS: [string, string[]][] = [
  ['net_sales', ['net sales', 'net bikri', 'shuddh bikri']],
  ['margin', ['contribution margin', 'margin', 'profit', 'profits', 'munafa', 'munafaa', 'fayda', 'faayda', 'मुनाफा']],
  ['aging', ['receivable aging', 'aging', 'ageing', 'overdue', 'dues', 'outstanding', 'receivables', 'udhaar', 'udhar', 'baaki', 'baki', 'bakaya', 'उधार', 'बकाया']],
  ['billed', ['billed', 'billing', 'invoiced', 'invoices', 'bills', 'bill kiya', 'बिल']],
  ['received', ['received', 'collections', 'collection', 'collected', 'payments', 'paisa aaya', 'vasooli', 'vasuli', 'jama', 'वसूली']],
  ['refunds', ['refunds', 'refund', 'returns', 'wapas', 'vapas', 'vaapsi', 'वापसी']],
  ['purchases', ['purchases', 'purchase', 'kharid', 'khareed', 'kharidari', 'खरीद']],
  ['costs', ['costs', 'cost', 'expenses', 'expense', 'kharcha', 'kharch', 'lagat', 'खर्च']],
  ['revenue', ['sales', 'revenue', 'earned', 'bikri', 'becha', 'kamai', 'बिक्री']],
];
const REMINDER = ['reminder', 'reminders', 'remind', 'yaad dila', 'yaad dilao', 'याद'];
const FOLLOW_UP = ['follow up', 'follow ups', 'followup', 'followups', 'call list', 'who to call', 'calls to make', 'call karna', 'phone karna', 'फॉलो'];
const PERIODS: [Preset, string[]][] = [
  ['this-month', ['this month', 'is mahine', 'iss mahine', 'is mahina', 'current month']],
  ['last-month', ['last month', 'previous month', 'pichhle mahine', 'pichle mahine', 'pichhla mahina', 'pichla mahina']],
  ['today', ['today', 'aaj']],
  ['yesterday', ['yesterday']],
  ['last-7-days', ['this week', 'last week', 'is hafte', 'iss hafte', 'pichhle hafte', 'pichle hafte']],
  ['this-quarter', ['this quarter', 'is quarter', 'is timahi']],
  ['last-quarter', ['last quarter', 'previous quarter', 'pichhle quarter', 'pichle quarter']],
  ['this-financial-year', ['this financial year', 'this year', 'is saal', 'iss saal', 'is varsh']],
  ['last-financial-year', ['last financial year', 'last year', 'pichhle saal', 'pichle saal']],
  ['all-time', ['all time', 'ever', 'ab tak', 'shuru se']],
];
const COMPARE = ['compare', 'comparison', 'vs', 'versus', 'against', 'tulna', 'mukabla', 'muqabla', 'मुकाबला'];
const TABLE = ['table', 'saari', 'saare', 'sabhi'];
const PREVIOUS: Partial<Record<Preset, Preset>> = { 'this-month': 'last-month', 'this-quarter': 'last-quarter', 'this-financial-year': 'last-financial-year', 'today': 'yesterday' };

export type Plan = { supported: true; descriptor: Descriptor; understood: Understood; message: string }
  | { supported: false; state: 'not-yet'; descriptor: null; understood: Understood; message: string };
type Understood = { calculations: string[]; actions: string[]; books: string[]; periods: Preset[]; branch: string | null };

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
  const text = { value: normalize(line) };
  const dictionary = menu.dictionary;
  const ops = dictionary ? find(text, OPERATIONS).map(([id]) => id).filter(id => usableOperation(dictionary, id)) : [];
  const reminder = find(text, [['reminder', REMINDER]]).length > 0;
  const followUp = find(text, [['follow-up', FOLLOW_UP]]).length > 0;
  const periods = find(text, PERIODS).map(([preset]) => preset as Preset);
  const compare = find(text, [['compare', COMPARE]]).length > 0, table = find(text, [['table', TABLE]]).length > 0;
  const branchMatches = branches.filter(b => b !== '*' && text.value.includes(` ${b.toLowerCase()} `));
  const branch = branchMatches.length === 1 ? branchMatches[0] : null;
  const action = reminder ? menu.catalogue.flatMap(c => c.operations.filter(o => o.id.includes('reminder')).map(o => ({ connector: c.id, ...o }))).sort((a, b) => `${a.connector}/${a.id}`.localeCompare(`${b.connector}/${b.id}`))[0] : undefined;
  const understood: Understood = { calculations: ops, actions: action ? [`${action.connector}/${action.id}`] : [], books: followUp ? ['follow-up'] : [], periods, branch };
  if (!dictionary || (!ops.length && !action && !followUp)) return { supported: false, state: 'not-yet', descriptor: null, understood,
    message: dictionary ? 'Not yet. Nothing in that line matches a calculation on your menu, an approved action or the follow-up book. Name a figure such as sales, collections or dues, a reminder button, or a follow-up book.'
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
  if (action) cards.push({ id: id(), kind: 'action', label: safeWords(action.title ?? '', 'Prepare a reminder'), connector: action.connector, operation: action.id });
  if (followUp) cards.push({ id: id(), kind: 'records', label: 'Follow-up book', book: BOOKS[0] });

  const parts = [...ops.map(label), ...(action ? ['reminders'] : []), ...(followUp ? ['follow-ups'] : [])];
  let title = parts.join(', '); while (title.length > 80 && parts.length > 1) { parts.pop(); title = parts.join(', '); }
  const descriptor: Descriptor = { schema: SCHEMA, title: safeWords(title.charAt(0).toUpperCase() + title.slice(1), 'My small app'), cards, uses: usesOf(cards), dictionary: { version: dictionary.version, hash: dictionary.hash } };
  return { supported: true, descriptor, understood,
    message: 'This plan uses only calculations from your menu and actions from your approved list. Other words in the line change nothing. Pressing an action card only prepares it for the normal approval.' };
}
