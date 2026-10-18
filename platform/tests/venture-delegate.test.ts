// Heavy work: an agent hands a big job to the owner's own Claude Code or Codex. These tests drive the real process
// port against a fake command-line tool (fixtures/venture/delegate/fake-cli.mjs) that makes no model call and uses no
// network. They check that nothing starts before the owner approves the exact brief, that the tool's folder holds only
// the brief and the order's files and its environment holds no key, the time limit, that what it leaves is treated as
// untrusted data, that money figures count only once the calculator has worked them out again, and that the hosted
// server never offers, looks for or starts the tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { PURPOSE_TIER, STEP_PLAN } from '../runtime/venture/contracts.ts';
import type {
  BlueprintRecord, CapabilityStatus, CountryProfile, DelegatePorts, DelegateRunRecord, DeliveryRunView, HarnessState, ModelOutcome, ModelPort, ModelPreset,
  ModelPreview, ModelPurpose, ModelStatusView, ModelTask, OrderRecord, PriceReceiptRecord, VentureDeps, VentureRecord, WorkReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction, type VentureTx } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/delivery/index.ts';
import { capabilityList } from '../runtime/venture/delivery/capabilities.ts';
import { claimBacked } from '../runtime/venture/delivery/harness/claims.ts';
import {
  delegateArgs, delegateAvailability, delegateBrief, delegateEnv, DELEGATE_DEFAULT_LIMITS, delegateOffer, delegatePorts, folderNames, maskNumbers, REAL_ORDER_ONLY,
} from '../runtime/venture/delivery/harness/delegate.ts';
import { createDelegatePorts } from '../runtime/venture/delivery/harness/delegate-process.ts';
import { tablesOfFile } from '../runtime/venture/delivery/harness/files.ts';
import { actTask, newHarnessState, REPORT_SECTIONS } from '../runtime/venture/delivery/harness/loop.ts';
import { PRACTICE_FILES } from '../runtime/venture/delivery/harness/practice.ts';
import { HOSTED_NO_OWNER_CLI } from '../runtime/venture/delivery/harness/sandbox.ts';
import { callTool, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { sumRows } from '../runtime/venture/delivery/harness/work.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const phone: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' };
const clock = () => new Date('2026-10-18T10:00:00.000Z');
const ORDER_REQUEST = 'Please close my September books. The bank statement and the bills are attached.';
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const FAKE_SOURCE = new URL('./fixtures/venture/delegate/fake-cli.mjs', import.meta.url);

