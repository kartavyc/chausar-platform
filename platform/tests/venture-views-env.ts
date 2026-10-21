// Shared setup for the Ink views tests (venture-views-*.test.ts): a venture in India on the test store, real money
// services, a model port stub, a workspace port stub, and literal record seeds in the style of venture-delivery.test.ts.
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { STEP_PLAN } from '../runtime/venture/contracts.ts';
import type {
  BlueprintRecord, ClientRecord, CountryProfile, DeliveryRunRecord, HarnessState, ModelPort, ModelStatusView, OrderRecord, PriceFigure,
  PriceReceiptRecord, SecretName, SecretShelf, VentureBusinessRef, VentureDeps, VentureEventRecord, VentureMethod, VentureRecord,
  VentureWorkspacePort,
} from '../runtime/venture/contracts.ts';
import { digest, ventureAction, type VentureTx } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/views/index.ts';
import { VentureTestStore } from './venture-test-store.ts';

export const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const phone: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' };
export const START = '2026-10-15T10:00:00.000Z';
export const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

export const IN: CountryProfile = {
  code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india',
  tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', registrationNote: 'Check with a CA.', idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15' },
  paymentRails: ['razorpay', 'cashfree', 'paypal'], dateOrder: 'day-month-year', complianceNotes: [],
};

function shelf(): SecretShelf {
  const values = new Map<SecretName, string>();
  return { get: name => values.get(name) ?? null, set: (name, value) => { values.set(name, value); }, delete: name => { values.delete(name); }, has: name => values.has(name), clear: () => values.clear() };
}

/** Templates serve both tiers unless a test connects an AI. Nothing here sends anything. */
export class StubModels implements ModelPort {
  connected = false;
  usable = true;
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => this.connected
      ? { presetId, model: presetId, usable: this.usable, reason: this.usable ? 'Uses your Anthropic key.' : 'Type your Anthropic key again.' }
      : { presetId: 'built-in-templates' as const, model: null, usable: true, reason: 'No AI connected; using built-in templates' };
    return {
      connections: [], tiers: { fast: tier('anthropic-haiku-5-5'), main: tier('anthropic-sonnet-5-5') },
      spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: false, label: null },
    };
  }
  presets(): never { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate(): Promise<never> { throw new ChausarError('NO_MODEL_CONNECTED', 'Not used here.'); }
  async preview(): Promise<null> { return null; }
  async runPreview(): Promise<never> { throw new ChausarError('APPROVAL_STALE', 'Run it again; the approved text is no longer available.'); }
}

/** A workspace port with the open business 'main' and whatever others a test lists. */
export class StubWorkspace implements VentureWorkspacePort {
  others: VentureBusinessRef[] = [];
  keep: 'made' | 'not-made' | 'unknown' | null = 'made';
  current() { return { id: 'main', name: 'Ledgerline' }; }
  async businesses(): Promise<VentureBusinessRef[]> { return [{ id: 'main', name: 'Ledgerline', opens: 'with-this-computer', openedAt: START }, ...this.others]; }
  async recovery() { return this.keep; }
}

export type Env = {
  store: VentureTestStore; deps: VentureDeps; models: StubModels; workspace: StubWorkspace; venture: VentureRecord;
  published: VentureEventRecord[][]; advance(ms: number): void; now(): string;
};

