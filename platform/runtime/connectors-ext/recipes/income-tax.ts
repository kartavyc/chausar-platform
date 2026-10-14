import { check } from '../../contracts.ts';
import { parseJson } from '../decoders.ts';
import { parseMoney } from '../values.ts';
import type { Decoder, FieldSpec, SourceRecipe } from '../recipe.ts';
import type { DeclaredTotals, RawRow } from '../types.ts';
import { list, obj, paise, stopAt, table, text } from './gst.ts';
import { UNCONFIRMED, checkedAgainst } from './operations.ts';

/**
 * Income-tax statements: Form 26AS (TRACES text download) and the Annual Information Statement (AIS).
 * AIS and Form 26AS can describe the same deduction; their records are never added together.
 */

// ---- Form 26AS text download ----------------------------------------------------------------------

const F26_HEADERS = ['tan', 'deductorName', 'deductorLine', 'transactionNo', 'section', 'transactionDate', 'bookingStatus', 'bookingDate', 'remarks', 'amountPaid', 'taxDeducted', 'tdsDeposited'];
const TAN = /^[A-Z]{4}\d{5}[A-Z]$/;
/** Header text compared without case, spaces or punctuation: "Total Amount Paid / Credited(Rs.)" reads as totalamountpaidcreditedrs. */
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const PART_ONE = /^PART\s*-?\s*(?:I|A)\b/i;
const ANY_PART = /^PART\s*-?\s*[A-Z0-9]+\b/i;
type Columns = Record<string, number>;
function columns(cells: string[], wanted: Record<string, string>): Columns | null {
  const keys = cells.map(key), out: Columns = {};
  for (const [name, prefix] of Object.entries(wanted)) {
    const at = keys.findIndex(k => k.startsWith(prefix));
    if (at < 0) return null;
    out[name] = at;
  }
  return out;
}
const DEDUCTOR_COLUMNS = { sr: 'srno', name: 'nameofdeductor', tan: 'tanofdeductor', paid: 'totalamountpaid', deducted: 'totaltaxdeducted', deposited: 'totaltdsdeposited' };
const TRANSACTION_COLUMNS = { sr: 'srno', section: 'section', date: 'transactiondate', status: 'statusofbooking', bookingDate: 'dateofbooking', remarks: 'remarks', paid: 'amountpaid', deducted: 'taxdeducted', deposited: 'tdsdeposited' };
type Deductor = { line: number; tan: string; name: string; paid: bigint; deducted: bigint; deposited: bigint; sums: { paid: bigint; deducted: bigint; deposited: bigint } };

const rupees = (value: string, line: number): bigint | null => {
  try { const minor = parseMoney(value, 'major', 'INR'); return minor === null ? null : BigInt(minor); }
  catch { return stopAt('INVALID_MONEY', 'An amount is not exact decimal money.', line); }
};

