// Chausar delivery checks (Ink v2 wave 4, package 4J16, catalogue Q4): a quote must appear where it is cited. Code
// only, no model. A cited quote is looked for at its place, within a small window: 10 seconds either side of a
// transcript timestamp, or 2 lines (or rows) either side of the cited line or row, or on the cited page itself. The
// words are compared without case, punctuation or extra spaces, so a quote may run across two cues or lines. A quote
// found elsewhere gets one correction round that says where it really is (round 1: 'fix'); on the second round, or for
// a draft that is final, it fails. A quote found nowhere fails and says so. Spot checks pick a fixed sample of quotes
// for a seed, the same every time, so a check can be repeated. On a draft, round 1 runs in the draft pre-check:
// moveQuoteTimes moves a quote's time to where the transcript says it, once, and says so; the final check is round 2.
// Ideas taken, code written here: OpenQodex packages/review/src/evidence-check.ts (quote at location with a window and
// one correction round), podcast-to-article SKILL.md step 7 (quote spot checks against the transcript).
import { createHash } from 'node:crypto';

/** The window a quote may sit in around its citation. */
export const QUOTE_WINDOW = Object.freeze({ lines: 2, ms: 10_000 });

export type QuoteAt = { kind: 'time'; ms: number } | { kind: 'page'; page: number; line?: number } | { kind: 'row'; row: string };
export type QuoteCitation = { quote: string; at: QuoteAt };
export type QuoteSource =
  | { kind: 'transcript'; cues: readonly { startMs: number; endMs: number; text: string }[] }
  | { kind: 'pages'; pages: readonly { page: number; text: string }[] }
  | { kind: 'rows'; rows: readonly { id: string; text: string }[] };
/**
 * found: at its place; foundAt: where the words really are when they are said once elsewhere, else null; elsewhere:
 * every place they are said when that is more than once (the quote is then ambiguous, and nothing is moved).
 */
export type QuoteLook = { found: boolean; foundAt: QuoteAt | null; elsewhere?: QuoteAt[] };
export type QuoteResult = QuoteCitation & QuoteLook;
export type QuoteCheck = { outcome: 'pass' | 'fix' | 'fail'; results: QuoteResult[]; detail: string };

/** Words as compared: lower case, letters and digits only, one space between words. */
function words(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}
const holds = (haystack: string, quote: string) => ` ${words(haystack)} `.includes(` ${words(quote)} `);

/** A time as a viewer reads it: 3:05, 12:40 or 1:02:03. */
export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

type Line = { at: QuoteAt; text: string };
/** The source as lines in order, each with its own place. */
function linesOf(source: QuoteSource): Line[] {
  if (source.kind === 'transcript') return source.cues.map(item => ({ at: { kind: 'time', ms: item.startMs }, text: item.text }));
  if (source.kind === 'rows') return source.rows.map(item => ({ at: { kind: 'row', row: item.id }, text: item.text }));
  return source.pages.flatMap(page => page.text.split(/\r?\n/).map((text, index) => ({ at: { kind: 'page' as const, page: page.page, line: index + 1 }, text })));
}

/** The lines of the window around a citation, in order. */
function windowOf(source: QuoteSource, at: QuoteAt): string[] {
  if (source.kind === 'transcript' && at.kind === 'time') {
    return source.cues.filter(item => item.endMs >= at.ms - QUOTE_WINDOW.ms && item.startMs <= at.ms + QUOTE_WINDOW.ms).map(item => item.text);
  }
  if (source.kind === 'rows' && at.kind === 'row') {
    const index = source.rows.findIndex(item => item.id === at.row);
    return index < 0 ? [] : source.rows.slice(Math.max(0, index - QUOTE_WINDOW.lines), index + QUOTE_WINDOW.lines + 1).map(item => item.text);
  }
  if (source.kind === 'pages' && at.kind === 'page') {
    const all = linesOf(source);
    const index = (line: Line) => all.indexOf(line);
    const onPage = all.filter(line => line.at.kind === 'page' && line.at.page === at.page);
    if (!onPage.length) return [];
    // A cited page: its own lines. A cited line: two lines either side, across a page break too.
    if (at.line === undefined) return onPage.map(line => line.text);
    const cited = index(onPage[Math.max(1, Math.min(onPage.length, at.line)) - 1]);
    return all.slice(Math.max(0, cited - QUOTE_WINDOW.lines), cited + QUOTE_WINDOW.lines + 1).map(line => line.text);
  }
  return [];
}

