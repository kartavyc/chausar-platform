// Chausar finding customers: every word the owner reads about a search, in one place. The engine (find-target.ts,
// find-run.ts, find-methods.ts) and the app's fake engine build their lines from these same functions, so the two
// cannot drift. Plain words, no em dash. Counts are worked out by code and passed in; nothing here counts or prices.
// Pure: no store, no network and no Node imports.
import { briefWords, kindWords, type FindBrief } from './find-brief.ts';
import { searchOpen, type SearchState } from './find-states.ts';
import type { FindSearchView, OpenSearchView } from './find-types.ts';
import { formatAge } from '../../owner-format.ts';
import { fillWords } from '../views/card-words.ts';

export const NOT_READY = 'Finding customers waits until what you sell is ready.';
/** The refusal of the gate (BLUEPRINT_NOT_ACCEPTED, PRICE_REQUIRED), with what is still missing. */
export const notReadyLine = (missing: readonly string[]): string => `${NOT_READY} ${missing.join(' ')}`;
/** The same on a card that can no longer go ahead: it finishes "This can't go ahead now: ...". */
export const notReadyReason = (missing: readonly string[]): string => `what you sell is not ready yet. ${missing.join(' ')}`;
export const NOTHING_SENT = 'Nothing is sent. You check the list and write to each one yourself.';
export const NO_LEAD_TOOL = 'No lead tool is connected. The public map search needs nothing.';
/** The same where the plan's customers are not places on a map: the map is not offered as the way meanwhile. */
export const NO_LEAD_TOOL_ONLY = 'No lead tool is connected.';
export const NOT_APPROVED = 'Finding customers runs only after you approve that exact search on Today.';
export const PROPOSED_LINE = 'On Today for your approval. Nothing has run.';
export const CARD_CHANGED = 'This search changed since you approved it. Start it again from Clients, Pipeline.';
export const SEARCH_TITLE = 'Find possible customers';

export type FindSourceView = {
  id: string; name: string; label: 'read' | 'planned'; line: string;
  /** Planned only: what it waits on, and the path until then. */
  waitsOn: string | null; meanwhile: string | null;
  /** Whether a search can use it now. A planned source the owner connected still runs, and says it is untried. */
  usable: boolean;
};
const UNTRIED = 'Built and tested against a sample server. Not tried on a live account yet.';
const MEANWHILE_MAP = 'Use the public map search, which needs nothing.';
/**
 * The path meanwhile where the plan's customers are not places on a map (seen on Windows, 15 Nov 2026: a lead tool's
 * row said "Use the public map search" right under the note that the map does not fit that business).
 */
export const MEANWHILE_NO_MAP = 'Add people you already know in Clients.';

/**
 * Every lead source with what it really does in this build: the public map (read), each lead tool the owner connected
 * (planned: it runs, and says it is untried), and each lead tool Chausar lists that is not connected yet (planned).
 * mapFits: false when the plan's customers are not places on a map (find-brief.ts planHasPlaces): then no row
 * recommends the map as the path meanwhile.
 */
export function sourceRows(saved: readonly { id: string; name: string }[], offered: readonly { id: string; name: string; about: string }[], options: { mapFits?: boolean } = {}): FindSourceView[] {
  const MEANWHILE = options.mapFits === false ? MEANWHILE_NO_MAP : MEANWHILE_MAP;
  return [
    { id: 'public-map', name: 'Public map', label: 'read', usable: true, waitsOn: null, meanwhile: null, line: 'Places on OpenStreetMap, and each one\'s own website for a contact email. Needs no account.' },
    ...saved.map((server): FindSourceView => ({ id: server.id, name: server.name, label: 'planned', usable: true, waitsOn: UNTRIED, meanwhile: MEANWHILE,
      line: 'You choose one of its tools and the exact inputs. It is called once, after you approve that call.' })),
    ...offered.map((entry): FindSourceView => ({ id: entry.id, name: entry.name, label: 'planned', usable: false, meanwhile: MEANWHILE,
      waitsOn: `Needs your own ${entry.name} account, added in Connections, MCP servers. Not tried on a live account yet.`, line: entry.about })),
  ];
}

/** What a search costs, in words. A figure is the rate card's own price words, passed in. */
export const COST = Object.freeze({
  free: 'It is free and needs no account.',
  checked: 'Chausar checked this tool: it only reads. No charge is known for it.',
  priced: (price: string, server: string): string => `It costs ${price}, the price on your rate card, paid from your ${server} account.`,
  unknown: (server: string): string => `Chausar does not know what ${server} charges. Anything it charges is on your account with it.`,
});

/**
 * The public map card's one sentence when no lead tool is connected. The app reads it too: a card that says it carries
 * the way to Connections beside the words (parts/LeadToolLink.tsx), so "you can add one" is never words alone.
 */
export const NO_TOOL_ON_CARD = 'No lead tool is connected; you can add one in Connections.';
/** The public map card: where it looks, that it is free, and one line when no lead tool is connected. */
export function publicCard(brief: FindBrief, tools: number): { title: string; line: string } {
  const words = briefWords(brief);
  return { title: words.title, line: `${words.looks} ${COST.free}${tools ? '' : ` ${NO_TOOL_ON_CARD}`} ${NOTHING_SENT}` };
}
/** A connected tool's card: the one call, what it costs, whose terms apply. */
export function connectedCard(brief: FindBrief, server: string, cost: string): { title: string; line: string } {
  const words = briefWords(brief, server);
  return { title: words.title, line: `${words.looks} ${cost} Its own terms apply to what it returns. ${NOTHING_SENT}` };
}

const count = (n: number, one: string, many: string) => (n === 1 ? `One ${one}` : `${n} ${many}`);
export type FindCounts = { found: number; withEmail: number; skipped: { known: number; blocked: number } };

