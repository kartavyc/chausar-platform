// P2-journal wiring: invoice issue, the delivery send to the owner's AI and connector posts all go through the action
// journal with bound, single-use approval tokens, from their own methods and from venture.queue.decide. No approval token
// ever reaches a model: not the prompts, not the run's history, not any stored record. No network, no real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { PURPOSE_TIER, REQUIRED_SECTIONS, STEP_PLAN } from '../runtime/venture/contracts.ts';
import type {
  BlueprintRecord, BrowserPort, BrowserPostJob, BrowserPostResult, ConnectorPostRecord, CountryProfile, DeliveryRunView, InvoiceView, JournalEntry,
  JournalRecord, ModelOutcome, ModelPort, ModelPreset, ModelPreview, ModelPurpose, ModelStatusView, ModelTask, OrderRecord, PriceFigure,
  PriceReceiptRecord, QueueDecision, QueueList, VentureDeps, VentureRecord,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction, type VentureTx } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { PRACTICE_FILES } from '../runtime/venture/delivery/harness/practice.ts';
import { decideConnectorRow, decidePost, proposePost, sweepStaleClaims } from '../runtime/venture/build/posting.ts';
import { AGENT_WINDOW_MS, CHECK_BEFORE_RETRYING, approveAction, proposeAction } from '../runtime/venture/journal/index.ts';
import { containsApprovalToken } from '../runtime/venture/journal/tokens.ts';
import { CLIENT_NAME, call as viewCall, owner as viewOwner, seedBlueprint, seedOrder as seedViewOrder, setup as viewSetup } from './venture-views-env.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { seedPostDraft } from './venture-post-drafts.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const agentCtx: Context = { ...owner, channel: 'mcp' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const journal = (deps: VentureDeps) => listRecords(deps.store.read(), 'venture-journal-entry');
const journalList = (deps: VentureDeps, ctx: Context = owner) => views['venture.journal.list']!(deps, ctx, {}) as Promise<{ entries: JournalEntry[] }>;
const viewsCall = <T>(deps: VentureDeps, method: string, payload: unknown = {}, ctx: Context = owner) =>
  (views as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method](deps, ctx, payload) as Promise<T>;

// ---------------------------------------------------------------------------
// 1. Invoice issue
// ---------------------------------------------------------------------------

test('invoice issue: Issue on Today proposes, approves with a bound token and applies once; the entry carries the price receipt', async () => {
  const env = await viewSetup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedViewOrder(env, plan);
  const prepared = await money['venture.invoice.prepare']!(env.deps, viewOwner, { orderId: order.id, dueInDays: 15 }) as InvoiceView;
  const [row] = (await viewCall<QueueList>(env, 'venture.queue.list')).rows.filter(item => item.kind === 'invoice');
  const decision = await viewCall<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'issue' });
  assert.deepEqual([decision.outcome, decision.line], ['done', 'Issued INV-0001.']);

  const [entry] = journal(env.deps);
  assert.equal(entry.action, 'invoice.issue');
  assert.equal(entry.subject, prepared.invoice.id);
  assert.equal(entry.target, CLIENT_NAME);
  assert.equal(entry.state, 'applied');
  assert.deepEqual(entry.journal.map(step => step.state), ['described', 'approved', 'applied']);
  assert.equal(entry.receiptId, prepared.invoice.priceReceiptId);
  assert.match(entry.approval!.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(entry.approval!.usedAt && entry.approval!.key && entry.claimedAt);
  assert.equal(entry.decidedBy, 'owner');
  assert.ok(!containsApprovalToken(JSON.stringify(env.store.read())), 'no token is stored anywhere');

  // Decide-once and no double write: issuing again is refused before the journal, and nothing new is journalled.
  await assert.rejects(money['venture.invoice.issue']!(env.deps, viewOwner, { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest }), code('INVOICE_NOT_DRAFT'));
  assert.equal(journal(env.deps).length, 1);
  const { entries } = await journalList(env.deps);
  assert.deepEqual(entries, [{ id: entry.id, action: 'Issue invoice', target: CLIENT_NAME, state: 'applied', at: entries[0].at, line: 'Issued INV-0001.', receiptId: prepared.invoice.priceReceiptId }]);
});

