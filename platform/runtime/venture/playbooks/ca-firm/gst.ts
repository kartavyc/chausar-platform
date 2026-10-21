// AI-native CA firm: the GST working for one GSTIN and one month, in BigInt paise. From invoice lines with HSN or SAC
// and the place of supply it works out output tax by rate and by head (IGST between states, CGST and SGST within
// one), the GSTR-1 sections (B2B, B2CL, B2CS) and the HSN summary, input credit with the GSTR-2B match, the order
// credit is used in, and the cash to pay. Every line it cannot count is listed with its reason; tax an invoice
// charged that differs from the computed tax is listed too. These are working papers: the CA or the client files.
//
// Idea taken, code written here: akaunting/akaunting (BUSL-1.1, ideas only), which stores the rate charged on each
// line rather than a pointer to today's rate. The rate on each line here is checked against the table for its date.
import { gstinValid } from '../../../memory.ts';
import { INDIA_STATES } from '../../contracts.ts';
import { bpsText, divRound, invalid, isoDate, longDate, minBig, notModelled, paise, sumBig, type IsoDate } from './money.ts';
import { rateTableFor, sectionOf, useRateTable, REHEARSAL, type GstRatesPayload, type RateTable, type RateUse, type TableStamp } from './rates.ts';
import { ReceiptBuilder, type CaReceipt } from './receipt.ts';

export type GstLine = {
  id: string;
  invoiceNo: string;
  date: IsoDate;
  /** The buyer's GSTIN on a sale, the supplier's on a purchase; null when unregistered. */
  counterpartyGstin: string | null;
  /** Two-digit state code of the place of supply. */
  placeOfSupply: string;
  hsnSac: string;
  taxableMinor: string;
  rateBps: string;
  /** The tax the invoice itself shows, when known. */
  charged?: { igstMinor: string; cgstMinor: string; sgstMinor: string };
  /** Purchases only: whether the credit is allowed (blocked credit is not), and whether the line is in GSTR-2B. */
  itcEligible?: boolean;
  in2B?: boolean;
  /** Not modelled here: compensation cess and reverse charge go to the CA. */
  cessMinor?: string;
  reverseCharge?: boolean;
};
export type GstWorkingInput = { gstin: string; period: string; outward: GstLine[]; inward: GstLine[] };
export type Heads = { igst: bigint; cgst: bigint; sgst: bigint };
export type Head = keyof Heads;
type Text<T> = { [K in keyof T]: string };
export type UtilisationStep = { from: Head; to: Head; amount: bigint };

type Counted = { line: GstLine; side: 'outward' | 'inward'; taxable: bigint; rate: bigint; tax: Heads; inter: boolean; table: RateTable<GstRatesPayload> };
export type GstWorking = {
  outputByRate: { rateBps: string; taxableMinor: string; igstMinor: string; cgstMinor: string; sgstMinor: string }[];
  gstr1: {
    b2b: { invoiceNo: string; gstin: string; placeOfSupply: string; taxableMinor: string; igstMinor: string; cgstMinor: string; sgstMinor: string; valueMinor: string }[];
    b2cl: { invoiceNo: string; placeOfSupply: string; taxableMinor: string; igstMinor: string; valueMinor: string }[];
    b2cs: { placeOfSupply: string; rateBps: string; taxableMinor: string; igstMinor: string; cgstMinor: string; sgstMinor: string }[];
  };
  hsnSummary: { hsnSac: string; rateBps: string; taxableMinor: string; igstMinor: string; cgstMinor: string; sgstMinor: string }[];
  gstr3b: { outwardTaxableMinor: string; output: Text<Heads>; itcAvailable: Text<Heads>; itcHeld: Text<Heads>; cash: Text<Heads>; carried: Text<Heads> };
  held: { lineId: string; reason: string; taxMinor: string }[];
  exceptions: { lineId: string; side: 'outward' | 'inward'; reason: string }[];
  differences: { lineId: string; invoiceNo: string; head: Head; chargedMinor: string; computedMinor: string; deltaMinor: string }[];
  utilisation: { from: Head; to: Head; amountMinor: string }[];
};

const HEADS: readonly Head[] = ['igst', 'cgst', 'sgst'];
const zero = (): Heads => ({ igst: 0n, cgst: 0n, sgst: 0n });
const text = (heads: Heads): Text<Heads> => ({ igst: String(heads.igst), cgst: String(heads.cgst), sgst: String(heads.sgst) });
const add = (into: Heads, more: Heads) => { into.igst += more.igst; into.cgst += more.cgst; into.sgst += more.sgst; };
const HSN = /^(?:\d{4}|\d{6}|\d{8})$/;

