// P3-ca-firm: the GST working (GSTR-1 and GSTR-3B working papers) from invoice lines with HSN or SAC and the place
// of supply: output tax by rate, input credit with the GSTR-2B match, the order credit is used in, and net payable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gstWorking, utiliseCredit, type GstLine } from '../runtime/venture/playbooks/ca-firm/gst.ts';
import type { CaReceipt } from '../runtime/venture/playbooks/ca-firm/receipt.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const R = (rupees: number) => String(BigInt(rupees) * 100n);
const fig = (receipt: CaReceipt, key: string) => {
  const found = receipt.figures.find(item => item.key === key);
  assert.ok(found, `no figure ${key}: ${receipt.figures.map(item => item.key).join(', ')}`);
  return found.minor;
};

const OUR_GSTIN = '27AAACL1234F1ZZ';
const outward: GstLine[] = [
  { id: 'o1', invoiceNo: 'INV-101', date: '2025-10-03', counterpartyGstin: '27AAAFS1234K1ZB', placeOfSupply: '27', hsnSac: '998222', taxableMinor: R(1_00_000), rateBps: '1800' },
  { id: 'o2', invoiceNo: 'INV-102', date: '2025-10-10', counterpartyGstin: '29AABCK5678M1ZS', placeOfSupply: '29', hsnSac: '998222', taxableMinor: R(50_000), rateBps: '1800',
    charged: { igstMinor: R(9_000), cgstMinor: '0', sgstMinor: '0' } },
  { id: 'o3', invoiceNo: 'INV-103', date: '2025-10-15', counterpartyGstin: null, placeOfSupply: '27', hsnSac: '4820', taxableMinor: R(2_000), rateBps: '500' },
  { id: 'o4', invoiceNo: 'INV-104', date: '2025-10-20', counterpartyGstin: null, placeOfSupply: '07', hsnSac: '998222', taxableMinor: R(1_50_000), rateBps: '1800',
    charged: { igstMinor: R(26_000), cgstMinor: '0', sgstMinor: '0' } },
  { id: 'o5', invoiceNo: 'INV-105', date: '2025-10-22', counterpartyGstin: null, placeOfSupply: '27', hsnSac: '998222', taxableMinor: R(10_000), rateBps: '1200' },
];
const inward: GstLine[] = [
  { id: 'i1', invoiceNo: 'P-77', date: '2025-10-05', counterpartyGstin: '27AAACP4455R1ZT', placeOfSupply: '27', hsnSac: '997212', taxableMinor: R(40_000), rateBps: '1800', itcEligible: true, in2B: true },
  { id: 'i2', invoiceNo: 'M-9', date: '2025-10-08', counterpartyGstin: '29AAACM9876Q1ZB', placeOfSupply: '27', hsnSac: '8471', taxableMinor: R(1_00_000), rateBps: '1800', itcEligible: true, in2B: true },
  { id: 'i3', invoiceNo: 'P-80', date: '2025-10-25', counterpartyGstin: '27AAACP4455R1ZT', placeOfSupply: '27', hsnSac: '997212', taxableMinor: R(10_000), rateBps: '1800', itcEligible: true, in2B: false },
  { id: 'i4', invoiceNo: 'F-3', date: '2025-10-26', counterpartyGstin: '27AAACP4455R1ZT', placeOfSupply: '27', hsnSac: '996331', taxableMinor: R(5_000), rateBps: '500', itcEligible: false, in2B: true },
];

test('gst working: output tax by rate and by tax head, place of supply deciding CGST and SGST or IGST', () => {
  const receipt = gstWorking({ gstin: OUR_GSTIN, period: '2025-10', outward, inward });
  assert.equal(receipt.engine, 'gst-working');
  const working = receipt.working as ReturnType<typeof gstWorking>['working'];
  assert.deepEqual(working.outputByRate.map(row => [row.rateBps, row.taxableMinor, row.igstMinor, row.cgstMinor, row.sgstMinor]), [
    ['500', R(2_000), '0', R(50), R(50)],
    ['1800', R(3_00_000), R(36_000), R(9_000), R(9_000)],
  ]);
  assert.equal(fig(receipt, 'output-igst'), R(36_000));
  assert.equal(fig(receipt, 'output-cgst'), R(9_050));
  assert.equal(fig(receipt, 'output-sgst'), R(9_050));
  // GSTR-1 sections: registered buyers, large inter-state sales to unregistered buyers, the rest.
  assert.deepEqual(working.gstr1.b2b.map(row => row.invoiceNo), ['INV-101', 'INV-102']);
  assert.deepEqual(working.gstr1.b2cl.map(row => row.invoiceNo), ['INV-104']);
  assert.deepEqual(working.gstr1.b2cs.map(row => [row.placeOfSupply, row.rateBps, row.taxableMinor]), [['27', '500', R(2_000)]]);
  assert.deepEqual(working.hsnSummary.map(row => [row.hsnSac, row.rateBps, row.taxableMinor]), [['4820', '500', R(2_000)], ['998222', '1800', R(3_00_000)]]);
});

