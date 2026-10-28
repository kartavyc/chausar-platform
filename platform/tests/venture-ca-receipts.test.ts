// Ink v2 wave 2, package 2A2 (catalogue CA1, audit finance "stored CA receipts"): the CA firm's statements reconcile and
// the portal diff as agent tools, CA receipts stored whole and worked again on the exact table versions they stamped,
// and the CA's explanation of each portal difference. Everything goes through the real callers: venture.delivery.run
// and venture.delivery.approve with a scripted model port that never touches the network, venture.ca.receipt and
// venture.ca.explainDiff. Also the interest table for the tax year 2026-27 (assessment year 2027-28), sections 423, 424
// and 425 of the Income-tax Act, 2025, unconfirmed until the CA confirms it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { JUDGE_QUESTIONS } from '../runtime/venture/contracts.ts';
import type {
  CaFirmView, CaReceiptView, Deliverable, DeliveryRunView, ModelOutcome, ModelPort, ModelPreview, ModelPurpose, ModelStatusView, ModelTask, SecretShelf,
  ToolCallRecord, VentureDeps, VentureMethod, WorkReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { validatePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { looksLikeAmount } from '../runtime/venture/delivery/harness/cells.ts';
import { runFlagshipChecks } from '../runtime/venture/playbooks/draft-checks.ts';
import { CA_STEPS, caFirmPlaybookSteps } from '../runtime/venture/playbooks/ca-firm/playbook.ts';
import { reconcileTaxStatements, type ReconcileWorking, type StatementEntry } from '../runtime/venture/playbooks/ca-firm/reconcile.ts';
import { portalDiffReceipt, type OurFigure, type PortalDiff, type PortalFigure } from '../runtime/venture/playbooks/ca-firm/portal.ts';
import {
  ACT_2025_QUESTION, CARRIED_FORWARD, RATE_TABLE_HISTORY, RATE_TABLES, RENUMBERING_QUESTION, REHEARSAL, rateTableHash, useRateTable, validateRateTables,
  type InterestPayload, type RateTable,
} from '../runtime/venture/playbooks/ca-firm/rates.ts';
import { computeInterest234, interestTable, type InterestInput } from '../runtime/venture/playbooks/ca-firm/interest.ts';
import { sendToCa, signoffRequests } from '../runtime/venture/playbooks/ca-firm/signoff.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const phone: Context = { ...owner, channel: 'phone' };
const CA_IDEA = 'An AI-native CA firm for GST filing and income tax returns in Pune';
const CA = { name: 'CA Asha Rao', membershipNo: '123456' };
/** The client's GSTIN (Maharashtra), with its check character. */
const GSTIN = '27ABCDE1234F1Z0';
const b64 = (content: string) => Buffer.from(content, 'utf8').toString('base64');
const R = (rupees: number) => String(BigInt(rupees) * 100n);
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

// ---------------------------------------------------------------------------
// A scripted model port: previews wait for approval, answers come from the script by purpose
// ---------------------------------------------------------------------------

type Responder = (task: ModelTask<any>) => unknown;
class Port implements ModelPort {
  respond: Partial<Record<ModelPurpose, Responder>> = {};
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

/** A CA firm on the template route: plan priced on every offer, accepted, at approve each, one client. */
async function business() {
  const store = new VentureTestStore();
  const ontology = new OntologyService(store), calculator = new CalculatorService(store), trust = new TrustService(store);
  const pack = structuredClone(starterPacks.find(item => item.pack === 'services')!);
  pack.currency = 'INR';
  pack.gstMode = 'unregistered';
  for (const definition of pack.definitions) definition.currency = 'INR';
  await ontology.publish(owner, pack);
  const models = new Port();
  const secrets = { get: () => null, set: () => undefined, delete: () => undefined, has: () => false, clear: () => undefined } as unknown as SecretShelf;
  const helper = { async run() { return { result: { pages: [{ page: 1, text: '' }], coverage: 'Text extraction only.' }, receipt: {} }; } };
  const deps: VentureDeps = {
    store, clock: () => new Date('2026-10-21T10:00:00.000Z'), models, services: { calculator, ontology, trust, helper } as unknown as VentureDeps['services'],
    github: { kind: 'fixture', async read() { throw new ChausarError('GITHUB_READ_FAILED', 'No GitHub here.'); } },
    secrets, host: 'test', demo: true, storage: 'experimental-file',
  };
  const call = (method: VentureMethod, payload: unknown = {}, ctx: Context = owner): Promise<any> => {
    const handler = HANDLERS[method];
    assert.ok(handler, `no handler for ${method}`);
    return handler(deps, ctx, payload);
  };
  await call('venture.create', { idea: CA_IDEA, countryCode: 'IN', workingName: 'Test Business' });
  let interview = await call('venture.interview.next', { useTemplate: true });
  for (const question of interview.interview.questions) {
    const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id } : question.id === 'q_tax' ? { yes: false } : { skipped: true };
    interview = await call('venture.interview.answer', { questionId: question.id, answer });
  }
  const drafted = await call('venture.blueprint.draft', { useTemplate: true });
  const priced = await call('venture.blueprint.update', { patch: { offers: drafted.blueprint.offers.map((offer: any) => ({ id: offer.id, unitPrice: '1000' })) } });
  await call('venture.blueprint.accept', { digest: priced.blueprint.digest });
  await ventureAction(deps, owner, 'approve', 'seed.stage', tx => { tx.touch({ launchStage: 'approve-each' }); });
  // The client's GSTIN on record: the GST working is worked for that GSTIN only.
  const client = await call('venture.client.add', { name: 'Asha Rao', email: 'asha@example.com', countryCode: 'IN', taxId: GSTIN });
  return { deps, call, models, store, client, offers: priced.blueprint.offers as { id: string; playbookOffer?: string }[] };
}

async function caReady(env: Env, tableIds: string[] = []) {
  await env.call('venture.ca.setOfRecord', CA);
  if (tableIds.length) await env.call('venture.ca.confirmRates', { tableIds, membershipNo: CA.membershipNo });
}

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

function script(env: Env, turns: unknown[], draft: unknown) {
  let next = 0;
  env.models.respond['agent-turn'] = () => turns[Math.min(next++, turns.length - 1)];
  env.models.respond.delivery = () => draft;
  env.models.respond.judge = judgeYes;
}

async function deliver(env: Env, orderId: string): Promise<DeliveryRunView> {
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId });
  for (let guard = 0; run.status === 'waiting-for-you' && guard < 8; guard += 1) run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
  return run;
}