/**
 * Credit against liability, in the order the CGST Act sets: IGST credit first, against IGST, then CGST, then SGST;
 * then CGST credit against CGST, then IGST; then SGST credit against SGST, then IGST. CGST credit never pays SGST,
 * nor SGST credit CGST. Whatever liability is left is paid in cash; whatever credit is left carries forward.
 */
export function utiliseCredit(liability: Heads, credit: Heads): { cash: Heads; carried: Heads; steps: UtilisationStep[] } {
  const owed = { ...liability };
  const left = { ...credit };
  const steps: UtilisationStep[] = [];
  const use = (from: Head, to: Head) => {
    const amount = minBig(left[from], owed[to]);
    if (amount <= 0n) return;
    left[from] -= amount;
    owed[to] -= amount;
    steps.push({ from, to, amount });
  };
  use('igst', 'igst'); use('igst', 'cgst'); use('igst', 'sgst');
  use('cgst', 'cgst'); use('cgst', 'igst');
  use('sgst', 'sgst'); use('sgst', 'igst');
  return { cash: owed, carried: left, steps };
}

function lineTax(taxable: bigint, rate: bigint, inter: boolean): Heads {
  if (inter) return { igst: divRound(taxable * rate, 10000n, 'half-up'), cgst: 0n, sgst: 0n };
  const half = divRound(taxable * rate, 20000n, 'half-up');
  return { igst: 0n, cgst: half, sgst: half };
}

function checkLine(line: GstLine, index: number, side: 'outward' | 'inward', ids: Set<string>): void {
  const where = `${side === 'outward' ? 'Sale' : 'Purchase'} line ${index + 1}`;
  if (!line || typeof line !== 'object') invalid(`${where} is not a line.`);
  if (typeof line.id !== 'string' || !/^[A-Za-z0-9_.-]{1,60}$/.test(line.id)) invalid(`${where} needs a short id.`);
  if (ids.has(line.id)) invalid(`Two lines share the id ${line.id}.`);
  ids.add(line.id);
  if (typeof line.invoiceNo !== 'string' || !line.invoiceNo.trim() || line.invoiceNo.length > 40) invalid(`${where} needs its invoice number.`);
  isoDate(line.date, `${where}'s date`);
  paise(line.taxableMinor, `${where}'s taxable value`);
  if (typeof line.rateBps !== 'string' || !/^\d{1,5}$/.test(line.rateBps)) invalid(`${where}'s rate must be whole basis points.`);
  if (line.cessMinor !== undefined && line.cessMinor !== '0') notModelled(`${where} carries compensation cess, which this working does not compute. Your CA works it.`);
  if (line.reverseCharge) notModelled(`${where} is under reverse charge, which this working does not compute. Your CA works it.`);
  if (line.charged !== undefined) for (const head of HEADS) paise(line.charged[`${head}Minor` as const], `${where}'s charged ${head.toUpperCase()}`);
}

