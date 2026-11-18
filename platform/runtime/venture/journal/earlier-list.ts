// Chausar venture launcher, journal: what Today's Earlier lists (round 6, re-check 026). Earlier read only the action
// journal, which holds outside effects, so after the plan was accepted, the prices were set and a search had found 10
// possible customers it still said "Nothing has happened yet." It now lists three of the engine's own records, newest
// first, each in the words that record already holds; nothing is inferred and nothing is made up:
// - every outside effect, as the journal lists it (journal/list.ts journalEntries);
// - every decision, as the decision record lists it (journal/decisions.ts decisionViews), leaving out the steps of
//   outside effects, which the journal's own line already stands for;
// - each search for possible customers that ended, with its card's title and its own line (customers/find-search.ts).
// Round 7 (re-check 6, item 4): Earlier is what happened in the business, so a settings switch (the daily review on or
// off, its time) is left out: Routines and Settings keep those. And an approved search is one entry: the search's own
// ended line, not also the approval that started it. A search still running keeps its approval, and two different
// things are never merged into one.
// The engine (journal/earlier.ts) and the app's fake engine both list with this one function.
//
// Pure: no store, no network and no Node imports.
import type { SearchState } from '../customers/find-states.ts';

// The fields read here, from contracts.ts JournalEntry and DecisionView, declared here so the app reads this file
// without the engine's contracts.
type Display = string;
type IsoTime = string;
type JournalState = 'described' | 'approved' | 'applied' | 'rejected' | 'outcome_unknown';
type JournalLine = { id: string; action: string; target: string; state: JournalState; at: IsoTime; line: Display; receiptId?: string };
type DecisionLine = { id: string; at: IsoTime; subject: string; action: string; line: Display };

export const EARLIER_DEFAULT = 6;
export const EARLIER_MAX = 50;

/** One thing that happened in the business, as Today's Earlier shows it. */
export type EarlierEntry = {
  id: string; at: IsoTime;
  /** The record it comes from: the action journal, the decision record, or a search for possible customers. */
  from: 'journal' | 'decision' | 'search';
  title: Display;
  /** The record's own line under the title; null when the title already says it all (a decision). */
  line: Display | null;
  /** Where it stands, in the journal's states: done, said no or stopped, or waiting on the owner's check. */
  state: JournalState;
  receiptId?: string;
};

/** A search for possible customers that has ended, as Earlier needs it. */
export type EndedSearch = { id: string; proposalId: string | null; state: SearchState; title: string; line: string; endedAt: IsoTime | null; at: IsoTime };

/**
 * The decisions that switch a setting, by subject: the daily review (chief/plan-view.ts REVIEW_OFFER_SUBJECT), the CA
 * pack's schedule, the AI tools' configuration and an AI setup reused from another business. Earlier leaves them out.
 */
export const SETTING_SUBJECTS: readonly string[] = Object.freeze(['review:daily', 'ca-pack:schedule']);
export const SETTING_SUBJECT_PREFIXES: readonly string[] = Object.freeze(['mcp-configuration:', 'ai-setup:']);
/** A proposal card's decision subject (chief/gate.ts proposalSubject). */
export const PROPOSAL_SUBJECT = 'proposal:';

const isSetting = (subject: string) => SETTING_SUBJECTS.includes(subject) || SETTING_SUBJECT_PREFIXES.some(prefix => subject.startsWith(prefix));

/** A decision that said no reads as one; every other decision happened. */
const NO_ACTIONS: ReadonlySet<string> = new Set(['deny', 'reject', 'rejected', 'decline', 'dismiss', 'not-sent']);
const SEARCH_STATE: Readonly<Partial<Record<SearchState, JournalState>>> = Object.freeze({ done: 'applied', failed: 'rejected', unknown: 'outcome_unknown' });

/**
 * The newest `limit` things that happened: outside effects, decisions (the steps of outside effects left out by the
 * caller, settings switches and the approval of a listed search left out here) and ended searches, newest first. Equal
 * times keep the order given.
 */
export function earlierList(input: { journal: readonly JournalLine[]; decisions: readonly DecisionLine[]; searches: readonly EndedSearch[] }, limit = EARLIER_DEFAULT): EarlierEntry[] {
  // The cards whose search ended and is listed: the approval of each is that search's own entry.
  const listedCards = new Set(input.searches.flatMap(search => (search.proposalId && SEARCH_STATE[search.state] ? [`${PROPOSAL_SUBJECT}${search.proposalId}`] : [])));
  const decisions = input.decisions.filter(decision => !isSetting(decision.subject) && !listedCards.has(decision.subject));
  const entries: EarlierEntry[] = [
    ...input.journal.map((entry): EarlierEntry => ({
      id: entry.id, at: entry.at, from: 'journal', title: `${entry.action} · ${entry.target}`, line: entry.line, state: entry.state,
      ...(entry.receiptId ? { receiptId: entry.receiptId } : {}),
    })),
    ...decisions.map((decision): EarlierEntry => ({
      id: decision.id, at: decision.at, from: 'decision', title: decision.line, line: null, state: NO_ACTIONS.has(decision.action) ? 'rejected' : 'applied',
    })),
    ...input.searches.flatMap((search): EarlierEntry[] => {
      const state = SEARCH_STATE[search.state];
      return state ? [{ id: search.id, at: search.endedAt ?? search.at, from: 'search', title: search.title, line: search.line, state }] : [];
    }),
  ];
  return entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.at < b.entry.at ? 1 : a.entry.at > b.entry.at ? -1 : a.index - b.index))
    .slice(0, limit)
    .map(({ entry }) => entry);
}
