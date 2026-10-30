// Chausar judge: claim checks with no model. Every specific claim in a draft (a figure, a date, a name, a
// certification) must be found in the run's sources: the client's message, the files the tools read, and the
// calculator's receipts. A claim the sources do not hold fails the draft. Matching is lexical and lenient on form
// (1,20,000 equals 1.2 lakh; 12 March 2026 equals 12/03/2026), strict on value. It misses a paraphrased false claim
// ("fully compliant"), which is what the yes/no judge is for.
//
// Idea taken, code written here: dboudreau00/Countersign (AGPL-3.0, so ideas only), whose groundedness scorer pulls
// every specific claim from a drafted answer and reports the ones its context does not hold.
//
// The receipts check (checkReceipts) reads the same words for every number, file and link. A number on a receipt, in
// a tool result or in the client's own words has a receipt; any other number is labelled "model estimate" (or fails,
// where a playbook allows no estimates); a number the calculator's figure refutes is replaced by that figure; a file
// or link must be in the run's evidence, with a matching digest when the words state one. Idea taken, code written
// here: jevgrep's screenshot-critique receipts script (MIT), and opentax-engine's check --expect (ideas only).
import { quote } from '../quote.ts';

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
  { re: /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g, key: m => fullDate(m[1]!, parseInt(m[2]!, 10), parseInt(m[3]!, 10)) },
  { re: new RegExp(`\\b${DAY}\\s+(?:of\\s+)?(${MONTH})\\.?,?\\s+(\\d{4})\\b`, 'gi'), key: m => fullDate(m[3]!, monthOf(m[2]!), parseInt(m[1]!, 10)) },
  { re: new RegExp(`\\b(${MONTH})\\.?\\s+${DAY},?\\s+(\\d{4})\\b`, 'gi'), key: m => fullDate(m[3]!, monthOf(m[1]!), parseInt(m[2]!, 10)) },
  {
    re: /(?<![\d/-]|\d\.)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/-]|\.\d)/g,
    key: (m, order) => order === 'day-month-year' ? fullDate(year4(m[3]!), parseInt(m[2]!, 10), parseInt(m[1]!, 10)) : fullDate(year4(m[3]!), parseInt(m[1]!, 10), parseInt(m[2]!, 10)),
  },
  { re: new RegExp(`\\b(${MONTH})\\.?,?\\s+(\\d{4})\\b`, 'gi'), key: m => { const month = monthOf(m[1]!); return month ? `${m[2]!}-${pad(month)}` : null; } },
  { re: new RegExp(`\\b${DAY}\\s+(?:of\\s+)?(${MONTH})\\b`, 'gi'), key: m => monthDay(monthOf(m[2]!), parseInt(m[1]!, 10)) },
  { re: new RegExp(`\\b(${MONTH})\\.?\\s+${DAY}\\b`, 'gi'), key: m => monthDay(monthOf(m[1]!), parseInt(m[2]!, 10)) },
];

