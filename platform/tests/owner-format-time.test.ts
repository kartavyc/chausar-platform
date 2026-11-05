import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { formatAge, formatDay, formatElapsed, formatMoment, formatMonth, formatTime, ownerZone } from '../runtime/owner-format.ts';

// One-shot B2 task 2: days, times and durations as the owner reads them. An instant reads in the business's zone, a
// calendar day ('YYYY-MM-DD') never shifts, and nothing reads the computer's own zone.

const DAY_AND_TIME_CASES = (format: typeof import('../runtime/owner-format.ts')) => [
  format.formatDay('2026-11-02T19:20:00.000Z', 'Asia/Kolkata'),
  format.formatDay('2026-11-03', 'America/New_York'),
  format.formatDay('2026-11-03', 'Asia/Kolkata'),
  format.formatDay('soon', 'UTC'),
  format.formatTime('2026-11-02T19:11:00.000Z', 'Asia/Kolkata'),
  format.formatTime('2026-11-03T15:35:00.000Z', 'Asia/Kolkata'),
  format.formatTime('2026-11-03T06:30:00.000Z', 'Asia/Kolkata'),
  format.formatMoment('2026-11-02T19:11:00.000Z', 'Asia/Kolkata'),
  format.formatMoment('2026-11-02T19:11:00.000Z', 'UTC'),
  format.formatMonth('2026-11', 'long'),
  format.formatMonth('2026-11', 'short'),
];
const EXPECTED = [
  '3 Nov 2026', '3 Nov 2026', '3 Nov 2026', 'soon', '12:41 am', '9:05 pm', '12:00 pm', '3 Nov 2026, 12:41 am',
  '2 Nov 2026, 7:11 pm', 'November 2026', 'Nov',
];

test('days and times read in the zone given: an instant at 00:50 IST on 3 Nov is 3 Nov; a calendar day never shifts', async () => {
  assert.deepEqual(DAY_AND_TIME_CASES(await import('../runtime/owner-format.ts')), EXPECTED);
  assert.equal(formatDay('2026-11-02T19:20:00.000Z', 'Asia/Kolkata'), '3 Nov 2026');
  assert.equal(formatDay(new Date('2026-11-02T19:20:00.000Z'), 'Asia/Kolkata'), '3 Nov 2026');
  assert.equal(formatTime('2026-11-02T19:11:00.000Z', 'Asia/Kolkata'), '12:41 am');
  assert.equal(formatMoment('2026-11-02T19:11:00.000Z', 'Asia/Kolkata'), '3 Nov 2026, 12:41 am');
  assert.equal(formatTime('not a time', 'UTC'), 'not a time');
  assert.equal(formatMoment('', 'UTC'), '');
});

test('durations: seconds under ten minutes, then minutes, hours and days; nothing for under a second', () => {
  for (const [ms, words] of [
    [0, ''], [999, ''], [-5000, ''], [45_000, '45 s'], [60_000, '1 min'], [80_000, '1 min 20 s'], [725_000, '12 min'],
    [3_600_000, '1 h'], [3_900_000, '1 h 5 min'], [86_400_000, '1 day'], [183_600_000, '2 days 3 h'], [Number.NaN, ''],
  ] as const) assert.equal(formatElapsed(ms), words, String(ms));
  assert.equal(formatAge('2026-11-03T00:00:00.000Z', '2026-11-03T00:01:20.000Z'), '1 min 20 s');
  assert.equal(formatAge('2026-11-03T00:01:20.000Z', '2026-11-03T00:00:00.000Z'), '');
  assert.equal(formatAge('soon', '2026-11-03T00:00:00.000Z'), '');
});

test('the owner zone comes from the country code; another country or none falls back', () => {
  assert.equal(ownerZone('IN', 'UTC'), 'Asia/Kolkata');
  assert.equal(ownerZone('US', 'UTC'), 'America/New_York');
  assert.equal(ownerZone('XX', 'Europe/Paris'), 'Europe/Paris');
  assert.equal(ownerZone(undefined, 'Europe/Paris'), 'Europe/Paris');
  assert.equal(ownerZone('ZZ', 'UTC'), 'UTC');
});

test('the same strings in a process whose own zone is New York, so nothing reads the computer zone', () => {
  const href = pathToFileURL(join(import.meta.dirname, '../runtime/owner-format.ts')).href;
  const cases = DAY_AND_TIME_CASES.toString().replace(/^\(format[^)]*\) =>/, '(format) =>');
  const script = `const format = await import(${JSON.stringify(href)}); console.log(JSON.stringify((${cases})(format)));`;
  for (const zone of ['America/New_York', 'UTC', 'Pacific/Auckland']) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, TZ: zone } });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), EXPECTED, zone);
  }
});
