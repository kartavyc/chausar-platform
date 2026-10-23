// Shared setup for the W1 package 1C tests (venture-spend-reserve, venture-harness-recheck): a bookkeeping business at
// approve each, one order with the practice bank statement and bills, and a scripted model port. Each preview may cost
// up to `estimate` and each approved call bills `cost`; the agent's turns and the report come from the script. Nothing
// here touches the network or pays for anything.
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { JUDGE_QUESTIONS, STEP_PLAN } from '../runtime/venture/contracts.ts';
import type {
  BlueprintRecord, DelegatePorts, DeliveryRunView, ModelOutcome, ModelPort, ModelPreset, ModelPreview, ModelStatusView, ModelTask, OrderRecord, PriceFigure,
  PriceReceiptRecord, VentureDeps, VentureRecord,
} from '../runtime/venture/contracts.ts';
import { digest, ventureAction, type VentureTx } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { PRACTICE_FILES } from '../runtime/venture/delivery/harness/practice.ts';
import { createDelegatePorts } from '../runtime/venture/delivery/harness/delegate-process.ts';
import { VentureTestStore } from './venture-test-store.ts';

export const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
export const AT = '2026-10-16T10:00:00.000Z';
export const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

/**
 * A scripted model port: each preview or call costs at most `estimate` and bills `cost`. Never the network. Like the
 * real port, generate refuses a task whose remaining run cap is below the estimate before anything is sent.
 */
/** The rules judge (delivery/judge/rules.ts) votes yes on every rule it is asked, citing the draft in the run's trace. */
const rulesYes = (task: ModelTask<any>) => ({ votes: (task.input as { rules: { id: string }[] }).rules.map(rule => ({ rule: rule.id, answer: 'yes', cites: ['draft'], quote: '', reason: 'It reads right.' })) });

