// Delivery harness, through the handlers: client files on an order, a real order run turn by turn with the owner
// approving each turn's exact text, a hand-off the owner answers, the reconciled month with receipts, and the gated
// improvement loop that keeps a new playbook version only when it wins. The model port is a script: it answers
// from the task it is given, opens an empty store update before each call (so a call inside a transaction fails),
// and never touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { PURPOSE_TIER, REQUIRED_SECTIONS, STEP_PLAN } from '../runtime/venture/contracts.ts';
import type {
  BlueprintRecord, CountryProfile, DeliveryRunView, Episode, ImprovementRunRecord, ImprovementStatus, ModelOutcome, ModelPort, ModelPreset,
  ModelPreview, ModelPurpose, ModelStatusView, ModelTask, OrderRecord, PlaybookPatch, PlaybookRecord, PriceFigure, PriceReceiptRecord, SignalRecord,
  SimulationRunRecord, UploadView, VentureDeps, VentureRecord, WorkReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { digest, findRecord, listRecords, ventureAction, type VentureTx } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/delivery/index.ts';
import { PRACTICE_FILES } from '../runtime/venture/delivery/harness/practice.ts';
import { REPORT_SECTIONS } from '../runtime/venture/delivery/harness/loop.ts';
import { applyPatch, describePatch, type PlaybookBody } from '../runtime/venture/delivery/harness/patches.ts';
import { diagnose, freeze, gate, scoreEpisode } from '../runtime/venture/delivery/improve.ts';
import { DONE_CLAIM_REASON, NO_QUICK_AI, PRACTICE_REASON } from '../runtime/venture/delivery/runs.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const phone: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' };
const clock = () => new Date('2026-10-16T10:00:00.000Z');
const ORDER_REQUEST = 'Please close my September books. The bank statement and the bills are attached.';
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

const IN: CountryProfile = {
  code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india',
  tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', registrationNote: 'Check with a CA.', idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15' },
  paymentRails: ['razorpay'], dateOrder: 'day-month-year', complianceNotes: [],
};

// ---------------------------------------------------------------------------
// A scripted model port
// ---------------------------------------------------------------------------

type Responder = (task: ModelTask<any>) => unknown;
class ScriptPort implements ModelPort {
  store: VentureTestStore;
  fast: 'model' | 'template' = 'model';
  main: 'model' | 'template' = 'model';
  respond: Partial<Record<ModelPurpose, Responder>> = {};
  generated: ModelTask<any>[] = [];
  previewed: ModelTask<any>[] = [];
  sent = 0;
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
  #answer<T>(task: ModelTask<T>): T {
    const responder = this.respond[task.purpose];
    assert.ok(responder, `no responder for ${task.purpose}`);
    return task.validate(structuredClone(responder(task)));
  }
  #tier(task: ModelTask<unknown>) { return this[PURPOSE_TIER[task.purpose]]; }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    await this.store.update(() => undefined);
    if (task.containsClientData) throw new ChausarError('CLIENT_DATA_NEEDS_APPROVAL', 'Client data needs your approval.');
    this.generated.push(task);
    if (this.#tier(task) === 'template') {
      if (!task.template) throw new ChausarError('NO_MODEL_CONNECTED', 'No AI connected.');
      return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
    }
    this.#calls += 1;
    return { value: this.#answer(task), by: 'model', callId: `call_${this.#calls}`, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '100', priceConfirmed: true };
  }
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
    held.used = true;
    this.sent += 1;
    await this.store.update(state => { const call = state.conversations.find(record => record?.id === callId); if (call) call.status = 'completed'; });
    const responder = this.respond[held.task.purpose];
    assert.ok(responder, `no responder for ${held.task.purpose}`);
    return { value: validate(structuredClone(responder(held.task))), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '200', priceConfirmed: true };
  }
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

const words = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
const STEP_TITLES = ['Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client'];