export const form26asDecoder: Decoder = {
  id: 'form26as-text', version: '1', accepts: 'text',
  decode(input, recipe) {
    check(typeof input.text === 'string' && input.text.length <= 20 * 1024 * 1024, 'TEXT_REQUIRED', 'This recipe reads the Form 26AS text download.');
    const lines = input.text!.replace(/^﻿/, '').split(/\r?\n/).map((raw, i) => ({ line: i + 1, cells: raw.split('^').map(c => c.trim()) }));
    const meta: Record<string, string> = { ...(input.meta ?? {}) };
    const panHeader = lines.findIndex(l => l.cells.some(c => key(c).startsWith('permanentaccountnumber')));
    if (panHeader >= 0 && lines[panHeader + 1]) {
      const head = lines[panHeader].cells.map(key), values = lines[panHeader + 1].cells;
      const at = (prefix: string) => head.findIndex(k => k.startsWith(prefix));
      if (at('permanentaccountnumber') >= 0) meta.pan = values[at('permanentaccountnumber')] ?? '';
      if (at('financialyear') >= 0) meta.financialYear = values[at('financialyear')] ?? '';
    }
    const first = (l: { cells: string[] }) => l.cells.find(c => c.length > 0) ?? '';
    const start = lines.findIndex(l => PART_ONE.test(first(l)) && /tax deducted at source/i.test(l.cells.join(' ')));
    check(start >= 0, 'FORM26AS_PART_MISSING', 'Part I of Form 26AS, tax deducted at source, was not found. This may be another statement or layout.');
    const end = lines.findIndex((l, i) => i > start && ANY_PART.test(first(l)));
    // TRACES writes every later part, even when it holds no transactions. Without them the file stopped early.
    check(end > start, 'SOURCE_CUT_SHORT', 'The later parts of Form 26AS are missing. The file looks cut short.');
    let deductorColumns: Columns | null = null, transactionColumns: Columns | null = null, current: Deductor | null = null;
    const deductors: Deductor[] = [], rows: RawRow[] = [];
    for (const l of lines.slice(start + 1, end)) {
      const cells = l.cells;
      if (cells.every(c => c === '')) continue;
      if (cells.some(c => /^no transactions? present$/i.test(c))) continue;
      const deductorHead = columns(cells, DEDUCTOR_COLUMNS);
      if (deductorHead) { deductorColumns = deductorHead; continue; }
      const transactionHead = cells.some(c => key(c) === 'transactiondate') ? columns(cells, TRANSACTION_COLUMNS) : null;
      if (transactionHead) { transactionColumns = transactionHead; continue; }
      if (deductorColumns && TAN.test(cells[deductorColumns.tan] ?? '') && /^\d{1,6}$/.test(cells[deductorColumns.sr] ?? '')) {
        const total = (column: number) => { const value = rupees(cells[column] ?? '', l.line); return value === null ? stopAt('DEDUCTOR_TOTAL_MISSING', 'A deductor row has no total of its own.', l.line) : value; };
        current = { line: l.line, tan: cells[deductorColumns.tan], name: cells[deductorColumns.name] ?? '', paid: total(deductorColumns.paid), deducted: total(deductorColumns.deducted), deposited: total(deductorColumns.deposited), sums: { paid: 0n, deducted: 0n, deposited: 0n } };
        deductors.push(current); continue;
      }
      if (transactionColumns && /^\d{1,6}$/.test(cells[transactionColumns.sr] ?? '') && (cells[transactionColumns.section] ?? '') !== '') {
        if (!current) stopAt('FORM26AS_LAYOUT', 'A transaction row comes before any deductor row.', l.line);
        const c = transactionColumns, amount = (column: number) => { const value = rupees(cells[column] ?? '', l.line); return value === null ? stopAt('FORM26AS_AMOUNT_MISSING', 'A transaction row has an empty amount. A missing amount is not counted as zero.', l.line) : value; };
        const paid = amount(c.paid), deducted = amount(c.deducted), deposited = amount(c.deposited);
        current!.sums.paid += paid; current!.sums.deducted += deducted; current!.sums.deposited += deposited;
        rows.push({ line: l.line, cells: { tan: current!.tan, deductorName: current!.name, deductorLine: String(current!.line), transactionNo: cells[c.sr], section: cells[c.section].toUpperCase(),
          transactionDate: cells[c.date] ?? '', bookingStatus: (cells[c.status] ?? '').toUpperCase(), bookingDate: cells[c.bookingDate] ?? '', remarks: cells[c.remarks] ?? '',
          amountPaid: String(paid), taxDeducted: String(deducted), tdsDeposited: String(deposited) } });
        continue;
      }
      stopAt('FORM26AS_LAYOUT', 'A line in Part I is neither a deductor row nor a transaction row.', l.line);
    }
    // Each deductor's own summary row is the source total for that deductor's transactions.
    for (const d of deductors) {
      if (d.sums.paid !== d.paid || d.sums.deducted !== d.deducted || d.sums.deposited !== d.deposited)
        stopAt('DEDUCTOR_TOTAL_MISMATCH', 'A deductor\'s transactions do not add up to that deductor\'s own total. The file may be cut short or changed.', d.line);
    }
    const measured = recipe.measure.type === 'money' && 'field' in recipe.measure.amount ? recipe.fields[recipe.measure.amount.field]?.from[0] : '';
    check(measured === 'taxDeducted' || measured === 'amountPaid', 'RECIPE_INVALID', 'A Form 26AS recipe measures tax deducted or amount paid.');
    const declared: DeclaredTotals | null = deductors.length
      ? { rowCount: null, amount: String(deductors.reduce((sum, d) => sum + (measured === 'taxDeducted' ? d.deducted : d.paid), 0n)), amountUnit: 'minor', reference: 'form26as-deductor-totals' }
      : null;
    return table(F26_HEADERS, rows, declared, meta);
  },
};

// ---- AIS JSON ---------------------------------------------------------------------------------------

