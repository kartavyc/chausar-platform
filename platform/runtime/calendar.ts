import { check } from './contracts.ts';
import { digest } from './actions.ts';
import { json } from './job-protocol.ts';
import { strictLocal } from './calendar-zone.ts';
import type { CalendarRules } from './calendar-zone.ts';

export type CalendarRecurrence =
  | { kind: 'once'; atLocal: string }
  | { kind: 'daily'; startDate: string; at: string; everyDays: number }
  | { kind: 'weekly'; startDate: string; at: string; weekdays: number[]; everyWeeks: number }
  | { kind: 'monthly'; startDate: string; at: string; dayOfMonth: number; everyMonths: number; missingDate: 'skip' | 'last-day' };
/** Every business policy is supplied by the mandate author, never by machine location. */
export type CalendarDefinition = {
  version: 1; basis: 'calendar'; timeZone: string; rulesRevision: string; effectiveFrom: string;
  recurrence: CalendarRecurrence;
  dst: { gap: 'skip' | 'reject'; overlap: 'earlier' | 'later' | 'both' | 'reject' };
  excludedResolvedDates: string[];
  holidays: { kind: 'include' } | { kind: 'skip'; calendarId: string; revision: string; dates: string[]; coverage: { from: string; to: string }; basis: 'resolved-local-date' };
  missed: { kind: 'skip'; graceMs: number } | { kind: 'coalesce' } | { kind: 'catch-up'; maxPerPass: number; overflow: 'retain' | 'skip' };
  overlap: 'defer' | 'skip'; identityBasis: 'local-date' | 'local-date-time' | 'local-month';
  stop: { until: string; maxNominalOccurrences: number }; revisionPolicy: 'idle-only';
};
export type CalendarBounds = { maxNominalSlots: number; maxCalendarDays: number };
export type CalendarOccurrence = {
  id: string; nominalKey: string; requestedLocal: string; resolvedLocal?: string; instant?: string; checkpointInstant?: string; checkpointLocal: string; fold: number;
  disposition: 'eligible' | 'excluded' | 'holiday' | 'gap-skipped' | 'invalid-date-skipped';
};
export type CalendarRecord = CalendarOccurrence & {
  status: 'admitted' | 'delivered' | 'accepted' | 'skipped' | 'coalesced' | 'deferred' | 'obsolete';
  scheduleRevision: number; objectiveRevision: number; at: string; reason?: string; representedIds?: string[];
};
export type JobCalendar = {
  definition: CalendarDefinition; revision: number; objectiveRevision: number; digest: string; paused: boolean;
  records: CalendarRecord[]; current?: string; skipOverlapWindows: { from: string; to: string }[];
  retiredDefinitions: { definition: CalendarDefinition; revision: number; objectiveRevision: number; replacedAt: string }[];
};
export type CalendarEvaluation = {
  occurrences: CalendarOccurrence[];
  selected: CalendarOccurrence[]; decisions: { occurrence: CalendarOccurrence; status: 'skipped' | 'coalesced' | 'deferred'; reason: string }[];
  nextRunAt?: string; expired: boolean; canonicalZone: string; rulesRevision: string;
  coverage: { complete: true; nominalSlots: number; calendarDays: number }; representedIds: string[];
};
const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');
function civil(ms: number) { return new Date(ms).toISOString().slice(0, 10); }
function date(value: string, rules: CalendarRules) { check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID_CALENDAR', 'Use an exact Gregorian date.'); return strictLocal(`${value}T00:00`, rules.minYear, rules.maxYear).naive; }
export function calendarInstant(value: string): number {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'INVALID_CALENDAR', 'Use an absolute ISO instant with an explicit offset.');
  const civilPart = value.slice(0, 16); strictLocal(civilPart, 2000, 2100);
  check(Number(value.slice(17, 19)) <= 59 && (value.endsWith('Z') || (Number(value.slice(-5, -3)) <= 23 && Number(value.slice(-2)) <= 59)), 'INVALID_CALENDAR', 'Invalid instant seconds or offset.');
  const result = Date.parse(value); check(Number.isFinite(result), 'INVALID_CALENDAR', 'Invalid absolute instant.'); return result;
}
function integer(value: number, min: number, max: number) { check(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_CALENDAR', 'A calendar integer is outside its declared bounds.'); }
export function validateCalendar(input: CalendarDefinition, rules: CalendarRules, bounds: CalendarBounds): CalendarDefinition {
  const d = json(input); integer(bounds.maxNominalSlots, 1, 10000); integer(bounds.maxCalendarDays, 1, 36600);
  check(d && typeof d === 'object' && !Array.isArray(d), 'INVALID_CALENDAR', 'Supply a calendar definition object.');
  check(d.version === 1 && d.basis === 'calendar' && d.revisionPolicy === 'idle-only', 'INVALID_CALENDAR', 'Install version 1 calendar rules and an explicit idle-only revision policy.');
  check(d.rulesRevision === rules.revision, 'CALENDAR_RULES_CHANGED', 'The installed time-zone rules differ from the reviewed schedule.');
  const zone = rules.canonicalZone(d.timeZone); const from = calendarInstant(d.effectiveFrom); const until = calendarInstant(d.stop?.until);
  check(from < until, 'INVALID_CALENDAR', 'Effective start must precede the stop instant.'); rules.localAt(from, zone); rules.localAt(until, zone);
  integer(d.stop.maxNominalOccurrences, 1, bounds.maxNominalSlots);
  check(d.dst && ['skip', 'reject'].includes(d.dst.gap) && ['earlier', 'later', 'both', 'reject'].includes(d.dst.overlap), 'INVALID_CALENDAR', 'Declare both missing and repeated civil-time policies.');
  check(['defer', 'skip'].includes(d.overlap) && ['local-date', 'local-date-time', 'local-month'].includes(d.identityBasis), 'INVALID_CALENDAR', 'Declare active-run overlap and business-period identity policies.');
  const r = d.recurrence; check(r && ['once', 'daily', 'weekly', 'monthly'].includes(r.kind), 'INVALID_CALENDAR', 'Declare a supported calendar recurrence.');
  if (r.kind === 'once') strictLocal(r.atLocal, rules.minYear, rules.maxYear);
  else {
    date(r.startDate, rules); check(typeof r.at === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.at), 'INVALID_CALENDAR', 'Use a civil hour and minute.');
    if (r.kind === 'daily') integer(r.everyDays, 1, 36600);
    if (r.kind === 'weekly') { integer(r.everyWeeks, 1, 5200); check(Array.isArray(r.weekdays) && r.weekdays.length > 0 && r.weekdays.length <= 7 && new Set(r.weekdays).size === r.weekdays.length, 'INVALID_CALENDAR', 'Declare unique weekdays, Sunday 0 through Saturday 6.'); r.weekdays.forEach(v => integer(v, 0, 6)); r.weekdays.sort((a, b) => a - b); }
    if (r.kind === 'monthly') { integer(r.everyMonths, 1, 1200); integer(r.dayOfMonth, 1, 31); check(['skip', 'last-day'].includes(r.missingDate), 'INVALID_CALENDAR', 'Declare how unavailable monthly dates are handled.'); }
  }
  check(d.identityBasis !== 'local-month' || r.kind === 'monthly' || r.kind === 'once', 'INVALID_CALENDAR', 'Monthly business identity is only qualified for monthly or one-time recurrence.');
  check(Array.isArray(d.excludedResolvedDates) && d.excludedResolvedDates.length <= bounds.maxCalendarDays, 'INVALID_CALENDAR', 'Declare exclusions explicitly.'); d.excludedResolvedDates.forEach(v => date(v, rules)); d.excludedResolvedDates = [...new Set(d.excludedResolvedDates)].sort();
  check(d.holidays && ['include', 'skip'].includes(d.holidays.kind), 'INVALID_CALENDAR', 'Declare whether a supplied holiday calendar applies.');
  if (d.holidays.kind === 'skip') {
    const h = d.holidays; check(typeof h.calendarId === 'string' && h.calendarId.length > 0 && h.calendarId.length <= 200 && typeof h.revision === 'string' && h.revision.length > 0 && h.revision.length <= 200 && h.basis === 'resolved-local-date', 'INVALID_CALENDAR', 'Pin the holiday calendar revision and resolved-date basis.');
    const lo = date(h.coverage?.from, rules), hi = date(h.coverage?.to, rules); check(lo <= hi && Array.isArray(h.dates) && h.dates.length <= bounds.maxCalendarDays, 'INVALID_CALENDAR', 'Supply bounded holiday coverage.');
    h.dates.forEach(v => { const n = date(v, rules); check(n >= lo && n <= hi, 'INVALID_CALENDAR', 'Holiday date is outside supplied coverage.'); }); h.dates = [...new Set(h.dates)].sort();
  }
  check(d.missed && ['skip', 'coalesce', 'catch-up'].includes(d.missed.kind), 'INVALID_CALENDAR', 'Declare the missed-run policy.');
  if (d.missed.kind === 'skip') integer(d.missed.graceMs, 0, 31536000000);
  if (d.missed.kind === 'catch-up') { integer(d.missed.maxPerPass, 1, bounds.maxNominalSlots); check(['retain', 'skip'].includes(d.missed.overflow), 'INVALID_CALENDAR', 'Declare catch-up overflow handling.'); }
  d.timeZone = zone; return d;
}
function checkpointInstant(local: string, zone: string, rules: CalendarRules): number {
  const exact = rules.candidates(local, zone); if (exact.length) return exact[0];
  const naive = strictLocal(local, rules.minYear, rules.maxYear).naive;
  // A nonexistent minute still has an audit boundary. This is never a dispatch occurrence.
  for (let instant = naive - 26 * 3600000; instant <= naive + 26 * 3600000; instant += 60000) {
    let projected: string;
    try { projected = rules.localAt(instant, zone); } catch (error) { if ((error as { code?: string }).code === 'CALENDAR_INSTANT_UNSUPPORTED') continue; throw error; }
    if (projected >= local) return instant;
  }
  check(false, 'CALENDAR_EVALUATION_LIMIT', 'The exceptional civil date has no qualified audit boundary.');
}
/** Full bounded horizon evaluation. A truncated horizon is an error, never a latest-run answer. */
export function evaluateCalendar(input: CalendarDefinition, options: { jobId: string; now: number; rules: CalendarRules; bounds: CalendarBounds; records?: CalendarRecord[]; skipOverlapWindows?: { from: string; to: string }[] }): CalendarEvaluation {
  const { rules, bounds } = options; const d = validateCalendar(input, rules, bounds); const zone = d.timeZone;
  check(Number.isSafeInteger(options.now), 'INVALID_CALENDAR', 'Use an explicit evaluation instant.');
  const from = calendarInstant(d.effectiveFrom), until = calendarInstant(d.stop.until); const fromLocal = rules.localAt(from, zone), untilLocal = rules.localAt(until, zone); rules.localAt(options.now, zone);
  const r = d.recurrence; const slots: { requested: string; resolved?: string; checkpoint: string }[] = [];
  let calendarDays = 0;
  const add = (requested: string, resolved: string | undefined, checkpoint: string) => {
    const checkpoints = rules.candidates(checkpoint, zone);
    if (checkpoints.length ? checkpoints.every(instant => instant >= until) : checkpoint >= untilLocal) return false;
    check(slots.length < bounds.maxNominalSlots, 'CALENDAR_EVALUATION_LIMIT', 'The schedule exceeds the qualified nominal-slot horizon.'); slots.push({ requested, resolved, checkpoint }); return slots.length < d.stop.maxNominalOccurrences;
  };
  if (r.kind === 'once') add(r.atLocal, r.atLocal, r.atLocal);
  else if (r.kind === 'monthly') {
    const start = date(r.startDate, rules); const anchor = new Date(start); const firstMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth();
    for (let n = 0; slots.length < d.stop.maxNominalOccurrences; n++) {
      const month = firstMonth + n * r.everyMonths, y = Math.floor(month / 12), m = month % 12;
      if (Date.UTC(y, m, 1) > until + 26 * 3600000) break;
      check(y <= rules.maxYear, 'CALENDAR_EVALUATION_LIMIT', 'The schedule exceeds qualified time-zone years.');
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); const wanted = `${y}-${pad(m + 1)}-${pad(r.dayOfMonth)}T${r.at}`; const valid = `${y}-${pad(m + 1)}-${pad(Math.min(last, r.dayOfMonth))}T${r.at}`;
      if (valid.slice(0, 10) < r.startDate) continue;
      calendarDays += last; check(calendarDays <= bounds.maxCalendarDays, 'CALENDAR_EVALUATION_LIMIT', 'The schedule exceeds the qualified calendar-day horizon.');
      if (!add(wanted, r.dayOfMonth <= last || r.missingDate === 'last-day' ? valid : undefined, valid)) break;
    }
  } else {
    const start = date(r.startDate, rules);
    for (let n = 0; slots.length < d.stop.maxNominalOccurrences; n += r.kind === 'daily' ? r.everyDays : 1) {
      const day = start + n * DAY; const local = `${civil(day)}T${r.at}`; if (day > until + 26 * 3600000) break;
      check(new Date(day).getUTCFullYear() <= rules.maxYear, 'CALENDAR_EVALUATION_LIMIT', 'The schedule exceeds qualified time-zone years.');
      calendarDays += r.kind === 'daily' ? r.everyDays : 1; check(calendarDays <= bounds.maxCalendarDays, 'CALENDAR_EVALUATION_LIMIT', 'The schedule exceeds the qualified calendar-day horizon.');
      if (r.kind === 'weekly' && (Math.floor(n / 7) % r.everyWeeks !== 0 || !r.weekdays.includes(new Date(day).getUTCDay()))) continue;
      if (!add(local, local, local)) break;
    }
  }
  const occurrences: CalendarOccurrence[] = [];
  for (const slot of slots) {
    const resolved = slot.resolved; let disposition: CalendarOccurrence['disposition'] = resolved ? 'eligible' : 'invalid-date-skipped'; let instants: number[] = [];
    if (!resolved && (slot.checkpoint < fromLocal || slot.checkpoint >= untilLocal)) continue;
    if (resolved) {
      instants = rules.candidates(resolved, zone);
      if (instants.length && instants.every(instant => instant < from || instant >= until)) continue;
      if (!instants.length && (slot.checkpoint < fromLocal || slot.checkpoint >= untilLocal)) continue;
      if (!instants.length) { check(d.dst.gap === 'skip', 'CALENDAR_GAP_REJECTED', 'A requested civil time does not exist; review this exceptional date.'); disposition = 'gap-skipped'; }
      if (instants.length > 1) { check(d.dst.overlap !== 'reject', 'CALENDAR_OVERLAP_REJECTED', 'A requested civil time repeats; review this exceptional date.'); if (d.dst.overlap === 'earlier') instants = instants.slice(0, 1); if (d.dst.overlap === 'later') instants = instants.slice(-1); }
      const day = resolved.slice(0, 10);
      if (d.holidays.kind === 'skip') { check(day >= d.holidays.coverage.from && day <= d.holidays.coverage.to, 'CALENDAR_HOLIDAY_COVERAGE', 'The supplied holiday calendar does not cover an evaluated date.'); if (d.holidays.dates.includes(day)) disposition = 'holiday'; }
      if (d.excludedResolvedDates.includes(day)) disposition = 'excluded';
    }
    const values = instants.length ? instants : [undefined];
    for (const instant of values) {
      if (instant !== undefined && (instant < from || instant >= until)) continue;
      if (instant === undefined && (slot.checkpoint < fromLocal || slot.checkpoint >= untilLocal)) continue;
      // Fold derives from the full rule result even when the author selected only the later instant.
      const fold = instant === undefined || !resolved ? 0 : rules.candidates(resolved, zone).indexOf(instant);
      const basis = resolved ?? slot.requested; const period = d.identityBasis === 'local-month' ? basis.slice(0, 7) : d.identityBasis === 'local-date' ? basis.slice(0, 10) : basis;
      const checkpoint = instant ?? checkpointInstant(slot.checkpoint, zone, rules);
      const identityFold = d.dst.overlap === 'both' ? fold : 0;
      occurrences.push({ id: digest({ jobId: options.jobId, period, fold: identityFold }), nominalKey: slot.requested, requestedLocal: slot.requested, ...(resolved ? { resolvedLocal: resolved } : {}), ...(instant !== undefined ? { instant: new Date(instant).toISOString() } : {}), checkpointInstant: new Date(checkpoint).toISOString(), checkpointLocal: slot.checkpoint, fold, disposition });
    }
  }
  const seen = new Set((options.records ?? []).filter(x => x.status !== 'deferred').map(x => x.id));
  const due: CalendarOccurrence[] = [], future: CalendarOccurrence[] = []; const decisions: CalendarEvaluation['decisions'] = [];
  for (const occurrence of occurrences) {
    if (seen.has(occurrence.id)) continue; seen.add(occurrence.id);
    const time = occurrence.instant ? Date.parse(occurrence.instant) : undefined; const isDue = Date.parse(occurrence.checkpointInstant!) <= options.now;
    if (!isDue) { future.push(occurrence); continue; }
    let reason: Exclude<CalendarOccurrence['disposition'], 'eligible'> | 'active-run-overlap' | 'missed-grace' | undefined
      = occurrence.disposition !== 'eligible' ? occurrence.disposition : undefined;
    if (!reason && (options.skipOverlapWindows ?? []).some(w => time! >= Date.parse(w.from) && time! <= Date.parse(w.to))) reason = 'active-run-overlap';
    if (!reason && d.missed.kind === 'skip' && options.now - time! > d.missed.graceMs) reason = 'missed-grace';
    if (reason) decisions.push({ occurrence, status: 'skipped', reason }); else due.push(occurrence);
  }
  due.sort((a, b) => Date.parse(a.instant!) - Date.parse(b.instant!)); future.sort((a, b) => Date.parse(a.checkpointInstant!) - Date.parse(b.checkpointInstant!));
  const expired = options.now >= until; let selected: CalendarOccurrence[] = []; let representedIds: string[] = [];
  if (!expired) {
    if (d.missed.kind === 'coalesce') { selected = due.slice(-1); representedIds = due.map(x => x.id); for (const occurrence of due.slice(0, -1)) decisions.push({ occurrence, status: 'coalesced', reason: 'missed-coalesced' }); }
    else if (d.missed.kind === 'catch-up') { selected = due.slice(0, d.missed.maxPerPass); for (const occurrence of due.slice(d.missed.maxPerPass)) decisions.push({ occurrence, status: d.missed.overflow === 'skip' ? 'skipped' : 'deferred', reason: 'catch-up-overflow' }); }
    else selected = due;
  } else for (const occurrence of due) decisions.push({ occurrence, status: 'skipped', reason: 'schedule-expired' });
  const next = selected[0]?.instant ?? future[0]?.checkpointInstant;
  return { occurrences, selected, decisions, ...(next ? { nextRunAt: next } : {}), expired, canonicalZone: zone, rulesRevision: rules.revision, coverage: { complete: true, nominalSlots: slots.length, calendarDays }, representedIds };
}
