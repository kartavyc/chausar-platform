import { check, ChausarError } from '../../contracts.ts';
import { decimalMinor } from '../../currency.ts';
import { parseJson } from '../decoders.ts';
import type { Decoder, DecoderInput, FieldSpec, SourceRecipe } from '../recipe.ts';
import type { DecodedTable, DeclaredTotals, RawRow, Refusal } from '../types.ts';

/**
 * GST portal downloads (GSTR-1, GSTR-2B, GSTR-3B) and GST provider documents (e-invoice, e-way bill).
 *
 * Every decoder converts amounts to exact whole paise (minor units) once, so recipes read `unit: 'minor'`.
 * Per-document self-checks (line items against the document's own value fields) are decoder refusals.
 * For JSON sources the refusal line is the 1-based record number in decoding order, the same number
 * a record later carries as `sourceRow`. The recipe interpreter does not forward decoder lines, so
 * `decoderRefusal` re-runs a decoder to name the line for the person.
 */

/** A decoder refusal that names the record or file line it stopped at. Messages stay fixed sentences. */
export class SourceLineError extends ChausarError {
  line: number;
  constructor(code: string, message: string, line: number) { super(code, message); this.line = line; }
}
export const stopAt = (code: string, message: string, line: number): never => { throw new SourceLineError(code, message, line); };

/** Run a decoder alone and return its refusal (with the line when it named one), or null if it decoded. */
export function decoderRefusal(decoder: Decoder, input: DecoderInput, recipe: SourceRecipe): Refusal | null {
  try { decoder.decode(input, recipe); return null; }
  catch (error) {
    if (error instanceof SourceLineError) return { code: error.code, reason: error.message, line: error.line };
    if (error instanceof ChausarError) return { code: error.code, reason: error.message };
    throw error;
  }
}

// ---- shared helpers -------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
export const obj = (value: unknown): Json | null => isObject(value) ? value : null;
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Exact source money (decimal text or a JSON number kept in source spelling) to paise. Missing stays null. */
export function paise(value: unknown, line: number): bigint | null {
  if (value === undefined || value === null) return null;
  check(typeof value === 'string', 'INVALID_MONEY', 'An amount is not exact decimal money.');
  const raw = (value as string).trim().replaceAll(',', '');
  if (raw === '') return null;
  try { return BigInt(decimalMinor(raw, 'INR')); }
  catch { return stopAt('INVALID_MONEY', 'An amount is not exact decimal money.', line); }
}
/** Sum of the heads present. Null when none of them is present: missing tax is unknown, never zero. */
export function sumPresent(values: readonly (bigint | null)[]): bigint | null {
  const present = values.filter((value): value is bigint => value !== null);
  return present.length ? present.reduce((a, b) => a + b, 0n) : null;
}
const cell = (value: bigint | null): string => value === null ? '' : String(value);
const abs = (value: bigint) => value < 0n ? -value : value;
export function table(headers: readonly string[], rows: RawRow[], declared: DeclaredTotals | null, meta: Record<string, string>): DecodedTable {
  return { headers: [...headers], rows, footers: [], declared, meta };
}
function root(input: DecoderInput, what: string): unknown {
  check(typeof input.text === 'string' && input.text.length <= 20 * 1024 * 1024, 'TEXT_REQUIRED', what);
  return parseJson(input.text!);
}
/** Round-off on an invoice may move its value by up to one rupee; more than that is a broken document. */
export const ROUND_OFF_PAISE = 100n;

// ---- GSTR-1 ---------------------------------------------------------------------------------------

const GSTR1_HEADERS = ['section', 'ctin', 'pos', 'number', 'date', 'value', 'taxable', 'tax', 'noteType', 'reverseCharge', 'invoiceType'];
const TAX_HEADS_1 = ['iamt', 'camt', 'samt', 'csamt'];