const IN: CountryProfile = {
  code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india',
  tax: { mode: 'gst', label: 'GST', standardRateBps: '1800', registrationNote: 'Check with a CA.', idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15' },
  paymentRails: ['razorpay'], dateOrder: 'day-month-year', complianceNotes: [],
};

// ---------------------------------------------------------------------------
// The fake command-line tool, installed in a folder of its own
// ---------------------------------------------------------------------------

type FakeMode = { kind: 'claude' | 'codex' | 'other'; behavior?: 'work' | 'hang' | 'fail'; figures?: unknown[]; extras?: boolean; version?: string };
type Fake = { dir: string; ports: DelegatePorts; spy(): any; setMode(mode: FakeMode): void; located: number; cleanup(): void };

/** Puts a fake `claude` (and `codex`) on a search path of its own and returns the real port pointed at it. */
function installFake(mode: FakeMode, options: { timeoutMs?: number } = {}): Fake {
  const dir = mkdtempSync(join(tmpdir(), 'chausar-fake-cli-'));
  copyFileSync(FAKE_SOURCE, join(dir, 'fake-cli.mjs'));
  for (const name of ['claude', 'codex']) {
    if (process.platform === 'win32') writeFileSync(join(dir, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "%~dp0fake-cli.mjs" %*\r\n`);
    else { writeFileSync(join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, 'fake-cli.mjs')}" "$@"\n`); chmodSync(join(dir, name), 0o755); }
  }
  const real = createDelegatePorts({ pathEnv: dir });
  const fake: Fake = {
    dir, located: 0,
    spy: () => existsSync(join(dir, 'spy.json')) ? JSON.parse(readFileSync(join(dir, 'spy.json'), 'utf8')) : null,
    setMode: next => writeFileSync(join(dir, 'mode.json'), JSON.stringify(next)),
    ports: {
      locate: async cli => { fake.located += 1; return real.locate(cli); },
      process: request => real.process(options.timeoutMs && request.args[0] !== '--version' ? { ...request, timeoutMs: options.timeoutMs } : request),
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
  fake.setMode(mode);
  return fake;
}

// ---------------------------------------------------------------------------
// A scripted model port (no network), and seeds
// ---------------------------------------------------------------------------

type Responder = (task: ModelTask<any>) => unknown;
class ScriptPort implements ModelPort {
  store: VentureTestStore;
  respond: Partial<Record<ModelPurpose, Responder>> = {};
  previewed: ModelTask<any>[] = [];
  sendPolicy: ModelStatusView['sendPolicy'] = 'shape';
  #previews = new Map<string, { digest: string; task: ModelTask<any>; used: boolean }>();
  #calls = 0;
  constructor(store: VentureTestStore) { this.store = store; }
  status(): ModelStatusView {
    const tier = (presetId: 'anthropic-haiku-5-5' | 'anthropic-sonnet-5-5') => ({ presetId, model: presetId, usable: true, reason: 'Uses your Anthropic key.' });
    return { connections: [], tiers: { fast: tier('anthropic-haiku-5-5'), main: tier('anthropic-sonnet-5-5') }, spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: this.sendPolicy, replay: { active: true, label: 'synthetic recording' } };
  }
  presets(): ModelPreset[] { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async checkCli(): Promise<void> { throw new ChausarError('NOT_BUILT_YET', 'Not used here.'); }
  async generate<T>(): Promise<ModelOutcome<T>> { throw new ChausarError('CLIENT_DATA_NEEDS_APPROVAL', 'Real orders always wait for approval.'); }
  async preview<T>(_ctx: Context, task: ModelTask<T>): Promise<ModelPreview | null> {
    this.previewed.push(task);
    this.#calls += 1;
    const callId = `call_${this.#calls}`;
    const payloadText = JSON.stringify({ system: task.instructions, input: task.input });
    this.#previews.set(callId, { digest: digest(payloadText), task, used: false });
    await this.store.update(state => { state.conversations.push({ id: callId, kind: 'venture-model-call', status: 'preview' }); });
    return { callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'stub', endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: '2026-10-18T10:30:00.000Z' };
  }
  async runPreview<T>(ctx: Context, callId: string, approved: string, validate: (raw: unknown) => T): Promise<ModelOutcome<T>> {
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

function receiptRecord(tx: VentureTx, subject: PriceReceiptRecord['subject'], blueprintDigest: string): PriceReceiptRecord {
  const figure = (key: 'unit' | 'tax' | 'total', label: string, minor: string, display: string) => ({ key, label, minor, display, currency: 'INR' });
  return {
    ...tx.base('venture-price-receipt'), subject, operation: 'venture.price', currency: 'INR', minorDigits: 2,
    inputs: { unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxMode: 'gst', taxRateBps: '1800', taxTreatment: 'single', unitPriceBy: 'told-by-you', taxRateBy: 'country-table', blueprintDigest },
    steps: [], figures: [figure('unit', 'Unit price', '249900', 'INR 2,499.00'), figure('tax', 'GST at 18%', '44982', 'INR 449.82'), figure('total', 'Total', '294882', 'INR 2,948.82')],
    totalMinor: '294882', allowedNumbers: [], explanation: 'Synthetic receipt.', digest: 'receipt-digest', stale: false,
  };
}

type Env = { store: VentureTestStore; models: ScriptPort; deps: VentureDeps; venture: VentureRecord };

async function setup(delegate: DelegatePorts | undefined, host: VentureDeps['host'] = 'desktop'): Promise<Env> {
  const store = new VentureTestStore();
  const models = new ScriptPort(store);
  const deps = { store, clock, models, services: { ontology: { current: () => null } }, github: {}, secrets: {}, host, demo: true, storage: 'experimental-file', ...(delegate ? { delegate } : {}) } as unknown as VentureDeps;
  const venture = await ventureAction(deps, owner, 'admin', 'create', tx => tx.put<VentureRecord>({
    ...tx.base('venture-record'), idea: 'Monthly bookkeeping for cafes in Pune, done by AI helpers with me checking every report.', ideaDigest: 'idea', workingName: 'Ledger Cafe Books',
    country: IN, serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  await ventureAction(deps, owner, 'admin', 'seed.blueprint', tx => {
    const record = tx.put(blueprintRecord(tx));
    tx.touch({ blueprintId: record.id, acceptedBlueprintId: record.id });
    tx.put(receiptRecord(tx, { type: 'offer', offerId: 'offer_1' }, record.digest));
  });
  return { store, models, deps, venture };
}

function call<T>(env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const handler = (handlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method];
  assert.ok(handler, method);
  return handler(env.deps, ctx, payload) as Promise<T>;
}

const FILES = PRACTICE_FILES['bookkeeping-clean'].map(file => ({ name: file.name.replace('september', 'aroma'), content: file.content }));

async function orderWithFiles(env: Env): Promise<OrderRecord> {
  const order = await ventureAction(env.deps, owner, 'prepare', 'seed.order', tx => {
    const client = tx.put({ ...tx.base('venture-client'), name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null });
    const base = tx.base('venture-order');
    const blueprint = listRecords(tx.state, 'venture-blueprint', tx.venture!.id)[0];
    const receipt = tx.put(receiptRecord(tx, { type: 'order', orderId: base.id }, blueprint.digest));
    return tx.put<OrderRecord>({ ...base, clientId: client.id, offerId: 'offer_1', quantity: '1', request: ORDER_REQUEST, status: 'open', priceReceiptId: receipt.id, deliveredOn: null, saleFactId: null });
  });
  for (const file of FILES) await call(env, 'venture.files.add', { orderId: order.id, name: file.name, contentBase64: b64(file.content) });
  return order;
}

const turnOf = (note: string, calls: [string, unknown][], finished = false) => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const BRIEF = 'Match every payment in the bank statement to a bill, list the payments with no bill, and write a short summary for the owner.';
const DELEGATE = turnOf('Hand the matching to the owner tool', [['agent.delegate', { brief: BRIEF }], ['files.list', {}]]);
const DONE = turnOf('Ready to write the report', [], true);
const part = (text: string) => ({ kind: 'text', text, ref: '' });
const fig = (ref: string) => ({ kind: 'figure', text: '', ref });
const REPORT = {
  title: 'Your September books',
  sections: [
    { heading: 'Summary', parts: [part('Your own assistant on this computer looked through the statement and the bills for us.')] },
    { heading: 'What we did', parts: [part('The money out in the statement, as the calculator worked it out:'), fig('w1.total')] },
    { heading: 'What needs your answer', parts: [part('Nothing is open from this month.')] },
    { heading: 'Next steps', parts: [part('The fee for the month is below.'), fig('order.total')] },
  ],
  questionsForClient: [],
};

function script(env: Env, turns: unknown[]) {
  let next = 0;
  env.models.respond['agent-turn'] = () => turns[Math.min(next++, turns.length - 1)];
  env.models.respond.delivery = () => REPORT;
}

/** The figures the fake tool lists: one right, one wrong, one outside the folder, one with a column that is not there. */
function fakeFigures(): unknown[] {
  const bank = { id: 'upload_x', name: FILES[0].name, format: 'csv' as const, bytes: 1, digest: digest(FILES[0].content), contentBase64: b64(FILES[0].content), clientData: true };
  const right = sumRows({ currency: 'INR', dateOrder: 'day-month-year', runRef: { kind: 'delivery', runId: 'x' } }, tablesOfFile(bank)[0], 'Withdrawal', null).figures[0].display;
  return [
    { label: 'Money out', file: FILES[0].name, amountColumn: 'Withdrawal', value: right },
    { label: 'Rent paid', file: `inputs/${FILES[0].name}`, amountColumn: 'Withdrawal', whereColumn: 'Narration', equals: 'IMPS/Rent September/Shree Estates', value: 'INR 1.00' },
    { label: 'Secret', file: '../../vault.json', amountColumn: 'Amount', value: '5' },
    { label: 'Tips', file: FILES[0].name, amountColumn: 'Tips', value: '10' },
  ];
}

async function toBrief(env: Env): Promise<DeliveryRunView> {
  const order = await orderWithFiles(env);
  script(env, [DELEGATE, DONE]);
  const run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  assert.equal(run.status, 'waiting-for-you');
  return call<DeliveryRunView>(env, 'venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
}
const brief = (run: DeliveryRunView) => run.harness!.delegations!.at(-1)!;
const decide = (env: Env, run: DeliveryRunView, decision: 'approve' | 'decline', ctx: Context = owner, briefDigest = brief(run).digest) =>
  call<DeliveryRunView>(env, 'venture.delivery.delegate', { runId: run.id, digest: briefDigest, decision }, ctx);

// ---------------------------------------------------------------------------
// 1. The version check and the capability rows
// ---------------------------------------------------------------------------

test('availability: offered only when the tool is found and answers its version check; unverified until a real run', async () => {
  const fake = installFake({ kind: 'claude', version: '2.1.0' });
  try {
    const found = await delegateAvailability(fake.ports, 'claude-code');
    assert.equal(found.state, 'unverified');
    assert.equal(found.version, '2.1.0');
    assert.ok(found.executable!.startsWith(fake.dir));
    assert.match(found.reason, /Not yet tried on a real order/);
    // The fake answers as Claude Code, so as Codex its version line is wrong.
    assert.equal((await delegateAvailability(fake.ports, 'codex')).state, 'needs-setup');
    fake.setMode({ kind: 'other' });
    const odd = await delegateAvailability(fake.ports, 'claude-code');
    assert.equal(odd.state, 'needs-setup');
    assert.match(odd.reason, /version check did not answer/);
  } finally { fake.cleanup(); }
  const empty = mkdtempSync(join(tmpdir(), 'chausar-no-cli-'));
  try {
    const missing = await delegateAvailability(createDelegatePorts({ pathEnv: empty }), 'claude-code');
    assert.equal(missing.state, 'needs-setup');
    assert.match(missing.reason, /Install Claude Code and sign in/);
  } finally { rmSync(empty, { recursive: true, force: true }); }

  const row = (rows: CapabilityStatus[], id: string) => rows.find(item => item.id === id)!;
  const unverified = { availability: { cli: 'claude-code' as const, state: 'unverified' as const, reason: 'Claude Code 2.1.0 is on this computer.', executable: '/x/claude', version: '2.1.0' }, realRun: false };
  assert.equal(row(capabilityList('win32', undefined, 'experimental-file', undefined, undefined, 'desktop', { 'claude-code': unverified }), 'tier-owner-claude').state, 'unverified');
  assert.equal(row(capabilityList('win32', undefined, 'experimental-file', undefined, undefined, 'desktop', { 'claude-code': { ...unverified, realRun: true } }), 'tier-owner-claude').state, 'available');
  assert.equal(row(capabilityList('win32'), 'tier-owner-codex').state, 'needs-setup');
  const hosted = capabilityList('linux', undefined, 'postgres', undefined, undefined, 'hosted-web', { 'claude-code': { ...unverified, realRun: true } });
  assert.deepEqual([row(hosted, 'tier-owner-claude').state, row(hosted, 'tier-owner-claude').reason], ['unavailable', HOSTED_NO_OWNER_CLI]);
  assert.equal(row(hosted, 'tier-owner-codex').state, 'unavailable');
});

test('arguments and environment: fixed flags safe for cmd.exe, no shell or web for Claude Code, Codex sandboxed with no network, no key passed', () => {
  const claude = delegateArgs('claude-code', DELEGATE_DEFAULT_LIMITS);
  for (const flag of ['-p', '--strict-mcp-config', '--max-turns', '--max-budget-usd']) assert.ok(claude.includes(flag), flag);
  assert.equal(claude[claude.indexOf('--disallowedTools') + 1], 'Bash,WebFetch,WebSearch,Task,NotebookEdit');
  assert.equal(claude[claude.indexOf('--max-budget-usd') + 1], '2.00');
  const codex = delegateArgs('codex', { ...DELEGATE_DEFAULT_LIMITS, budgetMicros: null });
  assert.equal(codex[codex.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(codex.includes('sandbox_workspace_write.network_access=false'));
  for (const arg of [...claude, ...codex]) assert.match(arg, /^[A-Za-z0-9_.,:=\/-]+$/);
  const env = delegateEnv('claude-code', '/work/tmp', { PATH: '/bin', HOME: '/home/o', ANTHROPIC_API_KEY: 'sk-x', OPENAI_API_KEY: 'sk-y', CHAUSAR_VAULT: '/v', CHAUSAR_CODEX_CLI_EVIDENCE_FILE: '/e' });
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_DISABLE_TERMINAL_TITLE', 'HOME', 'PATH', 'TEMP', 'TMP', 'TMPDIR']);
  assert.deepEqual(folderNames([{ name: '../../vault.json' }, { name: 'bank statement.csv' }, { name: 'Bank-Statement.csv' }]), ['vault.json', 'bank-statement.csv', '3-Bank-Statement.csv']);
  const text = delegateBrief(BRIEF, ['bank.csv'], 'codex', { ...DELEGATE_DEFAULT_LIMITS, budgetMicros: null });
  assert.ok(text.includes('inputs/bank.csv') && text.includes('outputs/figures.json') && text.includes('Codex has no spending limit of its own'));
  assert.equal(maskNumbers('INR 99,999.00 in 5 rows'), 'INR ##,###.## in # rows');
});

// ---------------------------------------------------------------------------
// 2. A real order: the brief, the approval, the locked folder, untrusted output, receipts
// ---------------------------------------------------------------------------

test('real order: nothing starts before the owner approves the exact brief; the tool works in a locked folder; figures get receipts', async () => {
  const fake = installFake({ kind: 'claude', behavior: 'work', figures: fakeFigures(), extras: true });
  process.env.ANTHROPIC_API_KEY = 'sk-ant-should-never-pass';
  process.env.CHAUSAR_VAULT_PASSPHRASE = 'never-pass';
  try {
    const env = await setup(fake.ports);
    const first = env.models.previewed;
    let run = await toBrief(env);
    assert.ok((first[0].input as any).tools.some((tool: any) => tool.tool === 'agent.delegate'), 'offered once the tool is found');

    // The run waits for the brief. Nothing has started.
    assert.equal(run.status, 'brief-waiting');
    assert.equal(run.harness!.phase, 'brief');
    assert.equal(run.callId, null);
    assert.ok(run.awaitingYou && !run.canApprove);
    const request = brief(run);
    assert.equal(request.status, 'waiting');
    assert.equal(request.cli, 'claude-code');
    assert.ok(request.briefText.includes(BRIEF));
    for (const file of FILES) assert.ok(request.briefText.includes(`inputs/${file.name}`), file.name);
    assert.deepEqual(run.harness!.toolCalls.map(item => [item.tool, item.outcome]), [['agent.delegate', 'succeeded'], ['files.list', 'cancelled']]);
    assert.equal(fake.spy(), null, 'nothing ran before approval');
    assert.ok(listRecords(env.store.read(), 'venture-event').some(event => event.name === 'delivery-brief-waiting'));

    await assert.rejects(decide(env, run, 'approve', phone), code('APP_APPROVAL_REQUIRED'));
    await assert.rejects(decide(env, run, 'approve', owner, 'f'.repeat(64)), code('APPROVAL_STALE'));
    await assert.rejects(call(env, 'venture.delivery.approve', { runId: run.id, digest: request.digest }), code('DELIVERY_NOT_WAITING'));
    env.models.sendPolicy = 'nothing';
    await assert.rejects(decide(env, run, 'approve'), code('SEND_DISABLED'));
    env.models.sendPolicy = 'shape';
    assert.equal(fake.spy(), null);

    run = await decide(env, run, 'approve');
    assert.equal(run.status, 'waiting-for-you');
    assert.equal(run.harness!.phase, 'act');
    await assert.rejects(decide(env, { ...run, harness: { ...run.harness!, delegations: [request] } }, 'approve'), code('DELIVERY_NOT_BRIEFING'), 'a second approval starts nothing');

    // The folder held only the brief and copies of the order's files; the environment held no key and no vault setting.
    const spy = fake.spy();
    assert.deepEqual(spy.entries, ['BRIEF.md', 'inputs', ...FILES.map(file => `inputs/${file.name}`).sort(), 'outputs', 'tmp']);
    assert.equal(spy.stdin, request.briefText, 'the tool got exactly the approved text');
    assert.ok(!spy.envNames.includes('ANTHROPIC_API_KEY') && !spy.envNames.some((name: string) => name.startsWith('CHAUSAR')), spy.envNames.join(','));
    assert.ok(spy.args.includes('--disallowedTools'));
    assert.equal(existsSync(spy.cwd), false, 'the folder is removed after the run');

    // What it left is stored as untrusted data, with the calculator's checks on its figures.
    const [record] = listRecords(env.store.read(), 'venture-delegate-run') as DelegateRunRecord[];
    assert.equal(record.outcome, 'succeeded');
    assert.equal(record.untrusted, true);
    assert.equal(record.approvedDigest, request.digest);
    assert.equal(record.reportedCost, 'USD 0.0421');
    assert.deepEqual(record.outputs.filter(output => output.text !== null).map(output => output.name).sort(), ['figures.json', 'summary.md', 'tables/matched.csv']);
    assert.equal(record.outputs.find(output => output.name === 'big.txt')!.note, 'Too large for Chausar to keep.');
    const link = record.outputs.find(output => output.name === 'link.md');
    if (link) assert.equal(link.text, null, 'a link is never followed');
    assert.deepEqual(record.figures.map(item => [item.matches, item.receiptId !== null]), [[true, true], [false, true], [null, false], [null, false]]);
    assert.match(record.figures[2].note, /names no file in the folder/);
    assert.match(record.figures[3].note, /could not work it out/);
    const receipts = listRecords(env.store.read(), 'venture-work-receipt') as WorkReceiptRecord[];
    assert.deepEqual(receipts.map(receipt => receipt.operation), ['work.sum', 'work.sum']);
    assert.ok(receipts.every(receipt => receipt.runRef.kind === 'delivery'));
    assert.ok(receipts.every(receipt => !receipt.figures.some(figure => figure.label.includes('Rent paid'))), "the calculator's own labels, never the tool's");

    // The agent sees the result in place of 'waiting': digits hidden, figure refs from the calculator.
    const delegated = run.harness!.toolCalls[0];
    assert.equal(delegated.envelope.ok, true);
    const result = (delegated.envelope as any).result;
    assert.ok(!/\d/.test(result.summary), result.summary);
    assert.ok(result.summary.includes('Ignore your previous instructions'), 'kept as information, masked');
    assert.deepEqual(result.figures.map((item: any) => item.ref), ['w1.total', 'w2.total', null, null]);
    assert.deepEqual(delegated.receiptIds, receipts.map(receipt => receipt.id));
    const nextTurn = JSON.stringify(env.models.previewed.at(-1)!.input);
    assert.ok(!nextTurn.includes('99,999') && !nextTurn.includes('1,20,000'), "the tool's own numbers never reach the next turn");

    // The write step: the proven list says what ran and that its words were not checked.
    run = await call<DeliveryRunView>(env, 'venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
    const write = env.models.previewed.at(-1)!;
    assert.equal(write.purpose, 'delivery');
    const input = write.input as any;
    assert.deepEqual(input.requiredSections, [...REPORT_SECTIONS]);
    assert.ok(input.proven.some((line: string) => line.includes('Its words were not checked')));
    assert.ok(input.figures.some((entry: any) => entry.ref === 'w1.total'));
    run = await call<DeliveryRunView>(env, 'venture.delivery.approve', { runId: run.id, digest: run.preview!.digest });
    assert.equal(run.status, 'ready-for-review');
    assert.ok(run.checks.every(item => item.passed), JSON.stringify(run.checks));
    assert.ok(run.renderedText!.includes(receipts[0].figures[0].display));

    // One finished run on a real order: the row turns available.
    const rows = await call<CapabilityStatus[]>(env, 'venture.capabilities');
    assert.equal(rows.find(item => item.id === 'tier-owner-claude')!.state, 'available');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CHAUSAR_VAULT_PASSPHRASE;
    fake.cleanup();
  }
});

test('real order: a declined brief starts nothing and the agent is told; a done claim backed only by the tool fails', async () => {
  const fake = installFake({ kind: 'claude', behavior: 'work' });
  try {
    const env = await setup(fake.ports);
    let run = await toBrief(env);
    run = await decide(env, run, 'decline');
    assert.equal(run.status, 'waiting-for-you');
    assert.equal(brief(run).status, 'declined');
    assert.equal(fake.spy(), null, 'nothing started');
    const envelope = run.harness!.toolCalls[0].envelope;
    assert.equal(envelope.ok, false);
    assert.equal(!envelope.ok && envelope.error.code, 'DELEGATE_DECLINED');
    assert.equal(listRecords(env.store.read(), 'venture-delegate-run').length, 0);
    await assert.rejects(decide(env, run, 'decline'), code('DELIVERY_NOT_BRIEFING'));
  } finally { fake.cleanup(); }
  const delegated = [{ kind: 'delegated' as const, toolCallId: 't1.1', receiptId: null, tableId: null }];
  for (const phrase of ['we have prepared', 'we reconciled', 'we matched', 'we checked']) assert.equal(claimBacked(phrase, delegated), false, phrase);
});

test('real order: the time limit stops the tool and its whole process tree; a failed tool proves nothing', async () => {
  const fake = installFake({ kind: 'claude', behavior: 'hang' }, { timeoutMs: 1500 });
  try {
    const env = await setup(fake.ports);
    let run = await toBrief(env);
    const started = Date.now();
    run = await decide(env, run, 'approve');
    assert.ok(Date.now() - started < 20000, 'stopped near its limit');
    const [record] = listRecords(env.store.read(), 'venture-delegate-run') as DelegateRunRecord[];
    assert.equal(record.outcome, 'timedOut');
    assert.match(record.reason, /ran past its 10 minute limit and was stopped/);
    assert.deepEqual(record.outputs.map(output => output.name), ['started.md']);
    const envelope = run.harness!.toolCalls[0].envelope;
    assert.equal(!envelope.ok && envelope.error.code, 'TOOL_TIMEOUT');
    assert.ok(!run.harness!.proofs.some(proof => proof.kind === 'delegated'));
    const pid = fake.spy().pid;
    let alive = true;
    for (let tries = 0; tries < 50 && alive; tries += 1) {
      try { process.kill(pid, 0); await new Promise(done => setTimeout(done, 100)); } catch { alive = false; }
    }
    assert.equal(alive, false, 'the fake tool was stopped');

    fake.setMode({ kind: 'claude', behavior: 'fail' });
    script(env, [DELEGATE, DONE]);
    const order2 = listRecords(env.store.read(), 'venture-order')[0];
    let again = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order2.id });
    again = await call<DeliveryRunView>(env, 'venture.delivery.approve', { runId: again.id, digest: again.preview!.digest });
    again = await decide(env, again, 'approve');
    const failed = (listRecords(env.store.read(), 'venture-delegate-run') as DelegateRunRecord[]).find(item => item.runId === again.id)!;
    assert.equal(failed.outcome, 'failed');
    assert.match(failed.log, /something went wrong/);
    const failedEnvelope = again.harness!.toolCalls[0].envelope;
    assert.equal(!failedEnvelope.ok && failedEnvelope.error.code, 'DELEGATE_FAILED');
  } finally { fake.cleanup(); }
});

// ---------------------------------------------------------------------------
// 3. Where it never runs: the hosted server and rehearsals
// ---------------------------------------------------------------------------

function toolEnv(deps: VentureDeps, runRef: ToolEnv['runRef'], offer: ToolEnv['delegateOffer'] = []): ToolEnv {
  const file = { id: 'upload_1', name: FILES[0].name, format: 'csv' as const, bytes: 1, digest: digest(FILES[0].content), contentBase64: b64(FILES[0].content), clientData: true };
  return { deps, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year', runRef, files: [file], tables: [], receipts: [], dictionary: [], sandbox: undefined, now: () => clock().toISOString(), allowed: [], delegateOffer: offer };
}

test('hosted server: heavy work is not offered, refused before its input is read, never looked for, and the approval method refuses', async () => {
  const fake = installFake({ kind: 'claude', behavior: 'work' });
  try {
    const env = await setup(fake.ports, 'hosted-web');
    const state: HarnessState = newHarnessState(['files.list', 'agent.delegate'], { maxTurns: 4, maxToolCalls: 12, maxCallsPerTurn: 4, maxCostMicros: '250000', keepOutputs: 6, stubChars: 600 }, []);
    const loop = { serviceType: 'bookkeeping' as const, offer: { name: 'x', description: 'y' }, clientRequest: 'z', playbook: { steps: [] }, dictionaryManifest: '', files: [], containsClientData: true, allowed: [], host: 'hosted-web' as const, delegate: ['claude-code' as const] };
    assert.ok(!(actTask(loop, state).input as any).tools.some((tool: any) => tool.tool === 'agent.delegate'));
    const offer = [{ cli: 'claude-code' as const, state: 'unverified' as const, reason: '', executable: '/x/claude', version: '2.1.0' }];
    const refused = await callTool(toolEnv(env.deps, { kind: 'delivery', runId: 'delivery_1' }, offer), ['agent.delegate'], 1, 0, { tool: 'agent.delegate', input: '{not json' });
    assert.equal(!refused.record.envelope.ok && refused.record.envelope.error.code, 'TIER_UNAVAILABLE');
    assert.equal(!refused.record.envelope.ok && refused.record.envelope.error.message, HOSTED_NO_OWNER_CLI);
    await assert.rejects(call(env, 'venture.delivery.delegate', { runId: 'delivery_1', digest: 'a'.repeat(64), decision: 'approve' }), code('TIER_UNAVAILABLE'));
    const rows = await call<CapabilityStatus[]>(env, 'venture.capabilities');
    assert.equal(rows.find(item => item.id === 'tier-owner-claude')!.state, 'unavailable');
    assert.equal(delegatePorts(env.deps), null, 'no port on the hosted server, even an injected one');
    assert.deepEqual(await delegateOffer(env.deps), []);
    assert.equal(fake.located, 0, 'the hosted server never looks for the tool');
    assert.equal(fake.spy(), null);
  } finally { fake.cleanup(); }
});

test('rehearsal: heavy work is never offered without a found tool and is refused on made-up clients', async () => {
  const env = await setup(undefined, 'test');
  const offer = [{ cli: 'claude-code' as const, state: 'unverified' as const, reason: '', executable: '/x/claude', version: '2.1.0' }];
  const rehearsal = await callTool(toolEnv(env.deps, { kind: 'rehearsal', scenarioId: 'bookkeeping-clean', episode: 0 }, offer), ['agent.delegate'], 1, 0, { tool: 'agent.delegate', input: JSON.stringify({ brief: BRIEF }) });
  assert.equal(!rehearsal.record.envelope.ok && rehearsal.record.envelope.error.message, REAL_ORDER_ONLY);
  assert.equal(rehearsal.delegate, null);
  const none = await callTool(toolEnv(env.deps, { kind: 'delivery', runId: 'delivery_1' }), ['agent.delegate'], 1, 0, { tool: 'agent.delegate', input: JSON.stringify({ brief: BRIEF }) });
  assert.equal(!none.record.envelope.ok && none.record.envelope.error.code, 'TIER_UNAVAILABLE');
  const amounts = await callTool(toolEnv(env.deps, { kind: 'delivery', runId: 'delivery_1' }, offer), ['agent.delegate'], 1, 0, { tool: 'agent.delegate', input: JSON.stringify({ brief: 'Check that the rent of 25000 was paid.' }) });
  assert.equal(!amounts.record.envelope.ok && amounts.record.envelope.error.code, 'TOOL_INPUT_INVALID', 'a brief with an amount in it is refused');
  const state: HarnessState = newHarnessState(['files.list', 'agent.delegate'], { maxTurns: 4, maxToolCalls: 12, maxCallsPerTurn: 4, maxCostMicros: '250000', keepOutputs: 6, stubChars: 600 }, []);
  const loop = { serviceType: 'bookkeeping' as const, offer: { name: 'x', description: 'y' }, clientRequest: 'z', playbook: { steps: [] }, dictionaryManifest: '', files: [], containsClientData: false, allowed: [], host: 'test' as const };
  assert.ok(!(actTask(loop, state).input as any).tools.some((tool: any) => tool.tool === 'agent.delegate'));
  assert.equal(PURPOSE_TIER['agent-turn'], 'fast');
});
