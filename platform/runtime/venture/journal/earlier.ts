// Chausar venture launcher, journal: venture.earlier.list { limit? } (read), what happened in the open business as
// Today's Earlier shows it (round 6, re-check 026). It reads the action journal, the decision record and the searches
// for possible customers, and lists them with journal/earlier-list.ts, which says why and how. A read: no token, no digest.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import type { VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, exactPayload, listRecords } from '../records.ts';
import { journalEntries, JOURNAL_LIST_MAX } from './list.ts';
import { decisionViews } from './decisions.ts';
import { searchesOf } from '../customers/find-search.ts';
import { SEARCH_TITLE } from '../customers/find-words.ts';
import { EARLIER_DEFAULT, EARLIER_MAX, earlierList, type EarlierEntry, type EndedSearch } from './earlier-list.ts';

/** Each search that ended, with its card's title (the same title the runs list gives it, customers/find-search.ts). */
function endedSearches(state: State, venture: VentureRecord): EndedSearch[] {
  const cards = new Map(listRecords(state, 'venture-proposal', venture.id).map(item => [item.id, item]));
  return searchesOf(state, venture.id).map(item => ({
    id: item.id, proposalId: item.proposalId, state: item.state, title: cards.get(item.proposalId)?.title ?? SEARCH_TITLE, line: item.line, endedAt: item.endedAt, at: item.at,
  }));
}

/** The newest things that happened in the open business, as this reader sees the decisions. */
export function earlierEntries(state: State, reader: string | null, limit = EARLIER_DEFAULT): EarlierEntry[] {
  const venture = currentVenture(state);
  if (!venture) return [];
  return earlierList({
    journal: journalEntries(state, Math.min(limit, JOURNAL_LIST_MAX)),
    decisions: decisionViews(state, venture, reader, { effects: false }),
    searches: endedSearches(state, venture),
  }, limit);
}

/** venture.earlier.list { limit? } (read): outside effects, decisions and ended searches, newest first. */
export async function earlierListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ entries: EarlierEntry[] }> {
  const body = exactPayload(payload ?? {}, ['limit']);
  check(body.limit === undefined || (Number.isInteger(body.limit) && (body.limit as number) >= 1 && (body.limit as number) <= EARLIER_MAX),
    'INVALID_VENTURE_REQUEST', `limit must be a whole number from 1 to ${EARLIER_MAX}.`);
  authorize(deps.store, ctx);
  return { entries: earlierEntries(deps.store.read(), ctx.memberId, (body.limit as number | undefined) ?? EARLIER_DEFAULT) };
}