/** Every place the quote's words are said in the whole source, as the line each time starts on, in order. */
function placesOf(source: QuoteSource, quote: string): QuoteAt[] {
  const all = linesOf(source);
  const target = ` ${words(quote)} `;
  let joined = ' ';
  const starts: number[] = [];
  for (const line of all) {
    starts.push(joined.length);
    const said = words(line.text);
    if (said) joined += `${said} `;
  }
  const places: QuoteAt[] = [];
  const seen = new Set<number>();
  for (let from = joined.indexOf(target); from >= 0; from = joined.indexOf(target, from + 1)) {
    const index = starts.findLastIndex(start => start <= from + 1);
    if (index >= 0 && !seen.has(index)) { seen.add(index); places.push(all[index].at); }
  }
  return places;
}

/** Whether a quote is at its place, and where it is when it is elsewhere. */
export function checkQuote(citation: QuoteCitation, source: QuoteSource): QuoteLook {
  if (!words(citation.quote)) return { found: false, foundAt: null };
  if (holds(windowOf(source, citation.at).join(' '), citation.quote)) return { found: true, foundAt: null };
  const places = placesOf(source, citation.quote);
  if (places.length > 1) return { found: false, foundAt: null, elsewhere: places };
  return { found: false, foundAt: places[0] ?? null };
}

const SOURCE_WORDS: Readonly<Record<QuoteSource['kind'], string>> = { transcript: 'the transcript', pages: 'the document', rows: 'the table' };
function place(at: QuoteAt): string {
  if (at.kind === 'time') return clock(at.ms);
  if (at.kind === 'row') return `row ${at.row}`;
  return at.line === undefined ? `page ${at.page}` : `page ${at.page}, line ${at.line}`;
}
const short = (quote: string, max = 60) => (quote.length > max ? `${quote.slice(0, max - 3).trimEnd()}...` : quote);
const andList = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] ?? '');

/**
 * Every cited quote checked at its place. round 1: a quote off its place or missing asks for one correction (fix);
 * round 2, or a final draft: it fails. The detail says, for each quote not at its place, where it really is.
 */
export function quoteCheck(citations: readonly QuoteCitation[], source: QuoteSource, round: 1 | 2): QuoteCheck {
  const results = citations.map(citation => ({ ...citation, ...checkQuote(citation, source) }));
  const off = results.filter(item => !item.found);
  if (!off.length) {
    return { outcome: 'pass', results, detail: results.length ? `Each of the ${results.length} quotes is at its place in ${SOURCE_WORDS[source.kind]}.` : 'The draft cites no quote.' };
  }
  const lines = off.slice(0, 3).map(item => (item.foundAt
    ? `"${short(item.quote)}" is at ${place(item.foundAt)}, not ${place(item.at)}.`
    : item.elsewhere?.length
      ? `"${short(item.quote)}" is said ${item.elsewhere.length} times in ${SOURCE_WORDS[source.kind]} (at ${andList(item.elsewhere.map(place))}), so it is ambiguous: quote it at the time you mean.`
      : `"${short(item.quote)}" does not appear in ${SOURCE_WORDS[source.kind]}.`));
  const more = off.length > 3 ? ` And ${off.length - 3} more.` : '';
  return round === 1
    ? { outcome: 'fix', results, detail: `${lines.join(' ')}${more} Fix the place or the words; this is the one correction before the check fails.` }
    : { outcome: 'fail', results, detail: `${lines.join(' ')}${more} Quote the words at their place.` };
}