function gstr1Items(document: Json, line: number): { taxable: bigint; tax: bigint | null } {
  const items = list(document.itms);
  if (!items.length) stopAt('GST_ITEMS_MISSING', 'A GST document has no item lines.', line);
  let taxable = 0n; const heads: (bigint | null)[] = [];
  for (const item of items) {
    const detail = obj(obj(item)?.itm_det) ?? obj(item);
    const value = paise(detail?.txval, line);
    if (value === null) stopAt('GST_TAXABLE_MISSING', 'A GST item line has no taxable value.', line);
    taxable += value!;
    for (const head of TAX_HEADS_1) heads.push(paise(detail?.[head], line));
  }
  return { taxable, tax: sumPresent(heads) };
}
function checkDocumentValue(value: bigint | null, taxable: bigint, tax: bigint | null, line: number) {
  if (value === null || tax === null) return;
  if (abs(value - (taxable + tax)) > ROUND_OFF_PAISE) stopAt('GST_DOCUMENT_VALUE_MISMATCH', 'A GST document\'s taxable value plus tax does not agree with its own document value.', line);
}
/** GSTR-1 portal summary (sec_sum): the source's own count and taxable value per section. */
function gstr1Summary(data: Json, sections: readonly string[]): DeclaredTotals | null {
  const summary = list(data.sec_sum).map(obj).filter((item): item is Json => !!item);
  if (!summary.length) return null;
  let rows = 0, amount = 0n;
  for (const section of sections) {
    const entry = summary.find(item => text(item.sec_nm).toLowerCase() === section);
    check(entry, 'GSTR1_SUMMARY_SECTION_MISSING', 'The GSTR-1 summary does not list a section this recipe reads.');
    const count = text(entry!.ttl_rec);
    check(/^\d{1,9}$/.test(count), 'GSTR1_SUMMARY_INVALID', 'The GSTR-1 summary holds a record count that is not a whole number.');
    const taxable = paise(entry!.ttl_tax, 0);
    check(taxable !== null, 'GSTR1_SUMMARY_INVALID', 'The GSTR-1 summary has no taxable value for a section this recipe reads.');
    rows += Number(count); amount += taxable!;
  }
  return { rowCount: rows, amount: String(amount), amountUnit: 'minor', reference: 'gstr1-sec-sum' };
}
export const gstr1Decoder: Decoder = {
  id: 'gstr1-json', version: '1', accepts: 'text',
  decode(input, recipe) {
    const data = obj(root(input, 'This recipe reads a GSTR-1 JSON download.'));
    check(data && typeof data.gstin === 'string' && typeof data.fp === 'string', 'INVALID_GST_EXPORT', 'This is not a GSTR-1 download: it has no GSTIN and return period.');
    const sections = (recipe.records ?? []).map(step => step.toLowerCase());
    check(sections.length > 0 && sections.every(s => ['b2b', 'b2cl', 'cdnr'].includes(s)), 'RECIPE_INVALID', 'A GSTR-1 recipe names the sections it reads.');
    const rows: RawRow[] = [];
    const add = (cells: Record<string, string>) => rows.push({ line: rows.length + 1, cells: Object.fromEntries(GSTR1_HEADERS.map(h => [h, cells[h] ?? ''])) });
    for (const section of sections) {
      for (const party of list(data![section])) {
        const p = obj(party); check(p, 'INVALID_GST_EXPORT', 'A GSTR-1 section entry is not an object.');
        if (section === 'cdnr') {
          for (const note of list(p!.nt)) {
            const n = obj(note); const line = rows.length + 1; check(n, 'INVALID_GST_EXPORT', 'A GSTR-1 note is not an object.');
            const { taxable, tax } = gstr1Items(n!, line); const value = paise(n!.val, line);
            checkDocumentValue(value, taxable, tax, line);
            add({ section, ctin: text(p!.ctin).toUpperCase(), number: text(n!.nt_num), date: text(n!.nt_dt), value: cell(value), taxable: String(taxable), tax: cell(tax), noteType: text(n!.ntty).toUpperCase(), reverseCharge: text(n!.rchrg), invoiceType: text(n!.inv_typ) });
          }
        } else {
          for (const invoice of list(p!.inv)) {
            const v = obj(invoice); const line = rows.length + 1; check(v, 'INVALID_GST_EXPORT', 'A GSTR-1 invoice is not an object.');
            const { taxable, tax } = gstr1Items(v!, line); const value = paise(v!.val, line);
            checkDocumentValue(value, taxable, tax, line);
            add({ section, ctin: text(p!.ctin).toUpperCase(), pos: text(p!.pos ?? v!.pos), number: text(v!.inum), date: text(v!.idt), value: cell(value), taxable: String(taxable), tax: cell(tax), reverseCharge: text(v!.rchrg), invoiceType: text(v!.inv_typ) });
          }
        }
      }
    }
    const declared = recipe.totals.kind === 'declared' ? gstr1Summary(data!, sections) : null;
    if (recipe.totals.kind === 'declared') check(declared, 'GSTR1_SUMMARY_MISSING', 'This download has no GSTR-1 summary section. Use the GSTR-1 recipe that checks against the portal summary total you enter.');
    return table(GSTR1_HEADERS, rows, declared, { ...(input.meta ?? {}), gstin: text(data!.gstin), period: text(data!.fp) });
  },
};

// ---- GSTR-2B --------------------------------------------------------------------------------------