/**
 * Documented AIS layout this decoder reads (experimental; synthetic fixtures only):
 * { PAN, FinancialYear, AISInformation: [ { InformationCategory, InformationCode, InformationDescription, InformationSource,
 *   Count, ReportedValue, ProcessedValue, AcceptedValue, Transactions: [ { SrNo, Date, ReportedValue, ProcessedValue, AcceptedValue } ] } ] }
 * One decoder per value type. Each reads only its own key, so reported, processed and accepted values never mix.
 */
const AIS_HEADERS = ['category', 'code', 'description', 'source', 'srNo', 'date', 'value', 'informationNo'];
type AisValue = 'ReportedValue' | 'ProcessedValue' | 'AcceptedValue';
const aisDecoder = (id: string, valueKey: AisValue): Decoder => ({
  id, version: '1', accepts: 'text',
  decode(input) {
    check(typeof input.text === 'string' && input.text.length <= 20 * 1024 * 1024, 'TEXT_REQUIRED', 'This recipe reads an AIS JSON download.');
    const data = obj(parseJson(input.text!));
    check(data && Array.isArray(data.AISInformation), 'INVALID_AIS', 'This is not an AIS download: it has no information list.');
    const rows: RawRow[] = []; let declared = 0n, count = 0, countKnown = true;
    list(data!.AISInformation).forEach((entry, index) => {
      const information = index + 1, e = obj(entry);
      if (!e) stopAt('INVALID_AIS', 'An AIS information entry is not an object.', information);
      const stated = paise(e![valueKey], information);
      if (stated === null) stopAt('AIS_VALUE_MISSING', 'An AIS information entry does not state the value type this recipe reads.', information);
      const transactions = list(e!.Transactions).map(obj);
      if (!transactions.length || transactions.some(t => !t)) stopAt('AIS_TRANSACTIONS_MISSING', 'An AIS information entry has no transaction lines.', information);
      let sum = 0n; const values: (bigint | null)[] = transactions.map(t => paise(t![valueKey], information));
      for (const value of values) if (value !== null) sum += value;
      if (values.every(v => v !== null) && sum !== stated) stopAt('AIS_INFORMATION_TOTAL_MISMATCH', 'An AIS information entry\'s transactions do not add up to its own stated value.', information);
      declared += stated!;
      const statedCount = text(e!.Count);
      if (/^\d{1,9}$/.test(statedCount)) count += Number(statedCount); else countKnown = false;
      transactions.forEach((t, i) => rows.push({ line: rows.length + 1, cells: {
        category: text(e!.InformationCategory), code: text(e!.InformationCode).toUpperCase(), description: text(e!.InformationDescription), source: text(e!.InformationSource),
        srNo: text(t!.SrNo) || String(i + 1), date: text(t!.Date), value: values[i] === null ? '' : String(values[i]), informationNo: String(information) } }));
    });
    // The stated count is the number of reported transactions; it is checked only for reported values.
    const rowCount = valueKey === 'ReportedValue' && countKnown && rows.length ? count : null;
    return table(AIS_HEADERS, rows, rows.length ? { rowCount, amount: String(declared), amountUnit: 'minor', reference: `ais-${valueKey}` } : null,
      { ...(input.meta ?? {}), pan: text(data!.PAN), financialYear: text(data!.FinancialYear) });
  },
});

// ---- recipes ----------------------------------------------------------------------------------------

const f = (from: string, type: FieldSpec['type'], required = false, dateFormats?: FieldSpec['dateFormats']): FieldSpec =>
  ({ from: [from], type, ...(required ? { required: true } : {}), ...(dateFormats ? { dateFormats } : {}) });