/** 1,20,000.00 gives 120000; 1.2 lakh gives 120000; 18% gives 18%. The decimal point moves; nothing is rounded. */
function figureKey(number: string, scale: string | undefined, percent: boolean): string {
  const [whole, fraction = ''] = number.replace(/,/g, '').split('.');
  const shift = scale ? SCALES[scale.trim().toLowerCase()] ?? 0 : 0;
  let digits = whole + fraction;
  const point = whole!.length + shift;
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
  for (const match of [...scan.work.matchAll(STANDARD)]) scan.claim('certification', match.index!, match.index! + match[0].length, standardKey(match[1]!));
  for (const match of [...scan.work.matchAll(CERT_PHRASE)]) {
    const tokens = tokensOf(match[0]);
    let first = 0;
    while (first < tokens.length - 1 && COMMON.has(tokens[first]!.token.toLowerCase())) first += 1;
    const start = match.index! + tokens[first]!.start;
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
    if (!match[1]! && !match[3] && !match[4] && listMarker(scan.original, start, end)) continue;
    scan.claim('figure', start, end, figureKey(match[2]!, match[3], !!match[4]));
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
    const opensSentence = sentenceStart(scan.original, sequence[0]!.start);
    let run: typeof tokens = [];
    const flush = () => {
      if (!run.length) return;
      const firstOfSentence = opensSentence && run[0] === sequence[0];
      const allCaps = run.length === 1 && run[0]!.token.length >= 2 && run[0]!.token === run[0]!.token.toUpperCase();
      if (run.length >= 2 || (!firstOfSentence && !allCaps)) {
        scan.claim('name', run[0]!.start, run.at(-1)!.end, run.map(item => item.token.toLowerCase()).join(' '));
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

export type SourceIndex = { id: string; lower: string; words: Set<string>; figures: Set<string>; dates: string[] };

function indexSource(source: SourceText, order: 'day-month-year' | 'month-day-year'): SourceIndex {
  const dates: string[] = [];
  for (const pattern of DATES) for (const match of source.text.matchAll(pattern.re)) { const key = pattern.key(match, order); if (key) dates.push(key); }
  const figures = new Set<string>();
  for (const match of source.text.matchAll(SOURCE_FIGURE)) {
    const value = figureKey(match[2]!, match[3], false);
    figures.add(value);
    if (match[4]) figures.add(`${value}%`);
    // "120,18" in a CSV may be one number or two fields; a source holds both readings.
    if (match[2]!.includes(',')) for (const piece of match[2]!.split(',')) figures.add(figureKey(piece, undefined, false));
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
    return source.lower.includes(stem!) && nouns!.split(' ').filter(Boolean).every(word => source.words.has(word));
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

// ---------------------------------------------------------------------------
// Receipts: every number, file and link in model words, against what the run holds
// ---------------------------------------------------------------------------

/**
 * receipted: on a calculator receipt, in a tool result, or in the client's own words (the message, the answers, the
 * files). estimate: none of those, so it shows as a model estimate. refuted: the calculator's figure says otherwise.
 */
export type NumberStatus = 'receipted' | 'estimate' | 'refuted';
/**
 * One figure on a calculator receipt: what a number in model words is compared with. kind 'price': a price receipt,
 * which speaks only to words that name the fee, price, quote or order; 'work': a work receipt of the run.
 */
export type CalculatorFigure = { receiptId: string; figureKey: string; label: string; display: string; unit: 'money' | 'count'; kind: 'price' | 'work' };
/** The calculator's figure in place of a refuted number. said: the number as the words had it; at: where it started. */
export type ReceiptCorrection = { said: string; at: number; receiptId: string; figureKey: string; label: string; display: string; note: string };
/**
 * key: the compared form (1,20,000 gives 120000); null for a number word with no single value (twice, half, dozens).
 * amount: money, a rate or a tax figure (a percentage, a currency, or no counted thing after it in a clause about money
 * or tax), as opposed to a count of things ("two invoices") or a span of time ("three weeks").
 */
export type DraftNumber = { text: string; at: number; key: string | null; amount: boolean; status: NumberStatus; sourceId: string | null; correction: ReceiptCorrection | null };
/** A file or link the words name. digestMatches is null when the words state no digest. */
export type DraftReference = { kind: 'file' | 'link'; text: string; at: number; statedDigest: string | null; found: boolean; digestMatches: boolean | null; sourceId: string | null };
export type EvidenceFile = { id: string; name: string; digest: string };
export type EvidenceLink = { url: string; digest: string | null; sourceId: string };
/**
 * What the run holds. sources: the client's words, tool results and receipts as text (sourcesFromRun); clientIds: the
 * sources that are the client's own words (the message, the answers, the files), whose figures are never refuted;
 * figures: the calculator's figures that may refute a number; files: the files and tables of the run; links: pages
 * with a digest, and the owner's own links. A link written in any source counts as held, with no digest.
 */
export type ReceiptEvidence = {
  sources: readonly SourceText[]; clientIds?: readonly string[]; figures?: readonly CalculatorFigure[]; files?: readonly EvidenceFile[]; links?: readonly EvidenceLink[];
};
/** Evidence read and indexed once (prepareEvidence), to check many pieces of words against the same run. */
export type PreparedEvidence = {
  readonly prepared: true; dateOrder: 'day-month-year' | 'month-day-year'; indexed: SourceIndex[]; client: SourceIndex[]; figures: PreparedFigure[];
  links: Map<string, EvidenceLink>; files: readonly EvidenceFile[];
};
export type EstimateMode = 'label' | 'forbid';
export type ReceiptOptions = ClaimOptions & {
  /**
   * 'forbid': the playbook allows no model estimate of money, a rate or tax, so such a figure with no receipt fails; a
   * count with no receipt is still only labelled. Default 'label': every number with no receipt is labelled.
   */
  estimates?: EstimateMode;
  /** Tokens with a letter and a digit copied from the client (copiedTokens): names, not numbers. */
  allowed?: readonly string[];
  /** false: files and links are not checked (a question asking the client for a file claims nothing). Default true. */
  references?: boolean;
  /** What the words are, for the detail line: 'draft' (default) or 'summary'. */
  subject?: string;
};
/** labelled: the words as the owner sees them, each estimate labelled and each refuted number replaced. */
export type ReceiptsCheck = { passed: boolean; numbers: DraftNumber[]; references: DraftReference[]; corrections: ReceiptCorrection[]; labelled: string; detail: string };

export const MODEL_ESTIMATE_LABEL = 'model estimate';

const FILE_EXTENSIONS = 'csv|tsv|xlsx|xls|ods|pdf|txt|json|xml|docx|doc|odt|pptx|ppt|png|jpe?g|gif|webp|svg|srt|vtt|mp4|mov|mkv|mp3|wav|m4a|zip|md|html?';
const FILE_NAME = new RegExp(`(?<![\\p{L}\\p{N}_./-])[\\p{L}\\p{N}_][\\p{L}\\p{N}_.()-]*\\.(?:${FILE_EXTENSIONS})(?![\\p{L}\\p{N}_])`, 'giu');
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/giu;
/** A digest the words give right after a file or link: "(sha256 ab12cd34)", "digest: ab12cd34", or 64 hex characters in brackets. */
const STATED_DIGEST = /^\s*[([,]?\s*(?:sha-?256|digest|hash)\s*[:=]?\s*([a-f0-9]{8,64})(?![a-z0-9])/i;
const BARE_DIGEST = /^\s*\(([a-f0-9]{64})\)/i;

/** Digits that are not numbers to label: document and section names, assessment years, clock times, years, names like GPT-6. */
const NOT_NUMBERS: readonly RegExp[] = [
  /\b(?:Form|ITR|GSTR|Rule|Schedule|Annexure|Chapter|Part|Page|Step|Version|Article|Clause)[\s-]?\d+[A-Z]{0,2}\b/giu,
  /\b(?:AY|FY|assessment year|financial year|previous year)\s+\d{4}-\d{2,4}\b/giu,
  /(?<![\p{N}.,/-])(?:19|20)\d{2}[-/]\d{2,4}(?![\p{N}])/gu,
  /\b(?:section|sections|sec\.?|u\/s)\s*\d{1,3}[A-Z]{0,4}(?:\([0-9a-z]{1,4}\))*/giu,
  /(?<![\p{N}:])\d{1,2}:\d{2}(?::\d{2})?(?![\p{N}:])/gu,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/giu,
  /(?<=\b(?:in|of|since|by|until|till|from|to|through|during|before|after|year|early|late|mid|end)\s)(?:19|20)\d{2}(?!\p{N}|[.,]\p{N})/giu,
  /\p{L}[\p{L}\p{N}]*-\p{N}[\p{L}\p{N}]*/gu,
];
const WORD_TOKEN = /[\p{L}\p{Nd}]+(?:[-./'’][\p{L}\p{Nd}]+)*/gu;

/** Number words with one value. One and first are not numbers here (the model-number rule of 21 October). */
const UNIT_WORDS: Readonly<Record<string, number>> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const MULTIPLIER_WORDS: Readonly<Record<string, number>> = { dozen: 12, hundred: 100 };
const SCALE_WORDS: Readonly<Record<string, number>> = { thousand: 1e3, lakh: 1e5, million: 1e6, crore: 1e7, billion: 1e9 };
/** Number words with no single value: always a model estimate, never compared. */
const VAGUE_WORDS: ReadonlySet<string> = new Set(['twice', 'half', 'dozens', 'hundreds', 'thousands', 'lakhs', 'crores', 'millions', 'billions']);
const NUMBER_WORD_LIST = [...Object.keys(UNIT_WORDS), ...Object.keys(MULTIPLIER_WORDS), ...Object.keys(SCALE_WORDS), ...VAGUE_WORDS].sort((a, b) => b.length - a.length).join('|');
const NUMBER_WORDS = new RegExp(`(?<![\\p{L}\\p{N}'’-])(?:${NUMBER_WORD_LIST})(?:[ \\t-]+(?:${NUMBER_WORD_LIST}))*(?![\\p{L}\\p{N}])`, 'giu');

/** A clause ends at a sentence stop, a line, a comma and space, or a joining word: "We matched 4 payments, and 2 bills are open". */
const CLAUSE_BREAK = /[.!?;](?=\s|$)|\n|,\s|\s(?:and|but|while|whereas)\s/giu;
/** Label words that say nothing about which figure is meant. */
const LABEL_STOP: ReadonlySet<string> = new Set(['a', 'an', 'the', 'at', 'on', 'for', 'of', 'to', 'in', 'by', 'from', 'with', 'and', 'or', 'this', 'that', 'these', 'those', 'your', 'our', 'its', 'one', 'per', 'is', 'are', 'was', 'were', 'be', 'it']);
/** Words that may follow a number about a figure without saying it counts something else: "comes to 500 for this order". */
const CONNECTIVES: ReadonlySet<string> = new Set([
  'and', 'or', 'but', 'for', 'in', 'on', 'at', 'is', 'was', 'are', 'were', 'this', 'that', 'the', 'a', 'an', 'to', 'of', 'from', 'with', 'so', 'which',
  'after', 'before', 'by', 'as', 'per', 'including', 'plus', 'less', 'each', 'all', 'only', 'now', 'today', 'too', 'also', 'here', 'there', 'then',
  'if', 'when', 'once', 'until', 'since', 'we', 'you', 'your', 'our', 'it', 'net', 'overall', 'altogether',
  'across', 'over', 'under', 'within', 'between', 'among', 'against', 'toward', 'towards', 'into', 'onto', 'upon', 'about', 'around',
  'through', 'via', 'because', 'than', 'more', 'due', 'already', 'still', 'yet', 'again', 'later', 'soon',
]);
/** Words in a clause that make a number with no counted thing after it money, a rate or tax: "your tax comes to 12,500". */
const MONEY_WORDS: ReadonlySet<string> = new Set([
  'tax', 'taxes', 'gst', 'cgst', 'sgst', 'igst', 'utgst', 'tds', 'tcs', 'cess', 'vat', 'duty', 'amount', 'total', 'subtotal', 'rate', 'fee', 'price', 'cost',
  'charge', 'income', 'refund', 'deduction', 'salary', 'wage', 'turnover', 'payable', 'receivable', 'liability', 'balance', 'interest', 'rebate', 'paid',
  'pay', 'payment', 'due', 'owe', 'owed', 'value', 'profit', 'loss', 'revenue', 'sales', 'expense', 'spend', 'spent', 'budget', 'rupee', 'inr', 'rs',
  'paise', 'money', 'cash', 'invoiced', 'billed', 'discount', 'penalty', 'fine', 'tariff', 'margin', 'earning', 'earnings',
].map(word => stem(word)));
/** Words right after a number that make it money rather than a count: "500 rupees". */
const MONEY_AFTER: ReadonlySet<string> = new Set(['rupee', 'rupees', 'paise', 'inr', 'rs', 'dollar', 'dollars', 'usd', 'euro', 'euros', 'pound', 'pounds'].map(word => stem(word)));
const CURRENCY_IN = /\p{Sc}|^(?:rs\.?|inr|usd|us\$|eur|gbp)\s?\d/iu;

type FoundNumber = { text: string; at: number; end: number; key: string | null };
/** value: the compared form of the display; keywords: the label's words that say which figure it is; tokens: every word of the label; own: numbers the label holds. */
export type PreparedFigure = CalculatorFigure & { value: string; keywords: Set<string>; tokens: Set<string>; own: Set<string> };
/** Words that may sit between a label and its number: "the GST comes to 500", "Total: 500", "payments matched to bills". */
const LINKING: ReadonlySet<string> = new Set([
  ...LABEL_STOP, 'come', 'comes', 'came', 'stand', 'stands', 'stood', 'work', 'works', 'worked', 'out', 'will', 'would', 'should', 'be', 'been', 'about',
  'around', 'roughly', 'nearly', 'almost', 'only', 'just', 'now', 'equal', 'equals', 'make', 'makes', 'reach', 'reaches', 'has', 'have', 'had', 'so', 'far', 'up',
].map(word => stem(word)));
/** Words that name this order's own price: a price receipt's figure speaks only to a clause that has one. */
const PRICE_ANCHORS: ReadonlySet<string> = new Set(['fee', 'fees', 'price', 'prices', 'priced', 'quote', 'quotes', 'quoted', 'order', 'orders'].map(word => stem(word)));

/** A word as compared: lower case, no possessive, a plain plural made singular ("payments" and "payment" match). */
function stem(word: string): string {
  const lower = word.toLowerCase().replace(/['’]s?$/, '');
  return lower.length > 3 && lower.endsWith('s') && !lower.endsWith('ss') ? lower.slice(0, -1) : lower;
}
const wordsOf = (value: string) => [...value.matchAll(TOKEN)].map(match => match[0]);
/** The word right after a number inside its clause, if a word comes next: "4 payments" gives payments. */
const nextWord = (text: string, from: number, to: number) => /^[ \t]+(\p{L}[\p{L}'’-]*)/u.exec(text.slice(from, to))?.[1];

/**
 * Money, a rate or a tax figure, as opposed to a count or a span of time: a percentage or a currency always is; a
 * number followed by a counted thing ("two invoices", "three weeks") is not, unless that thing is a currency; any
 * other number is when its clause talks about money or tax ("the tax comes to 12,500 across the year").
 */
function amountOf(text: string, number: FoundNumber): boolean {
  if (number.key?.endsWith('%') || CURRENCY_IN.test(number.text)) return true;
  const clause = clauseOf(text, number.at, number.end);
  const next = nextWord(text, number.end, clause.end);
  if (next && !CONNECTIVES.has(next.toLowerCase())) return MONEY_AFTER.has(stem(next));
  return wordsOf(text.slice(clause.start, clause.end)).some(word => MONEY_WORDS.has(stem(word)));
}

/** The compared form of the first number in a receipt's display ("INR 2,948.82" gives 2948.82); null when it holds none. */
function displayKey(display: string): string | null {
  const match = new RegExp(SOURCE_FIGURE.source, 'u').exec(display);
  return match ? figureKey(match[2]!, match[3], !!match[4]) : null;
}

function wordValue(phrase: string): string | null {
  let total = 0;
  let current = 0;
  for (const word of phrase.toLowerCase().split(/[\s-]+/)) {
    if (VAGUE_WORDS.has(word)) return null;
    if (word in UNIT_WORDS) current += UNIT_WORDS[word]!;
    else if (word in MULTIPLIER_WORDS) current = (current || 1) * MULTIPLIER_WORDS[word]!;
    else if (word in SCALE_WORDS) { total += (current || 1) * SCALE_WORDS[word]!; current = 0; }
  }
  return String(total + current);
}

const trimLink = (url: string) => url.replace(/[.,;:!?)\]]+$/, '');
function linkKey(url: string): string {
  const bare = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  const slash = bare.indexOf('/');
  return slash < 0 ? bare.toLowerCase() : bare.slice(0, slash).toLowerCase() + bare.slice(slash);
}
const plainDigest = (value: string) => value.toLowerCase().replace(/^sha-?256[:-]/, '');

function statedDigest(work: string, from: number): { digest: string; start: number; end: number } | null {
  const rest = work.slice(from, from + 120);
  const match = STATED_DIGEST.exec(rest) ?? BARE_DIGEST.exec(rest);
  if (!match) return null;
  const start = from + match.index + match[0].lastIndexOf(match[1]!);
  return { digest: match[1]!.toLowerCase(), start, end: start + match[1]!.length };
}

function heldLinks(evidence: ReceiptEvidence): Map<string, EvidenceLink> {
  // Links first from the explicit list (they may carry a digest), then any link written in a source.
  const held = new Map<string, EvidenceLink>();
  for (const link of evidence.links ?? []) held.set(linkKey(link.url), link);
  for (const source of evidence.sources) {
    for (const match of source.text.matchAll(LINK)) {
      const url = trimLink(match[0]);
      if (!held.has(linkKey(url))) held.set(linkKey(url), { url, digest: null, sourceId: source.id });
    }
  }
  return held;
}

function heldFile(name: string, files: readonly EvidenceFile[]): EvidenceFile | null {
  const wanted = name.toLowerCase();
  return files.find(file => {
    const have = file.name.toLowerCase();
    return have === wanted || (have.endsWith(wanted) && /[^\p{L}\p{N}]/u.test(have.charAt(have.length - wanted.length - 1)));
  }) ?? null;
}

const digestMatches = (stated: string | null, held: string | null): boolean | null =>
  stated === null ? null : held !== null && stated.length >= 8 && plainDigest(held).startsWith(stated);

/**
 * Links first (a link may end in a file name), then file names. Each is blanked so its digits are never numbers. A
 * link held with no digest (one a source mentions, or the owner's own) skips the digest test.
 */
function takeReferences(scan: Scan, evidence: PreparedEvidence, record: boolean): DraftReference[] {
  const references: DraftReference[] = [];
  const links = evidence.links;
  const take = (kind: 'file' | 'link', at: number, raw: string) => {
    const stated = statedDigest(scan.work, at + raw.length);
    if (stated) scan.blank(stated.start, stated.end);
    scan.blank(at, at + raw.length);
    if (!record) return;
    const statedValue = stated?.digest ?? null;
    if (kind === 'link') {
      const held = links.get(linkKey(raw)) ?? null;
      const matches = held && held.digest !== null ? digestMatches(statedValue, held.digest) : null;
      references.push({ kind, text: raw, at, statedDigest: statedValue, found: !!held, digestMatches: matches, sourceId: held?.sourceId ?? null });
    } else {
      const held = heldFile(raw, evidence.files);
      references.push({ kind, text: raw, at, statedDigest: statedValue, found: !!held, digestMatches: held ? digestMatches(statedValue, held.digest) : null, sourceId: held?.id ?? null });
    }
  };
  for (const match of [...scan.work.matchAll(LINK)]) take('link', match.index!, trimLink(match[0]));
  for (const match of [...scan.work.matchAll(FILE_NAME)]) take('file', match.index!, match[0]);
  return references;
}

function maskNotNumbers(scan: Scan, allowed: readonly string[]) {
  for (const pattern of NOT_NUMBERS) for (const match of [...scan.work.matchAll(pattern)]) scan.blank(match.index!, match.index! + match[0].length);
  if (!allowed.length) return;
  const copied = new Set(allowed.map(token => token.toLowerCase()));
  for (const match of [...scan.work.matchAll(WORD_TOKEN)]) if (copied.has(match[0].toLowerCase())) scan.blank(match.index!, match.index! + match[0].length);
}

function takeNumberWords(scan: Scan): FoundNumber[] {
  const found: FoundNumber[] = [];
  for (const match of [...scan.work.matchAll(NUMBER_WORDS)]) {
    const at = match.index!;
    found.push({ text: scan.original.slice(at, at + match[0].length), at, end: at + match[0].length, key: wordValue(match[0]) });
    scan.blank(at, at + match[0].length);
  }
  return found;
}

function prepareFigure(figure: CalculatorFigure): PreparedFigure | null {
  const value = displayKey(figure.display);
  if (value === null) return null;
  const own = new Set<string>();
  for (const match of figure.label.matchAll(SOURCE_FIGURE)) {
    const key = figureKey(match[2]!, match[3], false);
    own.add(key);
    if (match[4]) own.add(`${key}%`);
  }
  const keywords = new Set(wordsOf(figure.label).filter(word => !/\p{N}/u.test(word)).map(stem).filter(word => !LABEL_STOP.has(word)));
  return { ...figure, value, keywords, tokens: new Set(wordsOf(figure.label).map(stem)), own };
}

/** Reads and indexes the evidence once: the sources, the client's own sources, the calculator's figures and the held links. */
export function prepareEvidence(evidence: ReceiptEvidence, dateOrder: 'day-month-year' | 'month-day-year' = 'day-month-year'): PreparedEvidence {
  const indexed = evidence.sources.map(source => indexSource(source, dateOrder));
  const clientIds = new Set(evidence.clientIds ?? []);
  return {
    prepared: true, dateOrder, indexed, client: indexed.filter(item => clientIds.has(item.id)),
    figures: (evidence.figures ?? []).flatMap(figure => prepareFigure(figure) ?? []), links: heldLinks(evidence), files: evidence.files ?? [],
  };
}

const holds = (source: SourceIndex, key: string) => source.figures.has(key) || (key.endsWith('%') && source.figures.has(key.slice(0, -1)));

/**
 * True when the figure's label sits right next to the number: every label word is in the unbroken run of words that
 * touches the number on either side, where each word is a label word, a linking word ("comes to", "is") or a word that
 * names the order. "We matched 4 payments to bills" and "The GST on this order comes to 500" qualify; "the GST total
 * on your March sales is 18,000" does not.
 */
function labelBeside(text: string, number: FoundNumber, clause: { start: number; end: number }, figure: PreparedFigure): boolean {
  const before = wordsOf(text.slice(clause.start, number.at)).map(stem).reverse();
  const after = wordsOf(text.slice(number.end, clause.end)).map(stem);
  const allowed = (word: string) => figure.tokens.has(word) || LINKING.has(word) || PRICE_ANCHORS.has(word);
  const run = (words: readonly string[]) => { let count = 0; while (count < words.length && allowed(words[count]!)) count += 1; return words.slice(0, count); };
  const window = new Set([...run(before), ...run(after)]);
  return [...figure.keywords].every(word => window.has(word));
}

function clauseOf(text: string, at: number, end: number): { start: number; end: number } {
  let start = 0;
  let stop = text.length;
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    const from = match.index!;
    const to = from + match[0].length;
    if (to <= at) start = to;
    else if (from >= end) { stop = from; break; }
  }
  return { start, end: stop };
}

/**
 * The calculator's word on one number, only where it is plainly about that number: the label sits right next to it
 * (labelBeside), no counted thing follows it that the label does not name ("3 bills" is not the total), and a price
 * receipt's figure speaks only where the clause names the fee, price, quote or order. The most specific labels decide:
 * the same value is a receipt; one other value refutes it; labels that disagree decide nothing. A percentage is a rate,
 * so a figure never refutes it. The caller never asks about a number the client gave (the client's words stand).
 */
function calculatorVerdict(text: string, number: FoundNumber, figures: readonly PreparedFigure[]): { kind: 'same' | 'refuted'; figure: PreparedFigure } | null {
  const key = number.key;
  if (key === null || key.endsWith('%') || !figures.length) return null;
  const clause = clauseOf(text, number.at, number.end);
  const words = new Set(wordsOf(text.slice(clause.start, clause.end)).map(stem));
  const anchored = [...words].some(word => PRICE_ANCHORS.has(word));
  const next = nextWord(text, number.end, clause.end);
  const counts = (figure: PreparedFigure) => !!next && !CONNECTIVES.has(next.toLowerCase()) && !LINKING.has(stem(next)) && !figure.keywords.has(stem(next));
  const pool = figures.filter(figure => figure.keywords.size > 0 && (figure.kind !== 'price' || anchored) && !figure.own.has(key)
    && !(figure.unit === 'count' && key.includes('.')) && !counts(figure) && labelBeside(text, number, clause, figure));
  if (!pool.length) return null;
  const same = pool.find(figure => figure.value === key);
  if (same) return { kind: 'same', figure: same };
  const most = Math.max(...pool.map(figure => figure.keywords.size));
  const top = pool.filter(figure => figure.keywords.size === most);
  return new Set(top.map(figure => figure.value)).size === 1 ? { kind: 'refuted', figure: top[0]! } : null;
}

function quoted(items: readonly string[], max = 8): string {
  const shown = items.slice(0, max).map(item => `"${quote(item, 60)}"`).join(', ');
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

/**
 * Passed or not, and one plain line, for the numbers and references of a draft or summary (several pieces may be
 * checked apart and judged together). A refuted number, a file or link not in the evidence, a digest that does not
 * match, or an estimate where the playbook forbids estimates fails; estimates otherwise pass, listed as labelled.
 */
export function receiptsVerdict(numbers: readonly DraftNumber[], references: readonly DraftReference[], options: Pick<ReceiptOptions, 'estimates' | 'subject'> = {}): { passed: boolean; detail: string } {
  const subject = options.subject ?? 'draft';
  const problems: string[] = [];
  const refuted = numbers.flatMap(number => number.correction ? [{ number, correction: number.correction }] : []);
  if (refuted.length) {
    problems.push(`The calculator refutes ${refuted.map(({ number, correction }) => `"${quote(number.text, 40)}" (${correction.label} is ${correction.display}, receipt ${correction.receiptId})`).join(', ')} in the ${subject}.`);
  }
  for (const kind of ['file', 'link'] as const) {
    const missing = references.filter(reference => reference.kind === kind && !reference.found).map(reference => reference.text);
    if (missing.length) problems.push(`The ${subject} names ${missing.length === 1 ? `a ${kind}` : `${kind}s`} not in this run's evidence: ${quoted(missing)}.`);
  }
  for (const reference of references.filter(item => item.found && item.digestMatches === false)) {
    problems.push(`The digest the ${subject} gives for "${quote(reference.text, 60)}" does not match the one this run holds.`);
  }
  // Where estimates are forbidden, only money, rates and tax fail; a count with no receipt is labelled like any other.
  const estimates = numbers.filter(number => number.status === 'estimate');
  const forbidden = options.estimates === 'forbid' ? estimates.filter(number => number.amount).map(number => number.text) : [];
  const labelled = estimates.filter(number => !(options.estimates === 'forbid' && number.amount)).map(number => number.text);
  if (forbidden.length) {
    problems.push(`This playbook allows no model estimates of money, rates or tax, and ${forbidden.length === 1 ? 'this figure has' : 'these figures have'} no receipt: ${quoted(forbidden)}.`);
  }
  const one = labelled.length === 1;
  const label = labelled.length
    ? `${one ? 'This number has' : 'These numbers have'} no receipt, so ${one ? 'it shows as a model estimate' : 'they show as model estimates'}: ${quoted(labelled)}.`
    : '';
  if (problems.length) return { passed: false, detail: [...problems, label].filter(Boolean).join(' ') };
  if (label) return { passed: true, detail: label };
  if (numbers.length || references.length) return { passed: true, detail: `Every number, file and link in the ${subject} comes from a receipt, a tool result or the client.` };
  return { passed: true, detail: `The ${subject} states no number, file or link that needs a receipt.` };
}

/** The words with each estimate labelled after its word and each refuted number replaced by the calculator's figure. */
function labelWords(text: string, numbers: readonly DraftNumber[]): string {
  let out = '';
  let from = 0;
  for (const number of numbers) {
    if (number.status === 'receipted' || number.at < from) continue;
    if (number.correction) {
      out += `${text.slice(from, number.at)}${number.correction.display} (receipt ${number.correction.receiptId}, corrected from ${number.text})`;
      from = number.at + number.text.length;
      continue;
    }
    const end = number.at + number.text.length + (/^[\p{L}\p{N}-]*/u.exec(text.slice(number.at + number.text.length))?.[0].length ?? 0);
    out += `${text.slice(from, end)} (${MODEL_ESTIMATE_LABEL})`;
    from = end;
  }
  return out + text.slice(from);
}

/**
 * The receipts check on one piece of model words (a draft's text, a run summary). No model: every number is matched
 * against the calculator's figures and the run's sources, every file and link against the run's evidence. A number
 * the calculator refutes is refuted even when the same digits sit in some other source: the calculator decides.
 */
export function checkReceipts(text: string, evidence: ReceiptEvidence | PreparedEvidence, options: ReceiptOptions = {}): ReceiptsCheck {
  const ready = 'prepared' in evidence ? evidence : prepareEvidence(evidence, options.dateOrder ?? 'day-month-year');
  const order = ready.dateOrder;
  const subject = options.subject ?? 'draft';
  const scan = new Scan(text);
  // Links and file names first, so a known name inside a link never hides the link from the check.
  const references = takeReferences(scan, ready, options.references !== false);
  maskKnown(scan, options.known ?? []);
  maskNotNumbers(scan, options.allowed ?? []);
  takeCertifications(scan);
  takeDates(scan, order);
  takeFigures(scan);
  const found: FoundNumber[] = [
    ...scan.found.filter(claim => claim.kind === 'figure').map(claim => ({ text: claim.text, at: claim.at, end: claim.at + claim.text.length, key: claim.key })),
    ...takeNumberWords(scan),
  ].sort((a, b) => a.at - b.at);

  const numbers = found.map((number): DraftNumber => {
    const base = { text: number.text, at: number.at, key: number.key, amount: amountOf(text, number) };
    // The client's own figure stands: the calculator never refutes a number the client's message, answers or files hold.
    const key0 = number.key;
    const client = key0 === null ? undefined : ready.client.find(item => holds(item, key0));
    if (client) return { ...base, status: 'receipted', sourceId: client.id, correction: null };
    const verdict = calculatorVerdict(text, number, ready.figures);
    if (verdict?.kind === 'same') return { ...base, status: 'receipted', sourceId: verdict.figure.receiptId, correction: null };
    if (verdict?.kind === 'refuted') {
      const { figure } = verdict;
      const note = `The ${subject} said ${number.text}; the calculator's ${figure.label} is ${figure.display} (receipt ${figure.receiptId}), so the calculator's figure replaces it.`;
      const correction: ReceiptCorrection = { said: number.text, at: number.at, receiptId: figure.receiptId, figureKey: figure.figureKey, label: figure.label, display: figure.display, note };
      return { ...base, status: 'refuted', sourceId: figure.receiptId, correction };
    }
    const key = number.key;
    const source = key === null ? undefined : ready.indexed.find(item => holds(item, key));
    return source ? { ...base, status: 'receipted', sourceId: source.id, correction: null } : { ...base, status: 'estimate', sourceId: null, correction: null };
  });
  const verdict = receiptsVerdict(numbers, references, { estimates: options.estimates, subject });
  return {
    ...verdict, numbers, references, corrections: numbers.flatMap(number => number.correction ? [number.correction] : []), labelled: labelWords(text, numbers),
  };
}
