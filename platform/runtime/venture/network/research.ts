// Chausar venture launcher, network (Ink v2 wave 4, package 4D3, catalogue C19): "Before you write", a short brief on
// one person in the owner's network from public pages only, modelled on Happenstance's research. The pages come from
// the web search the host composed (none yet, and the answer says so) and are read only through the network guard, with
// every hop checked: never a LinkedIn or other personal profile page (RESEARCH_HOST_REFUSED), never an address inside
// the computer or its network, at most a megabyte a page. Only the person's name and company go to the web search. Each
// page is read as its words first (script, style and noscript blocks out, entities read), then passes the untrusted
// screen (enforce): one with words aimed at an agent or a checker is held and gives nothing. Each line is one sentence
// of a page that names the person, with its address, and professional facts only: a line about religion, caste,
// health, age, gender, sexual orientation or family role, or holding an email address, a phone number (a range of years
// is not one) or an id number, is dropped. No AI is asked; the lines are the pages' own words. They are kept on the
// person as "From public pages, not confirmed", in place of the last brief, and go with the person on Forget. Each
// line keeps its evidence status by the research rules (4J16, delivery/research-rules.ts): a single source, or
// corroborated when another site holds the same sentence, and the brief says how many are.
import { randomUUID } from 'node:crypto';
import { authorize, check, ChausarError, type Context } from '../../contracts.ts';
import type { PersonFact, PersonRecord, PersonResearch, VentureDeps } from '../contracts.ts';
import { exactPayload, identifier, requireAppChannel, tidyWords, ventureAction } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { readAs } from '../delivery/shared.ts';
import { checkUrl, guardedFetch, pinnedSend, type PinnedSender } from '../core/net-guard.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { screenReadback } from '../core/secrets.ts';
import { holdsIdNumber } from '../agents/answer.ts';
import { holdsContact, namesProtectedTrait, profileHost } from './protected.ts';
import { firstName } from './saved-searches.ts';
import { fold, plural } from './text.ts';
import { judgeClaim } from '../delivery/research-rules.ts';

/** At most this many pages are opened for one brief, this many lines kept from one page, and this many lines in all. */
export const MAX_PAGES = 4;
export const PER_PAGE = 2;
export const MAX_LINES = 6;
/** The most of one page Chausar reads, in bytes. */
export const PAGE_BYTES = 1024 * 1024;
export const WEB_LABEL = 'From public pages, not confirmed';
export const REFUSED_HOST = 'Chausar never opens LinkedIn or other personal profile pages.';
const NOT_SET_UP = 'Web search is not set up here, so Chausar cannot look up public pages for Before you write. What you keep about this person is above.';
const LINE_CHARS = { min: 20, max: 300 } as const;

/** A web address "Before you write" may open: the network guard's rules, and never a LinkedIn or other profile site. */
export function checkResearchUrl(raw: string): URL {
  const url = checkUrl(raw);
  if (profileHost(url.hostname)) throw new ChausarError('RESEARCH_HOST_REFUSED', REFUSED_HOST);
  return url;
}

/** The guard's sender with the profile check before every hop, so a redirect never lands on a profile page. */
export function profileSafe(send: PinnedSender): PinnedSender {
  return async target => {
    checkResearchUrl(target.url.href);
    return send(target);
  };
}

const NAMED: Readonly<Record<string, string>> = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

/** Blocks whose insides are never words, and tags whose end is a line break. */
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'iframe']);
const BREAKS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'section', 'article', 'header', 'footer', 'blockquote']);

/**
 * A page as its words, before any screen reads it, in one pass with indexOf (no backtracking, so a page that never
 * closes something costs no more than its length): comments and script, style, noscript, template and frame blocks
 * gone, tags out (a block's end is a line break), and the entities read, so words written as entities ("&#73;gnore
 * previous instructions") are words the screen sees. A comment, block or tag with no closer ends the page's words there.
 * A character code below a space, or a C1 control, is left out.
 */
