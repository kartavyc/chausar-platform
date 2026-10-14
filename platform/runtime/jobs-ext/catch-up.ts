/**
 * The written catch-up rule for runs missed while the computer slept, and the schedule view.
 *
 *  - skip: missed runs are skipped; the job waits for its next slot.
 *  - once: run once on wake (the default), however many were missed.
 *  - all:  run every missed one, one after another, up to ALL_CAP; any beyond that are skipped and said.
 *
 * `skip` and `once` map onto JobService's own `skip` and `latest` catch-up policies. `all` runs as
 * `latest` and this lane keeps a backlog that brings the next run forward until it is drained.
 */
import { check } from '../contracts.ts';
import type { MissedRule } from './state.ts';

export const ALL_CAP = 7;
export const MISSED_RULES: readonly MissedRule[] = ['skip', 'once', 'all'];

export function validRule(value: unknown): MissedRule {
  check(typeof value === 'string' && (MISSED_RULES as readonly string[]).includes(value), 'INVALID_MISSED_RULE', 'Choose skip, run once on wake, or run every missed one.');
  return value as MissedRule;
}

export const coreCatchup = (rule: MissedRule): 'skip' | 'latest' => rule === 'skip' ? 'skip' : 'latest';

/** How many due runs were missed at `now`. Within the grace period a run is on time, not missed. */
export function dueRuns(nextRunAt: string, intervalMs: number, graceMs: number, now: number): number {
  const due = Date.parse(nextRunAt);
  if (!Number.isFinite(due) || now < due) return 0;
  return Math.floor((now - due) / intervalMs) + 1;
}

export type CatchUpDecision = { due: number; missed: number; ran: number; skipped: number; backlog: number; text: string };

/** What the rule does with `due` runs found on wake. `missed` counts only late runs beyond the grace. */
export function decide(rule: MissedRule, nextRunAt: string, intervalMs: number, graceMs: number, now: number): CatchUpDecision {
  const due = dueRuns(nextRunAt, intervalMs, graceMs, now);
  const late = due > 0 && now - Date.parse(nextRunAt) > graceMs;
  if (!late) return { due, missed: 0, ran: due > 0 ? 1 : 0, skipped: 0, backlog: 0, text: '' };
  const runs = (n: number) => n === 1 ? '1 run was' : `${n} runs were`;
  if (rule === 'skip') return { due, missed: due, ran: 0, skipped: due, backlog: 0, text: `${runs(due)} missed while this computer slept. Skipped by your rule; the job waits for its next time.` };
  if (rule === 'once') return { due, missed: due, ran: 1, skipped: due - 1, backlog: 0, text: `${runs(due)} missed while this computer slept. Ran once.` };
  const ran = Math.min(due, ALL_CAP);
  return { due, missed: due, ran, skipped: due - ran, backlog: ran - 1,
    text: `${runs(due)} missed while this computer slept. Running ${ran === 1 ? 'it' : `${ran} of them`} one after another${due > ran ? `; ${due - ran} older ones were skipped (at most ${ALL_CAP} catch up)` : ''}.` };
}

/** The first slot strictly after `now`, counted from the schedule's anchor. */
export function nextSlot(anchor: string, intervalMs: number, now: number): string {
  const start = Date.parse(anchor); check(Number.isFinite(start) && intervalMs > 0, 'INVALID_SCHEDULE', 'The schedule needs an anchor and an interval.');
  if (now < start) return new Date(start).toISOString();
  return new Date(start + (Math.floor((now - start) / intervalMs) + 1) * intervalMs).toISOString();
}

/** The next runs of a schedule, bounded by its stop rule. */
export function upcoming(nextRunAt: string, intervalMs: number, deadline: string, remainingRuns: number, count = 5): string[] {
  const out: string[] = []; const end = Date.parse(deadline); let at = Date.parse(nextRunAt);
  while (out.length < Math.min(count, Math.max(0, remainingRuns)) && Number.isFinite(at) && at < end) { out.push(new Date(at).toISOString()); at += intervalMs; }
  return out;
}

/** Core jobs record skipped catch-ups in their ledger; read them back for jobs this lane does not run. */
export function ledgerMissed(ledger: { at: string; event: string; reason?: string }[]): { at: string; missed: number }[] {
  return ledger.filter(entry => entry.event === 'catchup-skipped').map(entry => ({ at: entry.at, missed: Number(/^(\d+) due runs skipped$/.exec(entry.reason ?? '')?.[1] ?? 0) })).filter(item => item.missed > 0);
}
