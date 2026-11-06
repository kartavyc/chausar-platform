// Chausar venture launcher: the owner's local day.
// Every default date the venture fills in (today's date on a draft, an invoice's issue date, the books period) is the
// calendar day where the business is, read through the engine's calendar-zone rules, never the UTC day. A business in
// India at 01:00 on 16 October local time is on 16 October, though UTC still says the 15th.
import { IntlCalendarRules, type CalendarRules } from '../calendar-zone.ts';
import type { CountryProfile, IsoDate } from './contracts.ts';

/**
 * One IANA zone per country in the country table. A country with several zones uses its most populous one, so a
 * business on the US west coast still reads New York's day; 'XX' (another country) uses UTC.
 */
export {COUNTRY_TIME_ZONES} from './local-day-data.ts';
import {COUNTRY_TIME_ZONES} from './local-day-data.ts';

let rules: CalendarRules | null = null;

function calendarRules(): CalendarRules {
  if (!rules) {
    const zones = [...new Set(['UTC', ...Object.values(COUNTRY_TIME_ZONES)])];
    rules = new IntlCalendarRules({ timeZones: zones, minYear: 2000, maxYear: 2100, maxCachedLocalTimes: 0 });
  }
  return rules;
}

/** The venture's time zone from its country code; UTC for a code outside the table. */
export function ventureTimeZone(country: Pick<CountryProfile, 'code'>): string {
  return COUNTRY_TIME_ZONES[country.code] ?? 'UTC';
}

/** The owner's calendar day at an instant (a Date or an ISO time with 'Z'), as 'YYYY-MM-DD'. */
export function localDayAt(instant: Date | string, country: Pick<CountryProfile, 'code'>): IsoDate {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  return calendarRules().localAt(ms, ventureTimeZone(country)).slice(0, 10);
}

/**
 * The owner's clock at an instant, to the minute, with its offset from UTC: '2026-10-16T01:30+05:30' for a business in
 * India at 20:00 UTC on 15 October. A moment written for the owner (a calendar file's approval times) reads in the
 * business's own time and still names one instant.
 */
export function localTimeAt(instant: Date | string, country: Pick<CountryProfile, 'code'>): string {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  const local = calendarRules().localAt(ms, ventureTimeZone(country));
  const offset = Math.round((Date.parse(`${local}:00.000Z`) - Math.floor(ms / 60000) * 60000) / 60000);
  const size = Math.abs(offset);
  return `${local}${offset < 0 ? '-' : '+'}${String(Math.floor(size / 60)).padStart(2, '0')}:${String(size % 60).padStart(2, '0')}`;
}

/** Today on the owner's calendar, from the injected clock. */
export function ownerToday(clock: () => Date, country: Pick<CountryProfile, 'code'>): IsoDate {
  return localDayAt(clock(), country);
}