const GSTR2B_HEADERS = ['ctin', 'tradeName', 'number', 'date', 'value', 'taxable', 'tax', 'noteType', 'itcAvailable', 'reverseCharge', 'invoiceType', 'reason'];
const TAX_HEADS_2B = ['igst', 'cgst', 'sgst', 'cess'];
/** GSTR-2B ITC summary: every slot that carries B2B invoices (available/unavailable, forward/reverse charge). */
const B2B_SUMMARY_SLOTS = [['itcavl', 'nonrevsup'], ['itcavl', 'revsup'], ['itcunavl', 'nonrevsup'], ['itcunavl', 'revsup']] as const;
function gstr2bSummary(data: Json): DeclaredTotals | null {
  const summary = obj(data.itcsumm); if (!summary) return null;
  const parts: (bigint | null)[] = [];
  for (const [availability, supply] of B2B_SUMMARY_SLOTS) {
    const slot = obj(obj(obj(summary[availability])?.[supply])?.b2b);
    if (slot) parts.push(paise(slot.txval, 0));
  }
  const amount = sumPresent(parts);
  return amount === null ? null : { rowCount: null, amount: String(amount), amountUnit: 'minor', reference: 'gstr2b-itcsumm-b2b-txval' };
}
export const gstr2bDecoder: Decoder = {
  id: 'gstr2b-json', version: '1', accepts: 'text',
  decode(input, recipe) {
    const top = obj(root(input, 'This recipe reads a GSTR-2B JSON download.'));
    const data = obj(top?.data) ?? top;
    const docdata = obj(data?.docdata);
    check(data && docdata, 'INVALID_GST_EXPORT', 'This is not a GSTR-2B download: it has no document data.');
    const section = (recipe.records ?? [])[0];
    check(section === 'b2b' || section === 'cdnr', 'RECIPE_INVALID', 'A GSTR-2B recipe names the section it reads.');
    const rows: RawRow[] = [];
    for (const party of list(docdata![section])) {
      const p = obj(party); check(p, 'INVALID_GST_EXPORT', 'A GSTR-2B supplier entry is not an object.');
      for (const document of list(section === 'b2b' ? p!.inv : p!.nt)) {
        const d = obj(document); const line = rows.length + 1; check(d, 'INVALID_GST_EXPORT', 'A GSTR-2B document is not an object.');
        const taxable = paise(d!.txval, line);
        if (taxable === null) stopAt('GST_TAXABLE_MISSING', 'A GSTR-2B document has no taxable value.', line);
        const tax = sumPresent(TAX_HEADS_2B.map(head => paise(d![head], line)));
        const value = paise(d!.val, line);
        checkDocumentValue(value, taxable!, tax, line);
        const cells: Record<string, string> = { ctin: text(p!.ctin).toUpperCase(), tradeName: text(p!.trdnm), number: text(section === 'b2b' ? d!.inum : d!.ntnum), date: text(d!.dt),
          value: cell(value), taxable: String(taxable), tax: cell(tax), noteType: section === 'cdnr' ? text(d!.typ).toUpperCase() : '', itcAvailable: text(d!.itcavl).toUpperCase(),
          reverseCharge: text(d!.rev).toUpperCase(), invoiceType: section === 'b2b' ? text(d!.typ) : text(d!.suptyp), reason: text(d!.rsn) };
        rows.push({ line, cells: Object.fromEntries(GSTR2B_HEADERS.map(h => [h, cells[h] ?? ''])) });
      }
    }
    const declared = section === 'b2b' ? gstr2bSummary(data!) : null;
    return table(GSTR2B_HEADERS, rows, declared, { ...(input.meta ?? {}), gstin: text(data!.gstin), period: text(data!.rtnprd) });
  },
};

// ---- GSTR-3B --------------------------------------------------------------------------------------

