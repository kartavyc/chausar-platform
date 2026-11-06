// Chausar venture launcher, network (Ink v2 wave 4, package 4E2, M12's handoff part): Today's rows for payment
// reminders the owner sends themselves. 4J5's venture.invoice.remind drafts a reminder (a venture-outreach record of
// kind 'reminder' with its invoice); while it is unsent and the invoice still has money to pay, Today shows one row for
// it, subject `reminder:<draft id>`, with Open (the handoff, venture.outreach.open, is navigation here) and "I sent it",
// which views/queue-w4.ts decideSent sends to network/outreach.ts decideReminderSent. Reads only; nothing is sent.
import type { Context, State } from '../../contracts.ts';
import type { VentureDeps, VentureRecord } from '../contracts.ts';
import { formatVentureDate, listRecords } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { daysFrom, lateWords } from '../money/ledger.ts';
import type { W4RowItem } from '../views/queue-w4.ts';

const OPEN_LABEL = { email: 'Open in Mail', whatsapp: 'Open WhatsApp', linkedin: 'Open in LinkedIn' } as const;
const APP = { email: 'your mail app', whatsapp: 'WhatsApp', linkedin: 'LinkedIn' } as const;

/** The open business's reminder rows: one per unsent reminder draft whose invoice is issued and still owed. */
export function reminderRows(deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  if (!venture.country) return []; // a business still in its interview has no invoices to remind about
  const today = localDayAt(deps.clock(), venture.country);
  const invoices = new Map(listRecords(state, 'venture-invoice', venture.id).map(invoice => [invoice.id, invoice]));
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client]));
  return listRecords(state, 'venture-outreach', venture.id).flatMap(draft => {
    const invoice = draft.invoiceId ? invoices.get(draft.invoiceId) : undefined;
    if (draft.outreachKind !== 'reminder' || draft.sent || !invoice || invoice.number === null || invoice.status === 'void' || BigInt(invoice.balanceMinor) <= 0n) return [];
    const client = clients.get(invoice.clientId)?.name ?? 'Your client';
    const late = invoice.dueDate ? daysFrom(invoice.dueDate, today) : 0;
    const when = late > 0 ? lateWords(late) : invoice.dueDate ? `due ${formatVentureDate(invoice.dueDate, venture.country.dateOrder)}` : 'awaiting payment';
    const where = draft.to ? `Your reminder is drafted for ${APP[draft.channel]}: open it, send it yourself, then tap I sent it.` : `Your reminder is drafted, but ${client} has no email address yet. Add one, then send it yourself.`;
    return [{
      kind: 'followup' as const, subject: `reminder:${draft.id}`, version: draft.digest, createdAt: draft.at,
      title: `Send the payment reminder for ${invoice.number}`, line: `${client}, ${when}. ${where}`,
      actions: [{ id: 'sent' as const, label: 'I sent it', primary: false }, { id: 'open' as const, label: OPEN_LABEL[draft.channel], primary: true }],
      navigate: `Open the reminder for ${invoice.number} from Money, Invoices, and send it yourself.`,
    }];
  });
}
