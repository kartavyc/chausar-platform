// Chausar venture launcher, money (Ink v2 wave 4, package 4J5): calendar arithmetic for recurring invoices and bills.
// A schedule keeps the day of the month it started on, clamped to a shorter month's last day (31 October, then 30
// November, then 31 December). Calendar parts only, on 'YYYY-MM-DD' text; never an amount.
import { whole } from './goal-plans.ts';
import type { IsoDate } from '../contracts.ts';

/** Months between two dates of a schedule. */
export const STEP_MONTHS: Readonly<Record<'monthly' | 'quarterly', number>> = Object.freeze({ monthly: 1, quarterly: 3 });

/** The last day of a month, from its year and its 1-based month number. */
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A date moved by whole months onto a day of the month, clamped to that month's last day. */
export function addMonthsOn(iso: IsoDate, months: number, day: number): IsoDate {
  const index = whole(iso.slice(0, 4)) * 12 + whole(iso.slice(5, 7)) - 1 + months;
  const year = Math.floor(index / 12), month = index % 12 + 1;
  const kept = Math.min(day, lastDay(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(kept).padStart(2, '0')}`;
}

/** The k-th date of a schedule (0 is its start), keeping the start's day of the month. */
export function scheduleDate(startOn: IsoDate, frequency: 'monthly' | 'quarterly', k: number): IsoDate {
  return addMonthsOn(startOn, k * STEP_MONTHS[frequency], whole(startOn.slice(8, 10)));
}
