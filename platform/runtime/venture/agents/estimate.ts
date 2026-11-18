// Chausar venture launcher, agents: when a chat paragraph is a model estimate. Code labels the AI's words before they
// are stored (agents/answer.ts checkedParts, chief/answer.ts checkParts, chief/review.ts), and cuts none of them. A
// paragraph carries the "model estimate" mark only when it holds a number or an amount of the AI's own: one that is
// neither in what the AI was given (the owner's messages, the business's own words, the plan, the chat's history, the
// facts and tool results) nor a receipted figure it was handed. A date, a list position and an ordinal are not
// estimates; a name with a digit in it (B2B, Web3) is a name.
//
// A number counts as given only when it is given about the same thing: "200 pieces" after the owner's "about 200
// pieces a month", never "three cafes" because the plan says "three sample sets". A figure given on its own (a
// receipt's display, a count in a tool's result) is given whatever the AI says beside it. So a coincidence does not
// let an invented figure pass as fact; when unsure, the paragraph keeps the mark.
//
// Found live on Windows, 15 Nov 2026: an agent's reply that only repeated the owner's own "200 pieces a month" was
// marked a model estimate, and a chief answer that cited the owner's own set prices with their calculator receipts
// carried the estimate mark beside "Worked by the calculator". The earlier rule marked every number the owner's last
// message did not hold. Pure: no store and no network.
import { digitCopy } from '../core/secrets.ts';
import { hindiNumberWords } from '../delivery/harness/patches.ts';

/** Fields that hold Chausar's own ids, digests and instants: never words the AI could repeat as a figure. */
const ID_FIELD = /^(?:id|key|digest|at|link|rowId|runId|turn)$|(?:Id|Ids|At|Digest)$/;
/** A date or an instant as the engine writes it. Only its year is a number the AI was given. */
const ISO = /^\d{4}-\d{2}(?:-\d{2}(?:T[\d:.]+Z?)?)?$/;

/**
 * The words an AI call was given, from its input: every string and number in it, except Chausar's own ids, digests and
 * instants. A date keeps only its year. A list also gives how many it holds, about the thing it is named for ("3
 * offers"), so "your three offers" is a count the engine supplied. The caller chooses which parts of the input to
 * pass (the question, the history, the business, the plan, the facts, the tool results): never a count of the call's
 * own parts, such as its turn.
 */
export function givenWords(value: unknown, field: string | null = null, out: string[] = []): string[] {
  if (field !== null && ID_FIELD.test(field)) return out;
  if (typeof value === 'string') out.push(ISO.test(value) ? value.slice(0, 4) : value);
  else if (typeof value === 'number' && Number.isFinite(value)) out.push(String(value));
  else if (Array.isArray(value)) {
    if (field !== null && value.length >= 2) out.push(`${value.length} ${field}`);
    for (const item of value) givenWords(item, null, out);
  }
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) givenWords(item, key, out);
  return out;
}