test('gst working: every line that cannot be counted is listed with its reason, and charged tax that differs is listed', () => {
  const receipt = gstWorking({ gstin: OUR_GSTIN, period: '2025-10', outward, inward });
  const working = receipt.working as ReturnType<typeof gstWorking>['working'];
  const exception = working.exceptions.find(item => item.lineId === 'o5');
  assert.ok(exception);
  assert.match(exception.reason, /12%.*not a GST rate on 22 October 2025|rate/i);
  assert.equal(working.differences.length, 1);
  assert.deepEqual([working.differences[0].lineId, working.differences[0].head, working.differences[0].chargedMinor, working.differences[0].computedMinor], ['o4', 'igst', R(26_000), R(27_000)]);
  // Bad HSN, a date outside the period and an unknown state are exceptions too, never silently dropped.
  const odd = gstWorking({ gstin: OUR_GSTIN, period: '2025-10', inward: [], outward: [
    { ...outward[0], id: 'x1', hsnSac: '12' },
    { ...outward[0], id: 'x2', date: '2025-11-01' },
    { ...outward[0], id: 'x3', placeOfSupply: '98' },
  ] });
  assert.deepEqual((odd.working as ReturnType<typeof gstWorking>['working']).exceptions.map(item => item.lineId), ['x1', 'x2', 'x3']);
  assert.equal(fig(odd, 'output-cgst'), '0');
});

test('gst working: input credit counts only eligible lines found in GSTR-2B, and the rest are held with a reason', () => {
  const receipt = gstWorking({ gstin: OUR_GSTIN, period: '2025-10', outward, inward });
  const working = receipt.working as ReturnType<typeof gstWorking>['working'];
  assert.equal(fig(receipt, 'itc-igst'), R(18_000));
  assert.equal(fig(receipt, 'itc-cgst'), R(3_600));
  assert.equal(fig(receipt, 'itc-sgst'), R(3_600));
  assert.deepEqual(working.held.map(item => [item.lineId, item.reason]), [['i3', 'not in GSTR-2B'], ['i4', 'not eligible for credit']]);
  // IGST credit first, then CGST and SGST credit against their own heads.
  assert.equal(fig(receipt, 'cash-igst'), R(18_000));
  assert.equal(fig(receipt, 'cash-cgst'), R(5_450));
  assert.equal(fig(receipt, 'cash-sgst'), R(5_450));
  assert.equal(fig(receipt, 'net-payable'), R(28_900));
  assert.ok(receipt.sections.some(section => section.section === '49A'));
});

test('gst working: credit is used IGST first across heads, CGST never pays SGST, and the rest carries forward', () => {
  const result = utiliseCredit(
    { igst: 10_000_00n, cgst: 15_000_00n, sgst: 15_000_00n },
    { igst: 50_000_00n, cgst: 5_000_00n, sgst: 0n },
  );
  assert.deepEqual(result.cash, { igst: 0n, cgst: 0n, sgst: 0n });
  assert.deepEqual(result.carried, { igst: 10_000_00n, cgst: 5_000_00n, sgst: 0n });
  assert.deepEqual(result.steps.map(step => [step.from, step.to, step.amount]), [['igst', 'igst', 10_000_00n], ['igst', 'cgst', 15_000_00n], ['igst', 'sgst', 15_000_00n]]);
  const split = utiliseCredit({ igst: 0n, cgst: 10_000_00n, sgst: 2_000_00n }, { igst: 0n, cgst: 0n, sgst: 5_000_00n });
  // SGST credit pays SGST, never CGST.
  assert.deepEqual(split.cash, { igst: 0n, cgst: 10_000_00n, sgst: 0n });
  assert.deepEqual(split.carried, { igst: 0n, cgst: 0n, sgst: 3_000_00n });
});

test('gst working: lines dated before the new rates use the old table, and refusals are named', () => {
  const september = gstWorking({ gstin: OUR_GSTIN, period: '2025-09', inward: [], outward: [
    { ...outward[0], id: 's1', date: '2025-09-10', rateBps: '1200' },
    { ...outward[0], id: 's2', date: '2025-09-25', rateBps: '1200' },
  ] });
  const working = september.working as ReturnType<typeof gstWorking>['working'];
  assert.deepEqual(working.exceptions.map(item => item.lineId), ['s2']);
  assert.deepEqual(september.tables.map(table => table.version).sort(), [1, 2]);
  assert.throws(() => gstWorking({ gstin: 'NOTAGSTIN', period: '2025-10', outward: [], inward: [] }), code('TAX_INPUT_INVALID'));
  assert.throws(() => gstWorking({ gstin: OUR_GSTIN, period: '2025-10', outward: [{ ...outward[0], cessMinor: R(10) }], inward: [] }), code('NOT_MODELLED'));
  assert.throws(() => gstWorking({ gstin: OUR_GSTIN, period: '2025-10', outward: [{ ...outward[0], reverseCharge: true }], inward: [] }), code('NOT_MODELLED'));
});
