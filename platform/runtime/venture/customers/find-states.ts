// Chausar finding customers: the states of one search and the only moves between them. This is the one place they
// are defined; the engine (find-search.ts, find-run.ts) and the app's fake engine both step through stepSearch.
//
//   proposed  the proposal is on Today (chief/proposals.ts). Nothing has run and no search record exists yet.
//   approved  the owner approved exactly this search; its record is opened in the same commit that claims the card.
//   running   the search is looking. A restart never leaves it here (find-search.ts recoverLeadSearches).
//   done      it finished; the leads it found are in the pipeline, each with its source. Nothing was sent.
//   failed    it stopped and nothing outside is in doubt: a refusal, a source that did not answer, or a restart
//             before any call that could have charged. It may be proposed again.
//   unknown   a call to a connected tool may or may not have run, and may have been charged. As the journal does
//             for any outside effect (journal/journal.ts), it is never run again on its own: the owner checks first.
//
// Pure: no store, no network and no Node imports.
import { check } from '../../portable.ts';

export const SEARCH_STATES = ['proposed', 'approved', 'running', 'done', 'failed', 'unknown'] as const;
export type SearchState = typeof SEARCH_STATES[number];

export const SEARCH_MOVES: Readonly<Record<SearchState, readonly SearchState[]>> = Object.freeze({
  proposed: ['approved'],
  approved: ['running', 'failed'],
  running: ['done', 'failed', 'unknown'],
  done: [],
  failed: [],
  unknown: [],
});
/** A search that has ended. Its record never changes state again. */
export const searchEnded = (state: SearchState): boolean => SEARCH_MOVES[state].length === 0;
/** A search whose leads may still be arriving: approved or running. */
export const searchOpen = (state: SearchState): boolean => state === 'approved' || state === 'running';

/** The one way a search changes state. Any move the table does not hold is refused (LEAD_SEARCH_STATE). */
export function stepSearch(from: SearchState, to: SearchState): SearchState {
  check((SEARCH_MOVES[from] ?? []).includes(to), 'LEAD_SEARCH_STATE', `A search that is ${from} cannot become ${to}.`);
  return to;
}

/** The lines a search carries that do not depend on what it found. */
export const SEARCH_LINES = Object.freeze({
  approved: 'Approved. The search is about to start.',
  running: 'Looking now. Nothing is sent.',
  stopped: 'Chausar stopped before this search finished. Nothing was sent and nothing was charged. Start it again when you like.',
  unknown: 'Chausar stopped during the call to your connected tool. Check that tool before searching again: the call may have run and may have been charged. Chausar will not run it again on its own.',
});
