/**
 * Words and dates the Money place shares. Nothing here reads, parses or changes an amount: dates are formatted for
 * reading, and an invoice's state becomes one sentence.
 */

import { useMemo } from 'react';
import { useLanguage, type T } from '../../text';
import { useClock } from '../../shell/clock';
import { useResource } from '../../engine/context';
import type { BooksSummaryLite, InvoiceLite, VentureRunEvent } from '../../engine/types';

export type OpenInvoice = BooksSummaryLite['openInvoices'][number];

/** Open invoices oldest due first, by their due dates as written (YYYY-MM-DD sorts as text): nothing is worked out. */
export function byDue(open: readonly OpenInvoice[]): OpenInvoice[] {
  return [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Money moves when the queue does (an invoice issued, a payment recorded); spend moves when a run does. */
export const onMoney = (event: VentureRunEvent) => event.type === 'queue.changed';
export const onRuns = (event: VentureRunEvent) => event.type.startsWith('run.');

const LOCALE = { en: 'en-IN', hi: 'hi-IN' } as const;
export type Day = (iso: string | null | undefined) => string;

/**
 * A calendar day ('2026-10-28') as '28 Oct 2026' in the reader's language, or '28 Oct' with `short` (a chart's axis,
 * a list by date within weeks). Read in UTC so the day never shifts.
 */
export function useDay(size: 'full' | 'short' = 'full'): Day {
  const language = useLanguage();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(LOCALE[language], { day: 'numeric', month: 'short', ...(size === 'full' ? { year: 'numeric' as const } : {}), timeZone: 'UTC' });
    return (iso) => {
      if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? '';
      const at = new Date(`${iso}T00:00:00.000Z`);
      return Number.isNaN(at.getTime()) ? iso : format.format(at);
    };
  }, [language, size]);
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A month ('2026-10') as 'October 2026' (long) or 'Oct' (short, a chart's column) in the reader's language. */
export function useMonthWords(size: 'long' | 'short' = 'long'): (month: string) => string {
  const language = useLanguage();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(LOCALE[language], size === 'long' ? { month: 'long', year: 'numeric', timeZone: 'UTC' } : { month: 'short', timeZone: 'UTC' });
    return (month) => (MONTH.test(month) ? format.format(new Date(`${month}-01T00:00:00.000Z`)) : month);
  }, [language, size]);
}

/** This month on this computer's calendar ('2026-10'), read from the app's one clock. */
export function useThisMonth(): string {
  const clock = useClock();
  // The engine's own day on the business's calendar (its time zone), when the books say it; else this computer's.
  const books = useResource('venture.books.summary', { period: 'this-month' }, { refreshOn: onMoney });
  const today = books.data?.today;
  return today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today.slice(0, 7) : new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit' }).format(clock()).slice(0, 7);
}

/** How many months the picker offers: this one and the five before it (simple first, 4J20). */
export const MONTHS_SHOWN = 6;

/** The months the picker offers, newest first: this one and the five before it. */
export function monthsOffered(thisMonth: string): string[] {
  const months = [thisMonth];
  while (months.length < MONTHS_SHOWN) months.push(monthBefore(months[months.length - 1]!));
  return months;
}

/** The month before one ('2026-01' before '2026-02', '2025-12' before '2026-01'): a calendar step, no amount. */
export function monthBefore(month: string): string {
  const at = new Date(`${month}-01T00:00:00.000Z`);
  at.setUTCMonth(at.getUTCMonth() - 1);
  return at.toISOString().slice(0, 7);
}

/** The month Money shows (?month=2026-09 in the address; this month when none or not a month), and this month. */
export function useChosenMonth(query: Record<string, string>): { month: string; thisMonth: string } {
  const thisMonth = useThisMonth();
  const asked = query.month;
  // Only a month the picker offers: anything else in the address is this month.
  return { month: asked && MONTH.test(asked) && monthsOffered(thisMonth).includes(asked) ? asked : thisMonth, thisMonth };
}

/** A moment ('2026-10-21T09:20:00Z') as '21 Oct, 2:50 pm' on this computer's clock. */
export function useMoment(): (iso: string) => string {
  const language = useLanguage();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(LOCALE[language], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    return (iso) => {
      const at = new Date(iso);
      return Number.isNaN(at.getTime()) ? iso : format.format(at);
    };
  }, [language]);
}

/** Today on this computer's calendar, as the date field wants it (YYYY-MM-DD), read from the app's one clock. */
export function useLocalToday(): () => string {
  const clock = useClock();
  return () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock());
}

/** Where an invoice stands, in one sentence: "Issued 14 Oct 2026, due 28 Oct 2026". */
export function statusOf(t: T, day: Day, invoice: InvoiceLite & { dueInDays?: number }): string {
  switch (invoice.status) {
    case 'draft': return invoice.dueInDays === undefined ? t('money.status.draftShort') : t('money.status.draft', { count: String(invoice.dueInDays) });
    case 'issued': return t('money.status.issued', { issued: day(invoice.issueDate), due: day(invoice.dueDate) });
    case 'part-paid': return t('money.status.part-paid', { due: day(invoice.dueDate) });
    case 'paid': return t('money.status.paid');
    default: return t('money.status.void');
  }
}

/** "INV-0039 · Boat Audio", or "Draft · Boat Audio" before it has a number. */
export function invoiceTitle(t: T, invoice: Pick<InvoiceLite, 'number'>, client: string): string {
  return invoice.number ? t('money.invoices.title', { number: invoice.number, client }) : t('money.invoices.draftTitle', { client });
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
