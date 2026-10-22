// Ink final pass: venture.tax.working { period? }. For the AI-native CA firm, the firm's own GST worked by the
// playbook's GST engine from the invoices it issued, with the CA's rate confirmations; for every other business, the
// plan's tax setting and the tax on each issued invoice with its price receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { BlueprintRecord, ClientRecord, InvoiceRecord, TaxWorkingView, VentureDeps } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { BOOKS_TAX_NOTE } from '../runtime/venture/money/books.ts';
import { NO_PURCHASES, TDS_NOTE, parsePeriod } from '../runtime/venture/money/tax-working.ts';
import { call, code, owner, seedBlueprint, setup, type Env } from './venture-views-env.ts';

const working = (env: Env, payload: Record<string, unknown> = {}) =>
  (money['venture.tax.working'] as (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<TaxWorkingView>)(env.deps, owner, payload);
const section = (view: TaxWorkingView, id: string) => view.sections.find(item => item.id === id)!;

type InvoiceSeed = { number: string; issueDate: string; client: ClientRecord; treatment?: InvoiceRecord['taxTreatment']; cgst?: string; sgst?: string; igst?: string; sac?: string | null; status?: InvoiceRecord['status'] };

async function client(env: Env, name: string, stateCode: string | null, countryCode = 'IN'): Promise<ClientRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.client', tx => tx.put<ClientRecord>({ ...tx.base('venture-client'), name, email: null, countryCode, taxId: null, stateCode, note: null }));
}

/** An issued invoice for INR 2,499.00 before tax; GST at 18% split CGST 224.91 and SGST 224.91 unless a test says otherwise. */
async function invoice(env: Env, seed: InvoiceSeed): Promise<InvoiceRecord> {
  const treatment = seed.treatment ?? 'cgst-sgst';
  const taxLines = treatment === 'cgst-sgst' ? [{ label: 'CGST at 9%', rateBps: '900', minor: seed.cgst ?? '22491' }, { label: 'SGST at 9%', rateBps: '900', minor: seed.sgst ?? '22491' }]
    : treatment === 'igst' ? [{ label: 'IGST at 18%', rateBps: '1800', minor: seed.igst ?? '44982' }]
      : treatment === 'zero-rated-lut' ? [{ label: 'GST at 0% (export under LUT)', rateBps: '0', minor: '0' }] : [];
  const tax = taxLines.reduce((sum, line) => sum + BigInt(line.minor), 0n);
  return ventureAction(env.deps, owner, 'prepare', 'seed.invoice', tx => tx.put<InvoiceRecord>({
    ...tx.base('venture-invoice'), number: seed.number, documentTitle: 'TAX INVOICE', orderId: 'order_seed', clientId: seed.client.id, currency: 'INR',
    issueDate: seed.issueDate, dueDate: seed.issueDate, dueInDays: 0, lines: [{ description: 'Monthly books', quantity: '1', unitMinor: '249900', amountMinor: '249900' }],
    subtotalMinor: '249900', discountMinor: '0', taxMinor: String(tax), totalMinor: String(249900n + tax), taxLabel: 'GST', taxRateBps: treatment === 'zero-rated-lut' ? '0' : '1800',
    taxTreatment: treatment, taxLines, supplierTaxId: '27ZZZZZ9999Z1Z8', clientTaxId: null, placeOfSupply: null, sacCode: seed.sac === undefined ? '998222' : seed.sac,
    priceReceiptId: `price_${seed.number.replace(/\W/g, '')}`, status: seed.status ?? 'issued', digest: 'invoice-digest', issuedAt: tx.now, factIds: [],
    booksReceiptId: null, booksNote: null, paidMinor: '0', balanceMinor: String(249900n + tax),
  }));
}

async function caFirm(env: Env, options: { registered?: boolean } = {}): Promise<BlueprintRecord> {
  await ventureAction(env.deps, owner, 'admin', 'seed.idea', tx => { tx.touch({ idea: 'An AI-native CA firm for GST filing and income tax returns in Pune.' }); });
  return seedBlueprint(env, options.registered === false ? { taxAssumed: true } : {});
}

