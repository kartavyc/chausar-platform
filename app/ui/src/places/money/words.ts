/**
 * Words and dates the Money place shares. Nothing here reads, parses or changes an amount: dates are formatted for
 * reading, and an invoice's state becomes one sentence.
 */

import { useMemo } from 'react';
import { useLanguage, type T } from '../../text';
import type { InvoiceLite, VentureRunEvent } from '../../engine/types';

/** Money moves when the queue does (an invoice issued, a payment recorded); spend moves when a run does. */
export const onMoney = (event: VentureRunEvent) => event.type === 'queue.changed';
export const onRuns = (event: VentureRunEvent) => event.type.startsWith('run.');

const LOCALE = { en: 'en-IN', hi: 'hi-IN' } as const;
export type Day = (iso: string | null | undefined) => string;

/** A calendar day ('2026-10-28') as '28 Oct 2026' in the reader's language. Read in UTC so the day never shifts. */
export function useDay(): Day {
  const language = useLanguage();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(LOCALE[language], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return (iso) => {
      if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? '';
      const at = new Date(`${iso}T00:00:00.000Z`);
      return Number.isNaN(at.getTime()) ? iso : format.format(at);
    };
  }, [language]);
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

/** Today on this computer's calendar, as the date field wants it (YYYY-MM-DD). */
export function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
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