/** What a finished search found, and what it left out. server: the connected tool's name, null for the public map. */
export function doneLine(brief: FindBrief, counts: FindCounts, server: string | null): string {
  const W = SEARCH_DONE_WORDS;
  const left = [
    counts.skipped.known ? byCount(counts.skipped.known, W.knownOne, W.knownMany) : '',
    counts.skipped.blocked ? byCount(counts.skipped.blocked, W.blockedOne, W.blockedMany) : '',
  ].filter(Boolean).join(' ');
  if (!counts.found) {
    const none = server
      ? `${fillWords(W.noneServer, { server })} ${W.needsName}`
      : `${fillWords(W.noneMap, { kind: kindWords(brief.category), place: brief.place })} ${W.mapGaps}`;
    return [none, left, W.nothingSent].filter(Boolean).join(' ');
  }
  const emails = counts.withEmail ? byCount(counts.withEmail, W.emailOne, W.emailMany) : W.emailNone;
  return [`${byCount(counts.found, W.foundOne, W.foundMany, { place: brief.place })} ${emails}`, left, `${W.inPipeline} ${W.nothingSent}`].filter(Boolean).join(' ');
}

/**
 * Round 6 (re-check 036): each sentence of a finished search's line, so the app says the line in the owner's language
 * sentence by sentence (app/ui/src/places/today/plan-words.ts); a {count}, a {place}, a {kind} or a {server} keeps its
 * words. A test holds the English pack to exactly these.
 */
export const SEARCH_DONE_WORDS = Object.freeze({
  foundOne: 'Found one possible customer in {place}.',
  foundMany: 'Found {count} possible customers in {place}.',
  emailOne: 'One has a contact email.',
  emailMany: '{count} have a contact email.',
  emailNone: 'None showed a contact email.',
  knownOne: 'One you already had was left out.',
  knownMany: '{count} you already had were left out.',
  blockedOne: 'One you may not write to was left out.',
  blockedMany: '{count} you may not write to were left out.',
  inPipeline: 'They are in Clients, Pipeline, each with its source.',
  nothingSent: 'Nothing was sent.',
  noneServer: '{server} answered with no new business Chausar could add.',
  needsName: 'Each one needs a name and a web page.',
  noneMap: 'Found no new {kind} in {place} on the public map.',
  mapGaps: 'Its listings have gaps, so try a nearby city, another kind of place or a lead tool.',
});
/** The sentence for one, or for many with the count in it. */
const byCount = (n: number, single: string, many: string, values: Readonly<Record<string, string>> = {}) => fillWords(n === 1 ? single : many, { ...values, count: n });

/** A connected call that may or may not have run. */
export const inDoubtLine = (server: string): string => `Check ${server} before searching again: the call may have run and may have been charged. Chausar will not run it again on its own.`;
/** What a search that stopped part way had already added. */
export const keptLine = (said: string, kept: number): string => (kept ? `${said} ${count(kept, 'possible customer was', 'possible customers were')} added to your pipeline.` : said);
/** Where a found lead came from, as the pipeline says it. */
export const foundSource = (source: string, server: string | undefined): string => (source === 'osm' ? 'OpenStreetMap' : server ?? 'A tool you connected');

/** A search's card waiting on Today, and one try of a search, as the list of searches reads them. */
export type SearchCard = { id: string; title: string; at: string; rowId: string };
export type SearchTry = { id: string; proposalId: string; state: Exclude<SearchState, 'proposed'>; title: string; line: string; at: string; found: number };
/**
 * The list of searches, newest first: one entry for each try, and none that is not one. Seen on Windows, 16 Nov 2026:
 * two tries that failed and a third entry, "On Today for your approval. Nothing has run.", for that same card put
 * back. A card that has been tried is told by its newest try, which carries the card's row while it waits on Today to
 * be tried again; a card nobody has tried yet is its own entry. The engine and the app's fake engine both list with this.
 */
/** A try as the runs list reads it: its card's agent (null: Chausar) and when it started (or was approved). */
export type OpenTry = { id: string; state: SearchState; title: string; line: string; startedAt: string; agent: string | null };
/**
 * The searches that are open now (approved or running), newest first, as the runs list carries them beside the runs
 * (round 5). One that ended is not listed. The engine and the app's fake engine both list with this.
 */
export function openSearchList(tries: readonly OpenTry[], nowIso: string): OpenSearchView[] {
  return tries.filter(item => searchOpen(item.state)).map(item => ({
    searchId: item.id, title: item.title, line: item.line, state: item.state as OpenSearchView['state'], agent: item.agent, startedAt: item.startedAt, elapsed: formatAge(item.startedAt, nowIso),
  })).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function searchList(cards: readonly SearchCard[], tries: readonly SearchTry[]): FindSearchView[] {
  const newest = new Map(tries.map(item => [item.proposalId, item.id]));
  const waiting = new Map(cards.map(card => [card.id, card]));
  const proposed: FindSearchView[] = cards.filter(card => !newest.has(card.id)).map(card => ({ id: card.id, state: 'proposed', title: card.title, line: PROPOSED_LINE, at: card.at, found: 0, proposalId: card.id, rowId: card.rowId }));
  const ran: FindSearchView[] = tries.map(item => {
    const back = newest.get(item.proposalId) === item.id && !searchOpen(item.state) ? waiting.get(item.proposalId) : undefined;
    return { id: item.id, state: item.state, title: item.title, line: item.line, at: item.at, found: item.found, proposalId: item.proposalId, rowId: back?.rowId ?? null };
  });
  return [...proposed, ...ran].sort((a, b) => b.at.localeCompare(a.at));
}