export function gstWorking(input: GstWorkingInput, use: RateUse = REHEARSAL): CaReceipt<GstWorking> {
  if (!input || typeof input !== 'object') invalid('Send the GST working inputs.');
  if (!gstinValid(input.gstin)) invalid('Check the GSTIN of the business.');
  if (typeof input.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) invalid('The period is a month written like 2025-10.');
  if (!Array.isArray(input.outward) || !Array.isArray(input.inward)) invalid('Send the sale lines and the purchase lines as lists.');
  const ids = new Set<string>();
  input.outward.forEach((line, index) => checkLine(line, index, 'outward', ids));
  input.inward.forEach((line, index) => checkLine(line, index, 'inward', ids));

  const ourState = input.gstin.slice(0, 2);
  const builder = new ReceiptBuilder('gst-working');
  const stamps = new Map<string, TableStamp>();
  const exceptions: GstWorking['exceptions'] = [];
  const counted: Counted[] = [];

  const classify = (line: GstLine, side: 'outward' | 'inward') => {
    const fail = (reason: string) => { exceptions.push({ lineId: line.id, side, reason }); };
    let table: RateTable<GstRatesPayload>;
    try { table = rateTableFor<GstRatesPayload>('gst-rates', line.date); } catch { return fail(`No GST rate table covers ${longDate(line.date)}.`); }
    const stamp = useRateTable(table, use);
    stamps.set(`${stamp.version}`, stamp);
    builder.useTable(table, stamp);
    if (line.date.slice(0, 7) !== input.period) return fail(`Dated ${longDate(line.date)}, outside the period ${input.period}.`);
    if (!HSN.test(line.hsnSac) || (line.hsnSac.startsWith('99') && line.hsnSac.length !== 6)) return fail(`The HSN or SAC code ${JSON.stringify(line.hsnSac)} is not four, six or eight digits.`);
    if (!Object.hasOwn(INDIA_STATES, line.placeOfSupply)) return fail(`The place of supply ${JSON.stringify(line.placeOfSupply)} is not an Indian state code this working knows. Exports and SEZ supplies go to the CA.`);
    if (line.counterpartyGstin !== null && !gstinValid(line.counterpartyGstin)) return fail(`The GSTIN ${line.counterpartyGstin} does not pass its check.`);
    if (!table.payload.ratesBps.includes(line.rateBps)) return fail(`${bpsText(line.rateBps)} is not a GST rate on ${longDate(line.date)} in the rate table (version ${table.version}).`);
    const supplier = side === 'outward' ? ourState : line.counterpartyGstin?.slice(0, 2) ?? line.placeOfSupply;
    const inter = supplier !== line.placeOfSupply;
    const taxable = BigInt(line.taxableMinor), rate = BigInt(line.rateBps);
    counted.push({ line, side, taxable, rate, tax: lineTax(taxable, rate, inter), inter, table });
  };
  for (const line of input.outward) classify(line, 'outward');
  for (const line of input.inward) classify(line, 'inward');

  const outward = counted.filter(item => item.side === 'outward');
  const inward = counted.filter(item => item.side === 'inward');

  // Tax an invoice charged that differs from the computed tax.
  const differences: GstWorking['differences'] = [];
  for (const item of counted) {
    if (!item.line.charged) continue;
    for (const head of HEADS) {
      const charged = BigInt(item.line.charged[`${head}Minor` as const]);
      if (charged !== item.tax[head]) differences.push({ lineId: item.line.id, invoiceNo: item.line.invoiceNo, head, chargedMinor: String(charged), computedMinor: String(item.tax[head]), deltaMinor: String(charged - item.tax[head]) });
    }
  }

  // Output tax by rate.
  const byRate = new Map<string, { taxable: bigint; tax: Heads }>();
  for (const item of outward) {
    const row = byRate.get(item.line.rateBps) ?? { taxable: 0n, tax: zero() };
    row.taxable += item.taxable; add(row.tax, item.tax);
    byRate.set(item.line.rateBps, row);
  }
  const outputByRate = [...byRate.entries()].sort((a, b) => Number(BigInt(a[0]) - BigInt(b[0])))
    .map(([rateBps, row]) => ({ rateBps, taxableMinor: String(row.taxable), igstMinor: String(row.tax.igst), cgstMinor: String(row.tax.cgst), sgstMinor: String(row.tax.sgst) }));

  // GSTR-1 sections, by invoice.
  const invoices = new Map<string, { items: Counted[]; taxable: bigint; tax: Heads }>();
  for (const item of outward) {
    const entry = invoices.get(item.line.invoiceNo) ?? { items: [], taxable: 0n, tax: zero() };
    entry.items.push(item); entry.taxable += item.taxable; add(entry.tax, item.tax);
    invoices.set(item.line.invoiceNo, entry);
  }
  const gstr1: GstWorking['gstr1'] = { b2b: [], b2cl: [], b2cs: [] };
  const b2cs = new Map<string, { placeOfSupply: string; rateBps: string; taxable: bigint; tax: Heads }>();
  for (const [invoiceNo, entry] of invoices) {
    const first = entry.items[0];
    const value = entry.taxable + entry.tax.igst + entry.tax.cgst + entry.tax.sgst;
    if (first.line.counterpartyGstin) {
      gstr1.b2b.push({ invoiceNo, gstin: first.line.counterpartyGstin, placeOfSupply: first.line.placeOfSupply, taxableMinor: String(entry.taxable), igstMinor: String(entry.tax.igst), cgstMinor: String(entry.tax.cgst), sgstMinor: String(entry.tax.sgst), valueMinor: String(value) });
    } else if (first.inter && value > BigInt(first.table.payload.b2clThresholdMinor)) {
      gstr1.b2cl.push({ invoiceNo, placeOfSupply: first.line.placeOfSupply, taxableMinor: String(entry.taxable), igstMinor: String(entry.tax.igst), valueMinor: String(value) });
    } else {
      for (const item of entry.items) {
        const key = `${item.line.placeOfSupply}|${item.line.rateBps.padStart(5, '0')}`;
        const row = b2cs.get(key) ?? { placeOfSupply: item.line.placeOfSupply, rateBps: item.line.rateBps, taxable: 0n, tax: zero() };
        row.taxable += item.taxable; add(row.tax, item.tax);
        b2cs.set(key, row);
      }
    }
  }
  gstr1.b2cs = [...b2cs.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, row]) => ({
    placeOfSupply: row.placeOfSupply, rateBps: row.rateBps, taxableMinor: String(row.taxable), igstMinor: String(row.tax.igst), cgstMinor: String(row.tax.cgst), sgstMinor: String(row.tax.sgst),
  }));

  // HSN summary.
  const hsn = new Map<string, { hsnSac: string; rateBps: string; taxable: bigint; tax: Heads }>();
  for (const item of outward) {
    const key = `${item.line.hsnSac}|${item.line.rateBps.padStart(5, '0')}`;
    const row = hsn.get(key) ?? { hsnSac: item.line.hsnSac, rateBps: item.line.rateBps, taxable: 0n, tax: zero() };
    row.taxable += item.taxable; add(row.tax, item.tax);
    hsn.set(key, row);
  }
  const hsnSummary = [...hsn.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, row]) => ({
    hsnSac: row.hsnSac, rateBps: row.rateBps, taxableMinor: String(row.taxable), igstMinor: String(row.tax.igst), cgstMinor: String(row.tax.cgst), sgstMinor: String(row.tax.sgst),
  }));

  // Input credit: eligible, and found in GSTR-2B.
  const available = zero(), heldTax = zero();
  const held: GstWorking['held'] = [];
  for (const item of inward) {
    const reason = item.line.itcEligible === false ? 'not eligible for credit' : item.line.in2B !== true ? 'not in GSTR-2B' : !item.line.counterpartyGstin ? 'supplier not registered' : null;
    if (reason) { held.push({ lineId: item.line.id, reason, taxMinor: String(sumBig(HEADS.map(head => item.tax[head]))) }); add(heldTax, item.tax); }
    else add(available, item.tax);
  }

  const output = zero();
  for (const item of outward) add(output, item.tax);
  const { cash, carried, steps } = utiliseCredit(output, available);
  const tables = [...stamps.values()];

  const outwardTaxable = builder.step('outward-taxable', 'Taxable value of sales counted', sumBig(outward.map(item => item.taxable)));
  const anyTable = counted[0]?.table ?? null;
  const sectionFrom = (key: string) => (anyTable ? sectionOf(anyTable, key) : null);
  builder.step('output-igst', 'Output IGST', output.igst, sectionFrom('levy-inter'));
  builder.step('output-cgst', 'Output CGST', output.cgst, sectionFrom('levy-intra'));
  builder.step('output-sgst', 'Output SGST', output.sgst);
  builder.step('itc-igst', 'IGST credit available', available.igst, sectionFrom('credit'));
  builder.step('itc-cgst', 'CGST credit available', available.cgst);
  builder.step('itc-sgst', 'SGST credit available', available.sgst);
  builder.step('itc-held', 'Credit held back', heldTax.igst + heldTax.cgst + heldTax.sgst, held.some(item => item.reason === 'not eligible for credit') ? sectionFrom('blocked-credit') : null);
  builder.cite(sectionFrom('utilisation'));
  builder.cite(sectionFrom('utilisation-order'));
  builder.cite(sectionFrom('utilisation-rule'));
  builder.step('cash-igst', 'IGST to pay in cash', cash.igst);
  builder.step('cash-cgst', 'CGST to pay in cash', cash.cgst);
  builder.step('cash-sgst', 'SGST to pay in cash', cash.sgst);
  builder.step('carried-igst', 'IGST credit carried forward', carried.igst);
  builder.step('carried-cgst', 'CGST credit carried forward', carried.cgst);
  builder.step('carried-sgst', 'SGST credit carried forward', carried.sgst);
  builder.step('net-payable', 'GST to pay in cash', cash.igst + cash.cgst + cash.sgst);
  builder.assume('IGST credit left after IGST is used against CGST before SGST; rule 88A lets the CA choose another split.');
  builder.assume('Credit counts only for purchase lines marked as found in GSTR-2B.');

  const working: GstWorking = {
    outputByRate, gstr1, hsnSummary,
    gstr3b: { outwardTaxableMinor: String(outwardTaxable), output: text(output), itcAvailable: text(available), itcHeld: text(heldTax), cash: text(cash), carried: text(carried) },
    held, exceptions, differences,
    utilisation: steps.map(step => ({ from: step.from, to: step.to, amountMinor: String(step.amount) })),
  };
  const latest = tables.sort((a, b) => b.version - a.version)[0] ?? null;
  return builder.build(input, working, `GST working for ${input.gstin} for ${input.period}: ${counted.length} lines counted, ${exceptions.length} listed as exceptions.`, latest);
}