export async function setup(options: { workspace?: boolean } = {}): Promise<Env> {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const draft = structuredClone(starterPacks.find(pack => pack.pack === 'services')!);
  draft.currency = 'INR';
  draft.gstMode = 'unregistered';
  for (const definition of draft.definitions) definition.currency = 'INR';
  await ontology.publish(owner, draft);
  let time = Date.parse(START);
  const models = new StubModels(), workspace = new StubWorkspace();
  const published: VentureEventRecord[][] = [];
  const deps: VentureDeps = {
    store, clock: () => new Date(time), models, services: { calculator, ontology, trust },
    github: { kind: 'fixture', async read() { throw new Error('The views never read GitHub.'); } },
    secrets: shelf(), host: 'test', demo: true, storage: 'experimental-file',
    ...(options.workspace === false ? {} : { workspace }),
    publish: events => { published.push(events); },
  };
  const venture = await ventureAction(deps, owner, 'admin', 'seed.venture', tx => tx.put<VentureRecord>({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes and small shops in Pune.', ideaDigest: 'idea-digest', workingName: 'Ledger Cafe Books',
    country: IN, serviceType: 'bookkeeping', status: 'blueprint', launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  return { store, deps, models, workspace, venture, published, advance: ms => { time += ms; }, now: () => new Date(time).toISOString() };
}

/** Calls one view handler directly, as the host would after its channel check. */
export function call<T>(env: Env, method: VentureMethod, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const handler = (handlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method];
  assert.ok(handler, `no views handler for ${method}`);
  return handler(env.deps, ctx, payload) as Promise<T>;
}

const words = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
const TITLES = ['Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client'];

/** A blueprint version. offer_2 has no price unless a test sets one. */
export function blueprintBody(options: { version?: number; price1?: string | null; price2?: string | null } = {}) {
  return {
    version: options.version ?? 1, source: 'template' as const, structureHash: 'structure-hash', modelCallIds: [], serviceType: 'bookkeeping' as const,
    name: { value: 'Ledger Cafe Books', label: 'told-by-you' as const, by: 'owner' as const },
    oneLiner: words('Monthly books for cafes, drafted with AI help and checked by you.'),
    customer: words('Cafe and small shop owners.'),
    offers: [
      { id: 'offer_1', name: words('Monthly books'), description: words('Bank matching and a short monthly report.'),
        pricing: { model: 'monthly' as const, quantityUnit: 'month' as const, unitPriceMinor: options.price1 === undefined ? '249900' : options.price1, unitPriceLabel: 'told-by-you' as const, defaultQuantity: '1' } },
      { id: 'offer_2', name: words('Catch up clean up'), description: words('A one time tidy up of past months.'),
        pricing: { model: 'project' as const, quantityUnit: 'project' as const, unitPriceMinor: options.price2 ?? null, unitPriceLabel: options.price2 ? 'told-by-you' as const : 'not-set' as const, defaultQuantity: '1' } },
    ],
    deliverySteps: STEP_PLAN.map((plan, index) => ({ id: plan.id, title: words(TITLES[index]), doneBy: plan.doneBy, capability: plan.capability, note: plan.note })),
    approvals: [words('Every monthly report before it reaches a client'), words('Any message that asks a client for money')],
    backOffice: {
      currency: 'INR', taxMode: 'gst' as const, taxLabel: 'GST', taxRegistered: { value: true, label: 'told-by-you' as const, by: 'owner' as const },
      taxRateBps: '1800', taxRateBy: 'country-table' as const, taxId: '27ZZZZZ9999Z1Z8', taxState: '27', sacCode: '998222', lutConfirmed: false,
      invoiceKind: 'tax-invoice' as const, taxInvoiceReady: true, taxInvoiceMissing: [], paymentRail: 'razorpay', invoicePrefix: 'INV',
    },
    starterConnectorIds: ['lovable', 'github', 'razorpay', 'mail-app', 'cal-com', 'chausar-books'],
  };
}

/** Stores a blueprint version, draft or accepted, the way blueprint.ts digests it (everything but id, at, digest, status). */
export async function seedBlueprint(env: Env, options: { status?: 'draft' | 'accepted'; version?: number; price1?: string | null; price2?: string | null } = {}): Promise<BlueprintRecord> {
  return ventureAction(env.deps, owner, 'admin', 'seed.blueprint', tx => {
    const body = blueprintBody(options);
    const base = tx.base('venture-blueprint');
    const record: BlueprintRecord = { ...base, ...body, status: options.status ?? 'accepted', digest: '' };
    const { id: _id, at: _at, digest: _digest, status: _status, ...rest } = record;
    record.digest = digest(rest);
    const stored = tx.put(record);
    tx.touch(record.status === 'accepted' ? { blueprintId: stored.id, acceptedBlueprintId: stored.id, status: 'build' } : { blueprintId: stored.id });
    return stored;
  });
}

function figure(key: PriceFigure['key'], label: string, minor: string, display: string): PriceFigure {
  return { key, label, minor, display, currency: 'INR' };
}

// INR 2,499.00 a month with GST at 18% split CGST and SGST: each half = (249900 x 900 + 5000) / 10000 = 22491 (INR 224.91);
// tax = 44982 (INR 449.82); total = 249900 + 44982 = 294882 (INR 2,948.82).
function orderReceipt(tx: VentureTx, blueprintDigest: string, orderId: string): PriceReceiptRecord {
  return {
    ...tx.base('venture-price-receipt'), subject: { type: 'order', orderId }, operation: 'venture.price', currency: 'INR', minorDigits: 2,
    inputs: { unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxMode: 'gst', taxRateBps: '1800', taxTreatment: 'cgst-sgst', unitPriceBy: 'told-by-you', taxRateBy: 'country-table', blueprintDigest },
    steps: [], figures: [
      figure('unit', 'Unit price', '249900', 'INR 2,499.00'), figure('subtotal', 'Subtotal', '249900', 'INR 2,499.00'), figure('discount', 'Discount', '0', 'INR 0.00'),
      figure('taxable', 'Taxable amount', '249900', 'INR 2,499.00'), figure('cgst', 'CGST at 9%', '22491', 'INR 224.91'), figure('sgst', 'SGST at 9%', '22491', 'INR 224.91'),
      figure('tax', 'GST total', '44982', 'INR 449.82'), figure('total', 'Total', '294882', 'INR 2,948.82'),
    ],
    totalMinor: '294882', allowedNumbers: [], explanation: 'Synthetic order receipt.', digest: 'order-receipt-digest', stale: false,
  };
}

export const CLIENT_NAME = 'Cafe Aroma Demo';
export const ORDER_REQUEST = 'Please close my September books. The bank statement and bills are in the shared folder.';

export async function seedOrder(env: Env, blueprint: BlueprintRecord): Promise<{ client: ClientRecord; order: OrderRecord; receipt: PriceReceiptRecord }> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.order', tx => {
    const client = tx.put<ClientRecord>({ ...tx.base('venture-client'), name: CLIENT_NAME, email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null });
    const orderBase = tx.base('venture-order');
    const receipt = tx.put(orderReceipt(tx, blueprint.digest, orderBase.id));
    const order = tx.put<OrderRecord>({ ...orderBase, clientId: client.id, offerId: 'offer_1', quantity: '1', request: ORDER_REQUEST, status: 'open', priceReceiptId: receipt.id, deliveredOn: null, saleFactId: null });
    return { client, order, receipt };
  });
}