const GSTR3B_HEADERS = ['table', 'label', 'period', 'direction', 'taxable', 'tax'];
const SUPPLY_ROWS: readonly (readonly [string, string, string])[] = [
  ['osup_det', '3.1(a)', 'Outward taxable supplies other than zero rated, nil rated and exempted'],
  ['osup_zero', '3.1(b)', 'Outward taxable supplies, zero rated'],
  ['osup_nil_exmp', '3.1(c)', 'Other outward supplies, nil rated and exempted'],
  ['isup_rev', '3.1(d)', 'Inward supplies liable to reverse charge'],
  ['osup_nongst', '3.1(e)', 'Non-GST outward supplies'],
];
const ITC_TYPES: Record<string, string> = { IMPG: 'Import of goods', IMPS: 'Import of services', ISRC: 'Inward supplies liable to reverse charge', ISD: 'Inward supplies from input service distributor', OTH: 'All other ITC', RUL: 'Reversed as per rules 42 and 43', };
const TAX_HEADS_3B = ['iamt', 'camt', 'samt', 'csamt'];
function returnPeriod(value: string): string {
  const m = /^(\d{2})(\d{4})$/.exec(value);
  check(m && Number(m[1]) >= 1 && Number(m[1]) <= 12, 'INVALID_GST_EXPORT', 'The GSTR-3B return period is not a month and year.');
  return `${m![2]}-${m![1]}-01`;
}
export const gstr3bDecoder: Decoder = {
  id: 'gstr3b-json', version: '1', accepts: 'text',
  decode(input, recipe) {
    const data = obj(root(input, 'This recipe reads a GSTR-3B JSON download.'));
    check(data && typeof data.gstin === 'string' && typeof data.ret_period === 'string', 'INVALID_GST_EXPORT', 'This is not a GSTR-3B download: it has no GSTIN and return period.');
    const period = returnPeriod(text(data!.ret_period));
    const part = (recipe.records ?? [])[0];
    check(part === 'sup_details' || part === 'itc_elg', 'RECIPE_INVALID', 'A GSTR-3B recipe names the table it reads.');
    const rows: RawRow[] = [];
    const add = (cells: Record<string, string>) => rows.push({ line: rows.length + 1, cells: Object.fromEntries(GSTR3B_HEADERS.map(h => [h, cells[h] ?? ''])) });
    let declared: DeclaredTotals | null = null;
    if (part === 'sup_details') {
      const supplies = obj(data!.sup_details); check(supplies, 'SOURCE_CUT_SHORT', 'The GSTR-3B supplies table is missing. The file looks cut short.');
      for (const [key, table31, label] of SUPPLY_ROWS) {
        const row = obj(supplies![key]); if (!row) continue;
        const line = rows.length + 1, taxable = paise(row.txval, line);
        if (taxable === null) stopAt('GST_TAXABLE_MISSING', 'A GSTR-3B supplies row has no taxable value.', line);
        add({ table: table31, label, period, direction: 'supplied', taxable: String(taxable), tax: cell(sumPresent(TAX_HEADS_3B.map(h => paise(row[h], line)))) });
      }
    } else {
      const itc = obj(data!.itc_elg); check(itc, 'SOURCE_CUT_SHORT', 'The GSTR-3B input tax credit table is missing. The file looks cut short.');
      for (const [key, prefix, direction] of [['itc_avl', '4A', 'available'], ['itc_rev', '4B', 'reversed']] as const) {
        for (const entry of list(itc![key])) {
          const e = obj(entry); const line = rows.length + 1; check(e, 'INVALID_GST_EXPORT', 'A GSTR-3B credit row is not an object.');
          const type = text(e!.ty).toUpperCase();
          if (!Object.hasOwn(ITC_TYPES, type)) stopAt('GSTR3B_ITC_TYPE_UNKNOWN', 'A GSTR-3B credit row has a type this recipe does not know.', line);
          add({ table: `${prefix}-${type}`, label: ITC_TYPES[type], period, direction, tax: cell(sumPresent(TAX_HEADS_3B.map(h => paise(e![h], line)))) });
        }
      }
      // Table 4(C) net ITC is the return's own total: 4(A) available minus 4(B) reversed.
      const net = obj(itc!.itc_net);
      const amount = net ? sumPresent(TAX_HEADS_3B.map(h => paise(net[h], 0))) : null;
      declared = amount === null ? null : { rowCount: null, amount: String(amount), amountUnit: 'minor', reference: 'gstr3b-itc-net-4c' };
    }
    return table(GSTR3B_HEADERS, rows, declared, { ...(input.meta ?? {}), gstin: text(data!.gstin), period: text(data!.ret_period) });
  },
};

// ---- e-invoice (IRN schema 1.1) -------------------------------------------------------------------

