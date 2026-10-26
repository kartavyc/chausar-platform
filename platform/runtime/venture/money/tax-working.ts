// venture.tax.working { period? }: the tax working for a month or a financial year, for the Money place.
//
// For a business whose idea picks the AI-native CA firm playbook, the firm's own GST is worked by the playbook's GST
// engine (playbooks/ca-firm/gst.ts) from the invoices it issued in the month, in BigInt paise, against the rate table
// for each invoice's date. Each invoice line carries its price receipt, which the receipt sheet opens; the totals come
// from the engine's working receipt, which is named in the note but is not a stored receipt, so those lines carry no
// receipt id. Purchases are not in Chausar, so no input credit is counted; TDS needs a payments register with sections,
// which Chausar does not keep, so it says so instead of working anything. A year shows each month's GST to pay and
// what was billed; the income tax computation needs the owner's whole income, regime and deductions, which Chausar does
// not hold. needsCaConfirmation stays true while any rate table the working uses is not confirmed by the CA of record.
//
// For every other business it is the plan's tax setting, the tax on each invoice issued in the period with its price
// receipt, the period's total, and the books' tax note. Nothing here computes money outside BigInt code.
import { check, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { gstinValid } from '../../memory.ts';
import { bpsPercent, exactPayload, listRecords, readVenture } from '../records.ts';
import type {
  BlueprintRecord, InvoiceRecord, IsoDate, TaxWorkingLine, TaxWorkingSection, TaxWorkingView, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { pickPlaybook } from '../playbooks/registry.ts';
import { CA_FIRM_ID } from '../playbooks/ca-firm/registration.ts';
import type { GstLine } from '../playbooks/ca-firm/gst.ts';
import type { CaReceipt } from '../playbooks/ca-firm/receipt.ts';
import { BOOKS_TAX_NOTE } from './books.ts';
import { calendarMonth, todayLocal } from './dates.ts';
import { latestBlueprint } from './shared.ts';

const ISSUED: readonly InvoiceRecord['status'][] = ['issued', 'part-paid', 'paid'];
const PERIOD_WORDS = "Choose a month like 2026-10, or a financial year like FY 2025-26 or AY 2026-27.";
export const TDS_NOTE = 'Chausar keeps no payments register with TDS sections, so there is no TDS working here. Your CA works it from your payments.';
export const NO_PURCHASES = 'Purchases are not in Chausar yet, so no input credit is counted. Your CA adds the purchase register before anything is filed.';

type Period =
  | { kind: 'month'; month: string; from: IsoDate; to: IsoDate; display: string }
  | { kind: 'year'; fy: string; ay: string; from: IsoDate; to: IsoDate; display: string };

function monthPeriod(month: string): Period {
  return { kind: 'month', ...calendarMonth(month) };
}

/** 'YYYY-MM' is a month; 'FY 2025-26' and 'AY 2026-27' are the same financial year, 1 April to 31 March. */
export function parsePeriod(value: unknown, today: IsoDate): Period {
  if (value === undefined) return monthPeriod(today.slice(0, 7));
  check(typeof value === 'string' && value.length <= 20, 'INVALID_VENTURE_REQUEST', PERIOD_WORDS);
  const text = (value as string).trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return monthPeriod(text);
  const year = /^(FY|AY)\s?(\d{4})-(\d{2})$/i.exec(text);
  // Calendar years, not amounts: whole numbers read with parseInt.
  check(year && (parseInt(year[2], 10) + 1) % 100 === parseInt(year[3], 10), 'INVALID_VENTURE_REQUEST', PERIOD_WORDS);
  const first = parseInt(year![2], 10) - (year![1].toUpperCase() === 'AY' ? 1 : 0);
  const fy = `${first}-${String((first + 1) % 100).padStart(2, '0')}`;
  const ay = `${first + 1}-${String((first + 2) % 100).padStart(2, '0')}`;
  return { kind: 'year', fy, ay, from: `${first}-04-01`, to: `${first + 1}-03-31`, display: `Financial year ${fy} (assessment year ${ay})` };
}

function issuedIn(state: State, venture: VentureRecord, period: Period): InvoiceRecord[] {
  return listRecords(state, 'venture-invoice', venture.id)
    .filter(invoice => ISSUED.includes(invoice.status) && invoice.number !== null && invoice.issueDate !== null && invoice.issueDate >= period.from && invoice.issueDate <= period.to)
    .sort((a, b) => (a.issueDate as string).localeCompare(b.issueDate as string) || (a.number as string).localeCompare(b.number as string));
}

const taxableOf = (invoice: InvoiceRecord) => BigInt(invoice.subtotalMinor) - BigInt(invoice.discountMinor);

function clientNames(state: State, venture: VentureRecord): Map<string, string> {
  return new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
}

/** One issued invoice as a line: its tax on its taxable value, with the price receipt that proves both. */
function invoiceLine(invoice: InvoiceRecord, clients: Map<string, string>, taxLabel: string): TaxWorkingLine {
  const money = (minor: bigint | string) => formatMinor(String(minor), invoice.currency);
  return {
    label: `${invoice.number}, ${clients.get(invoice.clientId) ?? 'a client'}`,
    value: `${taxLabel} ${money(invoice.taxMinor)} on ${money(taxableOf(invoice))}`,
    receiptId: invoice.priceReceiptId,
  };
}

// ---------------------------------------------------------------------------
// Every other business: the plan's tax setting and the tax on each invoice
// ---------------------------------------------------------------------------

function plainWorking(state: State, venture: VentureRecord, plan: BlueprintRecord | null, period: Period): TaxWorkingView {
  const taxLabel = plan?.backOffice.taxLabel ?? venture.country.tax.label;
  const lines: TaxWorkingLine[] = [];
  if (plan) {
    const office = plan.backOffice;
    const said = office.taxRegistered.value ? `You charge ${taxLabel} at ${bpsPercent(office.taxRateBps)}%` : `You do not charge ${taxLabel}`;
    const assumed = office.taxRegistered.label === 'told-by-you' ? '' : ' (Chausar assumed this; confirm it in the business menu)';
    lines.push({ label: 'What your plan says', value: `${said}${assumed}` });
  } else {
    lines.push({ label: 'What your plan says', value: 'Your plan is not made yet.' });
  }
  const invoices = issuedIn(state, venture, period);
  const clients = clientNames(state, venture);
  for (const invoice of invoices) lines.push(invoiceLine(invoice, clients, taxLabel));
  const currencies = new Set(invoices.map(invoice => invoice.currency));
  if (invoices.length && currencies.size === 1) {
    const total = invoices.reduce((sum, invoice) => sum + BigInt(invoice.taxMinor), 0n);
    lines.push({ label: `${taxLabel} on invoices issued in ${period.display}`, value: formatMinor(String(total), invoices[0].currency) });
  } else if (!invoices.length) {
    lines.push({ label: `${taxLabel} on invoices issued in ${period.display}`, value: 'No invoices issued' });
  }
  return { period: period.display, sections: [{ id: 'tax', title: taxLabel, lines, note: BOOKS_TAX_NOTE }], needsCaConfirmation: false };
}

// ---------------------------------------------------------------------------
// The AI-native CA firm: the playbook's GST engine on the firm's own invoices
// ---------------------------------------------------------------------------

type CaEngines = {
  gst: typeof import('../playbooks/ca-firm/gst.ts');
  rates: typeof import('../playbooks/ca-firm/rates.ts');
  signoff: typeof import('../playbooks/ca-firm/signoff.ts');
  incomeTax: typeof import('../playbooks/ca-firm/income-tax.ts');
};
type Built = { lines: GstLine[]; counted: InvoiceRecord[]; left: { label: string; value: string }[] };

/** The firm's issued invoices as the engine's sale lines. An invoice the engine cannot take is left out with its reason. */
function saleLines(state: State, venture: VentureRecord, invoices: InvoiceRecord[], gstin: string): Built {
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client]));
  const built: Built = { lines: [], counted: [], left: [] };
  for (const invoice of invoices) {
    const leave = (reason: string) => built.left.push({ label: invoice.number as string, value: reason });
    if (invoice.taxTreatment === 'zero-rated-lut') { leave('Export under a Letter of Undertaking: zero-rated, for your CA to report.'); continue; }
    if (invoice.taxTreatment !== 'cgst-sgst' && invoice.taxTreatment !== 'igst') { leave('No GST was charged on this invoice.'); continue; }
    if (!invoice.sacCode) { leave('The invoice has no SAC code.'); continue; }
    const client = clients.get(invoice.clientId);
    const buyer = invoice.clientTaxId && gstinValid(invoice.clientTaxId) ? invoice.clientTaxId : null;
    const place = client?.stateCode ?? buyer?.slice(0, 2) ?? (invoice.taxTreatment === 'cgst-sgst' ? gstin.slice(0, 2) : null);
    if (!place) { leave("The client's state is not known, so the place of supply is not either."); continue; }
    const charged = { igstMinor: '0', cgstMinor: '0', sgstMinor: '0' };
    const heads = invoice.taxTreatment === 'igst' ? ['igst'] as const : ['cgst', 'sgst'] as const;
    heads.forEach((head, index) => { charged[`${head}Minor`] = invoice.taxLines[index]?.minor ?? '0'; });
    built.lines.push({
      id: invoice.id.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60), invoiceNo: invoice.number as string, date: invoice.issueDate as string,
      counterpartyGstin: buyer, placeOfSupply: place, hsnSac: invoice.sacCode, taxableMinor: String(taxableOf(invoice)), rateBps: invoice.taxRateBps, charged,
    });
    built.counted.push(invoice);
  }
  return built;
}

