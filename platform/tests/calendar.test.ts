import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarInstant, evaluateCalendar, validateCalendar } from '../runtime/calendar.ts';
import type { CalendarBounds, CalendarDefinition, CalendarOccurrence, CalendarRecord } from '../runtime/calendar.ts';
import { IntlCalendarRules } from '../runtime/calendar-zone.ts';

const rules = new IntlCalendarRules({
  timeZones: ['UTC', 'America/New_York', 'Australia/Lord_Howe', 'Asia/Kolkata'],
  minYear: 2000, maxYear: 2100, maxCachedLocalTimes: 64,
});
const bounds: CalendarBounds = { maxNominalSlots: 12, maxCalendarDays: 100 };
function definition(overrides: Partial<CalendarDefinition> = {}): CalendarDefinition {
  return {
    version: 1, basis: 'calendar', timeZone: 'UTC', rulesRevision: rules.revision,
    effectiveFrom: '2024-01-01T00:00:00.000Z',
    recurrence: { kind: 'daily', startDate: '2024-01-01', at: '09:00', everyDays: 1 },
    dst: { gap: 'skip', overlap: 'earlier' }, excludedResolvedDates: [], holidays: { kind: 'include' },
    missed: { kind: 'coalesce' }, overlap: 'defer', identityBasis: 'local-date-time',
    stop: { until: '2024-01-04T00:00:00.000Z', maxNominalOccurrences: 3 }, revisionPolicy: 'idle-only',
    ...overrides,
  };
}
type ExtraOptions = Partial<Omit<Parameters<typeof evaluateCalendar>[1], 'now'>>;
function evaluate(d: CalendarDefinition, at: string, extra: ExtraOptions = {}) {
  return evaluateCalendar(d, { jobId: 'synthetic-business-calendar', now: Date.parse(at), rules, bounds, ...extra });
}
function record(occurrence: CalendarOccurrence, status: CalendarRecord['status'] = 'accepted'): CalendarRecord {
  return { ...occurrence, status, scheduleRevision: 1, objectiveRevision: 1, at: '2024-01-01T12:00:00.000Z' };
}
const instants = (occurrences: CalendarOccurrence[]) => occurrences.map(occurrence => occurrence.instant);
const localTimes = (occurrences: CalendarOccurrence[]) => occurrences.map(occurrence => occurrence.resolvedLocal);
const catchAll = { kind: 'catch-up' as const, maxPerPass: 12, overflow: 'retain' as const };

test('calendar contracts require explicit business policies and installed time-zone rules', () => {
  for (const key of ['version', 'basis', 'dst', 'excludedResolvedDates', 'holidays', 'missed', 'overlap', 'identityBasis', 'revisionPolicy', 'recurrence'] as const) {
    const d = definition(); Reflect.deleteProperty(d, key);
    assert.throws(() => validateCalendar(d, rules, bounds), { code: 'INVALID_CALENDAR' }, key);
  }
  const noZone = definition(); Reflect.deleteProperty(noZone, 'timeZone');
  assert.throws(() => validateCalendar(noZone, rules, bounds), { code: 'CALENDAR_ZONE_UNSUPPORTED' });
  const noRevision = definition(); Reflect.deleteProperty(noRevision, 'rulesRevision');
  assert.throws(() => validateCalendar(noRevision, rules, bounds), { code: 'CALENDAR_RULES_CHANGED' });
  for (const timeZone of ['+05:30', 'Europe/London', 'US/Eastern']) assert.throws(() => validateCalendar(definition({ timeZone }), rules, bounds), { code: 'CALENDAR_ZONE_UNSUPPORTED' });
  const canonical = validateCalendar(definition({ timeZone: 'Asia/Kolkata' }), rules, bounds);
  assert.equal(canonical.timeZone, rules.canonicalZone('Asia/Kolkata'));
});

