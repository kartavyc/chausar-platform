// Chausar venture launcher, money (Ink v2 wave 4, package 4J5, M17 data): one client's statement, "What you owe us",
// for 4J7's read-only share page. clientStatement reads records only and never another client's: open invoices with
// what was paid and credited on each, the payments so far (cheques still waiting are listed apart and not counted as
// paid), and the credit notes issued. Each total has a sum receipt plan; statementReceipts seals them. The 'statement'
// subject's plans live here (money/sums.ts currentPlan calls statementPlan), and so does one invoice's balance, which a
// reminder's amount rests on: its total less what was paid (with any TDS) and credited. Money in BigInt minor units.
import { check, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { currentVenture, formatVentureDate, listRecords } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { creditedOn, daysFrom, issuedCredits, lateWords, METHOD_WORDS, paymentState } from './ledger.ts';
import { owedPlan, sumReceipt, type Addend, type SumPlan } from './sums.ts';
import type { Display, InvoiceRecord, IsoDate, MinorString, SumReceiptSubject, VentureDeps, VentureRecord } from '../contracts.ts';

const SHOWN: readonly InvoiceRecord['status'][] = ['issued', 'part-paid', 'paid'];

export type StatementMoney = { minor: MinorString; display: Display };
/** One client's statement. Displays are engine-formatted; each total's plan is what its receipt adds up. */
export type ClientStatement = {
  client: { id: string; name: string };
  currency: string;
  asOf: IsoDate;
  open: { invoiceId: string; number: string; issueDate: IsoDate | null; dueDate: IsoDate | null; total: Display; paid: Display; credited: Display; balance: Display; late: Display | null; receiptId: string }[];
  paid: { paymentId: string; invoiceId: string; number: string; receivedOn: IsoDate; amount: Display; method: Display; tds: Display | null; receiptId: string | null }[];
  /** A cheque still waiting to clear: the cheque's own amount, and any TDS the client deducted named apart. */
  waiting: { paymentId: string; invoiceId: string; number: string; amount: Display; tds: Display | null; line: Display }[];
  credits: { creditNoteId: string; number: string; invoiceId: string; invoiceNumber: string; issuedOn: IsoDate; amount: Display; reason: string }[];
  owed: StatementMoney;
  paidTotal: StatementMoney;
  creditedTotal: StatementMoney;
  plans: { owed: SumPlan; paid: SumPlan; credited: SumPlan };
};

const money = (minor: bigint, currency: string): StatementMoney => ({ minor: String(minor), display: formatMinor(minor, currency) });
const planSum = (plan: SumPlan) => plan.addends.reduce((total, addend) => total + BigInt(addend.amount), 0n);

/** The client's numbered invoices the statement can show, oldest first. */
function shownInvoices(state: State, venture: VentureRecord, clientId: string): InvoiceRecord[] {
  return listRecords(state, 'venture-invoice', venture.id)
    .filter(invoice => invoice.clientId === clientId && invoice.number !== null && SHOWN.includes(invoice.status) && invoice.currency === venture.country.currency)
    .sort((a, b) => (a.issueDate ?? '').localeCompare(b.issueDate ?? '') || (a.number as string).localeCompare(b.number as string));
}

/**
 * The plans of the 'statement' subject: a client's payments so far (each cleared payment's cash, and its TDS as its own
 * line), the credit notes issued on their invoices, or one invoice's balance (its total, less each payment and credit).
 */
export function statementPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'statement' }>): SumPlan {
  const currency = venture.country.currency;
  const invoices = shownInvoices(state, venture, subject.clientId).filter(invoice => subject.invoiceId === null || invoice.id === subject.invoiceId);
  const ids = new Set(invoices.map(invoice => invoice.id));
  const numbers = new Map(invoices.map(invoice => [invoice.id, invoice.number as string]));
  const payments = listRecords(state, 'venture-payment', venture.id)
    .filter(payment => ids.has(payment.invoiceId) && paymentState(payment) === 'cleared')
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.at.localeCompare(b.at));
  const credits = listRecords(state, 'venture-credit-note', venture.id);
  const line = (recordId: string, label: string, amount: bigint): Addend => ({ recordId, label, amount: String(amount), display: formatMinor(amount, currency), estimate: false });
  const paidLines = (sign: bigint): Addend[] => payments.flatMap(payment => {
    const number = numbers.get(payment.invoiceId) as string;
    const when = formatVentureDate(payment.receivedOn, venture.country.dateOrder);
    const cash = line(payment.id, `${sign < 0n ? 'Less paid on ' : ''}${number}, ${when}`, sign * BigInt(payment.amountMinor));
    return payment.tds ? [cash, line(payment.id, `${sign < 0n ? 'Less TDS' : 'TDS'} on ${number} under ${payment.tds.section}`, sign * BigInt(payment.tds.amountMinor))] : [cash];
  });
  const creditLines = (sign: bigint): Addend[] => invoices.flatMap(invoice => issuedCredits(invoice.id, credits)
    .map(note => line(note.id, `${sign < 0n ? 'Less credit' : 'Credit'} note ${note.number} on ${invoice.number}`, sign * BigInt(note.amountMinor))));
  const subjectCopy = { ...subject };
  if (subject.part === 'paid') {
    return { subject: subjectCopy, currency, unit: 'minor', addends: paidLines(1n), words: { label: 'Paid so far', one: 'payment', many: 'payments', none: 'Nothing was paid yet.' } };
  }
  if (subject.part === 'credited') {
    return { subject: subjectCopy, currency, unit: 'minor', addends: creditLines(1n), words: { label: 'Credit notes', one: 'credit note', many: 'credit notes', none: 'No credit notes were issued.' } };
  }
  const invoice = invoices[0];
  check(invoice && subject.invoiceId !== null, 'RECEIPT_NOT_FOUND', 'The invoice behind this receipt was not found.');
  return {
    subject: subjectCopy, currency, unit: 'minor',
    addends: [line(invoice.id, `${invoice.number} total`, BigInt(invoice.totalMinor)), ...paidLines(-1n), ...creditLines(-1n)],
    words: { label: `Left to pay on ${invoice.number}`, one: 'line', many: 'lines', none: 'Nothing to add up.' },
  };
}

