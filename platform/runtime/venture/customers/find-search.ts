// Chausar finding customers, for every business: the record of one search (venture-lead-search) and the only code
// that writes it. Its states and moves are defined in find-states.ts; every change here goes through stepSearch.
// - openSearch: in the same commit that claims the approved card (chief/proposals.ts), so an approval and its search
//   are never apart. One card opens at most one search at a time.
// - moveSearch: the run's own steps (find-run.ts).
// - recoverLeadSearches: after a restart or a long quiet spell, wired into the journal sweep (build/journal-sweep.ts).
//   A search still approved or running is ended: unknown when its call to a connected tool may have run (the journal
//   entry says so), else failed, keeping the leads that had already been added. Its card then says what happened.
// The record holds the brief, counts and lead ids only. A lead's name and address live on the lead, so Forget of a
// person leaves nothing of them here.
import { check, type Context, type State } from '../../contracts.ts';
import type { IsoTime, LeadSearchRecord, ProposalRecord, ProposalView, VentureDeps } from '../contracts.ts';
import { currentVenture, listRecords, ventureAction, type VentureTx } from '../records.ts';
import type { FindBrief } from './find-brief.ts';
import type { FindPin } from './find-target.ts';
import type { FindProposedOf, OpenSearchView } from './find-types.ts';
import { openSearchList, SEARCH_TITLE } from './find-words.ts';
import { searchOpen, stepSearch, SEARCH_LINES, type SearchState } from './find-states.ts';

export type LeadSearchBody = {
  proposalId: string;
  brief: FindBrief;
  pin: FindPin | null;
  /** Never 'proposed': a record exists only from the owner's approval on. */
  state: Exclude<SearchState, 'proposed'>;
  /** Where it stands, in owner words. */
  line: string;
  startedAt: IsoTime | null;
  endedAt: IsoTime | null;
  found: number;
  withEmail: number;
  skipped: { known: number; blocked: number };
  leadIds: string[];
  /** The journal entry of its call to a connected tool, once that call is claimed. */
  journalId: string | null;
  /** The spend key of that call, when it has a price. */
  spendKey: string | null;
};

/** venture.leads.find.propose, with the proposal as the engine shows it. The other answers are find-types.ts. */
export type FindProposed = FindProposedOf<ProposalView>;
export type { FindCustomersView, FindSearchView, FindToolsView, FoundLeadView } from './find-types.ts';

/** The searches of one business, oldest first. */
export const searchesOf = (state: State, ventureId: string): LeadSearchRecord[] => listRecords(state, 'venture-lead-search', ventureId);

/** The searches open now, as the runs list carries them (round 5): each with its card's title and agent. */
export function openSearchesOf(state: State, ventureId: string, nowIso: string): OpenSearchView[] {
  const cards = new Map(listRecords(state, 'venture-proposal', ventureId).map(item => [item.id, item]));
  return openSearchList(searchesOf(state, ventureId).map(item => ({
    id: item.id, state: item.state, title: cards.get(item.proposalId)?.title ?? SEARCH_TITLE, line: item.line, startedAt: item.startedAt ?? item.at, agent: cards.get(item.proposalId)?.agent ?? null,
  })), nowIso);
}

/**
 * Opens the search of an approved card, inside the commit that claims it: proposed becomes approved. Refused
 * (LEAD_SEARCH_STATE) while an earlier search of the same card is still approved or running.
 */
export function openSearch(tx: VentureTx, proposal: ProposalRecord): LeadSearchRecord {
  check(!tx.list('venture-lead-search').some(item => item.proposalId === proposal.id && searchOpen(item.state)), 'LEAD_SEARCH_STATE', 'This search is already under way.');
  const input = proposal.input as { brief: FindBrief; pin: FindPin | null };
  return tx.put<LeadSearchRecord>({
    ...tx.base('venture-lead-search'), proposalId: proposal.id, brief: structuredClone(input.brief), pin: structuredClone(input.pin ?? null),
    state: stepSearch('proposed', 'approved') as 'approved', line: SEARCH_LINES.approved, startedAt: null, endedAt: null,
    found: 0, withEmail: 0, skipped: { known: 0, blocked: 0 }, leadIds: [], journalId: null, spendKey: null,
  });
}

export type SearchPatch = Partial<Pick<LeadSearchBody, 'line' | 'found' | 'withEmail' | 'skipped' | 'leadIds' | 'journalId' | 'spendKey'>>;