test('invalid policies, recurrence integers and implicit monthly dates are rejected', () => {
  const cases: Record<string, unknown>[] = [
    { dst: { gap: 'shift', overlap: 'earlier' } }, { dst: { gap: 'skip', overlap: 'default' } },
    { missed: { kind: 'skip' } }, { missed: { kind: 'skip', graceMs: -1 } },
    { missed: { kind: 'catch-up', maxPerPass: 0, overflow: 'retain' } }, { missed: { kind: 'catch-up', maxPerPass: 1, overflow: 'default' } },
    { overlap: 'parallel' }, { identityBasis: 'server-date' }, { revisionPolicy: 'immediate' },
    { recurrence: { kind: 'daily', startDate: '2024-01-01', at: '09:00', everyDays: 0 } },
    { recurrence: { kind: 'daily', startDate: '2024-01-01', at: '09:00', everyDays: 1.5 } },
    { recurrence: { kind: 'weekly', startDate: '2024-01-01', at: '09:00', weekdays: [], everyWeeks: 1 } },
    { recurrence: { kind: 'weekly', startDate: '2024-01-01', at: '09:00', weekdays: [1, 1], everyWeeks: 1 } },
    { recurrence: { kind: 'weekly', startDate: '2024-01-01', at: '09:00', weekdays: [7], everyWeeks: 1 } },
    { recurrence: { kind: 'monthly', startDate: '2024-01-01', at: '09:00', dayOfMonth: 31, everyMonths: 1 } },
    { recurrence: { kind: 'monthly', startDate: '2024-01-01', at: '09:00', dayOfMonth: 32, everyMonths: 1, missingDate: 'skip' } },
  ];
  for (const fields of cases) assert.throws(() => validateCalendar(Object.assign(definition(), fields), rules, bounds), { code: 'INVALID_CALENDAR' });
});

test('dates and absolute instants reject normalization, seconds in civil time and implicit offsets', () => {
  for (const effectiveFrom of ['2024-01-01T00:00:00', '2024-01-01T00:00Z', '2024-01-01 00:00:00Z']) assert.throws(() => validateCalendar(definition({ effectiveFrom }), rules, bounds), { code: 'INVALID_CALENDAR' });
  for (const at of ['24:00', '09:00:00', '09:00Z', '9:00']) assert.throws(() => validateCalendar(definition({ recurrence: { kind: 'daily', startDate: '2024-01-01', at, everyDays: 1 } }), rules, bounds), { code: 'INVALID_CALENDAR' });
  for (const startDate of ['2024-02-30', '2025-02-29']) assert.throws(() => validateCalendar(definition({ recurrence: { kind: 'daily', startDate, at: '09:00', everyDays: 1 } }), rules, bounds), { code: 'INVALID_CALENDAR_LOCAL' });
  assert.throws(() => validateCalendar(definition({ recurrence: { kind: 'daily', startDate: '2024-01-01T00:00', at: '09:00', everyDays: 1 } }), rules, bounds), { code: 'INVALID_CALENDAR' });
  for (const instant of ['2024-01-01T00:00:60Z', '2024-01-01T00:00:00+24:00', '2024-01-01T00:00:00+00:60']) assert.throws(() => calendarInstant(instant), { code: 'INVALID_CALENDAR' });
  assert.throws(() => calendarInstant('2024-02-30T00:00:00Z'), { code: 'INVALID_CALENDAR_LOCAL' });
  assert.equal(calendarInstant('2024-02-29T09:00:00+05:30'), Date.parse('2024-02-29T03:30:00Z'));
  assert.throws(() => validateCalendar(definition({ stop: { until: '2024-01-01T00:00:00Z', maxNominalOccurrences: 3 } }), rules, bounds), { code: 'INVALID_CALENDAR' });
});

test('one-time occurrences expose future due time and do not replay an accepted tombstone', () => {
  const d = definition({ recurrence: { kind: 'once', atLocal: '2024-01-01T09:00' } });
  const before = evaluate(d, '2024-01-01T08:00:00Z');
  assert.deepEqual(before.selected, []); assert.equal(before.nextRunAt, '2024-01-01T09:00:00.000Z');
  assert.equal(before.coverage.complete, true); assert.equal(before.coverage.nominalSlots, 1);
  const due = evaluate(d, '2024-01-01T09:00:00Z');
  assert.deepEqual(instants(due.selected), ['2024-01-01T09:00:00.000Z']);
  const consumed = evaluate(d, '2024-01-01T10:00:00Z', { records: [record(due.selected[0]!)] });
  assert.deepEqual(consumed.selected, []); assert.equal(consumed.nextRunAt, undefined);
});

