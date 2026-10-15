/**
 * WK-11. The installed app's job options: typed jobs and calendar rules, so the month-end brief can run on the
 * core calendar. An explicit job policy in the environment wins; otherwise the desktop runs one local worker
 * with no network transport. The calendar rules name the zones a business in India meets, within qualified years.
 */
import { IntlCalendarRules } from '../calendar-zone.ts';
import type { CalendarBounds } from '../calendar.ts';
import { engineJobOptions, type EngineJobOptions } from '../engine-jobs.ts';

export const DESKTOP_TIME_ZONES = Object.freeze(['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York']);
/** A month-end brief may allow up to 366 runs over 366 days; work-books checks both bounds before creating it. */
export const DESKTOP_CALENDAR_BOUNDS: Readonly<CalendarBounds> = Object.freeze({ maxNominalSlots: 400, maxCalendarDays: 800 });

export function desktopJobOptions(environment: Record<string, string | undefined>): { durableJobs: EngineJobOptions; jobCalendar: { rules: IntlCalendarRules; bounds: CalendarBounds } } {
  const durableJobs = engineJobOptions(environment) ?? { workerId: 'desktop', maxActiveJobs: 8, leaseMs: 60000, networkAvailable: () => false };
  const rules = new IntlCalendarRules({ timeZones: [...DESKTOP_TIME_ZONES], minYear: 2024, maxYear: 2040, maxCachedLocalTimes: 4096 });
  return { durableJobs, jobCalendar: { rules, bounds: { ...DESKTOP_CALENDAR_BOUNDS } } };
}
