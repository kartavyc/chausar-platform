import test from 'node:test';
import assert from 'node:assert/strict';
import { IntlCalendarRules, strictLocal } from '../runtime/calendar-zone.ts';

const options = {
  timeZones: ['UTC', 'America/New_York', 'Australia/Lord_Howe', 'Pacific/Apia', 'Asia/Kolkata'],
  minYear: 2000, maxYear: 2100, maxCachedLocalTimes: 8,
};
const iso = (instants: number[]) => instants.map(instant => new Date(instant).toISOString());

test('installed rules bind an explicit revision, qualified range and original zone aliases', () => {
  const rules = new IntlCalendarRules(options);
  assert.equal(rules.revision, `intl-tzdb:${process.versions.tz};icu:${process.versions.icu}`);
  assert.equal(rules.minYear, 2000); assert.equal(rules.maxYear, 2100);
  const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).resolvedOptions().timeZone;
  assert.equal(rules.canonicalZone('Asia/Kolkata'), expected);
  assert.equal(rules.canonicalZone(expected), expected);
  assert.equal(rules.localAt(Date.parse('2024-02-29T03:30:59.999Z'), 'Asia/Kolkata'), '2024-02-29T09:00');
  assert.throws(() => rules.canonicalZone('US/Eastern'), { code: 'CALENDAR_ZONE_UNSUPPORTED' });
  const aliases = new IntlCalendarRules({ ...options, timeZones: ['Etc/UTC', 'US/Eastern'] });
  assert.equal(aliases.canonicalZone('Etc/UTC'), 'UTC');
  assert.equal(aliases.canonicalZone('US/Eastern'), 'America/New_York');
  assert.equal(aliases.localAt(Date.parse('2024-01-01T05:00:00Z'), 'America/New_York'), '2024-01-01T00:00');
});

test('New York spring gap and autumn folds are resolved without an implicit DST policy', () => {
  const rules = new IntlCalendarRules(options);
  assert.deepEqual(rules.candidates('2024-03-10T02:30', 'America/New_York'), []);
  assert.deepEqual(iso(rules.candidates('2024-11-03T01:30', 'America/New_York')), ['2024-11-03T05:30:00.000Z', '2024-11-03T06:30:00.000Z']);
  for (const instant of rules.candidates('2024-11-03T01:30', 'America/New_York')) assert.equal(rules.localAt(instant, 'America/New_York'), '2024-11-03T01:30');
});

test('daily civil time remains stable across 23-hour and 25-hour days', () => {
  const rules = new IntlCalendarRules(options);
  const spring = ['2024-03-09T09:00', '2024-03-10T09:00'].map(local => rules.candidates(local, 'America/New_York')[0]!);
  const autumn = ['2024-11-02T09:00', '2024-11-03T09:00'].map(local => rules.candidates(local, 'America/New_York')[0]!);
  assert.deepEqual(iso(spring), ['2024-03-09T14:00:00.000Z', '2024-03-10T13:00:00.000Z']);
  assert.deepEqual(iso(autumn), ['2024-11-02T13:00:00.000Z', '2024-11-03T14:00:00.000Z']);
  assert.equal(spring[1]! - spring[0]!, 23 * 60 * 60 * 1000);
  assert.equal(autumn[1]! - autumn[0]!, 25 * 60 * 60 * 1000);
});

test('Lord Howe resolves a half-hour fold and gap rather than assuming a one-hour transition', () => {
  const rules = new IntlCalendarRules(options);
  const fold = rules.candidates('2024-04-07T01:45', 'Australia/Lord_Howe');
  assert.deepEqual(iso(fold), ['2024-04-06T14:45:00.000Z', '2024-04-06T15:15:00.000Z']);
  assert.equal(fold[1]! - fold[0]!, 30 * 60 * 1000);
  assert.deepEqual(rules.candidates('2024-10-06T02:15', 'Australia/Lord_Howe'), []);
});

test('Apia skipped civil day produces no fabricated occurrence and adjacent days resolve', () => {
  const rules = new IntlCalendarRules(options);
  assert.deepEqual(rules.candidates('2011-12-30T12:00', 'Pacific/Apia'), []);
  assert.deepEqual(iso(rules.candidates('2011-12-29T12:00', 'Pacific/Apia')), ['2011-12-29T22:00:00.000Z']);
  assert.deepEqual(iso(rules.candidates('2011-12-31T12:00', 'Pacific/Apia')), ['2011-12-30T22:00:00.000Z']);
});

test('Gregorian leap dates, range endpoints and non-hour offsets roundtrip exactly', () => {
  const rules = new IntlCalendarRules(options);
  assert.deepEqual(iso(rules.candidates('2024-02-29T09:00', 'Asia/Kolkata')), ['2024-02-29T03:30:00.000Z']);
  assert.deepEqual(iso(rules.candidates('2000-02-29T00:00', 'UTC')), ['2000-02-29T00:00:00.000Z']);
  assert.deepEqual(iso(rules.candidates('2000-01-01T00:00', 'UTC')), ['2000-01-01T00:00:00.000Z']);
  assert.deepEqual(iso(rules.candidates('2100-12-31T23:59', 'UTC')), ['2100-12-31T23:59:00.000Z']);
  assert.deepEqual(strictLocal('2024-02-29T09:00', 2000, 2100), { year: 2024, month: 2, day: 29, hour: 9, minute: 0, naive: Date.UTC(2024, 1, 29, 9) });
});

