// Ink v2 wave 2, package 2A1 (catalogue CA1, audit safety item 2): the CA firm's tax engines as agent tools. The agent
// picks the rule, the table columns and the amount ids; the engine works the number and its CA receipt, which is kept
// whole on a work receipt (inputs included, so it can be worked again). Everything goes through the real caller:
// venture.delivery.run, then venture.delivery.approve turn by turn, with a scripted model port that never touches the
// network. Refusals the calculator gives every time are marked do not retry (and a repeat of the same call is answered
// from the run without running); mistakes the agent can fix are plain tool failures. A case the calculator does not
// model must reach the CA through the open items. The checks read the draft the way the client sees it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { JUDGE_QUESTIONS } from '../runtime/venture/contracts.ts';
import type {
  DeliveryRunView, ModelOutcome, ModelPort, ModelPreview, ModelPurpose, ModelStatusView, ModelTask, PlaybookRecord, SecretShelf, SimulationRunRecord,
  ToolCallRecord, VentureDeps, VentureMethod, WorkReceiptRecord, WorkTableRecord,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { validatePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { playbookGrant } from '../runtime/venture/delivery/harness/loop.ts';
import { applyPatch } from '../runtime/venture/delivery/harness/patches.ts';
import { callTool, hostRefusal, offeredTools, toolSpec, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { looksLikeAmount } from '../runtime/venture/delivery/harness/cells.ts';
import type { FileLike } from '../runtime/venture/delivery/harness/files.ts';
import { PRACTICE_FILES } from '../runtime/venture/delivery/harness/practice.ts';
import { CA_STEPS, caFirmPlaybookSteps } from '../runtime/venture/playbooks/ca-firm/playbook.ts';
import { gstWorking, type GstWorkingInput } from '../runtime/venture/playbooks/ca-firm/gst.ts';
import { computeIncomeTax, type IncomeTaxInput } from '../runtime/venture/playbooks/ca-firm/income-tax.ts';
import { computeInterest234, type InterestInput } from '../runtime/venture/playbooks/ca-firm/interest.ts';
import { tdsWorking, type TdsWorkingInput } from '../runtime/venture/playbooks/ca-firm/tds.ts';
import { rateUseFor } from '../runtime/venture/playbooks/ca-firm/signoff.ts';
import { REHEARSAL } from '../runtime/venture/playbooks/ca-firm/rates.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const CA_IDEA = 'An AI-native CA firm for GST filing and income tax returns in Pune';
const PLAIN_IDEA = 'Monthly bookkeeping for cafes and small shops in Pune.';
const CA = { name: 'CA Asha Rao', membershipNo: '123456' };
/** The business's own GSTIN (Maharashtra), with its check character. */
const GSTIN = '27ABCDE1234F1Z0';
const b64 = (content: string) => Buffer.from(content, 'utf8').toString('base64');
const R = (rupees: number) => String(BigInt(rupees) * 100n);

// ---------------------------------------------------------------------------
// A scripted model port: previews wait for approval, answers come from the script by purpose
// ---------------------------------------------------------------------------

type Responder = (task: ModelTask<any>) => unknown;
class Port implements ModelPort {
  respond: Partial<Record<ModelPurpose, Responder>> = {};
  previewed: ModelTask<any>[] = [];
  #calls = 0;
  #previews = new Map<string, { digest: string; task: ModelTask<any> }>();
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => ({ presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' });
    return {
      connections: [], tiers: { fast: tier('anthropic-haiku-5-5'), main: tier('anthropic-sonnet-5-5') },
      spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' },
    };
  }
  presets(): never { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  #answer(task: ModelTask<any>): unknown {
    const responder = this.respond[task.purpose];
    assert.ok(responder, `no responder for ${task.purpose}`);
    return structuredClone(responder(task));
  }
  async generate<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> {
    if (!this.respond[task.purpose] && task.template) {
      return { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
    }
    this.#calls += 1;
    return { value: task.validate(this.#answer(task)), by: 'model', callId: `call_${this.#calls}`, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    this.previewed.push(task);
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, { digest: digest(payloadText), task });
    return {
      callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', endpoint: 'https://api.anthropic.com/v1/messages',
      estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: '2026-10-21T10:30:00.000Z',
    };
  }
  async runPreview<T>(_ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
    const held = this.#previews.get(callId);
    if (!held || held.digest !== approved) throw new ChausarError('APPROVAL_STALE', 'Run it again.');
    this.#previews.delete(callId);
    return { value: validate(this.#answer(held.task)), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '10', priceConfirmed: true };
  }
}

/** The judge says yes to everything it is asked, in either of its two shapes. */
function judgeYes(task: ModelTask<any>): unknown {
  if (task.schemaName === 'venture-judge-rules') {
    return { votes: (task.input as { rules: { id: string }[] }).rules.map(rule => ({ rule: rule.id, answer: 'yes', cites: [], quote: '', reason: 'The draft does this.' })) };
  }
  return { answers: JUDGE_QUESTIONS.map(question => ({ question, answer: 'yes', reason: 'The draft does this.' })) };
}

const HANDLERS = { ...coreHandlers, ...moneyHandlers, ...deliveryHandlers, ...viewHandlers } as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>>;

type Env = Awaited<ReturnType<typeof business>>;

/**
 * A business from an idea on the template route: plan priced on every offer, accepted, at approve each, one client.
 * pdfText: what the PDF reader returns for every PDF, as one page. clientTaxId: the client's GSTIN on record, if any.
 */
async function business(idea: string, options: { pdfText?: string; clientTaxId?: string } = {}) {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const models = new Port();
  const secrets = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
  const helper = { async run() { return { result: { pages: [{ page: 1, text: options.pdfText ?? '' }], coverage: 'Text extraction only.' }, receipt: {} }; } };
  const deps: VentureDeps = {
    store, clock: () => new Date('2026-10-21T10:00:00.000Z'), models, services: { calculator, ontology, trust, helper } as unknown as VentureDeps['services'],
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets, host: 'test', demo: true, storage: 'experimental-file',
  };
  const call = (method: VentureMethod, payload: unknown = {}): Promise<any> => {
    const handler = HANDLERS[method];
    assert.ok(handler, `no handler for ${method}`);
    return handler(deps, owner, payload);
  };
  await call('venture.create', { idea, countryCode: 'IN', workingName: 'Test Business' });
  let interview = await call('venture.interview.next', { useTemplate: true });
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await call('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = await call('venture.blueprint.draft', { useTemplate: true });
  const priced = await call('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000' })) } });
  await call('venture.blueprint.accept', { digest: priced.blueprint.digest });
  await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  const client = await call('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN', ...(options.clientTaxId ? { taxId: options.clientTaxId } : {}) });
  return { deps, call, models, store, client, offers: priced.blueprint.offers as { id: string; playbookOffer?: string }[] };
}

/** The CA of record named; the rate-table versions given confirmed by them. */
async function caReady(env: Env, tableIds: string[] = []) {
  await env.call('venture.ca.setOfRecord', CA);
  if (tableIds.length) await env.call('venture.ca.confirmRates', { tableIds, membershipNo: CA.membershipNo });
}

/** An order on the CA offer whose playbook id is given, with the client's files added to it. */
async function caOrder(env: Env, offerKey: string, request: string, files: { name: string; content: string }[]) {
  const offer = env.offers.find(item => item.playbookOffer === offerKey);
  assert.ok(offer, `no offer for ${offerKey}`);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: offer.id, request });
  for (const file of files) await env.call('venture.files.add', { orderId: order.id, name: file.name, contentBase64: b64(file.content) });
  return order;
}

type Part = { kind: 'text' | 'figure'; text: string; ref: string };
const words = (text: string): Part => ({ kind: 'text', text, ref: '' });
const fig = (ref: string): Part => ({ kind: 'figure', text: '', ref });
const papers = (title: string, sections: { work: Part[]; open: Part[] }) => ({
  title, questionsForClient: [],
  sections: [
    { heading: 'Summary', parts: [words('The working papers for this order follow, from the files you sent.')] },
    { heading: 'Working papers', parts: sections.work },
    { heading: 'Open items for you', parts: sections.open },
    { heading: 'What your CA does next', parts: [words('Your CA checks these papers, signs them off, and files the return on the portal.')] },
  ],
});

const turn = (note: string, calls: [string, unknown][], finished = false) => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const DONE = turn('Ready to write the papers', [], true);

/** The agent's turns in order (the last one repeats), then the draft. */
function script(env: Env, turns: unknown[], draft: unknown) {
  let next = 0;
  env.models.respond['agent-turn'] = () => turns[Math.min(next++, turns.length - 1)];
  env.models.respond.delivery = () => draft;
  env.models.respond.judge = judgeYes;
}

const approve = (env: Env, run: DeliveryRunView): Promise<DeliveryRunView> => env.call('venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
/** Runs an order to its end: each turn approved as the owner would, then the draft. */
async function deliver(env: Env, orderId: string): Promise<DeliveryRunView> {
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId });
  for (let guard = 0; run.status === 'waiting-for-you' && guard < 8; guard += 1) run = await approve(env, run);
  return run;
}