test('leap-day one-time schedules resolve while nonexistent leap days fail explicitly', () => {
  const d = definition({ effectiveFrom: '2024-02-01T00:00:00Z', timeZone: 'Asia/Kolkata', recurrence: { kind: 'once', atLocal: '2024-02-29T09:00' }, stop: { until: '2024-03-01T00:00:00Z', maxNominalOccurrences: 1 } });
  assert.deepEqual(instants(evaluate(d, '2024-02-29T04:00:00Z').selected), ['2024-02-29T03:30:00.000Z']);
  assert.throws(() => validateCalendar({ ...d, recurrence: { kind: 'once', atLocal: '2025-02-29T09:00' } }, rules, bounds), { code: 'INVALID_CALENDAR_LOCAL' });
});

test('daily wall-clock recurrence preserves civil time over 23-hour and 25-hour days', () => {
  const spring = definition({ timeZone: 'America/New_York', effectiveFrom: '2024-03-09T00:00:00Z', recurrence: { kind: 'daily', startDate: '2024-03-09', at: '09:00', everyDays: 1 }, missed: catchAll, stop: { until: '2024-03-11T00:00:00Z', maxNominalOccurrences: 2 } });
  const autumn = definition({ ...spring, effectiveFrom: '2024-11-02T00:00:00Z', recurrence: { kind: 'daily', startDate: '2024-11-02', at: '09:00', everyDays: 1 }, stop: { until: '2024-11-04T00:00:00Z', maxNominalOccurrences: 2 } });
  const short = evaluate(spring, '2024-03-10T15:00:00Z').selected;
  const long = evaluate(autumn, '2024-11-03T15:00:00Z').selected;
  assert.deepEqual(localTimes(short), ['2024-03-09T09:00', '2024-03-10T09:00']);
  assert.deepEqual(instants(short), ['2024-03-09T14:00:00.000Z', '2024-03-10T13:00:00.000Z']);
  assert.deepEqual(instants(long), ['2024-11-02T13:00:00.000Z', '2024-11-03T14:00:00.000Z']);
  assert.equal(Date.parse(short[1]!.instant!) - Date.parse(short[0]!.instant!), 23 * 3600000);
  assert.equal(Date.parse(long[1]!.instant!) - Date.parse(long[0]!.instant!), 25 * 3600000);
});

test('monthly last-day policy preserves the original day 31 through leap and nonleap February', () => {
  for (const [year, lastDay] of [[2024, 29], [2025, 28]]) {
    const d = definition({ effectiveFrom: `${year}-01-01T00:00:00Z`, recurrence: { kind: 'monthly', startDate: `${year}-01-31`, at: '09:00', dayOfMonth: 31, everyMonths: 1, missingDate: 'last-day' }, missed: catchAll, stop: { until: `${year}-04-01T00:00:00Z`, maxNominalOccurrences: 3 } });
    const result = evaluate(d, `${year}-03-31T12:00:00Z`);
    assert.deepEqual(localTimes(result.selected), [`${year}-01-31T09:00`, `${year}-02-${lastDay}T09:00`, `${year}-03-31T09:00`]);
    assert.equal(result.selected[1]!.requestedLocal, `${year}-02-31T09:00`);
    assert.equal(result.coverage.complete, true); assert.equal(result.coverage.nominalSlots, 3);
  }
});

test('monthly missing-date skips consume nominal stop slots without creating a March substitute', () => {
  const d = definition({ recurrence: { kind: 'monthly', startDate: '2024-01-31', at: '09:00', dayOfMonth: 31, everyMonths: 1, missingDate: 'skip' }, missed: catchAll, stop: { until: '2024-04-01T00:00:00Z', maxNominalOccurrences: 3 } });
  const result = evaluate(d, '2024-03-31T12:00:00Z');
  assert.deepEqual(localTimes(result.selected), ['2024-01-31T09:00', '2024-03-31T09:00']);
  assert.equal(result.decisions.length, 1); assert.equal(result.decisions[0]!.reason, 'invalid-date-skipped');
  assert.equal(result.decisions[0]!.occurrence.requestedLocal, '2024-02-31T09:00');
  assert.equal(result.decisions[0]!.occurrence.checkpointLocal, '2024-02-29T09:00');
  const capped = evaluate({ ...d, stop: { ...d.stop, maxNominalOccurrences: 2 } }, '2024-03-31T12:00:00Z');
  assert.deepEqual(localTimes(capped.selected), ['2024-01-31T09:00']); assert.equal(capped.coverage.nominalSlots, 2);
});

