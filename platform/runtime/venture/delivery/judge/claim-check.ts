// Chausar judge: claim checks with no model. Every specific claim in a draft (a figure, a date, a name, a
// certification) must be found in the run's sources: the client's message, the files the tools read, and the
// calculator's receipts. A claim the sources do not hold fails the draft. Matching is lexical and lenient on form
// (1,20,000 equals 1.2 lakh; 12 March 2026 equals 12/03/2026), strict on value. It misses a paraphrased false claim
// ("fully compliant"), which is what the yes/no judge is for.
//
// Idea taken, code written here: dboudreau00/Countersign (AGPL-3.0, so ideas only), whose groundedness scorer pulls
// every specific claim from a drafted answer and reports the ones its context does not hold.
import type { Deliverable, HarnessState } from '../../contracts.ts';
import { tablesOfFile, type FileLike } from '../harness/files.ts';
import { quote } from '../shared.ts';

export type ClaimKind = 'figure' | 'date' | 'name' | 'certification';
/** text: as the draft says it. key: the form compared with the sources. at: where it starts in the draft. */
export type DraftClaim = { kind: ClaimKind; text: string; key: string; at: number };
export type SourceText = { id: string; text: string };
export type ClaimMatch = DraftClaim & { matched: boolean; sourceId: string | null };
export type ClaimCheck = { passed: boolean; claims: ClaimMatch[]; unmatched: ClaimMatch[]; detail: string };
export type ClaimOptions = {
  /** Names that are never claims: the business's own name, the owner's, the offer's. */
  known?: readonly string[];
  /** How 05/09/2026 reads. India and most of the world write the day first. */
  dateOrder?: 'day-month-year' | 'month-day-year';
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const STANDARD = /\b(ISO(?:\/IEC)?[\s-]?\d{3,5}(?:[-:]\d{1,4})*|SOC[\s-]?[123](?:[\s-]Type[\s-]?(?:II|I|1|2)\b)?|PCI[\s-]?DSS|HIPAA|GDPR|CMMI(?:[\s-](?:Level|ML)[\s-]?\d)?|FSSAI|NABL)((?:[\s-](?:certified|certification|compliant|accredited|registered))?)\b/gu;
const CAPITALISED = "\\p{Lu}[\\p{L}&.'’-]*";
const CERT_WORDS = '[Cc]ertified|[Cc]ertifications?|[Aa]ccredited|[Aa]ccreditations?|[Ll]icen[cs]ed|[Aa]ward[\\s-][Ww]inning';
const CERT_PHRASE = new RegExp(`(?:${CAPITALISED}\\s){0,3}(?:${CERT_WORDS})\\b(?:\\s(?:(?:by|from|as|in)\\s)?${CAPITALISED}(?:\\s${CAPITALISED}){0,2})?`, 'gu');

const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';

const FIGURE_BODY = '((?:\\u20B9|Rs\\.?|INR|US\\$|USD|\\$|\\u20AC|EUR|\\u00A3|GBP)\\s?)?(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)(\\s?(?:lakhs?|crores?|cr|thousand|millions?|billions?|bn|mn)\\b|[kK]\\b)?(\\s?(?:%|percent\\b|per cent\\b))?(?![\\p{L}\\p{N}])';
/** In a draft a number never starts after a letter, a digit, a point or a digit and comma (the 000 of 1,000). */
const FIGURE = new RegExp(`(?<![\\p{L}\\p{N}.]|\\d,)${FIGURE_BODY}`, 'gu');
/** In a source a number may follow a comma: a CSV row is "Printing,2400.00,18". */
const SOURCE_FIGURE = new RegExp(`(?<![\\p{L}\\p{N}.])${FIGURE_BODY}`, 'gu');
const SCALES: Readonly<Record<string, number>> = { lakh: 5, lakhs: 5, crore: 7, crores: 7, cr: 7, thousand: 3, k: 3, million: 6, millions: 6, mn: 6, billion: 9, billions: 9, bn: 9 };

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu;
/** Capitalised words that are not names: openers, greetings, titles, pronouns, days and months, reply headings. */
const COMMON = new Set([
  'i', 'we', 'you', 'your', 'yours', 'our', 'ours', 'my', 'me', 'us', 'they', 'their', 'them', 'he', 'she', 'his', 'her', 'it', 'its',
  'this', 'that', 'these', 'those', 'the', 'a', 'an', 'and', 'or', 'but', 'if', 'so', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'on', 'of', 'to',
  'with', 'without', 'within', 'after', 'before', 'here', 'there', 'when', 'where', 'what', 'which', 'who', 'why', 'how', 'is', 'are', 'was', 'were',
  'please', 'thanks', 'thank', 'hi', 'hello', 'hey', 'dear', 'regards', 'best', 'kind', 'warm', 'cheers', 'yes', 'no', 'not', 'all', 'each', 'every',
  'some', 'any', 'next', 'last', 'first', 'then', 'also', 'once', 'today', 'tomorrow', 'yesterday', 'summary', 'steps', 'step', 'note', 'notes',
  'total', 'totals', 'ok', 'okay', 'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'madam', 'shri', 'smt',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, '0');
const monthOf = (word: string): number | null => { const index = MONTHS.indexOf(word.slice(0, 3).toLowerCase()); return index < 0 ? null : index + 1; };
const year4 = (year: string) => (year.length === 2 ? `20${year}` : year);
const fullDate = (year: string, month: number | null, day: number) => (month && month <= 12 && day >= 1 && day <= 31 && /^\d{4}$/.test(year) ? `${year}-${pad(month)}-${pad(day)}` : null);
const monthDay = (month: number | null, day: number) => (month && day >= 1 && day <= 31 ? `--${pad(month)}-${pad(day)}` : null);

type DatePattern = { re: RegExp; key: (m: RegExpMatchArray, order: 'day-month-year' | 'month-day-year') => string | null };
/** Most specific first, so 12 March 2026 is one date, not a month-day and a year. */
const DATES: readonly DatePattern[] = [
  { re: /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g, key: m => fullDate(m[1], parseInt(m[2], 10), parseInt(m[3], 10)) },
  { re: new RegExp(`\\b${DAY}\\s+(?:of\\s+)?(${MONTH})\\.?,?\\s+(\\d{4})\\b`, 'gi'), key: m => fullDate(m[3], monthOf(m[2]), parseInt(m[1], 10)) },
  { re: new RegExp(`\\b(${MONTH})\\.?\\s+${DAY},?\\s+(\\d{4})\\b`, 'gi'), key: m => fullDate(m[3], monthOf(m[1]), parseInt(m[2], 10)) },
  {
    re: /(?<![\d/-]|\d\.)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/-]|\.\d)/g,
    key: (m, order) => order === 'day-month-year' ? fullDate(year4(m[3]), parseInt(m[2], 10), parseInt(m[1], 10)) : fullDate(year4(m[3]), parseInt(m[1], 10), parseInt(m[2], 10)),
  },
  { re: new RegExp(`\\b(${MONTH})\\.?,?\\s+(\\d{4})\\b`, 'gi'), key: m => { const month = monthOf(m[1]); return month ? `${m[2]}-${pad(month)}` : null; } },
  { re: new RegExp(`\\b${DAY}\\s+(?:of\\s+)?(${MONTH})\\b`, 'gi'), key: m => monthDay(monthOf(m[2]), parseInt(m[1], 10)) },
  { re: new RegExp(`\\b(${MONTH})\\.?\\s+${DAY}\\b`, 'gi'), key: m => monthDay(monthOf(m[1]), parseInt(m[2], 10)) },
];

/** 1,20,000.00 gives 120000; 1.2 lakh gives 120000; 18% gives 18%. The decimal point moves; nothing is rounded. */
function figureKey(number: string, scale: string | undefined, percent: boolean): string {
  const [whole, fraction = ''] = number.replace(/,/g, '').split('.');
  const shift = scale ? SCALES[scale.trim().toLowerCase()] ?? 0 : 0;
  let digits = whole + fraction;
  const point = whole.length + shift;
  if (digits.length < point) digits = digits.padEnd(point, '0');
  const int = digits.slice(0, point).replace(/^0+(?=\d)/, '');
  const frac = digits.slice(point).replace(/0+$/, '');
  return `${frac ? `${int}.${frac}` : int}${percent ? '%' : ''}`;
}

function standardKey(text: string): string {
  return text.toLowerCase().replace(/\/iec/g, '').replace(/[\s-]+/g, ' ').trim();
}

const certStem = (word: string) => /^certif/i.test(word) ? 'certif' : /^accredit/i.test(word) ? 'accredit' : /^licen/i.test(word) ? 'licen' : 'award';

function tokensOf(text: string): { token: string; start: number; end: number }[] {
  return [...text.matchAll(TOKEN)].map(match => {
    const token = match[0].replace(/['’]s?$/, '');
    return { token, start: match.index!, end: match.index! + token.length };
  }).filter(item => item.token.length > 0);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Spans already claimed are blanked so a later pass does not see them again (ISO 27001 is not also a figure). */
class Scan {
  work: string;
  readonly original: string;
  readonly found: DraftClaim[] = [];
  constructor(text: string) { this.original = text; this.work = text; }
  blank(start: number, end: number) { this.work = this.work.slice(0, start) + ' '.repeat(end - start) + this.work.slice(end); }
  claim(kind: ClaimKind, start: number, end: number, key: string) {
    this.found.push({ kind, text: this.original.slice(start, end), key, at: start });
    this.blank(start, end);
  }
}

function sentenceStart(text: string, at: number): boolean {
  const before = text.slice(0, at).replace(/[ \t"'“‘(]+$/, '');
  return before === '' || /[.!?:\n]$/.test(before) || /(?:^|\n)\s*(?:[-*•]|\d+[.)])$/.test(before);
}

function listMarker(text: string, start: number, end: number): boolean {
  return /(?:^|\n)[ \t]*$/.test(text.slice(0, start)) && /^[.)](?:\s|$)/.test(text.slice(end));
}

function maskKnown(scan: Scan, known: readonly string[]) {
  for (const name of known) {
    const needle = name.trim().toLowerCase();
    if (!needle) continue;
    let from = 0;
    for (let index = scan.work.toLowerCase().indexOf(needle, from); index >= 0; index = scan.work.toLowerCase().indexOf(needle, from)) {
      scan.blank(index, index + needle.length);
      from = index + needle.length;
    }
  }
}

function takeCertifications(scan: Scan) {
  for (const match of [...scan.work.matchAll(STANDARD)]) scan.claim('certification', match.index!, match.index! + match[0].length, standardKey(match[1]));
  for (const match of [...scan.work.matchAll(CERT_PHRASE)]) {
    const tokens = tokensOf(match[0]);
    let first = 0;
    while (first < tokens.length - 1 && COMMON.has(tokens[first].token.toLowerCase())) first += 1;
    const start = match.index! + tokens[first].start;
    const end = match.index! + match[0].trimEnd().length;
    const word = tokens.find(item => new RegExp(`^(?:${CERT_WORDS})$`, 'u').test(item.token))?.token ?? match[0];
    const nouns = tokens.slice(first).filter(item => /^\p{Lu}/u.test(item.token) && item.token !== word && !COMMON.has(item.token.toLowerCase())
      && !new RegExp(`^(?:${CERT_WORDS})$`, 'u').test(item.token)).map(item => item.token.toLowerCase());
    scan.claim('certification', start, end, `${certStem(word)}|${nouns.join(' ')}`);
  }
}

function takeDates(scan: Scan, order: 'day-month-year' | 'month-day-year') {
  for (const pattern of DATES) {
    for (const match of [...scan.work.matchAll(pattern.re)]) {
      const key = pattern.key(match, order);
      if (key) scan.claim('date', match.index!, match.index! + match[0].length, key);
    }
  }
}

function takeFigures(scan: Scan) {
  for (const match of [...scan.work.matchAll(FIGURE)]) {
    const start = match.index!;
    const end = start + match[0].length;
    if (!match[1] && !match[3] && !match[4] && listMarker(scan.original, start, end)) continue;
    scan.claim('figure', start, end, figureKey(match[2], match[3], !!match[4]));
  }
}

function takeNames(scan: Scan) {
  const tokens = tokensOf(scan.work);
  const sequences: { token: string; start: number; end: number }[][] = [];
  let current: typeof tokens = [];
  for (const item of tokens) {
    const nameLike = /^\p{Lu}/u.test(item.token) && !/\p{N}/u.test(item.token);
    const joined = current.length > 0 && /^[ \t]+$/.test(scan.work.slice(current.at(-1)!.end, item.start));
    if (nameLike && (joined || current.length === 0)) { current.push(item); continue; }
    if (current.length) sequences.push(current);
    current = nameLike ? [item] : [];
  }
  if (current.length) sequences.push(current);
  for (const sequence of sequences) {
    const opensSentence = sentenceStart(scan.original, sequence[0].start);
    let run: typeof tokens = [];
    const flush = () => {
      if (!run.length) return;
      const firstOfSentence = opensSentence && run[0] === sequence[0];
      const allCaps = run.length === 1 && run[0].token.length >= 2 && run[0].token === run[0].token.toUpperCase();
      if (run.length >= 2 || (!firstOfSentence && !allCaps)) {
        scan.claim('name', run[0].start, run.at(-1)!.end, run.map(item => item.token.toLowerCase()).join(' '));
      }
      run = [];
    };
    for (const item of sequence) {
      if (COMMON.has(item.token.toLowerCase())) flush();
      else run.push(item);
    }
    flush();
  }
}

/** The specific claims in a piece of text, in the order it says them. */
export function extractClaims(text: string, options: ClaimOptions = {}): DraftClaim[] {
  const scan = new Scan(text);
  maskKnown(scan, options.known ?? []);
  takeCertifications(scan);
  takeDates(scan, options.dateOrder ?? 'day-month-year');
  takeFigures(scan);
  takeNames(scan);
  return [...scan.found].sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

type SourceIndex = { id: string; lower: string; words: Set<string>; figures: Set<string>; dates: string[] };

function indexSource(source: SourceText, order: 'day-month-year' | 'month-day-year'): SourceIndex {
  const dates: string[] = [];
  for (const pattern of DATES) for (const match of source.text.matchAll(pattern.re)) { const key = pattern.key(match, order); if (key) dates.push(key); }
  const figures = new Set<string>();
  for (const match of source.text.matchAll(SOURCE_FIGURE)) {
    const value = figureKey(match[2], match[3], false);
    figures.add(value);
    if (match[4]) figures.add(`${value}%`);
    // "120,18" in a CSV may be one number or two fields; a source holds both readings.
    if (match[2].includes(',')) for (const piece of match[2].split(',')) figures.add(figureKey(piece, undefined, false));
  }
  return {
    id: source.id, lower: standardKey(source.text), words: new Set(tokensOf(source.text).map(item => item.token.toLowerCase())), figures, dates,
  };
}

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function dateMatches(claim: string, source: string): boolean {
  if (claim === source) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(claim)) return source.startsWith('--') && claim.endsWith(source.slice(1));
  if (/^\d{4}-\d{2}$/.test(claim)) return source.startsWith(`${claim}-`);
  if (claim.startsWith('--')) return source.endsWith(claim.slice(1));
  return false;
}

function matches(claim: DraftClaim, source: SourceIndex): boolean {
  if (claim.kind === 'figure') return source.figures.has(claim.key) || (claim.key.endsWith('%') && source.figures.has(claim.key.slice(0, -1)));
  if (claim.kind === 'date') return source.dates.some(date => dateMatches(claim.key, date));
  if (claim.kind === 'name') return claim.key.split(' ').every(word => source.words.has(word));
  if (claim.key.includes('|')) {
    const [stem, nouns] = claim.key.split('|');
    return source.lower.includes(stem) && nouns.split(' ').filter(Boolean).every(word => source.words.has(word));
  }
  return new RegExp(`(?:^|[^a-z0-9])${escapeRe(claim.key)}(?![0-9])`).test(source.lower);
}

/**
 * Each specific claim in the draft against every source. The draft passes only when every claim is found; a draft
 * with no specific claim passes and says so.
 */
export function checkClaims(draft: string, sources: readonly SourceText[], options: ClaimOptions = {}): ClaimCheck {
  const order = options.dateOrder ?? 'day-month-year';
  const indexed = sources.map(source => indexSource(source, order));
  const claims: ClaimMatch[] = extractClaims(draft, options).map(claim => {
    const source = indexed.find(item => matches(claim, item));
    return { ...claim, matched: !!source, sourceId: source?.id ?? null };
  });
  const unmatched = claims.filter(claim => !claim.matched);
  const detail = !claims.length ? 'The draft makes no specific claim to check.'
    : !unmatched.length ? "Every figure, date, name and certification in the draft matches the client's files or the run's evidence."
      : `${unmatched.length === 1 ? 'This claim is' : 'These claims are'} not in the client's files or the run's evidence: ${unmatched.map(claim => `"${quote(claim.text, 60)}"`).join(', ')}.`;
  return { passed: unmatched.length === 0, claims, unmatched, detail };
}

/** The model's words in a draft reply: the title, each text part and each question. Figures code renders from receipts are left out. */
export function deliverableWords(deliverable: Deliverable): string {
  const pieces = [deliverable.title];
  for (const section of deliverable.sections) for (const part of section.parts) if (part.kind === 'text') pieces.push(part.text);
  return [...pieces, ...deliverable.questionsForClient].join('\n');
}

/**
 * The client's spreadsheet files as sources, whole, one row per line. A PDF is left out here: its text reaches the
 * sources through the files.read results the agent asked for (see sourcesFromRun).
 */
export function sourcesFromFiles(files: readonly FileLike[]): SourceText[] {
  const sources: SourceText[] = [];
  for (const file of files) {
    if (file.format === 'pdf') continue;
    let tables: ReturnType<typeof tablesOfFile>;
    try { tables = tablesOfFile(file); } catch { continue; }
    for (const table of tables) {
      sources.push({ id: table.id, text: [table.name, table.columns.join(','), ...table.rows.map(row => table.columns.map(column => row.cells[column] ?? '').join(','))].join('\n') });
    }
  }
  return sources;
}

/** A run's sources: the client's message, every successful tool result, the calculator's receipts and any extra files. */
export function sourcesFromRun(input: {
  clientRequest?: string;
  harness?: HarnessState | null;
  receipts?: readonly { id: string; explanation?: string; figures?: readonly { label: string; display: string }[] }[];
  extra?: readonly SourceText[];
}): SourceText[] {
  const sources: SourceText[] = [];
  if (input.clientRequest) sources.push({ id: 'client-message', text: input.clientRequest });
  for (const call of input.harness?.toolCalls ?? []) if (call.envelope.ok) sources.push({ id: call.id, text: JSON.stringify(call.envelope.result) ?? '' });
  for (const receipt of input.receipts ?? []) {
    sources.push({ id: receipt.id, text: [receipt.explanation ?? '', ...(receipt.figures ?? []).map(figure => `${figure.label}: ${figure.display}`)].join('\n') });
  }
  return [...sources, ...(input.extra ?? [])];
}
