import { check } from './contracts.ts';

export interface CalendarRules {
  revision: string;
  minYear: number;
  maxYear: number;
  canonicalZone(zone: string): string;
  localAt(instant: number, zone: string): string;
  candidates(local: string, zone: string): number[];
}

export type CivilMinute = {
  year: number; month: number; day: number; hour: number; minute: number; naive: number;
};

function yearRange(minYear: number, maxYear: number) {
  check(Number.isInteger(minYear) && Number.isInteger(maxYear) && minYear >= 2000 && maxYear <= 2100 && minYear <= maxYear,
    'INVALID_CALENDAR_RULES', 'Declare a qualified civil-year range within 2000 through 2100.');
}

/** ISO civil minutes are not instants and never pass through Date.parse or an ambient time zone. */
export function strictLocal(local: string, minYear: number, maxYear: number): CivilMinute {
  yearRange(minYear, maxYear);
  check(typeof local === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local),
    'INVALID_CALENDAR_LOCAL', 'Use an ISO civil minute in YYYY-MM-DDTHH:mm form without an offset.');
  const year = Number(local.slice(0, 4)); const month = Number(local.slice(5, 7)); const day = Number(local.slice(8, 10));
  const hour = Number(local.slice(11, 13)); const minute = Number(local.slice(14, 16));
  check(year >= minYear && year <= maxYear && month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59,
    'INVALID_CALENDAR_LOCAL', 'The civil minute is outside its qualified range.');
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(naive);
  check(date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute,
    'INVALID_CALENDAR_LOCAL', 'The civil minute needs a real Gregorian date.');
  return { year, month, day, hour, minute, naive };
}

export type IntlCalendarRulesOptions = {
  timeZones: string[]; minYear: number; maxYear: number; maxCachedLocalTimes: number;
};

type ZonedParts = Omit<CivilMinute, 'naive'> & { second: number };
const dateLimit = 8640000000000000;
const minuteMs = 60000;
const searchMinutes = 26 * 60;
const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** Read-only rules for explicitly installed zones. The host owns scheduling and all occurrence policy. */
export class IntlCalendarRules implements CalendarRules {
  readonly revision: string;
  readonly minYear: number;
  readonly maxYear: number;
  private readonly maxCachedLocalTimes: number;
  private readonly zones = new Map<string, string>();
  private readonly formatters = new Map<string, Intl.DateTimeFormat>();
  private readonly cache = new Map<string, number[]>();

  constructor(options: IntlCalendarRulesOptions) {
    check(options && Array.isArray(options.timeZones) && options.timeZones.length > 0,
      'INVALID_CALENDAR_RULES', 'Install an explicit nonempty time-zone list.');
    yearRange(options.minYear, options.maxYear);
    check(Number.isSafeInteger(options.maxCachedLocalTimes) && options.maxCachedLocalTimes >= 0,
      'INVALID_CALENDAR_RULES', 'Declare a bounded non-negative local-time cache capacity.');
    check(typeof process.versions.tz === 'string' && process.versions.tz.length > 0 && typeof process.versions.icu === 'string' && process.versions.icu.length > 0,
      'INVALID_CALENDAR_RULES', 'The runtime must expose its installed time-zone and ICU revisions.');
    this.minYear = options.minYear; this.maxYear = options.maxYear; this.maxCachedLocalTimes = options.maxCachedLocalTimes;
    this.revision = `intl-tzdb:${process.versions.tz};icu:${process.versions.icu}`;
    const supplied = new Set<string>();
    for (const zone of options.timeZones) {
      check(!supplied.has(zone), 'INVALID_CALENDAR_RULES', 'Do not repeat an installed time-zone name.');
      supplied.add(zone);
      // Intl also accepts numeric offset identifiers; this contract deliberately requires named zones.
      check(typeof zone === 'string' && /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/.test(zone),
        'CALENDAR_ZONE_UNSUPPORTED', 'Install a named IANA time zone without whitespace or a fixed offset.');
      let formatter: Intl.DateTimeFormat;
      try {
        formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', hourCycle: 'h23',
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
      } catch {
        check(false, 'CALENDAR_ZONE_UNSUPPORTED', 'The installed Intl rules do not support this named time zone.');
      }
      const resolved = formatter.resolvedOptions();
      check(resolved.calendar === 'iso8601' && resolved.numberingSystem === 'latn' && resolved.hourCycle === 'h23',
        'INVALID_CALENDAR_RULES', 'The runtime must support ISO calendar, Latin digits and an unambiguous midnight hour.');
      this.zones.set(zone, resolved.timeZone);
      this.zones.set(resolved.timeZone, resolved.timeZone);
      this.formatters.set(resolved.timeZone, formatter);
    }
  }

  canonicalZone(zone: string): string {
    const canonical = typeof zone === 'string' ? this.zones.get(zone) : undefined;
    check(canonical, 'CALENDAR_ZONE_UNSUPPORTED', 'Use an explicitly installed time-zone alias or its canonical name.');
    return canonical;
  }

  private parts(instant: number, formatter: Intl.DateTimeFormat): ZonedParts {
    const values: Record<string, number> = {};
    for (const part of formatter.formatToParts(instant)) if (part.type !== 'literal') values[part.type] = Number(part.value);
    return { year: values.year!, month: values.month!, day: values.day!, hour: values.hour!, minute: values.minute!, second: values.second! };
  }

  localAt(instant: number, zone: string): string {
    const canonical = this.canonicalZone(zone);
    check(Number.isSafeInteger(instant) && Math.abs(instant) <= dateLimit,
      'CALENDAR_INSTANT_UNSUPPORTED', 'Use a finite integer-millisecond instant supported by the runtime.');
    const local = this.parts(instant, this.formatters.get(canonical)!);
    check(local.year >= this.minYear && local.year <= this.maxYear,
      'CALENDAR_INSTANT_UNSUPPORTED', 'This instant is outside the qualified civil-year range in its time zone.');
    return `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`;
  }

  candidates(local: string, zone: string): number[] {
    const target = strictLocal(local, this.minYear, this.maxYear);
    const canonical = this.canonicalZone(zone);
    const key = `${canonical}|${local}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.cache.delete(key); this.cache.set(key, cached);
      return [...cached];
    }
    const formatter = this.formatters.get(canonical)!;
    const matches: number[] = [];
    // Exhaustive exact-minute roundtrips avoid choosing a fold or inventing an instant in a gap.
    // The declared contemporary range qualifies minute offsets and this bounded UTC search window.
    for (let delta = -searchMinutes; delta <= searchMinutes; delta += 1) {
      const instant = target.naive + delta * minuteMs;
      const actual = this.parts(instant, formatter);
      if (actual.year === target.year && actual.month === target.month && actual.day === target.day && actual.hour === target.hour && actual.minute === target.minute && actual.second === 0) matches.push(instant);
    }
    const result = [...new Set(matches)].sort((left, right) => left - right);
    if (this.maxCachedLocalTimes > 0) {
      this.cache.set(key, result);
      while (this.cache.size > this.maxCachedLocalTimes) this.cache.delete(this.cache.keys().next().value!);
    }
    return [...result];
  }
}