const minorInr = (field: string) => ({ type: 'money' as const, amount: { field }, currency: { constant: 'INR' }, unit: 'minor' as const });
const NEVER_SUM = 'AIS and Form 26AS can describe the same deduction or payment. Their records are never added together; compare them instead.';
const F26_COMMON = 'Each deductor\'s transactions must add up to that deductor\'s own totals (amount paid, tax deducted and TDS deposited), or the file is refused at that deductor\'s line.';
const F26_TOTAL = 'The source total is the sum of the deductor totals the file states. Part I must be followed by the later parts of the statement, or the file is treated as cut short.';
/** A public TRACES text download: "^"-separated, deductor rows with four empty columns before their totals, "^"-led transaction rows, DD-Mon-YYYY dates. */
const F26_SOURCE = 'The "^"-separated layout (PAN line, PART A / PART-I heading, deductor rows with empty columns, "^"-led transaction rows, DD-Mon-YYYY dates) was checked; that sample stops after Part A, so the later-part headings follow public parsers.';
const F26_CHECKED = checkedAgainst('https://github.com/SRathinaGiri/MLDemo/blob/e545b5567b714a504977e2d77f6e72c56132967c/casas_workshop/SampleCSV/FORM%2026AS.txt');
const f26Fields = {
  tan: f('tan', 'text', true), deductorName: f('deductorName', 'text'), transactionNo: f('transactionNo', 'text', true), section: f('section', 'text', true),
  date: f('transactionDate', 'date', true, ['DMY-MON', 'DMY']), bookingStatus: f('bookingStatus', 'text'),
};
const BOOKING = { F: 'final', P: 'provisional', U: 'unmatched', O: 'overbooked', '': '' };
const f26Base = {
  version: '1', group: 'form26as-ais', decoder: 'form26as-text', identity: ['tan', 'section', 'date', 'transactionNo'],
  status: { field: 'bookingStatus', values: BOOKING }, outputs: { customerId: 'tan', customerName: 'deductorName' },
  totals: { kind: 'declared' as const }, sensitivity: 'financial' as const,
};
const aisRecipe = (valueType: 'reported' | 'processed' | 'accepted', title: string, extra: string): SourceRecipe => ({
  id: `income-tax.ais-${valueType}`, version: '1', group: 'form26as-ais', operation: `ais-${valueType}-values`, title, decoder: `ais-json-${valueType}`,
  fields: { category: f('category', 'text', true), code: f('code', 'text', true), description: f('description', 'text'), source: f('source', 'text', true),
    srNo: f('srNo', 'text', true), date: f('date', 'date', true, ['DMY', 'ISO']), value: f('value', 'money', true) },
  measure: minorInr('value'), identity: ['code', 'source', 'srNo'], kind: { constant: 'ais_information' },
  outputs: { customerName: 'source', description: 'category' }, ignored: ['informationNo'], totals: { kind: 'declared' }, sensitivity: 'financial',
  notices: [`Only the ${valueType} value is imported; reported, processed and accepted values have different meanings and are never mixed or substituted.`, extra,
    'Each information entry\'s transactions must add up to its own stated value, and the file total is checked against the sum of those stated values.', NEVER_SUM,
    'The AIS JSON is the download meant for the AIS offline utility; its field names are not published, so the shape read here is synthetic.', UNCONFIRMED],
});

export const RECIPES: readonly SourceRecipe[] = [
  { ...f26Base, id: 'income-tax.form26as-tds', operation: 'form26as-tds-credit', title: 'Form 26AS Part I tax deducted at source (TRACES text download)',
    fields: { ...f26Fields, taxDeducted: f('taxDeducted', 'money', true) }, measure: minorInr('taxDeducted'), kind: { constant: 'tds_credit' },
    ignored: ['deductorLine', 'bookingDate', 'remarks', 'amountPaid', 'tdsDeposited'],
    notices: ['The amount is the tax deducted on each transaction. The amount paid or credited is imported by its own recipe and never mixed in.',
      'Only booking status F (final) is final credit; provisional, unmatched and overbooked entries keep their status.', F26_COMMON, F26_TOTAL, NEVER_SUM, F26_SOURCE, F26_CHECKED] },
  { ...f26Base, id: 'income-tax.form26as-income', operation: 'form26as-income-reported', title: 'Form 26AS Part I amount paid or credited (TRACES text download)',
    fields: { ...f26Fields, amountPaid: f('amountPaid', 'money', true) }, measure: minorInr('amountPaid'), kind: { constant: 'tds_income_reported' },
    ignored: ['deductorLine', 'bookingDate', 'remarks', 'taxDeducted', 'tdsDeposited'],
    notices: ['The amount is what each deductor reports as paid or credited, the income the deduction was made on. It is not tax and not credit.', F26_COMMON, F26_TOTAL, NEVER_SUM, F26_SOURCE, F26_CHECKED] },
  aisRecipe('reported', 'AIS reported values (JSON download)', 'Reported values are what the reporting source filed.'),
  aisRecipe('processed', 'AIS processed values (JSON download)', 'Processed values are what the system derived after removing duplicates; they can differ from reported values.'),
  aisRecipe('accepted', 'AIS values accepted after taxpayer feedback (JSON download)', 'Accepted values follow the taxpayer\'s feedback. An item without accepted value is refused, never read as zero.'),
];
export const DECODERS: readonly Decoder[] = [form26asDecoder, aisDecoder('ais-json-reported', 'ReportedValue'), aisDecoder('ais-json-processed', 'ProcessedValue'), aisDecoder('ais-json-accepted', 'AcceptedValue')];