const calls = (run: DeliveryRunView, tool: string): ToolCallRecord[] => run.harness!.toolCalls.filter(item => item.tool === tool);
const errorOf = (record: ToolCallRecord) => (record.envelope.ok ? null : record.envelope.error);
const playbookCheck = (run: { playbookChecks?: DeliveryRunView['playbookChecks'] }, id: string) => {
  const found = run.playbookChecks?.find(item => item.check === id);
  assert.ok(found, `no playbook check ${id}: ${JSON.stringify(run.playbookChecks)}`);
  return found;
};
const workReceipts = (env: Env): WorkReceiptRecord[] => listRecords(env.store.read(), 'venture-work-receipt');
const figureOf = (receipt: WorkReceiptRecord, key: string) => receipt.figures.find(item => item.key === key);
const runOf = async (env: Env, runId: string): Promise<DeliveryRunView> => ((await env.call('venture.delivery.list')) as DeliveryRunView[]).find(item => item.id === runId)!;
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}
/** Replaces a stored work receipt as the vault holds it, the way a hand edit of the store would. */
async function editReceipt(env: Env, id: string, change: (receipt: WorkReceiptRecord) => WorkReceiptRecord) {
  await ventureAction(env.deps, owner, 'admin', 'seed.edit-receipt', tx => {
    const found = tx.list('venture-work-receipt').find(item => item.id === id)!;
    tx.replace(change(structuredClone(found)));
  });
}

// ---------------------------------------------------------------------------
// tax.statements
// ---------------------------------------------------------------------------

const BOOKS = ['Source,Category,Payer,Gross,TDS', 'Books,Salary,Acme Software Ltd,600000.00,45000.00', 'Books,Interest,State Bank of India,3000.00,300.00'].join('\n');
const AIS = ['Source,Category,Payer,Gross,TDS', 'AIS,Salary,Acme Software Ltd,600000.00,45000.00', 'AIS,Interest,State Bank of India,4200.00,300.00'].join('\n');
const COLUMNS = { category: 'Category', payer: 'Payer', gross: 'Gross', tds: 'TDS' };
const STATEMENTS = { entries: [{ table: 'f1', source: 'books', ...COLUMNS }, { table: 'f2', source: 'ais', ...COLUMNS }] };
/** The difference id reconcile gives the interest from State Bank, as AIS shows it against the books. */
const INTEREST_DIFF = `diff_${digest({ against: 'ais', category: 'interest', payer: 'state bank of india' }).slice(0, 12)}`;

test('tax.statements: the agent maps the books and AIS column by column; the calculator lists the 1,200.00 interest difference with a receipt', async () => {
  const env = await business();
  await caReady(env);
  const request = 'Match my AIS to my books before the return.';
  const files = [{ name: 'books.csv', content: BOOKS }, { name: 'ais.csv', content: AIS }];
  const order = await caOrder(env, 'itr-salaried', request, files);
  const silent = papers('AIS against the books', { work: [words('AIS and the books were matched by the calculator.')], open: [words('Please send the interest certificate from your bank.')] });
  script(env, [turn('Match AIS to the books', [['tax.statements', STATEMENTS]]), DONE], silent);
  const run = await deliver(env, order.id);
  assert.equal(run.status, 'ready-for-review', JSON.stringify(run.checks));

  const [matched] = calls(run, 'tax.statements');
  assert.equal(matched.outcome, 'succeeded', JSON.stringify(matched.envelope));
  for (const value of leaves(matched.input)) assert.equal(looksLikeAmount(value), false, value);
  const [receipt] = workReceipts(env);
  assert.equal(receipt.operation, 'ca.engine');
  assert.equal(receipt.ca!.engine, 'reconcile');
  const working = receipt.ca!.working as unknown as ReconcileWorking;
  assert.deepEqual(working.differences.map(item => [item.id, item.kind, item.category, item.grossDeltaMinor]), [[INTEREST_DIFF, 'amount-differs', 'interest', R(1_200)]]);
  assert.equal(figureOf(receipt, `${INTEREST_DIFF}-amount`)!.minor, R(1_200));
  // Kept whole: worked again from its inputs it is the same receipt.
  const again = reconcileTaxStatements(receipt.ca!.inputs as unknown as { entries: StatementEntry[] });
  assert.equal(again.id, receipt.ca!.caReceiptId);
  assert.ok(run.harness!.proofs.some(proof => proof.kind === 'totals' && proof.receiptId === receipt.id), 'the auditor kept the calculator proof');
  const result = (matched.envelope.ok ? matched.envelope.result : null) as { receipt: string; differences: { amount: string; line: string }[] };
  assert.equal(result.receipt, 'w1');
  assert.deepEqual(result.differences.map(item => item.amount), [`w1.${INTEREST_DIFF}-amount`]);

  const left = playbookCheck(run, 'differences-listed');
  assert.equal(left.outcome, 'fail');
  assert.match(left.detail, /interest from state bank of india/);
  assert.equal(playbookCheck(run, 'gaps-tie').outcome, 'pass', playbookCheck(run, 'gaps-tie').detail);
  assert.match(playbookCheck(run, 'gaps-tie').detail, /AIS/);
  assert.equal(playbookCheck(run, 'portal-diff-explained').outcome, 'not-run');

  // The same work, with the difference among the open items.
  const second = await caOrder(env, 'itr-salaried', request, files);
  script(env, [turn('Match AIS to the books', [['tax.statements', STATEMENTS]]), DONE], papers('AIS against the books', {
    work: [words('AIS and the books were matched by the calculator.')],
    open: [words('AIS shows more interest from State Bank of India than your books, by:'), fig(`w1.${INTEREST_DIFF}-amount`)],
  }));
  const listed = await deliver(env, second.id);
  assert.equal(playbookCheck(listed, 'differences-listed').outcome, 'pass', playbookCheck(listed, 'differences-listed').detail);
});

