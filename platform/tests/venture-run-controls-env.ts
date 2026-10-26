// Test helper, not a test file: the run controls tests (Ink v2 wave 4, 4F1). A bookkeeping order with the client's
// files, run turn by turn through the handlers. The model port is a script: it answers from the task it is given,
// opens an empty store update before each call (so a call inside a transaction fails) and never touches the network.
// The container is fake too: its run can wait for the test, so a run can be stopped while a tool call is in progress.
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { PURPOSE_TIER, STEP_PLAN } from '../runtime/venture/contracts.ts';
import type {
  BlueprintRecord, CountryProfile, DeliveryRunRecord, DeliveryRunView, ModelOutcome, ModelPort, ModelPreset, ModelPreview, ModelPurpose,
  ModelStatusView, ModelTask, OrderRecord, PriceFigure, PriceReceiptRecord, QueueDecision, QueueList, RunControlResult, RunDetail,
  SandboxProcessRequest, VentureDeps, VentureRecord,
} from '../runtime/venture/contracts.ts';
import { digest, findRecord, listRecords, ventureAction, type VentureTx } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { PRACTICE_FILES } from '../runtime/venture/delivery/harness/practice.ts';
import { VentureTestStore } from './venture-test-store.ts';

export const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const phone: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' };
export const START = '2026-10-16T10:00:00.000Z';
export const ORDER_REQUEST = 'Please close my September books. The bank statement and the bills are attached.';
export const CLIENT = 'Cafe Aroma Demo';
export const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

const IN: CountryProfile = {
  code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india',
  tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', registrationNote: 'Check with a CA.', idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15' },
  paymentRails: ['razorpay'], dateOrder: 'day-month-year', complianceNotes: [],
};

type Responder = (task: ModelTask<any>) => unknown;