test('weekly everyWeeks is anchored to the supplied start date and preserves caller inputs', () => {
  const d = definition({ effectiveFrom: '2024-01-03T00:00:00Z', recurrence: { kind: 'weekly', startDate: '2024-01-03', at: '09:00', weekdays: [3, 1], everyWeeks: 2 }, missed: catchAll, stop: { until: '2024-01-24T00:00:00Z', maxNominalOccurrences: 4 } });
  const result = evaluate(d, '2024-01-23T12:00:00Z');
  assert.deepEqual(localTimes(result.selected), ['2024-01-03T09:00', '2024-01-08T09:00', '2024-01-17T09:00', '2024-01-22T09:00']);
  assert.equal(result.coverage.nominalSlots, 4);
  assert.equal(d.recurrence.kind, 'weekly'); if (d.recurrence.kind === 'weekly') assert.deepEqual(d.recurrence.weekdays, [3, 1]);
});

test('supplied exclusions and pinned holiday coverage apply to resolved local dates', () => {
  const d = definition({ missed: catchAll, excludedResolvedDates: ['2024-01-02'], holidays: { kind: 'skip', calendarId: 'synthetic-business-calendar', revision: 'fixture-v1', dates: ['2024-01-01'], coverage: { from: '2024-01-01', to: '2024-01-03' }, basis: 'resolved-local-date' } });
  const result = evaluate(d, '2024-01-03T12:00:00Z');
  assert.deepEqual(localTimes(result.selected), ['2024-01-03T09:00']);
  assert.deepEqual(result.decisions.map(decision => decision.reason), ['holiday', 'excluded']);
  const monthly = definition({ recurrence: { kind: 'monthly', startDate: '2024-01-31', at: '09:00', dayOfMonth: 31, everyMonths: 1, missingDate: 'last-day' }, missed: catchAll, excludedResolvedDates: ['2024-02-29'], stop: { until: '2024-04-01T00:00:00Z', maxNominalOccurrences: 3 } });
  const clamped = evaluate(monthly, '2024-03-31T12:00:00Z');
  assert.deepEqual(localTimes(clamped.selected), ['2024-01-31T09:00', '2024-03-31T09:00']);
  assert.equal(clamped.decisions[0]!.occurrence.requestedLocal, '2024-02-31T09:00');
  assert.equal(clamped.decisions[0]!.occurrence.resolvedLocal, '2024-02-29T09:00');
  assert.equal(clamped.decisions[0]!.reason, 'excluded');
});

test('holiday revision, basis and complete coverage cannot be inferred', () => {
  const holiday = { kind: 'skip' as const, calendarId: 'synthetic-calendar', revision: 'v1', dates: [] as string[], coverage: { from: '2024-01-01', to: '2024-01-02' }, basis: 'resolved-local-date' as const };
  assert.throws(() => evaluate(definition({ holidays: holiday }), '2024-01-01T12:00:00Z'), { code: 'CALENDAR_HOLIDAY_COVERAGE' });
  for (const fields of [{ revision: '' }, { calendarId: '' }, { basis: 'requested-local-date' }, { dates: ['2024-01-03'] }, { coverage: { from: '2024-01-03', to: '2024-01-01' } }]) assert.throws(() => validateCalendar(Object.assign(definition(), { holidays: { ...holiday, ...fields } }), rules, bounds), { code: 'INVALID_CALENDAR' });
});

test('DST gaps are explicitly skipped or rejected and still count as nominal slots', () => {
  const d = definition({ timeZone: 'America/New_York', effectiveFrom: '2024-03-10T00:00:00Z', recurrence: { kind: 'once', atLocal: '2024-03-10T02:30' }, stop: { until: '2024-03-11T00:00:00Z', maxNominalOccurrences: 1 } });
  const skipped = evaluate(d, '2024-03-10T12:00:00Z');
  assert.deepEqual(skipped.selected, []); assert.equal(skipped.decisions[0]!.reason, 'gap-skipped');
  assert.equal(skipped.coverage.nominalSlots, 1);
  assert.throws(() => evaluate({ ...d, dst: { gap: 'reject', overlap: 'earlier' } }, '2024-03-10T12:00:00Z'), { code: 'CALENDAR_GAP_REJECTED' });
});

