/**
 * The small-app descriptor `chausar.smallapp.v1`: a typed document over published calculations,
 * catalogue actions and the follow-up book. It carries no code, markup, links or figures; every
 * number a small app shows comes from a calculator receipt when the app is opened.
 */
import { check } from '../contracts.ts';
import type { Dictionary, Operation } from '../ontology.ts';
import type { Period } from '../memory.ts';
import type { ActionRow } from './catalogue-adapter.ts';
import { CONCEPTS, CONNECTIVES, FOLLOW_UP, OPERATIONS, PERIODS } from './lexicon.ts';

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
/** What the app may use: the published dictionary, the write catalogue rows and the workspace's branches, as the caller sees them. */
export type Menu = { dictionary: Dictionary | null; actions: ActionRow[]; branches: string[] };

const CALC_TYPES = new Set<Operation['type']>(['sum', 'margin', 'aging']);
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
/** Case, compatibility forms and Devanagari spelling variants (nukta, candrabindu) folded together. */
export const fold = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\u093C/g, '').replace(/\u0901/g, '\u0902');
const set = (...lists: string[]) => new Set(lists.join(' ').split(/\s+/).filter(Boolean).map(fold));
/**
 * Cardinal number words a label may not carry: English, and Hindi 1 to 100 in romanised (common
 * spellings) and Devanagari form. Romanised "do" (two) and "saath"/"sath" (sixty) are left out
 * (also "give" and "with"); the menu allowlist in `checkAgainstMenu` still refuses them where no
 * menu word uses them.
 */
const ENGLISH = set(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fourty fifty sixty seventy eighty ninety',
  'hundred hundreds thousand thousands million millions billion billions trillion dozen dozens lakh lakhs lac lacs crore crores');
const CARDINALS = new Set([...ENGLISH, ...set(
  'ek teen chaar char paanch panch chhe chhah chheh chha saat aath nau das dus gyarah gyaarah barah baarah terah chaudah chodah pandrah pandra solah satrah sattrah atharah athaarah unnees unnis unees',
  'bees bis ikkees ikkis bais baees baais baaees teis teees teeis chaubees chaubis pachees pachchis pachis pachchees chhabbees chhabbis sattaees sattais attaees atthaees atthais athais untees untis unatees',
  'tees tis ikattees iktees iktis battees battis taintees taintis tetis chauntees chauntis chontis paintees paintis chhattees chhattis chattis saintees saintis adtees adtis artees artis untaalees untalis unchalis',
  'chalis chaalis chaalees iktaalees iktalis bayaalees bayalis taintaalees taintalis chavaalees chavalis chawalis paintaalees paintalis chhiyaalees chhiyalis saintaalees saintalis adtaalees adtalis artalis',
  'unanchaas unchaas unchas pachas pachaas ikyaavan ikyavan baavan bavan tirepan tirpan chauvan chauwan pachpan chhappan sattaavan sattavan athaavan atthavan attavan unsath unasath',
  'iksath ikasath baasath basath tiresath tirsath chausath chaunsath painsath chhiyaasath chhiyasath sadsath sarsath adsath arsath unhattar',
  'sattar ikhattar ikahattar bahattar tihattar chauhattar pachhattar chhihattar sathattar satahattar athhattar atthattar unaasi unasi unyasi',
  'assi assee ikyaasi ikyasi bayaasi bayasi tiraasi tirasi chauraasi chaurasi pachaasi pachasi chhiyaasi chhiyasi sataasi sattasi athaasi atthasi navaasi navasi nawasi',
  'nabbe nabbe ikyaanave ikyanve ikyanbe baanave banve banbe tiraanave tiranve tiranbe chauraanave chauranve chauranbe pachaanave pachanve pachanbe chhiyaanave chhiyanve sattaanave sattanve atthaanave attanve atthanve ninyaanave ninyanve nanyanve',
  'sau saikda saikde hazaar hazar hajar laakh karod karor arab kharab neel padam shankh',
  'शून्य एक दो तीन चार पांच छह छः छे सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह पन्द्रह सोलह सत्रह अठारह उन्नीस बीस',
  'इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस अठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस उनचालीस',
  'चालीस इकतालीस बयालीस तैंतालीस चवालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरेपन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन अठावन उनसठ',
  'साठ इकसठ बासठ तिरेसठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी उनासी',
  'अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी अठासी नवासी नब्बे इक्यानबे इक्यानवे बानबे बानवे तिरानबे तिरानवे चौरानबे चौरानवे पचानबे पचानवे छियानबे छियानवे सत्तानबे सत्तानवे अट्ठानबे अट्ठानवे निन्यानबे निन्यानवे',
  'सौ सैकड़ा सैकड़े हज़ार हजार लाख करोड़ करोड अरब खरब नील पद्म शंख')]);
/**
 * Other ways of stating a quantity: ordinals, fractions and shares, percentages, multiples and words
 * for zero, in English, romanised Hindi and Devanagari. "quarter" is a period word and is left to the
 * allowlist, which reads it only inside "this quarter" and "last quarter".
 */
