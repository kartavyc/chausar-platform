// C5 task 18: the month as files a CA's own tools take in. Tally: the month's sales and credit notes as vouchers, with
// party and GST ledger names the CA can rename there (the voucher fields follow the bounded profile in
// adapters/accounting/tally-write-xml.ts; no inventory, no statutory tags). GSTR-1: for a GST-registered business, one CSV
// with B2B rows, B2CS groups and the HSN summary, each marked by its Sheet column, from the same sale lines as the GST
// working (tax-working.ts). Both are for the CA to check; Chausar files nothing.
import { ChausarError, check, type State } from '../../contracts.ts';
import { tallyDecimal, tallyField, tallyXml } from '../../adapters/accounting/tally-write-xml.ts';
import { gstinValid } from '../../memory.ts';
import type { InvoiceRecord, MoneyExportFile, VentureRecord } from '../contracts.ts';
import { localDayAt } from '../local-day.ts';
import { listRecords } from '../records.ts';
import { csvCell } from './csv-cell.ts';
import { calendarMonth } from './dates.ts';
import { moneyCountry } from './figure-kinds.ts';
import { creditBeforeTax, monthWords } from './goal-plans.ts';
import { saleLines } from './tax-working.ts';

export const EXPORT_FORMATS = ['csv', 'tally-xml', 'gstr1-csv'] as const;
export type MoneyExportFormat = typeof EXPORT_FORMATS[number];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const SALES_LEDGER = 'Sales';

/** The month's invoices the owner issued, void ones left out, in date and number order. */
function issuedIn(state: State, venture: VentureRecord, month: string): InvoiceRecord[] {
  const { from, to } = calendarMonth(month);
  return listRecords(state, 'venture-invoice', venture.id)
    .filter(invoice => invoice.number !== null && invoice.status !== 'draft' && invoice.status !== 'void' && invoice.issueDate !== null && invoice.issueDate >= from && invoice.issueDate <= to)
    .sort((a, b) => (a.issueDate as string).localeCompare(b.issueDate as string) || (a.number as string).localeCompare(b.number as string));
}

/** One voucher: the party's line first (a debit, so negative in Tally's signs), then sales and each tax head. */
function voucherXml(type: 'Sales' | 'Credit Note', date: string, number: string, party: string, narration: string, lines: { name: string; amount: bigint; party: boolean }[]): string {
  const entries = lines.map(line => `<ALLLEDGERENTRIES.LIST>${tallyField('LEDGERNAME', line.name)}${tallyField('ISDEEMEDPOSITIVE', line.amount < 0n ? 'Yes' : 'No')}${tallyField('ISPARTYLEDGER', line.party ? 'Yes' : 'No')}${tallyField('AMOUNT', tallyDecimal(String(line.amount)))}</ALLLEDGERENTRIES.LIST>`).join('');
  return `<TALLYMESSAGE><VOUCHER VCHTYPE="${tallyXml(type)}" ACTION="Create">${tallyField('DATE', date.replace(/-/g, ''))}${tallyField('VOUCHERTYPENAME', type)}${tallyField('VOUCHERNUMBER', number)}<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><ISINVOICE>No</ISINVOICE>${tallyField('PARTYLEDGERNAME', party)}${tallyField('NARRATION', narration)}${entries}</VOUCHER></TALLYMESSAGE>`;
}

const ledgerText = (value: string, fallback: string) => value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) || fallback;

/** A tax head's ledger: 'CGST at 9%' on the invoice is the CGST ledger here. */
const ledgerOf = (label: string) => ledgerText(label.replace(/\s+at\s+[\d.]+%$/, ''), 'Tax');

