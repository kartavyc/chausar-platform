// Chausar venture launcher, money (Ink v2 wave 4, package 4J4, U11 and P12): the month for the owner's CA
// (venture.money.export, the owner's approval, inside the app). One CSV file with only what a CA needs: the month's
// invoices (number, date, the client's name, tax id and place of supply, amounts before tax, tax and total, status and
// price receipt), credit notes, cleared payments (with any TDS the client deducted) and the books' costs, then the
// month's invoiced and received totals with their sum receipts. No client email, address, phone or request text goes in.
// Amounts are plain numbers in the business's currency that code wrote, a minus kept where one belongs (a month whose
// credit notes outweigh its invoices). Any text cell that begins like a formula (=, +, -, @, a tab or a carriage return)
// is prefixed with an apostrophe so a spreadsheet shows it as text. Every money row names its currency: money in
// another currency is listed in its own, so the CA gets it too, and a "Not in totals" line says it is kept out of the
// totals, which are in the business's currency alone. Chausar never sends the file: the desktop saves it where the
// owner picks (app/desktop/money-export.cjs), the web page downloads it.
import { authorize, type Context } from '../../contracts.ts';
import { currencyMinorDigits } from '../../currency.ts';
import { exactPayload, listRecords, readVenture, requireAppChannel } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import type { InvoiceRecord, MoneyExportFile, VentureDeps } from '../contracts.ts';
import { calendarMonth } from './dates.ts';
import { beforeTax, creditBeforeTax, invoicedPlan, monthText, monthWords } from './goal-plans.ts';
import { METHOD_WORDS, paymentState } from './ledger.ts';
import { costsOut } from './flow.ts';
import { receivedPlan, sumReceipt } from './sums.ts';
import { costsElsewhere, creditsElsewhere, invoicesElsewhere, moneyCountry, paymentsElsewhere } from './figure-kinds.ts';
import { signedReceiptsFile } from '../journal/signing.ts';

/** The columns, in order. */
type Column = 'Section' | 'Date' | 'Number' | 'Party' | 'Party tax ID' | 'Place of supply' | 'Description' | 'Before tax' | 'Tax' | 'Total' | 'Status' | 'Method' | 'TDS section' | 'TDS' | 'Receipt' | 'Currency';
const HEADER = 'Section,Date,Number,Party,Party tax ID,Place of supply,Description,Before tax,Tax,Total,Status,Method,TDS section,TDS,Receipt,Currency'.split(',') as Column[];
type Row = Partial<Record<Column, string>>;

const STATUS_WORDS: Readonly<Record<InvoiceRecord['status'], string>> = Object.freeze({ draft: 'Draft', issued: 'Issued', 'part-paid': 'Part paid', paid: 'Paid', void: 'Void' });

/**
 * One CSV cell: text that a spreadsheet would run as a formula (it begins with =, +, -, @, a tab or a carriage return)
 * gets an apostrophe first; a cell with a comma, a quote or a line break is quoted, its quotes doubled.
 */