const QUANTITY_WORDS = set(
  'first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth thirtieth fortieth fiftieth sixtieth seventieth eightieth ninetieth hundredth thousandth millionth',
  'half halves halved halving thirds fourths fifths sixths sevenths eighths ninths tenths hundredths thousandths percent percentage percentages percentile pct cent',
  'double doubles doubled doubling triple triples tripled tripling treble trebled quadruple quadrupled quintuple twice thrice once twofold threefold fourfold fivefold tenfold hundredfold thousandfold single pair pairs couple',
  'zero zeros zeroes nil nill none nothing naught nought zilch nada null',
  'dedh dhai adhai sava paune pehla pehli pehle pahla pahli pahle doosra doosri doosre dusra dusri dusre teesra teesri teesre tisra tisri chautha chauthi chauthe paanchva paanchvan panchva panchvi chhatha chhathi satva aathva dasva',
  'aadha aadhi aadhe adha adhi adhe chauthai chauthaai tihai tihaai paav pav pratishat fisadi feesadi fisdi',
  'dugna dugni dugne duguna dugune doguna dogune dugunaa tigna tigni tiguna tigune chaugna chauguna guna gune guni gunaa shunya shoonya sunya sifar sifr',
  'डेढ़ ढाई सवा पौने पहला पहली पहले दूसरा दूसरी दूसरे तीसरा तीसरी तीसरे चौथा चौथी चौथे पांचवां पांचवीं पांचवें छठा छठी सातवां आठवां दसवां',
  'आधा आधी आधे चौथाई तिहाई पाव प्रतिशत फ़ीसदी फीसद दुगना दुगुना दोगुना दोगुनी दुगनी तिगुना चौगुना गुना गुनी गुने शून्य सिफ़र');
/** Phrases for "nothing" used as a quantity ("kuch nahi"). */
const ZERO_PHRASES = ['kuch nahi', 'kuchh nahi', 'kuch nahin', 'kuchh nahin', 'kuch bhi nahi', 'kuchh bhi nahi', 'कुछ नहीं', 'कुछ भी नहीं'].map(fold);
/**
 * Long English cardinals also caught when letters are run together or spaced out ("t w e n t y").
 * Romanised Hindi is not matched inside other words ("paint is" would read as "paintis", thirty-five);
 * spaced-out letters fail the menu allowlist instead.
 */
const JOINED = [...ENGLISH].filter(w => /^[a-z]{6,}$/.test(w) && !['dozens'].includes(w));
const ROMAN = /^(?=[MDCLXVI]{2,}$)M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
/** Words that read as orders to the system or claims about approval. A label describes; it never instructs. */
const INSTRUCTION_WORDS = set('ignore disregard override bypass jailbreak system assistant prompt prompts instruction instructions approve approved approval approvals autoapprove',
  'automatic automatically auto execute executed executing skip unlock sudo admin manzoor manjoor अनदेखा मंजूर मंज़ूर');
/** One script per word, and only Latin or Devanagari: look-alike letters from other scripts cannot spell around the guards. */
const scriptOf = (ch: string) => /\p{Script=Latin}/u.test(ch) ? 'latin' : /\p{Script=Devanagari}/u.test(ch) ? 'devanagari' : /\p{M}/u.test(ch) ? 'mark' : 'other';

/**
 * Words a model may have written: short, no code, markup, links or symbols, and no number at all (the
 * number guard). The guards read the NFKC form, so full-width and other compatibility forms of digits
 * and letters are caught; every Unicode digit (Devanagari, Arabic-Indic, full-width, superscript,
 * circled, Roman numeral characters) is a number. Values a person types into an action are data and
 * do not pass through here.
 */
export function words(value: unknown, max = 80): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}]/u.test(value),
    'SMALLAPP_INVALID', 'Titles and labels are short plain words.');
  const nfkc = value.normalize('NFKC'), folded = nfkc.toLowerCase();
  check(!CODE_LIKE.test(nfkc), 'SMALLAPP_CODE_REFUSED', 'Small apps hold words and published references only; code, markup, links and scripts are refused.');
  const tokens = nfkc.split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  const foldedTokens = tokens.map(fold), phrase = ` ${foldedTokens.join(' ')} `;
  const numberWord = foldedTokens.some(t => CARDINALS.has(t) || QUANTITY_WORDS.has(t)) || tokens.some(t => ROMAN.test(t))
    || ZERO_PHRASES.some(p => phrase.includes(` ${p} `)) || JOINED.some(w => folded.replace(/[^a-z]+/g, '').includes(w));
  check(!/\p{N}/u.test(nfkc) && !numberWord, 'UNGROUNDED_NUMBER', 'Numbers in a small app come only from calculation receipts.');
  check(!/\p{S}/u.test(nfkc), 'SMALLAPP_CODE_REFUSED', 'Titles and labels are words only; symbols are refused.');
  check(tokens.every(t => { const scripts = new Set([...t].map(scriptOf).filter(s => s !== 'mark')); return scripts.size === 1 && !scripts.has('other'); }),
    'SMALLAPP_INVALID', 'Write titles and labels in English or Hindi letters, one script per word.');
  check(!tokens.some(t => INSTRUCTION_WORDS.has(t.toLowerCase())), 'SMALLAPP_INSTRUCTION_REFUSED', 'Titles and labels describe; they cannot carry instructions or claim an approval.');
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
  const id = (input: Record<string, any>) => ident(input.id, /^[a-z][a-z-]{0,31}$/);
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
  for (const ref of descriptor.uses.actions) if (!actionRow(menu, ref)) reasons.push('An action this app uses is no longer in the approved catalogue.');
  return [...new Set(reasons)];
}
export function usableOperation(dictionary: Dictionary, id: string): Operation | undefined {
  const operation = dictionary.operations.find(o => o.id === id);
  return operation && CALC_TYPES.has(operation.type) && operation.parameters.includes('period') ? operation : undefined;
}
export const actionRow = (menu: Menu, ref: string): ActionRow | undefined => menu.actions.find(r => r.key === ref);

