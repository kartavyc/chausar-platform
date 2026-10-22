// P3 money tests: price receipts, tax treatment, clients, orders, invoices, payments and the books.
// Every expected amount is worked out by hand in a comment, never by the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import type { Context } from '../runtime/contracts.ts';
import { CalculatorService, numberGuard } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { METHOD_OWNERS, STEP_PLAN, VENTURE_ERRORS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type {
  BackOffice, BlueprintRecord, ClientRecord, CountryProfile, ModelPort, Offer, PriceReceiptRecord, PricingModel, RecordBase, SecretName, SecretShelf,
  TermRecord, VentureDeps, VentureHandler, VentureMethod, VentureRecord, VentureResults, VentureStorage,
} from '../runtime/venture/contracts.ts';
import { computePrice, handlers, taxTreatmentFor } from '../runtime/venture/money/index.ts';
import { booksPeriods } from '../runtime/venture/money/dates.ts';
import { localDayAt, ventureTimeZone } from '../runtime/venture/local-day.ts';
import { VentureTestStore } from './venture-test-store.ts';

// Rule 23: the fixed clock is at or before real time; business dates are passed explicitly.
const NOW = '2026-10-15T10:00:00.000Z';
const clock = () => new Date(NOW);
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (name: string) => (error: any) => error?.code === name;
const MONEY_DIR = new URL('../runtime/venture/money/', import.meta.url);

const GSTIN_27 = '27ZZZZZ9999Z1Z8'; // synthetic GSTIN with a valid checksum, state 27
const GSTIN_29 = '29ZZZZZ9999Z1Z4'; // synthetic GSTIN with a valid checksum, state 29
const EXPERIMENTAL = "This build keeps your business in experimental storage. Practise here; don't issue real invoices yet.";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function country(code: 'IN' | 'US' | 'GB' | 'JP'): CountryProfile {
  const base = { registrationNote: 'Check with a local accountant.', checkedOn: '2026-10-15', complianceNotes: [] as string[] };
  if (code === 'IN') return { code, name: 'India', currency: 'INR', minorDigits: 2, region: 'india', paymentRails: ['razorpay', 'cashfree', 'paypal'], dateOrder: 'day-month-year', complianceNotes: base.complianceNotes,
    tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', registrationNote: base.registrationNote, idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: base.checkedOn } };
  if (code === 'US') return { code, name: 'United States', currency: 'USD', minorDigits: 2, region: 'global', paymentRails: ['stripe', 'paypal', 'lemon-squeezy'], dateOrder: 'month-day-year', complianceNotes: base.complianceNotes,
    tax: { mode: 'sales-tax', label: 'Sales tax', standardRateBps: '0', registrationNote: base.registrationNote, idLabel: '', idPattern: null, invoiceKind: 'invoice', checkedOn: base.checkedOn } };
  if (code === 'GB') return { code, name: 'United Kingdom', currency: 'GBP', minorDigits: 2, region: 'global', paymentRails: ['stripe', 'paypal', 'paddle'], dateOrder: 'day-month-year', complianceNotes: base.complianceNotes,
    tax: { mode: 'vat', label: 'VAT', standardRateBps: '2000', registrationNote: base.registrationNote, idLabel: 'VAT number', idPattern: '^[A-Z0-9][A-Z0-9-]{4,22}[A-Z0-9]$', invoiceKind: 'tax-invoice', checkedOn: base.checkedOn } };
  return { code, name: 'Japan', currency: 'JPY', minorDigits: 0, region: 'global', paymentRails: ['stripe', 'paypal', 'paddle'], dateOrder: 'year-month-day', complianceNotes: base.complianceNotes,
    tax: { mode: 'vat', label: 'Consumption tax', standardRateBps: '1000', registrationNote: base.registrationNote, idLabel: 'Registration number', idPattern: '^T\\d{13}$', invoiceKind: 'tax-invoice', checkedOn: base.checkedOn } };
}

const refusingModels: ModelPort = {
  status() { throw new Error('The money package never calls a model.'); },
  presets() { throw new Error('The money package never calls a model.'); },
  async checkCli() { throw new Error('The money package never calls a model.'); },
  async generate() { throw new Error('The money package never calls a model.'); },
  async preview() { throw new Error('The money package never calls a model.'); },
  async runPreview() { throw new Error('The money package never calls a model.'); },
};

function shelf(): SecretShelf {
  const values = new Map<SecretName, string>();
  return { get: name => values.get(name) ?? null, set: (name, value) => { values.set(name, value); }, delete: name => { values.delete(name); }, has: name => values.has(name), clear: () => values.clear() };
}

type Env = { store: VentureTestStore; deps: VentureDeps; calculator: CalculatorService; country: CountryProfile };

async function setup(code: 'IN' | 'US' | 'GB' | 'JP' = 'IN', storage: VentureStorage = 'experimental-file'): Promise<Env> {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store);
  const calculator = new CalculatorService(store);
  const trust = new TrustService(store);
  const profile = country(code);
  const draft = structuredClone(starterPacks.find(p => p.pack === 'services')!);
  draft.currency = profile.currency;
  draft.gstMode = 'unregistered';
  for (const definition of draft.definitions) definition.currency = profile.currency;
  await ontology.publish(owner, draft);
  const deps: VentureDeps = {
    store, clock, models: refusingModels, services: { calculator, ontology, trust },
    github: { kind: 'fixture', async read() { throw new Error('The money package never reads GitHub.'); } },
    secrets: shelf(), host: 'test', demo: true, storage,
  };
  await ventureAction(deps, owner, 'admin', 'seed.venture', tx => {
    const idea = 'Monthly bookkeeping for cafes in Pune';
    const venture: VentureRecord = {
      ...tx.base('venture-record'), idea, ideaDigest: digest(idea), workingName: 'Ledger Cafe Books', country: profile,
      serviceType: 'bookkeeping', status: 'blueprint', launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null,
      playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
    };
    tx.put(venture);
  }, { create: true });
  return { store, deps, calculator, country: profile };
}

async function call<M extends VentureMethod>(env: Env, method: M, payload: unknown, ctx: Context = owner): Promise<VentureResults[M]> {
  const handler = handlers[method] as unknown as VentureHandler<M> | undefined;
  assert.ok(handler, `No money handler for ${method}`);
  return handler(env.deps, ctx, payload);
}

type BlueprintOptions = {
  status?: 'draft' | 'accepted';
  price?: string | null;
  pricingModel?: PricingModel;
  registered?: boolean;
  rateBps?: string;
  rateBy?: BackOffice['taxRateBy'];
  taxId?: string | null;
  taxState?: string | null;
  sacCode?: string | null;
  lutConfirmed?: boolean;
  offerName?: string;
};

const UNIT_OF: Record<PricingModel, Offer['pricing']['quantityUnit']> = { monthly: 'month', project: 'project', hourly: 'hour' };

function offer(id: string, name: string, model: PricingModel, price: string | null): Offer {
  return {
    id, name: { value: name, label: 'assumption', by: 'template' },
    description: { value: 'Words from a template.', label: 'assumption', by: 'template' },
    pricing: { model, quantityUnit: UNIT_OF[model], unitPriceMinor: price, unitPriceLabel: price === null ? 'not-set' : 'told-by-you', defaultQuantity: '1' },
  };
}

/** A full BlueprintRecord literal, as P1 would write it; the digest leaves out id, at, digest and status. */
function blueprintLiteral(base: RecordBase<'venture-blueprint'>, profile: CountryProfile, version: number, o: BlueprintOptions): BlueprintRecord {
  const registered = o.registered ?? false;
  const taxId = o.taxId ?? null, taxState = o.taxState ?? null, sacCode = o.sacCode ?? null;
  const missing: string[] = [];
  if (registered && profile.tax.invoiceKind === 'tax-invoice') {
    if (profile.code === 'IN') {
      if (taxId === null) missing.push('Your GSTIN');
      if (taxState === null) missing.push('Your state');
      if (sacCode === null) missing.push('Your SAC code');
    } else if (taxId === null) missing.push(`Your ${profile.tax.idLabel}`);
  }
  const backOffice: BackOffice = {
    currency: profile.currency, taxMode: profile.tax.mode, taxLabel: profile.tax.label,
    taxRegistered: { value: registered, label: 'told-by-you', by: 'owner' },
    taxRateBps: registered ? (o.rateBps ?? profile.tax.standardRateBps) : '0',
    taxRateBy: o.rateBy ?? (registered ? 'country-table' : 'not-registered'),
    taxId, taxState, sacCode, lutConfirmed: o.lutConfirmed ?? false, invoiceKind: profile.tax.invoiceKind,
    taxInvoiceReady: registered && profile.tax.invoiceKind === 'tax-invoice' && missing.length === 0,
    taxInvoiceMissing: missing, paymentRail: profile.paymentRails[0], invoicePrefix: 'INV',
  };
  const record: BlueprintRecord = {
    ...base, version, status: o.status ?? 'draft', source: 'template', structureHash: 'synthetic-structure', digest: '', modelCallIds: [],
    serviceType: 'bookkeeping',
    name: { value: 'Ledger Cafe Books', label: 'assumption', by: 'template' },
    oneLiner: { value: 'Monthly books for cafes.', label: 'assumption', by: 'template' },
    customer: { value: 'Cafe owners', label: 'assumption', by: 'template' },
    offers: [offer('offer_1', o.offerName ?? 'Monthly books', o.pricingModel ?? 'monthly', o.price === undefined ? '249900' : o.price), offer('offer_2', 'Year end clean up', 'project', null)],
    deliverySteps: STEP_PLAN.map(step => ({ id: step.id, title: { value: 'A step in words', label: 'assumption', by: 'template' }, doneBy: step.doneBy, capability: step.capability, note: step.note })),
    approvals: [{ value: 'Each reply before it goes out', label: 'assumption', by: 'template' }, { value: 'Each invoice', label: 'assumption', by: 'template' }],
    backOffice, starterConnectorIds: [],
  };
  const { id: _id, at: _at, digest: _digest, status: _status, ...body } = record;
  record.digest = digest(body);
  return record;
}

async function seedBlueprint(env: Env, options: BlueprintOptions = {}): Promise<BlueprintRecord> {
  return ventureAction(env.deps, owner, 'admin', 'seed.blueprint', tx => {
    const versions = tx.list('venture-blueprint').map(b => b.version);
    const record = blueprintLiteral(tx.base('venture-blueprint'), tx.venture!.country, Math.max(0, ...versions) + 1, options);
    const stored = tx.put(record);
    tx.touch(stored.status === 'accepted' ? { blueprintId: stored.id, acceptedBlueprintId: stored.id } : { blueprintId: stored.id });
    return stored;
  });
}

async function acceptBlueprint(env: Env, id: string) {
  await ventureAction(env.deps, owner, 'admin', 'seed.accept', tx => {
    const blueprint = tx.find('venture-blueprint', id)!;
    tx.replace({ ...blueprint, status: 'accepted' });
    tx.touch({ acceptedBlueprintId: id });
  });
}

async function seedTerms(env: Env) {
  await ventureAction(env.deps, owner, 'admin', 'seed.terms', tx => {
    for (const key of ['client', 'offer', 'order', 'deliverable', 'invoice', 'payment'] as const) {
      const term: TermRecord = { ...tx.base('venture-term'), key, name: key, meaning: 'A plain meaning.', lifecycle: 'proposed', evidence: [] };
      tx.put(term);
    }
  });
}

const INDIA_READY: BlueprintOptions = { status: 'accepted', registered: true, rateBps: '1800', taxId: GSTIN_27, taxState: '27', sacCode: '998222' };

async function orderFor(env: Env, client: Record<string, unknown>, order: Record<string, unknown> = {}) {
  const added = await call(env, 'venture.client.add', client);
  const created = await call(env, 'venture.order.create', { clientId: added.id, offerId: 'offer_1', request: 'Please close my September books.', ...order });
  return { client: added, order: created };
}

function figure(receipt: { figures: { key: string; minor: string; label: string; display: string }[] }, key: string) {
  const found = receipt.figures.find(f => f.key === key);
  assert.ok(found, `figure ${key} missing`);
  return found;
}

// ---------------------------------------------------------------------------
// 1. The arithmetic
// ---------------------------------------------------------------------------

test('computePrice matches every hand-worked example, both rounding outcomes included', () => {
  const inr = (taxTreatment: any, extra: Record<string, string> = {}) => computePrice({ unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxRateBps: '1800', currency: 'INR', taxTreatment, ...extra });
  // INR 2,499.00, GST 1800 bps single: 249900 x 1800 = 449,820,000; (449,820,000 + 5,000) / 10,000 = 44982; total 249900 + 44982 = 294882.
  const single = inr('single');
  assert.deepEqual([single.amounts.subtotal, single.amounts.discount, single.amounts.taxable, single.amounts.tax, single.amounts.total], ['249900', '0', '249900', '44982', '294882']);
  assert.equal(single.amounts.cgst, null);
  assert.deepEqual(single.steps.map(s => s.op), ['multiply', 'discount', 'discount', 'tax', 'add']);
  assert.equal(single.steps[0].rule, 'unit price times quantity');
  assert.equal(single.steps[3].rule, 'tax in basis points, rounded half up to the minor unit');
  // cgst-sgst: each (449,820,000 + 10,000) / 20,000 = 22491 (22,491.5 truncated); tax 44982; total 294882.
  const split = inr('cgst-sgst');
  assert.deepEqual([split.amounts.cgst, split.amounts.sgst, split.amounts.tax, split.amounts.total], ['22491', '22491', '44982', '294882']);
  assert.ok(split.steps.some(s => s.op === 'tax-split' && s.rule.startsWith('CGST and SGST each at half the rate')));
  // igst: 44982, total 294882. zero-rated-lut: tax 0, total 249900.
  const igst = inr('igst');
  assert.deepEqual([igst.amounts.igst, igst.amounts.tax, igst.amounts.total], ['44982', '44982', '294882']);
  const lut = inr('zero-rated-lut');
  assert.deepEqual([lut.amounts.tax, lut.amounts.total], ['0', '249900']);
  assert.ok(lut.steps.some(s => s.rule === 'export of services under LUT, zero-rated'));

  // Unit 105 at 1800 bps. single: (189,000 + 5,000) / 10,000 = 19, total 124.
  const small = (taxTreatment: any) => computePrice({ unitPriceMinor: '105', quantity: '1', discountBps: '0', taxRateBps: '1800', currency: 'INR', taxTreatment });
  assert.deepEqual([small('single').amounts.tax, small('single').amounts.total], ['19', '124']);
  // cgst-sgst: each (189,000 + 10,000) / 20,000 = 9 (9.95 truncated, exact 9.45 half up is 9), tax 18, total 123.
  assert.deepEqual([small('cgst-sgst').amounts.cgst, small('cgst-sgst').amounts.sgst, small('cgst-sgst').amounts.tax, small('cgst-sgst').amounts.total], ['9', '9', '18', '123']);

  // USD 33.33 x 3 hours at 825 bps: subtotal 9999; 9999 x 825 = 8,249,175; (8,249,175 + 5,000) / 10,000 = 825; total 10824.
  const usd = computePrice({ unitPriceMinor: '3333', quantity: '3', discountBps: '0', taxRateBps: '825', currency: 'USD', taxTreatment: 'single' });
  assert.deepEqual([usd.amounts.subtotal, usd.amounts.tax, usd.amounts.total], ['9999', '825', '10824']);
  // JPY 5000 x 2 at 1000 bps: subtotal 10000; (10,000,000 + 5,000) / 10,000 = 1000; total 11000.
  const jpy = computePrice({ unitPriceMinor: '5000', quantity: '2', discountBps: '0', taxRateBps: '1000', currency: 'JPY', taxTreatment: 'single' });
  assert.deepEqual([jpy.amounts.subtotal, jpy.amounts.tax, jpy.amounts.total], ['10000', '1000', '11000']);
  // Tie: 1 x 1 at 5000 bps: (5,000 + 5,000) / 10,000 = 1; total 2.
  const tie = computePrice({ unitPriceMinor: '1', quantity: '1', discountBps: '0', taxRateBps: '5000', currency: 'INR', taxTreatment: 'single' });
  assert.deepEqual([tie.amounts.tax, tie.amounts.total], ['1', '2']);
  // Discount: 100000 x 2 = 200000; discount (200,000 x 1000 + 5,000) / 10,000 = 20000; taxable 180000;
  // tax (180,000 x 1800 + 5,000) / 10,000 = 32400; total 212400.
  const discounted = computePrice({ unitPriceMinor: '100000', quantity: '2', discountBps: '1000', taxRateBps: '1800', currency: 'INR', taxTreatment: 'single' });
  assert.deepEqual([discounted.amounts.subtotal, discounted.amounts.discount, discounted.amounts.taxable, discounted.amounts.tax, discounted.amounts.total], ['200000', '20000', '180000', '32400', '212400']);
  // None: no tax at a zero rate.
  const none = computePrice({ unitPriceMinor: '15000', quantity: '2', discountBps: '0', taxRateBps: '0', currency: 'USD', taxTreatment: 'none' });
  assert.deepEqual([none.amounts.tax, none.amounts.total], ['0', '30000']);
});

test('computePrice refuses negative, decimal and out-of-range inputs', () => {
  const ok = { unitPriceMinor: '100', quantity: '1', discountBps: '0', taxRateBps: '1800', currency: 'INR', taxTreatment: 'single' as const };
  for (const [patch, expected] of [
    [{ unitPriceMinor: '-1' }, 'INVALID_AMOUNT'], [{ unitPriceMinor: '10.5' }, 'INVALID_AMOUNT'], [{ unitPriceMinor: '007' }, 'INVALID_AMOUNT'], [{ unitPriceMinor: '' }, 'INVALID_AMOUNT'],
    [{ quantity: '0' }, 'INVALID_VENTURE_REQUEST'], [{ quantity: '10001' }, 'INVALID_VENTURE_REQUEST'], [{ quantity: '1.5' }, 'INVALID_VENTURE_REQUEST'], [{ quantity: '-2' }, 'INVALID_VENTURE_REQUEST'],
    [{ discountBps: '10001' }, 'INVALID_VENTURE_REQUEST'], [{ discountBps: '-1' }, 'INVALID_VENTURE_REQUEST'],
    [{ taxRateBps: '10001' }, 'INVALID_TAX_RATE'], [{ taxRateBps: '18.5' }, 'INVALID_TAX_RATE'], [{ taxRateBps: '-1800' }, 'INVALID_TAX_RATE'],
    [{ taxTreatment: 'none' }, 'INVALID_TAX_RATE'], [{ taxTreatment: 'vat' }, 'INVALID_VENTURE_REQUEST'], [{ currency: 'QQQ' }, 'INVALID_CURRENCY'],
  ] as const) assert.throws(() => computePrice({ ...ok, ...patch } as any), code(expected), JSON.stringify(patch));
  // The edges are allowed: quantity 10000, 10000 bps.
  assert.equal(computePrice({ ...ok, quantity: '10000', taxRateBps: '10000' }).amounts.total, '2000000'); // 100 x 10000 = 1,000,000; tax 1,000,000; total 2,000,000
});

// ---------------------------------------------------------------------------
// 2. Quotes and receipts
// ---------------------------------------------------------------------------

test('a quote prices the latest draft, stays current after acceptance and goes stale after a new price', async () => {
  const env = await setup('IN');
  await assert.rejects(call(env, 'venture.price.quote', { offerId: 'offer_1' }), code('BLUEPRINT_NOT_FOUND'));
  const draft = await seedBlueprint(env, { registered: true, rateBps: '1800' });
  const receipt = await call(env, 'venture.price.quote', { offerId: 'offer_1' });
  assert.deepEqual(receipt.subject, { type: 'offer', offerId: 'offer_1' });
  assert.equal(receipt.inputs.blueprintDigest, draft.digest);
  assert.equal(receipt.inputs.taxTreatment, 'single');
  assert.equal(receipt.inputs.unitPriceBy, 'told-by-you');
  assert.equal(receipt.inputs.taxRateBy, 'country-table');
  assert.equal(receipt.minorDigits, 2);
  // 249900 at 18 percent: tax 44982, total 294882 (INR 2,948.82).
  assert.equal(figure(receipt, 'subtotal').minor, '249900');
  assert.equal(figure(receipt, 'tax').minor, '44982');
  assert.equal(figure(receipt, 'tax').label, 'GST at 18%');
  assert.equal(figure(receipt, 'total').minor, '294882');
  assert.equal(figure(receipt, 'total').display, 'INR 2,948.82');
  assert.equal(figure(receipt, 'unit').label, 'Price per month');
  assert.equal(receipt.totalMinor, '294882');
  assert.equal(receipt.explanation, '1 x month at INR 2,499.00, plus GST at 18% (INR 449.82) = INR 2,948.82.');
  assert.deepEqual(numberGuard(receipt.explanation, receipt), { accepted: true, checkedNumbers: 5 });
  assert.ok(receipt.allowedNumbers.includes('2948.82') && receipt.allowedNumbers.includes('294882') && receipt.allowedNumbers.includes('18'));
  assert.ok(receipt.allowedNumbers.every(n => /^\d+(\.\d+)?$/.test(n)), 'plain numbers only');
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);
  assert.equal(receipt.stale, false);
  const events = listRecords(env.store.read(), 'venture-event');
  assert.equal(events.at(-1)?.name, 'price-quoted');

  // Accepting the same version keeps its digest, so the receipt stays current.
  await acceptBlueprint(env, draft.id);
  assert.equal((await call(env, 'venture.receipt.get', { id: receipt.id })).stale, false);

  await assert.rejects(call(env, 'venture.price.quote', { offerId: 'offer_2' }), (e: any) => e.code === 'PRICE_REQUIRED' && e.message === 'Set your price for Year end clean up first.');
  await assert.rejects(call(env, 'venture.price.quote', { offerId: 'offer_9' }), code('OFFER_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.price.quote', { offerId: 'offer_1', quantity: '0' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.price.quote', { offerId: 'offer_1', extra: true }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.receipt.get', { id: 'price_missing' }), code('RECEIPT_NOT_FOUND'));

  // Quantity 3: 249900 x 3 = 749700; tax (749,700 x 1800 + 5,000) / 10,000 = 134946; total 884646.
  const three = await call(env, 'venture.price.quote', { offerId: 'offer_1', quantity: '3' });
  assert.equal(three.totalMinor, '884646');
  assert.equal(three.explanation, '3 x month at INR 2,499.00, plus GST at 18% (INR 1,349.46) = INR 8,846.46.');
  numberGuard(three.explanation, three);

  // A newer version with a different price makes the old receipt stale.
  const newer = await seedBlueprint(env, { registered: true, rateBps: '1800', price: '299900' });
  assert.notEqual(newer.digest, draft.digest);
  assert.equal((await call(env, 'venture.receipt.get', { id: receipt.id })).stale, true);
  const fresh = await call(env, 'venture.price.quote', { offerId: 'offer_1' });
  assert.equal(fresh.inputs.blueprintDigest, newer.digest);
  assert.equal((await call(env, 'venture.receipt.get', { id: fresh.id })).stale, false);
});

test('numberGuard passes on the explanation of all five tax treatments', async () => {
  const env = await setup('IN');
  await seedBlueprint(env, { ...INDIA_READY, lutConfirmed: true });
  const quote = await call(env, 'venture.price.quote', { offerId: 'offer_1' });
  const same = await orderFor(env, { name: 'Cafe Aroma Demo', countryCode: 'IN', stateCode: '27' });
  const other = await orderFor(env, { name: 'Bengaluru Bakes', countryCode: 'IN', stateCode: '29' });
  const abroad = await orderFor(env, { name: 'Brooklyn Beans', countryCode: 'US' });
  const noState = await orderFor(env, { name: 'Corner Shop' });
  const receipt = (id: string) => call(env, 'venture.receipt.get', { id }) as Promise<PriceReceiptRecord>;
  const cgst = await receipt(same.order.priceReceiptId);
  const igst = await receipt(other.order.priceReceiptId);
  const lut = await receipt(abroad.order.priceReceiptId);
  const assumed = await receipt(noState.order.priceReceiptId);
  assert.equal(cgst.inputs.taxTreatment, 'cgst-sgst');
  assert.equal(cgst.explanation, '1 x month at INR 2,499.00, plus CGST at 9% (INR 224.91) and SGST at 9% (INR 224.91) = INR 2,948.82.');
  assert.deepEqual(['cgst', 'sgst', 'tax'].map(key => [figure(cgst, key).label, figure(cgst, key).minor]), [['CGST at 9%', '22491'], ['SGST at 9%', '22491'], ['GST total', '44982']]);
  assert.equal(igst.inputs.taxTreatment, 'igst');
  assert.equal(igst.explanation, '1 x month at INR 2,499.00, plus IGST at 18% (INR 449.82) = INR 2,948.82.');
  assert.equal(figure(igst, 'igst').label, 'IGST at 18%');
  assert.equal(lut.inputs.taxTreatment, 'zero-rated-lut');
  assert.equal(lut.explanation, '1 x month at INR 2,499.00, zero-rated as an export of services under LUT = INR 2,499.00.');
  assert.equal(figure(lut, 'tax').label, 'GST, zero-rated export under LUT');
  assert.equal(lut.totalMinor, '249900');
  assert.equal(assumed.inputs.taxTreatment, 'cgst-sgst');
  assert.match(assumed.explanation, / Place of supply taken as your own state\.$/);

  const us = await setup('US');
  await seedBlueprint(us, { price: '15000', pricingModel: 'hourly' });
  const none = await call(us, 'venture.price.quote', { offerId: 'offer_1' });
  assert.equal(none.inputs.taxTreatment, 'none');
  assert.equal(none.inputs.taxRateBps, '0');
  assert.equal(none.inputs.taxRateBy, 'not-registered');
  assert.equal(none.explanation, '1 x hour at USD 150.00 = USD 150.00.');
  assert.equal(figure(none, 'tax').label, 'Tax');
  assert.equal(none.totalMinor, '15000');

  for (const r of [quote, cgst, igst, lut, assumed, none]) assert.equal(numberGuard(r.explanation, r).accepted, true, r.inputs.taxTreatment);
  // An invented number in a sentence is refused against the same receipt.
  assert.throws(() => numberGuard('The total is INR 3,000.00.', quote), code('UNGROUNDED_NUMBER'));
});

// ---------------------------------------------------------------------------
// 3. Tax treatment
// ---------------------------------------------------------------------------

test('taxTreatmentFor follows registration, country, client country and states', () => {
  const office = (o: Partial<BackOffice> & { registered?: boolean } = {}): BackOffice => ({
    currency: 'INR', taxMode: 'gst', taxLabel: 'GST', taxRegistered: { value: o.registered ?? true, label: 'told-by-you', by: 'owner' },
    taxRateBps: o.taxRateBps ?? '1800', taxRateBy: 'country-table', taxId: GSTIN_27, taxState: o.taxState === undefined ? '27' : o.taxState,
    sacCode: '998222', lutConfirmed: o.lutConfirmed ?? false, invoiceKind: 'tax-invoice', taxInvoiceReady: true, taxInvoiceMissing: [], paymentRail: 'razorpay', invoicePrefix: 'INV',
  });
  const client = (countryCode: string | null, stateCode: string | null): ClientRecord => ({
    id: 'client_x', kind: 'venture-client', ventureId: 'venture_x', memberId: 'owner', epoch: 1, at: NOW, name: 'A client', email: null, countryCode, taxId: null, stateCode, note: null,
  });
  assert.equal(taxTreatmentFor(office({ registered: false }), null, 'IN'), 'none');
  assert.equal(taxTreatmentFor(office({ taxRateBps: '0' }), client('IN', '27'), 'IN'), 'none');
  assert.equal(taxTreatmentFor(office(), null, 'GB'), 'single');
  assert.equal(taxTreatmentFor(office(), client('GB', null), country('GB')), 'single');
  assert.equal(taxTreatmentFor(office(), null, 'IN'), 'single');
  assert.equal(taxTreatmentFor(office(), client('IN', '27'), 'IN'), 'cgst-sgst');
  assert.equal(taxTreatmentFor(office(), client(null, null), 'IN'), 'cgst-sgst');
  assert.equal(taxTreatmentFor(office({ taxState: null }), client('IN', '29'), 'IN'), 'cgst-sgst');
  assert.equal(taxTreatmentFor(office(), client('IN', '29'), 'IN'), 'igst');
  assert.equal(taxTreatmentFor(office(), client('US', null), 'IN'), 'igst');
  assert.equal(taxTreatmentFor(office({ lutConfirmed: true }), client('US', null), country('IN')), 'zero-rated-lut');
});

// ---------------------------------------------------------------------------
// 4. Clients and orders
// ---------------------------------------------------------------------------

test('clients are checked: one-line names, GSTIN checksums, states only in India', async () => {
  const env = await setup('IN');
  await seedTerms(env);
  await assert.rejects(call(env, 'venture.client.add', { name: 'Cafe\nAroma' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.client.add', { name: 'A' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.client.add', { name: 'Cafe Aroma', taxId: '27ZZZZZ9999Z1Z9' }), code('INVALID_TAX_ID'));
  await assert.rejects(call(env, 'venture.client.add', { name: 'Cafe Aroma', email: 'not an email' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.client.add', { name: 'Cafe Aroma', countryCode: 'india' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.client.add', { name: 'Cafe Aroma', stateCode: '99' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.client.add', { name: 'Cafe Aroma', taxId: GSTIN_29, stateCode: '27' }), code('INVALID_TAX_ID'));
  await assert.rejects(call(env, 'venture.client.add', { name: 'Cafe Aroma', phone: '1' }), code('INVALID_VENTURE_REQUEST'));

  const filled = await call(env, 'venture.client.add', { name: '  Bengaluru Bakes  ', email: 'owner@bakes.example', taxId: '29zzzzz 9999z1z4' });
  assert.equal(filled.name, 'Bengaluru Bakes');
  assert.equal(filled.taxId, GSTIN_29);
  assert.equal(filled.stateCode, '29');
  assert.equal(filled.countryCode, null);
  const foreign = await call(env, 'venture.client.add', { name: 'Brooklyn Beans', countryCode: 'US', taxId: 'EIN-12-3456789' });
  assert.equal(foreign.taxId, 'EIN-12-3456789');
  await assert.rejects(call(env, 'venture.client.add', { name: 'Brooklyn Beans', countryCode: 'US', stateCode: '27' }), code('INVALID_VENTURE_REQUEST'));
  const list = await call(env, 'venture.client.list', {});
  assert.deepEqual(list.map(c => c.id), [foreign.id, filled.id]);
  const term = listRecords(env.store.read(), 'venture-term').find(t => t.key === 'client')!;
  assert.equal(term.lifecycle, 'active');
  assert.equal(term.evidence[0].recordId, filled.id);

  const us = await setup('US');
  await assert.rejects(call(us, 'venture.client.add', { name: 'Brooklyn Beans', stateCode: '27' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(us, 'venture.client.add', { name: 'Brooklyn Beans', taxId: 'x' }), code('INVALID_TAX_ID'));
  // A client in India on a US business is still checked as a GSTIN.
  await assert.rejects(call(us, 'venture.client.add', { name: 'Pune Cafe', countryCode: 'IN', taxId: 'ABCDE12345' }), code('INVALID_TAX_ID'));
  const indian = await call(us, 'venture.client.add', { name: 'Pune Cafe', countryCode: 'IN', taxId: GSTIN_27 });
  assert.equal(indian.stateCode, null);

  // A viewer may read clients but not add one.
  await env.store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
  assert.equal((await call(env, 'venture.client.list', {}, viewer)).length, 2);
  await assert.rejects(call(env, 'venture.client.add', { name: 'Cafe Aroma' }, viewer), code('FORBIDDEN'));
});

test('orders need the accepted plan and make their own receipt with the client treatment', async () => {
  const env = await setup('IN');
  await seedTerms(env);
  const draft = await seedBlueprint(env, { registered: true, rateBps: '1800', taxState: '27' });
  const client = await call(env, 'venture.client.add', { name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', stateCode: '27' });
  const request = 'Please close my September books. The bank statement and bills are in the shared folder.';
  await assert.rejects(call(env, 'venture.order.create', { clientId: client.id, offerId: 'offer_1', request }), code('BLUEPRINT_NOT_ACCEPTED'));
  await acceptBlueprint(env, draft.id);
  await assert.rejects(call(env, 'venture.order.create', { clientId: 'client_missing', offerId: 'offer_1', request }), code('CLIENT_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.order.create', { clientId: client.id, offerId: 'offer_9', request }), code('OFFER_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.order.create', { clientId: client.id, offerId: 'offer_2', request }), code('PRICE_REQUIRED'));
  await assert.rejects(call(env, 'venture.order.create', { clientId: client.id, offerId: 'offer_1', request: 'ok' }), code('INVALID_VENTURE_REQUEST'));

  const order = await call(env, 'venture.order.create', { clientId: client.id, offerId: 'offer_1', quantity: '1', request });
  assert.equal(order.status, 'open');
  assert.equal(order.request, request);
  assert.equal(order.deliveredOn, null);
  assert.equal(order.saleFactId, null);
  const receipt = await call(env, 'venture.receipt.get', { id: order.priceReceiptId }) as PriceReceiptRecord;
  assert.deepEqual(receipt.subject, { type: 'order', orderId: order.id });
  assert.equal(receipt.inputs.blueprintDigest, draft.digest);
  // Same state 27: CGST 22491 and SGST 22491, total 294882.
  assert.equal(receipt.inputs.taxTreatment, 'cgst-sgst');
  assert.equal(figure(receipt, 'cgst').minor, '22491');
  assert.equal(figure(receipt, 'sgst').minor, '22491');
  assert.equal(receipt.totalMinor, '294882');
  assert.equal(receipt.stale, false);

  // A second order without a quantity uses the offer's default quantity.
  const second = await call(env, 'venture.order.create', { clientId: client.id, offerId: 'offer_1', request });
  assert.equal(second.quantity, '1');
  assert.deepEqual((await call(env, 'venture.order.list', {})).map(o => o.id), [second.id, order.id]);
  assert.equal(listRecords(env.store.read(), 'venture-term').find(t => t.key === 'order')!.lifecycle, 'active');
  const names = listRecords(env.store.read(), 'venture-event').map(e => e.name);
  assert.ok(names.includes('client-added') && names.includes('order-created'));
});

// ---------------------------------------------------------------------------
// 5. Invoices
// ---------------------------------------------------------------------------

test('an India tax invoice: prepare, approve by digest, number, fact and books receipt', async () => {
  const env = await setup('IN');
  await seedTerms(env);
  await seedBlueprint(env, INDIA_READY);
  const { client, order } = await orderFor(env, { name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', stateCode: '27' });
  await assert.rejects(call(env, 'venture.invoice.prepare', { orderId: 'order_missing' }), code('ORDER_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.invoice.prepare', { orderId: order.id, dueInDays: 91 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-02-30' }), code('INVALID_VENTURE_REQUEST'));

  const first = await call(env, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01', dueInDays: 30 });
  const view = await call(env, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01', dueInDays: 15 });
  assert.equal(view.invoice.id, first.invoice.id, 'a second prepare replaces the draft');
  assert.notEqual(view.invoice.digest, first.invoice.digest);
  assert.equal((await call(env, 'venture.invoice.list', {})).length, 1);
  const inv = view.invoice;
  assert.equal(inv.status, 'draft');
  assert.equal(inv.number, null);
  assert.equal(inv.documentTitle, 'TAX INVOICE');
  assert.equal(inv.dueDate, '2026-10-16'); // 1 October plus 15 days
  assert.equal(inv.subtotalMinor, '249900');
  assert.equal(inv.taxMinor, '44982');
  assert.equal(inv.totalMinor, '294882');
  assert.equal(inv.balanceMinor, '294882');
  assert.equal(inv.paidMinor, '0');
  assert.deepEqual(inv.taxLines, [{ label: 'CGST at 9%', rateBps: '900', minor: '22491' }, { label: 'SGST at 9%', rateBps: '900', minor: '22491' }]);
  assert.equal(inv.placeOfSupply, 'Maharashtra (27)');
  assert.equal(inv.supplierTaxId, GSTIN_27);
  assert.equal(inv.clientTaxId, null);
  assert.equal(inv.sacCode, '998222');
  assert.deepEqual(inv.lines, [{ description: 'Monthly books', quantity: '1', unitMinor: '249900', amountMinor: '249900' }]);
  assert.match(inv.digest, /^[a-f0-9]{64}$/);
  assert.equal(view.receipt.id, inv.priceReceiptId);
  assert.deepEqual(view.receipt.subject, { type: 'invoice', invoiceId: inv.id });
  assert.deepEqual(view.figures.map(f => [f.key, f.label, f.display]), [
    ['subtotal', 'Subtotal', 'INR 2,499.00'], ['cgst', 'CGST at 9%', 'INR 224.91'], ['sgst', 'SGST at 9%', 'INR 224.91'],
    ['total', 'Total', 'INR 2,948.82'], ['paid', 'Paid', 'INR 0.00'], ['balance', 'Balance', 'INR 2,948.82'],
  ]);
  assert.deepEqual(view.notes, [EXPERIMENTAL]);
  assert.ok(view.documentText.startsWith('TAX INVOICE DRAFT\n'));

  await assert.rejects(call(env, 'venture.invoice.issue', { invoiceId: inv.id, digest: first.invoice.digest }), code('APPROVAL_STALE'));
  await assert.rejects(call(env, 'venture.invoice.issue', { invoiceId: inv.id, digest: inv.digest }, { ...owner, channel: 'phone' }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.invoice.issue', { invoiceId: inv.id, digest: inv.digest }, { ...owner, sourceTainted: true }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.invoice.issue', { invoiceId: 'invoice_missing', digest: inv.digest }), code('INVOICE_NOT_FOUND'));
  const issued = await call(env, 'venture.invoice.issue', { invoiceId: inv.id, digest: inv.digest });
  assert.equal(issued.invoice.number, 'INV-0001');
  assert.equal(issued.invoice.status, 'issued');
  assert.equal(issued.invoice.issuedAt, NOW);
  assert.equal(issued.invoice.factIds.length, 1);
  assert.equal(issued.invoice.booksNote, null);
  assert.equal(issued.documentText, [
    'TAX INVOICE INV-0001',
    'From: Ledger Cafe Books',
    `GSTIN: ${GSTIN_27}`,
    'To: Cafe Aroma Demo',
    'Place of supply: Maharashtra (27)',
    'Issued: 01 Oct 2026    Due: 16 Oct 2026',
    '----------------------------------------',
    'Monthly books  SAC 998222  1 x INR 2,499.00  INR 2,499.00',
    'Subtotal  INR 2,499.00',
    'CGST at 9%  INR 224.91',
    'SGST at 9%  INR 224.91',
    'Total  INR 2,948.82',
    'Paid  INR 0.00',
    'Balance  INR 2,948.82',
    '----------------------------------------',
    `Every number on this invoice has a receipt in Chausar: ${inv.priceReceiptId}`,
    'Practice invoice from an experimental Chausar build.',
  ].join('\n'));

  // The invoice fact carries the fields of the build spec: billed counts the amount before tax.
  const state = env.store.read();
  const fact = state.facts.find(f => f.id === issued.invoice.factIds[0])!;
  assert.equal(fact.kind, 'invoice');
  assert.equal(fact.entityId, inv.id);
  assert.equal(fact.sourceId, 'chausar-books');
  assert.equal(fact.sourceRow, 1);
  assert.equal(fact.validFrom, '2026-10-01');
  assert.equal(fact.learnedAt, NOW);
  assert.deepEqual(fact.fields, {
    amountMinor: '249900', taxMinor: '44982', currency: 'INR', customerId: client.id, customerName: 'Cafe Aroma Demo',
    invoiceId: inv.id, orderId: order.id, dueDate: '2026-10-16', status: 'unpaid', description: 'Monthly books',
  });
  // The books receipt for that day and order is the calculator's own and opens with calculator.receipt.
  assert.ok(issued.invoice.booksReceiptId);
  const books = env.calculator.receipt(owner, issued.invoice.booksReceiptId!);
  assert.equal(books.operation, 'billed');
  assert.equal(books.totalMinor, '249900');
  assert.equal(listRecords(state, 'venture-order').find(o => o.id === order.id)!.status, 'invoiced');
  assert.equal(listRecords(state, 'venture-record')[0].invoiceSequence, 1);
  assert.equal(listRecords(state, 'venture-term').find(t => t.key === 'invoice')!.lifecycle, 'active');
  assert.ok(state.activity.some((a: any) => a.event === 'venture.invoice.issue'));

  await assert.rejects(call(env, 'venture.invoice.issue', { invoiceId: inv.id, digest: inv.digest }), code('INVOICE_NOT_DRAFT'));
  await assert.rejects(call(env, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-02' }), code('INVOICE_NOT_DRAFT'));
  const got = await call(env, 'venture.invoice.get', { invoiceId: inv.id });
  assert.equal(got.documentText, issued.documentText);
  await assert.rejects(call(env, 'venture.invoice.get', { invoiceId: 'invoice_missing' }), code('INVOICE_NOT_FOUND'));

  // A second order gets the next number.
  const next = await orderFor(env, { name: 'Bengaluru Bakes', taxId: GSTIN_29 });
  const draft2 = await call(env, 'venture.invoice.prepare', { orderId: next.order.id, issueDate: '2026-10-03' });
  assert.equal(draft2.invoice.dueDate, '2026-10-18'); // default 15 days
  assert.equal(draft2.invoice.taxTreatment, 'igst');
  assert.deepEqual(draft2.invoice.taxLines, [{ label: 'IGST at 18%', rateBps: '1800', minor: '44982' }]);
  assert.equal(draft2.invoice.placeOfSupply, 'Karnataka (29)');
  assert.equal(draft2.invoice.clientTaxId, GSTIN_29);
  assert.match(draft2.documentText, new RegExp(`\\nGSTIN: ${GSTIN_29}\\n`));
  const issued2 = await call(env, 'venture.invoice.issue', { invoiceId: draft2.invoice.id, digest: draft2.invoice.digest });
  assert.equal(issued2.invoice.number, 'INV-0002');
  assert.equal(env.store.read().facts.find(f => f.id === issued2.invoice.factIds[0])!.sourceRow, 2);
  assert.deepEqual((await call(env, 'venture.invoice.list', {})).map(i => i.number), ['INV-0002', 'INV-0001']);
});

test('invoice titles follow the owner settings and the experimental notice follows the storage', async () => {
  // India, registered, no SAC code: not a tax invoice, and the notes say what to add.
  const india = await setup('IN');
  await seedBlueprint(india, { ...INDIA_READY, sacCode: null });
  const { order } = await orderFor(india, { name: 'Cafe Aroma Demo', countryCode: 'IN', stateCode: '27' });
  const view = await call(india, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01' });
  assert.equal(view.invoice.documentTitle, 'INVOICE (not a tax invoice)');
  assert.equal(view.invoice.sacCode, null);
  assert.deepEqual(view.notes, ['To make this a tax invoice, add: Your SAC code.', EXPERIMENTAL]);
  assert.ok(view.documentText.startsWith('INVOICE (not a tax invoice) DRAFT\nFrom: Ledger Cafe Books\n'));
  assert.match(view.documentText, /\nMonthly books  1 x INR 2,499\.00  INR 2,499\.00\n/);

  // India, an export with an LUT: one zero-rated line and the export place of supply.
  const lut = await setup('IN');
  await seedBlueprint(lut, { ...INDIA_READY, lutConfirmed: true });
  const abroad = await orderFor(lut, { name: 'Brooklyn Beans', countryCode: 'US' });
  const exportView = await call(lut, 'venture.invoice.prepare', { orderId: abroad.order.id, issueDate: '2026-10-01' });
  assert.equal(exportView.invoice.documentTitle, 'TAX INVOICE');
  assert.equal(exportView.invoice.placeOfSupply, 'Outside India (export of services)');
  assert.deepEqual(exportView.invoice.taxLines, [{ label: 'GST, zero-rated export under LUT', rateBps: '0', minor: '0' }]);
  assert.equal(exportView.invoice.totalMinor, '249900');

  // India, not registered: a plain invoice with no tax lines and no place of supply.
  const unregistered = await setup('IN');
  await seedBlueprint(unregistered, { status: 'accepted' });
  const plain = await orderFor(unregistered, { name: 'Cafe Aroma Demo', stateCode: '27' });
  const plainView = await call(unregistered, 'venture.invoice.prepare', { orderId: plain.order.id, issueDate: '2026-10-01' });
  assert.equal(plainView.invoice.documentTitle, 'INVOICE');
  assert.deepEqual(plainView.invoice.taxLines, []);
  assert.equal(plainView.invoice.placeOfSupply, null);
  assert.equal(plainView.invoice.supplierTaxId, null);

  // United States, no tax, on durable storage: INVOICE, US dates, and no experimental line.
  const us = await setup('US', 'postgres');
  await seedBlueprint(us, { status: 'accepted', price: '15000', pricingModel: 'hourly' });
  const usOrder = await orderFor(us, { name: 'Brooklyn Beans' }, { quantity: '2' });
  const usView = await call(us, 'venture.invoice.prepare', { orderId: usOrder.order.id, issueDate: '2026-10-01', dueInDays: 0 });
  assert.equal(usView.invoice.documentTitle, 'INVOICE');
  assert.deepEqual(usView.invoice.taxLines, []);
  assert.equal(usView.invoice.totalMinor, '30000'); // 15000 x 2, no tax
  assert.equal(usView.invoice.placeOfSupply, null);
  assert.equal(usView.invoice.sacCode, null);
  assert.deepEqual(usView.notes, []);
  assert.ok(!usView.documentText.includes('experimental'));
  assert.match(usView.documentText, /\nIssued: Oct 01, 2026    Due: Oct 01, 2026\n/);
  assert.match(usView.documentText, /\nMonthly books  2 x USD 150\.00  USD 300\.00\n/);

  // United Kingdom, registered for VAT without a VAT number: not a tax invoice, and the notes name the number.
  const gb = await setup('GB');
  await seedBlueprint(gb, { status: 'accepted', registered: true, rateBps: '2000', price: '50000' });
  const gbOrder = await orderFor(gb, { name: 'Leeds Lattes' });
  const gbView = await call(gb, 'venture.invoice.prepare', { orderId: gbOrder.order.id, issueDate: '2026-10-01' });
  assert.equal(gbView.invoice.documentTitle, 'INVOICE (not a tax invoice)');
  assert.equal(gbView.invoice.taxTreatment, 'single');
  // 50000 at 2000 bps: (100,000,000 + 5,000) / 10,000 = 10000; total 60000.
  assert.deepEqual(gbView.invoice.taxLines, [{ label: 'VAT at 20%', rateBps: '2000', minor: '10000' }]);
  assert.equal(gbView.notes[0], 'To make this a tax invoice, add: Your VAT number.');
  assert.equal(gbView.invoice.totalMinor, '60000');
});

// ---------------------------------------------------------------------------
// 6. Payments
// ---------------------------------------------------------------------------

async function issuedIndiaInvoice(env: Env) {
  await seedBlueprint(env, INDIA_READY);
  const { order } = await orderFor(env, { name: 'Cafe Aroma Demo', countryCode: 'IN', stateCode: '27' });
  const draft = await call(env, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01' });
  const issued = await call(env, 'venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  return { order, invoice: issued.invoice };
}

test('payments: part then the rest, overpaying refuses, and the received receipt matches', async () => {
  const env = await setup('IN');
  await seedTerms(env);
  await seedBlueprint(env, INDIA_READY);
  const { order } = await orderFor(env, { name: 'Cafe Aroma Demo', countryCode: 'IN', stateCode: '27' });
  const draft = await call(env, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01' });
  const pay = (amount: string, receivedOn: string, ctx: Context = owner, method = 'upi') =>
    call(env, 'venture.payment.record', { invoiceId: draft.invoice.id, amount, receivedOn, method }, ctx);
  await assert.rejects(pay('100', '2026-10-05'), code('INVALID_VENTURE_REQUEST')); // still a draft
  const issued = await call(env, 'venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });

  await assert.rejects(pay('100', '2026-10-05', { ...owner, channel: 'mcp' }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(pay('100', '2026-10-05', owner, 'cheque'), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(pay('0', '2026-10-05'), code('INVALID_AMOUNT'));
  await assert.rejects(pay('10.505', '2026-10-05'), code('INVALID_AMOUNT'));
  await assert.rejects(pay('-5', '2026-10-05'), code('INVALID_AMOUNT'));
  await assert.rejects(pay('2948.83', '2026-10-05'), code('PAYMENT_TOO_LARGE')); // one paisa above 294882

  // INR 1,000.00 first: paid 100000, balance 294882 - 100000 = 194882.
  const part = await pay('1,000', '2026-10-05');
  assert.equal(part.invoice.status, 'part-paid');
  assert.equal(part.invoice.paidMinor, '100000');
  assert.equal(part.invoice.balanceMinor, '194882');
  assert.equal(part.payments.length, 1);
  assert.equal(part.payments[0].amountMinor, '100000');
  assert.equal(part.payments[0].booksNote, null);
  assert.equal(env.calculator.receipt(owner, part.payments[0].booksReceiptId!).totalMinor, '100000');
  await assert.rejects(pay('1948.83', '2026-10-06'), code('PAYMENT_TOO_LARGE'));
  // The rest, INR 1,948.82 = 194882: paid 294882, balance 0.
  const rest = await pay('1948.82', '2026-10-06');
  assert.equal(rest.invoice.status, 'paid');
  assert.equal(rest.invoice.paidMinor, '294882');
  assert.equal(rest.invoice.balanceMinor, '0');
  assert.match(rest.documentText, /\nPaid  INR 2,948\.82\nBalance  INR 0\.00\n/);
  await assert.rejects(pay('1', '2026-10-07'), code('PAYMENT_TOO_LARGE'));

  const state = env.store.read();
  const paymentFacts = state.facts.filter(f => f.kind === 'payment');
  assert.equal(paymentFacts.length, 2);
  assert.deepEqual(paymentFacts[1].fields, {
    amountMinor: '194882', currency: 'INR', customerId: issued.invoice.clientId, invoiceId: issued.invoice.id, orderId: order.id, status: 'settled', paymentMethod: 'upi',
  });
  assert.deepEqual(paymentFacts.map(f => [f.sourceRow, f.validFrom]), [[2, '2026-10-05'], [3, '2026-10-06']]);
  assert.equal(listRecords(state, 'venture-term').find(t => t.key === 'payment')!.lifecycle, 'active');

  // One full payment of INR 2,948.82: the received receipt is 294882.
  const full = await setup('IN');
  const one = await issuedIndiaInvoice(full);
  const paid = await call(full, 'venture.payment.record', { invoiceId: one.invoice.id, amount: '2948.82', receivedOn: '2026-10-05', method: 'bank-transfer' });
  assert.equal(paid.invoice.status, 'paid');
  const received = full.calculator.receipt(owner, paid.payments[0].booksReceiptId!);
  assert.equal(received.operation, 'received');
  assert.equal(received.totalMinor, '294882');
});

test('two part payments on one day for one order leave the second without a books receipt', async () => {
  const env = await setup('IN');
  const { invoice } = await issuedIndiaInvoice(env);
  const pay = (amount: string) => call(env, 'venture.payment.record', { invoiceId: invoice.id, amount, receivedOn: '2026-10-05', method: 'cash' });
  const first = await pay('1000');
  assert.ok(first.payments[0].booksReceiptId);
  // Same day, same order: the received receipt sums 100000 + 50000 = 150000, more than this payment of 50000.
  const second = await pay('500');
  const [a, b] = second.payments;
  assert.ok(a.booksReceiptId);
  assert.equal(b.booksReceiptId, null);
  assert.equal(b.booksNote, 'The books receipt covers more than this payment.');
  assert.deepEqual(second.notes, ['The books receipt covers more than this payment.', EXPERIMENTAL]);
});

// ---------------------------------------------------------------------------
// 7. Delivery and the books
// ---------------------------------------------------------------------------

test('delivery writes a sale fact and the books summary proves billed, received and earned', async () => {
  const env = await setup('IN');
  await seedTerms(env);
  await seedBlueprint(env, INDIA_READY);
  const { client, order } = await orderFor(env, { name: 'Cafe Aroma Demo', countryCode: 'IN', stateCode: '27' });
  await assert.rejects(call(env, 'venture.order.deliver', { orderId: order.id, deliveredOn: '2026-13-01' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.order.deliver', { orderId: 'order_missing', deliveredOn: '2026-10-04' }), code('ORDER_NOT_FOUND'));
  const delivered = await call(env, 'venture.order.deliver', { orderId: order.id, deliveredOn: '2026-10-04' });
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.deliveredOn, '2026-10-04');
  assert.ok(delivered.saleFactId);
  const sale = env.store.read().facts.find(f => f.id === delivered.saleFactId)!;
  assert.equal(sale.kind, 'sale');
  assert.equal(sale.entityId, order.id);
  assert.equal(sale.validFrom, '2026-10-04');
  assert.deepEqual(sale.fields, { amountMinor: '249900', currency: 'INR', customerId: client.id, orderId: order.id, status: 'delivered', description: 'Monthly books' });
  await assert.rejects(call(env, 'venture.order.deliver', { orderId: order.id, deliveredOn: '2026-10-05' }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(env.store.read(), 'venture-term').find(t => t.key === 'deliverable')!.lifecycle, 'active');

  const draft = await call(env, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01', dueInDays: 15 });
  const issued = await call(env, 'venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  assert.equal(listRecords(env.store.read(), 'venture-order').find(o => o.id === order.id)!.status, 'delivered', 'a delivered order stays delivered');

  const before = await call(env, 'venture.books.summary', { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(before.openInvoices, [{ invoiceId: issued.invoice.id, number: 'INV-0001', clientName: 'Cafe Aroma Demo', balanceMinor: '294882', balanceDisplay: 'INR 2,948.82', dueDate: '2026-10-16' }]);

  await call(env, 'venture.payment.record', { invoiceId: issued.invoice.id, amount: '2948.82', receivedOn: '2026-10-05', method: 'upi' });
  const summary = await call(env, 'venture.books.summary', { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(summary.period, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(summary.currency, 'INR');
  // Billed 249900 (without tax), received 294882 (with tax), earned 249900 (without tax).
  assert.deepEqual(summary.figures.map(f => [f.operation, f.label, f.minor, f.display, f.stale]), [
    ['billed', 'Billed (without tax)', '249900', 'INR 2,499.00', false],
    ['received', 'Received (with tax)', '294882', 'INR 2,948.82', false],
    ['earned', 'Earned (without tax)', '249900', 'INR 2,499.00', false],
  ]);
  for (const f of summary.figures) {
    const receipt = env.calculator.receipt(owner, f.receiptId);
    assert.equal(receipt.operation, f.operation);
    assert.equal(receipt.totalMinor, f.minor);
  }
  assert.deepEqual(summary.openInvoices, []);
  assert.deepEqual(summary.notes, [
    'Billed and earned leave out tax. Received is the cash that came in, tax included.',
    "The back office's receivable aging compares invoices without tax to cash with tax, so use these invoice balances for taxed invoices.",
    EXPERIMENTAL,
  ]);
  // September holds nothing. The default period is all time: it starts at the first dated entry (the invoice issued
  // on 1 October, before the business was started in Chausar on 15 October) and ends today, so nothing is left out.
  const september = await call(env, 'venture.books.summary', { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(september.figures.map(f => f.minor), ['0', '0', '0']);
  assert.equal(september.periodKey, 'custom');
  const defaults = await call(env, 'venture.books.summary', {});
  assert.deepEqual(defaults.period, { from: '2026-10-01', to: '2026-10-15' });
  assert.equal(defaults.periodKey, 'all');
  assert.deepEqual(defaults.figures.map(f => f.minor), ['249900', '294882', '249900']);
  await assert.rejects(call(env, 'venture.books.summary', { from: '2026-10-31', to: '2026-10-01' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.books.summary', { from: '2026-10-31', extra: 1 }), code('INVALID_VENTURE_REQUEST'));
});

test('books periods: whole calendar months and years, and all time stretches to every dated entry', () => {
  // Today 15 October 2026, started the same day, no entries: all time is that one day.
  assert.deepEqual(booksPeriods('2026-10-15', '2026-10-15', []), [
    { key: 'all', label: 'All time', from: '2026-10-15', to: '2026-10-15' },
    { key: 'this-month', label: 'This month', from: '2026-10-01', to: '2026-10-31' },
    { key: 'last-month', label: 'Last month', from: '2026-09-01', to: '2026-09-30' },
    { key: 'this-year', label: 'This year', from: '2026-01-01', to: '2026-12-31' },
  ]);
  // A back-dated invoice on 20 August and a payment dated 2 November widen all time on both sides.
  assert.deepEqual(booksPeriods('2026-10-15', '2026-10-15', ['2026-08-20', '2026-11-02'])[0], { key: 'all', label: 'All time', from: '2026-08-20', to: '2026-11-02' });
  // Month ends: last month from 31 March is all of February 2026 (28 days); from 10 January it is December 2025.
  assert.deepEqual(booksPeriods('2026-03-31', '2026-03-01', []).find(p => p.key === 'last-month'), { key: 'last-month', label: 'Last month', from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(booksPeriods('2026-01-10', '2026-01-02', []).find(p => p.key === 'last-month'), { key: 'last-month', label: 'Last month', from: '2025-12-01', to: '2025-12-31' });
  // February 2024 had 29 days.
  assert.deepEqual(booksPeriods('2024-02-10', '2024-02-01', []).find(p => p.key === 'this-month'), { key: 'this-month', label: 'This month', from: '2024-02-01', to: '2024-02-29' });
});

test('one day basis: today, the invoice date and the books period are the local day of the owner', async () => {
  const env = await setup('IN');
  await seedTerms(env);
  await seedBlueprint(env, INDIA_READY);
  const { order } = await orderFor(env, { name: 'Cafe Aroma Demo', countryCode: 'IN', stateCode: '27' });
  // 20:00 UTC on 14 October is 01:30 on 15 October in India (UTC+5:30): the owner's day is the 15th.
  env.deps.clock = () => new Date('2026-10-14T20:00:00.000Z');
  const draft = await call(env, 'venture.invoice.prepare', { orderId: order.id });
  assert.equal(draft.invoice.issueDate, '2026-10-15');
  assert.equal(draft.invoice.dueDate, '2026-10-30'); // 15 October plus the default 15 days
  const summary = await call(env, 'venture.books.summary', {});
  assert.equal(summary.today, '2026-10-15');
  assert.equal(summary.timeZone, 'Asia/Kolkata');
  assert.deepEqual(summary.periods?.find(p => p.key === 'this-month'), { key: 'this-month', label: 'This month', from: '2026-10-01', to: '2026-10-31' });

  // 15:30 UTC on 14 October is 00:30 on 15 October in Tokyo (UTC+9); another country (XX) keeps the UTC day.
  assert.equal(localDayAt('2026-10-14T15:30:00.000Z', { code: 'JP' }), '2026-10-15');
  assert.equal(localDayAt('2026-10-14T15:30:00.000Z', { code: 'XX' }), '2026-10-14');
  assert.equal(ventureTimeZone({ code: 'XX' }), 'UTC');
  // 02:00 UTC on 15 October is 22:00 on 14 October in New York (UTC-4 in October): the owner's day is the 14th.
  const us = await setup('US');
  us.deps.clock = () => new Date('2026-10-15T02:00:00.000Z');
  const usSummary = await call(us, 'venture.books.summary', {});
  assert.equal(usSummary.today, '2026-10-14');
  assert.equal(usSummary.timeZone, 'America/New_York');
  // The business was started at 10:00 UTC on 15 October (the 15th in New York); all time still ends today.
  assert.deepEqual(usSummary.period, { from: '2026-10-14', to: '2026-10-14' });
});

test('back-dated invoices and payments show in the period the owner picks that holds them', async () => {
  const env = await setup('IN');
  await seedTerms(env);
  await seedBlueprint(env, INDIA_READY);
  const { order } = await orderFor(env, { name: 'Cafe Aroma Demo', countryCode: 'IN', stateCode: '27' });
  // Issued 20 August and paid 2 September, both before the business was started in Chausar on 15 October.
  const draft = await call(env, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-08-20', dueInDays: 30 });
  const issued = await call(env, 'venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  await call(env, 'venture.payment.record', { invoiceId: issued.invoice.id, amount: '2948.82', receivedOn: '2026-09-02', method: 'upi' });
  // Hand-worked: billed 2,499.00 without tax = 249900; GST 18% of 249900 = 44982; received with tax 249900 + 44982 = 294882.
  const minors = (summary: { figures: { minor: string }[] }) => summary.figures.map(f => f.minor);

  const all = await call(env, 'venture.books.summary', {});
  assert.equal(all.periodKey, 'all');
  assert.deepEqual(all.period, { from: '2026-08-20', to: '2026-10-15' });
  assert.deepEqual(minors(all), ['249900', '294882', '0']); // nothing delivered yet, so nothing earned
  assert.deepEqual(all.periods?.[0], { key: 'all', label: 'All time', from: '2026-08-20', to: '2026-10-15' });

  const lastMonth = await call(env, 'venture.books.summary', { period: 'last-month' });
  assert.equal(lastMonth.periodKey, 'last-month');
  assert.deepEqual(lastMonth.period, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(minors(lastMonth), ['0', '294882', '0']); // the September payment only

  const thisMonth = await call(env, 'venture.books.summary', { period: 'this-month' });
  assert.deepEqual(thisMonth.period, { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(minors(thisMonth), ['0', '0', '0']);

  const year = await call(env, 'venture.books.summary', { period: 'this-year' });
  assert.deepEqual(year.period, { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(minors(year), ['249900', '294882', '0']);

  const august = await call(env, 'venture.books.summary', { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(august.periodKey, 'custom');
  assert.deepEqual(minors(august), ['249900', '0', '0']); // the August invoice only
  // Only one end given: the other comes from all time.
  const sinceSeptember = await call(env, 'venture.books.summary', { from: '2026-09-01' });
  assert.deepEqual(sinceSeptember.period, { from: '2026-09-01', to: '2026-10-15' });

  await assert.rejects(call(env, 'venture.books.summary', { period: 'last-week' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.books.summary', { period: 'this-month', from: '2026-10-01' }), code('INVALID_VENTURE_REQUEST'));
});

// ---------------------------------------------------------------------------
// 8. A zero-digit currency end to end
// ---------------------------------------------------------------------------

test('a JPY venture runs end to end with zero minor digits', async () => {
  const env = await setup('JP', 'postgres');
  await seedBlueprint(env, { status: 'accepted', registered: true, rateBps: '1000', taxId: 'T1234567890123', price: '5000', pricingModel: 'project' });
  const quote = await call(env, 'venture.price.quote', { offerId: 'offer_1', quantity: '2' });
  assert.equal(quote.minorDigits, 0);
  // 5000 x 2 = 10000; tax (10,000 x 1000 + 5,000) / 10,000 = 1000; total 11000.
  assert.equal(quote.explanation, '2 x project at JPY 5,000, plus Consumption tax at 10% (JPY 1,000) = JPY 11,000.');
  assert.equal(numberGuard(quote.explanation, quote).accepted, true);
  assert.equal(figure(quote, 'total').display, 'JPY 11,000');

  const { order } = await orderFor(env, { name: 'Tokyo Tea House', countryCode: 'JP', taxId: 'T9876543210987' }, { quantity: '2' });
  const draft = await call(env, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01', dueInDays: 30 });
  assert.equal(draft.invoice.documentTitle, 'TAX INVOICE');
  assert.equal(draft.invoice.totalMinor, '11000');
  assert.deepEqual(draft.invoice.taxLines, [{ label: 'Consumption tax at 10%', rateBps: '1000', minor: '1000' }]);
  const issued = await call(env, 'venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  assert.equal(issued.documentText, [
    'TAX INVOICE INV-0001',
    'From: Ledger Cafe Books',
    'Registration number: T1234567890123',
    'To: Tokyo Tea House',
    'Registration number: T9876543210987',
    'Issued: 2026-10-01    Due: 2026-10-31',
    '----------------------------------------',
    'Monthly books  2 x JPY 5,000  JPY 10,000',
    'Subtotal  JPY 10,000',
    'Consumption tax at 10%  JPY 1,000',
    'Total  JPY 11,000',
    'Paid  JPY 0',
    'Balance  JPY 11,000',
    '----------------------------------------',
    `Every number on this invoice has a receipt in Chausar: ${issued.invoice.priceReceiptId}`,
  ].join('\n'));
  assert.equal(env.calculator.receipt(owner, issued.invoice.booksReceiptId!).totalMinor, '10000');
  await assert.rejects(call(env, 'venture.payment.record', { invoiceId: issued.invoice.id, amount: '11000.5', receivedOn: '2026-10-05', method: 'card' }), code('INVALID_AMOUNT'));
  const paid = await call(env, 'venture.payment.record', { invoiceId: issued.invoice.id, amount: '11,000', receivedOn: '2026-10-05', method: 'card' });
  assert.equal(paid.invoice.status, 'paid');
  assert.equal(paid.payments[0].amountMinor, '11000');
  await call(env, 'venture.order.deliver', { orderId: order.id, deliveredOn: '2026-10-06' });
  const summary = await call(env, 'venture.books.summary', { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(summary.figures.map(f => [f.minor, f.display]), [['10000', 'JPY 10,000'], ['11000', 'JPY 11,000'], ['10000', 'JPY 10,000']]);
  assert.equal(summary.notes.length, 2, 'no experimental notice on durable storage');
});

// ---------------------------------------------------------------------------
// 9 and 10. Static guards and the handler table
// ---------------------------------------------------------------------------

async function moneySources(): Promise<{ name: string; text: string }[]> {
  const names = (await readdir(MONEY_DIR)).filter(name => name.endsWith('.ts'));
  assert.ok(names.length >= 10);
  return Promise.all(names.map(async name => ({ name, text: await readFile(new URL(name, MONEY_DIR), 'utf8') })));
}

test('no money file uses float helpers on amounts', async () => {
  for (const { name, text } of await moneySources()) {
    for (const banned of ['parseFloat', 'toFixed', 'Number(', 'Math.round']) assert.ok(!text.includes(banned), `${name} contains ${banned}`);
    assert.ok(!text.includes(String.fromCharCode(0x2014)), `${name} contains an em dash`);
  }
});

test('every error code the money package throws is a listed venture code or a known engine code', async () => {
  const passThrough = new Set(['INVALID_CURRENCY', 'FORBIDDEN', 'ACCESS_REVOKED', 'REQUEST_FAILED']);
  const found = new Set<string>();
  for (const { text } of await moneySources()) for (const match of text.matchAll(/,\s*'([A-Z][A-Z_]{2,63})',\s*(?:['"`]|\d+n)/g)) found.add(match[1]);
  assert.ok(found.size >= 15);
  for (const name of found) assert.ok((VENTURE_ERRORS as readonly string[]).includes(name) || passThrough.has(name), `${name} is not listed`);
});

test('handlers cover exactly the eighteen money methods', () => {
  const owned = VENTURE_METHODS.filter(method => METHOD_OWNERS[method] === 'money');
  assert.equal(owned.length, 18);
  assert.deepEqual(Object.keys(handlers).sort(), [...owned].sort());
  for (const method of owned) assert.equal(typeof handlers[method], 'function');
  assert.equal(typeof computePrice, 'function');
  assert.equal(typeof taxTreatmentFor, 'function');
});
