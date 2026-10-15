// P5 delivery tests: playbook, draft replies, checks, rehearsal, the launch ladder, real delivery runs and capabilities.
// Records are seeded as literals; the model port is a stub driven by synthetic recordings in fixtures/venture/delivery/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import {
  CHECK_IDS, JUDGE_QUESTIONS, METHOD_OWNERS, PURPOSE_TIER, REQUIRED_SECTIONS, SERVICE_TYPES, STEP_PLAN, VENTURE_ERRORS, VENTURE_METHODS,
} from '../runtime/venture/contracts.ts';
import type {
  BlueprintRecord, CheckId, CheckResult, ClientRecord, CountryProfile, Deliverable, DeliveryRunRecord, LaunchStatus, ModelOutcome, ModelPort,
  ModelPreset, ModelPreview, ModelPurpose, ModelStatusView, ModelTask, OrderRecord, PlaybookRecord, PlaybookStep, PriceFigure,
  PriceReceiptRecord, Scenario, ServiceType, SignalRecord, SimulationRunRecord, VentureDeps, VentureRecord,
} from '../runtime/venture/contracts.ts';
import {
  BANNED_WORDS, assertNoNumbers, digest, doneClaimFindings, formatMicros, houseStyleFindings, listRecords, ventureAction, type VentureTx,
} from '../runtime/venture/records.ts';
import {
  capabilityList, handlers, playbookSteps, renderDeliverable, renderForJudge, runChecks, scenariosFor, templateOutline, validateDraft,
  validatePlaybook,
} from '../runtime/venture/delivery/index.ts';
import { rehearsalRefs, TEMPLATE_OUTLINE_LINE, TEMPLATE_OUTLINES, TEMPLATE_PRICE_SENTENCE, TEMPLATE_QUESTION } from '../runtime/venture/delivery/deliverable.ts';
import { PRACTICE_CLIENTS } from '../runtime/venture/delivery/scenarios.ts';
import {
  REASON_CONNECT_AI, REASON_NO_JUDGE, REASON_NOT_JUDGED, REASON_PASS_ALL, REASON_REHEARSE_ALL, REASON_TEMPLATE_DRAFTS,
} from '../runtime/venture/delivery/launch.ts';
import { DONE_CLAIM_REASON, PRACTICE_REASON, STAGE_BLOCKED_REASON } from '../runtime/venture/delivery/runs.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const phone: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' };
const clock = () => new Date('2026-10-15T10:00:00.000Z');
// The stub's previews last thirty minutes from the fixed clock, like the real port's.
const PREVIEW_EXPIRES_AT = '2026-10-15T10:30:00.000Z';
const ORDER_REQUEST = 'Please close my September books. The bank statement and bills are in the shared folder.';
const CLIENT_NAME = 'Cafe Aroma Demo';
const CLIENT_EMAIL = 'owner@aroma.example';
const code = (expected: string) => (error: any) => { assert.equal(error.code, expected, error.message); return true; };

async function fixture(name: string): Promise<any> {
  const file = JSON.parse(await readFile(new URL(`./fixtures/venture/delivery/${name}.json`, import.meta.url), 'utf8'));
  assert.equal(file.label, 'synthetic recording');
  return file.output;
}

const IN: CountryProfile = {
  code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india',
  tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', registrationNote: 'Check with a CA.', idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15' },
  paymentRails: ['razorpay', 'cashfree', 'paypal'], dateOrder: 'day-month-year', complianceNotes: [],
};

// ---------------------------------------------------------------------------
// A stub model port. It never writes venture records unless recordCalls is on, and it touches the store with an
// empty update before every call, so a call made inside a transaction fails with REENTRANT_TRANSACTION.
// ---------------------------------------------------------------------------