test('DST folds have explicit earlier, later, both and reject behavior with stable fold identity', () => {
  const d = definition({ timeZone: 'America/New_York', effectiveFrom: '2024-11-03T00:00:00Z', recurrence: { kind: 'once', atLocal: '2024-11-03T01:30' }, missed: catchAll, dst: { gap: 'skip', overlap: 'both' }, identityBasis: 'local-date', stop: { until: '2024-11-04T00:00:00Z', maxNominalOccurrences: 1 } });
  const both = evaluate(d, '2024-11-03T07:00:00Z');
  assert.deepEqual(instants(both.selected), ['2024-11-03T05:30:00.000Z', '2024-11-03T06:30:00.000Z']);
  assert.deepEqual(both.selected.map(occurrence => occurrence.fold), [0, 1]);
  assert.notEqual(both.selected[0]!.id, both.selected[1]!.id); assert.equal(both.coverage.nominalSlots, 1);
  const earlier = evaluate({ ...d, dst: { gap: 'skip', overlap: 'earlier' } }, '2024-11-03T07:00:00Z');
  const later = evaluate({ ...d, dst: { gap: 'skip', overlap: 'later' } }, '2024-11-03T07:00:00Z');
  assert.equal(earlier.selected[0]!.id, both.selected[0]!.id); assert.equal(later.selected[0]!.id, earlier.selected[0]!.id);
  assert.equal(later.selected[0]!.fold, 1);
  assert.throws(() => evaluate({ ...d, dst: { gap: 'skip', overlap: 'reject' } }, '2024-11-03T07:00:00Z'), { code: 'CALENDAR_OVERLAP_REJECTED' });
  const consumedFirst = evaluate(d, '2024-11-03T07:00:00Z', { records: [record(both.selected[0]!)] });
  assert.deepEqual(instants(consumedFirst.selected), ['2024-11-03T06:30:00.000Z']);
  assert.deepEqual(evaluate({ ...d, dst: { gap: 'skip', overlap: 'later' } }, '2024-11-03T07:00:00Z', { records: [record(earlier.selected[0]!)] }).selected, []);
});

test('monthly business-period identity rejects colliding daily and weekly recurrence', () => {
  assert.throws(() => validateCalendar(definition({ identityBasis: 'local-month' }), rules, bounds), { code: 'INVALID_CALENDAR' });
  assert.throws(() => validateCalendar(definition({ identityBasis: 'local-month', recurrence: { kind: 'weekly', startDate: '2024-01-01', at: '09:00', everyWeeks: 1, weekdays: [1] } }), rules, bounds), { code: 'INVALID_CALENDAR' });
});

test('absolute cutoff inside a repeated hour retains the earlier valid fold', () => {
  const d = definition({ timeZone: 'America/New_York', effectiveFrom: '2024-11-03T00:00:00Z', recurrence: { kind: 'once', atLocal: '2024-11-03T01:30' }, dst: { gap: 'skip', overlap: 'both' }, missed: catchAll, stop: { until: '2024-11-03T06:00:00Z', maxNominalOccurrences: 1 } });
  const result = evaluate(d, '2024-11-03T05:45:00Z');
  assert.deepEqual(instants(result.selected), ['2024-11-03T05:30:00.000Z']);
  assert.equal(result.expired, false); assert.equal(result.coverage.nominalSlots, 1);
});

test('cutoff is an absolute exclusive instant and does not discard its preceding civil minute', () => {
  const d = definition({ recurrence: { kind: 'once', atLocal: '2024-01-01T09:00' }, stop: { until: '2024-01-01T09:00:30Z', maxNominalOccurrences: 1 } });
  assert.deepEqual(instants(evaluate(d, '2024-01-01T09:00:15Z').selected), ['2024-01-01T09:00:00.000Z']);
  const exact = { ...d, stop: { ...d.stop, until: '2024-01-01T09:00:00Z' } };
  assert.deepEqual(evaluate(exact, '2024-01-01T08:59:00Z').selected, []);
  assert.equal(evaluate(exact, '2024-01-01T08:59:00Z').nextRunAt, undefined);
});