test('parsePeriod: a month, or a financial year written FY or AY; anything else is refused', () => {
  assert.deepEqual(parsePeriod(undefined, '2026-10-15'), { kind: 'month', month: '2026-10', from: '2026-10-01', to: '2026-10-31', display: 'October 2026' });
  assert.equal(parsePeriod('2024-02', '2026-10-15').to, '2024-02-29');
  const fy = parsePeriod('FY 2025-26', '2026-10-15');
  assert.deepEqual(fy, { kind: 'year', fy: '2025-26', ay: '2026-27', from: '2025-04-01', to: '2026-03-31', display: 'Financial year 2025-26 (assessment year 2026-27)' });
  assert.deepEqual(parsePeriod('AY 2026-27', '2026-10-15'), fy);
  assert.deepEqual(parsePeriod('ay2026-27', '2026-10-15'), fy);
  for (const bad of ['2026-13', 'FY 2025-27', 'last month', 7]) assert.throws(() => parsePeriod(bad, '2026-10-15'), code('INVALID_VENTURE_REQUEST'), String(bad));
});

test('any other business: the plan says what it charges, each issued invoice with its price receipt, and the total', async () => {
  const env = await setup();
  await seedBlueprint(env);
  const cafe = await client(env, 'Cafe Aroma Demo', '27');
  const issued = await invoice(env, { number: 'INV-0001', issueDate: '2026-10-05', client: cafe });
  await invoice(env, { number: 'INV-0002', issueDate: '2026-10-06', client: cafe, status: 'draft' });
  await invoice(env, { number: 'INV-0003', issueDate: '2026-09-30', client: cafe });
  const view = await working(env);
  assert.equal(view.period, 'October 2026');
  assert.equal(view.needsCaConfirmation, false);
  assert.deepEqual(view.sections.map(item => item.id), ['tax']);
  const tax = section(view, 'tax');
  assert.equal(tax.title, 'GST');
  assert.equal(tax.note, BOOKS_TAX_NOTE);
  assert.deepEqual(tax.lines, [
    { label: 'What your plan says', value: 'You charge GST at 18%' },
    { label: 'INV-0001, Cafe Aroma Demo', value: 'GST INR 449.82 on INR 2,499.00', receiptId: issued.priceReceiptId },
    { label: 'GST on invoices issued in October 2026', value: 'INR 449.82' },
  ]);
  const assumed = await setup();
  await seedBlueprint(assumed, { taxAssumed: true });
  const lines = section(await working(assumed, { period: '2026-10' }), 'tax').lines;
  assert.deepEqual(lines, [
    { label: 'What your plan says', value: 'You do not charge GST (Chausar assumed this; confirm it in the business menu)' },
    { label: 'GST on invoices issued in October 2026', value: 'No invoices issued' },
  ]);
  await assert.rejects(working(env, { period: 'soon' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(working(env, { period: '2026-10', other: 1 }), code('INVALID_VENTURE_REQUEST'));
});

test('CA firm, a month: the GST engine works the issued invoices; what it cannot count is left out for the CA', async () => {
  const env = await setup();
  await caFirm(env);
  const pune = await client(env, 'Cafe Aroma Demo', '27');
  const bengaluru = await client(env, 'Bengaluru Bakes', '29');
  const abroad = await client(env, 'Brooklyn Beans', null, 'US');
  const first = await invoice(env, { number: 'INV-0001', issueDate: '2025-10-10', client: pune });
  const second = await invoice(env, { number: 'INV-0002', issueDate: '2025-10-12', client: bengaluru, treatment: 'igst' });
  await invoice(env, { number: 'INV-0003', issueDate: '2025-10-14', client: abroad, treatment: 'zero-rated-lut' });
  await invoice(env, { number: 'INV-0004', issueDate: '2025-10-15', client: pune, sac: null });
  // The invoice shows one rupee more CGST than the working gives.
  const fourth = await invoice(env, { number: 'INV-0005', issueDate: '2025-10-16', client: pune, cgst: '22591' });

  const view = await working(env, { period: '2025-10' });
  assert.equal(view.period, 'October 2025');
  assert.equal(view.needsCaConfirmation, true, 'the GST rate table is not confirmed yet');
  assert.deepEqual(view.sections.map(item => item.id), ['gst', 'gst-invoices', 'gst-left-out', 'tds']);
  const gst = section(view, 'gst');
  assert.equal(gst.title, 'GST for October 2025');
  // Three invoices of INR 2,499.00: CGST and SGST 224.91 each on two, IGST 449.82 on one; 449.82 x 3 = 1,349.46.
  assert.deepEqual(gst.lines.map(line => [line.label, line.value, line.receiptId]), [
    ['Taxable value of sales counted', 'INR 7,497.00', undefined],
    ['Output CGST', 'INR 449.82', undefined],
    ['Output SGST', 'INR 449.82', undefined],
    ['Output IGST', 'INR 449.82', undefined],
    ['GST to pay in cash', 'INR 1,349.46', undefined],
  ]);
  assert.match(gst.note!, /^Worked by the GST engine from 3 issued invoices, working receipt ca_[a-f0-9]{24}\./);
  assert.ok(gst.note!.includes(NO_PURCHASES));
  assert.ok(gst.note!.includes('Your CA has not confirmed "GST rates and the GSTR-1 large invoice threshold" (version 2) yet.'));
  assert.deepEqual(section(view, 'gst-invoices').lines.map(line => [line.label, line.receiptId]),
    [['INV-0001, Cafe Aroma Demo', first.priceReceiptId], ['INV-0002, Bengaluru Bakes', second.priceReceiptId], ['INV-0005, Cafe Aroma Demo', fourth.priceReceiptId]]);
  assert.deepEqual(section(view, 'gst-left-out').lines, [
    { label: 'INV-0003', value: 'Export under a Letter of Undertaking: zero-rated, for your CA to report.' },
    { label: 'INV-0004', value: 'The invoice has no SAC code.' },
    { label: 'INV-0005, CGST', value: 'The invoice shows INR 225.91; the working gives INR 224.91.' },
  ]);
  assert.equal(section(view, 'tds').note, TDS_NOTE);

  // Once the CA of record confirms the GST rates, the month needs nothing more from the CA.
  await call(env, 'venture.ca.setOfRecord', { name: 'CA Asha Rao', membershipNo: '123456' });
  await call(env, 'venture.ca.confirmRates', { tableIds: ['in-gst-rates'], membershipNo: '123456' });
  const confirmed = await working(env, { period: '2025-10' });
  assert.equal(confirmed.needsCaConfirmation, false);
  assert.ok(!section(confirmed, 'gst').note!.includes('has not confirmed'));
});

test('CA firm: no GST registration means no GST working; a year shows each month and what was billed', async () => {
  const unregistered = await setup();
  await caFirm(unregistered, { registered: false });
  const none = await working(unregistered, { period: '2025-10' });
  assert.equal(section(none, 'gst').note, 'Your plan says you do not charge GST, so there is no GST working. Chausar assumed this; confirm it in the business menu.');
  assert.deepEqual(section(none, 'gst').lines, []);

  const env = await setup();
  await caFirm(env);
  const pune = await client(env, 'Cafe Aroma Demo', '27');
  await invoice(env, { number: 'INV-0001', issueDate: '2025-10-10', client: pune });
  await invoice(env, { number: 'INV-0002', issueDate: '2025-11-03', client: pune });
  await invoice(env, { number: 'INV-0003', issueDate: '2026-04-02', client: pune });
  const year = await working(env, { period: 'FY 2025-26' });
  assert.equal(year.period, 'Financial year 2025-26 (assessment year 2026-27)');
  assert.equal(year.needsCaConfirmation, true);
  assert.deepEqual(section(year, 'gst').lines, [{ label: 'October 2025', value: 'INR 449.82' }, { label: 'November 2025', value: 'INR 449.82' }]);
  const income = section(year, 'income-tax');
  assert.deepEqual(income.lines, [{ label: 'Billed in the year, without tax', value: 'INR 4,998.00' }]);
  assert.match(income.note!, /^The computation needs your whole income for the year/);
  assert.ok(income.note!.includes('Your CA has not confirmed "Income tax slabs, rebate, surcharge and cess for assessment year 2026-27" (version 1) yet.'));
  const later = await working(env, { period: 'AY 2027-28' });
  assert.ok(section(later, 'income-tax').note!.includes('No income-tax rate table'));
});
