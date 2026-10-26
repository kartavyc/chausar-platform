// Chausar venture launcher, money (Ink v2 wave 4, package 4I1): money invoiced in a month before tax, and how the month
// stands against its goal, as sum receipt plans. money/sums.ts serves their receipts through currentPlan, so a receipt
// reads stale once an invoice or credit note is issued or drafted, or the goal in use is replaced. Invoices count by
// their issue date and credit notes by the day they were issued, both on the owner's calendar; an amount before tax is
// the subtotal less the discount (the price receipt's "Amount before tax"), and a credit note's is its share in the
// same proportion as its invoice. A sum that would go below zero is written the other way round ("Past the goal by",
// "Behind today's pace by"), so a headline never shows a negative figure. Calendar arithmetic on 'YYYY-MM' only (month
// names and bounds from dates.ts calendarMonth, the tax working's too); money in BigInt minor units.
import { check, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { formatVentureDate, listRecords } from '../records.ts';
import type { CreditNoteRecord, GoalRecord, InvoiceRecord, IsoDate, SumReceiptSubject, VentureRecord } from '../contracts.ts';
import { localDayAt } from '../local-day.ts';
import { calendarMonth } from './dates.ts';
import type { Addend, SumPlan } from './sums.ts';

const ISSUED: readonly InvoiceRecord['status'][] = ['issued', 'part-paid', 'paid'];

/** A whole number from calendar digits ('2026', '10', '23'): calendar parts only, never an amount. */
export function whole(digits: string): number {
  return parseInt(digits, 10);
}

/** A month as 'YYYY-MM' between 2000 and 2100, or INVALID_VENTURE_REQUEST. */
export function monthText(value: unknown): string {
  check(typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && whole(value.slice(0, 4)) >= 2000 && whole(value.slice(0, 4)) <= 2100,
    'INVALID_VENTURE_REQUEST', 'Use a month like 2026-10.');
  return value;
}

/** How many months from one month to another: '2026-10' to '2027-01' is 3; back is below zero. */
export function monthsBetween(from: string, to: string): number {
  return (whole(to.slice(0, 4)) - whole(from.slice(0, 4))) * 12 + whole(to.slice(5, 7)) - whole(from.slice(5, 7));
}

/** 'October 2026' for '2026-10'. */
export function monthWords(month: string): string {
  return calendarMonth(month).display;
}

/** How many days the month has. */
export function daysInMonth(month: string): number {
  return whole(calendarMonth(month).to.slice(8, 10));
}

/** The month before. */
export function previousMonth(month: string): string {
  const year = whole(month.slice(0, 4)), index = whole(month.slice(5, 7)) - 1;
  return index === 0 ? `${year - 1}-12` : `${year}-${String(index).padStart(2, '0')}`;
}

/** The days of the month gone by a day, that day counted as gone: all of a month already over, none of a later one. */
export function elapsedOn(month: string, day: IsoDate): number {
  if (day.slice(0, 7) < month) return 0;
  if (day.slice(0, 7) > month) return daysInMonth(month);
  return whole(day.slice(8, 10));
}

/** Today's pace in money: the goal times the days gone over the month's days, rounded up to the minor unit. */
export function paceTarget(goalMinor: bigint, elapsed: number, days: number): bigint {
  return (goalMinor * BigInt(elapsed) + BigInt(days) - 1n) / BigInt(days);
}

/** Ahead (or exactly on) today's pace: what was invoiced reaches the pace in money. The same test the pace receipt makes. */
export function aheadOfPace(invoicedMinor: bigint, goalMinor: bigint, elapsed: number, days: number): boolean {
  return invoicedMinor >= paceTarget(goalMinor, elapsed, days);
}

/** An invoice's amount before tax: the subtotal less the discount. */
export function beforeTax(invoice: Pick<InvoiceRecord, 'subtotalMinor' | 'discountMinor'>): bigint {
  return BigInt(invoice.subtotalMinor) - BigInt(invoice.discountMinor);
}

/** Whether the accepted plan says the business is registered for tax: only then do its words say "before tax". */
export function taxRegistered(state: State, venture: VentureRecord): boolean {
  const accepted = listRecords(state, 'venture-blueprint', venture.id).find(blueprint => blueprint.id === venture.acceptedBlueprintId);
  return accepted?.backOffice.taxRegistered.value === true;
}

/** The goal in use for a month: the newest one the owner set for it, or null. */
export function goalInUse(state: State, ventureId: string, month: string): GoalRecord | null {
  return listRecords(state, 'venture-goal', ventureId).filter(goal => goal.month === month).at(-1) ?? null;
}

/** The goal in use must be kept in the business's own currency; anything else is refused, never shown as if it were. */
export function requireGoalCurrency(goal: GoalRecord, venture: VentureRecord): void {
  check(goal.currency === venture.country.currency, 'CURRENCY_CONFLICT', `This goal is in ${goal.currency}, but this business keeps its books in ${venture.country.currency}. Set the goal again.`);
}

/**
 * The month's invoices in the business's currency by their issue date: issued ones (part-paid and paid too; void and
 * drafts left out), or drafts ready to issue (their order not cancelled), oldest first.
 */
export function invoicesOf(state: State, venture: VentureRecord, month: string, which: 'issued' | 'ready'): InvoiceRecord[] {
  const cancelled = new Set(listRecords(state, 'venture-order', venture.id).filter(order => order.status === 'cancelled').map(order => order.id));
  return listRecords(state, 'venture-invoice', venture.id)
    .filter(invoice => invoice.currency === venture.country.currency && invoice.issueDate !== null && invoice.issueDate.slice(0, 7) === month)
    .filter(invoice => which === 'issued'
      ? ISSUED.includes(invoice.status) && invoice.number !== null
      : invoice.status === 'draft' && !cancelled.has(invoice.orderId))
    .sort((a, b) => (a.issueDate as string).localeCompare(b.issueDate as string) || (a.number ?? '').localeCompare(b.number ?? '') || a.at.localeCompare(b.at));
}

/** Credit notes issued in the month on the owner's calendar, in the business's currency, oldest first (waiting ones left out). */
export function creditNotesOf(state: State, venture: VentureRecord, month: string): CreditNoteRecord[] {
  return listRecords(state, 'venture-credit-note', venture.id)
    .filter(note => note.status === 'issued' && note.issuedAt !== null && note.currency === venture.country.currency && localDayAt(note.issuedAt, venture.country).slice(0, 7) === month)
    .sort((a, b) => (a.issuedAt as string).localeCompare(b.issuedAt as string) || a.id.localeCompare(b.id));
}

/**
 * A credit note's amount before tax: its amount times its invoice's amount before tax over the invoice's total, rounded
 * half up to the minor unit. Without its invoice (or one with no total), the whole amount, so progress is never overstated.
 */
export function creditBeforeTax(note: CreditNoteRecord, invoice: InvoiceRecord | undefined): bigint {
  // 4J5: the share worked out when the note was issued (the last of a full credit takes the rest), when it was kept.
  if (note.beforeTaxMinor !== undefined) return BigInt(note.beforeTaxMinor);
  const amount = BigInt(note.amountMinor);
  if (!invoice || invoice.currency !== note.currency || BigInt(invoice.totalMinor) <= 0n) return amount;
  const total = BigInt(invoice.totalMinor);
  return (amount * beforeTax(invoice) * 2n + total) / (2n * total);
}

/** One line of a sum, signed; its label reads "Less ..." when it takes away. */
type Line = { recordId: string; label: string; amount: bigint };

const lowerFirst = (label: string) => /^[A-Z][A-Z0-9-]/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
const flipped = (lines: Line[]): Line[] => lines.map(line => ({ ...line, amount: -line.amount }));
const sum = (lines: Line[]) => lines.reduce((total, line) => total + line.amount, 0n);

function addends(lines: Line[], currency: string): Addend[] {
  return lines.map(line => ({
    recordId: line.recordId, label: line.amount < 0n ? `Less ${lowerFirst(line.label)}` : line.label,
    amount: String(line.amount), display: formatMinor(line.amount, currency), estimate: false,
  }));
}

/** What the month invoiced before tax: each issued invoice, less each credit note issued in the month. */
function invoicedLines(state: State, venture: VentureRecord, month: string): Line[] {
  const names = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const invoices = new Map(listRecords(state, 'venture-invoice', venture.id).map(invoice => [invoice.id, invoice]));
  const lines: Line[] = invoicesOf(state, venture, month, 'issued')
    .map(invoice => ({ recordId: invoice.id, label: `${invoice.number} for ${names.get(invoice.clientId) ?? 'a client'}`, amount: beforeTax(invoice) }));
  for (const note of creditNotesOf(state, venture, month)) {
    const invoice = invoices.get(note.invoiceId);
    const on = invoice?.number ? ` on ${invoice.number}` : ' on an invoice';
    lines.push({ recordId: note.id, label: `${note.number ? `Credit note ${note.number}` : 'A credit note'}${on}`, amount: -creditBeforeTax(note, invoice) });
  }
  return lines;
}

/** The `invoiced` receipt's addends as of now: the month's issued invoices less its credit notes, or its drafts ready to issue, before tax. */
export function invoicedPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'invoiced' }>): SumPlan {
  const currency = venture.country.currency;
  const words = monthWords(subject.month);
  const tax = taxRegistered(state, venture) ? ', before tax' : '';
  if (subject.which === 'issued') {
    return {
      subject: { ...subject }, currency, unit: 'minor', addends: addends(invoicedLines(state, venture, subject.month), currency),
      words: { label: `Invoiced in ${words}${tax}`, one: 'item', many: 'items', none: `Nothing was invoiced in ${words}.` },
    };
  }
  const names = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const lines = invoicesOf(state, venture, subject.month, 'ready').map(invoice => ({
    recordId: invoice.id, amount: beforeTax(invoice),
    label: `Draft for ${names.get(invoice.clientId) ?? 'a client'}, dated ${formatVentureDate(invoice.issueDate as string, venture.country.dateOrder)}`,
  }));
  return {
    subject: { ...subject }, currency, unit: 'minor', addends: addends(lines, currency),
    words: { label: `Ready to issue in ${words}${tax}`, one: 'draft', many: 'drafts', none: `No drafts are ready to issue in ${words}.` },
  };
}