const spaced = (text: string) => ` ${fold(text).replace(/[^\p{L}\p{M}]+/gu, ' ').trim()} `;
export type Vocabulary = { words: Set<string>; phrases: string[] };
/**
 * The allowlist for model-written words (the number guard's second half). A title or label may use
 * only: words of the published menu (operation and definition labels and ids), the catalogue's action
 * labels and ids, branch names, the planner's own figure and action words, the period names (read
 * only as whole phrases, so "quarter" never stands alone) and a few joining words. Anything else,
 * including every way of stating a quantity the number lexicon may have missed, is refused.
 */
export function menuVocabulary(menu: Menu): Vocabulary {
  const words = new Set(CONNECTIVES.map(fold)), phrases = new Set<string>();
  for (const piece of [...[...OPERATIONS, ...CONCEPTS].flatMap(([, list]) => list), ...FOLLOW_UP, ...PERIODS.flatMap(([, list]) => list), ...Object.values(PRESET_WORDS)]) {
    const text = spaced(piece).trim(); if (text.includes(' ')) phrases.add(text); else if (text) words.add(text);
  }
  const menuText = [...(menu.dictionary?.operations ?? []).flatMap(o => [o.label, o.id]), ...(menu.dictionary?.definitions ?? []).flatMap(d => [d.label, d.name]),
    ...menu.actions.flatMap(r => [r.label, r.operation, r.connector]), ...menu.branches];
  for (const text of menuText) for (const word of spaced(text).trim().split(' ')) if (word) words.add(word);
  return { words, phrases: [...phrases].sort((a, b) => b.length - a.length) };
}
export function onMenu(text: string, vocabulary: Vocabulary): boolean {
  let rest = spaced(text);
  for (const phrase of vocabulary.phrases) while (rest.includes(` ${phrase} `)) rest = rest.replace(` ${phrase} `, ' ');
  return rest.trim().split(' ').filter(Boolean).every(word => vocabulary.words.has(word));
}

/** The one checker for planner output and externally proposed descriptors. */
export function checkAgainstMenu(descriptor: Descriptor, menu: Menu, branches: readonly string[]): Descriptor {
  check(menu.dictionary, 'DICTIONARY_REQUIRED', 'Publish business definitions before building a small app.');
  for (const id of descriptor.uses.calculations) {
    check(menu.dictionary.operations.some(o => o.id === id), 'SMALLAPP_UNKNOWN_OPERATION', 'A small app can use only calculations from the published menu.');
    check(usableOperation(menu.dictionary, id), 'SMALLAPP_OPERATION_UNSUPPORTED', 'Comparisons over assumptions and what-ifs are not small app calculations.');
  }
  for (const ref of descriptor.uses.actions) {
    const row = actionRow(menu, ref);
    check(row, 'SMALLAPP_UNKNOWN_ACTION', 'A small app can prepare only actions from the approved catalogue.');
    check(row.available, 'SMALLAPP_ACTION_UNAVAILABLE', 'This action is in the catalogue but not available now, so it cannot go on a card.');
  }
  for (const c of descriptor.cards) if ('branch' in c && c.branch !== undefined) {
    check(branches.includes('*') || branches.includes(c.branch), 'FORBIDDEN_BRANCH', 'This branch is outside your current access.');
    check(menu.branches.includes(c.branch), 'SMALLAPP_UNKNOWN_BRANCH', 'Use a branch that exists in your records.');
  }
  const vocabulary = menuVocabulary(menu);
  for (const text of [descriptor.title, ...descriptor.cards.flatMap(c => [c.label, ...(c.kind === 'table' ? c.rows.map(r => r.label) : [])])])
    check(onMenu(text, vocabulary), 'SMALLAPP_WORDS_OFF_MENU', 'Titles and labels use only words from your published menu, your action catalogue, period names and branch names.');
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
