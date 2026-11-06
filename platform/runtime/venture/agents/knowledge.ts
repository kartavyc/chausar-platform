// Chausar venture launcher, agents (Ink v2 wave 4, package 4J18, catalogue A10): what the AI knows about the business.
// The owner adds sources: their own words, a web page (read only through the network guard, never a LinkedIn or other
// profile page at any hop, read as its words the way Before you write reads a page, network/research.ts pageWords),
// a file already on an order, or a piece of work they accepted for a client. Every part of every source, its title
// and file name included, passes the untrusted screen (enforce) before anything is kept: keys and card, bank, Aadhaar
// and one-time code numbers are hidden (the line says so), and words aimed at an agent or a checker, or hidden
// characters, are refused with nothing kept. A file or accepted work keeps no client's name (each becomes "the client")
// and no line with an email address or a phone number: minimum data. A source is listed with where it came from,
// removed by its id (its words erased, from the finished model calls that carried it too), and searched by shared words
// with no model. The questions agents handed to the owner that no source answers become one request a month ("To answer
// 6 questions from October 2026 well, add files about refunds and delivery times"), naming only what was asked about,
// never a client, a person or a capitalised name. Forget holds here: a person the owner forgets (network/forget.ts)
// and a note the owner forgets (agents/notes.ts) leave no words in any source, and the keyed check of forgotten names
// keeps them out of a later source. Each act and writing turn of a real order carries the sources that share words
// with its work (agents/knowledge-recall.ts, wired in delivery/harness/loop.ts); a source the screen holds as it is
// read says why here. A business with no country yet (still in its interview) shows plain dates and no requests.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import type {
  IdeaRecord, KnowledgeRecord, KnowledgeSourceInput, KnowledgeSourceView, KnowledgeTestView, KnowledgeView, ScreenNote, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { exactPayload, formatVentureDate, identifier, listRecords, plainText, requireAppChannel, singleLine, tidyWords, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { acceptedBlueprintOrNull, readAs } from '../delivery/shared.ts';
import { guardedFetch, pinnedSend } from '../core/net-guard.ts';
import { redactUrl } from '../core/secrets.ts';
import { screenUntrusted, type ScreenResult, type UntrustedSource } from '../policy/untrusted.ts';
import { pdfPages, tablesOfFile, transcriptCues } from '../delivery/harness/files.ts';
import { checkResearchUrl, pageWords, profileSafe } from '../network/research.ts';
import { holdsContact } from '../network/protected.ts';
import { eraseCallText } from '../network/saved-searches.ts';
import { forgottenIndex, networkKey, type ForgottenIndex } from '../network/forget.ts';
import { fold, handleHash } from '../network/text.ts';
import { listPeople } from '../network/store.ts';
import { monthWords } from '../money/goal-plans.ts';
import { short } from '../views/shared.ts';
import { judgeClaim, type ResearchStatus } from '../delivery/research-rules.ts';
import {
  contentTokens, forgetCached, heldReasons, listWords, liveSources, mergedNote, scoreSources, SCREEN_SOURCE, sentencesOf, sourceHeld, stemsOf,
} from './knowledge-recall.ts';

/** What the page says about who reads the sources: each act and writing turn, the ones that share words with its work. */
export const KNOWLEDGE_LINE = "Agents read the sources that share words with an order's request, as background they can't take as instructions. Test a question to see which source would answer it.";
/** The most sources a business keeps, and the most characters one source keeps. */
export const MAX_SOURCES = 200;
export const MAX_SOURCE_CHARS = 100_000;
/** The most characters the owner types into one source, and the most of one page Chausar reads, in bytes. */
const MAX_TEXT_INPUT = 20_000;
const PAGE_BYTES = 1024 * 1024;
/** How many months of requests the page lists, newest first, and how many hits a test search shows. */
const REQUEST_MONTHS = 3;
const MAX_HITS = 5;
/** What a forgotten person's name becomes in a source (network/forget.ts says the same in the owner's notes). */
export const FORGOTTEN_WORDS = 'someone you asked Chausar to forget';
/** What a forgotten note's words become in a source (agents/notes.ts says the same in a finished call). */
export const ERASED_WORDS = 'Erased: you asked Chausar to forget these words.';
/** What a finished model call's stored text becomes once a source it carried is removed or changed by Forget. */
export const ERASED_SOURCE_CALL = 'Erased: it carried a source you took out of what the AI knows.';
/** What a client's name becomes in a file or accepted work kept as a source. */
const CLIENT_WORDS = 'the client';
const ERASED_LINE = 'Some words were erased: you asked Chausar to forget them.';
const REMOVED_LINE = 'Removed. Chausar no longer keeps its words.';
const NOT_FOUND = 'That source was not found.';
const TWICE = 'You added this source already.';

// ---------------------------------------------------------------------------
// Words, by code (the shared-words rules are knowledge-recall.ts's, so the page's search and a run read alike)
// ---------------------------------------------------------------------------

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** One name said in a row once: "someone you asked Chausar to forget someone you asked ..." becomes one. */
function collapse(text: string): string {
  return text.replace(new RegExp(`${escaped(FORGOTTEN_WORDS)}(?:[\\s,.-]+${escaped(FORGOTTEN_WORDS)})+`, 'g'), FORGOTTEN_WORDS);
}

/** A text with every word of a forgotten person's name taken out, by the keyed check (network/forget.ts). */
function scrubForgotten(text: string, index: ForgottenIndex | null): string {
  if (!index || !index.names.size || !text) return text;
  const out = text.replace(/[\p{L}\p{M}]+/gu, word => {
    const folded = fold(word);
    return [...folded].length >= 3 && !folded.includes(' ') && index.names.has(handleHash(index.key, 'name', folded)) ? FORGOTTEN_WORDS : word;
  });
  return collapse(out);
}

/** The owner's day of a time, in the country's date order; the plain date while the business has no country yet. */
function dayOf(venture: VentureRecord, at: string): string {
  return venture.country ? formatVentureDate(localDayAt(at, venture.country), venture.country.dateOrder) : at.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Reading a source
// ---------------------------------------------------------------------------

/** What a source is once read: its words (cut to the longest kept), where it came from, and what the screen noted. */
type ReadSource = { kind: KnowledgeRecord['sourceKind']; title: string; text: string; url: string | null; uploadId: string | null; runId: string | null; screen: ScreenNote | null };

/** The text kept: cut to the longest a source keeps. */
const kept = (text: string) => text.slice(0, MAX_SOURCE_CHARS);
/** What the refusal calls the thing it held, by kind. */
const HELD_THING: Readonly<Record<KnowledgeRecord['sourceKind'], [string, string]>> = Object.freeze({
  text: ['Those words', 'them'], link: ['That page', 'it'], file: ['That file', 'it'], 'past-work': ['That work', 'it'],
});

/**
 * One part of a source (its words, its title, a file's name) through the untrusted screen in enforce: cleaned, keys
 * and id numbers hidden, or refused (UNTRUSTED_HELD) with the reason when it is held.
 */
function screenPart(kind: KnowledgeRecord['sourceKind'], text: string): ScreenResult & { text: string } {
  const source: UntrustedSource = SCREEN_SOURCE[kind];
  const result = screenUntrusted({ source, text }, { mode: 'enforce' });
  if (result.text === null) {
    const [thing, pronoun] = HELD_THING[kind];
    throw new ChausarError('UNTRUSTED_HELD', `${thing} ${thing === 'Those words' ? 'have' : 'has'} ${listWords(heldReasons(result))}, so Chausar kept nothing from ${pronoun}.`);
  }
  return result as ScreenResult & { text: string };
}

/** Lines of words, tidied, with no empty line. */
const lines = (text: string) => text.split('\n').map(line => tidyWords(line)).filter(Boolean);

/** A file's or accepted work's words with every sentence that holds an email address or a phone number left out. */
function withoutContacts(text: string): string {
  return lines(text).map(line => sentencesOf(line).filter(sentence => !holdsContact(sentence)).join(' ')).filter(Boolean).join('\n');
}

/** A text with every client's name (whole, and each part of three letters or more) as "the client". */
function withoutClients(state: State, venture: VentureRecord, text: string): string {
  const parts = new Set<string>();
  for (const client of listRecords(state, 'venture-client', venture.id)) {
    const name = client.name.trim();
    if (!name) continue;
    parts.add(name);
    for (const word of name.split(/[\s,.]+/)) if ([...word].length >= 3) parts.add(word);
  }
  if (!parts.size || !text) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...parts].sort((a, b) => b.length - a.length).map(escaped).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return text.replace(pattern, CLIENT_WORDS).replace(new RegExp(`${CLIENT_WORDS}(?:\\s+${CLIENT_WORDS})+`, 'g'), CLIENT_WORDS);
}

/** A source's payload, checked: one of the four kinds, with its own fields only. */
function sourceInput(value: unknown): KnowledgeSourceInput {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Send one source.');
  const kind = (value as { kind?: unknown }).kind;
  switch (kind) {
    case 'text': {
      const body = exactPayload(value, ['kind', 'title', 'text'], ['kind', 'title', 'text']);
      return { kind, title: singleLine(body.title, 'The title', { min: 2, max: 120 }), text: plainText(body.text, 'The text', { min: 2, max: MAX_TEXT_INPUT }) };
    }
    case 'link': {
      const body = exactPayload(value, ['kind', 'url'], ['kind', 'url']);
      check(typeof body.url === 'string' && body.url.trim().length > 0 && body.url.length <= 2000, 'INVALID_VENTURE_REQUEST', 'Send the address of one web page.');
      return { kind, url: body.url.trim() };
    }
    case 'file': {
      const body = exactPayload(value, ['kind', 'uploadId'], ['kind', 'uploadId']);
      return { kind, uploadId: identifier(body.uploadId, 'File') };
    }
    case 'past-work': {
      const body = exactPayload(value, ['kind', 'runId'], ['kind', 'runId']);
      return { kind, runId: identifier(body.runId, 'Run') };
    }
    default:
      throw new ChausarError('INVALID_VENTURE_REQUEST', 'A source is your own words, a web page, a file on an order or work you accepted.');
  }
}

/** The client of an order by name, or "a client": for the page's own lines, which the owner reads and no agent does. */
function clientOfOrder(state: State, venture: VentureRecord, orderId: string | null | undefined): string {
  const order = orderId ? listRecords(state, 'venture-order', venture.id).find(item => item.id === orderId) : undefined;
  const client = order ? listRecords(state, 'venture-client', venture.id).find(item => item.id === order.clientId) : undefined;
  return client?.name ?? 'a client';
}

/** Reads one source as described at the top: every part screened, a file's and accepted work's minimum data only. */
async function readSource(deps: VentureDeps, state: State, venture: VentureRecord, input: KnowledgeSourceInput): Promise<ReadSource> {
  const base = { url: null, uploadId: null, runId: null };
  switch (input.kind) {
    case 'text': {
      const title = screenPart('text', input.title), text = screenPart('text', input.text);
      return { ...base, kind: 'text', title: title.text, text: kept(text.text), screen: mergedNote([title, text]) };
    }
    case 'link': {
      const url = checkResearchUrl(input.url);
      const answer = await guardedFetch(
        { url: url.href, method: 'GET', headers: { accept: 'text/html, text/plain' }, maxBytes: PAGE_BYTES, maxRedirects: 2 },
        { resolve: deps.net?.resolve, send: profileSafe(deps.net?.send ?? pinnedSend) },
      );
      check(answer.status >= 200 && answer.status <= 299, 'NET_FAILED', 'That page did not answer, so nothing was added.');
      const type = (answer.headers['content-type'] ?? 'text/html').toLowerCase();
      check(type.includes('text/html') || type.includes('text/plain'), 'NET_FAILED', 'That address is not a page of words, so nothing was added.');
      const body = answer.body.toString('utf8');
      const html = type.includes('text/html');
      // The page's words first (comments, script, style, noscript and template out, entities read), then the screen.
      const named = html ? /<title[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(body)?.[1] : undefined;
      const words = screenPart('link', html ? pageWords(body.replace(/<title[^>]*>[\s\S]*?<\/title\s*>/giu, ' ')) : body);
      const title = screenPart('link', (named ? tidyWords(pageWords(named)) : '') || url.hostname);
      const text = lines(words.text).join('\n');
      check(text, 'INVALID_VENTURE_REQUEST', 'That page had no words Chausar could read, so nothing was added.');
      return { ...base, kind: 'link', title: short(title.text, 120), text: kept(text), url: redactUrl(url.href), screen: mergedNote([title, words]) };
    }
    case 'file': {
      const upload = listRecords(state, 'venture-upload', venture.id).find(item => item.id === input.uploadId && item.scope.kind !== 'poster');
      check(upload, 'INVALID_VENTURE_REQUEST', 'That file was not found.');
      let raw: string;
      if (upload.format === 'csv') raw = Buffer.from(upload.contentBase64, 'base64').toString('utf8');
      else if (upload.format === 'transcript') raw = transcriptCues(upload).map(cue => cue.text).join('\n');
      else if (upload.format === 'xlsx') {
        raw = tablesOfFile(upload).flatMap(table => [table.name, table.columns.join(' | '), ...table.rows.map(row => table.columns.map(column => row.cells[column] ?? '').join(' | '))]).join('\n');
      } else if (upload.format === 'pdf') raw = (await pdfPages(deps, upload)).pages.map(page => page.text).join('\n');
      else throw new ChausarError('INVALID_VENTURE_REQUEST', "Chausar can't read photos or scans as a source yet.");
      const words = screenPart('file', raw), name = screenPart('file', upload.name);
      const text = withoutClients(state, venture, withoutContacts(words.text));
      check(text, 'INVALID_VENTURE_REQUEST', 'That file had no words Chausar could read, so nothing was added.');
      return { ...base, kind: 'file', title: short(withoutClients(state, venture, name.text), 120), text: kept(text), uploadId: upload.id, screen: mergedNote([name, words]) };
    }
    case 'past-work': {
      const run = listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === input.runId);
      check(run && !run.practice && (run.status === 'accepted' || run.status === 'edited'), 'INVALID_VENTURE_REQUEST', 'Only work you accepted for a client can be a source.');
      const raw = (run.editedText ?? run.renderedText ?? '').trim();
      check(raw, 'INVALID_VENTURE_REQUEST', 'That work has no words to keep.');
      const order = listRecords(state, 'venture-order', venture.id).find(item => item.id === run.orderId);
      const offer = order ? acceptedBlueprintOrNull(state, venture)?.offers.find(item => item.id === order.offerId)?.name.value : undefined;
      const words = screenPart('past-work', raw), title = screenPart('past-work', `Accepted work: ${offer ?? 'an order'}`);
      const text = withoutClients(state, venture, withoutContacts(words.text));
      check(text, 'INVALID_VENTURE_REQUEST', 'That work has no words to keep.');
      return { ...base, kind: 'past-work', title: short(withoutClients(state, venture, title.text), 120), text: kept(text), runId: run.id, screen: mergedNote([title, words]) };
    }
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Refuses a full list (INVALID_VENTURE_REQUEST) and a source that is already kept, by its address, file, work or words. */
function checkRoom(records: readonly KnowledgeRecord[], next: Pick<ReadSource, 'kind' | 'url' | 'uploadId' | 'runId'> & { text?: string }): void {
  check(records.length < MAX_SOURCES, 'INVALID_VENTURE_REQUEST', `What the AI knows holds ${MAX_SOURCES} sources. Remove one first.`);
  const same = records.some(record => record.sourceKind === next.kind && (
    (next.kind === 'link' && record.url === next.url) || (next.kind === 'file' && record.uploadId === next.uploadId)
    || (next.kind === 'past-work' && record.runId === next.runId) || (next.kind === 'text' && next.text !== undefined && record.text === next.text)));
  check(!same, 'INVALID_VENTURE_REQUEST', TWICE);
}

/** What the screen hid or took out, in the source's line. */
function screenWords(note: ScreenNote | null): string[] {
  const hid: string[] = [];
  for (const finding of note?.findings ?? []) {
    const words = finding.kind === 'secret' ? 'a key or a password' : finding.kind === 'id' ? lowerFirst(finding.what.replace(/\.$/, '')) : null;
    if (words && !hid.includes(words)) hid.push(words);
  }
  return [
    ...(hid.length ? [`Chausar hid what looked like ${listWords(hid)} in it.`] : []),
    ...(note?.findings.some(finding => finding.kind === 'active-content') ? ['Chausar took out script and style code.'] : []),
  ];
}

/** 4J16 (Q19): what a web source can support, by the research rules: one site, not confirmed elsewhere. */
export const WEB_SOURCE_LINE = 'One site only: not confirmed elsewhere.';

/** A web source's evidence status by the research rules (delivery/research-rules.ts): the page read at readAt. */
export function webSourceStatus(url: string, readAt: string): ResearchStatus {
  return judgeClaim({ claim: 'web source', sources: [{ url, kind: 'page', readAt }] }).status;
}

/** One source as the page shows it: where it came from and when, what the screen hid or holds, and whether words were erased. */
function sourceView(state: State, venture: VentureRecord, record: KnowledgeRecord): KnowledgeSourceView {
  const day = dayOf(venture, record.at);
  let lead: string;
  if (record.sourceKind === 'text') lead = `Your own words, added ${day}.`;
  else if (record.sourceKind === 'link') {
    let host: string | null = null;
    try { host = record.url ? new URL(record.url).hostname : null; } catch { host = null; }
    lead = host ? `From ${host}, read ${day}.` : `From a web page, read ${day}.`;
    // 4J16 (Q19): one page is one site, read on that day: a single source, never shown as confirmed.
    if (record.url && webSourceStatus(record.url, record.at) === 'single-source') lead = `${lead} ${WEB_SOURCE_LINE}`;
  } else if (record.sourceKind === 'file') {
    const upload = record.uploadId ? listRecords(state, 'venture-upload', venture.id).find(item => item.id === record.uploadId) : undefined;
    const orderId = upload && upload.scope.kind === 'order' ? upload.scope.orderId : null;
    lead = `From ${record.title}, a file on ${clientOfOrder(state, venture, orderId)}'s order, read ${day}.`;
  } else {
    const run = record.runId ? listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === record.runId) : undefined;
    lead = `Work you accepted for ${clientOfOrder(state, venture, run?.orderId)}, kept ${day}.`;
  }
  const erased = [record.title, record.text].some(text => text.includes(FORGOTTEN_WORDS) || text.includes(ERASED_WORDS));
  // The screen again, as a run reads it (knowledge-recall.ts): what it holds now is never sent to an agent.
  const held = sourceHeld(record);
  const line = [
    lead, ...screenWords(record.screen),
    ...(record.text.length >= MAX_SOURCE_CHARS ? [`Chausar keeps the first ${MAX_SOURCE_CHARS.toLocaleString('en-IN')} characters.`] : []),
    ...(erased ? [ERASED_LINE] : []),
    ...(held.length ? [`Held: it has ${listWords(held)}, so agents never read the parts that hold them.`] : []),
  ].join(' ');
  return { id: record.id, kind: record.sourceKind, title: record.title, at: record.at, line };
}

// ---------------------------------------------------------------------------
// Requests: what agents asked the owner that no source answers
// ---------------------------------------------------------------------------

/** The questions agents handed to the owner in real runs, with the month (the owner's) each was asked in. */
function ownerQuestions(state: State, venture: VentureRecord & { country: NonNullable<VentureRecord['country']> }): { text: string; month: string }[] {
  const calls = new Map(listRecords(state, 'venture-model-call', venture.id).map(call => [call.id, call.at] as const));
  return listRecords(state, 'venture-delivery-run', venture.id).filter(run => !run.practice && run.harness).flatMap(run => {
    const harness = run.harness!;
    return (harness.handoffs ?? []).filter(handoff => handoff.to === 'owner' && handoff.answeredBy !== 'practice-client' && typeof handoff.question === 'string').map(handoff => {
      const turn = (harness.turns ?? []).find(item => item.turn === handoff.turn);
      const at = (turn?.callId ? calls.get(turn.callId) : undefined) ?? run.at;
      return { text: handoff.question, month: localDayAt(at, venture.country).slice(0, 7) };
    });
  });
}

/** Words a request never says: the names of the business's clients and of the people in its network, and forgotten names. */
function nameFilter(deps: VentureDeps, state: State, venture: VentureRecord): ((word: string) => boolean) | null {
  const words = new Set<string>();
  const add = (name: string) => { for (const match of name.normalize('NFC').toLowerCase().matchAll(/[\p{L}\p{M}\p{Nd}]+/gu)) words.add(match[0]); };
  for (const client of listRecords(state, 'venture-client', venture.id)) add(client.name);
  for (const person of listPeople(state, venture.id)) { add(person.name); for (const fact of person.facts) if (fact.kind === 'name') add(fact.value); }
  let index: ForgottenIndex | null;
  try { index = forgottenIndex(listRecords(state, 'venture-forgotten', venture.id), networkKey(deps)); } catch { return null; }
  return word => words.has(word) || (!!index && index.names.has(handleHash(index.key, 'name', fold(word))));
}

/**
 * The one or two things to add, named from the words the unanswered questions asked about that no source holds: never
 * a name (a client's, a person's, a forgotten one's, or any word capitalised where no sentence starts).
 */
function whatToAdd(questions: readonly string[], held: ReadonlySet<string>, named: (word: string) => boolean): string[] {
  type Term = { count: number; pair: boolean; first: number; surfaces: Map<string, number>; stems: string[] };
  const terms = new Map<string, Term>();
  let seen = 0;
  const note = (key: string, surface: string, stems: string[]) => {
    const term = terms.get(key) ?? { count: 0, pair: stems.length > 1, first: seen++, surfaces: new Map(), stems };
    term.surfaces.set(surface, (term.surfaces.get(surface) ?? 0) + 1);
    terms.set(key, term);
  };
  for (const question of questions) {
    const missing = contentTokens(question).filter(token => !token.capital && !held.has(token.stem) && !named(token.surface));
    const keys = new Set<string>();
    missing.forEach((token, i) => {
      keys.add(token.stem);
      note(token.stem, token.surface, [token.stem]);
      const next = missing[i + 1];
      if (next && next.at === token.at + 1) {
        const key = `${token.stem} ${next.stem}`;
        keys.add(key);
        note(key, `${token.surface} ${next.surface}`, [token.stem, next.stem]);
      }
    });
    for (const key of keys) terms.get(key)!.count += 1;
  }
  const ranked = [...terms.values()].sort((a, b) => b.count - a.count || Number(b.pair) - Number(a.pair) || a.first - b.first);
  const chosen: Term[] = [];
  for (const term of ranked) {
    if (chosen.length >= 2) break;
    if (chosen.some(other => other.stems.some(word => term.stems.includes(word)))) continue;
    chosen.push(term);
  }
  return chosen.map(term => [...term.surfaces.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0]);
}

/**
 * The requests: for each of the last months with questions agents handed to the owner that no source answers (no
 * source shares at least half of a question's words), one line naming how many and what to add. Newest month first.
 * None while the business has no country yet: a month is the owner's own.
 */
function knowledgeRequests(deps: VentureDeps, state: State, venture: VentureRecord): string[] {
  if (!venture.country) return [];
  const records = liveSources(state, venture);
  const held = new Set(records.flatMap(record => [...stemsOf(`${record.title}\n${record.text}`)]));
  const named = nameFilter(deps, state, venture);
  const months = new Map<string, string[]>();
  for (const question of ownerQuestions(state, venture as VentureRecord & { country: NonNullable<VentureRecord['country']> })) {
    const asked = stemsOf(question.text);
    if (!asked.size) continue;
    const needed = Math.max(1, Math.ceil(asked.size / 2));
    if (scoreSources(records, question.text).some(item => item.shared >= needed)) continue;
    months.set(question.month, [...(months.get(question.month) ?? []), question.text]);
  }
  return [...months.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, REQUEST_MONTHS).map(([month, questions]) => {
    const n = questions.length;
    const terms = named ? whatToAdd(questions, held, named) : [];
    const about = terms.length ? ` about ${terms.join(' and ')}` : n === 1 ? ' that answers it' : ' that answer them';
    return `To answer ${n} ${n === 1 ? 'question' : 'questions'} from ${monthWords(month)} well, add ${n === 1 ? 'a file' : 'files'}${about}.`;
  });
}

// ---------------------------------------------------------------------------
// Forget and remove
// ---------------------------------------------------------------------------

/**
 * Erases a source's words from every finished model call that carried it (by its id, which only a call that carried
 * it holds), as 4D3's eraseCallText does: ids, digests, costs and times stay; a call another package erased already is
 * left as it is; a waiting preview is expired so it can never go. The recall cache drops the source's words too.
 */
function eraseCallsCarrying(tx: VentureTx, sourceId: string): void {
  eraseCallText(tx, new Set(), ERASED_SOURCE_CALL, call => typeof call.payloadText === 'string' && call.payloadText.includes(sourceId));
  forgetCached(sourceId);
}

/**
 * Forget of a person in the owner's network (network/forget.ts removePersonData, DPDP): every word of their name in a
 * source (its title, its words) and in an idea Chausar keeps (its title, reason, prompt and evidence lines) becomes
 * "someone you asked Chausar to forget", a page address that names them goes, and the model calls that carried such a
 * source lose their words. names: the forget's own pattern.
 */
export function eraseKnowledgeNaming(tx: VentureTx, names: RegExp): void {
  const mentions = (text: string | null | undefined) => !!text && new RegExp(names.source, names.flags).test(text);
  const unnamed = (text: string) => (mentions(text) ? collapse(text.replace(new RegExp(names.source, names.flags), FORGOTTEN_WORDS)) : text);
  for (const record of tx.list('venture-knowledge')) {
    if (record.removedAt !== null || ![record.title, record.text, record.url].some(mentions)) continue;
    tx.replace<KnowledgeRecord>({ ...record, title: unnamed(record.title), text: unnamed(record.text), url: mentions(record.url) ? null : record.url });
    eraseCallsCarrying(tx, record.id);
  }
  for (const idea of tx.list('venture-idea')) {
    if (![idea.title, idea.reason, idea.prompt, ...idea.evidence.map(item => item.line)].some(mentions)) continue;
    tx.replace<IdeaRecord>({ ...idea, title: unnamed(idea.title), reason: unnamed(idea.reason), prompt: unnamed(idea.prompt), evidence: idea.evidence.map(item => ({ ...item, line: unnamed(item.line) })) });
  }
}

/**
 * Forget of a note (agents/notes.ts eraseNote): wherever a source repeats the note's words (any of its versions), they
 * become "Erased: you asked Chausar to forget these words." The rest of the source keeps its words.
 */
export function eraseKnowledgeHolding(tx: VentureTx, texts: readonly string[]): void {
  const words = [...new Set(texts.map(text => text.trim().replace(/[.!?।]+$/u, '').trim()).filter(text => text.length >= 2))];
  if (!words.length) return;
  const pattern = new RegExp(`(?:${words.sort((a, b) => b.length - a.length).map(text => escaped(text).replace(/\s+/g, '\\s+')).join('|')})[.!?।]?`, 'giu');
  for (const record of tx.list('venture-knowledge')) {
    if (record.removedAt !== null) continue;
    const text = record.text.replace(pattern, ERASED_WORDS), title = record.title.replace(pattern, ERASED_WORDS);
    if (text === record.text && title === record.title) continue;
    tx.replace<KnowledgeRecord>({ ...record, title, text });
    forgetCached(record.id);
  }
}

// ---------------------------------------------------------------------------
// The methods
// ---------------------------------------------------------------------------

/**
 * venture.knowledge.list {} (read): the sources in use, newest first, each with where it came from and what the screen
 * hid or holds; the requests for what agents asked that no source answers, a month at a time; and the line that says
 * how agents read the sources.
 */
export async function knowledgeListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<KnowledgeView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return {
    sources: [...liveSources(state, venture)].reverse().map(record => sourceView(state, venture, record)),
    requests: knowledgeRequests(deps, state, venture),
    line: KNOWLEDGE_LINE,
  };
}

/**
 * venture.knowledge.add { source } (prepare, app only): one source, read and screened as above, then kept with the
 * words of forgotten people taken out by the keyed check (refused with TIER_UNAVAILABLE, as an import is, when there
 * are forgotten people and no key to check them with). The same source twice, and a 201st, are refused before
 * anything is fetched.
 */
export async function knowledgeAddHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ source: KnowledgeSourceView }> {
  requireAppChannel(ctx, 'venture.knowledge.add');
  const body = exactPayload(payload, ['source'], ['source']);
  const input = sourceInput(body.source);
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const early = input.kind === 'link' ? { url: redactUrl(checkResearchUrl(input.url).href), uploadId: null, runId: null }
    : { url: null, uploadId: input.kind === 'file' ? input.uploadId : null, runId: input.kind === 'past-work' ? input.runId : null };
  checkRoom(liveSources(state, venture), { kind: input.kind, ...early });
  const read = await readSource(deps, state, venture, input);
  return ventureAction(deps, ctx, 'prepare', 'knowledge.add', tx => {
    const index = forgottenIndex(tx.list('venture-forgotten'), networkKey(deps));
    const title = scrubForgotten(read.title, index), text = scrubForgotten(read.text, index);
    checkRoom(liveSources(tx.state, tx.venture!), { kind: read.kind, url: read.url, uploadId: read.uploadId, runId: read.runId, text });
    const record = tx.put<KnowledgeRecord>({
      ...tx.base('venture-knowledge'), sourceKind: read.kind, title, text, url: read.url, uploadId: read.uploadId, runId: read.runId, screen: read.screen, removedAt: null,
    });
    return { source: sourceView(tx.state, tx.venture!, record) };
  });
}

