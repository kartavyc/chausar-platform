/**
 * The small-app descriptor `chausar.smallapp.v1`: a typed document over published calculations,
 * catalogue actions and the follow-up book. It carries no code, markup, links or figures; every
 * number a small app shows comes from a calculator receipt when the app is opened.
 */
import { check } from '../contracts.ts';
import type { Dictionary, Operation } from '../ontology.ts';
import type { Period } from '../memory.ts';

export const SCHEMA = 'chausar.smallapp.v1';
export const BOOKS = ['follow-up'] as const;
export const PRESETS = ['today', 'yesterday', 'last-7-days', 'last-30-days', 'this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-financial-year', 'last-financial-year', 'all-time'] as const;
export type Preset = typeof PRESETS[number];
export type PeriodSpec = { preset: Preset } | { from: string; to: string };
export type CalcCard =
  | { id: string; kind: 'metric'; label: string; operation: string; period: PeriodSpec; branch?: string }
  | { id: string; kind: 'table'; label: string; rows: { label: string; operation: string }[]; period: PeriodSpec; branch?: string }
  | { id: string; kind: 'comparison'; label: string; operation: string; period: PeriodSpec; comparePeriod: PeriodSpec; branch?: string };
export type ActionCard = { id: string; kind: 'action'; label: string; connector: string; operation: string };
export type RecordsCard = { id: string; kind: 'records'; label: string; book: typeof BOOKS[number] };
export type Card = CalcCard | ActionCard | RecordsCard;
export type Uses = { calculations: string[]; actions: string[]; books: string[] };
export type Descriptor = { schema: typeof SCHEMA; title: string; cards: Card[]; uses: Uses; dictionary: { version: number; hash: string } };
/** What the app may use: the published dictionary and the written action catalogue, as the caller sees them. */
export type Menu = { dictionary: Dictionary | null; catalogue: { id: string; operations: { id: string; title?: string }[] }[] };