const calls = (run: DeliveryRunView, tool: string): ToolCallRecord[] => run.harness!.toolCalls.filter(item => item.tool === tool);
const errorOf = (record: ToolCallRecord) => (record.envelope.ok ? null : record.envelope.error);
const playbookCheck = (run: DeliveryRunView, id: string) => {
  const found = run.playbookChecks?.find(item => item.check === id);
  assert.ok(found, `no playbook check ${id}: ${JSON.stringify(run.playbookChecks)}`);
  return found;
};
const workReceipts = (env: Env): WorkReceiptRecord[] => listRecords(env.store.read(), 'venture-work-receipt');
const figureOf = (receipt: WorkReceiptRecord, key: string) => receipt.figures.find(item => item.key === key);
const ventureId = (env: Env) => listRecords(env.store.read(), 'venture-record')[0].id;
const clientUse = (env: Env) => rateUseFor(env.store.read(), ventureId(env), 'client');
/** Every text value in a tool input: none of them may be an amount the model typed. */
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

// ---------------------------------------------------------------------------
// tax.gst
// ---------------------------------------------------------------------------

const SALES_HEADER = 'Invoice,Date,GSTIN,State,HSN,Taxable,Rate';
const SALES_LINES = [
  'INV-101,03/10/2026,27AAAFS1234K1ZB,27,998222,"10,000.00",18%',
  'INV-102,10/10/2026,29AAACB1234C1ZB,29-Karnataka,998222,"5,000.00",18%',
  'INV-103,21/10/2026,,Maharashtra,998222,"2,500.00",5%',
];
const SALES_REGISTER = [SALES_HEADER, ...SALES_LINES].join('\n');
const GST_CALL = {
  gstin: GSTIN, period: '2026-10',
  outward: { table: 'f1', invoice: 'Invoice', date: 'Date', counterpartyGstin: 'GSTIN', placeOfSupply: 'State', hsnSac: 'HSN', taxable: 'Taxable', rate: 'Rate' },
};
const GST_PAPERS = papers('GST working for October', {
  work: [words('Output tax by head, then the cash to pay:'), fig('w1.output-igst'), fig('w1.output-cgst'), fig('w1.output-sgst'), fig('w1.net-payable')],
  open: [words('Please confirm the place of supply on each sale to another state.')],
});
const GST_REQUEST = 'GST working for October, from the sales register I sent.';
const GST_FIGURES = { 'output-igst': R(900), 'output-cgst': String(BigInt(R(900)) + 6250n), 'output-sgst': String(BigInt(R(900)) + 6250n), 'net-payable': R(2825) };
const steps = (receipt: WorkReceiptRecord) => receipt.steps.map(step => [step.rule, step.inputs]);