function blueprintRecord(tx: VentureTx, version = 1): BlueprintRecord {
  const body = {
    version, source: 'template' as const, structureHash: 'structure-hash', modelCallIds: [], serviceType: 'bookkeeping' as const,
    name: { value: 'Ledger Cafe Books', label: 'told-by-you' as const, by: 'owner' as const }, oneLiner: words('Monthly books for cafes.'), customer: words('Cafe owners.'),
    offers: [
      { id: 'offer_1', name: words('Monthly books'), description: words('Bank matching and a monthly report.'), pricing: { model: 'monthly' as const, quantityUnit: 'month' as const, unitPriceMinor: '249900', unitPriceLabel: 'told-by-you' as const, defaultQuantity: '1' } },
      { id: 'offer_2', name: words('Catch up'), description: words('A one time tidy up.'), pricing: { model: 'project' as const, quantityUnit: 'project' as const, unitPriceMinor: null, unitPriceLabel: 'not-set' as const, defaultQuantity: '1' } },
    ],
    deliverySteps: STEP_PLAN.map((plan, index) => ({ id: plan.id, title: words(STEP_TITLES[index]), doneBy: plan.doneBy, capability: plan.capability, note: plan.note })),
    approvals: [words('Every monthly report before it reaches a client'), words('Any message that asks a client for money')],
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

type Env = { store: VentureTestStore; models: ScriptPort; deps: VentureDeps; venture: VentureRecord; blueprint: BlueprintRecord };

async function setup(stage: VentureRecord['launchStage'] = 'approve-each'): Promise<Env> {
  const store = new VentureTestStore();
  const models = new ScriptPort(store);
  const deps = { store, clock, models, services: { ontology: { current: () => null } }, github: {}, secrets: {}, host: 'test', demo: true, storage: 'experimental-file' } as unknown as VentureDeps;
  const venture = await ventureAction(deps, owner, 'admin', 'create', tx => tx.put<VentureRecord>({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes in Pune, done by AI helpers with me checking every report.', ideaDigest: 'idea', workingName: 'Ledger Cafe Books',
    country: IN, serviceType: 'bookkeeping', status: 'live', launchStage: stage, blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  const blueprint = await ventureAction(deps, owner, 'admin', 'seed.blueprint', tx => {
    const record = tx.put(blueprintRecord(tx));
    tx.touch({ blueprintId: record.id, acceptedBlueprintId: record.id });
    tx.put(receiptRecord(tx, { type: 'offer', offerId: 'offer_1' }, record.digest));
    return record;
  });
  return { store, models, deps, venture, blueprint };
}

async function seedOrder(env: Env): Promise<OrderRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.order', tx => {
    const client = tx.put({ ...tx.base('venture-client'), name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null });
    const base = tx.base('venture-order');
    const receipt = tx.put(receiptRecord(tx, { type: 'order', orderId: base.id }, env.blueprint.digest));
    return tx.put<OrderRecord>({ ...base, clientId: client.id, offerId: 'offer_1', quantity: '1', request: ORDER_REQUEST, status: 'open', priceReceiptId: receipt.id, deliveredOn: null, saleFactId: null });
  });
}

function call<T>(env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const handler = (handlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method];
  assert.ok(handler, method);
  return handler(env.deps, ctx, payload) as Promise<T>;
}
const approve = (env: Env, run: DeliveryRunView) => call<DeliveryRunView>(env, 'venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
const eventNames = (env: Env) => listRecords(env.store.read(), 'venture-event').sort((a, b) => a.seq - b.seq).map(event => event.name);

const turnOf = (note: string, calls: [string, unknown][], finished = false) => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const part = (text: string) => ({ kind: 'text', text, ref: '' });
const fig = (ref: string) => ({ kind: 'figure', text: '', ref });
const REPORT = {
  title: 'Your September books',
  sections: [
    { heading: 'Summary', parts: [part('We reconciled your bank statement against your bills, and the statement balances.')] },
    { heading: 'What we did', parts: [part('We matched each payment to a bill.'), fig('w1.matched-count'), part('The closing balance on the statement is below.'), fig('w1.statement-closing')] },
    { heading: 'What needs your answer', parts: [part('Nothing is open from this month.')] },
    { heading: 'Next steps', parts: [part('The fee for the month is below.'), fig('order.total')] },
  ],
  questionsForClient: [],
};

// ---------------------------------------------------------------------------
// 1. Client files on an order
// ---------------------------------------------------------------------------

test('files: added in the app only, checked for size and format, kept as client data, listed without content', async () => {
  const env = await setup();
  const order = await seedOrder(env);
  const bank = PRACTICE_FILES['bookkeeping-clean'][0].content;
  await assert.rejects(call(env, 'venture.files.add', { orderId: order.id, name: 'bank.csv', contentBase64: b64(bank) }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.files.add', { orderId: 'order_missing', name: 'bank.csv', contentBase64: b64(bank) }), code('ORDER_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.files.add', { orderId: order.id, name: 'scan.jpg', contentBase64: b64('xyz') }), code('UNSUPPORTED_UPLOAD'));
  await assert.rejects(call(env, 'venture.files.add', { orderId: order.id, name: 'bank.csv', contentBase64: '***' }), code('UPLOAD_LIMIT'));
  await assert.rejects(call(env, 'venture.files.add', { orderId: order.id, name: 'huge.csv', contentBase64: b64('a'.repeat(1_500_000)) }), code('UPLOAD_LIMIT'));
  await assert.rejects(call(env, 'venture.files.add', { orderId: order.id, name: 'broken.csv', contentBase64: b64('a,"b\n1,2') }), code('TOOL_FAILED'));
  const added = await call<UploadView>(env, 'venture.files.add', { orderId: order.id, name: 'bank-september.csv', contentBase64: b64(bank) });
  assert.equal(added.format, 'csv');
  assert.equal(added.clientData, true);
  assert.equal('contentBase64' in added, false);
  assert.deepEqual(added.scope, { kind: 'order', orderId: order.id });
  const listed = await call<UploadView[]>(env, 'venture.files.list', { orderId: order.id });
  assert.deepEqual(listed.map(item => item.id), [added.id]);
  assert.ok(listed.every(item => !('contentBase64' in item)));
  const event = listRecords(env.store.read(), 'venture-event').find(item => item.name === 'upload-added')!;
  assert.deepEqual(Object.keys(event.data as object).sort(), ['format', 'orderId', 'uploadId'], 'the event never carries the file name');
});

// ---------------------------------------------------------------------------
// 2. A real order, turn by turn
// ---------------------------------------------------------------------------

async function orderWithFiles(env: Env): Promise<OrderRecord> {
  const order = await seedOrder(env);
  for (const file of PRACTICE_FILES['bookkeeping-clean']) await call(env, 'venture.files.add', { orderId: order.id, name: file.name.replace('september', 'aroma'), contentBase64: b64(file.content) });
  return order;
}

function scriptTurns(env: Env, turns: unknown[], report: unknown = REPORT) {
  let next = 0;
  env.models.respond['agent-turn'] = () => turns[Math.min(next++, turns.length - 1)];
  env.models.respond.delivery = () => report;
}

const READ = turnOf('Look at the statement and the bills', [['files.list', {}], ['files.read', { target: 'f1', part: 'sample' }], ['files.read', { target: 'f2', part: 'sample' }]]);
const RECONCILE = turnOf('Reconcile the statement against the bills', [['books.reconcile', {
  bank: 'f1', date: 'Date', description: 'Narration', moneyOut: 'Withdrawal', moneyIn: 'Deposit', balance: 'Balance',
  bills: [{ table: 'f2', vendor: 'Supplier', amount: 'Amount', date: 'Bill date', number: 'Bill number' }],
}]]);
const ASK = turnOf('Check which account this is', [['handoff.owner', { question: 'Is this the cafe current account?' }], ['files.list', {}]]);
const DONE = turnOf('Ready to write the report', [], true);

test('real order: each turn waits for approval of its exact text, tools run here between turns, and the report cites receipts', async () => {
  const env = await setup('approve-each');
  const order = await orderWithFiles(env);
  scriptTurns(env, [READ, RECONCILE, ASK, DONE]);

  let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(run.status, 'waiting-for-you');
  assert.equal(run.harness!.phase, 'act');
  assert.equal(run.uploadIds!.length, 2);
  assert.ok(run.canApprove && run.awaitingYou);
  const first = env.models.previewed.at(-1)!;
  assert.equal(first.purpose, 'agent-turn');
  assert.equal(first.containsClientData, true, 'every turn of a real order holds client data');
  assert.ok(run.preview!.payloadText.includes(ORDER_REQUEST));
  assert.ok(run.preview!.payloadText.includes('bank-statement-aroma.csv'));
  assert.equal(env.models.generated.length, 0, 'nothing goes out under standing consent');
  assert.equal(env.models.sent, 0);

  run = await approve(env, run);
  assert.equal(run.status, 'waiting-for-you');
  assert.deepEqual(run.harness!.toolCalls.map(item => [item.tool, item.outcome]), [['files.list', 'succeeded'], ['files.read', 'succeeded'], ['files.read', 'succeeded']]);
  assert.ok(env.models.previewed.at(-1)!.input && JSON.stringify(env.models.previewed.at(-1)!.input).includes('Narration'), 'the next turn sees what the tools read');
  await assert.rejects(approve(env, { ...run, preview: { ...run.preview!, digest: 'f'.repeat(64) } }), code('APPROVAL_STALE'));

  run = await approve(env, run);
  const receipts = listRecords(env.store.read(), 'venture-work-receipt');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].reconciliation!.balanced, true);
  assert.deepEqual(receipts[0].runRef, { kind: 'delivery', runId: run.id });
  assert.deepEqual(run.harness!.workReceiptIds, [receipts[0].id]);

  run = await approve(env, run);
  assert.equal(run.status, 'needs-answer');
  assert.equal(run.callId, null);
  assert.equal(run.preview, null);
  assert.ok(run.awaitingYou && !run.canApprove);
  assert.equal(run.harness!.toolCalls.at(-1)!.outcome, 'cancelled', 'the call after the hand-off did not run');
  await assert.rejects(call(env, 'venture.delivery.approve', { runId: run.id, digest: 'a'.repeat(64) }), code('DELIVERY_NOT_WAITING'));
  await assert.rejects(call(env, 'venture.delivery.answer', { runId: run.id, answer: 'Yes.' }, phone), code('APP_APPROVAL_REQUIRED'));
  assert.ok(eventNames(env).includes('delivery-needs-answer'));

  run = await call<DeliveryRunView>(env, 'venture.delivery.answer', { runId: run.id, answer: 'Yes, the cafe current account.' });
  assert.equal(run.status, 'waiting-for-you');
  assert.ok(run.preview!.payloadText.includes('the cafe current account'));
  await assert.rejects(call(env, 'venture.delivery.answer', { runId: run.id, answer: 'Again.' }), code('DELIVERY_NOT_ASKING'));

  run = await approve(env, run);
  assert.equal(run.harness!.phase, 'write');
  const write = env.models.previewed.at(-1)!;
  assert.equal(write.purpose, 'delivery');
  assert.equal(write.containsClientData, true);
  const input = write.input as any;
  assert.deepEqual(input.requiredSections, [...REPORT_SECTIONS]);
  assert.ok(input.figures.some((entry: any) => entry.ref === 'w1.statement-closing'));
  assert.ok(input.proven.includes('The statement balances: the closing balance worked out equals the one on the statement.'));
  assert.equal(input.attached, 'A reconciliation table worked out by the calculator.');

  run = await approve(env, run);
  assert.equal(run.status, 'ready-for-review');
  assert.equal(run.harness!.phase, 'done');
  assert.deepEqual(run.deliverable!.attachments, [{ kind: 'reconciliation', receiptId: receipts[0].id }]);
  assert.ok(run.checks.every(result => result.passed), JSON.stringify(run.checks));
  assert.equal(run.checks.find(result => result.check === 'no-done-claims')!.detail, 'Every claim of finished work matches a tool run that proves it.');
  for (const line of ['Payments matched to bills: 5', 'Closing balance on the statement: INR 77,730.00', '## Reconciliation', 'The statement balances.', 'Total: INR 2,948.82']) {
    assert.ok(run.renderedText!.includes(line), line);
  }
  assert.equal(env.models.sent, 5);
  assert.equal(env.models.generated.length, 0);
  const receipt = await call<WorkReceiptRecord>(env, 'venture.work.get', { id: receipts[0].id });
  assert.equal(receipt.operation, 'work.reconcile');
  await assert.rejects(call(env, 'venture.work.get', { id: 'work_missing' }), code('WORK_RECEIPT_NOT_FOUND'));
  const accepted = await call<DeliveryRunView>(env, 'venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  assert.equal(accepted.status, 'accepted');
});

test('real order: at shadow the report is a practice draft, a claim no tool proved blocks Accept, and moving down stops the next send', async () => {
  const env = await setup('shadow');
  const order = await orderWithFiles(env);
  const sent = { ...REPORT, sections: REPORT.sections.map(section => section.heading === 'Next steps' ? { heading: section.heading, parts: [part('We have sent the report to your accountant.')] } : section) };
  scriptTurns(env, [RECONCILE, DONE], sent);
  let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  run = await approve(env, run);
  run = await approve(env, run);
  assert.equal(run.status, 'ready-for-review');
  assert.equal(run.practice, true);
  const claim = run.checks.find(result => result.check === 'no-done-claims')!;
  assert.equal(claim.passed, false, 'sending is never proven');
  assert.match(claim.detail, /We have sent/);
  assert.equal(run.acceptBlocked, PRACTICE_REASON);
  await assert.rejects(call(env, 'venture.delivery.review', { runId: run.id, verdict: 'accepted' }), code('PRACTICE_DRAFT'));
  assert.ok(listRecords(env.store.read(), 'venture-signal').some(signal => signal.reason === 'no-done-claims'));

  await ventureAction(env.deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  const view = (await call<DeliveryRunView[]>(env, 'venture.delivery.list')).find(item => item.id === run.id)!;
  assert.equal(view.acceptBlocked, PRACTICE_REASON, 'a practice draft stays practice');

  // A run waiting at approve each, then the owner moves down to rehearsal: the next turn is never sent.
  scriptTurns(env, [RECONCILE, DONE]);
  let next = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  const before = env.models.sent;
  await ventureAction(env.deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'rehearsal' }); });
  await assert.rejects(approve(env, next), code('LAUNCH_STAGE_BLOCKED'));
  assert.equal(env.models.sent, before);
  next = (await call<DeliveryRunView[]>(env, 'venture.delivery.list')).find(item => item.id === next.id)!;
  assert.equal(next.canApprove, false);
});

test('real order: report headings without proven work are refused, and without an AI for quick work the agent writes from the message', async () => {
  const env = await setup('approve-each');
  const order = await orderWithFiles(env);
  scriptTurns(env, [DONE]);
  let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  assert.equal(run.harness!.sections, 'reply', 'no tool proved work, so the reply headings apply');
  assert.deepEqual((env.models.previewed.at(-1)!.input as { requiredSections: string[] }).requiredSections, [...REQUIRED_SECTIONS.bookkeeping]);
  // The model answers with report headings anyway: the answer is refused and the spent draft is marked failed.
  await assert.rejects(approve(env, run), code('MODEL_OUTPUT_REJECTED'));
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').find(item => item.id === run.id)!.status, 'failed');

  env.models.fast = 'template';
  env.models.respond.delivery = () => ({
    title: 'Plan for your books',
    sections: REQUIRED_SECTIONS.bookkeeping.map(heading => ({ heading, parts: [part('We matched every payment already.')] })),
    questionsForClient: [],
  });
  run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(run.harness!.phase, 'write');
  assert.equal(run.harness!.stopReason, NO_QUICK_AI);
  assert.equal(env.models.previewed.at(-1)!.purpose, 'delivery');
  run = await approve(env, run);
  assert.equal(run.acceptBlocked, DONE_CLAIM_REASON);
});

test('hosted server: a real bookkeeping order reconciles from CSV with no sandbox, code tools are refused and not offered, and PDFs are refused', async () => {
  const env = await setup('approve-each');
  const dockerCalls: unknown[] = [];
  const helperCalls: unknown[] = [];
  env.deps.host = 'hosted-web';
  env.deps.sandbox = { process: async request => { dockerCalls.push(request.args); return { exitCode: 0, stdout: '', stderr: '', timedOut: false, truncated: false }; } };
  (env.deps.services as { helper?: unknown }).helper = { async run(operation: string) { helperCalls.push(operation); return { result: { pages: [] }, receipt: {} }; } };
  const order = await seedOrder(env);
  await assert.rejects(call(env, 'venture.files.add', { orderId: order.id, name: 'bill.pdf', contentBase64: b64('%PDF-1.7 synthetic bill') }), code('TIER_UNAVAILABLE'));
  assert.deepEqual(listRecords(env.store.read(), 'venture-upload'), [], 'a PDF is refused before it is stored');
  for (const file of PRACTICE_FILES['bookkeeping-clean']) await call(env, 'venture.files.add', { orderId: order.id, name: file.name, contentBase64: b64(file.content) });

  const CODE = turnOf('Try a program for supplier kinds', [
    ['sandbox.transform', { table: 'f2', program: 'out kind = if contains(lower(col("Supplier")), "dairy") then "Supplies" else "Overheads"' }],
    ['sandbox.python', { table: 'f2', code: 'def transform(row):\n    return {"kind": "x"}' }],
  ]);
  scriptTurns(env, [READ, CODE, RECONCILE, DONE]);
  let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  const offered = (env.models.previewed.at(-1)!.input as { tools: { tool: string }[] }).tools.map(item => item.tool);
  for (const name of ['sandbox.transform', 'sandbox.python', 'bills.pick']) assert.ok(!offered.includes(name), `${name} is not offered on the hosted server`);
  assert.ok(offered.includes('books.reconcile') && offered.includes('files.read'));
  assert.ok(!run.preview!.payloadText.includes('rowLanguage'));
  assert.ok(run.harness!.grant.includes('sandbox.transform'), 'the playbook grant itself is unchanged');

  run = await approve(env, run);
  run = await approve(env, run);
  const refused = run.harness!.toolCalls.filter(item => item.tool.startsWith('sandbox.'));
  assert.deepEqual(refused.map(item => [item.tool, item.outcome, item.envelope.ok ? null : item.envelope.error.code]), [
    ['sandbox.transform', 'failed', 'TIER_UNAVAILABLE'], ['sandbox.python', 'failed', 'TIER_UNAVAILABLE'],
  ]);
  assert.deepEqual(listRecords(env.store.read(), 'venture-work-table'), [], 'no table was made by agent code');
  run = await approve(env, run);
  run = await approve(env, run);
  run = await approve(env, run);
  assert.equal(run.status, 'ready-for-review');
  const receipts = listRecords(env.store.read(), 'venture-work-receipt');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].reconciliation!.balanced, true);
  assert.equal(receipts[0].reconciliation!.matched.length, 5, 'every payment matched without agent keys');
  assert.ok(run.checks.every(result => result.passed), JSON.stringify(run.checks));
  for (const line of ['Payments matched to bills: 5', 'Closing balance on the statement: INR 77,730.00', 'The statement balances.']) assert.ok(run.renderedText!.includes(line), line);
  assert.deepEqual(dockerCalls, [], 'nothing checked for Docker or started a container');
  assert.deepEqual(helperCalls, [], 'the Python helper never ran');
});

