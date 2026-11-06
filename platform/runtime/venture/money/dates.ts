// Calendar dates for money documents and the books. Calendar arithmetic on 'YYYY-MM-DD' only; no money here.
// "Today" is the owner's local day (local-day.ts), the same day basis everywhere the venture fills in a date.
export {addDaysUtc} from '../../date-core.ts';
import { ownerToday } from '../local-day.ts';
import type { BooksPeriodChoice, BooksPeriodKey, CountryProfile, IsoDate } from '../contracts.ts';

/** Today's date on the owner's calendar, from the injected clock and the venture's country. */
export function todayLocal(clock: () => Date, country: Pick<CountryProfile, 'code'>): IsoDate {
  return ownerToday(clock, country);
}


const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** One calendar month ('YYYY-MM'): its first and last day and its name ('October 2026'). The tax working and goals use it. */
export function calendarMonth(month: string): { month: string; from: IsoDate; to: IsoDate; display: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { month, from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}`, display: `${MONTHS[m - 1]} ${y}` };
}

/** The first and last day of the month that holds `iso`, moved back by `monthsBack` whole months. */
function monthOf(iso: IsoDate, monthsBack: number): { from: IsoDate; to: IsoDate } {
  const first = new Date(`${iso.slice(0, 7)}-01T00:00:00.000Z`);
  first.setUTCMonth(first.getUTCMonth() - monthsBack);
  const last = new Date(first.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export const BOOKS_PERIOD_KEYS: readonly BooksPeriodKey[] = Object.freeze(['all', 'this-month', 'last-month', 'this-year'] as const);
const PERIOD_LABELS: Readonly<Record<BooksPeriodKey, string>> = Object.freeze({
  all: 'All time', 'this-month': 'This month', 'last-month': 'Last month', 'this-year': 'This year',
});

/**
 * Every books period the Money place can offer, with dates worked out on the owner's calendar. Months and the year
 * are whole calendar months and years, so a dated entry anywhere inside one is counted. 'All time' runs from the
 * earliest of the business's start day and its first dated entry, to the later of today and its last dated entry,
 * so back-dated invoices and payments are always inside it.
 */
export function booksPeriods(today: IsoDate, startDay: IsoDate, entryDates: readonly IsoDate[]): BooksPeriodChoice[] {
  let from = startDay < today ? startDay : today;
  let to = today;
  for (const day of entryDates) {
    if (day < from) from = day;
    if (day > to) to = day;
  }
  const year = today.slice(0, 4);
  const dates: Record<BooksPeriodKey, { from: IsoDate; to: IsoDate }> = {
    all: { from, to }, 'this-month': monthOf(today, 0), 'last-month': monthOf(today, 1), 'this-year': { from: `${year}-01-01`, to: `${year}-12-31` },
  };
  return BOOKS_PERIOD_KEYS.map(key => ({ key, label: PERIOD_LABELS[key], from: dates[key].from, to: dates[key].to }));
}