test('civil input rejects impossible dates, ambiguous syntax and unqualified years', () => {
  const rules = new IntlCalendarRules(options);
  for (const local of ['2026-02-30T00:00', '2025-02-29T00:00', '2100-02-29T00:00', '2024-04-31T00:00', '2024-00-01T00:00', '2024-01-00T00:00', '2024-01-01T24:00', '2024-01-01T00:60', '2024-01-01T00:00Z', '2024-01-01T00:00+05:30', '2024-01-01T00:00:00', '2024-1-01T00:00', '2024-01-01 00:00', ' 2024-01-01T00:00', '1999-12-31T23:59', '2101-01-01T00:00']) {
    assert.throws(() => rules.candidates(local, 'UTC'), { code: 'INVALID_CALENDAR_LOCAL' }, local);
  }
  assert.throws(() => strictLocal(null as unknown as string, 2000, 2100), { code: 'INVALID_CALENDAR_LOCAL' });
  const narrow = new IntlCalendarRules({ ...options, minYear: 2024, maxYear: 2024 });
  assert.throws(() => narrow.candidates('2025-01-01T00:00', 'UTC'), { code: 'INVALID_CALENDAR_LOCAL' });
});

test('installed zone and instant validation rejects offset names and ambient fallbacks', () => {
  for (const zone of ['+05:30', '-0400', '+00', 'Not/AZone', '', ' UTC', 'UTC ']) {
    assert.throws(() => new IntlCalendarRules({ ...options, timeZones: [zone] }), { code: 'CALENDAR_ZONE_UNSUPPORTED' }, zone);
  }
  const rules = new IntlCalendarRules(options);
  for (const zone of ['+05:30', 'Etc/UTC', 'Europe/London', undefined]) assert.throws(() => rules.localAt(Date.parse('2024-01-01T00:00Z'), zone as string), { code: 'CALENDAR_ZONE_UNSUPPORTED' });
  for (const instant of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER, Date.parse('1999-12-31T23:59:00Z'), Date.parse('2101-01-01T00:00:00Z')]) assert.throws(() => rules.localAt(instant, 'UTC'), { code: 'CALENDAR_INSTANT_UNSUPPORTED' });
  // Bounds apply to the selected zone's civil date, not the instant's UTC year.
  assert.throws(() => rules.localAt(Date.parse('2000-01-01T00:00:00Z'), 'America/New_York'), { code: 'CALENDAR_INSTANT_UNSUPPORTED' });
});

test('constructor rejects omitted qualification, repeated zones and invalid cache capacities', () => {
  for (const invalid of [{ ...options, minYear: 1999 }, { ...options, maxYear: 2101 }, { ...options, minYear: 2025, maxYear: 2024 }, { ...options, minYear: 2024.5 }, { ...options, timeZones: [] }, { ...options, timeZones: ['UTC', 'UTC'] }, { ...options, maxCachedLocalTimes: -1 }, { ...options, maxCachedLocalTimes: 0.5 }, { ...options, maxCachedLocalTimes: Infinity }]) assert.throws(() => new IntlCalendarRules(invalid), { code: 'INVALID_CALENDAR_RULES' });
  assert.throws(() => new IntlCalendarRules(null as unknown as typeof options), { code: 'INVALID_CALENDAR_RULES' });
  assert.throws(() => strictLocal('2024-01-01T00:00', 1900, 2100), { code: 'INVALID_CALENDAR_RULES' });
});

test('cache honors caller capacity, isolates returned arrays and permits caching to be disabled', t => {
  let roundtrips = 0;
  const original = Intl.DateTimeFormat.prototype.formatToParts;
  t.mock.method(Intl.DateTimeFormat.prototype, 'formatToParts', function (this: Intl.DateTimeFormat, instant?: number | Date) { roundtrips += 1; return original.call(this, instant); });
  const rules = new IntlCalendarRules({ ...options, timeZones: ['UTC'], maxCachedLocalTimes: 1 });
  const first = rules.candidates('2024-01-01T00:00', 'UTC');
  const firstWork = roundtrips; assert.ok(firstWork > 0);
  first[0] = 0;
  assert.deepEqual(iso(rules.candidates('2024-01-01T00:00', 'UTC')), ['2024-01-01T00:00:00.000Z']);
  assert.equal(roundtrips, firstWork);
  rules.candidates('2024-01-02T00:00', 'UTC'); const secondWork = roundtrips;
  rules.candidates('2024-01-01T00:00', 'UTC'); assert.ok(roundtrips > secondWork, 'the first slot was evicted at capacity one');
  const noCache = new IntlCalendarRules({ ...options, timeZones: ['UTC'], maxCachedLocalTimes: 0 });
  noCache.candidates('2024-01-01T00:00', 'UTC'); const noCacheWork = roundtrips;
  noCache.candidates('2024-01-01T00:00', 'UTC'); assert.ok(roundtrips > noCacheWork);
});