const EINVOICE_HEADERS = ['sellerGstin', 'buyerGstin', 'buyerName', 'docType', 'number', 'date', 'taxable', 'tax', 'invoiceValue', 'supplyType'];
const EINVOICE_HEADS: readonly (readonly [string, readonly string[]])[] = [['IgstVal', ['IgstAmt']], ['CgstVal', ['CgstAmt']], ['SgstVal', ['SgstAmt']], ['CesVal', ['CesAmt', 'CesNonAdvlAmt']]];
export const einvoiceDecoder: Decoder = {
  id: 'einvoice-json', version: '1', accepts: 'text',
  decode(input, recipe) {
    const parsed = root(input, 'This recipe reads e-invoice JSON.');
    const documents = Array.isArray(parsed) ? parsed : [parsed];
    check(documents.length > 0, 'EMPTY_SOURCE', 'The file has no e-invoices.');
    const single = recipe.totals.kind === 'declared';
    check(!single || documents.length === 1, 'EINVOICE_ONE_DOCUMENT', 'This recipe reads one e-invoice. Use the e-invoice batch recipe for a file of several.');
    const rows: RawRow[] = []; let declared: DeclaredTotals | null = null;
    documents.forEach((document, index) => {
      const line = index + 1, d = obj(document);
      check(d && obj(d.DocDtls) && obj(d.ValDtls) && obj(d.SellerDtls), 'INVALID_EINVOICE', 'This is not an e-invoice: document, seller or value details are missing.');
      const doc = obj(d!.DocDtls)!, values = obj(d!.ValDtls)!, buyer = obj(d!.BuyerDtls) ?? {};
      const type = text(doc.Typ).toUpperCase();
      if (!['INV', 'CRN', 'DBN'].includes(type)) stopAt('EINVOICE_TYPE_UNKNOWN', 'An e-invoice has a document type this recipe does not know.', line);
      const items = list(d!.ItemList).map(obj);
      if (!items.length || items.some(item => !item)) stopAt('GST_ITEMS_MISSING', 'An e-invoice has no item lines.', line);
      let itemTaxable = 0n;
      for (const item of items) { const value = paise(item!.AssAmt, line); if (value === null) stopAt('GST_TAXABLE_MISSING', 'An e-invoice item line has no assessable value.', line); itemTaxable += value!; }
      const assessable = paise(values.AssVal, line);
      if (assessable === null) stopAt('EINVOICE_VALUE_MISSING', 'An e-invoice has no assessable value in its value details.', line);
      // A batch has no file-level total, so each document is checked against its own value details here.
      if (!single && itemTaxable !== assessable) stopAt('EINVOICE_ITEMS_MISMATCH', 'An e-invoice\'s item assessable values do not add up to its own assessable value.', line);
      const heads: (bigint | null)[] = [];
      for (const [total, itemHeads] of EINVOICE_HEADS) {
        const stated = paise(values[total], line); heads.push(stated);
        if (stated === null) continue;
        const fromItems = sumPresent(items.flatMap(item => itemHeads.map(h => paise(item![h], line))));
        if ((fromItems ?? 0n) !== stated) stopAt('EINVOICE_TAX_MISMATCH', 'An e-invoice\'s item tax does not add up to its own tax total.', line);
      }
      const sign = type === 'CRN' ? -1n : 1n;
      if (single) declared = { rowCount: 1, amount: String(sign * assessable!), amountUnit: 'minor', reference: 'einvoice-valdtls-assval' };
      const cells: Record<string, string> = { sellerGstin: text(obj(d!.SellerDtls)!.Gstin).toUpperCase(), buyerGstin: text(buyer.Gstin).toUpperCase(), buyerName: text(buyer.LglNm), docType: type,
        number: text(doc.No), date: text(doc.Dt), taxable: String(single ? itemTaxable : assessable!), tax: cell(sumPresent(heads)), invoiceValue: cell(paise(values.TotInvVal, line)), supplyType: text(obj(d!.TranDtls)?.SupTyp) };
      rows.push({ line, cells: Object.fromEntries(EINVOICE_HEADERS.map(h => [h, cells[h] ?? ''])) });
    });
    return table(EINVOICE_HEADERS, rows, declared, { ...(input.meta ?? {}) });
  },
};

// ---- e-way bill -----------------------------------------------------------------------------------

const EWAY_HEADERS = ['ewbNo', 'docType', 'number', 'date', 'fromGstin', 'toGstin', 'toName', 'taxable', 'tax', 'invoiceValue'];
export const ewayBillDecoder: Decoder = {
  id: 'ewaybill-json', version: '1', accepts: 'text',
  decode(input) {
    const parsed = root(input, 'This recipe reads e-way bill JSON.');
    const top = obj(parsed);
    const bills = Array.isArray(parsed) ? parsed : Array.isArray(top?.ewayBills) ? top!.ewayBills as unknown[] : Array.isArray(top?.billLists) ? top!.billLists as unknown[] : top && 'docNo' in top ? [top] : null;
    check(bills, 'INVALID_EWAY_BILL', 'This is not an e-way bill file: it has no bill list.');
    const rows: RawRow[] = [];
    bills!.forEach((bill, index) => {
      const line = index + 1, b = obj(bill); check(b, 'INVALID_EWAY_BILL', 'An e-way bill is not an object.');
      const items = list(b!.itemList).map(obj);
      if (!items.length || items.some(item => !item)) stopAt('GST_ITEMS_MISSING', 'An e-way bill has no item lines.', line);
      let itemTaxable = 0n;
      for (const item of items) { const value = paise(item!.taxableAmount, line); if (value === null) stopAt('GST_TAXABLE_MISSING', 'An e-way bill item line has no taxable amount.', line); itemTaxable += value!; }
      const stated = paise(b!.totalValue, line);
      if (stated === null) stopAt('EWAY_VALUE_MISSING', 'An e-way bill has no total taxable value.', line);
      if (stated !== itemTaxable) stopAt('EWAY_ITEMS_MISMATCH', 'An e-way bill\'s item taxable amounts do not add up to its own total value.', line);
      const tax = sumPresent(['igstValue', 'cgstValue', 'sgstValue', 'cessValue'].map(h => paise(b![h], line)));
      const cells: Record<string, string> = { ewbNo: text(b!.ewbNo ?? b!.ewayBillNo), docType: text(b!.docType).toUpperCase(), number: text(b!.docNo), date: text(b!.docDate),
        fromGstin: text(b!.fromGstin).toUpperCase(), toGstin: text(b!.toGstin).toUpperCase(), toName: text(b!.toTrdName), taxable: String(stated), tax: cell(tax), invoiceValue: cell(paise(b!.totInvValue, line)) };
      rows.push({ line, cells: Object.fromEntries(EWAY_HEADERS.map(h => [h, cells[h] ?? ''])) });
    });
    return table(EWAY_HEADERS, rows, null, { ...(input.meta ?? {}) });
  },
};