export async function setStage(env: Env, launchStage: VentureRecord['launchStage']) {
  await ventureAction(env.deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage }); });
}

/** A harness record in the act phase with the given tool calls, as the agent loop stores it. */
export function harness(overrides: Partial<HarnessState> = {}): HarnessState {
  return {
    version: 1, phase: 'act', limits: { maxTurns: 4, maxToolCalls: 12, maxCallsPerTurn: 4, maxCostMicros: '200000', keepOutputs: 4, stubChars: 200 },
    used: { turns: 0, toolCalls: 0, costMicros: '0' }, grant: ['files.list', 'files.read', 'calc.totals', 'handoff.owner'],
    turns: [], toolCalls: [], handoffs: [], uploadIds: [], tableIds: [], workReceiptIds: [], proofs: [], sections: 'reply', stopReason: null, mocks: [],
    ...overrides,
  };
}

/** Stores a delivery run record as the delivery package would, with the given status and fields. */
export async function seedRun(env: Env, order: OrderRecord, fields: Partial<DeliveryRunRecord>, emit: ('run.started' | 'run.waiting' | 'run.done' | 'run.failed')[] = []): Promise<DeliveryRunRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.run', tx => {
    const run: DeliveryRunRecord = {
      ...tx.base('venture-delivery-run'), orderId: order.id, playbookId: 'playbook_missing', playbookHash: 'hash', status: 'waiting-for-you', servedBy: 'model',
      practice: false, callId: null, preview: null, deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null, ...fields,
    };
    const stored = tx.put(run);
    for (const name of emit) tx.emit(name, { runId: stored.id });
    return stored;
  });
}
