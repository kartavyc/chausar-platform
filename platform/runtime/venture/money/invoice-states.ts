// Chausar venture launcher, money (Ink v2 wave 4, package 4J5, M12): each invoice's one next step by its state, and its
// short timeline, both from records only: issued on, viewed (once 4J7's statement links record a view), each payment
// (a cheque waiting apart, TDS beside the cash), each credit note, each reminder, then where it stands now. A draft is
// issued next; a waiting cheque is cleared next; an open one waits, or is reminded on its reminder days (reminders.ts).
import type { State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { formatVentureDate, listRecords } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { creditedOn, issuedCredits, METHOD_WORDS, paymentState } from './ledger.ts';
import { reminderStep, remindersOf } from './reminders.ts';
import type { InvoiceNext, InvoiceRecord, InvoiceTimelineEntry, IsoDate, PaymentRecord, VentureRecord } from '../contracts.ts';

function paymentsOn(state: State, venture: VentureRecord, invoiceId: string): PaymentRecord[] {
  return listRecords(state, 'venture-payment', venture.id).filter(payment => payment.invoiceId === invoiceId)
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.at.localeCompare(b.at));
}

/** How a settled invoice was settled, in words. */
function settledWords(paid: bigint, credited: bigint): string {
  if (credited > 0n) return paid > 0n ? 'Settled: paid and credited' : 'Settled by credit notes';
  return 'Paid in full';
}

/** The invoice's one next step by its state, as of the owner's day. */
export function invoiceNext(state: State, venture: VentureRecord, invoice: InvoiceRecord, today: IsoDate): InvoiceNext {
  if (invoice.status === 'draft') return { action: 'issue', line: 'Check it and issue it.' };
  if (invoice.status === 'void') return { action: 'none', line: 'Cancelled.' };
  const credits = listRecords(state, 'venture-credit-note', venture.id);
  if (BigInt(invoice.balanceMinor) <= 0n) return { action: 'none', line: `${settledWords(BigInt(invoice.paidMinor), creditedOn(invoice.id, credits))}.` };
  const waiting = paymentsOn(state, venture, invoice.id).filter(payment => paymentState(payment) === 'pending');
  if (waiting.length) {
    // The cheques' own amounts; any TDS the client deducted is named apart, never added into a cheque.
    const cheques = formatMinor(waiting.reduce((total, payment) => total + BigInt(payment.amountMinor), 0n), invoice.currency);
    const withheld = waiting.filter(payment => payment.tds);
    const tds = withheld.length === 1 && withheld[0].tds
      ? `, with TDS ${formatMinor(withheld[0].tds.amountMinor, invoice.currency)} under ${withheld[0].tds.section}`
      : withheld.length > 1 ? `, with TDS of ${formatMinor(withheld.reduce((total, payment) => total + BigInt(payment.tds?.amountMinor ?? '0'), 0n), invoice.currency)}` : '';
    return waiting.length === 1
      ? { action: 'clear', line: `A cheque for ${cheques} is waiting to clear${tds}. Mark it cleared once it is in your bank.` }
      : { action: 'clear', line: `${waiting.length} cheques for ${cheques} are waiting to clear${tds}. Mark each cleared once it is in your bank.` };
  }
  return reminderStep(state, venture, invoice, today);
}

/**
 * When the client first opened a statement link that showed this invoice, on the owner's calendar. 4J7 records a
 * client's view on its 'statement' share links (never the owner's own preview), with the open invoices each one
 * showed; the earliest such view is the invoice's Viewed line. No view recorded: null, and no Viewed line.
 */
function viewedOn(state: State, venture: VentureRecord, invoice: InvoiceRecord): IsoDate | null {
  const views = listRecords(state, 'venture-share-link', venture.id)
    .filter(link => link.shareKind === 'statement' && link.clientId === invoice.clientId && link.viewedAt && (link.invoiceIds ?? []).includes(invoice.id))
    .map(link => link.viewedAt as string).sort();
  return views.length ? localDayAt(views[0], venture.country) : null;
}

/** The invoice's short timeline: events by date (issued, viewed, payments, credit notes, reminders), then where it stands. */
export function invoiceTimeline(state: State, venture: VentureRecord, invoice: InvoiceRecord, _today: IsoDate): InvoiceTimelineEntry[] {
  if (invoice.status === 'draft' || invoice.issueDate === null) return [];
  const date = (iso: IsoDate) => formatVentureDate(iso, venture.country.dateOrder);
  const money = (minor: string | bigint) => formatMinor(minor, invoice.currency);
  const day = (instant: string) => localDayAt(instant, venture.country);
  const events: InvoiceTimelineEntry[] = [{ what: 'issued', on: invoice.issueDate, line: `Issued on ${date(invoice.issueDate)}` }];
  const viewed = viewedOn(state, venture, invoice);
  // 4J7: a chat app's link preview opens the page too, so the words say a preview can count.
  if (viewed) events.push({ what: 'viewed', on: viewed, line: `Statement opened on ${date(viewed)} (a link preview in a chat app can count as opening it)` });
  for (const payment of paymentsOn(state, venture, invoice.id)) {
    if (paymentState(payment) === 'pending') {
      const withheld = payment.tds ? `, and TDS ${money(payment.tds.amountMinor)} under ${payment.tds.section}` : '';
      events.push({ what: 'cheque', on: payment.receivedOn, line: `Cheque for ${money(payment.amountMinor)} received on ${date(payment.receivedOn)}, waiting to clear${withheld}` });
      continue;
    }
    const tds = payment.tds ? `, and TDS ${money(payment.tds.amountMinor)} under ${payment.tds.section} to be shown on the client's TDS certificate` : '';
    events.push({ what: 'paid', on: payment.receivedOn, line: `Paid ${money(payment.amountMinor)} by ${METHOD_WORDS[payment.method]} on ${date(payment.receivedOn)}${tds}` });
  }
  const credits = listRecords(state, 'venture-credit-note', venture.id);
  for (const note of issuedCredits(invoice.id, credits)) {
    const on = day(note.issuedAt as string);
    events.push({ what: 'credited', on, line: `Credit note ${note.number} for ${money(note.amountMinor)} on ${date(on)}` });
  }
  for (const reminder of remindersOf(state, venture, invoice.id)) {
    events.push(reminder.sent
      ? { what: 'reminded', on: day(reminder.sent.at), line: `Reminder sent on ${date(day(reminder.sent.at))}` }
      : { what: 'reminder', on: day(reminder.at), line: `Reminder drafted on ${date(day(reminder.at))}, not sent yet` });
  }
  const ordered = events.map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.on.localeCompare(b.event.on) || a.index - b.index).map(item => item.event);
  if (invoice.status === 'void') return ordered;
  const credited = creditedOn(invoice.id, credits);
  if (BigInt(invoice.balanceMinor) <= 0n) {
    return [...ordered, { what: 'settled', on: ordered[ordered.length - 1].on, line: settledWords(BigInt(invoice.paidMinor), credited) }];
  }
  const due = invoice.dueDate ?? invoice.issueDate;
  const touched = BigInt(invoice.paidMinor) > 0n || credited > 0n;
  return [...ordered, { what: 'awaiting', on: due, line: touched ? `Awaiting ${money(invoice.balanceMinor)}, due ${date(due)}` : `Awaiting payment, due ${date(due)}` }];
}