export function pageWords(html: string): string {
  const lower = html.replace(/[A-Z]+/g, letters => letters.toLowerCase());
  let out = '';
  for (let at = 0; at < html.length;) {
    const open = html.indexOf('<', at);
    if (open < 0) { out += html.slice(at); break; }
    out += html.slice(at, open);
    if (lower.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      if (end < 0) break;
      out += ' ';
      at = end + 3;
      continue;
    }
    const close = html.indexOf('>', open + 1);
    if (close < 0) break;
    const name = /^<(\/?)([a-z][a-z0-9]*)/.exec(lower.slice(open, Math.min(close + 1, open + 24)));
    if (name && !name[1] && SKIPPED.has(name[2])) {
      const ends = lower.indexOf(`</${name[2]}`, close + 1);
      const endsAt = ends < 0 ? -1 : html.indexOf('>', ends);
      if (endsAt < 0) break;
      out += ' ';
      at = endsAt + 1;
      continue;
    }
    out += name && ((name[1] && BREAKS.has(name[2])) || name[2] === 'br') ? '\n' : ' ';
    at = close + 1;
  }
  return out.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,10});/giu, (whole, entity: string) => {
    if (entity[0] !== '#') return NAMED[entity.toLowerCase()] ?? whole;
    const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code >= 32 && code <= 0x10ffff && !(code >= 0x7f && code <= 0x9f) ? String.fromCodePoint(code) : ' ';
  });
}

/** Sentences of one block of text, at a full stop, a question or exclamation mark or a danda followed by a space. */
const sentences = (block: string) => block.split(/(?<=[.!?।])\s+/u).map(item => item.trim()).filter(Boolean);

/** A sentence a brief may keep: it names the person, is of a sensible length, and holds no protected trait, address, phone or id number. */
function keepable(sentence: string, name: string): boolean {
  const length = [...sentence].length;
  if (length < LINE_CHARS.min || length > LINE_CHARS.max) return false;
  if (!fold(sentence).includes(fold(name))) return false;
  return !namesProtectedTrait(sentence) && !holdsContact(sentence) && !holdsIdNumber(sentence);
}

/** also (4J16, Q19): other pages that hold the same sentence, which corroborate it when they are another site. */
type Read = { lines: { text: string; url: string; also?: string[] }[]; pages: number; profiles: number; held: number; failed: number };

/** Opens up to four pages through the guard and keeps the lines that name the person. */
async function readPages(deps: VentureDeps, person: PersonRecord, found: { url: string }[]): Promise<Read> {
  const read: Read = { lines: [], pages: 0, profiles: 0, held: 0, failed: 0 };
  const opened = new Set<string>();
  const send = profileSafe(deps.net?.send ?? pinnedSend);
  for (const item of found) {
    if (opened.size >= MAX_PAGES || read.lines.length >= MAX_LINES) break;
    let url: URL;
    try { url = checkResearchUrl(String(item?.url ?? '')); } catch (error) {
      if ((error as { code?: string }).code === 'RESEARCH_HOST_REFUSED') read.profiles += 1; else read.failed += 1;
      continue;
    }
    if (opened.has(url.href)) continue;
    opened.add(url.href);
    let body: string;
    try {
      const answer = await guardedFetch({ url: url.href, method: 'GET', headers: { accept: 'text/html, text/plain' }, maxBytes: PAGE_BYTES, maxRedirects: 2 }, { resolve: deps.net?.resolve, send });
      const type = (answer.headers['content-type'] ?? 'text/html').toLowerCase();
      if (answer.status < 200 || answer.status > 299 || !(type.includes('text/html') || type.includes('text/plain'))) { read.failed += 1; continue; }
      body = answer.body.toString('utf8');
    } catch (error) {
      if ((error as { code?: string }).code === 'RESEARCH_HOST_REFUSED') read.profiles += 1; else read.failed += 1;
      continue;
    }
    const screened = screenUntrusted({ source: 'web-page', text: pageWords(body) }, { mode: 'enforce' }).text;
    if (screened === null) { read.held += 1; continue; }
    const keepables = screened.split('\n').map(line => tidyWords(line)).filter(Boolean).flatMap(sentences).filter(sentence => keepable(sentence, person.name));
    // 4J16 (Q19): a sentence an earlier page already gave is noted on that line, so another site corroborates it.
    for (const line of read.lines) if (keepables.includes(line.text) && line.url !== url.href) line.also = [...(line.also ?? []), url.href];
    const kept = keepables.filter((sentence, i, all) => all.indexOf(sentence) === i && !read.lines.some(line => line.text === sentence)).slice(0, PER_PAGE);
    if (kept.length) read.pages += 1;
    for (const text of kept.slice(0, MAX_LINES - read.lines.length)) read.lines.push({ text, url: url.href });
  }
  return read;
}

/**
 * Each line's evidence status by the research rules (delivery/research-rules.ts, 4J16 Q19): pages read now, one site
 * a single source, two sites with the same sentence corroborated.
 */