// ---- recipes --------------------------------------------------------------------------------------

const f = (from: string, type: FieldSpec['type'], required = false, dateFormats?: FieldSpec['dateFormats']): FieldSpec =>
  ({ from: [from], type, ...(required ? { required: true } : {}), ...(dateFormats ? { dateFormats } : {}) });
const minorInr = (field: string) => ({ type: 'money' as const, amount: { field }, currency: { constant: 'INR' }, unit: 'minor' as const });
const PAISE = 'Amounts are converted once to exact whole paise.';
const TAX_NOTICE = 'Tax is the sum of the tax heads the document states; a head it leaves out is not charged on that line, and a document with no tax head at all leaves its tax unknown, not zero.';
const ROUND_OFF_NOTICE = 'Each document\'s taxable value plus tax is checked against its own document value, allowing up to one rupee of round-off.';

const gstr1Fields = {
  number: f('number', 'text', true), date: f('date', 'date', true, ['DMY']), taxable: f('taxable', 'money', true), tax: f('tax', 'money'),
  ctin: f('ctin', 'text'), value: f('value', 'money'), section: f('section', 'text', true),
};
const gstr1Invoices: Omit<SourceRecipe, 'id' | 'title' | 'totals' | 'notices'> = {
  version: '1', group: 'gst-downloads', operation: 'gstr1-outward-invoices', decoder: 'gstr1-json', records: ['b2b', 'b2cl'],
  fields: gstr1Fields, measure: minorInr('taxable'), identity: ['number'], kind: { constant: 'invoice' },
  outputs: { invoiceId: 'number', customerId: 'ctin', gstin: 'ctin', taxMinor: 'tax' },
  ignored: ['pos', 'noteType', 'reverseCharge', 'invoiceType'], sensitivity: 'financial',
};
const GSTR1_NOTICE = 'GSTR-1 outward invoices (B2B and B2C large); the amount is the taxable value of each invoice.';

const gstr2bFields = {
  ctin: f('ctin', 'text', true), tradeName: f('tradeName', 'text'), number: f('number', 'text', true), date: f('date', 'date', true, ['DMY']),
  taxable: f('taxable', 'money', true), tax: f('tax', 'money'), itcAvailable: f('itcAvailable', 'text'), noteType: f('noteType', 'text'),
};
const ITC_STATUS = { Y: 'itc_available', N: 'itc_unavailable', '': '' };
const twoBOutputs = { customerId: 'ctin', customerName: 'tradeName', invoiceId: 'number', gstin: 'ctin', taxMinor: 'tax' };
const twoBIgnored = ['value', 'reverseCharge', 'invoiceType', 'reason'];