test('tax.statements: a column, a category or an amount it cannot read fails and says what is there', async () => {
  const env = await business();
  await caReady(env);
  const odd = ['Category,Payer,Gross', 'Lottery,State Bank of India,100.00'].join('\n');
  const order = await caOrder(env, 'itr-salaried', 'Match my AIS to my books.', [{ name: 'books.csv', content: BOOKS }, { name: 'odd.csv', content: odd }]);
  const books = { table: 'f1', source: 'books', ...COLUMNS };
  const ais = { table: 'f2', source: 'ais', category: 'Category', payer: 'Payer', gross: 'Gross' };
  script(env, [turn('Match', [
    ['tax.statements', { entries: [books] }],
    ['tax.statements', { entries: [{ ...books, payer: 'Name' }, ais] }],
    ['tax.statements', { entries: [books, ais] }],
    ['tax.statements', { entries: [books, { ...ais, categories: [{ written: 'Lottery', category: 'other' }] }] }],
  ]), DONE], papers('AIS', { work: [words('Matched.')], open: [words('Nothing is open.')] }));
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId: order.id });
  run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
  const [booksOnly, noColumn, noCategory, mapped] = calls(run, 'tax.statements');
  assert.equal(errorOf(booksOnly)!.code, 'TOOL_FAILED');
  assert.match(errorOf(booksOnly)!.message, /AIS, 26AS or Form 16/);
  assert.equal(errorOf(noColumn)!.code, 'TOOL_FAILED');
  assert.match(errorOf(noColumn)!.message, /no column "Name".*Source, Category, Payer, Gross, TDS/);
  assert.equal(errorOf(noCategory)!.code, 'TOOL_FAILED');
  assert.match(errorOf(noCategory)!.message, /"Lottery".*salary, interest/);
  assert.equal(mapped.outcome, 'succeeded', JSON.stringify(mapped.envelope));
});

// gaps-tie is arithmetic only. reconcileTaxStatements compares each statement over the books' income that statement
// reports (covers: Form 16 is salary only, 26AS is income with tax deducted), so its gap always equals the differences
// listed. Totalling all of the books instead would make every normal return fail: income a statement never reports
// would show as a gap. So the check says what it proves, and a failure means the stored working was changed.
const FORM_16_TABLE = ['Source,Category,Payer,Gross,TDS', 'Form 16,Salary,Acme Software Ltd,600000.00,45000.00'].join('\n');
const BOOKS_WITH_SAVINGS = [BOOKS, 'Books,Interest,HDFC Bank,1000.00,0.00'].join('\n');

test('gaps-tie through a run: Form 16 is matched on salary only, so interest in the books is no gap, and the check says it is arithmetic only', async () => {
  const env = await business();
  await caReady(env);
  const order = await caOrder(env, 'itr-salaried', 'Match my Form 16 to my books.', [{ name: 'books.csv', content: BOOKS_WITH_SAVINGS }, { name: 'form-16.csv', content: FORM_16_TABLE }]);
  script(env, [turn('Match the salary statement to the books', [['tax.statements', { entries: [{ table: 'f1', source: 'books', ...COLUMNS }, { table: 'f2', source: 'form16', ...COLUMNS }] }]]), DONE],
    papers('Salary statement against the books', { work: [words('The salary statement and the books were matched by the calculator.')], open: [words('Nothing is open for you.')] }));
  const run = await deliver(env, order.id);
  const [receipt] = workReceipts(env);
  assert.deepEqual((receipt.ca!.working as unknown as ReconcileWorking).differences, [], 'interest is outside what Form 16 reports');
  const tie = playbookCheck(run, 'gaps-tie');
  assert.equal(tie.outcome, 'pass', tie.detail);
  assert.match(tie.detail, /^Arithmetic only/);
  assert.match(tie.detail, /Form 16/);
  assert.equal(playbookCheck(run, 'differences-listed').outcome, 'pass');
});

test('gaps-tie fails naming the statement whose gap from the books the listed differences do not add up to', async () => {
  const deliverable: Deliverable = papers('AIS', { work: [words('Matched.')], open: [words('Nothing is open.')] }) as unknown as Deliverable;
  const working: ReconcileWorking = {
    differences: [], crossChecks: [],
    ties: [{ against: '26as', field: 'tds', sourceTotalMinor: R(100), booksTotalMinor: '0', gapMinor: R(100), sumOfDifferencesMinor: '0', ties: false }],
  };
  const receipt = { id: 'work_test', figures: [], ca: { engine: 'reconcile', working, tables: [] } };
  const results = await runFlagshipChecks({
    flagship: 'ca-firm', offerKey: 'itr-salaried', servedBy: 'model', deliverable, request: 'Match my 26AS.', intake: null, files: [], receipts: [receipt as never],
    known: [], mode: 'client', today: '2026-10-21', dateOrder: 'day-month-year', finishing: null,
  });
  const tie = results.find(item => item.check === 'gaps-tie')!;
  assert.equal(tie.outcome, 'fail');
  assert.match(tie.detail, /^Arithmetic only/);
  assert.match(tie.detail, /26AS/);
});