const figure = (receipt: CaReceipt, key: string) => receipt.figures.find(item => item.key === key)?.display ?? '';

function errorMessage(error: unknown): string {
  const value = error as { message?: unknown } | null;
  return typeof value?.message === 'string' ? value.message : 'The GST engine could not work this period.';
}

async function caWorking(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, plan: BlueprintRecord | null, period: Period): Promise<TaxWorkingView> {
  const engines: CaEngines = {
    gst: await import('../playbooks/ca-firm/gst.ts'), rates: await import('../playbooks/ca-firm/rates.ts'),
    signoff: await import('../playbooks/ca-firm/signoff.ts'), incomeTax: await import('../playbooks/ca-firm/income-tax.ts'),
  };
  const use = engines.signoff.rateUseFor(state, venture.id, 'rehearsal');
  let unconfirmed = false;
  const tableNotes: string[] = [];
  /** Marks the working unconfirmed when the table covering a date is not confirmed by the CA, and names it once. */
  const tableOn = (kind: 'gst-rates' | 'income-tax', on: IsoDate) => {
    try {
      const table = engines.rates.rateTableFor(kind, on);
      if (!engines.rates.confirmationFor(table, use.confirmations)) {
        unconfirmed = true;
        const line = `Your CA has not confirmed "${table.title}" (version ${table.version}) yet.`;
        if (!tableNotes.includes(line)) tableNotes.push(line);
      }
    } catch (error) {
      unconfirmed = true;
      tableNotes.push(errorMessage(error));
    }
  };
  const office = plan?.backOffice ?? null;
  const registered = !!office && office.taxMode === 'gst' && office.taxRegistered.value === true;
  const gstin = office?.taxId ?? '';
  const sections: TaxWorkingSection[] = [];

  const runGst = (month: string, invoices: InvoiceRecord[]): { receipt: CaReceipt | null; built: Built; failure: string | null } => {
    const built = saleLines(state, venture, invoices, gstin);
    tableOn('gst-rates', `${month}-01`);
    try {
      const receipt = engines.gst.gstWorking({ gstin, period: month, outward: built.lines, inward: [] }, use);
      for (const table of receipt.tables) if (!table.confirmed) unconfirmed = true;
      return { receipt, built, failure: null };
    } catch (error) {
      return { receipt: null, built, failure: errorMessage(error) };
    }
  };

  if (!registered) {
    const assumed = office && office.taxRegistered.label !== 'told-by-you' ? ' Chausar assumed this; confirm it in the business menu.' : '';
    sections.push({ id: 'gst', title: 'GST', lines: [], note: `${office ? 'Your plan says you do not charge GST, so there is no GST working.' : 'Your plan is not made yet.'}${assumed}` });
  } else if (!gstinValid(gstin)) {
    sections.push({ id: 'gst', title: 'GST', lines: [], note: 'Add your GSTIN to your plan to see the GST working.' });
  } else if (period.kind === 'month') {
    const invoices = issuedIn(state, venture, period);
    const { receipt, built, failure } = runGst(period.month, invoices);
    const left = [...built.left];
    if (receipt) {
      const working = receipt.working as { exceptions: { lineId: string; reason: string }[]; differences: { invoiceNo: string; head: string; chargedMinor: string; computedMinor: string }[] };
      const numbers = new Map(built.lines.map(line => [line.id, line.invoiceNo]));
      for (const item of working.exceptions) left.push({ label: numbers.get(item.lineId) ?? item.lineId, value: item.reason });
      for (const item of working.differences) {
        left.push({ label: `${item.invoiceNo}, ${item.head.toUpperCase()}`, value: `The invoice shows ${formatMinor(item.chargedMinor, 'INR')}; the working gives ${formatMinor(item.computedMinor, 'INR')}.` });
      }
      sections.push({
        id: 'gst', title: `GST for ${period.display}`,
        lines: [
          { label: 'Taxable value of sales counted', value: figure(receipt, 'outward-taxable') },
          { label: 'Output CGST', value: figure(receipt, 'output-cgst') },
          { label: 'Output SGST', value: figure(receipt, 'output-sgst') },
          { label: 'Output IGST', value: figure(receipt, 'output-igst') },
          { label: 'GST to pay in cash', value: figure(receipt, 'net-payable') },
        ],
        note: [`Worked by the GST engine from ${built.counted.length} issued ${built.counted.length === 1 ? 'invoice' : 'invoices'}, working receipt ${receipt.id}.`, NO_PURCHASES, ...tableNotes].join(' '),
      });
    } else {
      sections.push({ id: 'gst', title: `GST for ${period.display}`, lines: [], note: [failure ?? '', ...tableNotes].join(' ').trim() });
    }
    const clients = clientNames(state, venture);
    sections.push({ id: 'gst-invoices', title: 'Invoices counted', lines: built.counted.map(invoice => invoiceLine(invoice, clients, 'GST')),
      ...(built.counted.length ? {} : { note: `No invoices with GST were issued in ${period.display}.` }) });
    if (left.length) sections.push({ id: 'gst-left-out', title: 'Left out, for your CA', lines: left });
    sections.push({ id: 'tds', title: 'TDS', lines: [], note: TDS_NOTE });
  } else {
    // A year: each month's GST to pay, worked like the month, up to today.
    const today = todayLocal(deps.clock, venture.country);
    const lines: TaxWorkingLine[] = [];
    const failures: string[] = [];
    let month = period.from.slice(0, 7);
    while (month <= period.to.slice(0, 7) && `${month}-01` <= today) {
      const invoices = issuedIn(state, venture, monthPeriod(month));
      if (invoices.length) {
        const { receipt, failure } = runGst(month, invoices);
        if (receipt) lines.push({ label: monthPeriod(month).display, value: figure(receipt, 'net-payable') });
        else failures.push(`${monthPeriod(month).display}: ${failure}`);
      }
      const [y, m] = month.split('-').map(Number);
      month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    sections.push({
      id: 'gst', title: 'GST to pay in cash, month by month', lines,
      note: [lines.length ? 'Each month is worked like the monthly working.' : `No invoices with GST were issued in ${period.display}.`, NO_PURCHASES, ...failures, ...tableNotes].join(' '),
    });
  }

  if (period.kind === 'year') {
    const invoices = issuedIn(state, venture, period).filter(invoice => invoice.currency === 'INR');
    const billed = invoices.reduce((sum, invoice) => sum + taxableOf(invoice), 0n);
    const before = tableNotes.length;
    try { engines.incomeTax.incomeTaxTable(period.ay); tableOn('income-tax', period.from); } catch (error) { unconfirmed = true; tableNotes.push(errorMessage(error)); }
    sections.push({
      id: 'income-tax', title: `Income tax for ${period.display}`,
      lines: [{ label: 'Billed in the year, without tax', value: formatMinor(String(billed), 'INR') }],
      note: ['The computation needs your whole income for the year, your regime and your deductions, which Chausar does not hold. The income tax return offer works it from Form 16, AIS and 26AS, and your CA signs it off.',
        ...tableNotes.slice(before)].join(' '),
    });
  }
  return { period: period.display, sections, needsCaConfirmation: unconfirmed };
}

/** venture.tax.working { period? } (read): the tax working for a month (default this month) or a financial year. */
export async function taxWorking(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TaxWorkingView> {
  const body = exactPayload(payload ?? {}, ['period']);
  const { state, venture } = readVenture(deps, ctx);
  const period = parsePeriod(body.period, todayLocal(deps.clock, venture.country));
  const plan = latestBlueprint(listRecords(state, 'venture-blueprint', venture.id));
  if (pickPlaybook(venture.idea)?.id === CA_FIRM_ID && venture.country.code === 'IN') return caWorking(deps, ctx, state, venture, plan, period);
  return plainWorking(state, venture, plan, period);
}