test('invoice issue: a stale digest or another channel is refused before anything is journalled', async () => {
  const env = await viewSetup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedViewOrder(env, plan);
  const prepared = await money['venture.invoice.prepare']!(env.deps, viewOwner, { orderId: order.id, dueInDays: 15 }) as InvoiceView;
  await assert.rejects(money['venture.invoice.issue']!(env.deps, viewOwner, { invoiceId: prepared.invoice.id, digest: 'f'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(money['venture.invoice.issue']!(env.deps, { ...viewOwner, channel: 'mcp' }, { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(money['venture.invoice.issue']!(env.deps, viewOwner, { invoiceId: 'invoice_missing', digest: prepared.invoice.digest }), code('INVOICE_NOT_FOUND'));
  assert.equal(journal(env.deps).length, 0);
});

// ---------------------------------------------------------------------------
// 2. The delivery send, with a scripted model port that keeps every prompt
// ---------------------------------------------------------------------------

const IN: CountryProfile = {
  code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india',
  tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', registrationNote: 'Check with a CA.', idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15' },
  paymentRails: ['razorpay'], dateOrder: 'day-month-year', complianceNotes: [],
};

class ScriptPort implements ModelPort {
  store: VentureTestStore;
  respond: Partial<Record<ModelPurpose, (task: ModelTask<any>) => unknown>> = {};
  previewed: ModelTask<any>[] = [];
  sent = 0;
  failNext: ChausarError | null = null;
  #previews = new Map<string, { digest: string; task: ModelTask<any>; used: boolean }>();
  #calls = 0;
  constructor(store: VentureTestStore) { this.store = store; }
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => ({ presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' });
    return { connections: [], tiers: { fast: tier('anthropic-haiku-5-5'), main: tier('anthropic-sonnet-5-5') }, spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' } };
  }
  presets(): ModelPreset[] { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate<T>(): Promise<ModelOutcome<T>> { throw new ChausarError('CLIENT_DATA_NEEDS_APPROVAL', 'Client data needs your approval.'); }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    await this.store.update(() => undefined);
    this.previewed.push(task);
    assert.equal(PURPOSE_TIER[task.purpose] === 'main' || PURPOSE_TIER[task.purpose] === 'fast', true);
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
    await this.store.update(state => { const record = state.conversations.find(item => item?.id === callId); if (record) record.status = 'completed'; });
    if (this.failNext) { const error = this.failNext; this.failNext = null; throw error; }
    const responder = this.respond[held.task.purpose];
    assert.ok(responder, `no responder for ${held.task.purpose}`);
    return { value: validate(structuredClone(responder(held.task))), by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'stub', costMicros: '200', priceConfirmed: true };
  }
}

const words = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
const STEP_TITLES = ['Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client'];
const figure = (key: PriceFigure['key'], label: string, minor: string, display: string): PriceFigure => ({ key, label, minor, display, currency: 'INR' });
function receiptRecord(tx: VentureTx, subject: PriceReceiptRecord['subject'], blueprintDigest: string): PriceReceiptRecord {
  return {
    ...tx.base('venture-price-receipt'), subject, operation: 'venture.price', currency: 'INR', minorDigits: 2,
    inputs: { unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxMode: 'gst', taxRateBps: '1800', taxTreatment: 'single', unitPriceBy: 'told-by-you', taxRateBy: 'country-table', blueprintDigest },
    steps: [], figures: [figure('unit', 'Unit price', '249900', 'INR 2,499.00'), figure('tax', 'GST at 18%', '44982', 'INR 449.82'), figure('total', 'Total', '294882', 'INR 2,948.82')],
    totalMinor: '294882', allowedNumbers: [], explanation: 'Synthetic receipt.', digest: 'receipt-digest', stale: false,
  };
}

type HarnessEnv = { store: VentureTestStore; models: ScriptPort; deps: VentureDeps; order: OrderRecord };

async function harnessSetup(): Promise<HarnessEnv> {
  const store = new VentureTestStore();
  const models = new ScriptPort(store);
  const deps = { store, clock: () => new Date('2026-10-16T10:00:00.000Z'), models, services: { ontology: { current: () => null } }, github: {}, secrets: {}, host: 'test', demo: true, storage: 'experimental-file' } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'create', tx => tx.put<VentureRecord>({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes in Pune, done by AI helpers with me checking every report.', ideaDigest: 'idea', workingName: 'Ledger Cafe Books',
    country: IN, serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  const blueprint = await ventureAction(deps, owner, 'admin', 'seed.blueprint', tx => {
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
    const record = tx.put<BlueprintRecord>({ ...tx.base('venture-blueprint'), ...body, status: 'accepted', digest: digest(body) });
    tx.touch({ blueprintId: record.id, acceptedBlueprintId: record.id });
    tx.put(receiptRecord(tx, { type: 'offer', offerId: 'offer_1' }, record.digest));
    return record;
  });
  const order = await ventureAction(deps, owner, 'prepare', 'seed.order', tx => {
    const client = tx.put({ ...tx.base('venture-client'), name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null });
    const base = tx.base('venture-order');
    const receipt = tx.put(receiptRecord(tx, { type: 'order', orderId: base.id }, blueprint.digest));
    return tx.put<OrderRecord>({ ...base, clientId: client.id, offerId: 'offer_1', quantity: '1', request: 'Please close my September books. The bank statement and the bills are attached.', status: 'open', priceReceiptId: receipt.id, deliveredOn: null, saleFactId: null });
  });
  for (const file of PRACTICE_FILES['bookkeeping-clean']) {
    await delivery['venture.files.add']!(deps, owner, { orderId: order.id, name: file.name, contentBase64: Buffer.from(file.content, 'utf8').toString('base64') });
  }
  return { store, models, deps, order };
}

const turnOf = (note: string, calls: [string, unknown][], finished = false) => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const part = (text: string) => ({ kind: 'text', text, ref: '' });
// No tool proved finished work here, so the reply keeps the plan's own sections and only promises.
const REPORT = {
  title: 'Your September books',
  sections: REQUIRED_SECTIONS.bookkeeping.map(heading => ({ heading, parts: [part('We will look at your statement and your bills and come back to you.')] })),
  questionsForClient: [],
};
const READ = turnOf('Look at the statement and the bills', [['files.list', {}], ['files.read', { target: 'f1', part: 'sample' }]]);
const DONE = turnOf('Ready to write the report', [], true);

function script(env: HarnessEnv, turns: unknown[]) {
  let next = 0;
  env.models.respond['agent-turn'] = () => turns[Math.min(next++, turns.length - 1)];
  env.models.respond.delivery = () => REPORT;
  // The ready report goes to the client, so the rules judge reads it on its own (judge-run.ts): one more journalled send.
  env.models.respond.judge = task => ({ votes: (task.input as { rules: { id: string }[] }).rules.map(rule => ({ rule: rule.id, answer: 'yes', cites: ['draft'], quote: '', reason: 'Fine.' })) });
}

const quoteRow = async (deps: VentureDeps) => (await viewsCall<QueueList>(deps, 'venture.queue.list')).rows.find(row => row.kind === 'quote');
const runViewOf = async (deps: VentureDeps) => (await delivery['venture.delivery.list']!(deps, owner, {}) as DeliveryRunView[])[0];

test('delivery: each send to your AI is a journal entry approved with a bound token, and no token ever reaches the model', async () => {
  const env = await harnessSetup();
  script(env, [READ, DONE]);
  // A real token exists in this process the whole time: the owner approved some other action and kept the token.
  const other = await proposeAction(env.deps, agentCtx, { action: 'connector.write', subject: 'mail_1', target: 'Mail app', actionDigest: 'e'.repeat(64), line: 'Send the reminder email.' });
  const { token } = await approveAction(env.deps, owner, { entryId: other.id, digest: other.actionDigest });

  let run = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: env.order.id }) as DeliveryRunView;
  assert.equal(run.status, 'waiting-for-you');
  // The first turn from Today, the rest from venture.delivery.approve: both paths are journalled.
  const row = await quoteRow(env.deps);
  assert.ok(row);
  const decided = await viewsCall<QueueDecision>(env.deps, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true });
  assert.equal(decided.outcome, 'done');
  run = await runViewOf(env.deps);
  for (let turn = 0; turn < 5 && run.status === 'waiting-for-you'; turn += 1) {
    run = await delivery['venture.delivery.approve']!(env.deps, owner, { runId: run.id, digest: run.preview!.digest }) as DeliveryRunView;
  }
  assert.equal(run.status, 'ready-for-review');

  const sends = journal(env.deps).filter(entry => entry.action === 'delivery.send');
  assert.equal(sends.length, env.models.sent);
  assert.ok(sends.length >= 3);
  for (const entry of sends) {
    assert.equal(entry.state, 'applied');
    assert.equal(entry.target, 'Cafe Aroma Demo');
    assert.deepEqual(entry.quote, { figure: '1000', payer: 'anthropic-sonnet-5-5' });
    assert.match(entry.approval!.tokenHash, /^[a-f0-9]{64}$/);
    assert.ok(entry.approval!.usedAt);
    assert.ok(Date.parse(entry.expiresAt!) <= Date.parse('2026-10-16T10:30:00.000Z'), 'never later than the preview it sends');
  }

  // Model context: every prompt the agent was given, every payload shown for approval, and the run's own history.
  const prompts = env.models.previewed.map(task => JSON.stringify({ instructions: task.instructions, input: task.input }));
  const state = env.store.read();
  const payloads = listRecords(state, 'venture-delivery-run').flatMap(item => [item.preview?.payloadText ?? '', JSON.stringify(item.harness ?? null)]);
  for (const text of [...prompts, ...payloads, JSON.stringify(state)]) {
    assert.ok(!containsApprovalToken(text), 'no approval token in model context');
    assert.ok(!text.includes(token), 'not even the token the owner holds');
  }
  const { entries } = await journalList(env.deps);
  assert.ok(entries.some(entry => entry.action === 'Send to your AI' && entry.state === 'applied'));
});

test('delivery: a send that times out is outcome_unknown with a check line, the run stops, and the call is never sent again', async () => {
  const env = await harnessSetup();
  script(env, [READ, DONE]);
  const run = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: env.order.id }) as DeliveryRunView;
  env.models.failNext = new ChausarError('MODEL_TIMEOUT', 'Your AI did not answer in time.');
  const row = await quoteRow(env.deps);
  const decided = await viewsCall<QueueDecision>(env.deps, 'venture.queue.decide', { id: row!.id, digest: row!.digest, action: 'approve', viewed: true });
  assert.deepEqual([decided.outcome, decided.reason], ['refused', 'MODEL_TIMEOUT']);
  const [entry] = journal(env.deps);
  assert.equal(entry.state, 'outcome_unknown');
  assert.ok(entry.journal.at(-1)!.line.includes(CHECK_BEFORE_RETRYING));
  assert.equal((await runViewOf(env.deps)).status, 'failed');
  await assert.rejects(delivery['venture.delivery.approve']!(env.deps, owner, { runId: run.id, digest: run.preview!.digest }), code('DELIVERY_NOT_WAITING'));
  assert.equal(env.models.sent, 1);
  assert.equal(journal(env.deps).length, 1);
});

test('delivery: a stale digest is refused before the journal, and an agent channel never approves a send', async () => {
  const env = await harnessSetup();
  script(env, [READ, DONE]);
  const run = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: env.order.id }) as DeliveryRunView;
  await assert.rejects(delivery['venture.delivery.approve']!(env.deps, owner, { runId: run.id, digest: 'f'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(delivery['venture.delivery.approve']!(env.deps, agentCtx, { runId: run.id, digest: run.preview!.digest }), code('APP_APPROVAL_REQUIRED'));
  assert.equal(journal(env.deps).length, 0);
  assert.equal(env.models.sent, 0);
});

// ---------------------------------------------------------------------------
// 3. Posting uses the general journal
// ---------------------------------------------------------------------------

function postingSetup() {
  const store = new VentureTestStore();
  let time = Date.parse('2026-10-21T10:00:00.000Z');
  const jobs: { job: BrowserPostJob; post: ConnectorPostRecord | undefined }[] = [];
  const browser: BrowserPort = {
    async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; },
    async post(job): Promise<BrowserPostResult> {
      jobs.push({ job, post: listRecords(store.read(), 'venture-connector-post').find(item => item.id === job.postId) });
      return { outcome: 'posted', line: 'X showed the post.', url: null };
    },
  };
  const deps = { store, clock: () => new Date(time), host: 'desktop', connectors: { browser, appReviewed: [], postTimeoutMs: 40 } } as unknown as VentureDeps;
  return { store, deps, jobs, advance: (ms: number) => { time += ms; } };
}

test('posting: a post is a journalled record; approve mints a bound token, the claim lands before the browser, and it is listed', async () => {
  const { deps, jobs, advance } = postingSetup();
  await ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Social media for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Lumen Social', country: null,
    serviceType: 'agency', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
  const draft = await seedPostDraft(deps, ['X: Fresh pastries at 8.', 'X: Too late.']);
  const post = await proposePost(deps, agentCtx, { connectorId: 'x', draftId: draft.id, part: 1, agent: 'Social writer' });
  assert.equal(post.expiresAt, new Date(Date.parse(post.at) + AGENT_WINDOW_MS).toISOString());
  const decision = await decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' });
  assert.equal(decision.post.state, 'applied');
  assert.deepEqual(decision.post.journal.map(step => step.state), ['described', 'approved', 'applied']);
  assert.match(decision.post.approval!.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(decision.post.approval!.usedAt);
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0].post?.claimedAt && jobs[0].post.approval?.usedAt, 'the claim was committed before the browser started');
  assert.equal(jobs[0].post.state, 'approved');
  assert.ok(!containsApprovalToken(JSON.stringify(deps.store.read())));
  const { entries } = await journalList(deps);
  assert.deepEqual(entries.map(entry => [entry.action, entry.target, entry.state]), [['Post', 'X', 'applied']]);

  // An agent proposal waits fifteen minutes; after that it is refused, the browser never starts, and the sweep closes it.
  // A day later first: Chausar's own posting limits (Ink v2 wave 2) hold a second post on a new channel within the day.
  advance(25 * 3_600_000);
  const late = await proposePost(deps, agentCtx, { connectorId: 'x', draftId: draft.id, part: 2 });
  advance(AGENT_WINDOW_MS + 1000);
  const refused = await decideConnectorRow(deps, owner, { id: late.id, digest: late.digest, action: 'approve' });
  assert.deepEqual([refused.outcome, refused.reason], ['refused', 'JOURNAL_EXPIRED']);
  assert.equal(jobs.length, 1);
  const swept = await sweepStaleClaims(deps, owner);
  assert.deepEqual(swept.map(item => [item.id, item.state]), [[late.id, 'rejected']]);
});
