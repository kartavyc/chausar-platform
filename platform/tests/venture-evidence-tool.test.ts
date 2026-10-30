// Ink v2 wave 2, package 2G: the evidence ledger fed by an agent tool. On a real order the agent notes a fact about the
// order's client or the business with evidence.record and says where it came from; code checks the claim against the
// run's own tool calls (a file it read that shows the value, a calculator receipt that holds it) and keeps it as a
// suggestion for the owner on Today. A real order is latched by the taint latch from its first turn, so the latch lets
// this one internal write through while every outbound effect still waits for the owner, and nothing the agent notes
// is applied on its own, even when two files agree. Through venture.delivery.run and venture.delivery.approve, then
// venture.queue.list and venture.evidence.apply. The model port is a script; no network, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { PURPOSE_TIER, STEP_PLAN } from '../runtime/venture/contracts.ts';
import type {
  BlueprintRecord, ClientRecord, CountryProfile, DeliveryRunView, EvidenceItem, EvidenceRecord, ModelOutcome, ModelPort, ModelPreset, ModelPreview, ModelPurpose,
  ModelStatusView, ModelTask, OrderRecord, PlaybookPatch, PlaybookRecord, PlaybookStep, PriceFigure, PriceReceiptRecord, QueueList, RunDetail, SecretShelf,
  SimulationRunRecord, ToolName, VentureDeps, VentureMethod, VentureRecord,
} from '../runtime/venture/contracts.ts';
import { digest, findRecord, listRecords, ventureAction, type VentureTx } from '../runtime/venture/records.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { PRACTICE_FILES, practiceFiles } from '../runtime/venture/delivery/harness/practice.ts';
import { callTool, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { expectedPlaybookHash, validatePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { HELD_SUGGESTION, recordEvidence } from '../runtime/venture/evidence/ledger.ts';
import { UNCHECKED } from '../runtime/venture/evidence/types.ts';
import { REDACTED } from '../runtime/venture/core/secrets.ts';
import { harnessPolicyContext } from '../runtime/venture/policy/context.ts';
import { ladderPolicy } from '../runtime/venture/policy/ladder.ts';
import { INTERNAL_SUGGESTIONS, latchedBy, TAINT_WORDS } from '../runtime/venture/policy/taint.ts';
import { evaluateSync } from '../runtime/venture/policy/verdict.ts';
import type { PolicyAction } from '../runtime/venture/policy/floor.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { CA_FIRM_ID } from '../runtime/venture/playbooks/ca-firm/registration.ts';
import { SOCIAL_AGENCY_ID } from '../runtime/venture/playbooks/social/registration.ts';
import { YOUTUBE_ID } from '../runtime/venture/playbooks/youtube/registration.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const clock = () => new Date('2026-10-23T10:00:00.000Z');
const ORDER_REQUEST = 'Please set up my books. My latest invoice and the order form are attached.';
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const pdf = (text: string) => b64(`%PDF-1.7\n${text}`);
const INVOICE = 'Tax invoice INV-0042\nBilled to Asha Rao\nEmail: asha@example.in\nTotal INR 11,800.00';
const ORDER_FORM = 'Order form\nName: Asha Rao\nContact email: Asha@Example.in\nStarting month: November';

const IN: CountryProfile = {
  code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india',
  tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', registrationNote: 'Check with a CA.', idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15' },
  paymentRails: ['razorpay'], dateOrder: 'day-month-year', complianceNotes: [],
};

// ---------------------------------------------------------------------------
// A scripted model port (the pattern of venture-harness-runs.test.ts)
// ---------------------------------------------------------------------------

type Responder = (task: ModelTask<any>) => unknown;
class ScriptPort implements ModelPort {
  store: VentureTestStore;
  respond: Partial<Record<ModelPurpose, Responder>> = {};
  #previews = new Map<string, { digest: string; task: ModelTask<any>; used: boolean }>();
  #calls = 0;
  constructor(store: VentureTestStore) { this.store = store; }
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => ({ presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' });
    return { connections: [], tiers: { fast: tier('anthropic-haiku-5-5'), main: tier('anthropic-sonnet-5-5') }, spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' } };
  }
  presets(): ModelPreset[] { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    await this.store.update(() => undefined);
    if (task.containsClientData) throw new ChausarError('CLIENT_DATA_NEEDS_APPROVAL', 'Client data needs your approval.');
    assert.ok(PURPOSE_TIER[task.purpose]);
    const responder = this.respond[task.purpose];
    // Setting a business up (the interview, the plan) takes the built-in templates.
    if (!responder && task.template) return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
    assert.ok(responder, `no responder for ${task.purpose}`);
    this.#calls += 1;
    return { value: task.validate(structuredClone(responder(task))), by: 'model', callId: `call_${this.#calls}`, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '100', priceConfirmed: true };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    await this.store.update(() => undefined);
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, { digest: digest(payloadText), task, used: false });
    await this.store.update(state => { state.conversations.push({ id: callId, kind: 'venture-model-call', status: 'preview' }); });
    return { callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'stub', endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: '2026-10-23T10:30:00.000Z' };
  }
  async runPreview<T>(ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    await this.store.update(() => undefined);
    if (ctx.channel !== 'desktop') throw new ChausarError('APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
    const held = this.#previews.get(callId);
    if (!held || held.used || held.digest !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again; the approved text is no longer available.');
    held.used = true;
    await this.store.update(state => { const call = state.conversations.find(record => record?.id === callId); if (call) call.status = 'completed'; });
    const responder = this.respond[held.task.purpose];
    assert.ok(responder, `no responder for ${held.task.purpose}`);
    return { value: validate(structuredClone(responder(held.task))), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '200', priceConfirmed: true };
  }
}

// ---------------------------------------------------------------------------
// Seeds: a bookkeeping business at approve each (the eight fixed steps), a client and an order
// ---------------------------------------------------------------------------

const words = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
const STEP_TITLES = ['Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client'];

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

const figure = (key: PriceFigure['key'], label: string, minor: string, display: string): PriceFigure => ({ key, label, minor, display, currency: 'INR' });
function receiptRecord(tx: VentureTx, subject: PriceReceiptRecord['subject'], blueprintDigest: string): PriceReceiptRecord {
  return {
    ...tx.base('venture-price-receipt'), subject, operation: 'venture.price', currency: 'INR', minorDigits: 2,
    inputs: { unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxMode: 'gst', taxRateBps: '1800', taxTreatment: 'single', unitPriceBy: 'told-by-you', taxRateBy: 'country-table', blueprintDigest },
    steps: [], figures: [figure('unit', 'Unit price', '249900', 'INR 2,499.00'), figure('tax', 'GST at 18%', '44982', 'INR 449.82'), figure('total', 'Total', '294882', 'INR 2,948.82')],
    totalMinor: '294882', allowedNumbers: [], explanation: 'Synthetic receipt.', digest: 'receipt-digest', stale: false,
  };
}

type Env = { store: VentureTestStore; models: ScriptPort; deps: VentureDeps; venture: VentureRecord; blueprint: BlueprintRecord; pdfReads: number };

async function setup(): Promise<Env> {
  const store = new VentureTestStore();
  const models = new ScriptPort(store);
  const env = { store, models, pdfReads: 0 } as Env;
  // The Python helper's PDF reader, stubbed: the page text is what follows the PDF header in the file.
  const helper = {
    async run(_operation: 'pdf.extract', input: { pdfBase64: string }) {
      env.pdfReads += 1;
      return { result: { pages: [{ page: 1, text: Buffer.from(input.pdfBase64, 'base64').toString('utf8').replace(/^%PDF-1\.7\n/, '') }], coverage: 'Text extraction only.' }, receipt: {} };
    },
  };
  env.deps = { store, clock, models, services: { ontology: { current: () => null }, helper }, github: {}, secrets: {}, host: 'test', demo: true, storage: 'experimental-file' } as unknown as VentureDeps;
  env.venture = await ventureAction(env.deps, owner, 'admin', 'create', tx => tx.put<VentureRecord>({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes in Pune, done by AI helpers with me checking every report.', ideaDigest: 'idea', workingName: 'Ledger Cafe Books',
    country: IN, serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  env.blueprint = await ventureAction(env.deps, owner, 'admin', 'seed.blueprint', tx => {
    const record = tx.put(blueprintRecord(tx));
    tx.touch({ blueprintId: record.id, acceptedBlueprintId: record.id });
    tx.put(receiptRecord(tx, { type: 'offer', offerId: 'offer_1' }, record.digest));
    return record;
  });
  return env;
}

/** An order for a client the owner added by hand (no evidence yet), with these files in order: f1, f2, ... */
async function orderWith(env: Env, files: { name: string; contentBase64: string }[]): Promise<OrderRecord> {
  const order = await ventureAction(env.deps, owner, 'prepare', 'seed.order', tx => {
    const client = tx.put({ ...tx.base('venture-client'), name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null });
    const base = tx.base('venture-order');
    const receipt = tx.put(receiptRecord(tx, { type: 'order', orderId: base.id }, env.blueprint.digest));
    return tx.put<OrderRecord>({ ...base, clientId: client.id, offerId: 'offer_1', quantity: '1', request: ORDER_REQUEST, status: 'open', priceReceiptId: receipt.id, deliveredOn: null, saleFactId: null });
  });
  for (const file of files) await call(env, 'venture.files.add', { orderId: order.id, ...file });
  return order;
}

const HANDLERS = { ...coreHandlers, ...moneyHandlers, ...viewHandlers, ...deliveryHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>;
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
function call<T>(env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const handler = HANDLERS[method];
  assert.ok(handler, method);
  return handler(env.deps, ctx, payload) as Promise<T>;
}
const approve = (env: Env, run: DeliveryRunView) => call<DeliveryRunView>(env, 'venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
const turnOf = (note: string, calls: [string, unknown][], finished = false) => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
/** The agent's turns, each built when its turn runs, so a turn can quote what an earlier one made. */
function scriptTurns(env: Env, turns: (() => unknown)[]) {
  let next = 0;
  env.models.respond['agent-turn'] = () => turns[Math.min(next++, turns.length - 1)]();
}
const evidence = (env: Env) => listRecords(env.store.read(), 'venture-evidence') as EvidenceRecord[];
const clientOf = (env: Env, order: OrderRecord) => findRecord(env.store.read(), 'venture-client', order.clientId) as ClientRecord;
const envelopeOf = (run: DeliveryRunView, id: string) => run.harness!.toolCalls.find(item => item.id === id)!.envelope;
const failCode = (run: DeliveryRunView, id: string) => { const envelope = envelopeOf(run, id); return envelope.ok ? null : envelope.error.code; };
const note = (fields: Record<string, string>) => ['evidence.record', fields] as [string, unknown];
/** How many evidence.record calls told the agent its note was kept. */
const recordedAnswers = (run: DeliveryRunView) => run.harness!.toolCalls.filter(item => item.tool === 'evidence.record' && item.envelope.ok && (item.envelope.result as { recorded?: unknown }).recorded === true).length;

// ---------------------------------------------------------------------------
// 1. A fact read from a client's file: a suggestion on Today, applied only by the owner
// ---------------------------------------------------------------------------

test('evidence.record: a value the agent read in an invoice is kept as a strong suggestion, shown on Today, and the owner applies it', async () => {
  const env = await setup();
  const order = await orderWith(env, [{ name: 'invoice-october.pdf', contentBase64: pdf(INVOICE) }]);
  scriptTurns(env, [() => turnOf('Read the invoice and note the email', [
    ['files.read', { target: 'f1', part: 'pages' }],
    note({ subject: 'client', field: 'email', value: 'asha@example.in', type: 'document', from: 'f1', source: 'invoice page 1' }),
  ])]);
  let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  assert.ok(run.harness!.grant.includes('evidence.record'), 'the fixed steps grant it');
  run = await approve(env, run);

  // The tool ran on a real order: the run is latched (taint), yet this internal note was not held.
  assert.ok(run.harness!.taint, 'a real order is latched from its first turn');
  assert.deepEqual(run.harness!.toolCalls.map(item => [item.id, item.tool, item.outcome]), [['t1.1', 'files.read', 'succeeded'], ['t1.2', 'evidence.record', 'succeeded']]);
  const result = envelopeOf(run, 't1.2');
  assert.ok(result.ok);
  assert.deepEqual(result.ok && { recorded: (result.result as any).recorded, checked: (result.result as any).checked, backedBy: (result.result as any).backedBy, applied: (result.result as any).applied },
    { recorded: true, checked: true, backedBy: 't1.1', applied: false });
  assert.equal(run.status, 'waiting-for-you', 'the next turn waits for the owner as usual');
  // The run view says what the note did; only the file read is called a read.
  const detail = await call<RunDetail>(env, 'venture.runs.get', { runId: run.id });
  const named = detail.steps.flatMap(step => (step.tools ?? []).map(tool => tool.name));
  assert.ok(named.includes('Noted where a client fact came from'), JSON.stringify(named));
  assert.deepEqual(named.filter(name => /\bread\b/i.test(name)), ['Read a client file'], JSON.stringify(named));

  const [item] = evidence(env);
  assert.equal(evidence(env).length, 1);
  assert.deepEqual(
    [item.subject, item.field, item.value, item.type, item.claimedType, item.strength, item.claim, item.by, item.runId, item.toolCallId, item.flag, item.applied],
    [`client:${order.clientId}`, 'email', 'asha@example.in', 'document', 'document', 'strong', 'observed', 'agent', run.id, 't1.1', null, false],
  );
  assert.match(item.source, /^Read from a file in the run \(t1\.1\): invoice page 1$/);
  assert.equal(clientOf(env, order).email, 'owner@aroma.example', 'nothing is written to the client on its own');

  // Today: one question row with the change, before and after.
  const queue = await call<QueueList>(env, 'venture.queue.list');
  const rows = queue.rows.filter(row => row.kind === 'question' && row.change?.after === 'asha@example.in');
  assert.equal(rows.length, 1, JSON.stringify(queue.rows.map(row => [row.kind, row.title])));
  assert.match(rows[0].title, /Cafe Aroma Demo/);
  assert.equal(rows[0].change!.before, 'owner@aroma.example');

  // Only the owner's apply writes it through.
  const applied = await call<{ item: EvidenceItem }>(env, 'venture.evidence.apply', { id: item.id });
  assert.equal(applied.item.applied, true);
  assert.equal(clientOf(env, order).email, 'asha@example.in');
  const after = await call<QueueList>(env, 'venture.queue.list');
  assert.equal(after.rows.filter(row => row.kind === 'question' && row.change?.after === 'asha@example.in').length, 0);
});

// ---------------------------------------------------------------------------
// 2. Claims are checked against the run's own tool calls
// ---------------------------------------------------------------------------

test('evidence.record: a claim no tool call in the run backs is kept as the AI\'s own reading, weak and flagged; a calculator receipt backs only what it holds', async () => {
  const env = await setup();
  const [bank, bills] = PRACTICE_FILES['bookkeeping-clean'];
  const order = await orderWith(env, [
    { name: 'invoice-october.pdf', contentBase64: pdf(INVOICE) },
    { name: bank.name, contentBase64: b64(bank.content) },
    { name: bills.name, contentBase64: b64(bills.content) },
  ]);
  const billsTotal = () => listRecords(env.store.read(), 'venture-work-receipt')[0].figures[0].display;
  scriptTurns(env, [
    () => turnOf('Look at the statement columns and add up the bills', [['files.read', { target: 'f2', part: 'columns' }], ['calc.sum', { table: 'f3', amountColumn: 'Amount' }]]),
    () => turnOf('Note what the files say', [
      note({ subject: 'business', field: 'city', value: 'Pune', type: 'document', from: 'f1' }), // f1 was never read
      note({ subject: 'client', field: 'note', value: 'UPI/Power Grid Electricity', type: 'document', from: 'f2' }), // only its columns were read
      note({ subject: 'business', field: 'monthlyBills', value: billsTotal(), type: 'tool-verified', from: 'w1', source: 'the bills total' }),
      note({ subject: 'business', field: 'billsTotal', value: 'INR 1.00', type: 'tool-verified', from: 'w1' }), // not on the receipt
    ]),
    () => turnOf('Read the invoice and note more', [
      ['files.read', { target: 'f1', part: 'pages' }],
      note({ subject: 'client', field: 'email', value: 'priya@example.in', type: 'document', from: 'f1' }), // the invoice does not show it
      note({ subject: 'business', field: 'bankName', value: 'HDFC', type: 'tool-verified', from: 'f2' }), // a file is not a calculator
      note({ subject: 'business', field: 'rent', value: 'INR 25,000.00', type: 'tool-verified', from: 'w9' }), // no such receipt
    ]),
  ]);
  let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  run = await approve(env, run);
  run = await approve(env, run);
  assert.equal(failCode(run, 't3.4'), 'TOOL_FAILED');
  assert.match(envelopeOf(run, 't3.4').ok ? '' : (envelopeOf(run, 't3.4') as any).error.message, /w9/);

  const byField = new Map(evidence(env).map(item => [item.field, item]));
  assert.deepEqual([...byField.keys()].sort(), ['bankName', 'billsTotal', 'city', 'email', 'monthlyBills', 'note']);
  for (const [field, claimed] of [['city', 'document'], ['note', 'document'], ['billsTotal', 'tool-verified'], ['email', 'document'], ['bankName', 'tool-verified']] as const) {
    const item = byField.get(field)!;
    assert.deepEqual([item.type, item.claimedType, item.strength, item.claim, item.toolCallId, item.applied], ['model-inferred', claimed, 'weak', 'inferred', null, false], field);
    assert.equal(item.flag, UNCHECKED[claimed], field);
    assert.match(item.source, /^Unchecked: /, field);
  }
  // A receipt the calculator made in this run backs a value it holds: verified, and still only a suggestion.
  const checked = byField.get('monthlyBills')!;
  assert.deepEqual([checked.type, checked.strength, checked.toolCallId, checked.applied], ['tool-verified', 'verified', 't1.2', false]);
  assert.equal(checked.value, billsTotal());
  assert.ok(checked.source.startsWith(HELD_SUGGESTION), checked.source);
  assert.equal(listRecords(env.store.read(), 'venture-client')[0].email, 'owner@aroma.example');
  assert.equal(recordedAnswers(run), evidence(env).length, 'every note the agent was told is kept is kept');
});

// ---------------------------------------------------------------------------
// 3. Two files that agree verify a value, but the run is latched, so it waits for the owner
// ---------------------------------------------------------------------------

test('evidence.record: two files that agree make a value verified, but a run that read client files never applies it on its own', async () => {
  const env = await setup();
  const order = await orderWith(env, [{ name: 'invoice-october.pdf', contentBase64: pdf(INVOICE) }, { name: 'order-form.pdf', contentBase64: pdf(ORDER_FORM) }]);
  const email = (from: string) => note({ subject: 'client', field: 'email', value: 'asha@example.in', type: 'document', from, source: from === 'f1' ? 'invoice page 1' : 'order form' });
  const name = () => note({ subject: 'client', field: 'name', value: 'Asha Rao', type: 'document', from: 'f1' });
  scriptTurns(env, [
    () => turnOf('Read both files and note the email from each', [['files.read', { target: 'f1', part: 'pages' }], ['files.read', { target: 'f2', part: 'pages' }], email('f1'), email('f2')]),
    () => turnOf('Read the invoice again and note the name twice', [['files.read', { target: 'f1', part: 'pages' }], name(), name()]),
  ]);
  let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  run = await approve(env, run);
  assert.ok(run.harness!.taint);

  const emails = evidence(env).filter(item => item.field === 'email');
  assert.deepEqual(emails.map(item => [item.toolCallId, item.strength, item.applied]), [['t1.1', 'strong', false], ['t1.2', 'verified', false]]);
  assert.ok(emails[1].source.startsWith(`${HELD_SUGGESTION} Read from a file in the run (t1.2)`), emails[1].source);
  assert.equal(HELD_SUGGESTION, 'From a client file: waits for you.');
  assert.equal(clientOf(env, order).email, 'owner@aroma.example', 'a verified value from a latched run is not written on its own');
  // One file read twice is still one source: the name stays strong.
  const names = evidence(env).filter(item => item.field === 'name');
  assert.deepEqual(names.map(item => [item.toolCallId, item.strength, item.applied]), [['t1.1', 'strong', false], ['t1.1', 'strong', false]]);

  // Today shows the newest email suggestion once, with the line that says why it waits.
  const queue = await call<QueueList>(env, 'venture.queue.list');
  const rows = queue.rows.filter(row => row.kind === 'question' && row.change?.after === 'asha@example.in');
  assert.equal(rows.length, 1);
  assert.match(rows[0].line ?? '', /^From a client file: waits for you\./);
  await call(env, 'venture.evidence.apply', { id: emails[1].id });
  assert.equal(clientOf(env, order).email, 'asha@example.in', 'the owner applying it writes it through');
});

// ---------------------------------------------------------------------------
// 4. Subjects, the secret screen and rehearsals
// ---------------------------------------------------------------------------

test('evidence.record: only this order\'s client or the business, secrets screened before they are kept, and nothing kept in a rehearsal', async () => {
  const env = await setup();
  const order = await orderWith(env, [{ name: 'invoice-october.pdf', contentBase64: pdf(INVOICE) }]);
  const key = 'sk-' + 'ant-' + 'api03-' + 'Zq8Lm3Np5Rt7Vx9Bc2Df4Gh6Jk8';
  scriptTurns(env, [() => turnOf('Note some facts', [
    note({ subject: 'client:client_someone_else', field: 'email', value: 'x@example.in', type: 'model-inferred' }),
    note({ subject: 'supplier', field: 'email', value: 'x@example.in', type: 'model-inferred' }),
    note({ subject: 'client', field: 'two words', value: 'x@example.in', type: 'model-inferred' }),
    note({ subject: 'business', field: 'note', value: `Their portal key is ${key}`, type: 'model-inferred' }),
  ])]);
  let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  assert.deepEqual(['t1.1', 't1.2', 't1.3'].map(id => failCode(run, id)), ['TOOL_FAILED', 'TOOL_FAILED', 'TOOL_FAILED']);
  const kept = evidence(env);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].subject, 'business');
  assert.ok(!kept[0].value.includes(key) && kept[0].value.includes(REDACTED), kept[0].value);
  assert.ok(!JSON.stringify(run.harness!.toolCalls).includes(key), 'the stored trace never holds the key');
  assert.equal(recordedAnswers(run), kept.length, 'the agent is told the truth about what was kept');

  // The same business rehearses on its practice clients: the agent notes a fact, the tool answers practice, nothing is kept.
  scriptTurns(env, [
    () => turnOf('Note the city', [note({ subject: 'business', field: 'city', value: 'Pune', type: 'model-inferred' })]),
    () => turnOf('Ready to write', [], true),
  ]);
  env.models.respond['client-sim'] = () => ({ message: 'Hello, I need help with my books for the month.', asksForPerson: false });
  env.models.respond.delivery = task => ({
    title: 'Your books', questionsForClient: [],
    sections: (task.input as { requiredSections: string[] }).requiredSections.map(heading => ({ heading, parts: [{ kind: 'text', text: 'Plain words about the work.', ref: '' }] })),
  });
  env.models.respond.judge = task => task.schemaName === 'venture-judge-rules'
    ? { votes: (task.input as { rules: { id: string }[] }).rules.map(rule => ({ rule: rule.id, answer: 'yes', cites: [], quote: '', reason: 'Fine.' })) }
    : { answers: ['goal-met', 'tone-fits', 'policy-followed', 'no-unbacked-claims'].map(question => ({ question, answer: 'yes', reason: 'Fine.' })) };
  const rehearsal = await call<SimulationRunRecord>(env, 'venture.simulation.run', { scenarioIds: ['bookkeeping-clean'] });
  const noted = rehearsal.episodes.flatMap(episode => episode.harness?.toolCalls ?? []).filter(item => item.tool === 'evidence.record');
  assert.ok(noted.length >= 1, JSON.stringify(rehearsal.episodes.map(episode => [episode.firstFailure, episode.harness?.toolCalls.map(item => item.tool)])));
  for (const item of noted) assert.deepEqual(item.envelope, { ok: true, result: { recorded: false, practice: true } });
  assert.equal(evidence(env).length, 1, 'a rehearsal keeps no evidence');

  // A rehearsal or an improvement run works on made-up clients: the tool answers and keeps nothing.
  for (const runRef of [{ kind: 'rehearsal' as const, scenarioId: 'bookkeeping-clean', episode: 0 }, { kind: 'improvement' as const, runId: 'improve_1', scenarioId: 'bookkeeping-clean' }]) {
    const files = practiceFiles({ id: 'bookkeeping-clean', serviceType: 'bookkeeping', source: 'template' });
    const toolEnv: ToolEnv = {
      deps: { services: {} } as unknown as VentureDeps, ventureId: env.venture.id, memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year',
      runRef, files, tables: [], receipts: [], dictionary: [], sandbox: undefined, now: () => clock().toISOString(), allowed: [],
    };
    const grant: ToolName[] = ['files.read', 'evidence.record'];
    const outcome = await callTool(toolEnv, grant, 1, 0, { tool: 'evidence.record', input: JSON.stringify({ subject: 'business', field: 'city', value: 'Pune', type: 'model-inferred' }) });
    assert.deepEqual(outcome.record.envelope, { ok: true, result: { recorded: false, practice: true } }, runRef.kind);
    assert.deepEqual(toolEnv.evidence ?? [], [], runRef.kind);
  }
  assert.equal(evidence(env).length, 1, 'nothing more was kept');
});

// ---------------------------------------------------------------------------
// 5. The taint latch lets this one internal write through; every outbound effect still waits
// ---------------------------------------------------------------------------

test('taint latch: evidence.record is an internal suggestion the latch lets through on a real order, while outbound calls stay held', async () => {
  // Ink v2 wave 5 (5A3): ideas.add, an idea in the owner's own ideas Inbox, is another internal suggestion; (5A4)
  // assets.record, where a delivered file came from, the third.
  assert.deepEqual([...INTERNAL_SUGGESTIONS], ['evidence.record', 'ideas.add', 'assets.record']);
  const taint = { turn: 1, source: 'client-request' as const, toolCallId: null, tool: null };
  const action = (name: string, effect: PolicyAction['effect'], input: Record<string, unknown> = {}): PolicyAction => ({ phase: 'tool-call', name, effect, inputDigest: 'd1', input });
  const input = { subject: 'client', field: 'email', value: 'asha@example.in', type: 'document', from: 'f1' };
  assert.deepEqual(latchedBy(action('evidence.record', 'read', input), taint), []);
  // Only its own write is let through: an input that would notify someone is still latched as a send.
  assert.deepEqual(latchedBy(action('evidence.record', 'read', { ...input, notifyClient: true }), taint), ['send']);
  assert.deepEqual(latchedBy(action('agent.delegate', 'delegate'), taint), ['write', 'egress'], 'other writes stay latched');

  // The policy context of a real order's run, as the run builds it, with the owner's turn approval.
  const env = await setup();
  const order = await orderWith(env, [{ name: 'invoice-october.pdf', contentBase64: pdf(INVOICE) }]);
  scriptTurns(env, [() => turnOf('Read the invoice and note the email', [
    ['files.read', { target: 'f1', part: 'pages' }],
    note({ subject: 'client', field: 'email', value: 'asha@example.in', type: 'document', from: 'f1' }),
  ])]);
  let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  assert.equal(run.harness!.toolCalls[1].outcome, 'succeeded');
  const state = env.store.read();
  const venture = findRecord(state, 'venture-record', env.venture.id)!;
  const playbook = findRecord(state, 'venture-playbook', venture.playbookId!)!;
  const context = { ...harnessPolicyContext({ state, venture, playbook, runRef: { kind: 'delivery', runId: run.id }, approval: { kind: 'owner-turn' } }), taint: run.harness!.taint! };
  const decide = (item: PolicyAction) => { const verdict = evaluateSync([ladderPolicy], item, context); return { verdict: verdict.verdict, code: verdict.code, reason: verdict.reason }; };
  assert.deepEqual(decide(action('evidence.record', 'read', input)), { verdict: 'allow', code: 'owner_turn', reason: 'You approved this turn before it ran.' });
  for (const outbound of [action('mail.send', 'outside-write'), action('web.page.fetch', 'read'), action('vendor.payout', 'outside-write'), action('crm.contacts.export', 'read'), action('evidence.record', 'read', { ...input, notifyClient: true })]) {
    assert.deepEqual(decide(outbound), { verdict: 'ask', code: 'tainted', reason: TAINT_WORDS }, outbound.name);
  }
});

// ---------------------------------------------------------------------------
// 6. Grants: every playbook's gather steps and the eight fixed steps' work step
// ---------------------------------------------------------------------------

test('grants: the fixed gather and work steps and every flagship playbook\'s gather steps hold evidence.record', async () => {
  const env = await setup();
  const fixed = await call<{ steps: { id: string; kind: string; tools?: ToolName[] }[] }>(env, 'venture.delivery.playbook');
  for (const id of ['gather', 'work']) assert.ok(fixed.steps.find(step => step.id === id)!.tools!.includes('evidence.record'), id);
  for (const flagship of [CA_FIRM_ID, SOCIAL_AGENCY_ID, YOUTUBE_ID]) {
    const steps = flagshipDelivery(flagship)!.steps;
    const gathers = steps.filter(step => step.kind === 'gather' && step.model !== null);
    assert.ok(gathers.length >= 1, flagship);
    for (const step of gathers) assert.ok((step.tools ?? []).includes('evidence.record'), `${flagship} ${step.id}`);
    assert.equal(validatePlaybook(structuredClone([...steps])).validated, true, flagship);
  }
});

// ---------------------------------------------------------------------------
// 7. Field names that every object already has are refused, and an old one never breaks Today or a client
// ---------------------------------------------------------------------------

const PROTOTYPE_NAMES = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', 'note.toString', 'note.__proto__', 'offer_1.constructor', 'isPrototypeOf'];

test('field names: a member of every object (toString, constructor, __proto__, ...) is refused by the tool and by the ledger', async () => {
  const env = await setup();
  const order = await orderWith(env, [{ name: 'invoice-october.pdf', contentBase64: pdf(INVOICE) }]);
  // Two names a run: the repeat-failure breaker (Ink v2 wave 4, 4F2) stops a run whose agent meets the same refusal
  // three times, so each run tries two and every name is still tried through the tool.
  const calls: NonNullable<DeliveryRunView['harness']>['toolCalls'] = [];
  for (let start = 0; start < PROTOTYPE_NAMES.length; start += 2) {
    const names = PROTOTYPE_NAMES.slice(start, start + 2);
    const each = start === 0 ? order : await orderWith(env, [{ name: 'invoice-october.pdf', contentBase64: pdf(INVOICE) }]);
    scriptTurns(env, [() => turnOf('Note odd fields', names.map(field => note({ subject: 'client', field, value: 'Asha Rao', type: 'model-inferred' })))]);
    let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: each.id });
    run = await approve(env, run);
    calls.push(...run.harness!.toolCalls.filter(item => item.tool === 'evidence.record'));
    assert.equal(recordedAnswers(run), 0);
  }
  assert.equal(calls.length, PROTOTYPE_NAMES.length);
  for (const item of calls) assert.equal(item.envelope.ok ? null : item.envelope.error.code, 'TOOL_FAILED', JSON.stringify(item.input));
  assert.equal(evidence(env).length, 0);
  for (const field of PROTOTYPE_NAMES) {
    await assert.rejects(ventureAction(env.deps, owner, 'prepare', 'test.evidence', tx => recordEvidence(tx, { subject: `client:${order.clientId}`, field, value: 'Asha Rao', type: 'owner-entered', by: 'owner' })), code('INVALID_VENTURE_REQUEST'), field);
  }
  assert.equal(evidence(env).length, 0);
});

test('field names: a record an older build kept under toString or constructor still shows on Today and never writes that key onto the client', async () => {
  const env = await setup();
  const order = await orderWith(env, []);
  for (const field of ['toString', 'constructor']) {
    await ventureAction(env.deps, owner, 'prepare', 'seed.evidence', tx => tx.put({
      ...tx.base('venture-evidence'), subject: `client:${order.clientId}`, field, value: 'Asha Rao', type: 'model-inferred', claimedType: 'model-inferred', strength: 'weak',
      scoreBp: 2000, claim: 'inferred', source: 'An older build kept this.', by: 'agent', runId: null, toolCallId: null, flag: null, applied: false, appliedAt: null,
    } as EvidenceRecord));
  }
  const queue = await call<QueueList>(env, 'venture.queue.list');
  const rows = queue.rows.filter(row => row.kind === 'question' && row.change?.after === 'Asha Rao');
  assert.deepEqual(rows.map(row => row.change!.label).sort(), ['Constructor', 'To string']);
  for (const stored of evidence(env)) await call(env, 'venture.evidence.apply', { id: stored.id });
  const client = clientOf(env, order);
  for (const key of ['toString', 'constructor']) assert.equal(Object.hasOwn(client, key), false, key);
  assert.equal(client.name, 'Cafe Aroma Demo');
});

// ---------------------------------------------------------------------------
// 8. Only the client's own words back a value, matched at word boundaries
// ---------------------------------------------------------------------------

test('evidence.record: only a page, a transcript line or a table cell backs a value, as whole words; Chausar\'s own words never do', async () => {
  const env = await setup();
  const [bank] = PRACTICE_FILES['bookkeeping-clean'];
  const order = await orderWith(env, [
    { name: 'invoice-october.pdf', contentBase64: pdf(INVOICE) },
    { name: 'order-form.pdf', contentBase64: pdf(ORDER_FORM) },
    { name: bank.name, contentBase64: b64(bank.content) },
  ]);
  scriptTurns(env, [
    () => turnOf('Read the order form and the statement', [
      ['files.read', { target: 'f2', part: 'pages' }],
      ['files.read', { target: 'f3', part: 'sample' }],
      note({ subject: 'client', field: 'note', value: 'or', type: 'document', from: 'f2' }), // inside "Order form" only
      note({ subject: 'business', field: 'coverage', value: 'Text extraction only.', type: 'document', from: 'f2' }), // the reader's own line
    ]),
    () => turnOf('Note more', [
      note({ subject: 'business', field: 'fileName', value: 'f2', type: 'document', from: 'f2' }), // Chausar's short name for the file
      note({ subject: 'business', field: 'statementColumn', value: 'Narration', type: 'document', from: 'f3' }), // a column name, not a cell
      note({ subject: 'client', field: 'note', value: 'Card sales settlement', type: 'document', from: 'f3' }),
      note({ subject: 'client', field: 'name', value: 'Asha Rao', type: 'document', from: 'f2' }),
    ]),
  ]);
  let run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  run = await approve(env, run);
  const byValue = new Map(evidence(env).map(item => [item.value, item]));
  for (const value of ['or', 'Text extraction only.', 'f2', 'Narration']) {
    const item = byValue.get(value)!;
    assert.deepEqual([item.type, item.strength, item.toolCallId, item.flag], ['model-inferred', 'weak', null, UNCHECKED.document], value);
  }
  assert.deepEqual([byValue.get('Card sales settlement')!.type, byValue.get('Card sales settlement')!.toolCallId], ['document', 't1.2']);
  assert.deepEqual([byValue.get('Asha Rao')!.type, byValue.get('Asha Rao')!.toolCallId], ['document', 't1.1']);
  assert.equal(recordedAnswers(run), evidence(env).length);
});

// ---------------------------------------------------------------------------
// 9. A playbook stored before wave 2 gets the new step tools on its next run
// ---------------------------------------------------------------------------

const SALES_REGISTER = ['Invoice,Date,GSTIN,State,HSN,Taxable,Rate', 'S-101,2026-10-02,,27,9983,"10,000.00",18'].join('\n');

/** An AI-native CA firm on the template route, at approve each, with one client (the pattern of venture-playbook-wiring-delivery.test.ts). */
async function caBusiness() {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const models = new ScriptPort(store);
  const secrets = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
  const deps = {
    store, clock, models, services: { calculator, ontology, trust }, secrets, host: 'test', demo: true, storage: 'experimental-file',
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
  } as unknown as VentureDeps;
  const run = (method: VentureMethod, payload: unknown = {}): Promise<any> => HANDLERS[method](deps, owner, payload);
  await run('venture.create', { idea: 'An AI-native CA firm for GST filing and income tax returns in Pune', countryCode: 'IN', workingName: 'Test Business' });
  let interview = await run('venture.interview.next', { useTemplate: true });
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await run('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = await run('venture.blueprint.draft', { useTemplate: true });
  const priced = await run('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000' })) } });
  await run('venture.blueprint.accept', { digest: priced.blueprint.digest });
  await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  const client = await run('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN' });
  return { store, deps, run, client };
}