/**
 * The `goal` receipt's steps as of now, always with the goal in use for the month (so a replaced goal reads stale).
 * Day null: the goal less what was invoiced is still to invoice; past the goal, what was invoiced less the goal is how
 * far past. A day: what was invoiced less today's pace on that day ("day 23 of 31") is how far ahead; behind it, the
 * pace less what was invoiced is how far behind. A new receipt each day.
 */
export function goalPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'goal' }>): SumPlan {
  const goal = goalInUse(state, venture.id, subject.month);
  check(goal, 'RECEIPT_NOT_FOUND', 'The goal behind this receipt was not found.');
  requireGoalCurrency(goal, venture);
  const currency = venture.country.currency;
  const goalMinor = BigInt(goal.amountMinor);
  const invoiced = invoicedLines(state, venture, subject.month);
  const net = sum(invoiced);
  const words = { one: 'line', many: 'lines', none: 'Nothing to add up.' };
  const plan = (lines: Line[], label: string): SumPlan => ({ subject: { ...subject }, currency, unit: 'minor', addends: addends(lines, currency), words: { ...words, label } });
  if (subject.day === null) {
    const target: Line = { recordId: goal.id, label: `Your goal for ${monthWords(subject.month)}`, amount: goalMinor };
    return net > goalMinor
      ? plan([...invoiced, { ...target, amount: -goalMinor }], 'Past the goal by')
      : plan([target, ...flipped(invoiced)], 'Still to invoice toward the goal');
  }
  const days = daysInMonth(subject.month);
  const elapsed = elapsedOn(subject.month, subject.day);
  const pace = paceTarget(goalMinor, elapsed, days);
  const when = `day ${elapsed} of ${days}`;
  const target: Line = { recordId: goal.id, label: `Today's pace: ${when} of the ${formatMinor(goalMinor, currency)} goal`, amount: pace };
  return aheadOfPace(net, goalMinor, elapsed, days)
    ? plan([...invoiced, { ...target, amount: -pace }], `Ahead of today's pace (${when}) by`)
    : plan([target, ...flipped(invoiced)], `Behind today's pace (${when}) by`);
}