/** venture.money.export { format: 'tally-xml' }: the month's sales and credit notes as Tally vouchers. Rupees only. */
export function tallyFile(state: State, venture: VentureRecord, month: string, base: string): MoneyExportFile {
  const country = moneyCountry(venture);
  check(country.currency === 'INR', 'INVALID_VENTURE_REQUEST', 'The Tally file is for a business that keeps its books in rupees.');
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const all = issuedIn(state, venture, month);
  const invoices = all.filter(invoice => invoice.currency === 'INR');
  const taxOf = (invoice: InvoiceRecord | undefined) => invoice?.taxLines ?? [];
  const sales = invoices.map(invoice => {
    const party = ledgerText(clients.get(invoice.clientId) ?? '', 'Client');
    const tax = taxOf(invoice).map(line => ({ name: ledgerOf(line.label), amount: BigInt(line.minor), party: false }));
    const total = BigInt(invoice.totalMinor), taxed = tax.reduce((sum, line) => sum + line.amount, 0n);
    return voucherXml('Sales', invoice.issueDate as string, invoice.number as string, party, invoice.lines.map(line => line.description).join('; ').slice(0, 500), [
      { name: party, amount: -total, party: true }, { name: SALES_LEDGER, amount: total - taxed, party: false }, ...tax,
    ]);
  });
  const { from, to } = calendarMonth(month);
  const everyInvoice = listRecords(state, 'venture-invoice', venture.id);
  const allCredits = listRecords(state, 'venture-credit-note', venture.id)
    .filter(note => note.status === 'issued' && note.issuedAt !== null && localDayAt(note.issuedAt, country) >= from && localDayAt(note.issuedAt, country) <= to)
    .sort((a, b) => (a.issuedAt as string).localeCompare(b.issuedAt as string) || a.id.localeCompare(b.id));
  const creditNotes = allCredits.filter(note => note.currency === 'INR');
  const credits = creditNotes.map(note => {
    const invoice = everyInvoice.find(item => item.id === note.invoiceId);
    const party = ledgerText(invoice ? clients.get(invoice.clientId) ?? '' : '', 'Client');
    const amount = BigInt(note.amountMinor), before = creditBeforeTax(note, invoice), taxed = amount - before;
    // The note's tax goes to the invoice's tax heads in their own shares; the last head takes what rounding leaves.
    const heads = taxOf(invoice), whole = heads.reduce((sum, line) => sum + BigInt(line.minor), 0n);
    let left = taxed;
    const tax = heads.map((line, index) => {
      const share = index === heads.length - 1 || whole === 0n ? left : taxed * BigInt(line.minor) / whole;
      left -= share;
      return { name: ledgerOf(line.label), amount: -share, party: false };
    }).filter(line => line.amount !== 0n);
    const unhomed = heads.length ? 0n : taxed;
    return voucherXml('Credit Note', localDayAt(note.issuedAt as string, country), note.number ?? note.id, party, `On ${invoice?.number ?? 'an invoice'}: ${note.reason}`.slice(0, 500), [
      { name: party, amount, party: true }, { name: SALES_LEDGER, amount: -(before + unhomed), party: false }, ...tax,
    ]);
  });
  const vouchers = [...sales, ...credits];
  const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${vouchers.join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
  const elsewhere = all.length - invoices.length + allCredits.length - creditNotes.length;
  const what = [
    ...(sales.length ? [plural(sales.length, 'sale', 'sales')] : []), ...(credits.length ? [plural(credits.length, 'credit note', 'credit notes')] : []),
  ].join(' and ') || 'no sales';
  const left = elsewhere ? ` ${plural(elsewhere, 'entry', 'entries')} in another currency ${elsewhere === 1 ? 'is' : 'are'} left out.` : '';
  return {
    format: 'tally-xml', fileName: `${base}-tally.xml`, csv: xml, rows: vouchers.length,
    line: `${monthWords(month)} for Tally: ${what}.${left} Your CA imports it and can rename the ledgers there. Chausar files nothing.`,
  };
}

const IGST = 'IGST', CGST = 'CGST', SGST = 'SGST';
const GSTR1_HEADER = ['Sheet', 'Buyer GSTIN', 'Buyer', 'Invoice', 'Date', 'Invoice value', 'Place of supply', 'HSN or SAC', 'Rate', 'Invoices', 'Taxable value', IGST, CGST, SGST, 'Note'] as const;
type Gstr1Row = Partial<Record<typeof GSTR1_HEADER[number], string>>;
const paise = (minor: bigint | string) => { const value = BigInt(minor); return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`; };
const percent = (bps: string) => paise(bps);
const AMOUNTS = new Set<string>(['Invoice value', 'Rate', 'Invoices', 'Taxable value', IGST, CGST, SGST]);

/** venture.money.export { format: 'gstr1-csv' }: for a GST-registered business only. */
export function gstr1File(state: State, venture: VentureRecord, month: string, base: string): MoneyExportFile {
  const plan = listRecords(state, 'venture-blueprint', venture.id).find(item => item.id === venture.acceptedBlueprintId) ?? null;
  const office = plan?.backOffice ?? null;
  if (!office || office.taxMode !== 'gst' || office.taxRegistered.value !== true) {
    throw new ChausarError('GST_NOT_REGISTERED', 'This file is for a GST-registered business. Turn on I charge GST under Business, Prices if you are.');
  }
  const gstin = office.taxId ?? '';
  check(gstinValid(gstin), 'GST_NOT_REGISTERED', 'Add your GSTIN under Business, Prices first.');
  const invoices = issuedIn(state, venture, month);
  const built = saleLines(state, venture, invoices, gstin);
  const byNumber = new Map(invoices.map(invoice => [invoice.number as string, invoice]));
  const names = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const b2b: Gstr1Row[] = [];
  type Group = { invoices: number; taxable: bigint; igst: bigint; cgst: bigint; sgst: bigint };
  const adding = (groups: Map<string, Group>, key: string, line: (typeof built.lines)[number]) => {
    const group = groups.get(key) ?? { invoices: 0, taxable: 0n, igst: 0n, cgst: 0n, sgst: 0n };
    group.invoices += 1; group.taxable += BigInt(line.taxableMinor);
    group.igst += BigInt(line.charged?.igstMinor ?? '0'); group.cgst += BigInt(line.charged?.cgstMinor ?? '0'); group.sgst += BigInt(line.charged?.sgstMinor ?? '0');
    groups.set(key, group);
  };
  const b2cs = new Map<string, Group>(), hsn = new Map<string, Group>();
  for (const line of built.lines) {
    adding(hsn, `${line.hsnSac}|${line.rateBps}`, line);
    if (line.counterpartyGstin === null) { adding(b2cs, `${line.placeOfSupply}|${line.rateBps}`, line); continue; }
    const invoice = byNumber.get(line.invoiceNo);
    b2b.push({
      Sheet: 'B2B', 'Buyer GSTIN': line.counterpartyGstin, Buyer: invoice ? names.get(invoice.clientId) ?? '' : '', Invoice: line.invoiceNo, Date: line.date,
      'Invoice value': invoice ? paise(invoice.totalMinor) : '', 'Place of supply': line.placeOfSupply, 'HSN or SAC': line.hsnSac, Rate: percent(line.rateBps), 'Taxable value': paise(line.taxableMinor),
      IGST: paise(line.charged?.igstMinor ?? '0'), CGST: paise(line.charged?.cgstMinor ?? '0'), SGST: paise(line.charged?.sgstMinor ?? '0'),
    });
  }
  const groupCells = (group: Group): Gstr1Row => ({ Invoices: String(group.invoices), 'Taxable value': paise(group.taxable), IGST: paise(group.igst), CGST: paise(group.cgst), SGST: paise(group.sgst) });
  const rows: Gstr1Row[] = [
    ...b2b,
    ...[...b2cs].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => { const [place, rate] = key.split('|'); return { Sheet: 'B2CS', 'Place of supply': place, Rate: percent(rate!), ...groupCells(group) }; }),
    ...[...hsn].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => { const [code, rate] = key.split('|'); return { Sheet: 'HSN', 'HSN or SAC': code, Rate: percent(rate!), ...groupCells(group) }; }),
    ...built.left.map((item): Gstr1Row => ({ Sheet: 'Left out', Invoice: item.label, Note: item.value })),
  ];
  const cell = (column: string, value: string) => (AMOUNTS.has(column) && /^\d+(?:\.\d+)?$/.test(value) ? value : csvCell(value));
  const csv = `﻿${[GSTR1_HEADER.join(','), ...rows.map(row => GSTR1_HEADER.map(column => cell(column, row[column] ?? '')).join(','))].join('\r\n')}\r\n`;
  const left = built.left.length ? ` ${plural(built.left.length, 'invoice is', 'invoices are')} left out, each with its reason.` : '';
  return {
    format: 'gstr1-csv', fileName: `${base}-gstr1.csv`, csv, rows: rows.length,
    line: `${monthWords(month)} shaped for GSTR-1: ${plural(built.lines.length, 'invoice', 'invoices')}.${left} Your CA checks it and files the return. Chausar files nothing.`,
  };
}
