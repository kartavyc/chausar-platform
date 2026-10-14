import { check } from '../contracts.ts';

/**
 * Connector refresh. Each connected source may carry a schedule: which read, how often, the
 * freshness target, and what to do with a run missed while the computer slept. Only reads whose
 * recipe checks a source-declared total may be scheduled; a read waiting for a person's report
 * total would only pile up. Imports still wait for a person unless `autoImport` was chosen.
 */
export type Schedule = {
  operation: string; everyHours: number; freshnessTargetHours: number;
  /** `run-once`: a missed slot runs once when the computer wakes, never once per missed slot. `skip`: wait for the next slot. */
  catchUp: 'run-once' | 'skip';
  autoImport: boolean;
  lastRunAt: string | null; lastOutcome: string | null; runs: { day: string; count: number };
};
export const SCHEDULE_LIMITS = Object.freeze({ minHours: 1, maxHours: 24 * 31, runsPerConnectionPerDay: 24, readsPerTick: 3 });

export function validateSchedule(input: Record<string, unknown>): Pick<Schedule, 'operation' | 'everyHours' | 'freshnessTargetHours' | 'catchUp' | 'autoImport'> {
  const { operation, everyHours, freshnessTargetHours, catchUp, autoImport } = input as any;
  check(typeof operation === 'string' && /^[a-z][a-z0-9-]{1,60}$/.test(operation), 'SCHEDULE_INVALID', 'Choose the read to repeat.');
  check(Number.isSafeInteger(everyHours) && everyHours >= SCHEDULE_LIMITS.minHours && everyHours <= SCHEDULE_LIMITS.maxHours, 'SCHEDULE_INVALID', 'Repeat between every hour and once a month.');
  check(Number.isSafeInteger(freshnessTargetHours) && freshnessTargetHours >= everyHours && freshnessTargetHours <= SCHEDULE_LIMITS.maxHours * 2, 'SCHEDULE_INVALID', 'The freshness target is at least the repeat interval.');
  check(catchUp === 'run-once' || catchUp === 'skip', 'SCHEDULE_INVALID', 'Choose whether a missed read runs once on waking or waits for the next slot.');
  check(autoImport === undefined || typeof autoImport === 'boolean', 'SCHEDULE_INVALID', 'Say whether accepted reads import on their own.');
  return { operation, everyHours, freshnessTargetHours, catchUp, autoImport: autoImport === true };
}

export type Decision = { action: 'run' | 'wait' | 'skip-missed' | 'budget'; reason: string };
/** Pure decision for one connection at one instant. */
export function decide(schedule: Schedule, nowMs: number): Decision {
  const day = new Date(nowMs + 19_800_000).toISOString().slice(0, 10);
  if (schedule.runs.day === day && schedule.runs.count >= SCHEDULE_LIMITS.runsPerConnectionPerDay) return { action: 'budget', reason: 'daily-read-budget' };
  if (schedule.lastRunAt === null) return { action: 'run', reason: 'first-run' };
  const interval = schedule.everyHours * 3_600_000, last = Date.parse(schedule.lastRunAt);
  if (nowMs < last + interval) return { action: 'wait', reason: 'not-due' };
  if (nowMs >= last + 2 * interval && schedule.catchUp === 'skip') return { action: 'skip-missed', reason: 'missed-slot-skipped' };
  return { action: 'run', reason: nowMs >= last + 2 * interval ? 'missed-slot-run-once' : 'due' };
}
export function stale(lastRead: string | null, schedule: Pick<Schedule, 'freshnessTargetHours'> | null, nowMs: number): boolean | null {
  if (!schedule) return null;
  return lastRead === null || nowMs - Date.parse(lastRead) > schedule.freshnessTargetHours * 3_600_000;
}
export function recordRun(schedule: Schedule, nowMs: number, outcome: string): void {
  const day = new Date(nowMs + 19_800_000).toISOString().slice(0, 10);
  schedule.lastRunAt = new Date(nowMs).toISOString(); schedule.lastOutcome = outcome;
  schedule.runs = schedule.runs.day === day ? { day, count: schedule.runs.count + 1 } : { day, count: 1 };
}