// ---------------------------------------------------------------------------
// 3. The improvement loop: patches, freezing, diagnosis, the gate
// ---------------------------------------------------------------------------

const patch = (op: PlaybookPatch['op'], stepId: string, value: string, level: PlaybookPatch['level'] = 'harness'): PlaybookPatch => ({
  id: 'patch_1', level, op, stepId, value, note: { hypothesis: 'Test.', expectedFixes: [], likelyRegressions: [] }, proposedBy: 'chausar', parentHash: 'h',
});

test('patches: one typed change at a time, checked by code before any spend', async () => {
  const env = await setup();
  const playbook = await call<PlaybookRecord>(env, 'venture.delivery.playbook');
  const body: PlaybookBody = { steps: playbook.steps, limits: playbook.limits!, aliases: playbook.aliases! };
  const context = { serviceType: 'bookkeeping' as const, entryIds: ['term.client', 'concept.reconciliation'] };
  const added = applyPatch(body, patch('guidance.add', 'draft', 'Use every required heading once, in the order given.'), context);
  assert.deepEqual(added.steps.find(step => step.id === 'draft')!.guidance, ['Use every required heading once, in the order given.']);
  assert.deepEqual(body.steps.find(step => step.id === 'draft')!.guidance, [], 'the input body is never changed');
  const refusals: [PlaybookPatch, RegExp][] = [
    [patch('guidance.add', 'draft', 'Add up the bills yourself before writing.'), /do sums/],
    [patch('guidance.add', 'draft', 'Charge 500 more.'), /contained a number/],
    [patch('guidance.add', 'price', 'Plain words here.'), /not an agent or writing step/],
    [patch('tools.grant', 'work', 'outbox.propose', 'tools'), /never holds them/],
    [patch('tools.grant', 'draft', 'files.read', 'tools'), /not an agent step/],
    [patch('tools.grant', 'work', 'inbox.read', 'tools'), /no tool called/],
    [patch('tools.revoke', 'gather', 'books.reconcile', 'tools'), /does not hold/],
    [patch('checks.add', 'verify', 'made-up-check'), /no check called/],
    [patch('limits.turns', 'gather', '7', 'tools'), /one of/],
    [patch('alias.add', 'gather', 'term.unknown=customer', 'tools'), /no entry/],
  ];
  for (const [item, reason] of refusals) assert.throws(() => applyPatch(body, item, context), (error: any) => error.code === 'INVALID_VENTURE_REQUEST' && reason.test(error.message), item.op);
  assert.throws(() => applyPatch(body, patch('tools.grant', 'work', 'books.reconcile', 'tools'), { ...context, serviceType: 'content' }), /content agent may not hold/);
  const turns = applyPatch(body, patch('limits.turns', 'gather', '6', 'tools'), context);
  assert.deepEqual([turns.limits.maxTurns, turns.limits.maxToolCalls], [6, 18]);
  const alias = applyPatch(body, patch('alias.add', 'gather', 'concept.reconciliation=month close', 'tools'), context);
  assert.deepEqual(alias.aliases, { 'concept.reconciliation': ['month close'] });
  assert.equal(describePatch(patch('tools.grant', 'work', 'calc.sum', 'tools'), body.steps), 'Lets "Sort and match every entry" use calc.sum.');
});

