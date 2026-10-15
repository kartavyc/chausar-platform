// Calendar dates for money documents. UTC calendar arithmetic only; no money here.
import { check } from '../../contracts.ts';
import { validDate } from '../../memory.ts';
import type { IsoDate } from '../contracts.ts';

/** Today's UTC calendar date from the injected clock. */
export function todayUtc(clock: () => Date): IsoDate {
  return clock().toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' plus a whole number of days, on the UTC calendar. */
export function addDaysUtc(iso: IsoDate, days: number): IsoDate {
  check(validDate(iso), 'INVALID_VENTURE_REQUEST', 'Use a date like 2026-10-15.');
  check(Number.isInteger(days) && days >= 0 && days <= 3660, 'INVALID_VENTURE_REQUEST', 'Use a whole number of days.');
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