test('tax.gst: the agent maps the sales register column by column and the calculator works the GST with its CA receipt', async () => {
  const env = await business(CA_IDEA, { clientTaxId: GSTIN });
  await caReady(env, ['in-gst-rates@2']);
  const order = await caOrder(env, 'gst-working', GST_REQUEST, [{ name: 'sales-register-october.csv', content: SALES_REGISTER }]);
  script(env, [turn('Work the GST from the sales register', [['tax.gst', GST_CALL]]), DONE], GST_PAPERS);
  const run = await deliver(env, order.id);
  assert.equal(run.status, 'ready-for-review', JSON.stringify(run.checks));

  const [gst] = calls(run, 'tax.gst');
  assert.equal(gst.outcome, 'succeeded', JSON.stringify(gst.envelope));
  // The model never typed an amount: its input holds column names, the GSTIN and the month only.
  for (const value of leaves(gst.input)) assert.equal(looksLikeAmount(value), false, value);
  const receipts = workReceipts(env);
  assert.equal(receipts.length, 1);
  const [receipt] = receipts;
  assert.equal(receipt.operation, 'ca.engine');
  assert.equal(receipt.ca!.engine, 'gst-working');
  assert.deepEqual(receipt.runRef, { kind: 'delivery', runId: run.id });
  // Intra-state: CGST and SGST at half the rate each; the inter-state sale is IGST.
  for (const [key, minor] of Object.entries(GST_FIGURES)) assert.equal(figureOf(receipt, key)!.minor, minor, key);
  assert.ok(receipt.figures.every(item => item.currency === 'INR' && item.unit === 'money'));
  // The whole CA receipt is kept, inputs included: worked again from them it is the same receipt.
  const again = gstWorking(receipt.ca!.inputs as unknown as GstWorkingInput, clientUse(env));
  assert.equal(again.id, receipt.ca!.caReceiptId);
  assert.deepEqual(receipt.figures.map(item => [item.key, item.minor, item.display]), again.figures.map(item => [item.key, item.minor, item.display]));
  assert.deepEqual(receipt.ca!.steps, again.steps);
  assert.equal(receipt.ca!.explanation, again.explanation);
  assert.deepEqual(receipt.ca!.tables.map(table => [table.id, table.version, table.confirmed]), [['in-gst-rates', 2, true]]);
  // The agent read figure refs, never a number it must copy.
  const result = gst.envelope.ok ? gst.envelope.result as { receipt: string; figures: { ref: string }[] } : null;
  assert.equal(result?.receipt, 'w1');
  assert.ok(result!.figures.some(item => item.ref === 'w1.output-igst'));
  assert.ok(run.harness!.proofs.some(proof => proof.kind === 'totals' && proof.receiptId === receipt.id), 'the auditor kept the calculator proof');

  for (const id of ['tax-figure-receipted', 'figures-from-receipts', 'rates-confirmed', 'rates-in-window', 'not-modelled-refused', 'sections-flagged']) {
    assert.equal(playbookCheck(run, id).outcome, 'pass', `${id}: ${playbookCheck(run, id).detail}`);
  }
  // The rules judge (package 2C1) settles only with checked evidence; every code check passes.
  const code = run.checks.filter(item => item.check !== 'rules-judge');
  assert.ok(code.every(item => item.passed), JSON.stringify(code.filter(item => !item.passed)));
  assert.ok(run.renderedText!.includes('Output IGST: INR 900.00'), run.renderedText!);
});

test('tax.gst: a figure from another receipt beside the words about tax fails, as the client would read it', async () => {
  const env = await business(CA_IDEA, { clientTaxId: GSTIN });
  await caReady(env, ['in-gst-rates@2']);
  const order = await caOrder(env, 'gst-working', GST_REQUEST, [{ name: 'sales-register-october.csv', content: SALES_REGISTER }]);
  script(env, [turn('Work the GST from the sales register', [['tax.gst', GST_CALL]]), DONE], papers('GST working for October', {
    work: [words('GST payable this month:'), fig('order.total'), words('The working by head:'), fig('w1.output-cgst')],
    open: [words('Nothing is open for you.')],
  }));
  const run = await deliver(env, order.id);
  assert.equal(run.status, 'ready-for-review');
  const check = playbookCheck(run, 'tax-figure-receipted');
  assert.equal(check.outcome, 'fail', check.detail);
  assert.match(check.detail, /on no calculator receipt/);
  assert.equal(run.canAccept, false);
});