type Tier = 'model' | 'template';
class StubPort implements ModelPort {
  store: VentureTestStore;
  fast: Tier = 'template';
  main: Tier = 'template';
  confirmed = true;
  recordCalls = false;
  outputs: Partial<Record<ModelPurpose, unknown[]>> = {};
  used: Partial<Record<ModelPurpose, number>> = {};
  costs: Record<ModelPurpose, string> = { interview: '0', blueprint: '0', brief: '0', delivery: '2000', 'client-sim': '100', judge: '50' };
  generated: ModelTask<any>[] = [];
  previewed: ModelTask<any>[] = [];
  previews = new Map<string, { digest: string; used: boolean }>();
  statusCalls = 0;
  sent = 0;
  /** The port's clock; setup points it at deps.clock so a test can let a preview expire. */
  now: () => Date = clock;
  /** Runs after the model answered an approved call, before runPreview returns: lets a test move the stage mid-approval. */
  afterSend: (() => Promise<unknown>) | null = null;
  #calls = 0;
  constructor(store: VentureTestStore) { this.store = store; }
  status(_ctx: Context): ModelStatusView {
    this.statusCalls += 1;
    const tier = (mode: Tier, presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => mode === 'model'
      ? { presetId, model: presetId === 'anthropic-haiku-5-5' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5', usable: true, reason: 'Uses your Anthropic key.' }
      : { presetId: 'built-in-templates' as const, model: null, usable: true, reason: 'No AI connected; using built-in templates' };
    return {
      connections: [], tiers: { fast: tier(this.fast, 'anthropic-haiku-5-5'), main: tier(this.main, 'anthropic-sonnet-5-5') },
      spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' },
    };
  }
  presets(): ModelPreset[] { throw new ChausarError('NOT_BUILT_YET', 'Not used in these tests.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used in these tests.'); }
  next(purpose: ModelPurpose): unknown {
    const list = this.outputs[purpose];
    assert.ok(list && list.length, `no fixture queued for ${purpose}`);
    const index = this.used[purpose] ?? 0;
    this.used[purpose] = index + 1;
    return structuredClone(list[Math.min(index, list.length - 1)]);
  }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    await this.store.update(() => undefined);
    this.generated.push(task);
    if (task.containsClientData) throw new ChausarError('CLIENT_DATA_NEEDS_APPROVAL', 'Client data needs your approval.');
    const tier = PURPOSE_TIER[task.purpose];
    if (this[tier] === 'template') {
      if (!task.template) throw new ChausarError('NO_MODEL_CONNECTED', 'No AI connected.');
      return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
    }
    const value = task.validate(this.next(task.purpose));
    this.#calls += 1;
    return { value, by: 'model', callId: `call_${this.#calls}`, presetId: tier === 'fast' ? 'anthropic-haiku-5-5' : 'anthropic-sonnet-5-5', model: 'stub', costMicros: this.costs[task.purpose], priceConfirmed: this.confirmed };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    await this.store.update(() => undefined);
    this.previewed.push(task);
    if (this[PURPOSE_TIER[task.purpose]] === 'template') return null;
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    const payloadDigest = digest(payloadText);
    this.previews.set(callId, { digest: payloadDigest, used: false });
    if (this.recordCalls) await this.store.update(state => { state.conversations.push({ id: callId, kind: 'venture-model-call', status: 'preview' }); });
    return {
      callId, payloadText, digest: payloadDigest, presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: PREVIEW_EXPIRES_AT,
    };
  }
  async runPreview<T>(ctx: Context, callId: string, approvedDigest: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    await this.store.update(() => undefined);
    if (ctx.channel !== 'desktop') throw new ChausarError('APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
    const held = this.previews.get(callId);
    const expired = this.now().getTime() > Date.parse(PREVIEW_EXPIRES_AT);
    if (!held || held.used || held.digest !== approvedDigest || expired) throw new ChausarError('APPROVAL_STALE', 'Run it again; the approved text is no longer available.');
    held.used = true;
    const setCall = (status: string) => this.recordCalls ? this.store.update(state => { const call = state.conversations.find(r => r?.id === callId); if (call) call.status = status; }) : Promise.resolve();
    await setCall('dispatching');
    this.sent += 1;
    let value: T;
    try {
      value = validate(this.next('delivery'));
      await setCall('completed');
    } catch (error) {
      await setCall('failed');
      throw error;
    }
    if (this.afterSend) await this.afterSend();
    return { value, by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', costMicros: this.costs.delivery, priceConfirmed: this.confirmed };
  }
}

// ---------------------------------------------------------------------------
// Literal records
// ---------------------------------------------------------------------------

const words = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
const STEP_TITLES = ['Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client'];

function blueprintRecord(tx: VentureTx, options: { serviceType?: ServiceType; version?: number; step3?: string } = {}): BlueprintRecord {
  const serviceType = options.serviceType ?? 'bookkeeping';
  const body = {
    version: options.version ?? 1, source: 'template' as const, structureHash: 'structure-hash', modelCallIds: [], serviceType,
    name: { value: 'Ledger Cafe Books', label: 'told-by-you' as const, by: 'owner' as const },
    oneLiner: words('Monthly books for cafes, drafted with AI help and checked by you.'),
    customer: words('Cafe and small shop owners.'),
    offers: [
      { id: 'offer_1', name: words('Monthly books'), description: words('Bank matching, bill sorting and a short monthly report.'),
        pricing: { model: 'monthly' as const, quantityUnit: 'month' as const, unitPriceMinor: '249900', unitPriceLabel: 'told-by-you' as const, defaultQuantity: '1' } },
      { id: 'offer_2', name: words('Catch up clean up'), description: words('A one time tidy up of past months.'),
        pricing: { model: 'project' as const, quantityUnit: 'project' as const, unitPriceMinor: null, unitPriceLabel: 'not-set' as const, defaultQuantity: '1' } },
    ],
    deliverySteps: STEP_PLAN.map((plan, index) => ({
      id: plan.id, title: words(index === 2 && options.step3 ? options.step3 : STEP_TITLES[index]), doneBy: plan.doneBy, capability: plan.capability, note: plan.note,
    })),
    approvals: [words('Every monthly report before it reaches a client'), words('Any message that asks a client for money')],
    backOffice: {
      currency: 'INR', taxMode: 'gst' as const, taxLabel: 'GST', taxRegistered: { value: true, label: 'told-by-you' as const, by: 'owner' as const },
      taxRateBps: '1800', taxRateBy: 'country-table' as const, taxId: '27ZZZZZ9999Z1Z8', taxState: '27', sacCode: '998222', lutConfirmed: false,
      invoiceKind: 'tax-invoice' as const, taxInvoiceReady: true, taxInvoiceMissing: [], paymentRail: 'razorpay', invoicePrefix: 'INV',
    },
    starterConnectorIds: ['lovable', 'github', 'razorpay', 'mail-app', 'cal-com', 'chausar-books'],
  };
  return { ...tx.base('venture-blueprint'), ...body, status: 'accepted', digest: digest(body) };
}

function figure(key: PriceFigure['key'], label: string, minor: string, display: string): PriceFigure {
  return { key, label, minor, display, currency: 'INR' };
}

// INR 2,499.00 a month at GST 18%, single: tax = (249900 x 1800 + 5000) / 10000 = 449,825,000 / 10000 = 44982 (INR 449.82);
// total = 249900 + 44982 = 294882 (INR 2,948.82).
function offerReceiptRecord(tx: VentureTx, blueprintDigest: string, offerId = 'offer_1'): PriceReceiptRecord {
  return {
    ...tx.base('venture-price-receipt'), subject: { type: 'offer', offerId }, operation: 'venture.price', currency: 'INR', minorDigits: 2,
    inputs: { unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxMode: 'gst', taxRateBps: '1800', taxTreatment: 'single', unitPriceBy: 'told-by-you', taxRateBy: 'country-table', blueprintDigest },
    steps: [], figures: [
      figure('unit', 'Unit price', '249900', 'INR 2,499.00'), figure('subtotal', 'Subtotal', '249900', 'INR 2,499.00'), figure('discount', 'Discount', '0', 'INR 0.00'),
      figure('taxable', 'Taxable amount', '249900', 'INR 2,499.00'), figure('tax', 'GST at 18%', '44982', 'INR 449.82'), figure('total', 'Total', '294882', 'INR 2,948.82'),
    ],
    totalMinor: '294882', allowedNumbers: [], explanation: '1 x month at INR 2,499.00, plus GST at 18% (INR 449.82) = INR 2,948.82.', digest: 'receipt-digest', stale: false,
  };
}

// The same order with the client in the owner's state, cgst-sgst: each half = (249900 x 1800 + 10000) / 20000 = 449,830,000 / 20000 = 22491
// (INR 224.91); tax = 44982; total = 294882 (INR 2,948.82).
function orderReceiptRecord(tx: VentureTx, blueprintDigest: string, orderId: string): PriceReceiptRecord {
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

type Env = { store: VentureTestStore; models: StubPort; deps: VentureDeps; venture: VentureRecord; blueprint: BlueprintRecord; offerReceipt: PriceReceiptRecord };

async function setup(options: { accepted?: boolean; serviceType?: ServiceType } = {}): Promise<Env> {
  const store = new VentureTestStore();
  const models = new StubPort(store);
  const deps: VentureDeps = {
    store, clock, models, services: {} as VentureDeps['services'], github: {} as VentureDeps['github'], secrets: {} as VentureDeps['secrets'],
    host: 'test', demo: true, storage: 'experimental-file',
  };
  models.now = () => deps.clock();
  const venture = await ventureAction(deps, owner, 'admin', 'create', tx => tx.put<VentureRecord>({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes and small shops in Pune, done by AI helpers with me checking every report.',
    ideaDigest: 'idea-digest', workingName: 'Ledger Cafe Books', country: IN, serviceType: options.serviceType ?? 'bookkeeping', status: 'blueprint',
    launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  const blueprint = await ventureAction(deps, owner, 'admin', 'seed.blueprint', tx => {
    const record = blueprintRecord(tx, { serviceType: options.serviceType });
    const stored = tx.put(options.accepted === false ? { ...record, status: 'draft' as const } : record);
    tx.touch(options.accepted === false ? { blueprintId: stored.id } : { blueprintId: stored.id, acceptedBlueprintId: stored.id, status: 'build' });
    return stored;
  });
  const offerReceipt = await ventureAction(deps, owner, 'prepare', 'seed.receipt', tx => tx.put(offerReceiptRecord(tx, blueprint.digest)));
  return { store, models, deps, venture, blueprint, offerReceipt };
}

async function seedOrder(env: Env): Promise<{ client: ClientRecord; order: OrderRecord; receipt: PriceReceiptRecord }> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.order', tx => {
    const client = tx.put<ClientRecord>({ ...tx.base('venture-client'), name: CLIENT_NAME, email: CLIENT_EMAIL, countryCode: 'IN', taxId: null, stateCode: '27', note: null });
    const orderBase = tx.base('venture-order');
    const receipt = tx.put(orderReceiptRecord(tx, env.blueprint.digest, orderBase.id));
    const order = tx.put<OrderRecord>({ ...orderBase, clientId: client.id, offerId: 'offer_1', quantity: '1', request: ORDER_REQUEST, status: 'open', priceReceiptId: receipt.id, deliveredOn: null, saleFactId: null });
    return { client, order, receipt };
  });
}

async function setStage(env: Env, launchStage: VentureRecord['launchStage']) {
  await ventureAction(env.deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage }); });
}

function call<T>(env: Env, method: keyof typeof handlers & string, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const handler = handlers[method as keyof typeof handlers] as (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
  return handler(env.deps, ctx, payload) as Promise<T>;
}

/** The delivery run as stored now. */
function stored(env: Env, runId: string): DeliveryRunRecord {
  const run = listRecords(env.store.read(), 'venture-delivery-run').find(item => item.id === runId);
  assert.ok(run, runId);
  return run;
}

function approve(env: Env, run: DeliveryRunRecord, digestValue = run.preview!.digest): Promise<DeliveryRunRecord> {
  return call<DeliveryRunRecord>(env, 'venture.delivery.approve', { runId: run.id, digest: digestValue });
}

function events(env: Env): string[] {
  return listRecords(env.store.read(), 'venture-event').sort((a, b) => a.seq - b.seq).map(event => event.name);
}

async function queueModel(env: Env, outputs: { client?: string[]; delivery?: string[]; judge?: string[] }) {
  env.models.fast = 'model';
  env.models.main = 'model';
  env.models.outputs = {
    'client-sim': await Promise.all((outputs.client ?? ['client-message']).map(fixture)),
    delivery: await Promise.all((outputs.delivery ?? ['draft-rehearsal']).map(fixture)),
    judge: await Promise.all((outputs.judge ?? ['judge-yes']).map(fixture)),
  };
  env.models.used = {};
}

// ---------------------------------------------------------------------------
// 1. Playbook
// ---------------------------------------------------------------------------

test('playbook: seven fixed steps from the accepted plan, stable hash, a new version after a new accepted digest', async () => {
  const env = await setup();
  const playbook = await call<PlaybookRecord>(env, 'venture.delivery.playbook');
  assert.deepEqual(playbook.steps.map(step => [step.id, step.kind, step.tier, step.model, step.doneBy]), [
    ['gather', 'gather', 'actor', 'fast', 'agent'], ['clarify', 'question', 'actor', 'fast', 'agent'], ['price', 'compute', 'code', null, 'agent'],
    ['draft', 'write', 'actor', 'main', 'agent'], ['verify', 'verify', 'code', null, 'agent'], ['approve', 'approve', 'code', null, 'you'],
    ['send', 'operator', 'code', null, 'you'],
  ]);
  const draft = playbook.steps.find(step => step.id === 'draft')!;
  assert.equal(draft.title, 'Draft the monthly report for review');
  assert.deepEqual(draft.requiredSections, [...REQUIRED_SECTIONS.bookkeeping]);
  assert.deepEqual(draft.checks, ['no-numeric-prose', 'figures-resolve', 'required-sections', 'house-style', 'length-bounds', 'no-done-claims']);
  assert.deepEqual(playbook.steps.find(step => step.id === 'verify')!.checks, CHECK_IDS.filter(id => id !== 'questions-raised' && id !== 'turn-limit'));
  assert.deepEqual(playbook.steps.find(step => step.id === 'send')!.checks, ['no-outside-writes']);
  assert.equal(playbook.validated, true);
  assert.equal(playbook.tierCeiling, 'actor');
  assert.equal(playbook.version, 1);
  assert.equal(playbook.blueprintDigest, env.blueprint.digest);
  assert.equal(playbook.hash, digest(playbook.steps));
  assert.equal(env.store.read().conversations.find(r => r.kind === 'venture-record').playbookId, playbook.id);
  assert.ok(events(env).includes('playbook-ready'));

  const again = await call<PlaybookRecord>(env, 'venture.delivery.playbook');
  assert.equal(again.id, playbook.id);
  assert.equal(listRecords(env.store.read(), 'venture-playbook').length, 1);
  assert.equal(validatePlaybook(playbookSteps(env.blueprint)).hash, playbook.hash);

  // A newly accepted plan with the same steps: a new version with the same hash.
  const same = await ventureAction(env.deps, owner, 'admin', 'seed.accept', tx => {
    const record = tx.put({ ...blueprintRecord(tx, { version: 2 }) });
    tx.touch({ acceptedBlueprintId: record.id, blueprintId: record.id });
    return record;
  });
  assert.notEqual(same.digest, env.blueprint.digest);
  const second = await call<PlaybookRecord>(env, 'venture.delivery.playbook');
  assert.equal(second.version, 2);
  assert.equal(second.hash, playbook.hash);
  // A new drafting step title changes the hash.
  await ventureAction(env.deps, owner, 'admin', 'seed.accept', tx => {
    const record = tx.put({ ...blueprintRecord(tx, { version: 3, step3: 'Draft the weekly summary for review' }) });
    tx.touch({ acceptedBlueprintId: record.id, blueprintId: record.id });
  });
  const third = await call<PlaybookRecord>(env, 'venture.delivery.playbook');
  assert.equal(third.version, 3);
  assert.notEqual(third.hash, playbook.hash);
  assert.equal(third.steps.find(step => step.id === 'draft')!.title, 'Draft the weekly summary for review');
});

test('playbook: refuses without an accepted plan, and validatePlaybook refuses each broken rule', async () => {
  const env = await setup({ accepted: false });
  await assert.rejects(call(env, 'venture.delivery.playbook'), code('BLUEPRINT_NOT_ACCEPTED'));
  await assert.rejects(call(env, 'venture.delivery.playbook', { extra: true }), code('INVALID_VENTURE_REQUEST'));

  const good = playbookSteps(env.blueprint);
  assert.equal(validatePlaybook(good).validated, true);
  const edit = (id: string, patch: Partial<PlaybookStep>) => good.map(step => step.id === id ? { ...step, ...patch } : step);
  const broken: [string, PlaybookStep[]][] = [
    ['duplicate ids', good.map(step => step.id === 'clarify' ? { ...step, id: 'gather' } : step)],
    ['compute with a model', edit('price', { model: 'fast' })],
    ['verify with a model', edit('verify', { model: 'main' })],
    ['approve with a model', edit('approve', { model: 'fast' })],
    ['operator with a model', edit('send', { model: 'main' })],
    ['a tier above actor', edit('draft', { tier: 'wasm' })],
    ['a container tier', edit('gather', { tier: 'container' })],
    ['a write step without sections', edit('draft', { requiredSections: [] })],
    ['a write step without no-done-claims', edit('draft', { checks: ['no-numeric-prose', 'figures-resolve', 'required-sections'] })],
    ['an operator step before the approve step', [...good.filter(step => step.id !== 'send').slice(0, 5), good.find(step => step.id === 'send')!, good.find(step => step.id === 'approve')!]],
    ['an operator step with no approve step', good.filter(step => step.id !== 'approve')],
  ];
  for (const [name, steps] of broken) assert.throws(() => validatePlaybook(steps), code('INVALID_VENTURE_REQUEST'), name);
});

// ---------------------------------------------------------------------------
// 2. Draft validation and rendering
// ---------------------------------------------------------------------------

test('draft validation: words only, offered refs only, headings from the plan; rendering fills prices and dates', async () => {
  const env = await setup();
  const refs = rehearsalRefs(env.store.read(), env.venture.id, env.blueprint, '2026-10-15');
  assert.deepEqual(refs.figures.map(entry => entry.ref), ['offer_1.unit', 'offer_1.total', 'offer_1.tax']);
  assert.deepEqual(refs.dates.map(entry => entry.ref), ['today']);
  for (const entry of [...refs.figures, ...refs.dates]) assert.doesNotThrow(() => assertNoNumbers(entry.label, 'label'), entry.label);
  const context = { serviceType: 'bookkeeping' as const, refs, allowed: [] as string[] };
  const raw = await fixture('draft-rehearsal');

  const draft = validateDraft(raw, context);
  assert.equal(draft.title, 'Your monthly books plan');
  assert.deepEqual(draft.sections.map(section => section.heading), [...REQUIRED_SECTIONS.bookkeeping]);
  assert.deepEqual(draft.sections[1].parts[1], { kind: 'figure', receiptId: env.offerReceipt.id, figureKey: 'total' });
  assert.deepEqual(draft.sections[3].parts[1], { kind: 'date', dateRef: 'today', iso: '2026-10-15' });
  assert.deepEqual(draft.sections[0].parts[0], { kind: 'text', text: raw.sections[0].parts[0].text });
  assert.deepEqual(draft.questionsForClient, ['Which bank account do you use for the cafe?']);

  const variant = (change: (copy: any) => void) => { const copy = structuredClone(raw); change(copy); return copy; };
  assert.throws(() => validateDraft(variant(copy => { copy.sections[0].parts[0].text = 'We will be done in 3 days.'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.title = 'Plan for 2026'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.questionsForClient = ['Is it 500 bills?']; }), context), code('MODEL_OUTPUT_REJECTED'));
  const b2b = variant(copy => { copy.sections[0].parts[0].text = 'We help B2B cafes keep their books in order.'; });
  assert.throws(() => validateDraft(b2b, context), code('MODEL_OUTPUT_REJECTED'));
  const copied = validateDraft(b2b, { ...context, allowed: ['b2b'] });
  assert.equal((copied.sections[0].parts[0] as { text: string }).text, 'We help B2B cafes keep their books in order.');
  assert.throws(() => validateDraft(variant(copy => { copy.sections[1].parts[1].ref = 'offer_2.total'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.sections[1].parts[1].ref = 'order.total'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.sections[3].parts[1].ref = 'order.created'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.sections[3].heading = 'Results'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.sections[3].heading = 'Summary'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.sections[1].parts[1].text = 'two'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.sections[0].parts[0].ref = 'today'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.sections[0].parts[0].kind = 'link'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.extra = 'x'; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.questionsForClient = ['One?', 'Two?', 'Three?', 'Four?']; }), context), code('MODEL_OUTPUT_REJECTED'));
  assert.throws(() => validateDraft(variant(copy => { copy.sections = []; }), context), code('MODEL_OUTPUT_REJECTED'));
  // One section is enough for validation; the required-sections check catches the rest.
  assert.equal(validateDraft(variant(copy => { copy.sections = copy.sections.slice(0, 1); }), context).sections.length, 1);

  const receipts = [env.offerReceipt];
  const rendered = renderDeliverable(draft, receipts, IN);
  assert.ok(rendered.startsWith('# Your monthly books plan\n\n## Summary\n'));
  assert.ok(rendered.includes('Total: INR 2,948.82'));
  assert.ok(rendered.includes('This plan is dated 15 Oct 2026 and we will prepare'));
  assert.ok(rendered.endsWith('Questions for you:\n- Which bank account do you use for the cafe?'));
  assert.ok(renderDeliverable(draft, receipts, { dateOrder: 'month-day-year' }).includes('Oct 15, 2026'));

  const judged = renderForJudge(draft, receipts);
  assert.ok(judged.includes('Total: [price from Chausar]'));
  assert.ok(judged.includes('[date from Chausar]'));
  for (const leak of ['INR', '2,948.82', '294882', '249900', '449.82', '15 Oct 2026', '2026-10-15']) assert.ok(!judged.includes(leak), leak);
});

// ---------------------------------------------------------------------------
// 3. Checks
// ---------------------------------------------------------------------------

test('checks: each passes on a good draft and fails on a crafted case', async () => {
  const env = await setup();
  const refs = rehearsalRefs(env.store.read(), env.venture.id, env.blueprint, '2026-10-15');
  const draft = validateDraft(await fixture('draft-rehearsal'), { serviceType: 'bookkeeping', refs, allowed: [] });
  const receipts = [env.offerReceipt];
  const renderedText = renderDeliverable(draft, receipts, IN);
  const base = {
    checks: [...CHECK_IDS], deliverable: draft, renderedText, serviceType: 'bookkeeping' as const, allowed: [] as string[], receipts,
    ventureId: env.venture.id, mocks: [{ connector: 'mail-app', operation: 'send-deliverable', payloadDigest: digest(renderedText), recordedAt: clock().toISOString() }],
    mockModes: { 'mail-app.send-deliverable': 'record-only' as const }, agentTurns: 2, turnLimit: 2, askedQuestions: true,
  };
  const good = runChecks(base);
  assert.deepEqual(good.map(result => result.check), [...CHECK_IDS]);
  for (const result of good) assert.equal(result.passed, true, `${result.check}: ${result.detail}`);
  assert.match(good.find(result => result.check === 'no-outside-writes')!.detail, /only recorded/);

  const only = (check: CheckId, patch: Partial<typeof base>): CheckResult => {
    const [result] = runChecks({ ...base, ...patch, checks: [check] });
    assert.equal(result.check, check);
    return result;
  };
  const withText = (text: string): Deliverable => ({ ...draft, sections: [{ heading: 'Summary', parts: [{ kind: 'text', text }] }, ...draft.sections.slice(1)] });
  assert.equal(only('no-numeric-prose', { deliverable: withText('Pay 500 now.') }).passed, false);
  assert.equal(only('no-numeric-prose', { deliverable: { ...draft, questionsForClient: ['Is it 20% off?'] } }).passed, false);
  assert.equal(only('no-numeric-prose', { deliverable: withText('We help B2B cafes.'), allowed: ['b2b'] }).passed, true);
  assert.equal(only('figures-resolve', { deliverable: { ...draft, sections: [{ heading: 'Summary', parts: [{ kind: 'figure', receiptId: 'price_missing', figureKey: 'total' }] }] } }).passed, false);
  assert.equal(only('figures-resolve', { deliverable: { ...draft, sections: [{ heading: 'Summary', parts: [{ kind: 'figure', receiptId: env.offerReceipt.id, figureKey: 'igst' }] }] } }).passed, false);
  assert.equal(only('figures-resolve', { ventureId: 'venture_other' }).passed, false);
  const missing = only('required-sections', { deliverable: { ...draft, sections: draft.sections.slice(0, 2) } });
  assert.equal(missing.passed, false);
  assert.match(missing.detail, /What we need from you, Next steps/);
  assert.equal(only('no-outside-writes', { mocks: [{ connector: 'stripe', operation: 'charge', payloadDigest: 'x', recordedAt: clock().toISOString() }] }).passed, false);
  for (const word of BANNED_WORDS) {
    const result = only('house-style', { renderedText: `${renderedText}\nWe will ${word} your data.` });
    assert.equal(result.passed, false, word);
    assert.equal(result.detail, `The draft uses a word on the avoid list: ${word}.`);
  }
  assert.equal(only('house-style', { renderedText: `${renderedText}\nOne \u2014 two.` }).passed, false);
  assert.equal(only('length-bounds', { renderedText: 'Too short.' }).passed, false);
  assert.equal(only('length-bounds', { renderedText: 'a'.repeat(12001) }).passed, false);
  assert.equal(only('length-bounds', { renderedText: 'a'.repeat(12000) }).passed, true);
  assert.equal(only('turn-limit', { agentTurns: 3 }).passed, false);
  assert.equal(only('questions-raised', { askedQuestions: false }).passed, false);

  const claims = validateDraft(await fixture('claims-done'), { serviceType: 'bookkeeping', refs, allowed: [] });
  const done = only('no-done-claims', { deliverable: claims });
  assert.equal(done.passed, false);
  assert.match(done.detail, /We matched/);
});

test('checks: a draft that claims finished work fails its rehearsal with no-done-claims first', async () => {
  const env = await setup();
  await queueModel(env, { delivery: ['claims-done'] });
  const run = await call<SimulationRunRecord>(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-clean'] });
  assert.equal(run.passed, false);
  assert.equal(run.episodes[0].firstFailure, 'no-done-claims');
  assert.equal(run.episodes[0].checks.find(result => result.check === 'no-done-claims')!.passed, false);
});

// ---------------------------------------------------------------------------
// 4. Template rehearsal
// ---------------------------------------------------------------------------

test('template rehearsal: three practice clients pass their checks, not judged, at no cost', async () => {
  const env = await setup();
  const run = await call<SimulationRunRecord>(env, 'venture.simulation.run', { useTemplate: true });
  assert.deepEqual(run.scenarioIds, ['bookkeeping-clean', 'bookkeeping-messy', 'bookkeeping-pushback']);
  assert.equal(run.passed, true);
  assert.equal(run.modelMode, 'template');
  assert.equal(run.costMicros, '0');
  assert.equal(run.costDisplay, 'USD 0.0000');
  assert.deepEqual(run.summary, { scenarios: 3, passed: 3, failed: 0 });
  for (const episode of run.episodes) {
    assert.equal(episode.passed, true, `${episode.scenarioId}: ${episode.firstFailure}`);
    assert.equal(episode.firstFailure, null);
    assert.deepEqual(episode.judge.map(answer => [answer.question, answer.answer, answer.reason]), JUDGE_QUESTIONS.map(question => [question, 'not-judged', 'No AI judge connected.']));
    assert.equal(episode.mocks.length, 1);
    assert.equal(episode.mocks[0].connector, 'mail-app');
    assert.equal(episode.mocks[0].payloadDigest, digest(episode.renderedText));
    assert.ok(episode.renderedText!.includes('Total: INR 2,948.82'));
    assert.ok(episode.turns.every(turn => turn.author === 'template'));
  }
  assert.ok(run.episodes.find(episode => episode.scenarioId === 'bookkeeping-messy')!.checks.some(result => result.check === 'questions-raised' && result.passed));
  assert.equal(env.models.generated.length + env.models.previewed.length + env.models.statusCalls, 0);
  const venture = env.store.read().conversations.find(r => r.kind === 'venture-record');
  assert.equal(venture.status, 'rehearsal');
  assert.ok(events(env).includes('simulation-finished'));

  // Templates serving the tiers gives the same result through the port, and the judge stays off.
  const viaPort = await call<SimulationRunRecord>(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-messy'] });
  assert.equal(viaPort.passed, true);
  assert.equal(viaPort.modelMode, 'template');
  assert.ok(viaPort.episodes[0].judge.every(answer => answer.answer === 'not-judged'));
  assert.ok(env.models.generated.length > 0);
  assert.ok(env.models.generated.every(task => task.purpose !== 'judge'));

  const got = await call<SimulationRunRecord>(env, 'venture.simulation.get', { runId: run.id });
  assert.equal(got.id, run.id);
  await assert.rejects(call(env, 'venture.simulation.get', { runId: 'simrun_missing' }), code('SIMULATION_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.simulation.run', { scenarioIds: ['studio-clean'] }), code('SCENARIO_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.simulation.run', { episodes: 4 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.simulation.run', { scenarioIds: [] }), code('INVALID_VENTURE_REQUEST'));
});

test('template words: every outline sentence and practice client is free of numbers, avoid-list words and done claims', () => {
  // The outline is a reply the owner copies to a client, so "your" means the client's: the price never comes from "your plan".
  assert.doesNotMatch(TEMPLATE_PRICE_SENTENCE, /\byour\b/i);
  for (const type of SERVICE_TYPES) {
    assert.equal(TEMPLATE_OUTLINES[type].length, REQUIRED_SECTIONS[type].length, type);
    // The outline asks one question, so no sentence speaks of several.
    for (const sentence of TEMPLATE_OUTLINES[type]) assert.doesNotMatch(sentence, /\bthe questions\b/i, `${type}: ${sentence}`);
    const outline = templateOutline(type, { receiptId: 'price_x', figureKey: 'total' });
    assert.deepEqual(outline.sections.map(section => section.heading), [...REQUIRED_SECTIONS[type]]);
    assert.deepEqual(outline.questionsForClient, [TEMPLATE_QUESTION]);
    assert.ok(outline.sections[1].parts.some(part => part.kind === 'figure'));
    const pieces = [outline.title, ...outline.questionsForClient];
    for (const section of outline.sections) for (const part of section.parts) if (part.kind === 'text') pieces.push(part.text);
    for (const piece of pieces) {
      assert.deepEqual(doneClaimFindings(piece), [], `${type}: ${piece}`);
      assert.doesNotThrow(() => assertNoNumbers(piece, 'outline'), piece);
      assert.deepEqual(houseStyleFindings(piece), [], piece);
    }
    assert.ok(templateOutline(type, null).sections.every(section => section.parts.every(part => part.kind === 'text')));
    const scenarios = scenariosFor(type);
    assert.deepEqual(scenarios.map(scenario => scenario.id), [`${type}-clean`, `${type}-messy`, `${type}-pushback`]);
    for (const scenario of scenarios) {
      assert.equal(scenario.turnLimit, 2);
      assert.equal(scenario.episodes, 1);
      assert.deepEqual(scenario.mocks, { 'mail-app.send-deliverable': 'record-only' });
      assert.deepEqual(scenario.stoppingCriteria, ['deliverable-ready', 'client-asks-for-person', 'turn-limit']);
      assert.equal(scenario.checks.includes('questions-raised'), scenario.id.endsWith('-messy'));
      assert.equal(scenario.checks.length, scenario.id.endsWith('-messy') ? 9 : 8);
      for (const text of [scenario.title, scenario.persona, scenario.brief, scenario.expectedOutcome]) {
        assert.doesNotThrow(() => assertNoNumbers(text, 'scenario'), text);
        assert.deepEqual(houseStyleFindings(text), [], text);
      }
    }
    assert.match(PRACTICE_CLIENTS[type].pushback.brief, /price|fee|cheaper|free|lower|discount|cost/i);
  }
});

// ---------------------------------------------------------------------------
// 5. Model rehearsal
// ---------------------------------------------------------------------------

test('model rehearsal: one practice client per call, judged, with costs worked out by code', async () => {
  const env = await setup();
  await seedOrder(env); // a client and an order exist; rehearsal must never touch them
  await queueModel(env, {});
  const run = await call<SimulationRunRecord>(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-clean'] });
  assert.equal(run.passed, true, run.episodes[0].firstFailure ?? '');
  assert.equal(run.modelMode, 'model');
  const episode = run.episodes[0];
  assert.deepEqual(episode.turns.map(turn => [turn.by, turn.author]), [['client', 'model'], ['agent', 'model'], ['client', 'model'], ['agent', 'model']]);
  assert.ok(episode.turns.every(turn => turn.callId));
  assert.deepEqual(episode.judge.map(answer => answer.answer), ['yes', 'yes', 'yes', 'yes']);
  assert.ok(episode.judge.every(answer => answer.callId));
  // Calls: client 100 + draft 2000 + client 100 + draft 2000 + judge 50 = 4250 micros; (4250 + 50) / 100 = 43, so USD 0.0043.
  assert.equal(run.costMicros, '4250');
  assert.equal(episode.costMicros, '4250');
  assert.equal(run.costDisplay, 'USD 0.0043');
  assert.equal(run.costDisplay, formatMicros(run.costMicros));

  const purposes = env.models.generated.map(task => task.purpose);
  assert.deepEqual(purposes, ['client-sim', 'delivery', 'client-sim', 'delivery', 'judge']);
  assert.equal(env.models.previewed.length, 0);
  for (const task of env.models.generated) {
    assert.equal(task.containsClientData, false);
    const text = JSON.stringify(task.input) + task.instructions;
    for (const secret of [CLIENT_NAME, CLIENT_EMAIL, ORDER_REQUEST, 'September']) assert.ok(!text.includes(secret), `${task.purpose} holds ${secret}`);
  }
  const deliveryInput = env.models.generated[1].input as any;
  assert.deepEqual(Object.keys(deliveryInput).sort(), ['clientRequest', 'dates', 'figures', 'offer', 'requiredSections', 'serviceType']);
  assert.ok(JSON.stringify(deliveryInput).includes('offer_1.total'));
  for (const entry of [...deliveryInput.figures, ...deliveryInput.dates]) assert.doesNotMatch(entry.label, /\d/);
  assert.match((env.models.generated[3].input as any).clientRequest, /\n\nAnswers: /);
  const judgeTask = env.models.generated[4];
  const judgeText = JSON.stringify(judgeTask.input);
  for (const leak of ['INR 2,948.82', '2,948.82', '294882', '249900', '449.82', '44982', '2026-10-15']) assert.ok(!judgeText.includes(leak), leak);
  assert.ok(judgeText.includes('[price from Chausar]'));
  for (const schemaTask of env.models.generated) assertSchemaSafe(schemaTask.schema);

  // The estimate words appear when any outcome came from an unconfirmed price table.
  env.models.confirmed = false;
  env.models.used = {};
  const estimate = await call<SimulationRunRecord>(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-pushback'] });
  assert.equal(estimate.costDisplay, 'USD 0.0043 (estimate, price unconfirmed)');
});

test('model rehearsal: a missing section fails required-sections; a judge no fails that question; a person request stops', async () => {
  const env = await setup();
  await queueModel(env, { delivery: ['draft-missing-section'] });
  const missing = await call<SimulationRunRecord>(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-clean'] });
  assert.equal(missing.passed, false);
  assert.equal(missing.episodes[0].firstFailure, 'required-sections');
  assert.equal(missing.episodes[0].turns.filter(turn => turn.by === 'agent').length, 1);

  await queueModel(env, { judge: ['judge-no-claims'] });
  const judgedNo = await call<SimulationRunRecord>(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-messy'] });
  assert.equal(judgedNo.passed, false);
  assert.ok(judgedNo.episodes[0].checks.every(result => result.passed));
  assert.equal(judgedNo.episodes[0].firstFailure, 'no-unbacked-claims');

  await queueModel(env, { client: ['client-asks-person'] });
  const person = await call<SimulationRunRecord>(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-pushback'] });
  assert.equal(person.passed, false);
  assert.equal(person.episodes[0].firstFailure, 'The practice client asked for a person.');
  assert.equal(person.episodes[0].deliverable, null);

  // A draft the validator refuses is a failed episode, not a lost rehearsal.
  const bad = structuredClone(await fixture('draft-rehearsal'));
  bad.sections[0].parts[0].text = 'Your books will be ready in 2 days.';
  await queueModel(env, {});
  env.models.outputs.delivery = [bad];
  const refused = await call<SimulationRunRecord>(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-clean'] });
  assert.equal(refused.passed, false);
  assert.match(refused.episodes[0].firstFailure!, /^The draft was refused: /);
});

// ---------------------------------------------------------------------------
// 6. Launch ladder
// ---------------------------------------------------------------------------

test('launch ladder: template rehearsal cannot unlock shadow; judged model runs for all three can', async () => {
  const env = await setup();
  let status = await call<LaunchStatus>(env, 'venture.launch.status');
  const stage = (s: LaunchStatus, name: string) => s.stages.find(item => item.stage === name)!;
  assert.equal(status.stage, 'rehearsal');
  assert.equal(stage(status, 'rehearsal').allowed, true);
  assert.equal(stage(status, 'shadow').allowed, false);
  assert.equal(stage(status, 'shadow').reason, REASON_REHEARSE_ALL);
  assert.deepEqual(status.rehearsal.map(row => [row.scenarioId, row.runId, row.passed, row.judged]), [
    ['bookkeeping-clean', null, null, false], ['bookkeeping-messy', null, null, false], ['bookkeeping-pushback', null, null, false],
  ]);
  assert.deepEqual([stage(status, 'approve-sample'), stage(status, 'auto-spot-check')].map(item => [item.allowed, item.status, item.reason]), [
    [false, 'planned', 'Planned. Needs a sampling rule first.'], [false, 'planned', 'Planned. Not in this build.'],
  ]);
  assert.equal(status.improvement.status, 'planned');
  assert.equal(status.improvement.due, false);

  await call(env, 'venture.simulation.run', { useTemplate: true });
  status = await call<LaunchStatus>(env, 'venture.launch.status');
  assert.ok(status.rehearsal.every(row => row.passed === true && row.judged === false));
  assert.equal(stage(status, 'shadow').allowed, false);
  assert.equal(stage(status, 'shadow').reason, REASON_CONNECT_AI);
  await assert.rejects(call(env, 'venture.launch.advance', { to: 'shadow' }), (error: any) => error.code === 'LAUNCH_STAGE_BLOCKED' && error.message === REASON_CONNECT_AI);

  await queueModel(env, {});
  await call(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-clean'] });
  status = await call<LaunchStatus>(env, 'venture.launch.status');
  assert.deepEqual(status.rehearsal.map(row => row.judged), [true, false, false]);
  assert.equal(stage(status, 'shadow').allowed, false, 'one scenario is not enough');
  assert.equal(stage(status, 'shadow').reason, REASON_REHEARSE_ALL);

  for (const id of ['bookkeeping-messy', 'bookkeeping-pushback']) await call(env, 'venture.simulation.run', { scenarioIds: [id] });
  status = await call<LaunchStatus>(env, 'venture.launch.status');
  assert.ok(status.rehearsal.every(row => row.passed === true && row.judged === true));
  assert.equal(stage(status, 'shadow').allowed, true);
  assert.equal(stage(status, 'approve-each').allowed, false);
  assert.equal(status.lastRunPassed, true);

  await assert.rejects(call(env, 'venture.launch.advance', { to: 'approve-each' }), code('LAUNCH_STAGE_BLOCKED'));
  await assert.rejects(call(env, 'venture.launch.advance', { to: 'approve-sample' }), code('STAGE_PLANNED'));
  await assert.rejects(call(env, 'venture.launch.advance', { to: 'auto-spot-check' }), code('STAGE_PLANNED'));
  await assert.rejects(call(env, 'venture.launch.advance', { to: 'shadow' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.launch.advance', { to: 'live' }), code('INVALID_VENTURE_REQUEST'));

  status = await call<LaunchStatus>(env, 'venture.launch.advance', { to: 'shadow' });
  assert.equal(status.stage, 'shadow');
  assert.equal(stage(status, 'approve-each').allowed, true);
  status = await call<LaunchStatus>(env, 'venture.launch.advance', { to: 'approve-each' });
  assert.equal(status.stage, 'approve-each');
  assert.equal(env.store.read().conversations.find(r => r.kind === 'venture-record').status, 'live');
  await assert.rejects(call(env, 'venture.launch.advance', { to: 'approve-sample' }), code('STAGE_PLANNED'));
  status = await call<LaunchStatus>(env, 'venture.launch.advance', { to: 'rehearsal' });
  assert.equal(status.stage, 'rehearsal');
  assert.equal(env.store.read().conversations.find(r => r.kind === 'venture-record').status, 'rehearsal');
  assert.equal(events(env).filter(name => name === 'launch-stage-changed').length, 3);
});

test('launch ladder: the shadow reason says why a rehearsal with an AI did not count', async () => {
  const env = await setup();
  const all = { scenarioIds: ['bookkeeping-clean', 'bookkeeping-messy', 'bookkeeping-pushback'] };
  const ladder = async () => {
    const status = await call<LaunchStatus>(env, 'venture.launch.status');
    return { status, shadow: status.stages.find(item => item.stage === 'shadow')! };
  };

  // An AI is connected but its drafts were refused: not judged, and the owner is not told to connect an AI.
  const bad = structuredClone(await fixture('draft-rehearsal'));
  bad.sections[0].parts[0].text = 'Your books will be ready in 2 days.';
  await queueModel(env, {});
  env.models.outputs.delivery = [bad];
  const refused = await call<SimulationRunRecord>(env, 'venture.simulation.run', all);
  assert.equal(refused.modelMode, 'model');
  assert.ok(refused.episodes.every(episode => /^The draft was refused: /.test(episode.firstFailure ?? '')));
  let { status, shadow } = await ladder();
  assert.ok(status.rehearsal.every(row => row.runId === refused.id && !row.judged));
  assert.equal(shadow.allowed, false);
  assert.equal(shadow.reason, REASON_NOT_JUDGED);
  await assert.rejects(call(env, 'venture.launch.advance', { to: 'shadow' }), (error: any) => error.code === 'LAUNCH_STAGE_BLOCKED' && error.message === REASON_NOT_JUDGED);

  // The AI writes the drafts but templates serve quick work, so no AI judges them.
  await queueModel(env, {});
  env.models.fast = 'template';
  const noJudge = await call<SimulationRunRecord>(env, 'venture.simulation.run', all);
  assert.equal(noJudge.modelMode, 'mixed');
  assert.equal(noJudge.passed, true);
  ({ status, shadow } = await ladder());
  assert.ok(status.rehearsal.every(row => row.passed === true && !row.judged));
  assert.equal(shadow.reason, REASON_NO_JUDGE);

  // Templates write the drafts and the AI only judges them: still not a rehearsal with your AI.
  await queueModel(env, {});
  env.models.main = 'template';
  const templateDrafts = await call<SimulationRunRecord>(env, 'venture.simulation.run', all);
  assert.equal(templateDrafts.modelMode, 'mixed');
  assert.ok(templateDrafts.episodes.every(episode => episode.judge.every(answer => answer.answer === 'yes')));
  ({ shadow } = await ladder());
  assert.equal(shadow.reason, REASON_TEMPLATE_DRAFTS);

  // Every practice client judged by the AI, but one failed.
  await queueModel(env, { judge: ['judge-no-claims', 'judge-yes'] });
  const oneFailed = await call<SimulationRunRecord>(env, 'venture.simulation.run', all);
  assert.deepEqual(oneFailed.episodes.map(episode => episode.passed), [false, true, true]);
  ({ status, shadow } = await ladder());
  assert.ok(status.rehearsal.every(row => row.judged));
  assert.equal(shadow.reason, REASON_PASS_ALL);
  assert.equal(status.stages.find(item => item.stage === 'approve-each')!.reason, REASON_PASS_ALL);

  // Only template runs: the spec's words.
  const fresh = await setup();
  await call(fresh, 'venture.simulation.run', { useTemplate: true });
  const freshStatus = await call<LaunchStatus>(fresh, 'venture.launch.status');
  assert.equal(freshStatus.stages.find(item => item.stage === 'shadow')!.reason, REASON_CONNECT_AI);
  for (const reason of [REASON_NOT_JUDGED, REASON_NO_JUDGE, REASON_TEMPLATE_DRAFTS, REASON_PASS_ALL]) {
    assert.deepEqual(houseStyleFindings(reason), [], reason);
    assert.doesNotThrow(() => assertNoNumbers(reason, 'reason'), reason);
  }
});

// ---------------------------------------------------------------------------
// 7. Real delivery runs
// ---------------------------------------------------------------------------

test('real runs: a template outline at any stage; a model draft waits for approval and is blocked at rehearsal', async () => {
  const env = await setup();
  const { order } = await seedOrder(env);
  await assert.rejects(call(env, 'venture.delivery.run', { orderId: 'order_missing' }), code('ORDER_NOT_FOUND'));

  const outline = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(outline.status, 'ready-for-review');
  assert.equal(outline.servedBy, 'template');
  assert.equal(outline.practice, false);
  assert.equal(outline.callId, null);
  assert.ok(outline.renderedText!.startsWith(`${TEMPLATE_OUTLINE_LINE}\n\n# `));
  assert.ok(outline.renderedText!.includes('Here is the price for this work. Total: INR 2,948.82'), outline.renderedText!);
  assert.doesNotMatch(outline.renderedText!, /your plan/i);
  assert.ok(!outline.renderedText!.includes('September'), 'an outline never reads the request');
  assert.ok(outline.checks.every(result => result.passed), JSON.stringify(outline.checks));
  assert.equal(env.models.previewed.length, 0);
  assert.equal(env.models.generated.length, 0);
  const accepted = await call<DeliveryRunRecord>(env, 'venture.delivery.review', { runId: outline.id, verdict: 'accepted' });
  assert.equal(accepted.status, 'accepted');
  assert.equal((await call<LaunchStatus>(env, 'venture.launch.status')).acceptedDeliveries, 0, 'an outline is not an agent draft');

  await queueModel(env, { delivery: ['draft-order'] });
  const before = JSON.stringify(env.store.read().conversations);
  await assert.rejects(call(env, 'venture.delivery.run', { orderId: order.id }), (error: any) => error.code === 'LAUNCH_STAGE_BLOCKED' && error.message === 'Rehearse with your AI first, then move to shadow.');
  assert.equal(JSON.stringify(env.store.read().conversations), before);
  assert.equal(env.models.previewed.length, 0);
  // useTemplate still gives an outline at the rehearsal stage, with a model connected.
  const forced = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id, useTemplate: true });
  assert.equal(forced.servedBy, 'template');
});

test('real runs: shadow drafts are practice drafts; approve-each drafts can be accepted; signals become rehearsal cases', async () => {
  const env = await setup();
  const { order } = await seedOrder(env);
  await queueModel(env, { delivery: ['draft-order'] });
  env.models.recordCalls = true; // the real port records every call, so a stale digest can be told from a spent call
  await setStage(env, 'shadow');

  const waiting = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(waiting.status, 'waiting-for-you');
  assert.equal(waiting.practice, true);
  assert.equal(waiting.servedBy, 'model');
  assert.ok(waiting.preview!.payloadText.includes(ORDER_REQUEST));
  assert.equal(waiting.callId, waiting.preview!.callId);
  assert.equal(env.models.previewed.length, 1);
  assert.equal(env.models.previewed[0].containsClientData, true);
  assert.equal(env.models.generated.length, 0);
  const input = env.models.previewed[0].input as any;
  assert.deepEqual(input.figures.map((entry: any) => entry.ref), ['order.unit', 'order.total', 'order.tax']);
  assert.deepEqual(input.dates.map((entry: any) => entry.ref), ['today', 'order.created']);
  assert.ok(events(env).includes('delivery-waiting'));

  await assert.rejects(call(env, 'venture.delivery.approve', { runId: waiting.id, digest: '0'.repeat(64) }), code('APPROVAL_STALE'));
  assert.equal(stored(env, waiting.id).status, 'waiting-for-you', 'a wrong digest while the preview is live leaves the draft waiting');
  await assert.rejects(call(env, 'venture.delivery.approve', { runId: waiting.id, digest: waiting.preview!.digest }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.delivery.review', { runId: waiting.id, verdict: 'accepted' }), code('DELIVERY_NOT_READY'));
  const ready = await call<DeliveryRunRecord>(env, 'venture.delivery.approve', { runId: waiting.id, digest: waiting.preview!.digest });
  assert.equal(ready.status, 'ready-for-review');
  assert.equal(ready.practice, true);
  assert.equal(ready.preview, null);
  assert.ok(ready.renderedText!.includes('Total: INR 2,948.82'));
  assert.ok(ready.renderedText!.includes('Your order came in on 15 Oct 2026'));
  assert.deepEqual(ready.checks.map(result => result.check), CHECK_IDS.filter(id => id !== 'questions-raised' && id !== 'turn-limit'));
  assert.ok(ready.checks.every(result => result.passed), JSON.stringify(ready.checks));
  assert.equal(env.models.sent, 1);
  await assert.rejects(call(env, 'venture.delivery.approve', { runId: waiting.id, digest: waiting.preview!.digest }), code('DELIVERY_NOT_WAITING'));
  assert.equal(env.models.sent, 1);

  await assert.rejects(call(env, 'venture.delivery.review', { runId: ready.id, verdict: 'accepted' }), (error: any) => error.code === 'PRACTICE_DRAFT' && /Practice drafts are not for clients/.test(error.message));
  await assert.rejects(call(env, 'venture.delivery.review', { runId: ready.id, verdict: 'rejected' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.delivery.review', { runId: ready.id, verdict: 'edited' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.delivery.review', { runId: ready.id, verdict: 'rejected', reason: 'bad-reason' }), code('INVALID_VENTURE_REQUEST'));
  const edited = await call<DeliveryRunRecord>(env, 'venture.delivery.review', { runId: ready.id, verdict: 'edited', reason: 'tone', editedText: 'Hello,\nWe will start soon.' });
  assert.equal(edited.status, 'edited');
  assert.equal(edited.editedText, 'Hello,\nWe will start soon.');
  assert.deepEqual(edited.verdict, { choice: 'edited', reason: 'tone', at: clock().toISOString() });
  const signals = listRecords(env.store.read(), 'venture-signal');
  assert.equal(signals.length, 1);
  assert.equal(signals[0].source, 'owner-edited');
  assert.equal(signals[0].runId, ready.id);
  assert.ok(events(env).includes('signal-recorded'));
  assert.ok(events(env).includes('delivery-reviewed'));
  await assert.rejects(call(env, 'venture.delivery.review', { runId: ready.id, verdict: 'rejected', reason: 'tone' }), code('DELIVERY_NOT_READY'));

  // approve each: a real draft, not practice, that can be accepted.
  await setStage(env, 'approve-each');
  const second = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(second.practice, false);
  const secondReady = await call<DeliveryRunRecord>(env, 'venture.delivery.approve', { runId: second.id, digest: second.preview!.digest });
  const done = await call<DeliveryRunRecord>(env, 'venture.delivery.review', { runId: secondReady.id, verdict: 'accepted' });
  assert.equal(done.status, 'accepted');
  assert.equal((await call<LaunchStatus>(env, 'venture.launch.status')).acceptedDeliveries, 1);
  const list = await call<DeliveryRunRecord[]>(env, 'venture.delivery.list');
  assert.deepEqual(list.map(run => run.id), [second.id, waiting.id]);

  // A signal becomes a rehearsal case without the client's words.
  const scenario = await call<Scenario>(env, 'venture.simulation.fromSignal', { signalId: signals[0].id });
  assert.equal(scenario.id, `signal-${signals[0].id}`);
  assert.equal(scenario.source, 'signal');
  assert.equal(scenario.signalId, signals[0].id);
  assert.ok(scenario.checks.includes('house-style'));
  const scenarioText = JSON.stringify(scenario);
  for (const secret of [ORDER_REQUEST, 'September', CLIENT_NAME, CLIENT_EMAIL, 'We will start soon']) assert.ok(!scenarioText.includes(secret), secret);
  assert.equal(listRecords(env.store.read(), 'venture-signal')[0].scenarioId, scenario.id);
  const scenarios = await call<Scenario[]>(env, 'venture.simulation.scenarios');
  assert.deepEqual(scenarios.map(item => item.id), ['bookkeeping-clean', 'bookkeeping-messy', 'bookkeeping-pushback', scenario.id]);
  await assert.rejects(call(env, 'venture.simulation.fromSignal', { signalId: 'signal_missing' }), code('SIGNAL_NOT_FOUND'));
  // The signal case can be rehearsed.
  await queueModel(env, {});
  const signalRun = await call<SimulationRunRecord>(env, 'venture.simulation.run', { scenarioIds: [scenario.id] });
  assert.deepEqual(signalRun.scenarioIds, [scenario.id]);
});

test('real runs: a failed check on an approved draft records a signal; a refused answer marks the draft failed', async () => {
  const env = await setup();
  const { order } = await seedOrder(env);
  await setStage(env, 'approve-each');
  const claims = structuredClone(await fixture('claims-done'));
  claims.sections[1].parts[1].ref = 'order.total';
  await queueModel(env, {});
  env.models.outputs.delivery = [claims];
  const run = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id });
  const ready = await call<DeliveryRunRecord>(env, 'venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
  assert.equal(ready.checks.find(result => result.check === 'no-done-claims')!.passed, false);
  const signal = listRecords(env.store.read(), 'venture-signal').find(item => item.runId === run.id) as SignalRecord;
  assert.equal(signal.source, 'check-failed');
  assert.equal(signal.reason, 'no-done-claims');
  const scenario = await call<Scenario>(env, 'venture.simulation.fromSignal', { signalId: signal.id });
  assert.ok(scenario.checks.includes('no-done-claims'));
  // A draft that claims finished work can't be accepted and copied as it stands: the owner edits or rejects it.
  await assert.rejects(call(env, 'venture.delivery.review', { runId: run.id, verdict: 'accepted' }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && error.message === DONE_CLAIM_REASON);
  assert.equal(stored(env, run.id).status, 'ready-for-review');
  const rejected = await call<DeliveryRunRecord>(env, 'venture.delivery.review', { runId: run.id, verdict: 'rejected', reason: 'claims-work-not-done' });
  assert.equal(rejected.status, 'rejected');
  assert.equal((await call<LaunchStatus>(env, 'venture.launch.status')).acceptedDeliveries, 0);

  // Any other failed check also stops a plain accept, and says which check.
  const missing = structuredClone(await fixture('draft-order'));
  missing.sections = missing.sections.slice(0, 2);
  env.models.outputs.delivery = [missing];
  env.models.used = {};
  const short = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id });
  const shortReady = await approve(env, short);
  assert.equal(shortReady.checks.find(result => result.check === 'required-sections')!.passed, false);
  await assert.rejects(call(env, 'venture.delivery.review', { runId: short.id, verdict: 'accepted' }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && /^This draft failed a check: Missing sections: .+ Edit it or reject it\.$/.test(error.message));
  const fixedByOwner = await call<DeliveryRunRecord>(env, 'venture.delivery.review', { runId: short.id, verdict: 'edited', reason: 'missing-section', editedText: 'Hello,\nWe will start once you confirm.' });
  assert.equal(fixedByOwner.status, 'edited');

  env.models.recordCalls = true;
  const digitDraft = structuredClone(await fixture('draft-order'));
  digitDraft.sections[0].parts[0].text = 'We will finish in 3 days.';
  env.models.outputs.delivery = [digitDraft];
  env.models.used = {};
  const failing = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id });
  await assert.rejects(call(env, 'venture.delivery.approve', { runId: failing.id, digest: failing.preview!.digest }), code('MODEL_OUTPUT_REJECTED'));
  assert.equal(stored(env, failing.id).status, 'failed');
  await assert.rejects(call(env, 'venture.delivery.approve', { runId: failing.id, digest: failing.preview!.digest }), code('DELIVERY_NOT_WAITING'));
});

test('real runs: moving the stage down after a draft was made keeps agent drafts away from clients', async () => {
  const env = await setup();
  const { order } = await seedOrder(env);
  await queueModel(env, { delivery: ['draft-order'] });
  env.models.recordCalls = true;
  const down = (to: VentureRecord['launchStage']) => call<LaunchStatus>(env, 'venture.launch.advance', { to });
  const draftAtApproveEach = async () => {
    await setStage(env, 'approve-each');
    const run = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id });
    assert.equal(run.practice, false);
    return run;
  };

  // Made at approve each, approved after a move down to shadow: the answer is a practice draft.
  const first = await draftAtApproveEach();
  await down('shadow');
  const practice = await approve(env, first);
  assert.equal(practice.status, 'ready-for-review');
  assert.equal(practice.practice, true);
  await assert.rejects(call(env, 'venture.delivery.review', { runId: first.id, verdict: 'accepted' }), code('PRACTICE_DRAFT'));

  // Approved at approve each, reviewed after a move down to shadow: accept refuses, and an edit stays a practice draft.
  const second = await draftAtApproveEach();
  assert.equal((await approve(env, second)).practice, false);
  await down('shadow');
  await assert.rejects(call(env, 'venture.delivery.review', { runId: second.id, verdict: 'accepted' }), code('PRACTICE_DRAFT'));
  const edited = await call<DeliveryRunRecord>(env, 'venture.delivery.review', { runId: second.id, verdict: 'edited', reason: 'tone', editedText: 'Hello,\nWe will start soon.' });
  assert.equal(edited.status, 'edited');
  assert.equal(edited.practice, true, 'an edit made at shadow is not copied to a client');

  // Approved at approve each, reviewed after a move down to rehearsal: accept refuses too.
  const third = await draftAtApproveEach();
  await approve(env, third);
  await down('rehearsal');
  await assert.rejects(call(env, 'venture.delivery.review', { runId: third.id, verdict: 'accepted' }), code('PRACTICE_DRAFT'));

  // Made at approve each, approved after a move down to rehearsal: refused before anything is sent.
  const fourth = await draftAtApproveEach();
  await down('rehearsal');
  const sentBefore = env.models.sent;
  await assert.rejects(approve(env, fourth), (error: any) => error.code === 'LAUNCH_STAGE_BLOCKED' && error.message === STAGE_BLOCKED_REASON);
  assert.equal(env.models.sent, sentBefore);
  assert.equal(stored(env, fourth.id).status, 'waiting-for-you');

  // The stage moves down to rehearsal while the approved call is in flight: no draft is stored and the run fails.
  const fifth = await draftAtApproveEach();
  env.models.afterSend = () => down('rehearsal');
  await assert.rejects(approve(env, fifth), code('LAUNCH_STAGE_BLOCKED'));
  assert.equal(stored(env, fifth.id).status, 'failed');
  assert.equal(stored(env, fifth.id).preview, null);
  assert.equal(stored(env, fifth.id).deliverable, null);
  // ... and to shadow while in flight: the answer is stored as a practice draft.
  const sixth = await draftAtApproveEach();
  env.models.afterSend = () => down('shadow');
  const sixthReady = await approve(env, sixth);
  env.models.afterSend = null;
  assert.equal(sixthReady.practice, true);

  // A template outline needs no agent, so it can still be accepted at rehearsal.
  await down('rehearsal');
  const outline = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id, useTemplate: true });
  assert.equal((await call<DeliveryRunRecord>(env, 'venture.delivery.review', { runId: outline.id, verdict: 'accepted' })).status, 'accepted');
  assert.equal((await call<LaunchStatus>(env, 'venture.launch.status')).acceptedDeliveries, 0);
});

test('real runs: an approval after the preview expired marks the draft failed instead of leaving it waiting', async () => {
  const env = await setup();
  const { order } = await seedOrder(env);
  await queueModel(env, { delivery: ['draft-order'] });
  env.models.recordCalls = true;
  await setStage(env, 'approve-each');
  const run = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(run.preview!.expiresAt, PREVIEW_EXPIRES_AT);

  // While the preview is live, a stale approval (a wrong digest) leaves the draft waiting.
  await assert.rejects(approve(env, run, 'f'.repeat(64)), code('APPROVAL_STALE'));
  assert.equal(stored(env, run.id).status, 'waiting-for-you');

  // Thirty one minutes after the preview, which lasts thirty, it can never be approved, so the draft is marked failed.
  env.deps.clock = () => new Date('2026-10-15T10:31:00.000Z');
  await assert.rejects(approve(env, run), code('APPROVAL_STALE'));
  const failed = stored(env, run.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.preview, null);
  assert.equal(env.models.sent, 0);
  await assert.rejects(approve(env, run), code('DELIVERY_NOT_WAITING'));
  const listed = await call<DeliveryRunRecord[]>(env, 'venture.delivery.list');
  assert.equal(listed[0].status, 'failed');
});

test("Today's list: practice drafts drop off once the stage moves on, and Accept shows only where the engine takes it", async () => {
  const env = await setup();
  const { order } = await seedOrder(env);
  await queueModel(env, { delivery: ['draft-order'] });
  env.models.recordCalls = true;
  type View = DeliveryRunRecord & { practiceNow: boolean; awaitingYou: boolean; canApprove: boolean; canAccept: boolean; acceptBlocked: string | null };
  const flags = (run: View) => ({ practiceNow: run.practiceNow, awaitingYou: run.awaitingYou, canApprove: run.canApprove, canAccept: run.canAccept, acceptBlocked: run.acceptBlocked });
  const listed = async (runId: string) => {
    const found = (await call<View[]>(env, 'venture.delivery.list')).find(run => run.id === runId);
    assert.ok(found, runId);
    return found;
  };
  const views = await call<View[]>(env, 'venture.delivery.list');
  assert.deepEqual(views, []);

  // Shadow: a waiting draft can be approved and waits for the owner; once approved it is a practice draft to review.
  await setStage(env, 'shadow');
  const waiting = await call<View>(env, 'venture.delivery.run', { orderId: order.id });
  assert.deepEqual(flags(waiting), { practiceNow: true, awaitingYou: true, canApprove: true, canAccept: false, acceptBlocked: null });
  const practice = await call<View>(env, 'venture.delivery.approve', { runId: waiting.id, digest: waiting.preview!.digest });
  assert.deepEqual(flags(practice), { practiceNow: true, awaitingYou: true, canApprove: false, canAccept: false, acceptBlocked: PRACTICE_REASON });
  assert.deepEqual(flags(await listed(practice.id)), flags(practice));
  // The list never changes what is stored.
  assert.equal(Object.hasOwn(stored(env, practice.id), 'awaitingYou'), false);

  // Approve each: the practice draft from shadow stays in the list for review but no longer waits on Today.
  await setStage(env, 'approve-each');
  const left = await listed(practice.id);
  assert.equal(left.status, 'ready-for-review');
  assert.deepEqual(flags(left), { practiceNow: true, awaitingYou: false, canApprove: false, canAccept: false, acceptBlocked: PRACTICE_REASON });
  await assert.rejects(call(env, 'venture.delivery.review', { runId: practice.id, verdict: 'accepted' }), code('PRACTICE_DRAFT'));

  // A real draft at approve each: approvable, then acceptable, and both wait for the owner.
  const real = await call<View>(env, 'venture.delivery.run', { orderId: order.id });
  assert.deepEqual(flags(real), { practiceNow: false, awaitingYou: true, canApprove: true, canAccept: false, acceptBlocked: null });
  const realReady = await call<View>(env, 'venture.delivery.approve', { runId: real.id, digest: real.preview!.digest });
  assert.deepEqual(flags(realReady), { practiceNow: false, awaitingYou: true, canApprove: false, canAccept: true, acceptBlocked: null });

  // A waiting draft left at approve each, after a move down to rehearsal: the engine would refuse to send it.
  const stranded = await call<View>(env, 'venture.delivery.run', { orderId: order.id });
  await setStage(env, 'rehearsal');
  assert.deepEqual(flags(await listed(stranded.id)), { practiceNow: true, awaitingYou: false, canApprove: false, canAccept: false, acceptBlocked: null });
  await assert.rejects(approve(env, stranded), code('LAUNCH_STAGE_BLOCKED'));
  // ... and the ready real draft turns into a practice draft the engine refuses to accept, so it leaves Today too.
  assert.deepEqual(flags(await listed(realReady.id)), { practiceNow: true, awaitingYou: false, canApprove: false, canAccept: false, acceptBlocked: PRACTICE_REASON });
  await assert.rejects(call(env, 'venture.delivery.review', { runId: realReady.id, verdict: 'accepted' }), code('PRACTICE_DRAFT'));
  // Back at approve each it is a real draft again, and Accept works.
  await setStage(env, 'approve-each');
  assert.deepEqual(flags(await listed(realReady.id)), { practiceNow: false, awaitingYou: true, canApprove: false, canAccept: true, acceptBlocked: null });
  const accepted = await call<View>(env, 'venture.delivery.review', { runId: realReady.id, verdict: 'accepted' });
  assert.deepEqual(flags(accepted), { practiceNow: false, awaitingYou: false, canApprove: false, canAccept: false, acceptBlocked: null });

  // A draft with a failed check waits for the owner to edit or reject it, with Accept refused and the reason given.
  const claims = structuredClone(await fixture('claims-done'));
  claims.sections[1].parts[1].ref = 'order.total';
  env.models.outputs.delivery = [claims];
  env.models.used = {};
  const claimRun = await call<View>(env, 'venture.delivery.run', { orderId: order.id });
  const claimReady = await call<View>(env, 'venture.delivery.approve', { runId: claimRun.id, digest: claimRun.preview!.digest });
  assert.deepEqual(flags(claimReady), { practiceNow: false, awaitingYou: true, canApprove: false, canAccept: false, acceptBlocked: DONE_CLAIM_REASON });
  await assert.rejects(call(env, 'venture.delivery.review', { runId: claimRun.id, verdict: 'accepted' }), (error: any) => error.message === DONE_CLAIM_REASON);

  // A template outline needs no agent: at rehearsal it waits for the owner and can be accepted.
  await setStage(env, 'rehearsal');
  const outline = await call<View>(env, 'venture.delivery.run', { orderId: order.id, useTemplate: true });
  assert.deepEqual(flags(outline), { practiceNow: false, awaitingYou: true, canApprove: false, canAccept: true, acceptBlocked: null });

  // A waiting draft whose preview ran out (thirty minutes) can't be approved, so it leaves Today.
  await setStage(env, 'approve-each');
  env.models.outputs.delivery = [await fixture('draft-order')];
  env.models.used = {};
  const late = await call<View>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(late.canApprove, true);
  env.deps.clock = () => new Date('2026-10-15T10:31:00.000Z');
  assert.deepEqual(flags(await listed(late.id)), { practiceNow: false, awaitingYou: false, canApprove: false, canAccept: false, acceptBlocked: null });

  // Today's count: what still waits for the owner, as the screen counts it.
  const waitingNow = (await call<View[]>(env, 'venture.delivery.list')).filter(run => run.awaitingYou).map(run => run.id).sort();
  assert.deepEqual(waitingNow, [claimRun.id, outline.id].sort());
});

// ---------------------------------------------------------------------------
// 8. Capabilities
// ---------------------------------------------------------------------------

test('capabilities: honest states per platform, storage and model tier', async () => {
  const windows = capabilityList('win32');
  assert.deepEqual(windows.map(row => row.id), [
    'venture-actor', 'venture-events', 'schedules', 'hosted-actors', 'tier-code', 'tier-actor', 'durable-storage', 'tier-wasm-lite', 'tier-wasm',
    'tier-container', 'tier-hosted', 'model-fast', 'model-main', 'agent-tools', 'handoff-links', 'github-read', 'outside-writes',
  ]);
  const row = (list: ReturnType<typeof capabilityList>, id: string) => list.find(item => item.id === id)!;
  assert.equal(row(windows, 'tier-wasm').state, 'unavailable');
  assert.equal(row(windows, 'tier-wasm').reason, 'Not available on Windows yet.');
  assert.equal(row(capabilityList('linux'), 'tier-wasm').state, 'planned');
  assert.equal(row(capabilityList('darwin'), 'tier-wasm').reason, 'Planned: agentOS.');
  assert.equal(row(windows, 'tier-code').group, 'runtime');
  assert.equal(row(windows, 'tier-actor').group, 'runtime');
  assert.equal(row(windows, 'hosted-actors').state, 'planned');
  assert.equal(row(windows, 'tier-container').state, 'planned');
  assert.equal(row(windows, 'tier-hosted').state, 'planned');
  assert.equal(row(windows, 'agent-tools').state, 'planned');
  assert.equal(row(windows, 'outside-writes').state, 'planned');
  assert.equal(row(windows, 'durable-storage').state, 'planned');
  assert.equal(row(windows, 'durable-storage').reason, "This build keeps your business in experimental storage. Practise here; don't issue real invoices yet.");
  assert.equal(row(capabilityList('linux', undefined, 'postgres'), 'durable-storage').state, 'available');
  for (const id of ['model-fast', 'model-main']) {
    assert.equal(row(windows, id).state, 'needs-setup');
    assert.equal(row(windows, id).reason, 'No AI connected; built-in templates write outlines.');
    assert.equal(row(windows, id).group, 'models');
  }
  for (const item of windows) {
    assert.deepEqual(houseStyleFindings(item.reason), [], item.reason);
    assert.ok(['available', 'needs-setup', 'unverified', 'planned', 'unavailable'].includes(item.state));
  }

  const env = await setup();
  env.models.fast = 'model';
  const fromHandler = await call<ReturnType<typeof capabilityList>>(env, 'venture.capabilities');
  assert.equal(row(fromHandler, 'model-fast').state, 'available');
  assert.equal(row(fromHandler, 'model-main').state, 'needs-setup');
  assert.equal(row(fromHandler, 'tier-wasm').state, process.platform === 'win32' ? 'unavailable' : 'planned');
  const presets = [{ id: 'anthropic-haiku-5-5', label: 'Claude Haiku 5.5', availability: 'ready', availabilityReason: 'Uses your Anthropic key.' }] as ModelPreset[];
  const status = env.models.status(owner);
  assert.equal(row(capabilityList('linux', status, 'experimental-file', presets), 'model-fast').reason, 'Claude Haiku 5.5. Uses your Anthropic key.');
  const luna = { ...status, tiers: { ...status.tiers, main: { presetId: 'openai-gpt-6-luna' as const, model: 'gpt-6-luna', usable: true, reason: 'Unverified.' } } };
  assert.equal(row(capabilityList('linux', luna), 'model-main').state, 'unverified');
  const keyless = { ...status, tiers: { ...status.tiers, fast: { ...status.tiers.fast, usable: false, reason: 'Enter your key again.' } } };
  assert.deepEqual([row(capabilityList('linux', keyless), 'model-fast').state, row(capabilityList('linux', keyless), 'model-fast').reason], ['needs-setup', 'Enter your key again.']);
});

// ---------------------------------------------------------------------------
// 9. Handler table and schemas
// ---------------------------------------------------------------------------

test('handlers: exactly the twelve delivery methods', () => {
  const owned = VENTURE_METHODS.filter(method => METHOD_OWNERS[method] === 'delivery');
  assert.equal(owned.length, 12);
  assert.deepEqual(Object.keys(handlers).sort(), [...owned].sort());
  for (const method of owned) assert.equal(typeof handlers[method], 'function');
});

/** The same rule the model port applies: closed objects, every property required, no number types, a small keyword set. */
function assertSchemaSafe(schema: unknown) {
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description']);
  const walk = (node: any) => {
    assert.ok(node && typeof node === 'object');
    for (const key of Object.keys(node)) assert.ok(allowed.has(key), `keyword ${key}`);
    assert.ok(node.type !== 'number' && node.type !== 'integer');
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      for (const child of Object.values(node.properties)) walk(child);
    }
    if (node.type === 'array') walk(node.items);
  };
  walk(schema);
}

test('schemas: the draft, practice client and judge schemas are closed and have no number types', async () => {
  const env = await setup();
  await queueModel(env, {});
  await call(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-clean'] });
  const seen = new Set<string>();
  for (const task of env.models.generated) { assertSchemaSafe(task.schema); seen.add(task.schemaName); }
  assert.deepEqual([...seen].sort(), ['venture-client-sim', 'venture-delivery', 'venture-judge']);
  const deliverySchema = env.models.generated.find(task => task.purpose === 'delivery')!.schema as any;
  assert.deepEqual(deliverySchema.properties.sections.items.properties.heading.enum, [...REQUIRED_SECTIONS.bookkeeping]);
  assert.equal(env.models.generated.find(task => task.purpose === 'delivery')!.maxOutputTokens, 6144);
  assert.equal(env.models.generated.find(task => task.purpose === 'judge')!.maxOutputTokens, 1024);
  assert.equal(env.models.generated.find(task => task.purpose === 'client-sim')!.maxOutputTokens, 1024);
});

test('nesting: every model call in rehearsal and delivery runs outside any transaction', async () => {
  // The stub opens an empty store update before each call; VentureTestStore rejects one made inside a transaction.
  const env = await setup();
  const { order } = await seedOrder(env);
  await queueModel(env, {});
  await call(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-clean', 'bookkeeping-messy', 'bookkeeping-pushback'] });
  await setStage(env, 'shadow');
  env.models.outputs.delivery = [await fixture('draft-order')];
  env.models.used = {};
  const run = await call<DeliveryRunRecord>(env, 'venture.delivery.run', { orderId: order.id });
  const ready = await call<DeliveryRunRecord>(env, 'venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
  assert.equal(ready.status, 'ready-for-review');
});

test('static: every error code the package throws is listed, and no file does float arithmetic on money', async () => {
  const folder = new URL('../runtime/venture/delivery/', import.meta.url);
  const files = (await readdir(folder)).filter(name => name.endsWith('.ts'));
  assert.ok(files.length >= 10);
  // Engine codes this package passes through rather than introduces.
  const passThrough = new Set(['NOT_BUILT_YET', 'FORBIDDEN', 'ACCESS_REVOKED', 'REENTRANT_TRANSACTION', 'INVALID_PAYLOAD']);
  for (const name of files) {
    const source = await readFile(new URL(name, folder), 'utf8');
    for (const match of source.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) {
      assert.ok((VENTURE_ERRORS as readonly string[]).includes(match[1]) || passThrough.has(match[1]), `${name}: ${match[1]}`);
    }
    for (const banned of ['parseFloat', 'toFixed', 'Math.round', 'Number(']) assert.ok(!source.includes(banned), `${name} uses ${banned}`);
    assert.ok(!source.includes('—'), `${name} has a long dash`);
    assert.deepEqual(houseStyleFindings(source), [], name);
  }
});