test('bounded evaluation returns complete coverage or fails rather than silently truncating', () => {
  const d = definition({ missed: { kind: 'catch-up', maxPerPass: 3, overflow: 'retain' } });
  const complete = evaluate(d, '2024-01-03T12:00:00Z', { bounds: { maxNominalSlots: 3, maxCalendarDays: 3 } });
  assert.equal(complete.coverage.complete, true); assert.equal(complete.coverage.nominalSlots, 3); assert.equal(complete.selected.length, 3);
  assert.throws(() => evaluate(d, '2024-01-01T12:00:00Z', { bounds: { maxNominalSlots: 3, maxCalendarDays: 2 } }), { code: 'CALENDAR_EVALUATION_LIMIT' });
  assert.throws(() => evaluate(d, '2024-01-01T12:00:00Z', { bounds: { maxNominalSlots: 2, maxCalendarDays: 3 } }), { code: 'INVALID_CALENDAR' });
  assert.throws(() => validateCalendar(d, rules, { maxNominalSlots: 0, maxCalendarDays: 3 }), { code: 'INVALID_CALENDAR' });
  assert.throws(() => evaluate({ ...d, rulesRevision: 'an-unreviewed-rules-revision' }, '2024-01-01T12:00:00Z'), { code: 'CALENDAR_RULES_CHANGED' });
});

test('missed skip applies its declared grace boundary and records every lost occurrence', () => {
  const d = definition({ missed: { kind: 'skip', graceMs: 60000 } });
  const boundary = evaluate(d, '2024-01-03T09:01:00Z');
  assert.deepEqual(localTimes(boundary.selected), ['2024-01-03T09:00']);
  assert.deepEqual(boundary.decisions.map(decision => decision.reason), ['missed-grace', 'missed-grace']);
  const outside = evaluate(d, '2024-01-03T09:01:00.001Z');
  assert.deepEqual(outside.selected, []); assert.equal(outside.decisions.length, 3);
});

test('coalescing retains latest scheduled identity and names all represented occurrence identities', () => {
  const result = evaluate(definition(), '2024-01-03T12:00:00Z');
  assert.deepEqual(localTimes(result.selected), ['2024-01-03T09:00']);
  assert.equal(result.selected[0]!.instant, '2024-01-03T09:00:00.000Z');
  assert.equal(result.decisions.length, 2); assert.ok(result.decisions.every(decision => decision.status === 'coalesced'));
  const accounted = [...result.decisions.map(decision => decision.occurrence.id), result.selected[0]!.id];
  assert.deepEqual(result.representedIds, accounted); assert.equal(new Set(accounted).size, 3);
});

test('bounded catch-up retains backlog while skip overflow prevents later replay', () => {
  const retainedDefinition = definition({ missed: { kind: 'catch-up', maxPerPass: 2, overflow: 'retain' } });
  const first = evaluate(retainedDefinition, '2024-01-03T12:00:00Z');
  assert.deepEqual(localTimes(first.selected), ['2024-01-01T09:00', '2024-01-02T09:00']);
  assert.equal(first.decisions[0]!.status, 'deferred'); assert.equal(first.decisions[0]!.reason, 'catch-up-overflow');
  const records = [...first.selected.map(occurrence => record(occurrence)), record(first.decisions[0]!.occurrence, 'deferred')];
  assert.deepEqual(localTimes(evaluate(retainedDefinition, '2024-01-03T12:00:00Z', { records }).selected), ['2024-01-03T09:00']);
  const skippedDefinition = { ...retainedDefinition, missed: { kind: 'catch-up' as const, maxPerPass: 2, overflow: 'skip' as const } };
  const skipped = evaluate(skippedDefinition, '2024-01-03T12:00:00Z');
  assert.equal(skipped.decisions[0]!.status, 'skipped');
  const skippedRecords = [...skipped.selected.map(occurrence => record(occurrence)), record(skipped.decisions[0]!.occurrence, 'skipped')];
  assert.deepEqual(evaluate(skippedDefinition, '2024-01-03T12:00:00Z', { records: skippedRecords }).selected, []);
});

test('expired cutoff authorizes no catch-up despite an unchanged schedule and records skipped intent', () => {
  for (const missed of [{ kind: 'coalesce' as const }, { kind: 'catch-up' as const, maxPerPass: 2, overflow: 'retain' as const }]) {
    const result = evaluate(definition({ missed }), '2024-01-04T00:00:00Z');
    assert.equal(result.expired, true); assert.deepEqual(result.selected, []); assert.equal(result.nextRunAt, undefined);
    assert.equal(result.decisions.length, 3); assert.ok(result.decisions.every(decision => decision.reason === 'schedule-expired'));
  }
});