test('tax.gst: the GSTIN is the client\'s on record, or one a client file shows; a mistake in the GSTIN or the month is the agent\'s to fix', async () => {
  const env = await business(CA_IDEA);
  await caReady(env, ['in-gst-rates@2']);
  const order = await caOrder(env, 'gst-working', GST_REQUEST, [{ name: 'sales-register-october.csv', content: SALES_REGISTER }]);
  script(env, [turn('Work the GST', [
    ['tax.gst', { ...GST_CALL, gstin: 'not-a-gstin' }], ['tax.gst', { ...GST_CALL, period: '10/2026' }], ['tax.gst', GST_CALL],
  ]), DONE], GST_PAPERS);
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  const [badGstin, badPeriod, unknown] = calls(run, 'tax.gst').map(errorOf);
  for (const error of [badGstin, badPeriod, unknown]) assert.deepEqual([error!.code, error!.details], ['TOOL_FAILED', undefined], error!.message);
  assert.match(badGstin!.message, /not a valid GSTIN/);
  assert.match(badPeriod!.message, /month written like 2026-10/);
  assert.match(unknown!.message, /appears in none of the order's files/);
  assert.deepEqual(workReceipts(env), []);

  // A GSTIN on record that is another one is refused; one in a client file is taken.
  const other = await business(CA_IDEA, { clientTaxId: '27AAACL1234F1ZZ' });
  await caReady(other, ['in-gst-rates@2']);
  const otherOrder = await caOrder(other, 'gst-working', GST_REQUEST, [{ name: 'sales-register-october.csv', content: SALES_REGISTER }]);
  script(other, [turn('Work the GST', [['tax.gst', GST_CALL]]), DONE], GST_PAPERS);
  let otherRun: DeliveryRunView = await other.call('venture.delivery.run', { orderId: otherOrder.id });
  otherRun = await approve(other, otherRun);
  assert.match(errorOf(calls(otherRun, 'tax.gst')[0])!.message, /not the client's GSTIN on record/);

  const shown = await business(CA_IDEA);
  await caReady(shown, ['in-gst-rates@2']);
  const register = [`${SALES_HEADER},Seller GSTIN`, ...SALES_LINES.map(line => `${line},${GSTIN}`)].join('\n');
  const shownOrder = await caOrder(shown, 'gst-working', GST_REQUEST, [{ name: 'sales-register-october.csv', content: register }]);
  script(shown, [turn('Work the GST', [['tax.gst', GST_CALL]]), DONE], GST_PAPERS);
  const shownRun = await deliver(shown, shownOrder.id);
  assert.equal(calls(shownRun, 'tax.gst')[0].outcome, 'succeeded');
});

test('tax.gst: rows the agent leaves out are logged, and a credit note is listed as not counted instead of refusing the register', async () => {
  const env = await business(CA_IDEA, { clientTaxId: GSTIN });
  await caReady(env, ['in-gst-rates@2']);
  const register = [SALES_HEADER, ...SALES_LINES, 'Total,31/10/2026,,27,998222,"17,500.00",18%', 'CN-7,25/10/2026,27AAAFS1234K1ZB,27,998222,"-1,000.00",18%'].join('\n');
  const order = await caOrder(env, 'gst-working', GST_REQUEST, [{ name: 'sales-register-october.csv', content: register }]);
  script(env, [turn('Work the GST, leaving out the total row', [
    ['tax.gst', { ...GST_CALL, outward: { ...GST_CALL.outward, skipRows: ['r9'] } }],
    ['tax.gst', { ...GST_CALL, outward: { ...GST_CALL.outward, skipRows: ['r4'] } }],
  ]), DONE], GST_PAPERS);
  const run = await deliver(env, order.id);
  const [unknownRow, worked] = calls(run, 'tax.gst');
  assert.deepEqual([errorOf(unknownRow)!.code, errorOf(unknownRow)!.message], ['TOOL_FAILED', 'f1 has no row r9 to leave out.']);
  assert.equal(worked.outcome, 'succeeded', JSON.stringify(worked.envelope));
  const [receipt] = workReceipts(env);
  // The subtotal row has a date and an amount: left out, nothing is counted twice.
  for (const [key, minor] of Object.entries(GST_FIGURES)) assert.equal(figureOf(receipt, key)!.minor, minor, key);
  const result = (worked.envelope.ok ? worked.envelope.result : null) as { notCounted: { line: string; reason: string }[] };
  assert.deepEqual(result.notCounted.map(item => item.line), ['sale.f1.r5']);
  assert.match(result.notCounted[0].reason, /credit or debit note/);
  assert.deepEqual(steps(receipt).filter(([rule]) => /left out|credit or debit/.test(String(rule))), [
    ['rows of f1 the agent left out', ['f1.r4']], ['credit or debit notes in f1, not counted: your CA works them', ['f1.r5']],
  ]);
});

test('tax.gst: a table the CA has not confirmed refuses with do not retry, makes no receipt, and works once the CA confirms it', async () => {
  const env = await business(CA_IDEA, { clientTaxId: GSTIN });
  await caReady(env);
  const order = await caOrder(env, 'gst-working', GST_REQUEST, [{ name: 'sales-register-october.csv', content: SALES_REGISTER }]);
  script(env, [turn('Work the GST from the sales register', [['tax.gst', GST_CALL]]), DONE], GST_PAPERS);
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  const [refused] = calls(run, 'tax.gst');
  assert.equal(refused.outcome, 'failed');
  assert.equal(errorOf(refused)!.code, 'RATE_UNCONFIRMED');
  assert.equal((errorOf(refused)!.details as { retry: boolean }).retry, false);
  assert.deepEqual(workReceipts(env), [], 'no receipt from a refused working');
  // The next act turn tells the agent not to try again.
  // 4J11: the history is { summary, turns }.
  const history = (env.models.previewed.at(-1)!.input as { history: { turns: { calls: { tool: string; error?: { message: string } }[] }[] } }).history.turns;
  const line = history.flatMap(item => item.calls).find(item => item.tool === 'tax.gst')!.error!.message;
  assert.match(line, /^Do not retry: Your CA has not confirmed /);

  await env.call('venture.ca.confirmRates', { tableIds: ['in-gst-rates'], membershipNo: CA.membershipNo });
  script(env, [turn('Work the GST from the sales register', [['tax.gst', GST_CALL]]), DONE], GST_PAPERS);
  const again = await deliver(env, order.id);
  assert.equal(calls(again, 'tax.gst')[0].outcome, 'succeeded');
  assert.equal(workReceipts(env).length, 1);
  assert.equal(playbookCheck(again, 'rates-confirmed').outcome, 'pass');
});

test('rehearsal: the CA firm\'s practice client sends a sales register, and the tool works on unconfirmed tables, marked rehearsal only', async () => {
  assert.ok(PRACTICE_FILES['bookkeeping-clean'].some(file => file.name === 'sales-register-september.csv'), 'the clean practice client sends a sales register');
  const env = await business(CA_IDEA);
  const practice = { ...GST_CALL, gstin: '27AAACL1234F1ZZ', period: '2026-09', outward: { ...GST_CALL.outward, table: 'f3' } };
  script(env, [turn('Work the GST from the practice sales register', [['tax.gst', practice]]), DONE], GST_PAPERS);
  const run: SimulationRunRecord = await env.call('venture.simulation.run', { scenarioIds: ['bookkeeping-clean'] });
  const [episode] = run.episodes;
  const toolCall = episode.harness!.toolCalls.find(item => item.tool === 'tax.gst')!;
  assert.equal(toolCall.outcome, 'succeeded', JSON.stringify(toolCall.envelope));
  const rates = episode.playbookChecks!.find(item => item.check === 'rates-confirmed')!;
  assert.equal(rates.outcome, 'pass');
  assert.match(rates.detail, /^Rehearsal only/);
});

test('rehearsal: a refusal from the calculator reaches the practice draft\'s checks as do not retry', async () => {
  const env = await business(CA_IDEA);
  const income = { assessmentYear: '2027-28', regime: 'new', residency: 'resident', ageBand: 'below-60', otherIncome: [{ table: 'f2', row: 'r1', column: 'Amount' }], alsoHas: ['capital-gains'] };
  script(env, [turn('Work the tax', [['tax.income', income]]), DONE], papers('Your month', { work: [words('The papers follow.')], open: [words('Your capital gains go to your CA.')] }));
  const run: SimulationRunRecord = await env.call('venture.simulation.run', { scenarioIds: ['bookkeeping-clean'] });
  const [episode] = run.episodes;
  assert.equal(errorOf(episode.harness!.toolCalls.find(item => item.tool === 'tax.income')!)!.code, 'NOT_MODELLED');
  const check = episode.playbookChecks!.find(item => item.check === 'tax-figure-receipted')!;
  assert.equal(check.outcome, 'fail');
  assert.match(check.detail, /Do not retry/);
});

// ---------------------------------------------------------------------------
// tax.income
// ---------------------------------------------------------------------------

/** Form 16 text as the PDF reader gives it: a1 is the tax deducted, a2 the professional tax, a3 the gross salary. */
const FORM_16 = [
  'Form 16 Part B, financial year 2026-27',
  'Tax deducted at source 9,000.00',
  'Professional tax 2,500.00',
  'Gross salary under section 17(1) 12,85,000.00',
].join('\n');
/** A PDF's bytes; each Form gets its own, since the PDF reader keeps what it read by the file's digest. */
const pdf = (text: string) => `%PDF-1.7 synthetic ${digest(text).slice(0, 16)}`;
const INCOME = { assessmentYear: '2027-28', regime: 'new', residency: 'resident', ageBand: 'below-60', salary: [{ file: 'f1', amount: 'a3' }] };
const incomePapers = (open: string) => papers('Income tax computation', {
  work: [words('Your tax for the year under the new regime:'), fig('w1.tax-liability-rounded')],
  open: [words(open)],
});

test('tax.income: a case the calculator does not model is refused, do not retry; asked again it is answered from the run, and the draft must hand it to the CA', async () => {
  const env = await business(CA_IDEA, { pdfText: FORM_16 });
  await caReady(env, ['in-income-tax-ay-2027-28']);
  const request = 'Income tax for my salary this year, from the Form 16 I sent.';
  const turns = [
    turn('Read the Form and work the tax', [
      ['files.read', { target: 'f1', part: 'pages' }], ['tax.income', { ...INCOME, alsoHas: ['capital-gains'] }], ['tax.income', { ...INCOME, alsoHas: ['capital-gains'] }],
    ]),
    turn('Work the salary part the calculator models', [['tax.income', INCOME]]),
    DONE,
  ];
  const order = await caOrder(env, 'itr-salaried', request, []);
  await env.call('venture.files.add', { orderId: order.id, name: 'form-16.pdf', contentBase64: b64(pdf(FORM_16)) });
  script(env, turns, incomePapers('Your capital gains go to your CA, who works them into the return.'));
  const run = await deliver(env, order.id);
  assert.equal(run.status, 'ready-for-review');

  const [refused, repeated, worked] = calls(run, 'tax.income');
  assert.equal(errorOf(refused)!.code, 'NOT_MODELLED');
  assert.deepEqual(errorOf(refused)!.details, { retry: false });
  assert.match(errorOf(refused)!.message, /does not compute capital gains/);
  // The same call again is not run: the run's own answer comes back, saying which call it came from.
  assert.equal(errorOf(repeated)!.code, 'NOT_MODELLED');
  assert.deepEqual(errorOf(repeated)!.details, { retry: false, answeredFrom: refused.id });
  assert.equal(worked.outcome, 'succeeded');
  // Just above the rebate limit: the rebate is the marginal relief, so the tax is only what the income is above it.
  const [receipt] = workReceipts(env);
  assert.equal(receipt.ca!.engine, 'income-tax');
  const rebate = figureOf(receipt, 'rebate-87a')!;
  assert.match(rebate.label, /marginal relief/);
  assert.equal(rebate.minor, R(51_500));
  assert.equal(figureOf(receipt, 'tax-liability')!.minor, R(10_400));
  assert.equal(computeIncomeTax(receipt.ca!.inputs as unknown as IncomeTaxInput, clientUse(env)).id, receipt.ca!.caReceiptId);
  assert.equal(playbookCheck(run, 'not-modelled-refused').outcome, 'pass', playbookCheck(run, 'not-modelled-refused').detail);
  assert.equal(playbookCheck(run, 'tax-figure-receipted').outcome, 'pass', playbookCheck(run, 'tax-figure-receipted').detail);

  // The same work, but the open items never hand the capital gains to the CA.
  const second = await caOrder(env, 'itr-salaried', request, []);
  await env.call('venture.files.add', { orderId: second.id, name: 'form-16.pdf', contentBase64: b64(pdf(FORM_16)) });
  script(env, turns, incomePapers('Please send the sale notes for the shares you sold.'));
  const silent = await deliver(env, second.id);
  const check = playbookCheck(silent, 'not-modelled-refused');
  assert.equal(check.outcome, 'fail');
  assert.match(check.detail, /capital gains/);
  assert.equal(silent.canAccept, false);
});

test('tax.income: picks come from a PDF amount id or a table cell, each once; a missing amount, column or row fails and says what is there', async () => {
  const env = await business(CA_IDEA, { pdfText: FORM_16 });
  await caReady(env, ['in-income-tax-ay-2027-28']);
  const order = await caOrder(env, 'itr-salaried', 'Income tax for my salary this year, under the old regime.', []);
  await env.call('venture.files.add', { orderId: order.id, name: 'form-16.pdf', contentBase64: b64(pdf(FORM_16)) });
  await env.call('venture.files.add', { orderId: order.id, name: 'savings.csv', contentBase64: b64('Bank,Interest,PPF\nState Bank,"4,200.00","50,000.00"') });
  const old = { ...INCOME, regime: 'old' };
  const cell = (column: string, row = 'r1') => ({ table: 'f2', row, column });
  script(env, [
    turn('Try the picks', [
      ['tax.income', { ...old, salary: [{ file: 'f1', amount: 'a9' }] }],
      ['tax.income', { ...old, otherIncome: [cell('Amount')] }],
      ['tax.income', { ...old, otherIncome: [cell('Interest', 'r9')] }],
      ['tax.income', { ...old, otherIncome: [cell('Interest')], deductions: [{ code: '80C', amount: [cell('Interest')] }] }],
    ]),
    turn('Work the tax', [['tax.income', { ...old, otherIncome: [cell('Interest')], deductions: [{ code: '80C', amount: [cell('PPF')] }] }]]),
    DONE,
  ], papers('Income tax computation', {
    work: [words('Your savings deduction, then your tax for the year under the old regime:'), fig('w1.deduction-80C'), fig('w1.tax-liability-rounded')],
    open: [words('Nothing is open for you.')],
  }));
  const run = await deliver(env, order.id);
  const [noAmount, noColumn, noRow, twice, worked] = calls(run, 'tax.income');
  assert.deepEqual([errorOf(noAmount)!.code, errorOf(noAmount)!.message], ['TOOL_FAILED', 'f1 has no amount a9. Read it again with files.read part pages.']);
  assert.equal(errorOf(noColumn)!.code, 'TOOL_FAILED');
  assert.match(errorOf(noColumn)!.message, /no column "Amount".*Bank, Interest, PPF/);
  assert.deepEqual([errorOf(noRow)!.code, errorOf(noRow)!.message], ['TOOL_FAILED', 'f2 has no row r9.']);
  assert.equal(errorOf(twice)!.code, 'TOOL_FAILED');
  assert.match(errorOf(twice)!.message, /picked twice/);
  assert.equal(worked.outcome, 'succeeded', JSON.stringify(worked.envelope));
  const [receipt] = workReceipts(env);
  assert.equal(figureOf(receipt, 'other-income')!.minor, R(4_200));
  assert.equal(figureOf(receipt, 'deduction-80C')!.minor, R(50_000));
  // The labels the client reads carry no section number, so quoting them cites none the CA has not confirmed.
  assert.doesNotMatch(figureOf(receipt, 'deduction-80C')!.label, /80C/);
  for (const id of ['sections-flagged', 'tax-figure-receipted', 'figures-from-receipts']) assert.equal(playbookCheck(run, id).outcome, 'pass', `${id}: ${playbookCheck(run, id).detail}`);
});

test('tax.income: an amount is never read from a table a program made', async () => {
  const runRef = { kind: 'rehearsal' as const, scenarioId: 'bookkeeping-clean', episode: 0 };
  const content = Buffer.from('Bank,Interest\nState Bank,"4,200.00"').toString('base64');
  const file: FileLike = { id: 'upload_savings', name: 'savings.csv', format: 'csv', bytes: 40, digest: digest(content), contentBase64: content, clientData: false };
  const rows = [{ id: 'r1', cells: { Interest: '4,200.00' } }];
  const made: WorkTableRecord = {
    id: 'worktable_1', kind: 'venture-work-table', ventureId: 'venture_1', memberId: 'owner', epoch: 1, at: '2026-10-21T10:00:00.000Z', name: 'Made from savings.csv',
    columns: ['Interest'], rows, source: { kind: 'transform', fromTableId: file.id, tier: 'wasm-lite', driver: 'test', programDigest: 'program', moduleDigest: null }, runRef, digest: digest(rows),
  };
  const env: ToolEnv = {
    deps: { services: {} } as unknown as VentureDeps, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year', runRef,
    files: [file], tables: [made], receipts: [], dictionary: [], sandbox: undefined, now: () => '2026-10-21T10:00:00.000Z', allowed: [], rateUse: REHEARSAL,
  };
  const input = { assessmentYear: '2027-28', regime: 'new', residency: 'resident', ageBand: 'below-60', otherIncome: [{ table: 't1', row: 'r1', column: 'Interest' }] };
  const outcome = await callTool(env, ['tax.income'], 1, 0, { tool: 'tax.income', input: JSON.stringify(input) });
  assert.equal(errorOf(outcome.record)!.code, 'TOOL_FAILED');
  assert.match(errorOf(outcome.record)!.message, /t1 was made by a program/);
  const fromFile = await callTool(env, ['tax.income'], 1, 1, { tool: 'tax.income', input: JSON.stringify({ ...input, otherIncome: [{ table: 'f1', row: 'r1', column: 'Interest' }] }) });
  assert.equal(fromFile.record.outcome, 'succeeded', JSON.stringify(fromFile.record.envelope));
});

// ---------------------------------------------------------------------------
// tax.interest
// ---------------------------------------------------------------------------

/** Form 16 for the tax year to 31 March 2027: a1 the tax deducted, a2 the gross salary. */
const FORM_16_INTEREST = ['Form 16 Part B, financial year 2026-27', 'Tax deducted at source 1,50,000.00', 'Gross salary under section 17(1) 20,75,000.00'].join('\n');
/** One payment inside the year and one paid after it ended, which is not advance tax. */
const ADVANCE_TAX = 'Date,Amount\n10/03/2027,"20,000.00"\n05/04/2027,"5,000.00"';

test('tax.interest: takes the tax from the income tax receipt by key and works 234A, 234B and 234C with the receipt', async () => {
  const env = await business(CA_IDEA, { pdfText: FORM_16_INTEREST });
  await caReady(env, ['in-income-tax-ay-2027-28', 'in-income-tax-interest-ay-2027-28']);
  const order = await caOrder(env, 'itr-salaried', 'My return will be late. Work the tax and the interest, from the Form 16 and the advance tax I paid.', []);
  await env.call('venture.files.add', { orderId: order.id, name: 'form-16.pdf', contentBase64: b64(pdf(FORM_16_INTEREST)) });
  await env.call('venture.files.add', { orderId: order.id, name: 'advance-tax.csv', contentBase64: b64(ADVANCE_TAX) });
  const income = { assessmentYear: '2027-28', regime: 'new', residency: 'resident', ageBand: 'below-60', salary: [{ file: 'f1', amount: 'a2' }], prepaid: { tds: [{ file: 'f1', amount: 'a1' }] } };
  const interest = { assessmentYear: '2027-28', advanceTax: { table: 'f2', date: 'Date', amount: 'Amount' }, filedOn: '2027-09-10' };
  script(env, [
    turn('Total the advance tax, then work the tax', [['calc.sum', { table: 'f2', amountColumn: 'Amount' }], ['tax.interest', { ...interest, taxFrom: 'w1' }], ['tax.income', income]]),
    turn('Work the interest', [['tax.interest', { ...interest, taxFrom: 'w2', filedOn: '10-09-2027' }], ['tax.interest', { ...interest, taxFrom: 'w2' }]]),
    DONE,
  ], papers('Tax and interest', { work: [words('Interest for the late return and the short advance tax:'), fig('w3.interest-total')], open: [words('Nothing is open for you.')] }));
  const run = await deliver(env, order.id);
  assert.equal(run.status, 'ready-for-review');
  const [notIncome, badDate, worked] = calls(run, 'tax.interest');
  assert.equal(errorOf(notIncome)!.code, 'TOOL_FAILED');
  assert.match(errorOf(notIncome)!.message, /w1 is not an income tax receipt/);
  assert.deepEqual([errorOf(badDate)!.code, errorOf(badDate)!.details], ['TOOL_FAILED', undefined]);
  assert.match(errorOf(badDate)!.message, /filedOn is a date written YYYY-MM-DD/);
  assert.equal(worked.outcome, 'succeeded', JSON.stringify(worked.envelope));
  // The payment after the year ended is listed, not a refusal of the whole table.
  const result = (worked.envelope.ok ? worked.envelope.result : null) as { notCounted: { line: string; reason: string }[] };
  assert.deepEqual(result.notCounted.map(item => item.line), ['f2.r2']);

  const receipts = workReceipts(env);
  const tax = receipts.find(item => item.ca?.engine === 'income-tax')!;
  const interestReceipt = receipts.find(item => item.ca?.engine === 'interest-234')!;
  assert.equal(figureOf(tax, 'tax-liability')!.minor, R(2_08_000));
  const expected = computeInterest234({
    assessmentYear: '2027-28', taxOnTotalIncomeMinor: R(2_08_000), tdsMinor: R(1_50_000), advanceTax: [{ date: '2027-03-10', amountMinor: R(20_000) }], filedOn: '2027-09-10',
  }, clientUse(env));
  assert.deepEqual(interestReceipt.figures.map(item => [item.key, item.minor]), expected.figures.map(item => [item.key, item.minor]));
  for (const key of ['interest-234a', 'interest-234b', 'interest-234c']) assert.ok(BigInt(figureOf(interestReceipt, key)!.minor) > 0n, key);
  assert.equal(computeInterest234(interestReceipt.ca!.inputs as unknown as InterestInput, clientUse(env)).id, interestReceipt.ca!.caReceiptId);
  // The interest label the client reads names no section, so the draft that quotes it passes.
  for (const id of ['sections-flagged', 'tax-figure-receipted']) assert.equal(playbookCheck(run, id).outcome, 'pass', `${id}: ${playbookCheck(run, id).detail}`);
});

// ---------------------------------------------------------------------------
// tax.tds
// ---------------------------------------------------------------------------

const PAYMENTS = [
  'Payee,PAN,Kind,Section,Date,Amount',
  'Sharma Builders,AAAFS1234K,Firm,194C,10/05/2026,"35,000.00"',
  'Meera Iyer,ABCPI1234K,Individual,194J-professional,15/06/2026,"60,000.00"',
  'Rao Tech,AAACR1234K,Company,194J,20/06/2026,"70,000.00"',
  'Late Builders,ABCPL1234K,Individual,194C,05/04/2027,"40,000.00"',
].join('\n');
const TDS_COLUMNS = { payeeName: 'Payee', pan: 'PAN', payeeKind: 'Kind', section: 'Section', date: 'Date', amount: 'Amount' };

test('tax.tds: the payments table gives the deduction schedule and the challans; awkward rows are listed; a section the working does not have is not modelled', async () => {
  const env = await business(CA_IDEA);
  await caReady(env, ['in-tds-fy-2026-27']);
  // The template plan offers the books, the GST working and a salaried return; this firm offers the TDS working too.
  await ventureAction(env.deps, owner, 'admin', 'seed.tds-offer', tx => {
    const plan = tx.list('venture-blueprint').find(item => item.status === 'accepted')!;
    tx.replace({ ...plan, offers: plan.offers.map(offer => (offer.playbookOffer === 'monthly-books' ? { ...offer, playbookOffer: 'tds-working', name: { ...offer.name, value: 'TDS working' } } : offer)) });
  });
  for (const offer of env.offers) if (offer.playbookOffer === 'monthly-books') offer.playbookOffer = 'tds-working';
  const order = await caOrder(env, 'tds-working', 'TDS working for this quarter, from the payments I sent.', [
    { name: 'payments.csv', content: PAYMENTS },
    { name: 'purchases.csv', content: 'Payee,PAN,Kind,Section,Date,Amount\nGood Goods,AAACG1234K,Company,194Q,12/05/2026,"80,00,000.00"' },
  ]);
  script(env, [turn('Work the TDS', [
    ['tax.tds', { financialYear: '2026-27', payments: { table: 'f1', ...TDS_COLUMNS } }],
    ['tax.tds', { financialYear: '2026-27', payments: { table: 'f2', ...TDS_COLUMNS } }],
  ]), DONE], papers('TDS working', { work: [words('Tax to deduct this quarter:'), fig('w1.tds-total')], open: [words('The purchase of goods goes to your CA.')] }));
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId: order.id });
  run = await approve(env, run);
  const [worked, other] = calls(run, 'tax.tds');
  assert.equal(worked.outcome, 'succeeded', JSON.stringify(worked.envelope));
  assert.equal(errorOf(other)!.code, 'NOT_MODELLED');
  assert.deepEqual(errorOf(other)!.details, { retry: false });

  const [receipt] = workReceipts(env);
  assert.equal(receipt.ca!.engine, 'tds-working');
  assert.equal(figureOf(receipt, 'tds-194C')!.minor, R(700));
  assert.equal(figureOf(receipt, 'tds-194J-professional')!.minor, R(6_000));
  assert.equal(figureOf(receipt, 'tds-total')!.minor, R(6_700));
  assert.equal(tdsWorking(receipt.ca!.inputs as unknown as TdsWorkingInput, clientUse(env)).id, receipt.ca!.caReceiptId);
  const result = (worked.envelope.ok ? worked.envelope.result : null) as {
    payments: { payee: string; section: string }[]; challans: { section: string; depositDue: string }[]; notCounted: { line: string; reason: string }[];
  };
  assert.deepEqual(result.payments.map(item => [item.payee, item.section]), [['Sharma Builders', '194C'], ['Meera Iyer', '194J-professional']]);
  assert.deepEqual(result.challans.map(item => [item.section, item.depositDue]), [['194C', '2026-06-07'], ['194J-professional', '2026-07-07']]);
  // A bare 194J (professional or technical, at different rates) and a payment after the year are listed, not counted.
  assert.deepEqual(result.notCounted.map(item => item.line), ['f1.r3', 'f1.r4']);
  assert.match(result.notCounted[0].reason, /194J-professional or 194J-technical/);
  assert.match(result.notCounted[1].reason, /outside the financial year 2026-27/);
});

