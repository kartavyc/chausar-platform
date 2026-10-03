import type { Language } from '../bridge/presentation.ts';
import { assertISODate, assertISOInstant } from '../bridge/validate.ts';
export type DateForm = 'short' | 'long';
/** Day-first display. UTC protects an ISO date from a machine's local midnight offset. */
export function date(iso: string, form: DateForm = 'short', lang: Language = 'en'): string {
  assertISODate(iso);
  const instant = new Date(`${iso}T00:00:00.000Z`);
  if (form === 'short' && lang === 'en') {
    // The authoritative English sample uses Sep. en-IN's ICU data spells Sept.
    // Take localized month words from Intl and keep the specified day-first order.
    const parts = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).formatToParts(instant);
    const part = (kind: 'day' | 'month' | 'year'): string => parts.find(value => value.type === kind)!.value;
    return `${part('day')} ${part('month')} ${part('year')}`;
  }
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', form === 'long'
    ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }
    : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(instant);
}
/** The workspace timezone is explicit; the host machine's zone is never assumed. */
export function time(iso: string, timeZone: string): string {
  assertISOInstant(iso);
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}
export function age(iso: string, prefix: string, lang: Language = 'en'): string {
  if (iso.length > 10) assertISOInstant(iso); else assertISODate(iso);
  return `${prefix} ${date(iso.slice(0, 10), 'short', lang)}`;
}
/** April-to-March fiscal year is calendar formatting, never a financial calculation. */
export function year(iso: string, prefix: string): string {
  assertISODate(iso);
  const calendarYear = Number(iso.slice(0, 4)), month = Number(iso.slice(5, 7));
  const from = month >= 4 ? calendarYear : calendarYear - 1;
  return `${prefix} ${from}-${String(from + 1).slice(-2).padStart(2, '0')}`;
}