/** Month names as a date writes them, with their capital: "about 20 may reply" names no month. */
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
/** Dates as people write them: 2026-11-15, 15 November, 15th Nov 2026, November 15, November 2026. */
const DATES: readonly RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b\\.?(?:,?\\s+\\d{4}\\b)?`, 'g'),
  new RegExp(`\\b${MONTH}\\b\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?!\\s*%)(?:,?\\s+\\d{4}\\b)?`, 'g'),
  new RegExp(`\\b${MONTH}\\b\\.?,?\\s+\\d{4}\\b`, 'g'),
];
/** List positions: "1." or "2)" at the start of a paragraph, "(3)" or "2)" inside one, "step 2", and 1st, 2nd, 3rd. */
const POSITIONS: readonly RegExp[] = [/^\s*\(?\d{1,2}[.)](?=\s)/g, /(?<=^|[\s(])\d{1,2}\)(?=\s|$)/g, /\(\d{1,2}\)/g, /\bstep\s+\d{1,2}\b/gi, /\b\d+(?:st|nd|rd|th)\b/gi];

/** Number words and what each counts. Ordinals (first, second, third) are list positions, never estimates. */
const WORD_VALUE: Readonly<Record<string, string>> = Object.freeze({
  zero: '0', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50',
  sixty: '60', seventy: '70', eighty: '80', ninety: '90', hundred: '100', thousand: '1000', dozen: '12',
});
/** Words that scale or share out an amount, and slang amounts: numbers with no single value, compared as the word. */
const OTHER_WORDS: ReadonlySet<string> = new Set([
  'hundreds', 'thousands', 'lakh', 'lakhs', 'crore', 'crores', 'million', 'millions', 'billion', 'billions', 'dozens', 'half', 'halves', 'quarter',
  'double', 'twice', 'triple', 'quadruple', 'percent', 'tenner', 'tenners', 'fiver', 'fivers',
]);
/** Letters joined to digits that scale the number (20k, 2L, 1.5cr): part of the figure, so "2 lakh" is not "2". */
const SCALES: ReadonlySet<string> = new Set(['k', 'm', 'mn', 'bn', 'l', 'cr', 'lakh', 'lakhs', 'crore', 'crores']);
/** Currency letters joined to digits or written beside them: the number is money. */
const CURRENCIES: ReadonlySet<string> = new Set(['rs', 'inr', 'usd', 'gbp', 'eur', 'aud', 'cad', 'sgd', 'aed', 'nzd', 'jpy', 'rupee', 'rupees', 'dollar', 'dollars', 'pound', 'pounds', 'euro', 'euros', 'paise']);
/** Other letters joined to digits that leave it a plain number: a unit, a clock. */
const UNITS: ReadonlySet<string> = new Set(['x', 'am', 'pm', 'min', 'mins', 'hr', 'hrs', 'h', 's', 'km', 'kg', 'g', 'gb', 'mb']);
/** Words that say nothing about what a number counts. */
const FILLER: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'to', 'or', 'and', 'per', 'in', 'on', 'for', 'more', 'about', 'is', 'are', 'was', 'were', 'be', 'that', 'this', 'these', 'those', 'your',
  'you', 'i', 'it', 'as', 'at', 'with', 'so', 'can', 'will', 'would', 'could', 'should', 'each', 'every', 'up', 'than', 'over', 'under', 'around', 'roughly',
  'only', 'just', 'first', 'new', 'by', 'from', 'my', 'our', 'have', 'has', 'do', 'does', 'if', 'then', 'which', 'what', 'who',
]);
const OTHER_NUMBER = /[\p{No}\p{Nl}]/gu;
/** One token: a currency sign, a percent sign, a digit run with the letters joined to it (a hyphenated name before it included: GPT-6), or a word. */
const TOKEN = /\p{Sc}|%|(?:\p{L}+-)?\p{L}*\d+(?:[,.]\d+)*\p{L}*|[\p{L}\p{M}]+(?:'[\p{L}]+)?/gu;
/** "quarter" is a share only as "a quarter" or "quarter of"; "this quarter" is a season of the year. */
const QUARTER_SHARE = /\b(?:a|one|three|per)\s+quarters?\b|\bquarters?\s+of\b/i;
const MONEY = '$money';

/** A number as compared: grouping commas dropped, "900.00" read as "900", "08" as "8". */
function numberKey(digits: string): string {
  const plain = digits.replace(/,/g, '').replace(/^0+(?=\d)/, '');
  return plain.includes('.') ? plain.replace(/0+$/, '').replace(/\.$/, '') : plain;
}
/** A word as compared: lower case, without a plural's ending, so "ten minute" meets "ten minutes". */
const stem = (word: string): string => word.replace(/(?:'s|s)$/, '');

/** A figure in a text: what it is (a number as compared, or a number word), and the words that say what it counts. */
type Figure = { key: string; about: Set<string>; alone: boolean };
type Read = { figures: Figure[]; hindi: Set<string>; marks: Set<string> };

/**
 * The figures in one text. A digit joined to other letters is a name (B2B, Web3, 3D) and is no figure. about: the
 * word before it and the three after it that carry meaning, with a mark for money and for percent. alone: the text is
 * nothing but the figure (a receipt's display, a count). own: the AI's paragraph, whose dates and list positions are
 * taken out first.
 */
function read(text: string, own: boolean): Read {
  let rest = digitCopy(text).replace(/’/g, "'");
  if (own) for (const pattern of [...DATES, ...POSITIONS]) rest = rest.replace(pattern, ' ');
  const quarter = QUARTER_SHARE.test(rest);
  type Token = { text: string; figure: string | null; mark: string | null; word: string | null };
  const tokens: Token[] = [...rest.matchAll(TOKEN)].map(match => {
    const raw = match[0].toLowerCase();
    if (/^\p{Sc}$/u.test(raw)) return { text: raw, figure: null, mark: MONEY, word: null };
    if (raw === '%') return { text: raw, figure: null, mark: 'percent', word: null };
    const digits = /^((?:\p{L}+-)?\p{L}*)(\d+(?:[,.]\d+)*)(\p{L}*)$/u.exec(raw);
    if (digits) {
      const [, before = '', number = '', after = ''] = digits;
      const known = (letters: string) => letters === '' || CURRENCIES.has(letters) || UNITS.has(letters);
      // Letters that are neither a currency, a unit nor a scale make it a name: no figure, and no word either.
      if (!known(before) || !(known(after) || SCALES.has(after))) return { text: raw, figure: null, mark: null, word: null };
      return { text: raw, figure: `${numberKey(number)}${SCALES.has(after) ? after : ''}`, mark: CURRENCIES.has(before) || CURRENCIES.has(after) ? MONEY : null, word: null };
    }
    if (CURRENCIES.has(raw)) return { text: raw, figure: null, mark: MONEY, word: null };
    if (raw === 'quarter' ? quarter : Object.hasOwn(WORD_VALUE, raw) || OTHER_WORDS.has(raw)) return { text: raw, figure: raw, mark: raw === 'percent' ? 'percent' : null, word: null };
    return { text: raw, figure: null, mark: null, word: FILLER.has(raw) ? null : stem(raw) };
  });
  if (/\bper cent\b/i.test(rest)) tokens.push({ text: 'percent', figure: null, mark: 'percent', word: null });
  const alone = !tokens.some(token => token.word !== null);
  const figures: Figure[] = [];
  tokens.forEach((token, index) => {
    if (token.figure === null) return;
    const about = new Set<string>();
    if (token.mark) about.add(token.mark);
    // The sign or word right beside it: "₹900", "900 rupees", "20%".
    for (const near of [tokens[index - 1], tokens[index + 1]]) if (near?.mark) about.add(near.mark);
    for (let at = index - 1, taken = 0; at >= 0 && taken < 1; at -= 1) if (tokens[at]!.word) { about.add(tokens[at]!.word!); taken += 1; }
    for (let at = index + 1, taken = 0; at < tokens.length && taken < 3; at += 1) if (tokens[at]!.word) { about.add(tokens[at]!.word!); taken += 1; }
    figures.push({ key: token.figure, about, alone });
  });
  return { figures, hindi: new Set(hindiNumberWords(text)), marks: new Set(text.match(OTHER_NUMBER) ?? []) };
}

/**
 * How many receipted figures an answer cites, as words the AI was given: "two set prices" beside two cited prices is a
 * count of them, not an estimate. shown: the cited figures as they will show (their displays), counted once each.
 */
export function citedCounts(shown: readonly string[]): string[] {
  const count = new Set(shown).size;
  return count >= 2 ? ['prices', 'figures', 'amounts', 'totals', 'offers', 'receipts'].map(what => `${count} ${what}`) : [];
}

const VALUE_WORD: ReadonlyMap<string, string> = new Map(Object.entries(WORD_VALUE).filter(([word]) => word !== 'dozen').map(([word, value]) => [value, word]));
/** "ten" and "10" are one number. */
const sameNumber = (a: string, b: string): boolean => a === b || WORD_VALUE[a] === b || WORD_VALUE[b] === a || (VALUE_WORD.get(a) !== undefined && VALUE_WORD.get(a) === b);

/**
 * True when the words hold a figure of the AI's own: a number, an amount, a number word (Hindi too), a percent or a
 * scale that the AI was not given about the same thing. A date, a list position and an ordinal are no figure. given:
 * each string the AI was given, on its own (givenWords), so a receipt's display or a count stands alone.
 */
export function ownFigure(words: string, given: readonly string[]): boolean {
  const mine = read(words, true);
  if (!mine.figures.length && !mine.hindi.size && !mine.marks.size) return false;
  const theirs = given.map(text => read(text, false));
  const known = theirs.flatMap(item => item.figures);
  for (const figure of mine.figures) {
    // An amount of money is given only by an amount of money: a count the engine supplied never clears a price.
    const money = figure.about.has(MONEY);
    const met = known.some(other => sameNumber(figure.key, other.key) && (!money || other.about.has(MONEY))
      && (other.alone || [...figure.about].some(word => other.about.has(word))));
    if (!met) return true;
  }
  for (const word of mine.hindi) if (!theirs.some(item => item.hindi.has(word))) return true;
  for (const mark of mine.marks) if (!theirs.some(item => item.marks.has(mark))) return true;
  return false;
}
