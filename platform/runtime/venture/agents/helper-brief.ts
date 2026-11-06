// Chausar venture launcher, agents (Ink v2 wave 4, package 4J12, catalogue H25): what code adds to every helper brief,
// after the brief's own words: a return cap and a spend line. Agent-to-agent orders and handovers (agents/relay.ts)
// and the brief for the owner's own command-line tool (delivery/harness/delegate.ts) both carry it. No other imports,
// so the harness can use it without loading the agents package. The idea follows agent-harness's brief guard.
import { formatMicros } from '../records.ts';

/** The return cap every helper brief ends with. */
export const HELPER_RETURN_CAP = 'Return at most 400 words: the result in your first sentence, then what you checked and what is still open. End with done, blocked, failed or needs_decision.';

/**
 * A helper brief: its own words, then the return cap and the spend line. spend: what the task has spent and its cap,
 * in micro units; null for a tool with no spending limit of its own (the time limit bounds it then).
 */
export function helperBrief(brief: string, spend: { spentMicros: string; capMicros: string } | null): string {
  const line = spend
    ? `Spent so far on this task: ${formatMicros(spend.spentMicros)} of the ${formatMicros(spend.capMicros)} cap. Stop and report blocked before you would pass it.`
    : 'This tool has no spending limit of its own, so stop and report blocked when the time limit is near.';
  return `${brief}\n\n${HELPER_RETURN_CAP}\n${line}`;
}
