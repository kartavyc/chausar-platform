// Chausar finding customers: what the engine methods answer (find-methods.ts), as the Pipeline tab reads them. Types
// only, with no engine imports, so the app and its fake engine use these same shapes.
import type { FindBrief } from './find-brief.ts';
import type { SearchState } from './find-states.ts';
import type { FindSourceView } from './find-words.ts';

/**
 * One try of a search as the Pipeline tab lists it. A proposed one is a card on Today nobody has tried yet (rowId),
 * with no record. A try that ended and whose card is back on Today carries that card's row too, so the owner can go
 * there and try again; every other try has none. at: when it was approved (for a proposed one, when it was raised).
 */
export type FindSearchView = { id: string; state: SearchState; title: string; line: string; at: string; found: number; proposalId: string; rowId: string | null };
/**
 * Round 5 (re-check 028): a search Chausar runs on an approved card, as Today's Working now and Team at work list it
 * beside the runs while it is open (venture.runs.list searches). agent: the agent its card named, or null when
 * Chausar itself does it. startedAt: when it started looking (or was approved, before that); elapsed: its time so far,
 * in the words every run uses. A search counts nothing until it ends, so it carries no progress.
 */
export type OpenSearchView = { searchId: string; title: string; line: string; state: 'approved' | 'running'; agent: string | null; startedAt: string; elapsed: string };
/** One lead a search found, with where it came from. */
export type FoundLeadView = { leadId: string; name: string; email: string | null; sourceUrl: string; source: string; licence: string; searchId: string };
/** venture.leads.find.view */
export type FindCustomersView = {
  /** Whether what is sold is ready (core/way-ready.ts), and what is still missing, in order. */
  ready: boolean; missing: string[];
  /** While it is not ready: the gate's own refusal, in owner words. Null once it is. */
  gate: string | null;
  /** The brief Chausar offers, from the kept way to earn, for the owner to finish. */
  brief: FindBrief;
  kinds: { tag: string; label: string }[];
  sources: FindSourceView[];
  /** One line when no lead tool is connected, else null. */
  note: string | null;
  /**
   * One line when the plan's customers are not places a map could list (people, channels, online businesses): the
   * public map lists places only, and what to do meanwhile. Null when they are places, or when no way is kept.
   */
  mapNote: string | null;
  searches: FindSearchView[];
  found: FoundLeadView[];
};
/** venture.leads.find.propose: the card now on Today, in the words the owner approves. P: the proposal as its side keeps it. */
export type FindProposedOf<P> = { proposal: P; rowId: string; title: string; line: string };
/** venture.leads.find.tools */
export type FindToolsView = { serverId: string; tools: { name: string; description: string; approval: 'checked-read-only' | 'every-call' }[] };