const CALC_TYPES = new Set<Operation['type']>(['sum', 'margin', 'aging']);
const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|lakh|lakhs|crore|crores|hazaar|hazar)\b/i;
const CODE_LIKE = /[<>{}`\\$=;|]|:\/\/|\bwww\.|\b(?:javascript|data|vbscript|file|blob)\s*:|\bon[a-z]+\s*\(|\bfunction\b|=>|\beval\b|\bimport\b|\brequire\b|\bscript\b|\biframe\b/i;

function record(value: unknown, required: string[], optional: string[] = []): Record<string, any> {
  check(!!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).every(key => typeof key === 'string')
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(field => field.enumerable && 'value' in field),
  'SMALLAPP_INVALID', 'A small app is plain data with declared fields only.');
  const keys = Object.keys(value as object);
  check(required.every(key => keys.includes(key)) && keys.every(key => required.includes(key) || optional.includes(key)),
    'SMALLAPP_INVALID', 'A small app uses only the declared fields.');
  return value as Record<string, any>;
}
function list(value: unknown, max: number): unknown[] {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= max && Object.keys(value).length === value.length,
    'SMALLAPP_INVALID', 'Small app lists are short plain lists.');
  return value;
}
/** Words a model may have written: short, no code, markup or links, and no number at all (the number guard). */
export function words(value: unknown, max = 80): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value),
    'SMALLAPP_INVALID', 'Titles and labels are short plain words.');
  check(!CODE_LIKE.test(value), 'SMALLAPP_CODE_REFUSED', 'Small apps hold words and published references only; code, markup, links and scripts are refused.');
  check(!/\p{N}/u.test(value) && !NUMBER_WORDS.test(value), 'UNGROUNDED_NUMBER', 'Numbers in a small app come only from calculation receipts.');
  return value.trim();
}
const ident = (value: unknown, pattern: RegExp) => { check(typeof value === 'string' && pattern.test(value), 'SMALLAPP_INVALID', 'Use a published identifier.'); return value; };
export const validDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

function periodSpec(value: unknown): PeriodSpec {
  const input = record(value, [], ['preset', 'from', 'to']);
  if ('preset' in input) { record(input, ['preset']); check(PRESETS.includes(input.preset), 'SMALLAPP_INVALID', 'Choose a declared period preset.'); return { preset: input.preset }; }
  record(input, ['from', 'to']);
  check(validDay(input.from) && validDay(input.to) && input.from <= input.to, 'SMALLAPP_INVALID', 'Use an inclusive period with valid dates.');
  return { from: input.from, to: input.to };
}
function card(value: unknown): Card {
  const kind = record(value, ['kind'], ['id', 'label', 'operation', 'period', 'comparePeriod', 'branch', 'rows', 'connector', 'book']).kind;
  const branchOf = (input: Record<string, any>) => 'branch' in input ? { branch: ident(input.branch, /^[A-Za-z0-9_.:-]{1,64}$/) } : {};
  const id = (input: Record<string, any>) => ident(input.id, /^[a-z][a-z0-9-]{0,31}$/);
  if (kind === 'metric') {
    const input = record(value, ['id', 'kind', 'label', 'operation', 'period'], ['branch']);
    return { id: id(input), kind, label: words(input.label), operation: ident(input.operation, /^[a-z][a-z0-9_]{0,63}$/), period: periodSpec(input.period), ...branchOf(input) };
  }
  if (kind === 'table') {
    const input = record(value, ['id', 'kind', 'label', 'rows', 'period'], ['branch']);
    const rows = list(input.rows, 8).map(row => { const r = record(row, ['label', 'operation']); return { label: words(r.label), operation: ident(r.operation, /^[a-z][a-z0-9_]{0,63}$/) }; });
    check(rows.length > 0, 'SMALLAPP_INVALID', 'A table needs at least one published calculation.');
    return { id: id(input), kind, label: words(input.label), rows, period: periodSpec(input.period), ...branchOf(input) };
  }
  if (kind === 'comparison') {
    const input = record(value, ['id', 'kind', 'label', 'operation', 'period', 'comparePeriod'], ['branch']);
    return { id: id(input), kind, label: words(input.label), operation: ident(input.operation, /^[a-z][a-z0-9_]{0,63}$/), period: periodSpec(input.period), comparePeriod: periodSpec(input.comparePeriod), ...branchOf(input) };
  }
  if (kind === 'action') {
    const input = record(value, ['id', 'kind', 'label', 'connector', 'operation']);
    return { id: id(input), kind, label: words(input.label), connector: ident(input.connector, /^[a-z][a-z0-9-]{0,63}$/), operation: ident(input.operation, /^[a-z][a-z0-9-]{0,63}$/) };
  }
  check(kind === 'records', 'SMALLAPP_INVALID', 'Unknown small app card type.');
  const input = record(value, ['id', 'kind', 'label', 'book']);
  check(BOOKS.includes(input.book), 'SMALLAPP_INVALID', 'Choose a declared record book.');
  return { id: id(input), kind, label: words(input.label), book: input.book };
}
export const calculationsOf = (c: Card): string[] => c.kind === 'table' ? c.rows.map(r => r.operation) : c.kind === 'metric' || c.kind === 'comparison' ? [c.operation] : [];
export function usesOf(cards: Card[]): Uses {
  const sorted = (items: string[]) => [...new Set(items)].sort();
  return { calculations: sorted(cards.flatMap(calculationsOf)), actions: sorted(cards.flatMap(c => c.kind === 'action' ? [`${c.connector}/${c.operation}`] : [])),
    books: sorted(cards.flatMap(c => c.kind === 'records' ? [c.book] : [])) };
}

/** Structure, words and the number guard. Unknown keys, code and figures are refused here. */
export function parseDescriptor(value: unknown): Descriptor {
  let size = Infinity; try { size = JSON.stringify(value)?.length ?? Infinity; } catch { /* cycles and exotic values are refused below */ }
  check(size <= 32_000, 'SMALLAPP_INVALID', 'A small app is a small document.');
  const input = record(value, ['schema', 'title', 'cards', 'uses', 'dictionary']);
  check(input.schema === SCHEMA, 'SMALLAPP_INVALID', 'Use the small app descriptor schema.');
  const cards = list(input.cards, 12).map(card);
  check(cards.length > 0 && new Set(cards.map(c => c.id)).size === cards.length, 'SMALLAPP_INVALID', 'A small app needs uniquely named cards.');
  const uses = record(input.uses, ['calculations', 'actions', 'books']);
  for (const key of ['calculations', 'actions', 'books'] as const) list(uses[key], 32).forEach(item => check(typeof item === 'string', 'SMALLAPP_INVALID', 'Uses are published identifiers.'));
  check(JSON.stringify(usesOf(cards)) === JSON.stringify({ calculations: uses.calculations, actions: uses.actions, books: uses.books }),
    'SMALLAPP_USES_MISMATCH', 'The listed calculations and actions must be exactly the ones the cards use.');
  const dictionary = record(input.dictionary, ['version', 'hash']);
  check(Number.isSafeInteger(dictionary.version) && dictionary.version > 0 && typeof dictionary.hash === 'string' && /^[a-f0-9]{64}$/.test(dictionary.hash),
    'SMALLAPP_INVALID', 'Name the exact dictionary version and hash the app was built against.');
  return { schema: SCHEMA, title: words(input.title), cards, uses: usesOf(cards), dictionary: { version: dictionary.version, hash: dictionary.hash } };
}

/** Reasons the app no longer matches the menu, in words. Empty means current. */
export function staleness(descriptor: Descriptor, menu: Menu): string[] {
  const reasons: string[] = [];
  if (!menu.dictionary) return ['No business dictionary is published.'];
  if (menu.dictionary.hash !== descriptor.dictionary.hash || menu.dictionary.version !== descriptor.dictionary.version) reasons.push('The business dictionary changed since this app was built.');
  for (const id of descriptor.uses.calculations) if (!usableOperation(menu.dictionary, id)) reasons.push('A calculation this app uses is no longer published.');
  for (const ref of descriptor.uses.actions) if (!catalogued(menu, ref)) reasons.push('An action this app uses is no longer in the approved catalogue.');
  return [...new Set(reasons)];
}
export function usableOperation(dictionary: Dictionary, id: string): Operation | undefined {
  const operation = dictionary.operations.find(o => o.id === id);
  return operation && CALC_TYPES.has(operation.type) && operation.parameters.includes('period') ? operation : undefined;
}
function catalogued(menu: Menu, ref: string) { const [connector, operation] = ref.split('/'); return menu.catalogue.some(c => c.id === connector && c.operations.some(o => o.id === operation)); }

/** The one checker for planner output and externally proposed descriptors. */
export function checkAgainstMenu(descriptor: Descriptor, menu: Menu, branches: readonly string[]): Descriptor {
  check(menu.dictionary, 'DICTIONARY_REQUIRED', 'Publish business definitions before building a small app.');
  for (const id of descriptor.uses.calculations) {
    check(menu.dictionary.operations.some(o => o.id === id), 'SMALLAPP_UNKNOWN_OPERATION', 'A small app can use only calculations from the published menu.');
    check(usableOperation(menu.dictionary, id), 'SMALLAPP_OPERATION_UNSUPPORTED', 'Comparisons over assumptions and what-ifs are not small app calculations.');
  }
  for (const ref of descriptor.uses.actions) check(catalogued(menu, ref), 'SMALLAPP_UNKNOWN_ACTION', 'A small app can prepare only actions from the approved catalogue.');
  for (const c of descriptor.cards) if ('branch' in c && c.branch !== undefined)
    check(branches.includes('*') || branches.includes(c.branch), 'FORBIDDEN_BRANCH', 'This branch is outside your current access.');
  check(staleness(descriptor, menu).length === 0, 'SMALLAPP_OUT_OF_DATE', 'This small app was built against another dictionary. Propose or rebuild it against the current one.');
  return descriptor;
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
/** Resolve a typed period against a reference day. `all-time` selects every event date. */
export function resolvePeriod(spec: PeriodSpec, onDate: string): Period | undefined {
  if ('from' in spec) return { from: spec.from, to: spec.to };
  const ref = new Date(`${onDate}T00:00:00.000Z`), y = ref.getUTCFullYear(), m = ref.getUTCMonth(), d = ref.getUTCDate();
  const quarter = Math.floor(m / 3) * 3, fy = m >= 3 ? y : y - 1;
  switch (spec.preset) {
    case 'today': return { from: onDate, to: onDate };
    case 'yesterday': { const v = day(utc(y, m, d - 1)); return { from: v, to: v }; }
    case 'last-7-days': return { from: day(utc(y, m, d - 6)), to: onDate };
    case 'last-30-days': return { from: day(utc(y, m, d - 29)), to: onDate };
    case 'this-month': return { from: day(utc(y, m, 1)), to: onDate };
    case 'last-month': return { from: day(utc(y, m - 1, 1)), to: day(utc(y, m, 0)) };
    case 'this-quarter': return { from: day(utc(y, quarter, 1)), to: onDate };
    case 'last-quarter': return { from: day(utc(y, quarter - 3, 1)), to: day(utc(y, quarter, 0)) };
    case 'this-financial-year': return { from: day(utc(fy, 3, 1)), to: onDate };
    case 'last-financial-year': return { from: day(utc(fy - 1, 3, 1)), to: day(utc(fy, 2, 31)) };
    case 'all-time': return undefined;
  }
}
export const PRESET_WORDS: Record<Preset, string> = {
  'today': 'today', 'yesterday': 'yesterday', 'last-7-days': 'the past week', 'last-30-days': 'the past month', 'this-month': 'this month', 'last-month': 'last month',
  'this-quarter': 'this quarter', 'last-quarter': 'last quarter', 'this-financial-year': 'this financial year', 'last-financial-year': 'last financial year', 'all-time': 'all time',
};
