/**
 * Days, times and months as the owner reads them, one source for every place (one-shot B2): each hook reads the
 * owner's zone (the business's, from `OwnerZone`) and the app's one clock, and writes through the owner format the
 * engine uses too ("3 Nov 2026", "12:41 am", "3 Nov 2026, 12:41 am"). A calendar day ('2026-11-03') never shifts.
 * English only for now; the language-to-locale slot stays for the Hindi pack (C5).
 */

import { useMemo } from 'react';
import type { Language } from '../text';
import { useClock, useOwnerZone } from '../shell/clock';
import { dayKeyIn, formatDay, formatElapsed, formatMoment, formatMonth, formatTime, formatWeekday, hourIn, type When } from '../../../../platform/runtime/owner-format';

/** The one language-to-locale map. Every language writes the English forms until the Hindi pack returns (C5). */
export const LOCALE: Record<Language, string> = { en: 'en-IN' };

/** A day: "3 Nov 2026", or "3 Nov" with `short` (a chart's axis, a list by date within weeks). Blank stays blank. */
export function useDay(size: 'full' | 'short' = 'full'): (value: When | null | undefined) => string {
  const zone = useOwnerZone();
  return useMemo(() => (value) => (value === null || value === undefined || value === '' ? '' : formatDay(value, zone, size)), [zone, size]);
}

/** A time of day on the 12-hour clock: "12:41 am". */
export function useTime(): (value: When) => string {
  const zone = useOwnerZone();
  return useMemo(() => (value) => formatTime(value, zone), [zone]);
}

/** A moment: "3 Nov 2026, 12:41 am", or "3 Nov, 12:41 am" with `short`. */
export function useMoment(size: 'full' | 'short' = 'full'): (value: When) => string {
  const zone = useOwnerZone();
  return useMemo(() => (value) => formatMoment(value, zone, size), [zone, size]);
}

/** A month ('2026-11') as "November 2026" (long) or "Nov" (short). */
export function useMonth(size: 'long' | 'short' = 'long'): (month: string) => string {
  return useMemo(() => (month) => formatMonth(month, size), [size]);
}

/** The weekday and day for a page's date line: "Tuesday, 3 November". */
export function useWeekday(): (value: When) => string {
  const zone = useOwnerZone();
  return useMemo(() => (value) => formatWeekday(value, zone), [zone]);
}

/** Today in the owner's zone, from the app's one clock, as a date field wants it ('YYYY-MM-DD'). */
export function useLocalToday(): () => string {
  const clock = useClock();
  const zone = useOwnerZone();
  return () => dayKeyIn(clock(), zone);
}

/** The calendar day of an instant in the owner's zone ('YYYY-MM-DD'), so two moments compare as days. */
export function useDayKey(): (value: When) => string {
  const zone = useOwnerZone();
  return useMemo(() => (value) => dayKeyIn(value, zone), [zone]);
}

/** The hour now in the owner's zone (0 to 23), for the greeting. */
export function useOwnerHour(): number {
  return hourIn(useClock()(), useOwnerZone());
}

/** How long something took ("1 min 20 s"); nothing for under a second. */
export const elapsedWords = formatElapsed;