export const RECIPES: readonly SourceRecipe[] = [
  { ...gstr1Invoices, id: 'gst.gstr1-invoices', title: 'GSTR-1 outward invoices (JSON download), checked against the portal summary you enter',
    totals: { kind: 'report' },
    notices: [GSTR1_NOTICE, PAISE, TAX_NOTICE, ROUND_OFF_NOTICE,
      'The GSTR-1 download has no file-level total, so the check is the taxable value and invoice count from the GSTR-1 summary on the portal, entered by the person. Adding up the invoices would only repeat the file, so it is not used as the source total.'] },
  { ...gstr1Invoices, id: 'gst.gstr1-invoices-summary', title: 'GSTR-1 outward invoices with the portal summary section (JSON download)',
    totals: { kind: 'declared' },
    notices: [GSTR1_NOTICE, PAISE, TAX_NOTICE, ROUND_OFF_NOTICE,
      'Checked against the download\'s own summary section (sec_sum): the record counts and taxable values the portal states for B2B and B2C large.'] },
  { version: '1', group: 'gst-downloads', operation: 'gstr1-credit-debit-notes', decoder: 'gstr1-json', records: ['cdnr'],
    id: 'gst.gstr1-notes', title: 'GSTR-1 credit and debit notes to registered persons (JSON download)',
    fields: { ...gstr1Fields, noteType: f('noteType', 'text', true) }, measure: minorInr('taxable'), identity: ['noteType', 'number'],
    kind: { field: 'noteType', values: { C: 'refund', D: 'debit_note' } },
    outputs: { invoiceId: 'number', customerId: 'ctin', gstin: 'ctin', taxMinor: 'tax' }, ignored: ['pos', 'reverseCharge', 'invoiceType'],
    totals: { kind: 'report' }, sensitivity: 'financial',
    notices: ['GSTR-1 credit notes are imported as kind refund and debit notes as kind debit_note.', 'Amounts are positive, as the return states them; the kind says which way each note moves the outward supply.',
      PAISE, TAX_NOTICE, ROUND_OFF_NOTICE, 'The check is the note count and taxable value the person enters from the portal summary, because the download has no file-level total.'] },
  { version: '1', group: 'gst-downloads', operation: 'gstr2b-b2b-invoices', decoder: 'gstr2b-json', records: ['b2b'],
    id: 'gst.gstr2b-b2b', title: 'GSTR-2B supplier invoices (JSON download)',
    fields: gstr2bFields, measure: minorInr('taxable'), identity: ['ctin', 'number'], kind: { constant: 'purchase' },
    status: { field: 'itcAvailable', values: ITC_STATUS }, outputs: twoBOutputs, ignored: twoBIgnored,
    totals: { kind: 'declared' }, sensitivity: 'financial',
    notices: ['GSTR-2B lists invoices that suppliers reported; it is not the purchase register. Match it with the purchase register before treating any credit as claimable.',
      'The amount is the taxable value of each supplier invoice; the supplier GSTIN is kept as the party and GSTIN.',
      PAISE, TAX_NOTICE, ROUND_OFF_NOTICE,
      'Checked against the download\'s own ITC summary: the taxable value of B2B invoices across credit available and not available, forward and reverse charge.'] },
  { version: '1', group: 'gst-downloads', operation: 'gstr2b-credit-debit-notes', decoder: 'gstr2b-json', records: ['cdnr'],
    id: 'gst.gstr2b-notes', title: 'GSTR-2B supplier credit and debit notes (JSON download)',
    fields: { ...gstr2bFields, noteType: f('noteType', 'text', true) }, measure: minorInr('taxable'), identity: ['ctin', 'noteType', 'number'],
    kind: { field: 'noteType', values: { C: 'purchase_credit_note', D: 'purchase_debit_note' } },
    status: { field: 'itcAvailable', values: ITC_STATUS }, outputs: twoBOutputs, ignored: twoBIgnored,
    totals: { kind: 'report' }, sensitivity: 'financial',
    notices: ['Supplier credit and debit notes are imported with positive amounts, as GSTR-2B states them; the kind says which way each note moves.', PAISE, TAX_NOTICE,
      'The check is the total the person enters from the portal summary; this recipe does not read the ITC summary for notes.'] },
  { version: '1', group: 'gst-downloads', operation: 'gstr3b-outward-supplies', decoder: 'gstr3b-json', records: ['sup_details'],
    id: 'gst.gstr3b-supplies', title: 'GSTR-3B table 3.1 supplies (JSON download)',
    fields: { table: f('table', 'text', true), label: f('label', 'text'), date: f('period', 'date', true, ['ISO']), taxable: f('taxable', 'money', true), tax: f('tax', 'money') },
    measure: minorInr('taxable'), identity: ['date', 'table'], kind: { constant: 'gst_return_summary' },
    outputs: { description: 'label', taxMinor: 'tax' }, ignored: ['direction'], totals: { kind: 'report' }, sensitivity: 'financial',
    notices: ['GSTR-3B is itself a summary return: each row is one line of table 3.1 as filed, dated to the first day of the return month, not a transaction.',
      'The amount is the taxable value of that row; rows are different kinds of supply and are not one total.', PAISE,
      'Table 3.1 has no total field of its own, so the check is the total the person enters from the filed return.'] },
  { version: '1', group: 'gst-downloads', operation: 'gstr3b-input-tax-credit', decoder: 'gstr3b-json', records: ['itc_elg'],
    id: 'gst.gstr3b-itc', title: 'GSTR-3B table 4 input tax credit (JSON download)',
    fields: { table: f('table', 'text', true), label: f('label', 'text'), date: f('period', 'date', true, ['ISO']), tax: f('tax', 'money', true), direction: f('direction', 'text', true) },
    measure: minorInr('tax'), identity: ['date', 'table'], kind: { constant: 'gst_return_summary' },
    sign: { field: 'direction', negative: ['reversed'], positive: ['available'] },
    outputs: { description: 'label' }, ignored: ['taxable'], totals: { kind: 'declared' }, sensitivity: 'financial',
    notices: ['GSTR-3B is itself a summary return: each row is one line of table 4 as filed, dated to the first day of the return month.',
      'The amount is the credit in that row (integrated, central, state and cess tax together); credit reversed in 4(B) is negative.', PAISE,
      'Checked against the return\'s own net credit in table 4(C), which must equal 4(A) available minus 4(B) reversed.'] },
  { version: '1', group: 'gst-provider', operation: 'einvoice-document', decoder: 'einvoice-json',
    id: 'gst.einvoice', title: 'One e-invoice (IRN schema JSON)',
    fields: { sellerGstin: f('sellerGstin', 'text', true), buyerGstin: f('buyerGstin', 'text'), buyerName: f('buyerName', 'text'), docType: f('docType', 'text', true),
      number: f('number', 'text', true), date: f('date', 'date', true, ['DMY']), taxable: f('taxable', 'money', true), tax: f('tax', 'money') },
    measure: minorInr('taxable'), identity: ['sellerGstin', 'docType', 'number'], kind: { field: 'docType', values: { INV: 'invoice', CRN: 'refund', DBN: 'debit_note' } },
    sign: { field: 'docType', negative: ['CRN'], positive: ['INV', 'DBN'] },
    outputs: { invoiceId: 'number', customerId: 'buyerGstin', gstin: 'buyerGstin', customerName: 'buyerName', taxMinor: 'tax' }, ignored: ['invoiceValue', 'supplyType'],
    totals: { kind: 'declared' }, sensitivity: 'financial',
    notices: ['One e-invoice document; the amount is the sum of its item assessable values, and a credit note is negative.',
      'Checked against the document\'s own assessable value in its value details; its tax heads are checked against the item tax.',
      'The total invoice value is not checked, because it also carries discounts, other charges and round-off.', PAISE] },
  { version: '1', group: 'gst-provider', operation: 'einvoice-batch', decoder: 'einvoice-json',
    id: 'gst.einvoice-batch', title: 'A file of e-invoices (IRN schema JSON array)',
    fields: { sellerGstin: f('sellerGstin', 'text', true), buyerGstin: f('buyerGstin', 'text'), buyerName: f('buyerName', 'text'), docType: f('docType', 'text', true),
      number: f('number', 'text', true), date: f('date', 'date', true, ['DMY']), taxable: f('taxable', 'money', true), tax: f('tax', 'money') },
    measure: minorInr('taxable'), identity: ['sellerGstin', 'docType', 'number'], kind: { field: 'docType', values: { INV: 'invoice', CRN: 'refund', DBN: 'debit_note' } },
    sign: { field: 'docType', negative: ['CRN'], positive: ['INV', 'DBN'] },
    outputs: { invoiceId: 'number', customerId: 'buyerGstin', gstin: 'buyerGstin', customerName: 'buyerName', taxMinor: 'tax' }, ignored: ['invoiceValue', 'supplyType'],
    totals: { kind: 'report' }, sensitivity: 'financial',
    notices: ['Several e-invoices; each document\'s item assessable values must add up to its own assessable value, or the file is refused at that document.',
      'Adding the documents\' own totals together is not a source total, so the file total is the one the person enters from the provider\'s report.', 'A credit note is negative.', PAISE] },
  { version: '1', group: 'gst-provider', operation: 'eway-bills', decoder: 'ewaybill-json',
    id: 'gst.eway-bills', title: 'E-way bills (JSON)',
    fields: { ewbNo: f('ewbNo', 'text'), number: f('number', 'text', true), date: f('date', 'date', true, ['DMY']), fromGstin: f('fromGstin', 'text', true),
      toGstin: f('toGstin', 'text'), toName: f('toName', 'text'), taxable: f('taxable', 'money', true), tax: f('tax', 'money') },
    measure: minorInr('taxable'), identity: ['fromGstin', 'number'], kind: { constant: 'eway_bill' },
    outputs: { invoiceId: 'number', customerId: 'toGstin', gstin: 'toGstin', customerName: 'toName', taxMinor: 'tax' }, ignored: ['docType', 'invoiceValue'],
    totals: { kind: 'report' }, sensitivity: 'financial',
    notices: ['An e-way bill records goods moving, not a sale: it is never revenue and must not be added to invoices.',
      'Each bill\'s item taxable amounts must add up to its own total value, or the file is refused at that bill.',
      'The file has no total of its own, so the check is the total the person enters from the portal report.', PAISE] },
];
export const DECODERS: readonly Decoder[] = [gstr1Decoder, gstr2bDecoder, gstr3bDecoder, einvoiceDecoder, ewayBillDecoder];
