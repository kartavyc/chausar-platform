// Chausar venture launcher: the sweep of the whole action journal, which the engine runs when a vault opens and on its
// scheduler tick (venture/host.ts, sweepJournal). A claim older than any effect could take may or may not have
// happened, so it becomes outcome_unknown and is never run again on its own; an approval that ran out unused, and a
// proposal nobody decided in time, are rejected. Posts go first, at their own shorter limit and in posting words. A
// website edit its sweep left half way is marked needs-inspection, with the original kept.
import type { Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { actionOf, JOURNAL_ACTIONS, sweepJournal, withCheck, type Journalled } from '../journal/journal.ts';
import { postingName, sweepStaleClaims } from './posting.ts';
import { inspectInterruptedEdits } from './site-edits.ts';

/** The longest any journalled effect may take before its claim counts as interrupted: a turn on the owner's AI with its tools. */
export const JOURNAL_CLAIM_LIMIT_MS = 30 * 60_000;

/** Sweeps every kind of journalled effect of the open business. Returns what moved. */
export async function sweepWholeJournal(deps: VentureDeps, ctx: Context, claimLimitMs: number = JOURNAL_CLAIM_LIMIT_MS): Promise<Journalled[]> {
  const posts = await sweepStaleClaims(deps, ctx);
  const rest = await sweepJournal(deps, ctx, {
    claimLimitMs,
    unknownLine: record => record.kind === 'venture-connector-post'
      ? `Chausar stopped while posting. Check ${postingName(record.connectorId)} before posting again: the post may have gone out. Chausar will not send it again.`
      : withCheck(`${JOURNAL_ACTIONS[actionOf(record)].label} was under way when Chausar stopped.`),
  });
  // A site entry's subject is '<edit id>.<applied or rolled-back>'.
  const edits = rest.flatMap(record => record.kind === 'venture-journal-entry' && record.action === 'site.apply' && record.state === 'outcome_unknown'
    ? [record.subject.slice(0, Math.max(0, record.subject.lastIndexOf('.')))] : []);
  await inspectInterruptedEdits(deps, ctx, edits.filter(Boolean));
  return [...posts, ...rest];
}