const signal = (id: string, at: string, reason: SignalRecord['reason']): SignalRecord => ({ id, kind: 'venture-signal', ventureId: 'v', memberId: 'owner', epoch: 1, at, source: 'owner-rejected', runId: 'run', reason, scenarioId: null });

test('improvement: signals freeze into a pool and a later held-back reserve; diagnosis attributes each reason to one level', () => {
  const signals = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => signal(`signal_${id}`, `2026-10-0${i + 1}T00:00:00.000Z`, 'missing-section'));
  const frozen = freeze([...signals].reverse(), 'bookkeeping');
  assert.deepEqual(frozen.pool.map(item => item.id), ['signal_a', 'signal_b', 'signal_c', 'signal_d', 'signal_e']);
  assert.deepEqual(frozen.reserve.map(item => item.id), ['signal_f', 'signal_g'], 'the latest thirty percent are held back');
  assert.deepEqual(frozen.cases.rehearsal.map(item => item.scenarioId), ['bookkeeping-clean', 'bookkeeping-messy', 'bookkeeping-pushback']);
  assert.deepEqual(freeze([signals[0]], 'bookkeeping').reserve, [], 'one signal is too few to hold any back');

  const mixed = diagnose([signal('s1', 'a', 'wrong-number'), signal('s2', 'b', 'wrong-number'), signal('s3', 'c', 'tone'), signal('s4', 'd', 'wrong-fact')], [], new Set());
  assert.deepEqual(mixed.clusters.map(item => [item.reason, item.level, item.count]), [['wrong-number', 'calculator', 2], ['tone', 'harness', 1], ['wrong-fact', 'dictionary', 1]]);
  assert.deepEqual(mixed.chosen, { reason: 'tone', step: 'draft', level: 'harness' }, 'a wrong number is never fixed in a prompt');
  assert.equal(diagnose([signal('s1', 'a', 'wrong-number')], [], new Set()).chosen, null);
  assert.equal(diagnose([signal('s1', 'a', 'tone')], [], new Set(['tone'])).chosen, null, 'a reason already tried is not tried again');
});

