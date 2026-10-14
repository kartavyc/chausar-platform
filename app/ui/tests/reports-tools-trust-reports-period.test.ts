import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultChoice, fyStartYear, indiaToday, periodOf, type PeriodChoice } from '../src/screens/reports/period.ts';

const today = '2026-10-14';
const choose = (part: Partial<PeriodChoice>): PeriodChoice => ({ ...defaultChoice(today), ...part });

test('the period choices turn into calendar dates; the financial year to date is left to the engine', () => {
  assert.deepEqual(periodOf(choose({ kind: 'fytd' }), today), { ok: true, period: undefined });
  assert.deepEqual(periodOf(choose({ kind: 'last-fy' }), today), { ok: true, period: { from: '2025-04-01', to: '2026-03-31' } });
  assert.deepEqual(periodOf(choose({ kind: 'last-fy' }), '2027-02-10'), { ok: true, period: { from: '2025-04-01', to: '2026-03-31' } });
  assert.deepEqual(periodOf(choose({ kind: 'month', month: '2024-02' }), today), { ok: true, period: { from: '2024-02-01', to: '2024-02-29' } });
  assert.deepEqual(periodOf(choose({ kind: 'quarter', fyStart: '2026', quarter: '2' }), today), { ok: true, period: { from: '2026-07-01', to: '2026-09-30' } });
  assert.deepEqual(periodOf(choose({ kind: 'quarter', fyStart: '2025', quarter: '4' }), today), { ok: true, period: { from: '2026-01-01', to: '2026-03-31' } });
  assert.deepEqual(periodOf(choose({ kind: 'custom', from: '2026-09-01', to: '2026-09-30' }), today), { ok: true, period: { from: '2026-09-01', to: '2026-09-30' } });
});

test('bad dates, the wrong order and periods over two years are refused before any request', () => {
  assert.deepEqual(periodOf(choose({ kind: 'custom', from: '2026-02-30', to: '2026-03-01' }), today), { ok: false, problem: 'badDate' });
  assert.deepEqual(periodOf(choose({ kind: 'custom', from: '', to: '2026-03-01' }), today), { ok: false, problem: 'badDate' });
  assert.deepEqual(periodOf(choose({ kind: 'custom', from: '2026-09-30', to: '2026-09-01' }), today), { ok: false, problem: 'badOrder' });
  assert.deepEqual(periodOf(choose({ kind: 'custom', from: '2023-01-01', to: '2026-01-01' }), today), { ok: false, problem: 'tooLong' });
  assert.deepEqual(periodOf(choose({ kind: 'month', month: '2026-13' }), today), { ok: false, problem: 'badDate' });
  assert.deepEqual(periodOf(choose({ kind: 'quarter', fyStart: '20x6' }), today), { ok: false, problem: 'badDate' });
});

test('today is India Standard Time and the financial year starts in April', () => {
  assert.equal(indiaToday(Date.parse('2026-03-31T19:00:00Z')), '2026-04-01');
  assert.equal(fyStartYear('2026-03-31'), 2025); assert.equal(fyStartYear('2026-04-01'), 2026);
  assert.deepEqual(defaultChoice(today), { kind: 'fytd', month: '2026-10', fyStart: '2026', quarter: '1', from: '2026-04-01', to: '2026-10-14' });
});