// ---------------------------------------------------------------------------
// The hosted server, the playbook and the grants
// ---------------------------------------------------------------------------

test('hosted server: the four tax tools are code, so they are offered and run there', async () => {
  for (const name of ['tax.income', 'tax.interest', 'tax.gst', 'tax.tds'] as const) assert.equal(hostRefusal('hosted-web', name), null, name);
  assert.deepEqual(offeredTools(['tax.income', 'tax.interest', 'tax.gst', 'tax.tds'], 'hosted-web'), ['tax.income', 'tax.interest', 'tax.gst', 'tax.tds']);
  const env = await business(CA_IDEA, { clientTaxId: GSTIN });
  env.deps.host = 'hosted-web';
  await caReady(env, ['in-gst-rates@2']);
  const order = await caOrder(env, 'gst-working', GST_REQUEST, [{ name: 'sales-register-october.csv', content: SALES_REGISTER }]);
  script(env, [turn('Work the GST from the sales register', [['tax.gst', GST_CALL]]), DONE], GST_PAPERS);
  const run = await deliver(env, order.id);
  assert.equal(calls(run, 'tax.gst')[0].outcome, 'succeeded');
  const offered = (env.models.previewed[0].input as { tools: { tool: string }[] }).tools.map(item => item.tool);
  for (const name of ['tax.income', 'tax.interest', 'tax.gst', 'tax.tds']) assert.ok(offered.includes(name), name);
});

