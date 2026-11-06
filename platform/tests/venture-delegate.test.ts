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
import { PURPOSE_TIER, STEP_PLAN } from '../runtime/venture/contract-values.ts';
import type {
  BlueprintRecord, CapabilityStatus, CountryProfile, DelegatePorts, DelegateRunRecord, DeliveryRunView, HarnessState, ModelOutcome, ModelPort, ModelPreset,
  ModelPreview, ModelPurpose, ModelStatusView, ModelTask, OrderRecord, PriceReceiptRecord, VentureDeps, VentureRecord, WorkReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction, type VentureTx } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/delivery/index.ts';
import { capabilityList } from '../runtime/venture/delivery/capabilities.ts';
import { claimBacked } from '../runtime/venture/delivery/harness/claims.ts';
import {
  DELEGATE_CLAUDE_TERMS, delegateArgs, delegateAvailability, delegateBrief, delegateBusy, delegateEnv, DELEGATE_DEFAULT_LIMITS, delegateOffer, delegatePorts, folderNames, maskNumbers, prepareDelegation, REAL_ORDER_ONLY,
  runDelegation,
} from '../runtime/venture/delivery/harness/delegate.ts';
import { createDelegatePorts } from '../runtime/venture/delivery/harness/delegate-process.ts';
import { tablesOfFile } from '../runtime/venture/delivery/harness/files.ts';
import { actTask, newHarnessState, REPORT_SECTIONS } from '../runtime/venture/delivery/harness/loop.ts';
import { PRACTICE_FILES } from '../runtime/venture/delivery/harness/practice.ts';
import { HOSTED_NO_OWNER_CLI } from '../runtime/venture/delivery/harness/sandbox.ts';
import { callTool, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { sumRows } from '../runtime/venture/delivery/harness/work.ts';
import { listSpend } from '../runtime/venture/money/spend.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { mediaAcceptBlock } from '../runtime/venture/playbooks/kit/assets.ts';

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

type FakeMode = { kind: 'claude' | 'codex' | 'other'; behavior?: 'work' | 'hang' | 'fail' | 'blocked' | 'empty'; figures?: unknown[]; extras?: boolean; version?: string };
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
    return { callId, payloadText, digest: digest(payloadText), presetId: 'anthropic-sonnet-5-5', model: 'stub', endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010' };
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

/** claudeCodeTerms: the Claude Code terms gate, open here unless a test closes it. */
async function setup(delegate: DelegatePorts | undefined, host: VentureDeps['host'] = 'desktop', claudeCodeTerms: 'accepted' | 'pending' = 'accepted'): Promise<Env> {
  const store = new VentureTestStore();
  const models = new ScriptPort(store);
  const deps = { store, clock, models, services: { ontology: { current: () => null } }, github: {}, secrets: {}, host, demo: true, storage: 'experimental-file', claudeCodeTerms, ...(delegate ? { delegate } : {}) } as unknown as VentureDeps;
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

// ---------------------------------------------------------------------------
// 1. The version check and the capability rows
// ---------------------------------------------------------------------------

test('availability: offered only when the tool is found and answers its version check; unverified until a real run', async () => {
  const fake = installFake({ kind: 'claude', version: '2.1.0' });
  try {
    const found = await delegateAvailability(fake.ports, 'claude-code', 'accepted');
    assert.equal(found.state, 'unverified');
    assert.equal(found.version, '2.1.0');
    assert.ok(found.executable!.startsWith(fake.dir));
    assert.match(found.reason, /Not yet tried on a real order/);
    // The fake answers as Claude Code, so as Codex its version line is wrong.
    assert.equal((await delegateAvailability(fake.ports, 'codex')).state, 'needs-setup');
    fake.setMode({ kind: 'other' });
    const odd = await delegateAvailability(fake.ports, 'claude-code', 'accepted');
    assert.equal(odd.state, 'needs-setup');
    assert.match(odd.reason, /version check did not answer/);
  } finally { fake.cleanup(); }
  const empty = mkdtempSync(join(tmpdir(), 'chausar-no-cli-'));
  try {
    const missing = await delegateAvailability(createDelegatePorts({ pathEnv: empty }), 'claude-code', 'accepted');
    assert.equal(missing.state, 'needs-setup');
    assert.match(missing.reason, /Install Claude Code and sign in/);
  } finally { rmSync(empty, { recursive: true, force: true }); }

  assert.equal(capabilityList('win32').some(row=>row.id.startsWith('tier-owner-')),false);

});

test('the Claude Code terms gate: while it is pending heavy work never looks for, offers or starts Claude Code; Codex is not affected', async () => {
  const fake = installFake({ kind: 'claude', behavior: 'work' });
  const looked: string[] = [];
  const ports: DelegatePorts = { locate: async cli => { looked.push(cli); return fake.ports.locate(cli); }, process: request => fake.ports.process(request) };
  try {
    for (const terms of ['pending'] as const) {
      const closed = await delegateAvailability(ports, 'claude-code', terms);
      assert.deepEqual([closed.state, closed.reason, closed.executable], ['needs-setup', DELEGATE_CLAUDE_TERMS, null], String(terms));
    }
    assert.deepEqual(looked, [], 'Claude Code is not even looked for while the gate is pending');
    const env = await setup(ports, 'desktop', 'pending');
    assert.deepEqual(await delegateOffer(env.deps), [], 'not offered; the fake is no Codex, so nothing is');
    const rows = await call<CapabilityStatus[]>(env, 'venture.capabilities');
    assert.equal(rows.some(row=>row.id.startsWith('tier-owner-')),false);
    assert.deepEqual([...new Set(looked)], ['codex'], 'only Codex was looked for');
    const codex = installFake({ kind: 'codex' });
    try {
      const codexOnly = await setup(codex.ports, 'desktop', 'pending');
      assert.deepEqual((await delegateOffer(codexOnly.deps)).map(item => item.cli), ['codex'], 'Codex is offered with the gate pending');
    } finally { codex.cleanup(); }

  } finally { fake.cleanup(); }
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

// Found live on 30 Oct 2026 with codex-cli 0.154.0 on Windows: workspace-write fell back to read-only, so Codex could
// neither read the order's file nor save anything.
test('arguments: on Windows Codex runs with its own Windows sandbox on, so workspace-write is not quietly read-only', () => {
  const limits = { ...DELEGATE_DEFAULT_LIMITS, budgetMicros: null };
  const windows = delegateArgs('codex', limits, 'win32');
  assert.equal(windows[windows.indexOf('windows.sandbox=unelevated') - 1], '--config');
  assert.equal(windows.at(-1), '-', 'standard input stays the last argument');
  for (const platform of ['linux', 'darwin'] as const) assert.ok(!delegateArgs('codex', limits, platform).some(arg => arg.startsWith('windows.')), platform);
  assert.deepEqual(delegateArgs('claude-code', DELEGATE_DEFAULT_LIMITS, 'win32'), delegateArgs('claude-code', DELEGATE_DEFAULT_LIMITS, 'linux'));
});

// ---------------------------------------------------------------------------
// 2. A real order: the brief, the approval, the locked folder, untrusted output, receipts
// ---------------------------------------------------------------------------







/** One approved run straight through runDelegation, against the fake tool in the given behaviour. */
async function runFake(kind: 'claude' | 'codex', behavior: FakeMode['behavior'], timeoutMs?: number) {
  const fake = installFake({ kind, behavior }, { timeoutMs });
  try {
    const offer = await delegateAvailability(fake.ports, kind === 'claude' ? 'claude-code' : 'codex', 'accepted');
    const file = { id: 'upload_1', name: FILES[0].name, format: 'csv' as const, bytes: 1, digest: digest(FILES[0].content), contentBase64: b64(FILES[0].content), clientData: true };
    const draft = prepareDelegation({ offer, task: BRIEF, files: [file], minutes: 2, allowed: [] });
    return await runDelegation(fake.ports, { ...draft, toolCallId: 't1.1', turn: 1 }, [file], { currency: 'INR', dateOrder: 'day-month-year', runRef: { kind: 'delivery', runId: 'run_x' } });
  } finally { fake.cleanup(); }
}

test('retained developer helper stops a timed-out process and records failure without treating it as work', async () => {
  const started = Date.now();
  const timed = await runFake('claude', 'hang', 1500);
  assert.equal(timed.outcome, 'timedOut');
  assert.ok(Date.now() - started < 20000);
  assert.deepEqual(timed.figures, []);
  const failed = await runFake('claude', 'fail');
  assert.equal(failed.outcome, 'failed');
  assert.match(failed.log, /something went wrong/);
});

test('real order: a tool that exits cleanly but says it was blocked, or leaves no files, did not succeed', async () => {
  for (const kind of ['codex', 'claude'] as const) {
    const blocked = await runFake(kind, 'blocked');
    assert.equal(blocked.outcome, 'failed', kind);
    assert.match(blocked.reason, /said it was blocked\. It left 1 file\.$/, kind);
    assert.deepEqual(blocked.figures, [], 'nothing from a blocked run is worked out again');
    const empty = await runFake(kind, 'empty');
    assert.equal(empty.outcome, 'failed', kind);
    assert.match(empty.reason, /finished but left no files/, kind);
  }
  const done = await runFake('codex', 'work');
  assert.equal(done.outcome, 'succeeded', 'a run that leaves files and does not say it stopped still succeeds');
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
    const rows = await call<CapabilityStatus[]>(env, 'venture.capabilities');
    assert.equal(rows.some(row=>row.id.startsWith('tier-owner-')),false);
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

// 4J11 (H31): one delegated script per computer at a time.