test('duplicate tombstones and clock rollback cannot readmit consumed business intent', () => {
  const d = definition({ missed: catchAll });
  const all = evaluate(d, '2024-01-03T12:00:00Z');
  for (const status of ['admitted', 'delivered', 'accepted', 'skipped', 'coalesced', 'obsolete'] as const) {
    const records = all.selected.map(occurrence => record(occurrence, status));
    const repeated = evaluate(d, '2024-01-03T12:00:00Z', { records }); assert.deepEqual(repeated.selected, []); assert.deepEqual(repeated.decisions, []);
    const rollback = evaluate(d, '2024-01-01T08:00:00Z', { records }); assert.deepEqual(rollback.selected, []); assert.equal(rollback.nextRunAt, undefined);
  }
});

test('prospective time revision preserves declared date identity and permits explicit finer intent', () => {
  const original = definition({ identityBasis: 'local-date', missed: catchAll });
  const completed = evaluate(original, '2024-01-02T09:00:00Z').selected.map(occurrence => record(occurrence));
  const revised = { ...original, effectiveFrom: '2024-01-02T09:30:00Z', recurrence: { kind: 'daily' as const, startDate: '2024-01-01', at: '10:00', everyDays: 1 } };
  const stable = evaluate(revised, '2024-01-02T10:00:00Z', { records: completed });
  assert.deepEqual(stable.selected, []); assert.equal(stable.nextRunAt, '2024-01-03T10:00:00.000Z');
  const finerOriginal = { ...original, identityBasis: 'local-date-time' as const };
  const finerRecords = evaluate(finerOriginal, '2024-01-02T09:00:00Z').selected.map(occurrence => record(occurrence));
  const finerRevision = { ...revised, identityBasis: 'local-date-time' as const };
  const newIntent = evaluate(finerRevision, '2024-01-02T10:00:00Z', { records: finerRecords });
  assert.deepEqual(localTimes(newIntent.selected), ['2024-01-02T10:00']);
  assert.notEqual(newIntent.selected[0]!.id, finerRecords[1]!.id);
});

test('active overlap windows skip only their declared instant range', () => {
  const result = evaluate(definition({ missed: catchAll, overlap: 'skip' }), '2024-01-03T12:00:00Z', { skipOverlapWindows: [{ from: '2024-01-01T09:00:00Z', to: '2024-01-02T09:00:00Z' }] });
  assert.deepEqual(localTimes(result.selected), ['2024-01-03T09:00']);
  assert.deepEqual(result.decisions.map(decision => decision.reason), ['active-run-overlap', 'active-run-overlap']);
});

test('exceptional anchor dates before the effective window do not reject a current schedule', () => {
  const gapBeforeWindow = definition({
    timeZone: 'America/New_York', effectiveFrom: '2024-03-11T00:00:00Z',
    recurrence: { kind: 'daily', startDate: '2024-03-09', at: '02:30', everyDays: 1 },
    dst: { gap: 'reject', overlap: 'earlier' }, missed: catchAll,
    stop: { until: '2024-03-12T00:00:00Z', maxNominalOccurrences: 3 },
  });
  const afterGap = evaluate(gapBeforeWindow, '2024-03-11T12:00:00Z');
  assert.deepEqual(localTimes(afterGap.selected), ['2024-03-11T02:30']);
  assert.deepEqual(instants(afterGap.selected), ['2024-03-11T06:30:00.000Z']);
  assert.deepEqual(afterGap.decisions, []); assert.equal(afterGap.coverage.nominalSlots, 3);

  const holidayBeforeWindow = definition({
    effectiveFrom: '2024-01-02T00:00:00Z', missed: catchAll,
    holidays: { kind: 'skip', calendarId: 'synthetic-effective-calendar', revision: 'v1', dates: ['2024-01-02'], coverage: { from: '2024-01-02', to: '2024-01-03' }, basis: 'resolved-local-date' },
  });
  const covered = evaluate(holidayBeforeWindow, '2024-01-03T12:00:00Z');
  assert.deepEqual(localTimes(covered.selected), ['2024-01-03T09:00']);
  assert.equal(covered.decisions.length, 1); assert.equal(covered.decisions[0]!.reason, 'holiday');
  assert.equal(covered.decisions[0]!.occurrence.resolvedLocal, '2024-01-02T09:00');
});

