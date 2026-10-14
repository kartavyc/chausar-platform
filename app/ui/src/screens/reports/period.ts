/**
 * The period a report page is asked for. These are calendar dates only: the screen turns
 * a choice into a `{ from, to }` the engine checks again; it never works out a figure.
 * The financial year runs 1 April to 31 March, and "today" is India Standard Time, as the
 * engine's own default period is.
 */
import { isoDate } from './validate.ts';

export type PeriodKind = 'fytd' | 'last-fy' | 'month' | 'quarter' | 'custom';
export const PERIOD_KINDS: readonly PeriodKind[] = ['fytd', 'last-fy', 'month', 'quarter', 'custom'];
export interface PeriodChoice { kind: PeriodKind; month: string; fyStart: string; quarter: '1' | '2' | '3' | '4'; from: string; to: string }
export type Period = { from: string; to: string };
/** `period` undefined means the engine's default, the financial year to date. */
export type PeriodResult = { ok: true; period: Period | undefined } | { ok: false; problem: 'badDate' | 'badOrder' | 'tooLong' };

/** The longest period the engine accepts, in days between the two dates. */
export const MAX_DAYS = 800;
const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;

export function indiaToday(now: number = Date.now()): string { return new Date(now + IST_MS).toISOString().slice(0, 10); }
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const lastDay = (year: number, month: number) => `${pad(year, 4)}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
/** The year in which the financial year containing `date` starts. */
export function fyStartYear(date: string): number { const y = Number(date.slice(0, 4)); return Number(date.slice(5, 7)) >= 4 ? y : y - 1; }
function valid(value: string): boolean { try { isoDate(value, 'period'); return true; } catch { return false; } }

export function defaultChoice(today: string): PeriodChoice {
  return { kind: 'fytd', month: today.slice(0, 7), fyStart: String(fyStartYear(today)), quarter: '1', from: `${fyStartYear(today)}-04-01`, to: today };
}

export function periodOf(choice: PeriodChoice, today: string): PeriodResult {
  const year = fyStartYear(today);
  let period: Period;
  switch (choice.kind) {
    case 'fytd': return { ok: true, period: undefined };
    case 'last-fy': period = { from: `${year - 1}-04-01`, to: `${year}-03-31` }; break;
    case 'month': {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(choice.month)) return { ok: false, problem: 'badDate' };
      period = { from: `${choice.month}-01`, to: lastDay(Number(choice.month.slice(0, 4)), Number(choice.month.slice(5, 7))) }; break;
    }
    case 'quarter': {
      if (!/^\d{4}$/.test(choice.fyStart) || Number(choice.fyStart) < 1900) return { ok: false, problem: 'badDate' };
      const q = Number(choice.quarter), y = Number(choice.fyStart) + (q === 4 ? 1 : 0), first = q === 4 ? 1 : 1 + q * 3;
      period = { from: `${pad(y, 4)}-${pad(first)}-01`, to: lastDay(y, first + 2) }; break;
    }
    case 'custom': period = { from: choice.from, to: choice.to }; break;
  }
  if (!valid(period.from) || !valid(period.to)) return { ok: false, problem: 'badDate' };
  if (period.from > period.to) return { ok: false, problem: 'badOrder' };
  if ((Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / DAY_MS > MAX_DAYS) return { ok: false, problem: 'tooLong' };
  return { ok: true, period };
}