function lineStatuses(read: Read, readAt: string): ('corroborated' | 'single-source')[] {
  return read.lines.map(line => judgeClaim({ claim: line.text, sources: [line.url, ...(line.also ?? [])].map(url => ({ url, kind: 'page' as const, readAt })) }).status === 'corroborated' ? 'corroborated' : 'single-source');
}

/** The brief's line, in code's words: how many lines from how many pages, and what was left out and why. */
function briefLine(read: Read, first: string, statuses: readonly string[] = []): string {
  const lead = read.lines.length
    ? `${WEB_LABEL}: ${plural(read.lines.length, 'line', 'lines')} from ${plural(read.pages, 'page', 'pages')}.`
    : `${WEB_LABEL}: nothing about ${first} on the public pages Chausar could read.`;
  const corroborated = statuses.filter(status => status === 'corroborated').length;
  return [
    lead,
    ...(corroborated ? [`${plural(corroborated, 'line is', 'lines are')} on two or more sites; the rest come from a single site.`] : []),
    ...(read.profiles ? [`Left out ${plural(read.profiles, 'profile page', 'profile pages')}: Chausar never opens LinkedIn or other personal profiles.`] : []),
    ...(read.held ? [`${plural(read.held, 'page', 'pages')} held back: ${read.held === 1 ? 'it had' : 'they had'} words aimed at the agent, so nothing from ${read.held === 1 ? 'it' : 'them'} was kept.`] : []),
    ...(read.failed ? [`${plural(read.failed, 'page', 'pages')} could not be read.`] : []),
  ].join(' ');
}

/**
 * venture.network.research { personId } (prepare, inside the app): "Before you write" for one person in the network,
 * from public pages only, as above. With no web search here it says so and stores nothing. Otherwise the lines replace
 * the person's last brief, each kept as a 'web' fact with its page's address as its source.
 */
export async function networkResearch(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PersonResearch> {
  requireAppChannel(ctx, 'venture.network.research');
  authorize(deps.store, ctx, 'prepare');
  const body = exactPayload(payload, ['personId'], ['personId']);
  const personId = identifier(body.personId, 'personId');
  const { state, venture } = readAs(deps, ctx, 'prepare');
  check(venture.country, 'INVALID_VENTURE_REQUEST', 'Finish your business\'s first steps, starting with its country, before you look anyone up.');
  const person = (state.conversations as PersonRecord[]).find(record => record?.kind === 'venture-person' && record.id === personId && record.ventureId === venture.id);
  check(person, 'INVALID_VENTURE_REQUEST', 'This person is not in your network.');
  if (!deps.webSearch) return { lines: [], line: NOT_SET_UP, web: 'not-set-up' };
  const name = person.facts.find(fact => fact.kind === 'name')?.value ?? null;
  check(name && !holdsIdNumber(name), 'INVALID_VENTURE_REQUEST', 'Chausar needs their name to look them up, and none of your files gave one.');
  const company = person.role?.company && !holdsIdNumber(person.role.company) ? person.role.company : null;
  let found: { url: string }[];
  try {
    found = await deps.webSearch.search(screenReadback(`"${name}"${company ? ` ${company}` : ''}`).text, { limit: MAX_PAGES * 2 });
  } catch {
    return { lines: [], line: 'The web search did not answer, so nothing was looked up. Try again later.', web: 'failed' };
  }
  const read = await readPages(deps, { ...person, name }, Array.isArray(found) ? found : []);
  return ventureAction(deps, ctx, 'prepare', 'network.research', tx => {
    const current = tx.find('venture-person', personId);
    check(current, 'INVALID_VENTURE_REQUEST', 'This person is not in your network.');
    const day = localDayAt(tx.now, tx.venture!.country);
    // 4J16 (Q19): each line keeps its evidence status, single source unless another site holds the same sentence.
    const statuses = lineStatuses(read, tx.now);
    const web: PersonFact[] = read.lines.map((line, index) => ({
      id: `web.${randomUUID()}`, kind: 'web', value: line.text, date: day, detail: { label: WEB_LABEL, status: statuses[index] }, source: { connector: 'web', importId: null, row: null, url: line.url },
    }));
    tx.replace<PersonRecord>({ ...current, facts: [...current.facts.filter(fact => fact.kind !== 'web'), ...web] });
    return { lines: read.lines.map(line => ({ text: line.text, url: line.url })), line: briefLine(read, firstName(name), statuses), web: read.lines.length ? 'found' : 'none' };
  });
}