/** A fixed sample of the quotes for a seed (the same every time), each checked at its place. */
export function spotCheckQuotes(citations: readonly QuoteCitation[], source: QuoteSource, options: { sample: number; seed: string }): QuoteResult[] {
  const rank = (citation: QuoteCitation) => createHash('sha256').update(`${options.seed}\n${citation.quote}\n${place(citation.at)}`).digest('hex');
  return [...citations].sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0))
    .slice(0, Math.max(0, options.sample)).map(citation => ({ ...citation, ...checkQuote(citation, source) }));
}

const OPEN = String.fromCharCode(0x201C), CLOSE = String.fromCharCode(0x201D);
/** "words" or curly-quoted words, then (12:03), [1:02:03], (at 12:03), (page 2) or (row r4). */
const CITED = new RegExp(`(?:"([^"\\n]{1,300})"|${OPEN}([^${CLOSE}\\n]{1,300})${CLOSE})\\s*[(\\[]\\s*(?:at\\s+)?(?:(\\d{1,2}(?::\\d{2}){1,2})|page\\s+(\\d{1,4})|row\\s+(r\\d{1,5}))\\s*[)\\]]`, 'giu');
/** A quote worth citing has at least three words. */
const MIN_WORDS = 3;

/** The quotes a draft cites, in order, with their places. Short quoted words are not citations. */
export function draftQuotes(text: string): QuoteCitation[] {
  const found: QuoteCitation[] = [];
  for (const match of text.matchAll(CITED)) {
    const quote = (match[1] ?? match[2] ?? '').trim();
    if (words(quote).split(' ').filter(Boolean).length < MIN_WORDS) continue;
    if (match[3]) {
      const parts = match[3].split(':').map(Number);
      const seconds = parts.reduce((total, part) => total * 60 + part, 0);
      found.push({ quote, at: { kind: 'time', ms: seconds * 1000 } });
    } else if (match[4]) found.push({ quote, at: { kind: 'page', page: Number(match[4]) } });
    else found.push({ quote, at: { kind: 'row', row: match[5].toLowerCase() } });
  }
  return found;
}

/**
 * Round 1 of the quote check, by code, before the checks (the draft pre-check): each quote the text cites with a time
 * that is said exactly once, at another time, in the transcript has its time moved there, once, with a line saying so.
 * A quote said nowhere, or more than once (ambiguous), is left as it is, so round 2 (the final check) fails it and says
 * why. The text given is not changed.
 */
export function moveQuoteTimes(text: string, cues: Extract<QuoteSource, { kind: 'transcript' }>['cues']): { text: string; fixes: string[] } {
  const source: QuoteSource = { kind: 'transcript', cues };
  const fixes: string[] = [];
  let out = '';
  let from = 0;
  for (const match of text.matchAll(CITED)) {
    const quote = (match[1] ?? match[2] ?? '').trim();
    if (!match[3] || words(quote).split(' ').filter(Boolean).length < MIN_WORDS) continue;
    const seconds = match[3].split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
    const look = checkQuote({ quote, at: { kind: 'time', ms: seconds * 1000 } }, source);
    if (look.found || look.foundAt?.kind !== 'time') continue;
    const at = match.index ?? 0;
    const whole = match[0];
    const timeAt = whole.lastIndexOf(match[3]);
    const moved = `${whole.slice(0, timeAt)}${clock(look.foundAt.ms)}${whole.slice(timeAt + match[3].length)}`;
    out += text.slice(from, at) + moved;
    from = at + whole.length;
    fixes.push(`"${short(quote, 40)}" moved from ${match[3]} to ${clock(look.foundAt.ms)}, where the transcript says it.`);
  }
  return { text: fixes.length ? out + text.slice(from) : text, fixes };
}