/** Moves a search to its next state inside a transaction, through the one table of moves. */
export function moveSearchIn(tx: VentureTx, id: string, to: Exclude<SearchState, 'proposed'>, patch: SearchPatch = {}): LeadSearchRecord {
  const record = tx.find('venture-lead-search', id);
  check(record, 'LEAD_SEARCH_NOT_APPROVED', 'That search was not found.');
  const state = stepSearch(record.state, to) as LeadSearchBody['state'];
  return tx.replace<LeadSearchRecord>({
    ...record, ...patch, state,
    ...(state === 'running' ? { startedAt: tx.now } : {}),
    ...(searchOpen(state) ? {} : { endedAt: tx.now }),
  });
}

/** moveSearchIn in its own commit, announced so an open Pipeline tab reads it again. */
export function moveSearch(deps: VentureDeps, ctx: Context, id: string, to: Exclude<SearchState, 'proposed'>, patch: SearchPatch = {}): Promise<LeadSearchRecord> {
  return ventureAction(deps, ctx, 'prepare', 'leads.find.step', tx => {
    const moved = moveSearchIn(tx, id, to, patch);
    tx.emit('pipeline.changed', {});
    return moved;
  });
}

/** Notes something on a search without changing its state (the journal entry of its call, once claimed). */
export function noteSearch(deps: VentureDeps, ctx: Context, id: string, patch: SearchPatch): Promise<void> {
  return ventureAction(deps, ctx, 'prepare', 'leads.find.note', tx => {
    const record = tx.find('venture-lead-search', id);
    if (record) tx.replace<LeadSearchRecord>({ ...record, ...patch });
  });
}

/** The leads a search has added so far, read from their source records: exact even when the search never finished. */
export function leadsOfSearch(state: State, ventureId: string, searchId: string): string[] {
  return listRecords(state, 'venture-lead-source', ventureId).filter(source => source.searchId === searchId && source.leadId).map(source => source.leadId!);
}

/**
 * Ends every search a restart or a long quiet spell left approved or running, so none sticks. claimLimitMs: how long a
 * search may run before it counts as interrupted (one millisecond when a vault opens: whatever was running then is
 * gone). Returns the searches that moved. The journal is swept first, so an interrupted call already reads unknown.
 */
export async function recoverLeadSearches(deps: VentureDeps, ctx: Context, claimLimitMs: number): Promise<LeadSearchRecord[]> {
  const nowMs = deps.clock().getTime();
  const stale = (record: LeadSearchRecord) => searchOpen(record.state) && nowMs - Date.parse(record.startedAt ?? record.at) >= claimLimitMs;
  const venture = currentVenture(deps.store.read());
  if (!venture || !searchesOf(deps.store.read(), venture.id).some(stale)) return [];
  return ventureAction(deps, ctx, 'prepare', 'leads.find.recover', tx => {
    const moved: LeadSearchRecord[] = [];
    for (const record of tx.list('venture-lead-search').filter(stale)) {
      const entry = record.journalId ? tx.find('venture-journal-entry', record.journalId) : undefined;
      // A claimed call whose end was never written may have run: the journal's own rule, never run again on its own.
      const inDoubt = !!entry && (entry.state === 'outcome_unknown' || (entry.state === 'approved' && !!entry.claimedAt));
      const leadIds = leadsOfSearch(tx.state, record.ventureId, record.id);
      const kept = leadIds.length ? ` ${leadIds.length === 1 ? 'One possible customer was' : `${leadIds.length} possible customers were`} already added to your pipeline.` : '';
      const line = `${inDoubt ? SEARCH_LINES.unknown : SEARCH_LINES.stopped}${kept}`;
      // approved can only fail (find-states.ts): nothing had started, so nothing is in doubt.
      const to = record.state === 'running' && inDoubt ? 'unknown' : 'failed';
      const ended = moveSearchIn(tx, record.id, to, { line, leadIds, found: leadIds.length });
      moved.push(ended);
      const proposal = tx.find('venture-proposal', record.proposalId);
      if (proposal && proposal.status === 'approved') tx.replace<ProposalRecord>({ ...proposal, outcome: line });
    }
    if (moved.length) { tx.emit('pipeline.changed', {}); tx.emit('queue.changed', {}); }
    return moved;
  });
}
