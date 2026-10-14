/**
 * Month-end on the calendar (WK-11). The core runs calendar schedules only for a typed job (one
 * with a core plan) and only when the engine was started with time-zone rules
 * (`EngineOptions.jobCalendar`); the read-only `owner-brief` refuses a calendar. So the
 * month-end brief on the calendar is a typed `calculation-set` job: on the last day of each
 * month at 18:00 India time it works out, through the published `aging` calculation, what
 * customers owe, with its receipt. When the engine has no typed runner or no calendar rules,
 * this refuses `CALENDAR_SCHEDULE_UNAVAILABLE`; "every 30 days" stays a separate, labelled
 * choice the person makes.
 */
import { check, ChausarError } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import { sourceAccess } from '../actions.ts';
import type { CalendarDefinition } from '../calendar.ts';
import type { ModuleHost } from '../modules/types.ts';
import { isoAt } from './work-queue.ts';
import { SKIP_GRACE_MS } from './work-jobs-edit.ts';

export const MONTH_END = Object.freeze({ timeZone: 'Asia/Kolkata', at: '18:00', operation: 'aging', stepReserveMinor: '1', stepMs: 60_000 });
const DAY = 86_400_000;
type MissedRun = 'skip' | 'run-once-on-wake';
type CalendarInfo = { configured: true; rulesRevision: string; minYear: number; maxYear: number; bounds: { maxNominalSlots: number; maxCalendarDays: number } };
const UNAVAILABLE = 'CALENDAR_SCHEDULE_UNAVAILABLE';
const unavailable = () => new ChausarError(UNAVAILABLE, 'Month-end on the calendar is not available here. Choose every 30 days instead, or wait for calendar rules.');

/** What the core says it can schedule, or null when it cannot schedule a typed job on the calendar. */
export async function calendarInfo(host: ModuleHost): Promise<CalendarInfo | null> {
  let types: any;
  try { types = await host.call('jobs.types', {}); } catch { return null; }
  const c = types?.calendar;
  if (!types?.configured || !Array.isArray(types.types) || !types.types.includes('calculation-set') || !c || c.configured !== true) return null;
  if (typeof c.rulesRevision !== 'string' || !Number.isSafeInteger(c.minYear) || !Number.isSafeInteger(c.maxYear) || !Number.isSafeInteger(c.bounds?.maxNominalSlots) || !Number.isSafeInteger(c.bounds?.maxCalendarDays)) return null;
  return c as CalendarInfo;
}

/** The civil date in India at an instant (no daylight saving there). */
export const indiaDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: MONTH_END.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

/** The calendar of the last day of each month at 18:00 India time, from a minute from now until the deadline. */
export function monthEndDefinition(info: Pick<CalendarInfo, 'rulesRevision'>, at: number, deadline: number, maxRuns: number, missedRun: MissedRun): CalendarDefinition {
  return {
    version: 1, basis: 'calendar', timeZone: MONTH_END.timeZone, rulesRevision: info.rulesRevision, effectiveFrom: isoAt(at + 60_000),
    recurrence: { kind: 'monthly', startDate: indiaDate(at), at: MONTH_END.at, dayOfMonth: 31, everyMonths: 1, missingDate: 'last-day' },
    dst: { gap: 'skip', overlap: 'earlier' }, excludedResolvedDates: [], holidays: { kind: 'include' },
    missed: missedRun === 'skip' ? { kind: 'skip', graceMs: SKIP_GRACE_MS } : { kind: 'coalesce' },
    overlap: 'skip', identityBasis: 'local-month', stop: { until: isoAt(deadline), maxNominalOccurrences: maxRuns }, revisionPolicy: 'idle-only',
  };
}

/** Every source the caller may read today. A typed job is pinned to the sources it names. */
function readableSources(host: ModuleHost, ctx: Context): string[] {
  const state = host.store.read();
  const ids = [...new Set(state.facts.filter((f: { deletedAt?: unknown }) => !f.deletedAt).map((f: { sourceId: string }) => f.sourceId))].sort() as string[];
  return ids.filter(id => { try { sourceAccess(state, ctx, [id]); return true; } catch { return false; } });
}

/**
 * Creates the month-end job on the calendar, waiting for approval. Refuses
 * CALENDAR_SCHEDULE_UNAVAILABLE when the core cannot schedule it, and passes other refusals through.
 */
export async function createMonthEnd(ctx: Context, host: ModuleHost, p: { goal: string; budgetMinor: string; maxRuns: number; days: number; missedRun: MissedRun; at: number }) {
  const info = await calendarInfo(host); if (!info) throw unavailable();
  const deadline = p.at + p.days * DAY;
  const years = [new Date(p.at).getUTCFullYear(), new Date(deadline + DAY).getUTCFullYear()];
  if (years[0] < info.minYear || years[1] > info.maxYear || info.bounds.maxNominalSlots < p.maxRuns || info.bounds.maxCalendarDays < p.days + 62) throw unavailable();
  let operations: { id: string }[] = [];
  try { operations = host.services.calculator?.catalog(ctx) ?? []; } catch { operations = []; }
  check(operations.some(o => o.id === MONTH_END.operation), 'MONTH_END_CALCULATION_UNAVAILABLE', 'Publish the billed, received and refund meanings before a month-end brief.');
  const sourceIds = readableSources(host, ctx);
  check(sourceIds.length > 0, 'NO_BOOKS_LOADED', 'Load your books before a month-end brief.');
  try {
    return await host.call('jobs.create', {
      type: 'calculation-set', goal: p.goal, budgetMinor: p.budgetMinor, reserveMinor: p.budgetMinor,
      input: { requests: [{ id: 'owed-at-month-end', input: { operation: MONTH_END.operation }, reserveMinor: MONTH_END.stepReserveMinor, durationMs: MONTH_END.stepMs }] },
      limits: { modelUnits: 0, durationMs: MONTH_END.stepMs, actionExposureMinor: '0' },
      sourceIds, stopRule: { maxRuns: p.maxRuns, deadline: isoAt(deadline) },
      calendar: monthEndDefinition(info, p.at, deadline, p.maxRuns, p.missedRun),
      background: false, testedRoutes: [], allowedActions: [], requiresApproval: true,
    });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (typeof code === 'string' && (code.startsWith('CALENDAR_') || ['INVALID_CALENDAR', 'JOB_POLICY_REQUIRED', 'JOB_TYPE_UNSUPPORTED', 'UNKNOWN_RUNNER'].includes(code))) throw unavailable();
    throw error;
  }
}
