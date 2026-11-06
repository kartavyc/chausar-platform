/**
 * Days, times and months as the owner reads them, one source for every place (one-shot B2): each hook reads the
 * owner's zone (the business's, from `OwnerZone`) and the app's one clock, and writes through the owner format the
 * engine uses too ("3 Nov 2026", "12:41 am", "3 Nov 2026, 12:41 am"). A calendar day ('2026-11-03') never shifts.
 * C5 task 38: under the Hindi pack the same hooks write Hindi words with Latin digits ("3 नव॰ 2026"); money never changes.
 */

import { useMemo } from 'react';
import { useLanguage, type Language } from '../text';
import { useClock, useOwnerZone } from '../shell/clock';
import { dayKeyIn, formatDay, formatMoment, formatMonth, formatTime, formatWeekday, hourIn, setDateLocale, type When } from '../../../../platform/runtime/owner-format';

/** The one language-to-locale map. Hindi keeps Latin digits by default; English writes owner-format's own forms. */
export const LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN-u-nu-latn' };

/** Called as the language changes (shell/LanguageRoot), before the words on screen do, so every date reads alike. */
export function setDateLanguage(language: Language): void {
  setDateLocale(language === 'en' ? null : LOCALE[language]);
}

/** A day: "3 Nov 2026", or "3 Nov" with `short` (a chart's axis, a list by date within weeks). Blank stays blank. */
export function useDay(size: 'full' | 'short' = 'full'): (value: When | null | undefined) => string {
  const zone = useOwnerZone();
  const language = useLanguage();
  return useMemo(() => (value) => (value === null || value === undefined || value === '' ? '' : formatDay(value, zone, size)), [zone, size, language]);
}

/** A time of day on the 12-hour clock: "12:41 am". */
export function useTime(): (value: When) => string {
  const zone = useOwnerZone();
  const language = useLanguage();
  return useMemo(() => (value) => formatTime(value, zone), [zone, language]);
}

/** A moment: "3 Nov 2026, 12:41 am", or "3 Nov, 12:41 am" with `short`. */
export function useMoment(size: 'full' | 'short' = 'full'): (value: When) => string {
  const zone = useOwnerZone();
  const language = useLanguage();
  return useMemo(() => (value) => formatMoment(value, zone, size), [zone, size, language]);
}

/** A month ('2026-11') as "November 2026" (long) or "Nov" (short). */
export function useMonth(size: 'long' | 'short' = 'long'): (month: string) => string {
  const language = useLanguage();
  return useMemo(() => (month) => formatMonth(month, size), [size, language]);
}

/** The weekday and day for a page's date line: "Tuesday, 3 November". */
export function useWeekday(): (value: When) => string {
  const zone = useOwnerZone();
  const language = useLanguage();
  return useMemo(() => (value) => formatWeekday(value, zone), [zone, language]);
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

/** C5 task 19: bytes as the owner reads them: "4.1 MB", "23 MB". One decimal below ten, none from there. */
export function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes < 10 ? Math.round(megabytes * 10) / 10 : Math.round(megabytes)} MB`;
}

/** C5 task 27: a small file's size: "512 bytes", "2 KB", then as formatBytes. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : formatBytes(bytes);
}
