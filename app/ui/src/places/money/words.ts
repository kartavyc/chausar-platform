/**
 * Words and dates the Money place shares. Nothing here reads, parses or changes an amount: dates are formatted for
 * reading, and an invoice's state becomes one sentence.
 */

import type { T } from '../../text';
import { typedMoney } from '../../../../../platform/runtime/owner-format';
import { useDay as useWhenDay, useLocalToday, useMoment as useWhenMoment, useMonth } from '../../parts/when';
import { useResource } from '../../engine/context';
import type { BooksSummaryLite, InvoiceLite, UiRunEvent } from '../../engine/types';

export type OpenInvoice = BooksSummaryLite['openInvoices'][number];

/** Open invoices oldest due first, by their due dates as written (YYYY-MM-DD sorts as text): nothing is worked out. */
export function byDue(open: readonly OpenInvoice[]): OpenInvoice[] {
  return [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Money moves when the queue does (an invoice issued, a payment recorded); spend moves when a run does. */
export const onMoney = (event: UiRunEvent) => event.type === 'queue.changed';
export const onRuns = (event: UiRunEvent) => event.type.startsWith('run.');

export type Day = (iso: string | null | undefined) => string;

/**
 * A calendar day ('2026-10-28') as '28 Oct 2026', or '28 Oct' with `short` (a chart's axis, a list by date within weeks).
 * A calendar day never shifts; a moment reads in the owner's zone. Money's name for parts/when.ts useDay (B2).
 */
export function useDay(size: 'full' | 'short' = 'full'): Day {
  return useWhenDay(size);
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A month ('2026-10') as 'October 2026' (long) or 'Oct' (short, a chart's column): parts/when.ts useMonth. */
export function useMonthWords(size: 'long' | 'short' = 'long'): (month: string) => string {
  return useMonth(size);
}

/** This month on the owner's calendar ('2026-10'), read from the app's one clock. */
export function useThisMonth(): string {
  const localToday = useLocalToday();
  // The engine's own day on the business's calendar (its time zone), when the books say it; else the owner zone's.
  const books = useResource('venture.books.summary', { period: 'this-month' }, { refreshOn: onMoney });
  const today = books.data?.today;
  return today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today.slice(0, 7) : localToday().slice(0, 7);
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

/** A moment ('2026-10-21T09:20:00Z') as '21 Oct, 2:50 pm' in the owner's zone: parts/when.ts useMoment, short. */
export function useMoment(): (iso: string) => string {
  return useWhenMoment('short');
}

/** Today on the owner's calendar, as the date field wants it (YYYY-MM-DD): parts/when.ts useLocalToday. */
export { useLocalToday };

/** Where an invoice stands, in one sentence: "Issued 14 Oct 2026, due 28 Oct 2026". */
export function statusOf(t: T, day: Day, invoice: InvoiceLite & { dueInDays?: number }, sent?: boolean): string {
  switch (invoice.status) {
    case 'draft': return invoice.dueInDays === undefined ? t('money.status.draftShort') : t('money.status.draft', { count: String(invoice.dueInDays) });
    // C4 (T20): "not sent" until the owner marks it; an engine that does not say leaves the plain words.
    case 'issued': return t(sent === undefined ? 'money.status.issued' : sent ? 'money.status.issuedSent' : 'money.status.issuedUnsent', { issued: day(invoice.issueDate), due: day(invoice.dueDate) });
    case 'part-paid': return t('money.status.part-paid', { due: day(invoice.dueDate) });
    case 'paid': return t('money.status.paid');
    default: return t('money.status.void');
  }
}

/** C4 (T20): the state chip's value for an invoice: an issued one is "Issued, not sent" until the owner marks it sent. */
export function invoiceChip(invoice: Pick<InvoiceLite, 'status' | 'sent'>): InvoiceLite['status'] | 'unsent' | 'sent' {
  if (invoice.status !== 'issued' || invoice.sent === undefined) return invoice.status;
  return invoice.sent ? 'sent' : 'unsent';
}

/** "INV-0039 · Boat Audio", or "Draft · Boat Audio" before it has a number. */
export function invoiceTitle(t: T, invoice: Pick<InvoiceLite, 'number'>, client: string): string {
  return invoice.number ? t('money.invoices.title', { number: invoice.number, client }) : t('money.invoices.draftTitle', { client });
}



/**
 * An amount the owner typed, echoed back in the owner form ("2000" on a rupee invoice reads "₹2,000", B2): the text is
 * only regrouped, never worked out. Text that is not a plain amount comes back as typed, with its currency code.
 */
export function typedWords(text: string, currency: string): string {
  return typedMoney(text.trim(), currency) ?? `${text.trim()} ${currency}`;
}
