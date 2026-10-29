// Existing Intl schedule arithmetic, shared exactly with browser rehearsal.
export type RoutineSchedule={kind:'once';at:string}|{kind:'interval';everyMinutes:number;from:string}|{kind:'calendar';weekdays:number[];time:string;timeZone:string};
type IsoTime=string;
const MINUTE_MS=60_000,DAY_MS=24*60*MINUTE_MS;
const formats = new Map<string, Intl.DateTimeFormat>();
function format(timeZone: string): Intl.DateTimeFormat {
  let found = formats.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formats.set(timeZone, found);
  }
  return found;
}

/** True for a time zone this computer knows by its IANA name. */
export function knownTimeZone(timeZone: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(timeZone)) return false;
  try { format(timeZone); return true; } catch { return false; }
}

/** The wall clock in a zone at an instant: year, month, day, hour, minute. */
export function wall(ms: number, timeZone: string): { y: number; m: number; d: number; h: number; min: number } {
  const parts = Object.fromEntries(format(timeZone).formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), min: Number(parts.minute) };
}

/**
 * The instant a wall-clock day and time in a zone names. One rule for clock changes: a time the clock skips (spring
 * forward: 02:30 in New York on the day it jumps from 02:00 to 03:00) runs when the clock has jumped by the same amount,
 * so at 03:30; a time that happens twice (fall back) runs once, at the first.
 */
export function instantAt(y: number, m: number, d: number, h: number, min: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  // The zone's offset from UTC at an instant, to the minute.
  const offset = (ms: number) => { const w = wall(ms, timeZone); return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) - Math.floor(ms / MINUTE_MS) * MINUTE_MS; };
  // The offsets on either side of any change that day: every reading of this wall time uses one of them.
  const before = guess - offset(guess - DAY_MS / 2), after = guess - offset(guess + DAY_MS / 2);
  const reads = (at: number) => { const w = wall(at, timeZone); return w.y === y && w.m === m && w.d === d && w.h === h && w.min === min; };
  const real = [...new Set([before, after])].filter(reads).sort((a, b) => a - b);
  // Doubled: the first. Skipped: neither reads it; the offset before the jump lands as far past it as it was skipped.
  return real.length ? real[0]! : before;
}

/** The ISO weekday (1 Monday to 7 Sunday) of a calendar day. */
const isoWeekday = (y: number, m: number, d: number) => { const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return day === 0 ? 7 : day; };

/** The occurrences after one instant and up to another: how many, the newest, and the one before it. */
export type Occurrences = { count: number; latest: IsoTime | null; previous: IsoTime | null };

/** The schedule's occurrences in (afterMs, upToMs]. A calendar schedule looks back at most ten years. */
export function occurrencesBetween(schedule: RoutineSchedule, afterMs: number, upToMs: number): Occurrences {
  const none: Occurrences = { count: 0, latest: null, previous: null };
  if (upToMs <= afterMs) return none;
  const iso = (ms: number) => new Date(ms).toISOString();
  if (schedule.kind === 'once') {
    const at = Date.parse(schedule.at);
    return at > afterMs && at <= upToMs ? { count: 1, latest: schedule.at, previous: null } : none;
  }
  if (schedule.kind === 'interval') {
    const from = Date.parse(schedule.from), step = schedule.everyMinutes * MINUTE_MS;
    if (upToMs < from) return none;
    const first = afterMs < from ? 0 : Math.floor((afterMs - from) / step) + 1;
    const last = Math.floor((upToMs - from) / step);
    if (last < first) return none;
    return { count: last - first + 1, latest: iso(from + last * step), previous: last > first ? iso(from + (last - 1) * step) : null };
  }
  const [hour, minute] = schedule.time.split(':').map(Number);
  // Walk the local calendar day by day (never 24-hour steps, which slip across a clock change), from the day before
  // the start to the day after the end, and read each day's time where it falls.
  const first = wall(Math.max(afterMs, upToMs - 3660 * DAY_MS), schedule.timeZone);
  const last = wall(upToMs, schedule.timeZone);
  const days = Math.round((Date.UTC(last.y, last.m - 1, last.d) - Date.UTC(first.y, first.m - 1, first.d)) / DAY_MS);
  const found: number[] = [];
  let count = 0;
  for (let i = -1; i <= days + 1; i += 1) {
    const date = new Date(Date.UTC(first.y, first.m - 1, first.d + i));
    const day = { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
    if (!schedule.weekdays.includes(isoWeekday(day.y, day.m, day.d))) continue;
    const at = instantAt(day.y, day.m, day.d, hour!, minute!, schedule.timeZone);
    if (at <= afterMs || at > upToMs) continue;
    count += 1;
    found.push(at);
    if (found.length > 2) found.shift();
  }
  return count ? { count, latest: iso(found.at(-1)!), previous: found.length > 1 ? iso(found[0]!) : null } : none;
}

/** The schedule's next occurrence after an instant, or null when there is none (a once that has passed). */
export function nextOccurrence(schedule: RoutineSchedule, afterMs: number): IsoTime | null {
  if (schedule.kind === 'once') return Date.parse(schedule.at) > afterMs ? schedule.at : null;
  if (schedule.kind === 'interval') {
    const from = Date.parse(schedule.from), step = schedule.everyMinutes * MINUTE_MS;
    const k = afterMs < from ? 0 : Math.floor((afterMs - from) / step) + 1;
    return new Date(from + k * step).toISOString();
  }
  return firstOf(schedule, afterMs);
}

/** The first calendar occurrence after an instant, looked for a day further at a time, for eight days. */
function firstOf(schedule: Extract<RoutineSchedule, { kind: 'calendar' }>, afterMs: number): IsoTime | null {
  for (let span = DAY_MS; span <= 8 * DAY_MS; span += DAY_MS) {
    const found = occurrencesBetween(schedule, afterMs, afterMs + span);
    if (found.count) return found.count === 1 ? found.latest : found.previous;
  }
  return null;
}