/** The scripted model port. inFlight runs after a call is claimed and before it answers (the call is out). */
export class ScriptPort implements ModelPort {
  store: VentureTestStore;
  fast: 'model' | 'template' = 'model';
  main: 'model' | 'template' = 'model';
  respond: Partial<Record<ModelPurpose, Responder>> = {};
  previewed: ModelTask<any>[] = [];
  sent = 0;
  inFlight: (() => Promise<void>) | null = null;
  #previews = new Map<string, { digest: string; task: ModelTask<any>; used: boolean }>();
  #calls = 0;
  constructor(store: VentureTestStore) { this.store = store; }
  status(): ModelStatusView {
    const tier = (mode: 'model' | 'template', presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => mode === 'model'
      ? { presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' }
      : { presetId: 'built-in-templates' as const, model: null, usable: true, reason: 'No AI connected; using built-in templates' };
    return { connections: [], tiers: { fast: tier(this.fast, 'anthropic-haiku-5-5'), main: tier(this.main, 'anthropic-sonnet-5-5') }, spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' } };
  }
  presets(): ModelPreset[] { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate<T>(): Promise<ModelOutcome<T>> { throw new ChausarError('CLIENT_DATA_NEEDS_APPROVAL', 'Client data needs your approval.'); }
  #tier(task: ModelTask<unknown>) { return this[PURPOSE_TIER[task.purpose]]; }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    await this.store.update(() => undefined);
    this.previewed.push(task);
    if (this.#tier(task) === 'template') return null;
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, { digest: digest(payloadText), task, used: false });
    await this.store.update(state => { state.conversations.push({ id: callId, kind: 'venture-model-call', status: 'preview' }); });
    return { callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'stub', endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: '2026-10-16T10:30:00.000Z' };
  }
  async runPreview<T>(ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    await this.store.update(() => undefined);
    if (ctx.channel !== 'desktop') throw new ChausarError('APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
    const held = this.#previews.get(callId);
    if (!held || held.used || held.digest !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again; the approved text is no longer available.');
    // As the real port does: the call is claimed in one write, and only from the vault's 'preview' status.
    const claimed = await this.store.update(state => {
      const call = state.conversations.find(record => record?.id === callId);
      if (!call || call.status !== 'preview') return false;
      call.status = 'dispatching';
      return true;
    });
    if (!claimed) throw new ChausarError('APPROVAL_STALE', 'Run it again; the approved text is no longer available.');
    held.used = true;
    this.sent += 1;
    if (this.inFlight) { const hook = this.inFlight; this.inFlight = null; await hook(); }
    await this.store.update(state => { const call = state.conversations.find(record => record?.id === callId); if (call) call.status = 'completed'; });
    const responder = this.respond[held.task.purpose];
    assert.ok(responder, `no responder for ${held.task.purpose}`);
    return { value: validate(structuredClone(responder(held.task))), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '200', priceConfirmed: true };
  }
}

const words = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
const STEP_TITLES = ['Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client'];

function blueprintRecord(tx: VentureTx): BlueprintRecord {
  const body = {
    version: 1, source: 'template' as const, structureHash: 'structure-hash', modelCallIds: [], serviceType: 'bookkeeping' as const,
    name: { value: 'Ledger Cafe Books', label: 'told-by-you' as const, by: 'owner' as const }, oneLiner: words('Monthly books for cafes.'), customer: words('Cafe owners.'),
    offers: [
      { id: 'offer_1', name: words('Monthly books'), description: words('Bank matching and a monthly report.'), pricing: { model: 'monthly' as const, quantityUnit: 'month' as const, unitPriceMinor: '249900', unitPriceLabel: 'told-by-you' as const, defaultQuantity: '1' } },
    ],
    deliverySteps: STEP_PLAN.map((plan, index) => ({ id: plan.id, title: words(STEP_TITLES[index]), doneBy: plan.doneBy, capability: plan.capability, note: plan.note })),
    approvals: [words('Every monthly report before it reaches a client')],
    backOffice: {
      currency: 'INR', taxMode: 'gst' as const, taxLabel: 'GST', taxRegistered: { value: true, label: 'told-by-you' as const, by: 'owner' as const }, taxRateBps: '1800', taxRateBy: 'country-table' as const,
      taxId: '27ZZZZZ9999Z1Z8', taxState: '27', sacCode: '998222', lutConfirmed: false, invoiceKind: 'tax-invoice' as const, taxInvoiceReady: true, taxInvoiceMissing: [], paymentRail: 'razorpay', invoicePrefix: 'INV',
    },
    starterConnectorIds: ['github', 'chausar-books'],
  };
  return { ...tx.base('venture-blueprint'), ...body, status: 'accepted', digest: digest(body) };
}

const figure = (key: PriceFigure['key'], label: string, minor: string, display: string): PriceFigure => ({ key, label, minor, display, currency: 'INR' });
function receiptRecord(tx: VentureTx, subject: PriceReceiptRecord['subject'], blueprintDigest: string): PriceReceiptRecord {
  return {
    ...tx.base('venture-price-receipt'), subject, operation: 'venture.price', currency: 'INR', minorDigits: 2,
    inputs: { unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxMode: 'gst', taxRateBps: '1800', taxTreatment: 'single', unitPriceBy: 'told-by-you', taxRateBy: 'country-table', blueprintDigest },
    steps: [], figures: [figure('unit', 'Unit price', '249900', 'INR 2,499.00'), figure('tax', 'GST at 18%', '44982', 'INR 449.82'), figure('total', 'Total', '294882', 'INR 2,948.82')],
    totalMinor: '294882', allowedNumbers: [], explanation: 'Synthetic receipt.', digest: 'receipt-digest', stale: false,
  };
}

export type Env = {
  store: VentureTestStore; models: ScriptPort; deps: VentureDeps; venture: VentureRecord; blueprint: BlueprintRecord;
  /** Runs while the fake container works on a call, before it answers. */
  container: (() => Promise<void>) | null;
  containerRuns: number;
  advance(ms: number): void;
};

export async function setup(stage: VentureRecord['launchStage'] = 'approve-each'): Promise<Env> {
  const store = new VentureTestStore();
  const models = new ScriptPort(store);
  let time = Date.parse(START);
  const env = { store, models, container: null, containerRuns: 0, advance: (ms: number) => { time += ms; } } as unknown as Env;
  const sandbox = {
    async process(request: SandboxProcessRequest) {
      const done = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', timedOut: false, truncated: false });
      if (request.args[0] === 'version') return done('27.0');
      if (request.args[0] === 'image') return done('sha256:fake');
      env.containerRuns += 1;
      if (env.container) { const hook = env.container; env.container = null; await hook(); }
      const rows = (JSON.parse(request.stdin) as { rows: unknown[] }).rows;
      return done(JSON.stringify({ rows: rows.map(() => ({ kind: 'supplies' })) }));
    },
  };
  env.deps = { store, clock: () => new Date(time), models, sandbox, services: { ontology: { current: () => null } }, github: {}, secrets: {}, host: 'test', demo: true, storage: 'experimental-file' } as unknown as VentureDeps;
  env.venture = await ventureAction(env.deps, owner, 'admin', 'create', tx => tx.put<VentureRecord>({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes in Pune, done by AI helpers with me checking every report.', ideaDigest: 'idea', workingName: 'Ledger Cafe Books',
    country: IN, serviceType: 'bookkeeping', status: 'live', launchStage: stage, blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  env.blueprint = await ventureAction(env.deps, owner, 'admin', 'seed.blueprint', tx => {
    const record = tx.put(blueprintRecord(tx));
    tx.touch({ blueprintId: record.id, acceptedBlueprintId: record.id });
    tx.put(receiptRecord(tx, { type: 'offer', offerId: 'offer_1' }, record.digest));
    return record;
  });
  return env;
}

export async function seedOrder(env: Env): Promise<OrderRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.order', tx => {
    const client = tx.put({ ...tx.base('venture-client'), name: CLIENT, email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null });
    const base = tx.base('venture-order');
    const receipt = tx.put(receiptRecord(tx, { type: 'order', orderId: base.id }, env.blueprint.digest));
    return tx.put<OrderRecord>({ ...base, clientId: client.id, offerId: 'offer_1', quantity: '1', request: ORDER_REQUEST, status: 'open', priceReceiptId: receipt.id, deliveredOn: null, saleFactId: null });
  });
}

/** An order with the bank statement (f1) and the bills (f2). */
export async function orderWithFiles(env: Env): Promise<OrderRecord> {
  const order = await seedOrder(env);
  for (const file of PRACTICE_FILES['bookkeeping-clean'].slice(0, 2)) await call(env, 'venture.files.add', { orderId: order.id, name: file.name.replace('september', 'aroma'), contentBase64: b64(file.content) });
  return order;
}

/** Calls a delivery or views handler, as the host would after its channel check. */
export function call<T>(env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const table = { ...delivery, ...views } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>;
  const handler = table[method];
  assert.ok(handler, method);
  return handler(env.deps, ctx, payload) as Promise<T>;
}

export const approve = (env: Env, run: DeliveryRunView) => call<DeliveryRunView>(env, 'venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
export const stop = (env: Env, runId: string, force = false, ctx: Context = owner) => call<RunControlResult>(env, 'venture.runs.stop', force ? { runId, force } : { runId }, ctx);
export const getRun = (env: Env, runId: string) => call<RunDetail>(env, 'venture.runs.get', { runId });
export const record = (env: Env, runId: string): DeliveryRunRecord => findRecord(env.store.read(), 'venture-delivery-run', runId)!;
export const queue = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
export const eventNames = (env: Env) => listRecords(env.store.read(), 'venture-event').sort((a, b) => a.seq - b.seq).map(event => event.name);
export const decide = (env: Env, row: { id: string; digest: string }, action: string, answer?: string) =>
  call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action, ...(answer === undefined ? {} : { answer }) });
/** Today's row about one run, from the run-control source (its subject starts runctl:). */
export async function controlRow(env: Env, runId: string) {
  return (await queue(env)).rows.find(row => row.id.startsWith('runctl:') && row.viewRef?.id === runId);
}

export const turnOf = (note: string, calls: [string, unknown][], finished = false) => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const part = (text: string) => ({ kind: 'text', text, ref: '' });
const fig = (ref: string) => ({ kind: 'figure', text: '', ref });
export const REPORT = {
  title: 'Your September books',
  sections: [
    { heading: 'Summary', parts: [part('We reconciled your bank statement against your bills, and the statement balances.')] },
    { heading: 'What we did', parts: [part('We matched each payment to a bill.'), fig('w1.matched-count'), part('The closing balance on the statement is below.'), fig('w1.statement-closing')] },
    { heading: 'What needs your answer', parts: [part('Nothing is open from this month.')] },
    { heading: 'Next steps', parts: [part('The fee for the month is below.'), fig('order.total')] },
  ],
  questionsForClient: [],
};
export const READ = turnOf('Look at the statement and the bills', [['files.list', {}], ['files.read', { target: 'f1', part: 'sample' }], ['files.read', { target: 'f2', part: 'sample' }]]);
export const RECONCILE = turnOf('Reconcile the statement against the bills', [['books.reconcile', {
  bank: 'f1', date: 'Date', description: 'Narration', moneyOut: 'Withdrawal', moneyIn: 'Deposit', balance: 'Balance',
  bills: [{ table: 'f2', vendor: 'Supplier', amount: 'Amount', date: 'Bill date', number: 'Bill number' }],
}]]);
export const PYTHON = turnOf('Sort the bills by supplier kind', [
  ['files.list', {}], ['sandbox.python', { table: 'f2', code: 'def transform(row):\n    return {"kind": "supplies"}' }], ['files.read', { target: 'f1', part: 'sample' }],
]);
export const BROKEN = turnOf('Try reading tables that are not there', [['files.read', { target: 'f9', part: 'sample' }], ['files.read', { target: 'f8', part: 'sample' }]]);
export const DONE = turnOf('Ready to write the report', [], true);
/**
 * A reading turn that differs from the ones before it, so a run can read for many turns without the repeat-failure
 * breaker (4F2) taking it for a loop: across six of them no step repeats more than twice.
 */
export const lookAround = (n: number) => {
  const parts = ['columns', 'sample', 'rows'];
  return turnOf('Look at the files again', [
    ['dictionary.browse', { query: `bank words, look ${'again '.repeat(n).trim() || 'first'}` }],
    ['files.read', { target: 'f1', part: parts[n % 3] }], ['files.read', { target: 'f2', part: parts[(n + 1) % 3] }],
  ]);
};

/** The agent's turns in order (the last one repeats) and the report the write step returns. */
export function scriptTurns(env: Env, turns: unknown[], report: unknown = REPORT) {
  let next = 0;
  env.models.respond['agent-turn'] = () => turns[Math.min(next++, turns.length - 1)];
  env.models.respond.delivery = () => report;
}

/** A started agent run on an order with files, waiting for approval of its first turn. */
export async function startRun(env: Env, turns: unknown[]): Promise<DeliveryRunView> {
  const order = await orderWithFiles(env);
  scriptTurns(env, turns);
  return call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
}