test('future holiday and excluded one-time intent retain an audit wakeup rather than exhausting early', () => {
  const once = definition({ recurrence: { kind: 'once', atLocal: '2024-01-05T09:00' }, stop: { until: '2024-01-06T00:00:00Z', maxNominalOccurrences: 1 } });
  const holiday = { ...once, holidays: { kind: 'skip' as const, calendarId: 'synthetic-future-calendar', revision: 'v1', dates: ['2024-01-05'], coverage: { from: '2024-01-05', to: '2024-01-05' }, basis: 'resolved-local-date' as const } };
  const excluded = { ...once, excludedResolvedDates: ['2024-01-05'] };
  for (const [d, reason] of [[holiday, 'holiday'], [excluded, 'excluded']] as const) {
    const before = evaluate(d, '2024-01-01T12:00:00Z');
    assert.deepEqual(before.selected, []); assert.deepEqual(before.decisions, []);
    assert.equal(before.nextRunAt, '2024-01-05T09:00:00.000Z'); assert.equal(before.expired, false);
    const due = evaluate(d, '2024-01-05T09:00:00Z');
    assert.deepEqual(due.selected, []); assert.equal(due.decisions.length, 1); assert.equal(due.decisions[0]!.reason, reason);
    assert.equal(due.nextRunAt, undefined);
  }
});

test('a future gap retains the transition checkpoint and cannot dispatch nonexistent civil time', () => {
  const d = definition({
    timeZone: 'America/New_York', effectiveFrom: '2024-03-10T00:00:00Z',
    recurrence: { kind: 'once', atLocal: '2024-03-10T02:30' },
    stop: { until: '2024-03-11T00:00:00Z', maxNominalOccurrences: 1 },
  });
  const before = evaluate(d, '2024-03-10T06:30:00Z');
  assert.deepEqual(before.selected, []); assert.deepEqual(before.decisions, []);
  assert.equal(before.nextRunAt, '2024-03-10T07:00:00.000Z'); assert.equal(before.expired, false);
  const due = evaluate(d, '2024-03-10T07:00:00Z');
  assert.deepEqual(due.selected, []); assert.equal(due.decisions.length, 1); assert.equal(due.decisions[0]!.reason, 'gap-skipped');
  assert.equal(due.decisions[0]!.occurrence.instant, undefined); assert.equal(due.nextRunAt, undefined);
});

test('a future missing monthly date retains its last-day audit checkpoint', () => {
  const d = definition({
    effectiveFrom: '2024-02-01T00:00:00Z',
    recurrence: { kind: 'monthly', startDate: '2024-02-01', at: '09:00', dayOfMonth: 31, everyMonths: 1, missingDate: 'skip' },
    stop: { until: '2024-03-01T00:00:00Z', maxNominalOccurrences: 1 },
  });
  const before = evaluate(d, '2024-02-28T12:00:00Z');
  assert.deepEqual(before.selected, []); assert.deepEqual(before.decisions, []);
  assert.equal(before.nextRunAt, '2024-02-29T09:00:00.000Z'); assert.equal(before.expired, false);
  const due = evaluate(d, '2024-02-29T09:00:00Z');
  assert.deepEqual(due.selected, []); assert.equal(due.decisions[0]!.reason, 'invalid-date-skipped');
  assert.equal(due.decisions[0]!.occurrence.requestedLocal, '2024-02-31T09:00'); assert.equal(due.nextRunAt, undefined);
});

test('null and non-object schedule definitions fail the calendar contract', () => {
  for (const input of [null, [], ['calendar'], 'UTC', {}, 1, false]) {
    const d = input as unknown as CalendarDefinition;
    assert.throws(() => validateCalendar(d, rules, bounds), { code: 'INVALID_CALENDAR' });
    assert.throws(() => evaluate(d, '2024-01-01T12:00:00Z'), { code: 'INVALID_CALENDAR' });
  }
});

test('a long monthly interval stops at its horizon before requesting an unqualified later year', () => {
  const d = definition({
    recurrence: { kind: 'monthly', startDate: '2024-01-01', at: '09:00', dayOfMonth: 31, everyMonths: 1200, missingDate: 'skip' },
    stop: { until: '2025-01-01T00:00:00Z', maxNominalOccurrences: 2 },
  });
  const before = evaluate(d, '2024-01-01T12:00:00Z');
  assert.deepEqual(before.selected, []); assert.equal(before.nextRunAt, '2024-01-31T09:00:00.000Z');
  assert.equal(before.coverage.complete, true); assert.equal(before.coverage.nominalSlots, 1);
  assert.deepEqual(localTimes(evaluate(d, '2024-01-31T12:00:00Z').selected), ['2024-01-31T09:00']);
});