const score = (fields: Partial<ReturnType<typeof scoreEpisode>>) => ({ passed: true, checksPassed: 8, checksRun: 8, judgeYes: 4, critical: null, firstFailure: null, ...fields });

test('improvement: the gate keeps a candidate only with net wins, no new critical error and no newly failed case', () => {
  const failing = score({ passed: false, checksPassed: 7, firstFailure: 'required-sections' });
  const cases = (pairs: [ReturnType<typeof score>, ReturnType<typeof score>][]) => pairs.map(([parent, candidate], i) => ({ scenarioId: `case_${i}`, set: 'rehearsal' as const, parent, candidate }));
  assert.equal(gate(cases([[failing, score({})], [score({}), score({})]]), false).decision, 'keep-candidate');
  assert.equal(gate(cases([[score({}), score({})]]), false).decision, 'keep-parent', 'a tie keeps the parent');
  const critical = gate(cases([[failing, score({})], [failing, score({})], [score({}), score({ passed: false, critical: 'no-done-claims' })]]), false);
  assert.equal(critical.decision, 'keep-parent');
  assert.equal(critical.candidateCritical, 1);
  const regress = gate(cases([[failing, score({})], [failing, score({})], [score({}), failing]]), false);
  assert.deepEqual([regress.decision, regress.newBlockFailures], ['keep-parent', 1]);
  const same = gate(cases([[failing, score({})]]), true);
  assert.equal(same.decision, 'keep-parent');
  assert.match(same.reason, /Without an AI/);
  const episode = { checks: [{ check: 'figures-resolve', passed: false, detail: 'x' }], judge: [], passed: false, firstFailure: 'figures-resolve' } as unknown as Episode;
  assert.equal(scoreEpisode(episode).critical, 'figures-resolve');
});