/**
 * venture.knowledge.remove { id } (prepare, app only): the source goes and its words are erased, from the finished
 * model calls that carried it too; its id and time stay.
 */
export async function knowledgeRemoveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ removed: true; line: string }> {
  requireAppChannel(ctx, 'venture.knowledge.remove');
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Source');
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'knowledge.remove', tx => {
    const record = tx.find('venture-knowledge', id);
    check(record && record.removedAt === null, 'INVALID_VENTURE_REQUEST', NOT_FOUND);
    tx.replace<KnowledgeRecord>({ ...record, title: '', text: '', url: null, screen: null, removedAt: tx.now });
    eraseCallsCarrying(tx, record.id);
    return { removed: true as const, line: REMOVED_LINE };
  });
}

/**
 * venture.knowledge.test { question } (prepare, app only): which sources share words with a question, the most first,
 * each with the sentence that shares the most. By code, no model; nothing is kept.
 */
export async function knowledgeTestHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<KnowledgeTestView> {
  requireAppChannel(ctx, 'venture.knowledge.test');
  const body = exactPayload(payload, ['question'], ['question']);
  const question = plainText(body.question, 'The question', { min: 2, max: 300 });
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const hits = scoreSources(liveSources(state, venture), question).slice(0, MAX_HITS)
    .map(item => ({ sourceId: item.record.id, title: item.record.title, line: item.line }));
  const n = hits.length;
  return { hits, line: n ? `${n} ${n === 1 ? 'source shares' : 'sources share'} words with your question.` : 'No source shares words with this question. Add a source about it.' };
}