export function csvCell(value: string): string {
  const cell = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Minor units as a plain decimal in the currency's own digits ('1975000' INR is '19750.00'). */
function decimal(minor: bigint, currency: string): string {
  const digits = currencyMinorDigits(currency), scale = 10n ** BigInt(digits);
  const absolute = minor < 0n ? -minor : minor;
  return `${minor < 0n ? '-' : ''}${absolute / scale}${digits ? `.${String(absolute % scale).padStart(digits, '0')}` : ''}`;
}

/** The amount columns: plain numbers code wrote, a minus kept where one belongs (a month whose credit notes outweigh it). */
const AMOUNTS: ReadonlySet<Column> = new Set<Column>(['Before tax', 'Tax', 'Total', 'TDS']);
const NUMBER = /^-?\d+(?:\.\d+)?$/;

/** One cell of a column: an amount that is a plain number stays a number; every other cell goes through csvCell. */
function cellOf(column: Column, value: string): string {
  return AMOUNTS.has(column) && NUMBER.test(value) ? value : csvCell(value);
}

/** A file name from the business's working name: lower-case letters and digits joined by dashes. */
function fileNameOf(workingName: string, month: string): string {
  const slug = workingName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return `${slug || 'chausar'}-${month}-for-ca.csv`;
}

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "2 invoices, 1 payment and 2 costs". */
function listed(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * venture.money.export { month } (approve, app only): the month's invoices, credit notes, payments, costs and receipted
 * totals as CSV text for the owner's CA, with a file name. Nothing is sent; nothing is written but the totals' receipts.
 */
export async function moneyExport(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MoneyExportFile> {
  requireAppChannel(ctx, 'venture.money.export');
  authorize(deps.store, ctx, 'approve');
  const body = exactPayload(payload, ['month'], ['month']);
  const month = monthText(body.month);
  const { state, venture } = readVenture(deps, ctx);
  const country = moneyCountry(venture);
  const currency = country.currency;
  // Each row in its own currency, named in the Currency column: the CA gets money in another currency too.
  const money = (minor: bigint, rowCurrency: string = currency) => decimal(minor, rowCurrency);
  const { from, to } = calendarMonth(month);
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const invoices = listRecords(state, 'venture-invoice', venture.id);
  const numberOf = new Map(invoices.map(invoice => [invoice.id, invoice.number]));

  const invoiceRows: Row[] = invoices
    .filter(invoice => invoice.number !== null && invoice.status !== 'draft' && invoice.issueDate !== null && invoice.issueDate >= from && invoice.issueDate <= to)
    .sort((a, b) => (a.issueDate as string).localeCompare(b.issueDate as string) || (a.number as string).localeCompare(b.number as string))
    .map(invoice => ({
      Section: 'Invoice', Date: invoice.issueDate as string, Number: invoice.number as string, Party: clients.get(invoice.clientId) ?? '', 'Party tax ID': invoice.clientTaxId ?? '',
      'Place of supply': invoice.placeOfSupply ?? '', Description: invoice.lines.map(line => line.description).join('; '),
      'Before tax': money(beforeTax(invoice), invoice.currency), Tax: money(BigInt(invoice.taxMinor), invoice.currency), Total: money(BigInt(invoice.totalMinor), invoice.currency),
      Status: STATUS_WORDS[invoice.status], Receipt: invoice.priceReceiptId, Currency: invoice.currency,
    }));
  const credits = listRecords(state, 'venture-credit-note', venture.id)
    .filter(note => note.status === 'issued' && note.issuedAt !== null && localDayAt(note.issuedAt, country) >= from && localDayAt(note.issuedAt, country) <= to)
    .sort((a, b) => (a.issuedAt as string).localeCompare(b.issuedAt as string) || a.id.localeCompare(b.id));
  const creditRows: Row[] = credits.map(note => {
    const invoice = invoices.find(item => item.id === note.invoiceId);
    const before = creditBeforeTax(note, invoice);
    return {
      Section: 'Credit note', Date: localDayAt(note.issuedAt as string, country), Number: note.number ?? '', Party: invoice ? clients.get(invoice.clientId) ?? '' : '',
      'Party tax ID': invoice?.clientTaxId ?? '', 'Place of supply': invoice?.placeOfSupply ?? '', Description: `On ${invoice?.number ?? 'an invoice'}: ${note.reason}`,
      'Before tax': money(before, note.currency), Tax: money(BigInt(note.amountMinor) - before, note.currency), Total: money(BigInt(note.amountMinor), note.currency), Status: 'Issued',
      Currency: note.currency,
    };
  });
  const paymentRows: Row[] = listRecords(state, 'venture-payment', venture.id)
    .filter(payment => paymentState(payment) === 'cleared' && payment.receivedOn >= from && payment.receivedOn <= to)
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.at.localeCompare(b.at))
    .map(payment => {
      const invoice = invoices.find(item => item.id === payment.invoiceId);
      return {
        Section: 'Payment', Date: payment.receivedOn, Number: numberOf.get(payment.invoiceId) ?? '', Party: invoice ? clients.get(invoice.clientId) ?? '' : '',
        Total: money(BigInt(payment.amountMinor), payment.currency), Status: 'Cleared', Method: capital(METHOD_WORDS[payment.method]),
        'TDS section': payment.tds?.section ?? '', TDS: payment.tds ? money(BigInt(payment.tds.amountMinor), payment.currency) : '', Receipt: payment.booksReceiptId ?? '',
        Currency: payment.currency,
      };
    });
  const vendors = new Map(listRecords(state, 'venture-bill', venture.id).flatMap(bill => bill.payments.filter(item => item.factId !== null).map(item => [item.factId as string, bill.vendor])));
  const costRows: Row[] = costsOut(state, venture, from, to, null).map(cost => {
    const fields = cost.fact.fields;
    const rowCurrency = typeof fields.currency === 'string' && /^[A-Z]{3}$/.test(fields.currency) ? fields.currency : currency;
    const tax = typeof fields.taxMinor === 'string' && /^\d+$/.test(fields.taxMinor) ? BigInt(fields.taxMinor) : 0n;
    return {
      Section: 'Cost', Date: cost.fact.validFrom, Party: vendors.get(cost.fact.id) ?? '', Description: typeof fields.description === 'string' ? fields.description : '',
      'Before tax': money(cost.cash - tax, rowCurrency), Tax: money(tax, rowCurrency), Total: money(cost.cash, rowCurrency), Currency: rowCurrency,
      Method: typeof fields.billId === 'string' ? 'Bill paid' : typeof fields.bankReference === 'string' ? 'Bank statement' : 'Recorded',
    };
  });

  const data = [...invoiceRows, ...creditRows, ...paymentRows, ...costRows];
  const totals: Row[] = [];
  if (data.length) {
    const invoiced = await sumReceipt(deps, ctx, venture.id, invoicedPlan(state, venture, { type: 'invoiced', month, which: 'issued' }));
    const received = await sumReceipt(deps, ctx, venture.id, receivedPlan(state, venture, from, to));
    totals.push(
      { Section: 'Total', Description: 'Invoiced before tax, less credit notes', 'Before tax': money(BigInt(invoiced.totalMinor)), Receipt: invoiced.id, Currency: currency },
      { Section: 'Total', Description: 'Received, tax included', Total: money(BigInt(received.totalMinor)), Receipt: received.id, Currency: currency },
    );
  }
  // Money in another currency is listed in its own currency above but never added into the totals: one line for each kind.
  const elsewhere: Row[] = [
    [invoicesElsewhere(state, venture, from, to), 'invoice', 'invoices'], [creditsElsewhere(state, venture, from, to), 'credit note', 'credit notes'],
    [paymentsElsewhere(state, venture, from, to), 'payment', 'payments'], [costsElsewhere(state, venture, from, to), 'cost', 'costs'],
  ].filter(([count]) => (count as number) > 0).map(([count, one, many]) => ({
    Section: 'Not in totals', Description: `${count} ${count === 1 ? one : many} in another currency ${count === 1 ? 'is' : 'are'} listed in ${count === 1 ? 'its' : 'their'} own currency and left out of the totals: Chausar has no rate to ${currency}.`,
  }));
  const rows = [...data, ...totals, ...elsewhere];
  const csv = `\uFEFF${[HEADER.join(','), ...rows.map(row => HEADER.map(column => cellOf(column, row[column] ?? '')).join(','))].join('\r\n')}\r\n`;
  const parts = [
    ...(invoiceRows.length ? [plural(invoiceRows.length, 'invoice', 'invoices')] : []),
    ...(creditRows.length ? [plural(creditRows.length, 'credit note', 'credit notes')] : []),
    ...(paymentRows.length ? [plural(paymentRows.length, 'payment', 'payments')] : []),
    ...(costRows.length ? [plural(costRows.length, 'cost', 'costs')] : []),
  ];
  const what = parts.length ? listed(parts) : 'nothing was invoiced, paid or spent';
  return {
    fileName: fileNameOf(venture.workingName, month), csv, rows: rows.length,
    line: `${monthWords(month)} for your CA: ${what}. Chausar does not send it; save it and share it yourself.`,
    // 4J10 (H26): the business's signed receipts with the public halves of its keys, so the CA can check them offline
    // (node scripts/verify-receipts.mjs). Read after the totals above, whose receipts this call may just have made.
    receipts: signedReceiptsFile(deps.store.read(), venture),
  };
}