test('differences-listed reads only the newest match of each statement: a later tax.statements over the same AIS settles the earlier difference', async () => {
  const env = await business();
  await caReady(env);
  const fixed = AIS.replace('4200.00', '3000.00');
  const order = await caOrder(env, 'itr-salaried', 'Match my AIS to my books.', [{ name: 'books.csv', content: BOOKS }, { name: 'ais.csv', content: AIS }, { name: 'ais-corrected.csv', content: fixed }]);
  const corrected = { entries: [STATEMENTS.entries[0], { ...STATEMENTS.entries[1], table: 'f3' }] };
  script(env, [turn('Match, then match the corrected AIS', [['tax.statements', STATEMENTS], ['tax.statements', corrected]]), DONE],
    papers('AIS against the books', { work: [words('AIS and the books were matched by the calculator.')], open: [words('Nothing is open for you.')] }));
  const run = await deliver(env, order.id);
  const [first, second] = workReceipts(env);
  assert.equal((first.ca!.working as unknown as ReconcileWorking).differences.length, 1);
  assert.equal((second.ca!.working as unknown as ReconcileWorking).differences.length, 0);
  const listed = playbookCheck(run, 'differences-listed');
  assert.equal(listed.outcome, 'pass', listed.detail);
});

// ---------------------------------------------------------------------------
// tax.portal, venture.ca.explainDiff and venture.ca.receipt
// ---------------------------------------------------------------------------

const SALES_REGISTER = [
  'Invoice,Date,GSTIN,State,HSN,Taxable,Rate',
  'INV-101,03/10/2026,27AAAFS1234K1ZB,27,998222,"10,000.00",18%',
  'INV-102,10/10/2026,29AAACB1234C1ZB,29-Karnataka,998222,"5,000.00",18%',
  'INV-103,21/10/2026,,Maharashtra,998222,"2,500.00",5%',
].join('\n');
/** The portal's GSTR-3B summary as the client exported it: two fields named the portal's way. */
const PORTAL = ['Field,Amount', 'IGST,900.00', 'output-cgst,962.50', 'output-sgst,962.50', 'Total tax payable,"2,900.00"'].join('\n');
const GST_CALL = {
  gstin: GSTIN, period: '2026-10',
  outward: { table: 'f1', invoice: 'Invoice', date: 'Date', counterpartyGstin: 'GSTIN', placeOfSupply: 'State', hsnSac: 'HSN', taxable: 'Taxable', rate: 'Rate' },
};
const PORTAL_CALL = {
  portal: { table: 'f2', key: 'Field', amount: 'Amount' }, ours: ['w1'], keys: ['output-igst', 'output-cgst', 'output-sgst', 'net-payable'],
  rename: [{ field: 'IGST', key: 'output-igst' }, { field: 'Total tax payable', key: 'net-payable' }],
};
const GST_PAPERS = papers('GST working for October', {
  work: [words('Output tax by head, then the cash to pay:'), fig('w1.output-igst'), fig('w1.output-cgst'), fig('w1.output-sgst'), fig('w1.net-payable')],
  open: [words('Please confirm the place of supply on each sale to another state.')],
});

/** A GST order whose run worked the GST (w1) and compared the portal's summary with it (w2). */
async function portalRun(env: Env) {
  await caReady(env, ['in-gst-rates@2']);
  const order = await caOrder(env, 'gst-working', 'GST working for October, and the portal summary I exported.', [
    { name: 'sales-register-october.csv', content: SALES_REGISTER }, { name: 'gstr3b-portal.csv', content: PORTAL },
  ]);
  script(env, [turn('Work the GST, then compare the portal', [['tax.gst', GST_CALL], ['tax.portal', PORTAL_CALL], ['tax.portal', { ...PORTAL_CALL, ours: ['w9'] }], ['tax.portal', { ...PORTAL_CALL, keys: ['late-fee'] }]]), DONE], GST_PAPERS);
  const run = await deliver(env, order.id);
  const [gst, diff] = workReceipts(env);
  return { run, gst, diff };
}