test('grants: a playbook stored before wave 2 gets the tools its steps grant now on the next run; an adopted improvement and a revoked tool stay as they were', async () => {
  const ca = await caBusiness();
  const plan: PlaybookRecord = await ca.run('venture.delivery.playbook');
  assert.equal(plan.flagship, CA_FIRM_ID);
  const patch = (id: string, op: PlaybookPatch['op'], value: string): PlaybookPatch => ({
    id, level: 'harness', op, stepId: 'gather', value, note: { hypothesis: 'Test.', expectedFixes: [], likelyRegressions: [] }, proposedBy: 'chausar', parentHash: plan.hash,
  });
  const guidance = patch('patch_1', 'guidance.add', 'Say which documents are still missing in one line.');
  const revoke = patch('patch_2', 'tools.revoke', 'dictionary.browse');
  // The same plan as an older build stored it, with an improvement adopted on top: the gather step without
  // evidence.record and without the tool the improvement took away, and the compute step done by code.
  const oldSteps: PlaybookStep[] = plan.steps.map(step => step.id === 'gather'
    ? { ...step, tools: (step.tools ?? []).filter(tool => tool !== 'evidence.record' && tool !== 'dictionary.browse'), guidance: [...(step.guidance ?? []), guidance.value] }
    : step.id === 'compute'
      ? { id: 'compute', kind: 'compute', title: 'The calculator works the tax figures', tier: 'code', model: null, doneBy: 'agent', requiredSections: [], checks: ['figures-resolve'], tools: [], guidance: [] }
      : step);
  const extras = { limits: plan.limits!, aliases: plan.aliases ?? {} };
  const old = await ventureAction(ca.deps, owner, 'prepare', 'seed.old-playbook', tx => {
    const record = tx.put<PlaybookRecord>({ ...plan, ...tx.base('venture-playbook'), version: 2, hash: validatePlaybook(oldSteps, extras).hash, steps: oldSteps, patches: [guidance, revoke], parentId: plan.id, origin: 'improvement' });
    tx.touch({ playbookId: record.id });
    return record;
  });
  const before = ca.store.read();
  const venture = findRecord(before, 'venture-record', old.ventureId)!;
  const expected = expectedPlaybookHash(before, venture, findRecord(before, 'venture-blueprint', venture.acceptedBlueprintId!)!);
  assert.notEqual(expected, old.hash, 'launch readiness already counts the version the next run will use');

  const topped: PlaybookRecord = await ca.run('venture.delivery.playbook');
  assert.notEqual(topped.id, old.id);
  assert.deepEqual([topped.version, topped.hash, topped.origin, topped.parentId, topped.patches], [3, expected, 'improvement', plan.id, [guidance, revoke]]);
  assert.equal(validatePlaybook(topped.steps, extras).hash, topped.hash);
  const gather = topped.steps.find(step => step.id === 'gather')!;
  assert.ok(gather.tools!.includes('evidence.record'));
  assert.ok(!gather.tools!.includes('dictionary.browse'), 'a tool the improvement took away is not given back');
  assert.ok(gather.guidance!.includes(guidance.value), 'the improvement stays');
  const compute = topped.steps.find(step => step.id === 'compute')!;
  assert.equal(compute.kind, 'work');
  for (const tool of ['tax.income', 'tax.interest', 'tax.gst', 'tax.tds'] as const) assert.ok(compute.tools!.includes(tool), tool);
  assert.deepEqual(findRecord(ca.store.read(), 'venture-playbook', old.id), old, 'the stored version is never overwritten');
  assert.equal((await ca.run('venture.delivery.playbook')).id, topped.id, 'reading again makes no further version');

  // The next run holds the new tools.
  const order = await ca.run('venture.order.create', { clientId: ca.client.id, offerId: 'offer_2', request: 'GST working for October.' });
  await ca.run('venture.files.add', { orderId: order.id, name: 'sales-register-october.csv', contentBase64: b64(SALES_REGISTER) });
  const first: DeliveryRunView = await ca.run('venture.delivery.run', { orderId: order.id });
  for (const tool of ['tax.gst', 'evidence.record'] as const) assert.ok(first.harness!.grant.includes(tool), tool);
  assert.equal(findRecord(ca.store.read(), 'venture-delivery-run', first.id)!.playbookId, topped.id);
});
