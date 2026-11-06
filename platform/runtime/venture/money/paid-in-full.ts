// One-shot C6 task 4 (section 9 idea 30, SCREENS 94): "Paid in full". For a month on the owner's calendar, when at
// least one invoice was issued in it and none has anything left to pay: "All November invoices paid", with a receipt
// code makes from the records that lists each invoice's total less its payments and credit notes, adding up to nothing.
// The same month and currency the goals view counts (goal-plans.ts invoicesOf). Reads only; no model writes a number.
import type { Context, State } from '../../contracts.ts';
import type { InvoiceRecord, PaidInFullView, SumReceiptSubject, VentureDeps, VentureRecord } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { invoicesOf } from './goal-plans.ts';
import { calendarMonth } from './dates.ts';
import { statementPlan } from './statement.ts';
import { planTotal, sumReceipt, type SumPlan } from './sums.ts';

const monthName = (month: string) => calendarMonth(month).display.split(' ')[0];

/** The receipt's addends as of now: each issued invoice of the month, its total less what was paid and credited. */
export function paidInFullPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'paid-in-full' }>): SumPlan {
  const addends = invoicesOf(state, venture, subject.month, 'issued')
    .flatMap(invoice => statementPlan(state, venture, { type: 'statement', clientId: invoice.clientId, part: 'balance', invoiceId: invoice.id }).addends);
  const words = calendarMonth(subject.month).display;
  return {
    subject: { ...subject }, currency: venture.country.currency, unit: 'minor', addends,
    words: { label: `Left to pay on ${words} invoices`, one: 'line', many: 'lines', none: `Nothing was invoiced in ${words}.` },
  };
}

/** An issued invoice with nothing left to pay. */
export function invoicePaidInFull(invoice: InvoiceRecord): boolean {
  return invoice.number !== null && invoice.status !== 'draft' && invoice.status !== 'void' && BigInt(invoice.balanceMinor) === 0n;
}

/** The month's line and its receipt, or null: nothing issued, or anything left to pay. */
export async function paidInFull(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, month: string): Promise<PaidInFullView | null> {
  const invoices = invoicesOf(state, venture, month, 'issued');
  if (!invoices.length || !invoices.every(invoicePaidInFull)) return null;
  // The receipt adds one currency, but the line says "all": an open invoice in another currency means it is not.
  const abroad = listRecords(state, 'venture-invoice', venture.id).filter(item => item.currency !== venture.country.currency && item.number !== null
    && item.status !== 'draft' && item.status !== 'void' && item.issueDate?.slice(0, 7) === month);
  if (!abroad.every(invoicePaidInFull)) return null;
  const plan = paidInFullPlan(state, venture, { type: 'paid-in-full', month });
  // The receipt must prove it: its lines add up to nothing left.
  if (planTotal(plan) !== 0n) return null;
  const receipt = await sumReceipt(deps, ctx, venture.id, plan);
  return { line: `All ${monthName(month)} invoices paid`, receiptId: receipt.id };
}