test('tax.portal: the portal\'s figures against the named receipts by key; the diff is a stored receipt and the papers wait for the CA to explain it', async () => {
  const env = await business();
  const { run, gst, diff } = await portalRun(env);
  assert.equal(run.status, 'ready-for-review', JSON.stringify(run.checks));
  const [compared, noReceipt, noKey] = calls(run, 'tax.portal');
  assert.equal(compared.outcome, 'succeeded', JSON.stringify(compared.envelope));
  for (const value of leaves(compared.input)) assert.equal(looksLikeAmount(value), false, value);
  assert.equal(errorOf(noReceipt)!.code, 'TOOL_FAILED');
  assert.match(errorOf(noReceipt)!.message, /no receipt "w9"/);
  assert.equal(errorOf(noKey)!.code, 'TOOL_FAILED');
  assert.match(errorOf(noKey)!.message, /late-fee/);

  assert.equal(diff.operation, 'ca.engine');
  assert.equal(diff.ca!.engine, 'portal-diff');
  const rows = (diff.ca!.working as unknown as PortalDiff).rows;
  assert.deepEqual(rows.map(row => [row.key, row.state, row.deltaMinor]), [
    ['net-payable', 'differs', R(75)], ['output-cgst', 'same', '0'], ['output-igst', 'same', '0'], ['output-sgst', 'same', '0'],
  ]);
  assert.ok(rows.every(row => row.receiptId === null || row.receiptId === gst.id));
  assert.deepEqual(diff.figures.map(item => [item.key, item.minor]), [['net-payable', R(75)], ['output-cgst', '0'], ['output-igst', '0'], ['output-sgst', '0']]);
  const again = portalDiffReceipt(diff.ca!.inputs as unknown as { ours: OurFigure[]; portal: PortalFigure[] });
  assert.equal(again.id, diff.ca!.caReceiptId);
  assert.ok(run.harness!.proofs.some(proof => proof.kind === 'totals' && proof.receiptId === diff.id), 'the auditor kept the calculator proof');

  const explained = playbookCheck(run, 'portal-diff-explained');
  assert.equal(explained.outcome, 'fail');
  assert.match(explained.detail, /net-payable/);
  assert.doesNotMatch(explained.detail, /output-igst/);
  assert.equal(playbookCheck(run, 'gaps-tie').outcome, 'not-run');
  assert.equal(run.canAccept, false);
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), (error: any) => {
    assert.equal(error?.code, 'INVALID_VENTURE_REQUEST');
    assert.match(error.message, /net-payable/);
    return true;
  });
  // Papers that fail a check are not put in front of the CA yet.
  assert.deepEqual(signoffRequests(env.store.read(), run.ventureId), []);
});

test('venture.ca.explainDiff: the CA of record explains each difference; the papers then pass, go to the CA, and are accepted once signed', async () => {
  const env = await business();
  const { run, gst, diff } = await portalRun(env);
  const note = 'Portal rounds the payable differently; the CA accepts the portal figure.';
  const ask = (payload: Record<string, unknown>, ctx: Context = owner) => env.call('venture.ca.explainDiff', { receiptId: diff.id, key: 'net-payable', note, membershipNo: CA.membershipNo, ...payload }, ctx);
  await assert.rejects(ask({}, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(ask({ membershipNo: '654321' }), code('CA_NOT_OF_RECORD'));
  await assert.rejects(ask({ key: 'tax-payable' }), code('CA_DIFF_KEY_UNKNOWN'));
  await assert.rejects(ask({ key: 'output-igst' }), code('CA_DIFF_KEY_UNKNOWN'));
  await assert.rejects(ask({ receiptId: 'work_nothing' }), code('CA_RECEIPT_NOT_FOUND'));
  await assert.rejects(ask({ receiptId: gst.id }), code('CA_RECEIPT_NOT_FOUND'));
  assert.equal(playbookCheck(await runOf(env, run.id), 'portal-diff-explained').outcome, 'fail', 'a refused explanation changes nothing');

  const { explanation } = await ask({ membershipNo: '123 456' });
  assert.deepEqual([explanation.receiptId, explanation.key, explanation.note, explanation.caName, explanation.membershipNo], [diff.id, 'net-payable', note, CA.name, CA.membershipNo]);
  // One explanation per difference: a second one would change what the CA said.
  await assert.rejects(ask({ note: 'Something else.' }), code('CA_DIFF_EXPLAINED'));
  const now = await runOf(env, run.id);
  const check = playbookCheck(now, 'portal-diff-explained');
  assert.equal(check.outcome, 'pass', check.detail);
  // Regulated papers: now they pass their checks, they wait for the CA's sign-off, and Accept says so.
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), code('CA_SIGNOFF_REQUIRED'));
  const [request] = signoffRequests(env.store.read(), run.ventureId);
  assert.ok(request, 'the papers went in front of the CA once the difference was explained');
  assert.equal(request.deliveryId, run.id);
  await sendToCa(env.deps, owner, [request.id]);
  await env.call('venture.ca.recordSignoff', { requestId: request.id, membershipNo: CA.membershipNo });
  // Signed papers: no explanation is recorded under the signature any more.
  await assert.rejects(ask({ note: 'Something else.' }), code('CA_DIFF_SIGNED'));
  const accepted: DeliveryRunView = await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  assert.equal(accepted.status, 'accepted');

  const view: CaReceiptView = await env.call('venture.ca.receipt', { id: diff.id }, phone);
  assert.deepEqual(view.explanations.map(item => [item.key, item.note]), [['net-payable', note]]);
  assert.deepEqual(view.portalDifferences!.map(item => [item.key, item.state, item.ours, item.portal, item.explanation]), [['net-payable', 'differs', 'INR 2,825.00', 'INR 2,900.00', note]]);
});