export class ScriptPort implements ModelPort {
  store: VentureTestStore;
  estimate = '1000';
  cost = '200';
  sent = 0;
  turns: unknown[] = [];
  report: unknown = null;
  previewed: ModelTask<any>[] = [];
  generated: ModelTask<any>[] = [];
  #previews = new Map<string, { digest: string; task: ModelTask<any>; used: boolean }>();
  #calls = 0;
  #turn = 0;
  constructor(store: VentureTestStore) { this.store = store; }
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => ({ presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' });
    return { connections: [], tiers: { fast: tier('anthropic-haiku-5-5'), main: tier('anthropic-sonnet-5-5') }, spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' } };
  }
  presets(): ModelPreset[] { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    await this.store.update(() => undefined);
    this.generated.push(task);
    if (task.capLeftMicros !== undefined && BigInt(this.estimate) > BigInt(task.capLeftMicros)) throw new ChausarError('RUN_CAP_REACHED', 'Past what the run has left.');
    const raw = task.purpose === 'agent-turn' ? this.turns[Math.min(this.#turn++, this.turns.length - 1)]
      : task.purpose === 'client-sim' ? { message: 'It is the cafe current account.', asksForPerson: false }
        : task.schemaName === 'venture-judge-rules' ? rulesYes(task)
          : task.purpose === 'judge' ? { answers: JUDGE_QUESTIONS.map(question => ({ question, answer: 'yes', reason: 'It reads right.' })) } : undefined;
    this.#calls += 1;
    const value = raw === undefined ? task.template!() : task.validate(structuredClone(raw));
    return { value, by: 'model', callId: `call_${this.#calls}`, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: this.cost, priceConfirmed: true };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    await this.store.update(() => undefined);
    this.previewed.push(task);
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, { digest: digest(payloadText), task, used: false });
    await this.store.update(state => { state.conversations.push({ id: callId, kind: 'venture-model-call', status: 'preview' }); });
    return {
      callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'stub', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: this.estimate, estimatedMaxCostDisplay: `estimate ${this.estimate}`, expiresAt: '2026-10-16T10:30:00.000Z',
    };
  }
  async runPreview<T>(_ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    await this.store.update(() => undefined);
    const held = this.#previews.get(callId);
    if (!held || held.used || held.digest !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again; the approved text is no longer available.');
    held.used = true;
    this.sent += 1;
    const raw = held.task.purpose === 'agent-turn' ? this.turns[Math.min(this.#turn++, this.turns.length - 1)]
      : held.task.schemaName === 'venture-judge-rules' ? rulesYes(held.task) : this.report;
    return { value: validate(structuredClone(raw)), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: this.cost, priceConfirmed: true };
  }
}

const words = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
const STEP_TITLES = ['Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client'];
const figure = (key: PriceFigure['key'], label: string, minor: string, display: string): PriceFigure => ({ key, label, minor, display, currency: 'INR' });

function blueprintRecord(tx: VentureTx): BlueprintRecord {
  const body = {
    version: 1, source: 'template' as const, structureHash: 'structure-hash', modelCallIds: [], serviceType: 'bookkeeping' as const,
    name: { value: 'Ledger Cafe Books', label: 'told-by-you' as const, by: 'owner' as const }, oneLiner: words('Monthly books for cafes.'), customer: words('Cafe owners.'),
    offers: [{ id: 'offer_1', name: words('Monthly books'), description: words('Bank matching and a monthly report.'), pricing: { model: 'monthly' as const, quantityUnit: 'month' as const, unitPriceMinor: '249900', unitPriceLabel: 'told-by-you' as const, defaultQuantity: '1' } }],
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

function receiptRecord(tx: VentureTx, subject: PriceReceiptRecord['subject'], blueprintDigest: string): PriceReceiptRecord {
  return {
    ...tx.base('venture-price-receipt'), subject, operation: 'venture.price', currency: 'INR', minorDigits: 2,
    inputs: { unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxMode: 'gst', taxRateBps: '1800', taxTreatment: 'single', unitPriceBy: 'told-by-you', taxRateBy: 'country-table', blueprintDigest },
    steps: [], figures: [figure('unit', 'Unit price', '249900', 'INR 2,499.00'), figure('tax', 'GST at 18%', '44982', 'INR 449.82'), figure('total', 'Total', '294882', 'INR 2,948.82')],
    totalMinor: '294882', allowedNumbers: [], explanation: 'Synthetic receipt.', digest: 'receipt-digest', stale: false,
  };
}

export type RealOrderEnv = { store: VentureTestStore; models: ScriptPort; deps: VentureDeps; venture: VentureRecord; order: OrderRecord };
export type Handlers = Record<string, ((deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>) | undefined>;

export function call<T>(env: { deps: VentureDeps }, handlers: Handlers, method: string, payload: unknown = {}): Promise<T> {
  const handler = handlers[method];
  assert.ok(handler, method);
  return handler(env.deps, owner, payload) as Promise<T>;
}

/** A business at approve each with one open order and its two practice files, on a scripted model port. */
export async function realOrder(options: { delegate?: DelegatePorts } = {}): Promise<RealOrderEnv> {
  const store = new VentureTestStore();
  const models = new ScriptPort(store);
  const deps = {
    store, clock: () => new Date(AT), models, services: { ontology: { current: () => null } }, github: {}, secrets: {}, demo: true, storage: 'experimental-file',
    ...(options.delegate ? { host: 'desktop', claudeCodeTerms: 'accepted', delegate: options.delegate } : { host: 'test' }),
  } as unknown as VentureDeps;
  const venture = await ventureAction(deps, owner, 'admin', 'create', tx => tx.put<VentureRecord>({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes in Pune, done by AI helpers with me checking every report.', ideaDigest: 'idea', workingName: 'Ledger Cafe Books',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india', tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', registrationNote: 'Check with a CA.', idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15' }, paymentRails: ['razorpay'], dateOrder: 'day-month-year', complianceNotes: [] },
    serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  const blueprint = await ventureAction(deps, owner, 'admin', 'seed.blueprint', tx => {
    const record = tx.put(blueprintRecord(tx));
    tx.touch({ blueprintId: record.id, acceptedBlueprintId: record.id });
    tx.put(receiptRecord(tx, { type: 'offer', offerId: 'offer_1' }, record.digest));
    return record;
  });
  const order = await ventureAction(deps, owner, 'prepare', 'seed.order', tx => {
    const client = tx.put({ ...tx.base('venture-client'), name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null });
    const base = tx.base('venture-order');
    const receipt = tx.put(receiptRecord(tx, { type: 'order', orderId: base.id }, blueprint.digest));
    return tx.put<OrderRecord>({ ...base, clientId: client.id, offerId: 'offer_1', quantity: '1', request: 'Please close my September books.', status: 'open', priceReceiptId: receipt.id, deliveredOn: null, saleFactId: null });
  });
  const env = { store, models, deps, venture, order };
  for (const file of PRACTICE_FILES['bookkeeping-clean']) await call(env, delivery, 'venture.files.add', { orderId: order.id, name: file.name, contentBase64: b64(file.content) });
  return env;
}

export const startRun = (env: RealOrderEnv) => call<DeliveryRunView>(env, delivery, 'venture.delivery.run', { orderId: env.order.id });
export const approve = (env: RealOrderEnv, run: DeliveryRunView) => call<DeliveryRunView>(env, delivery, 'venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
export const runOf = async (env: RealOrderEnv, id: string) => (await call<DeliveryRunView[]>(env, delivery, 'venture.delivery.list')).find(item => item.id === id)!;
export const turnOf = (note: string, calls: [string, unknown][], finished = false) => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
export const decideBrief = (env: RealOrderEnv, run: DeliveryRunView, decision: 'approve' | 'decline') =>
  call<DeliveryRunView>(env, delivery, 'venture.delivery.delegate', { runId: run.id, digest: run.harness!.delegations!.at(-1)!.digest, decision });

/**
 * A fake `claude` on a search path of its own (fixtures/venture/delegate/fake-cli.mjs, as venture-delegate.test.ts):
 * it makes no model call and no network call, reports a cost of USD 0.0421, and leaves spy.json when it did the work.
 */
export function installFakeClaude(): { ports: DelegatePorts; started(): boolean; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'chausar-fake-cli-'));
  copyFileSync(new URL('./fixtures/venture/delegate/fake-cli.mjs', import.meta.url), join(dir, 'fake-cli.mjs'));
  if (process.platform === 'win32') writeFileSync(join(dir, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0fake-cli.mjs" %*\r\n`);
  else { writeFileSync(join(dir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, 'fake-cli.mjs')}" "$@"\n`); chmodSync(join(dir, 'claude'), 0o755); }
  writeFileSync(join(dir, 'mode.json'), JSON.stringify({ kind: 'claude', behavior: 'work' }));
  return { ports: createDelegatePorts({ pathEnv: dir }), started: () => existsSync(join(dir, 'spy.json')), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