/**
 * One client's statement as of a day on the owner's calendar (asOf: the caller's today, so a page and a test say the
 * same). Refuses a client this business does not have. Reads only; nothing here is a model number.
 */
export function clientStatement(state: State, clientId: string, asOf: IsoDate): ClientStatement {
  const venture = currentVenture(state);
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const client = listRecords(state, 'venture-client', venture.id).find(item => item.id === clientId);
  check(client, 'CLIENT_NOT_FOUND', 'This client was not found.');
  const currency = venture.country.currency;
  const date = (iso: IsoDate) => formatVentureDate(iso, venture.country.dateOrder);
  const invoices = shownInvoices(state, venture, client.id);
  const numbers = new Map(invoices.map(invoice => [invoice.id, invoice.number as string]));
  const payments = listRecords(state, 'venture-payment', venture.id).filter(payment => numbers.has(payment.invoiceId))
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.at.localeCompare(b.at));
  const credits = listRecords(state, 'venture-credit-note', venture.id);
  const books = new Map(listRecords(state, 'venture-payment', venture.id).map(payment => [payment.id, payment.booksReceiptId]));
  const open = invoices.filter(invoice => BigInt(invoice.balanceMinor) > 0n && invoice.status !== 'paid').map(invoice => {
    const late = invoice.dueDate !== null && daysFrom(invoice.dueDate, asOf) > 0 ? lateWords(daysFrom(invoice.dueDate, asOf)) : null;
    return {
      invoiceId: invoice.id, number: invoice.number as string, issueDate: invoice.issueDate, dueDate: invoice.dueDate,
      total: formatMinor(invoice.totalMinor, currency), paid: formatMinor(invoice.paidMinor, currency),
      credited: formatMinor(creditedOn(invoice.id, credits), currency), balance: formatMinor(invoice.balanceMinor, currency), late, receiptId: invoice.priceReceiptId,
    };
  });
  const paid = payments.filter(payment => paymentState(payment) === 'cleared').map(payment => ({
    paymentId: payment.id, invoiceId: payment.invoiceId, number: numbers.get(payment.invoiceId) as string, receivedOn: payment.receivedOn,
    amount: formatMinor(payment.amountMinor, currency), method: METHOD_WORDS[payment.method],
    tds: payment.tds ? `TDS ${formatMinor(payment.tds.amountMinor, currency)} under ${payment.tds.section}` : null, receiptId: books.get(payment.id) ?? null,
  }));
  const waiting = payments.filter(payment => paymentState(payment) === 'pending').map(payment => ({
    paymentId: payment.id, invoiceId: payment.invoiceId, number: numbers.get(payment.invoiceId) as string,
    amount: formatMinor(payment.amountMinor, currency), tds: payment.tds ? `TDS ${formatMinor(payment.tds.amountMinor, currency)} under ${payment.tds.section}` : null,
    line: `Cheque received on ${date(payment.receivedOn)}, waiting to clear.`,
  }));
  const notes = invoices.flatMap(invoice => issuedCredits(invoice.id, credits).map(note => ({
    creditNoteId: note.id, number: note.number as string, invoiceId: invoice.id, invoiceNumber: invoice.number as string,
    issuedOn: localDayAt(note.issuedAt as string, venture.country), amount: formatMinor(note.amountMinor, currency), reason: note.reason,
  })));
  const plans = {
    owed: owedPlan(state, venture, client.id),
    paid: statementPlan(state, venture, { type: 'statement', clientId: client.id, part: 'paid', invoiceId: null }),
    credited: statementPlan(state, venture, { type: 'statement', clientId: client.id, part: 'credited', invoiceId: null }),
  };
  return {
    client: { id: client.id, name: client.name }, currency, asOf, open, paid, waiting, credits: notes,
    owed: money(planSum(plans.owed), currency), paidTotal: money(planSum(plans.paid), currency), creditedTotal: money(planSum(plans.credited), currency), plans,
  };
}

/** Seals the statement's three totals as sum receipts (one write each when the sum is new) and answers their ids. */
export async function statementReceipts(deps: VentureDeps, ctx: Context, statement: ClientStatement): Promise<{ owed: string; paid: string; credited: string }> {
  const venture = currentVenture(deps.store.read());
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const seal = async (plan: SumPlan) => (await sumReceipt(deps, ctx, venture.id, plan)).id;
  return { owed: await seal(statement.plans.owed), paid: await seal(statement.plans.paid), credited: await seal(statement.plans.credited) };
}