// ---------------------------------------------------------------------------
// 4. The improvement loop end to end
// ---------------------------------------------------------------------------

const SECTIONS_GUIDANCE = 'Use every required heading once, in the order given.';
function improvementScript(env: Env, proposal: unknown) {
  const full = (headings: readonly string[]) => ({
    title: 'Your books plan', questionsForClient: ['Which month should we start with?'],
    sections: headings.map((heading, index) => ({ heading, parts: [part(index === 1 ? 'We will sort your bills and match them to the statement.' : 'Plain words about the work ahead.')] })),
  });
  // A draft that skips a heading unless the playbook's writing guidance asks for every one.
  env.models.respond.delivery = task => {
    const input = task.input as { requiredSections: string[]; guidance?: string[] };
    const headings = input.guidance?.includes(SECTIONS_GUIDANCE) ? input.requiredSections : input.requiredSections.slice(0, -1);
    return full(headings);
  };
  env.models.respond['agent-turn'] = () => DONE;
  env.models.respond['client-sim'] = () => ({ message: 'Hello, I need help with my books for the month.', asksForPerson: false });
  env.models.respond.judge = () => ({ answers: ['goal-met', 'tone-fits', 'policy-followed', 'no-unbacked-claims'].map(question => ({ question, answer: 'yes', reason: 'Fine.' })) });
  env.models.respond.improve = () => proposal;
}