/** The run of portalRun, with the explanation recorded while the run waits for its next turn. */
test('an explanation the CA records while the run is still working counts when the run finishes its draft', async () => {
  const env = await business();
  await caReady(env, ['in-gst-rates@2']);
  const order = await caOrder(env, 'gst-working', 'GST working for October, and the portal summary I exported.', [
    { name: 'sales-register-october.csv', content: SALES_REGISTER }, { name: 'gstr3b-portal.csv', content: PORTAL },
  ]);
  script(env, [turn('Work the GST, then compare the portal', [['tax.gst', GST_CALL], ['tax.portal', PORTAL_CALL]]), DONE], GST_PAPERS);
  let run: DeliveryRunView = await env.call('venture.delivery.run', { orderId: order.id });
  run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
  assert.equal(run.status, 'waiting-for-you');
  const diff = workReceipts(env).find(item => item.ca?.engine === 'portal-diff')!;
  await env.call('venture.ca.explainDiff', { receiptId: diff.id, key: 'net-payable', note: 'The portal rounds the payable; the CA accepts it.', membershipNo: CA.membershipNo });
  while (run.status === 'waiting-for-you') run = await env.call('venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
  assert.equal(run.status, 'ready-for-review');
  const check = playbookCheck(run, 'portal-diff-explained');
  assert.equal(check.outcome, 'pass', check.detail);
});

/** The portal's summary again, corrected: the payable now agrees. And one that has the IGST row only. */
const PORTAL_FIXED = PORTAL.replace('"2,900.00"', '"2,825.00"');
const PORTAL_IGST_ONLY = ['Field,Amount', 'IGST,900.00', ',125.00'].join('\n');

test('portal-diff-explained reads the newest comparison of each key: a later one settles a difference; a key no later one compared stays open', async () => {
  const env = await business();
  await caReady(env, ['in-gst-rates@2']);
  const files = [
    { name: 'sales-register-october.csv', content: SALES_REGISTER }, { name: 'gstr3b-portal.csv', content: PORTAL },
    { name: 'gstr3b-portal-corrected.csv', content: PORTAL_FIXED }, { name: 'gstr3b-igst.csv', content: PORTAL_IGST_ONLY },
  ];
  const settled = await caOrder(env, 'gst-working', 'GST working for October, and the portal summary I exported.', files);
  script(env, [turn('Compare, then compare the corrected summary', [['tax.gst', GST_CALL], ['tax.portal', PORTAL_CALL], ['tax.portal', { ...PORTAL_CALL, portal: { ...PORTAL_CALL.portal, table: 'f3' } }]]), DONE], GST_PAPERS);
  const fixedRun = await deliver(env, settled.id);
  assert.equal(playbookCheck(fixedRun, 'portal-diff-explained').outcome, 'pass', playbookCheck(fixedRun, 'portal-diff-explained').detail);

  const open = await caOrder(env, 'gst-working', 'GST working for October, and the portal summary I exported.', files);
  const igstOnly = { portal: { table: 'f4', key: 'Field', amount: 'Amount' }, ours: ['w1'], keys: ['output-igst'], rename: [{ field: 'IGST', key: 'output-igst' }] };
  script(env, [turn('Compare, then compare the IGST alone', [['tax.gst', GST_CALL], ['tax.portal', PORTAL_CALL], ['tax.portal', igstOnly]]), DONE], GST_PAPERS);
  const openRun = await deliver(env, open.id);
  const check = playbookCheck(openRun, 'portal-diff-explained');
  assert.equal(check.outcome, 'fail');
  assert.match(check.detail, /net-payable/);
  // The portal row with an amount and no field name is listed, not compared.
  const [, igst] = calls(openRun, 'tax.portal');
  const result = (igst.envelope.ok ? igst.envelope.result : null) as { notCounted: { line: string; reason: string }[] };
  assert.deepEqual(result.notCounted.map(item => item.line), ['f4.r2']);
});

test('venture.ca.receipt: a stored CA receipt worked again on its stamped tables reads same; an edited figure differs; a table version that is gone never reads same', async () => {
  const env = await business();
  const { run, gst, diff } = await portalRun(env);
  const view: CaReceiptView = await env.call('venture.ca.receipt', { id: gst.id });
  assert.deepEqual([view.id, view.runId, view.engine, view.rederived, view.differs], [gst.id, run.id, 'gst-working', 'same', null]);
  assert.deepEqual(view.figures.map(item => [item.key, item.display]), gst.figures.map(item => [item.key, item.display]));
  assert.ok(view.steps.length > 0 && view.steps.every(step => typeof step.display === 'string'));
  assert.deepEqual(view.tables.map(table => [table.id, table.version, table.confirmed, table.confirmedBy]), [['in-gst-rates', 2, true, 'CA Asha Rao (ICAI 123456)']]);
  assert.deepEqual(view.explanations, []);
  assert.equal((await env.call('venture.ca.receipt', { id: diff.id }) as CaReceiptView).rederived, 'same');

  await assert.rejects(env.call('venture.ca.receipt', { id: 'work_nothing' }), code('CA_RECEIPT_NOT_FOUND'));
  await assert.rejects(env.call('venture.ca.receipt', { id: 'work_nothing', extra: true }), code('INVALID_VENTURE_REQUEST'));

  // Each guard, on a fresh copy of the stored receipt: the vault is put back after each one.
  const original = structuredClone(gst);
  const after = async (change: (receipt: WorkReceiptRecord) => WorkReceiptRecord): Promise<CaReceiptView> => {
    await editReceipt(env, gst.id, () => change(structuredClone(original)));
    return env.call('venture.ca.receipt', { id: gst.id });
  };

  // One stored figure changed in the vault: worked again, it differs, and the line names it.
  const edited = await after(receipt => ({ ...receipt, figures: receipt.figures.map(item => (item.key === 'output-igst' ? { ...item, minor: R(950) } : item)) }));
  assert.equal(edited.rederived, 'differs');
  assert.equal(edited.differs!.key, 'output-igst');
  assert.match(edited.differs!.line, /INR 950\.00.*INR 900\.00/);

  // Only a label changed: the amounts agree, and the line says the labels differ.
  const relabelled = await after(receipt => ({ ...receipt, figures: receipt.figures.map(item => (item.key === 'output-igst' ? { ...item, label: 'IGST collected' } : item)) }));
  assert.deepEqual([relabelled.rederived, relabelled.differs!.key], ['differs', 'output-igst']);
  assert.match(relabelled.differs!.line, /labels differ/);

  // The stored inputs edited: they are not the ones the receipt was worked from.
  const inputs = await after(receipt => ({ ...receipt, ca: { ...receipt.ca!, inputs: { ...(receipt.ca!.inputs as Record<string, unknown>), period: '2026-09' } } }));
  assert.deepEqual([inputs.rederived, inputs.differs!.key], ['differs', 'inputs']);

  // A current table whose text changed since it was stamped: the stamp's hash no longer matches.
  const changed = await after(receipt => ({ ...receipt, ca: { ...receipt.ca!, tables: receipt.ca!.tables.map(stamp => ({ ...stamp, hash: '0'.repeat(64) })) } }));
  assert.equal(changed.rederived, 'table-gone');
  assert.match(changed.differs!.line, /changed since/);

  // A version kept only in history, replaced by a correction: never worked on again as if current.
  const replaced = RATE_TABLE_HISTORY.find(table => table.id === 'in-tds-fy-2025-26' && table.version === 1)!;
  const history = await after(receipt => ({ ...receipt, ca: { ...receipt.ca!, tables: [useRateTable(replaced, REHEARSAL)] } }));
  assert.equal(history.rederived, 'table-gone');
  assert.match(history.differs!.line, /replaced by a correction/);

  // A version Chausar never kept: never same.
  const gone = await after(receipt => ({ ...receipt, ca: { ...receipt.ca!, tables: [{ ...receipt.ca!.tables[0], version: 9 }] } }));
  assert.equal(gone.rederived, 'table-gone');
  assert.match(gone.differs!.line, /version 9/);

  // The working or a figure's display edited: the engine agrees on every amount; only the receipt's own digest shows it.
  const working = await after(receipt => ({ ...receipt, ca: { ...receipt.ca!, working: { edited: true } } }));
  assert.deepEqual([working.rederived, working.differs!.key], ['differs', 'receipt']);
  assert.match(working.differs!.line, /own digest/);
  const display = await after(receipt => ({ ...receipt, figures: receipt.figures.map(item => (item.key === 'output-igst' ? { ...item, display: 'INR 9,000.00' } : item)) }));
  assert.deepEqual([display.rederived, display.differs!.key], ['differs', 'receipt']);

  await after(receipt => receipt);
  assert.equal((await env.call('venture.ca.receipt', { id: gst.id }) as CaReceiptView).rederived, 'same', 'put back, it reads same again');
});

test('Your CA reads the receipts of the latest regulated papers', async () => {
  const env = await business();
  const { gst, diff } = await portalRun(env);
  const view: CaFirmView = await env.call('venture.ca.get');
  assert.ok(view.latestPapers, 'the latest regulated papers are named');
  assert.deepEqual(view.latestPapers!.receiptIds, [gst.id, diff.id]);
  assert.match(view.latestPapers!.title, /GST working papers/);
});

// ---------------------------------------------------------------------------
// The playbook
// ---------------------------------------------------------------------------

test('the reconcile step holds tax.statements beside its old tools, and the compute step holds tax.portal; the portal-diff step stays code', () => {
  const reconcile = CA_STEPS.find(step => step.id === 'reconcile')!;
  assert.deepEqual([...reconcile.tools], ['files.read', 'calc.sum', 'calc.totals', 'books.reconcile', 'bills.pick', 'tax.statements', 'handoff.client', 'handoff.owner']);
  const compute = CA_STEPS.find(step => step.id === 'compute')!;
  assert.deepEqual([...compute.tools], ['files.read', 'tax.income', 'tax.interest', 'tax.gst', 'tax.tds', 'tax.portal', 'tax.citations', 'tax.formChooser', 'tax.advance', 'tax.whatIf', 'books.healthCheck', 'docs.entry', 'handoff.owner']);
  const portal = CA_STEPS.find(step => step.id === 'portal-diff')!;
  assert.deepEqual([portal.tier, portal.tools.length, portal.gate], ['code', 0, 'ca-accepts-portal-diff']);
  assert.equal(validatePlaybook(caFirmPlaybookSteps()).validated, true);
});

// ---------------------------------------------------------------------------
// The interest table for the tax year 2026-27 (assessment year 2027-28)
// ---------------------------------------------------------------------------

const OFFICIAL = /^https:\/\/(?:www\.)?(?:incometaxindia\.gov\.in|incometax\.gov\.in|indiabudget\.gov\.in)\//;
const INTEREST: InterestInput = {
  assessmentYear: '2027-28', taxOnTotalIncomeMinor: R(1_00_000), tdsMinor: R(20_000), advanceTax: [{ date: '2026-12-10', amountMinor: R(30_000) }], filedOn: '2027-09-10',
};
const figure = (receipt: { figures: { key: string; minor: string }[] }, key: string) => receipt.figures.find(item => item.key === key)!.minor;

test('the AY 2027-28 interest table: sections 423, 424 and 425 of the Income-tax Act, 2025, official citations, unconfirmed', () => {
  const table = RATE_TABLES.find(item => item.id === 'in-income-tax-interest-ay-2027-28') as RateTable<InterestPayload>;
  assert.ok(table, 'the table is kept');
  validateRateTables(RATE_TABLES);
  assert.deepEqual([table.kind, table.version, table.validFrom, table.validTo, table.payload.assessmentYear, table.payload.yearStart, table.payload.dueDate, table.payload.businessDueDate],
    ['income-tax-interest', 1, '2026-04-01', '2027-04-01', '2027-28', '2027-04-01', '2027-07-31', '2027-08-31']);
  assert.equal(interestTable('2027-28').id, table.id);
  assert.equal(interestTable('2026-27').id, 'in-income-tax-interest-ay-2026-27');
  const ref = (key: string) => { const found = table.sections.find(item => item.key === key)!; return `${found.act} ${found.section}`; };
  assert.equal(ref('interest-234a'), 'Income-tax Act, 2025 423');
  assert.equal(ref('interest-234b'), 'Income-tax Act, 2025 424');
  assert.equal(ref('interest-234c'), 'Income-tax Act, 2025 425');
  assert.equal(ref('due-date'), 'Income-tax Act, 2025 263(1)(c)');
  assert.equal(ref('advance-tax-threshold'), 'Income-tax Act, 2025 404');
  // No official page gave the instalment section's new number: the 1961 number is carried forward, flagged for the CA.
  assert.equal(ref('installments'), 'Income-tax Act, 1961 211');
  assert.ok(table.sections.every(item => item.needsCaConfirmation === true));
  for (const citation of table.citations) {
    assert.equal(citation.checkedOn, null);
    if (citation.url !== null) assert.match(citation.url, OFFICIAL, citation.source);
    else assert.equal(citation.note, CARRIED_FORWARD, citation.source);
  }
  assert.ok(table.citations.some(item => item.note === CARRIED_FORWARD));
  assert.ok(table.openQuestions.includes(RENUMBERING_QUESTION) && table.openQuestions.includes(ACT_2025_QUESTION));
  assert.deepEqual([useRateTable(table, REHEARSAL).confirmed, useRateTable(table, REHEARSAL).confirmedBy], [false, null]);
  assert.throws(() => useRateTable(table, { mode: 'client', confirmations: [] }), code('RATE_UNCONFIRMED'));
});

test('the AY 2027-28 interest works in rehearsal and, once the CA confirms the table, for a client; business income without audit is due on 31 August', () => {
  const table = RATE_TABLES.find(item => item.id === 'in-income-tax-interest-ay-2027-28')!;
  const late = computeInterest234(INTEREST);
  assert.equal(late.table?.id, table.id);
  assert.equal(late.table?.confirmed, false);
  // Due 31 July 2027, filed 10 September: two months late. Short advance tax from 1 April 2027: six months.
  assert.deepEqual(['interest-234a', 'interest-234b', 'interest-234c', 'interest-total'].map(key => figure(late, key)), [R(1_000), R(3_000), R(2_840), R(6_840)]);
  assert.ok(late.sections.some(item => item.act === 'Income-tax Act, 2025' && item.section === '423'));
  assert.ok(late.sections.some(item => item.section === '425'));

  // Presumptive business income with no audit: due 31 August, one instalment by 15 March.
  const business = computeInterest234({ ...INTEREST, business: true, presumptive: true });
  assert.deepEqual(['interest-234a', 'interest-234b', 'interest-234c'].map(key => figure(business, key)), [R(500), R(3_000), R(500)]);
  assert.ok(business.assumptions.some(line => /2027-08-31/.test(line)), business.assumptions.join(' | '));
  const onTime = computeInterest234({ ...INTEREST, business: true, filedOn: '2027-08-20' });
  assert.equal(figure(onTime, 'interest-234a'), '0');
  assert.equal(figure(computeInterest234({ ...INTEREST, filedOn: '2027-08-20' }), 'interest-234a'), R(500));

  assert.throws(() => computeInterest234(INTEREST, { mode: 'client', confirmations: [] }), code('RATE_UNCONFIRMED'));
  const confirmation = { tableId: table.id, version: table.version, hash: rateTableHash(table), caName: CA.name, membershipNumber: CA.membershipNo, at: '2026-10-21T10:00:00.000Z' };
  const confirmed = computeInterest234(INTEREST, { mode: 'client', confirmations: [confirmation] });
  assert.equal(confirmed.table?.confirmedBy, 'CA Asha Rao (ICAI 123456)');
  assert.equal(figure(confirmed, 'interest-total'), R(6_840));
});

test('the AY 2026-27 interest table, version 2: non-audit business income was due on 31 August 2026 (the Finance Act, 2026); version 1 is history only', () => {
  const current = RATE_TABLES.filter(item => item.id === 'in-income-tax-interest-ay-2026-27') as RateTable<InterestPayload>[];
  assert.deepEqual(current.map(item => [item.version, item.validFrom, item.validTo, item.payload.dueDate, item.payload.businessDueDate]), [[2, '2025-04-01', '2026-04-01', '2026-07-31', '2026-08-31']]);
  const first = RATE_TABLE_HISTORY.find(item => item.id === 'in-income-tax-interest-ay-2026-27' && item.version === 1) as RateTable<InterestPayload> | undefined;
  assert.ok(first, 'version 1 is kept for history');
  assert.equal(first.payload.businessDueDate, undefined);
  assert.notEqual(rateTableHash(first), rateTableHash(current[0]), 'a new hash, so the CA confirms version 2 again');
  validateRateTables(RATE_TABLE_HISTORY);
  assert.equal(interestTable('2026-27').version, 2);
  // The source this was read from is named on the table, and each official one is on an official site.
  const source = current[0].citations.find(item => /139\(1\)/.test(item.part ?? ''))!;
  assert.match(source.url!, OFFICIAL);
  assert.match(source.part!, /31 August/);

  const late = { assessmentYear: '2026-27' as const, taxOnTotalIncomeMinor: R(1_00_000), tdsMinor: R(20_000), advanceTax: [{ date: '2025-12-10', amountMinor: R(30_000) }], filedOn: '2026-08-20' };
  assert.equal(figure(computeInterest234(late), 'interest-234a'), R(500), 'no business income: due 31 July, one month late');
  const business = computeInterest234({ ...late, business: true });
  assert.equal(figure(business, 'interest-234a'), '0', 'business income and no audit: due 31 August, on time');
  assert.equal(business.table?.version, 2);
  assert.ok(business.assumptions.some(line => /2026-08-31/.test(line) && /CA confirms/.test(line)), business.assumptions.join(' | '));
});
