// Chausar venture launcher, money (Ink v2 wave 4, package 4J5, M12): payment reminders the owner sends. A reminder is
// due on the days late the owner picked for the invoice's schedule, or 3, 10 and 30 days late; venture.invoice.remind
// drafts one in code (a fixed template, no model), with every figure from the invoice and its balance receipt. The
// draft is a venture-outreach record of kind 'reminder' that 4E2 opens in the owner's own mail app and marks sent on the
// owner's "I sent it"; Chausar never sends it. A reminder counts for the latest reminder day reached once it was sent,
// or drafted, on or after that day.
import { check, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { digest, exactPayload, formatVentureDate, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { addDaysUtc } from './dates.ts';
import { daysFrom, lateWords, paymentState } from './ledger.ts';
import { oneLine, recordId } from './shared.ts';
import { sumReceipt } from './sums.ts';
import { statementPlan } from './statement.ts';
import type { InvoiceNext, InvoiceRecord, IsoDate, OutreachRecord, OutreachView, VentureDeps, VentureRecord } from '../contracts.ts';

/** The days late a reminder is due on when the invoice's schedule picked none. */
export const REMINDER_DAYS: readonly number[] = Object.freeze([3, 10, 30]);

/** The reminder days of an invoice: its recurring schedule's own, else 3, 10 and 30. */
export function reminderDaysFor(state: State, venture: VentureRecord, invoice: Pick<InvoiceRecord, 'id'>): readonly number[] {
  const schedule = listRecords(state, 'venture-recurring-invoice', venture.id).find(item => (item.made ?? []).some(made => made.invoiceId === invoice.id));
  return schedule?.reminderDays?.length ? schedule.reminderDays : REMINDER_DAYS;
}

/** The reminders drafted for an invoice, oldest first. */
export function remindersOf(state: State, venture: VentureRecord, invoiceId: string): OutreachRecord[] {
  return listRecords(state, 'venture-outreach', venture.id).filter(item => item.outreachKind === 'reminder' && item.invoiceId === invoiceId);
}

/** The day a reminder counts from: when it was sent, else when it was drafted, on the owner's calendar. */
function countsFrom(record: OutreachRecord, venture: VentureRecord): IsoDate {
  return localDayAt(record.sent?.at ?? record.at, venture.country);
}

/**
 * The next step of an issued invoice with money left to pay and no cheque waiting: wait until it is due, then until
 * the first reminder day; on a reminder day reached, draft a reminder, send the one drafted, or wait after sending it.
 */
export function reminderStep(state: State, venture: VentureRecord, invoice: InvoiceRecord, today: IsoDate): InvoiceNext {
  const date = (iso: IsoDate) => formatVentureDate(iso, venture.country.dateOrder);
  if (invoice.dueDate === null) return { action: 'wait', line: 'Awaiting payment.' };
  const late = daysFrom(invoice.dueDate, today);
  if (late <= 0) return { action: 'wait', line: `Awaiting payment, due ${date(invoice.dueDate)}.` };
  const days = reminderDaysFor(state, venture, invoice);
  const reached = days.filter(day => day <= late);
  if (!reached.length) return { action: 'wait', line: `${lateWords(late)}. A reminder is due on ${date(addDaysUtc(invoice.dueDate, days[0]))}.` };
  const from = addDaysUtc(invoice.dueDate, reached[reached.length - 1]);
  const counted = remindersOf(state, venture, invoice.id).filter(record => countsFrom(record, venture) >= from);
  const sent = counted.filter(record => record.sent !== null).at(-1);
  if (sent) return { action: 'wait', line: `${lateWords(late)}. You sent a reminder on ${date(countsFrom(sent, venture))}.` };
  const drafted = counted.at(-1);
  if (drafted) return { action: 'remind', line: `${lateWords(late)}. Your reminder is drafted: open it and send it yourself.`, draftId: drafted.id };
  return { action: 'remind', line: `${lateWords(late)}. Draft a reminder.` };
}

/** A reminder draft as the screens and 4E2's handoff read it. */
export function reminderView(record: OutreachRecord): OutreachView {
  return {
    id: record.id, opportunityId: record.opportunityId, kind: record.outreachKind, channel: record.channel, to: record.to,
    subject: record.subject, text: record.text, blurb: record.blurb, footer: record.footer, lints: record.lints, counter: null,
    sent: record.sent ? { at: record.sent.at, channel: record.sent.channel } : null, digest: record.digest,
  };
}

/** Why an invoice cannot be reminded about now, or null. */
function refusal(state: State, venture: VentureRecord, invoice: InvoiceRecord): string | null {
  if (invoice.status === 'draft' || invoice.number === null) return 'Issue this invoice before you remind anyone about it.';
  if (invoice.status === 'void') return 'This invoice was cancelled.';
  if (BigInt(invoice.balanceMinor) <= 0n) return 'This invoice has nothing left to pay.';
  const waiting = listRecords(state, 'venture-payment', venture.id).some(payment => payment.invoiceId === invoice.id && paymentState(payment) === 'pending');
  return waiting ? 'A cheque for this invoice is waiting to clear. Clear it before you remind them.' : null;
}

/** The reminder's words, by a fixed template: every figure from the invoice, every date on the owner's calendar. */
function reminderText(venture: VentureRecord, invoice: InvoiceRecord, clientName: string, sellerName: string, today: IsoDate): string {
  const date = (iso: IsoDate) => formatVentureDate(iso, venture.country.dateOrder);
  const due = invoice.dueDate === null ? '' : `, ${daysFrom(invoice.dueDate, today) > 0 ? 'was' : 'is'} due on ${date(invoice.dueDate)}`;
  return [
    `Hello ${oneLine(clientName)},`,
    '',
    `This is a reminder that invoice ${invoice.number}, dated ${date(invoice.issueDate as string)}${due}. ${formatMinor(invoice.balanceMinor, invoice.currency)} is still to pay.`,
    '',
    'If you have already paid, thank you, and please ignore this note.',
    '',
    oneLine(sellerName),
  ].join('\n');
}

/**
 * venture.invoice.remind { invoiceId } (prepare, app only): drafts a payment reminder for an issued invoice with money
 * left to pay, to the client's email when there is one. The amount's receipt is the invoice's balance working, sealed
 * first. Nothing is sent: the owner opens it in their own app (4E2) and sends it themselves.
 */
export async function invoiceRemind(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ draft: OutreachView; receiptId?: string }> {
  requireAppChannel(ctx, 'venture.invoice.remind');
  const body = exactPayload(payload, ['invoiceId'], ['invoiceId']);
  const invoiceId = recordId(body.invoiceId, 'Invoice');
  const { state, venture } = readVenture(deps, ctx);
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === invoiceId);
  check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
  const refused = refusal(state, venture, invoice);
  check(refused === null, 'INVALID_VENTURE_REQUEST', refused ?? '');
  const receipt = await sumReceipt(deps, ctx, venture.id, statementPlan(state, venture, { type: 'statement', clientId: invoice.clientId, part: 'balance', invoiceId: invoice.id }));
  return ventureAction(deps, ctx, 'prepare', 'invoice.remind', tx => {
    const current = tx.venture;
    check(current, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const latest = tx.find('venture-invoice', invoiceId);
    check(latest, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
    const again = refusal(tx.state, current, latest);
    check(again === null, 'INVALID_VENTURE_REQUEST', again ?? '');
    check(latest.balanceMinor === invoice.balanceMinor, 'APPROVAL_STALE', 'This invoice changed just now. Ask for the reminder again.');
    const client = tx.find('venture-client', latest.clientId);
    check(client, 'CLIENT_NOT_FOUND', 'The client of this invoice was not found.');
    const plan = tx.list('venture-blueprint').find(item => item.id === current.acceptedBlueprintId);
    const today = localDayAt(tx.now, current.country);
    const subject = `Payment reminder: ${latest.number}`;
    const text = reminderText(current, latest, client.name, plan?.name.value ?? current.workingName, today);
    const record: OutreachRecord = {
      ...tx.base('venture-outreach'), opportunityId: null, invoiceId: latest.id, personId: null, outreachKind: 'reminder', channel: 'email',
      to: client.email, subject, text, blurb: null, footer: null, sourceUrl: null, basis: 'existing-contact', lints: [], by: 'owner', callId: null,
      digest: digest({ kind: 'reminder', invoiceId: latest.id, to: client.email, subject, text }), sent: null, acceptedOn: null,
    };
    const stored = tx.put(record);
    tx.emit('queue.changed', { reminderId: stored.id });
    return { draft: reminderView(stored), receiptId: receipt.id };
  });
}