async function seedSignals(env: Env, reasons: SignalRecord['reason'][]) {
  await ventureAction(env.deps, owner, 'prepare', 'seed.signals', tx => {
    reasons.forEach(reason => tx.put({ ...tx.base('venture-signal'), source: 'owner-rejected', runId: 'delivery_x', reason, scenarioId: null }));
  });
}

test('improvement run: a winning patch becomes a new version, the old one is never overwritten, and the owner adopts it with one tap', async () => {
  const env = await setup('approve-each');
  const parent = await call<PlaybookRecord>(env, 'venture.delivery.playbook');
  const parentBefore = structuredClone(findRecord(env.store.read(), 'venture-playbook', parent.id));
  await assert.rejects(call(env, 'venture.improve.run'), code('IMPROVEMENT_NOT_READY'));
  await seedSignals(env, ['missing-section', 'missing-section']);
  // The AI proposes a change that asks for sums; code refuses it and Chausar's rule for the same reason is tried.
  improvementScript(env, { level: 'harness', hypothesis: 'Totals in words will help.', op: 'guidance.add', stepId: 'draft', value: 'Add up the bill totals in the summary.', expectedFixes: ['missing-section'], likelyRegressions: [] });
  const run = await call<ImprovementRunRecord>(env, 'venture.improve.run', { maxRounds: 2 });
  assert.equal(run.status, 'kept-candidate', JSON.stringify(run.rounds.map(round => [round.refused, round.gate?.reason])));
  assert.equal(run.frozen.reserve.length, 1);
  assert.equal(run.frozen.pool.length, 1);
  const first = run.rounds[0];
  assert.equal(first.diagnosis.chosen!.reason, 'missing-section');
  assert.equal(first.patch!.proposedBy, 'chausar');
  assert.equal(first.patch!.value, SECTIONS_GUIDANCE);
  assert.equal(first.gate!.decision, 'keep-candidate');
  assert.ok(first.gate!.wins > first.gate!.losses);
  assert.deepEqual(first.gate!.cases.map(item => item.set).sort(), ['rehearsal', 'rehearsal', 'rehearsal', 'reserve']);
  assert.match(run.rounds[1].refused ?? '', /No other failure/);
  assert.deepEqual(run.changes, [`Adds to "Draft the monthly report for review": ${SECTIONS_GUIDANCE}`]);
  assert.ok(env.models.generated.some(task => task.purpose === 'improve'));
  assert.ok(env.models.generated.every(task => !task.containsClientData));

  const candidate = findRecord(env.store.read(), 'venture-playbook', run.candidatePlaybookId!)!;
  assert.equal(candidate.parentId, parent.id);
  assert.equal(candidate.origin, 'improvement');
  assert.equal(candidate.version, 2);
  assert.notEqual(candidate.hash, parent.hash);
  assert.deepEqual(findRecord(env.store.read(), 'venture-playbook', parent.id), parentBefore, 'the parent version is never overwritten');
  assert.equal(findRecord(env.store.read(), 'venture-record', env.venture.id)!.playbookId, parent.id, 'nothing changes until the owner adopts');
  const stored = listRecords(env.store.read(), 'venture-simulation-run').find(item => item.playbookHash === candidate.hash);
  assert.ok(stored, "the candidate's rehearsal is stored so it counts once adopted");

  const status = await call<ImprovementStatus>(env, 'venture.improve.status');
  assert.equal(status.readiness.status, 'available');
  assert.equal(status.candidate!.playbookId, candidate.id);
  await assert.rejects(call(env, 'venture.improve.adopt', { runId: run.id, digest: run.digest }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.improve.adopt', { runId: run.id, digest: 'e'.repeat(64) }), code('CANDIDATE_STALE'));
  const adopted = await call<PlaybookRecord>(env, 'venture.improve.adopt', { runId: run.id, digest: run.digest });
  assert.equal(adopted.id, candidate.id);
  assert.equal(findRecord(env.store.read(), 'venture-record', env.venture.id)!.playbookId, candidate.id);
  assert.ok(eventNames(env).includes('playbook-adopted'));
  assert.equal((await call<PlaybookRecord>(env, 'venture.delivery.playbook')).id, candidate.id, 'the adopted version is the one runs use');
  await assert.rejects(call(env, 'venture.improve.adopt', { runId: run.id, digest: run.digest }), code('CANDIDATE_STALE'));
  assert.equal((await call<ImprovementStatus>(env, 'venture.improve.status')).candidate, null);
  assert.equal((await call<ImprovementRunRecord>(env, 'venture.improve.get', { runId: run.id })).id, run.id);
  await assert.rejects(call(env, 'venture.improve.get', { runId: 'improve_missing' }), code('IMPROVEMENT_NOT_FOUND'));

  // A plan change carries the adopted patch into the rebuilt playbook.
  await ventureAction(env.deps, owner, 'admin', 'seed.accept', tx => { const record = tx.put(blueprintRecord(tx, 2)); tx.touch({ acceptedBlueprintId: record.id, blueprintId: record.id }); });
  const rebuilt = await call<PlaybookRecord>(env, 'venture.delivery.playbook');
  assert.equal(rebuilt.version, 3);
  assert.deepEqual(rebuilt.steps.find(step => step.id === 'draft')!.guidance, [SECTIONS_GUIDANCE]);
  assert.equal(rebuilt.patches!.length, 1);
});

test('improvement run: templates keep the old version, calculator-only failures change nothing, and a plan change makes a candidate stale', async () => {
  const env = await setup('approve-each');
  await call<PlaybookRecord>(env, 'venture.delivery.playbook');
  await seedSignals(env, ['missing-section', 'missing-section']);
  improvementScript(env, null);
  const templated = await call<ImprovementRunRecord>(env, 'venture.improve.run', { useTemplate: true, maxRounds: 1 });
  assert.equal(templated.status, 'kept-parent');
  assert.match(templated.rounds[0].gate!.reason, /Without an AI/);
  assert.equal(templated.costMicros, '0');

  const numbers = await setup('approve-each');
  await call<PlaybookRecord>(numbers, 'venture.delivery.playbook');
  await seedSignals(numbers, ['wrong-number', 'figures-resolve']);
  improvementScript(numbers, null);
  const incomplete = await call<ImprovementRunRecord>(numbers, 'venture.improve.run');
  assert.equal(incomplete.status, 'incomplete');
  assert.match(incomplete.incompleteReason!, /calculator or the dictionary/);
  assert.equal(incomplete.candidatePlaybookId, null);

  improvementScript(env, { level: 'harness', hypothesis: 'Every heading once should fix missing sections.', op: 'guidance.add', stepId: 'draft', value: SECTIONS_GUIDANCE, expectedFixes: ['missing-section'], likelyRegressions: ['A longer reply.'] });
  const kept = await call<ImprovementRunRecord>(env, 'venture.improve.run', { maxRounds: 1 });
  assert.equal(kept.status, 'kept-candidate');
  assert.equal(kept.rounds[0].patch!.proposedBy, 'model');
  await ventureAction(env.deps, owner, 'admin', 'seed.accept', tx => { const record = tx.put(blueprintRecord(tx, 2)); tx.touch({ acceptedBlueprintId: record.id, blueprintId: record.id }); });
  assert.equal((await call<ImprovementStatus>(env, 'venture.improve.status')).candidate, null);
  await assert.rejects(call(env, 'venture.improve.adopt', { runId: kept.id, digest: kept.digest }), code('CANDIDATE_STALE'));
});