test('the compute step is an agent step holding the four tax tools; only the CA firm\'s agents are granted them', async () => {
  const compute = CA_STEPS.find(step => step.id === 'compute')!;
  assert.deepEqual([compute.kind, compute.model, compute.role.kind], ['work', 'fast', 'agent']);
  for (const name of ['files.read', 'tax.income', 'tax.interest', 'tax.gst', 'tax.tds', 'handoff.owner'] as const) assert.ok(compute.tools.includes(name), name);
  assert.deepEqual([...compute.caChecks], ['rates-confirmed', 'rates-in-window', 'not-modelled-refused']);
  assert.equal(compute.gate, 'ca-confirms-rates');
  assert.equal(validatePlaybook(caFirmPlaybookSteps()).validated, true);
  for (const name of ['tax.income', 'tax.interest', 'tax.gst', 'tax.tds'] as const) assert.equal(toolSpec(name)!.tier, 'code', name);

  const ca = await business(CA_IDEA);
  const caPlaybook: PlaybookRecord = await ca.call('venture.delivery.playbook');
  for (const name of ['tax.income', 'tax.interest', 'tax.gst', 'tax.tds']) assert.ok(playbookGrant(caPlaybook).includes(name as never), name);

  const plain = await business(PLAIN_IDEA);
  const plainPlaybook: PlaybookRecord = await plain.call('venture.delivery.playbook');
  const grant = playbookGrant(plainPlaybook) as string[];
  for (const name of ['tax.income', 'tax.interest', 'tax.gst', 'tax.tds']) assert.ok(!grant.includes(name), name);
  const patch = { id: 'patch_1', level: 'tools' as const, op: 'tools.grant' as const, stepId: 'work', value: 'tax.gst', note: { hypothesis: 'More tools.', expectedFixes: [], likelyRegressions: [] }, proposedBy: 'model' as const, parentHash: plainPlaybook.hash };
  const body = { steps: plainPlaybook.steps, limits: plainPlaybook.limits!, aliases: plainPlaybook.aliases ?? {} };
  assert.throws(() => applyPatch(body, patch, { serviceType: 'bookkeeping', entryIds: [], flagship: null }), (error: any) => error?.code === 'INVALID_VENTURE_REQUEST' && /may not hold tax\.gst/.test(error.message));
  const caBody = { steps: caPlaybook.steps, limits: caPlaybook.limits!, aliases: caPlaybook.aliases ?? {} };
  const granted = applyPatch(caBody, { ...patch, stepId: 'reconcile' }, { serviceType: 'bookkeeping', entryIds: [], flagship: 'ca-firm' });
  assert.ok(granted.steps.find(step => step.id === 'reconcile')!.tools!.includes('tax.gst'));
});

