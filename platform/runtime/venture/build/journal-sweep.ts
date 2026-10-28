// Chausar venture launcher: the sweep of the whole action journal, which the engine runs when a vault opens and on its
// scheduler tick (venture/host.ts, sweepJournal). A claim older than any effect could take may or may not have
// happened, so it becomes outcome_unknown and is never run again on its own; an approval that ran out unused, and a
// proposal nobody decided in time, are rejected. Posts go first, at their own shorter limit and in posting words. A
// website edit its sweep left half way is marked needs-inspection, with the original kept. Each sweep then writes
// Keeper's runs of the engine's own jobs (views/keeper.ts), so Team shows when each last ran and what it found.
import type { Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { actionOf, JOURNAL_ACTIONS, sweepJournal, withCheck, type Journalled } from '../journal/journal.ts';
import { postingName, sweepStaleClaims } from './posting.ts';
import { inspectInterruptedEdits } from './site-edits.ts';
import { recordKeeperFailure, recordKeeperRuns } from '../views/keeper.ts';
import { reworkTiesDaily } from '../network/strength.ts';
import { readCalendarFeedDaily } from '../network/calendar-feed.ts';
import { settleInbound } from '../network/inbound-rows.ts';
import { runMoneySchedules } from '../money/recurring.ts';

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
  const moved = [...posts, ...rest];
  // Keeper (Ink v2 wave 4, 4A1): this tick's runs of the engine's own jobs, the sweep's among them. A failure to
  // write them never undoes the sweep: it is recorded as a failed run on Keeper's card, and if even that cannot be
  // written (the vault is closing), the card keeps the run before, never one that has no record.
  try {
    await recordKeeperRuns(deps, ctx, moved);
  } catch (error) {
    await recordKeeperFailure(deps, ctx, error).catch(() => { /* Nothing more can be written now; the sweep stands. */ });
  }
  await reworkTiesDaily(deps, ctx); // 4D2: once a day, every tie worked out again as they fade (records its own failure)
  await readCalendarFeedDaily(deps, ctx); // 4E3: each morning, the owner's calendar address read again (records its own failure)
  await import('./monitors.ts').then(module => module.checkMonitorsDue(deps, ctx)).catch(() => undefined); // 5A6 (K16): due page monitors (never throws)
  await import('../playbooks/seo-visibility/monitor-desk.ts').then(module => module.runSeoMonitorsDue(deps, ctx)).catch(() => undefined); // 5E1: exact-approved bounded evidence collection
  await import('../playbooks/seo-visibility/site-recheck.ts').then(module => module.runWebsiteRechecksDue(deps, ctx)).catch(() => undefined); // 5E1: approved installed website re-checks
  await import('../playbooks/social/scheduled.ts').then(module => module.runSocialScheduledDue(deps, ctx)).catch(() => undefined); // 5D1 S12: exact approved single slots
  await settleInbound(deps, ctx); // 4E3: replies whose row can no longer be are marked processed, so unread means unread
  await runMoneySchedules(deps, ctx); // 4J5: recurring invoices and bills due today, or missed, drafted (never throws)
  await import('../agents/routine-runner.ts').then(module => module.routineTick(deps, ctx, claimLimitMs)).catch(() => undefined); // 4J13: leases, timed questions, routines (never throws)
  // 4G2: Keeper's needs-you checks (recordProbeRuns never throws); a probes file that cannot even load is recorded as
  // a failed Keeper run, not swallowed, and the sweep stands.
  await import('../views/probes.ts').then(module => module.recordProbeRuns(deps, ctx))
    .catch(error => recordKeeperFailure(deps, ctx, error).catch(() => { /* Nothing more can be written now. */ }));
  return moved;
}
