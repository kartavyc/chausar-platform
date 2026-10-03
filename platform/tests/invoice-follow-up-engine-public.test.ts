import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { InvoiceHostOptions } from '../runtime/invoice-follow-up.ts';
import type { ImportInput, MappingRecipe } from '../runtime/ingest.ts';
import type { SessionGrant } from '../runtime/phone/contracts.ts';

// Public synthetic integration: real loopback HTTP, explicit CSV recipes and
// encrypted experimental-file authority. No direct fact writes, native DB,
// provider, customer transport or product policy defaults are used.
const NAME = 'SYNTHETIC joined invoice business';
const PASSWORD = 'SYNTHETIC joined invoice disposable passphrase';
const BOOKS = 'synthetic-joined-invoice-books', BANK = 'synthetic-joined-invoice-bank';
const SOURCE_IDS = [BOOKS, BANK];
const DAY_MS = 86_400_000;
const targets = [
  { invoiceId: 'synthetic-invoice-one', customerId: 'synthetic-customer-one', invoiceLink: 'synthetic-invoice:one' },
  { invoiceId: 'synthetic-invoice-two', customerId: 'synthetic-customer-two', invoiceLink: 'synthetic-invoice:two' },
];

function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const receiptDigest = (receipt: any) => createHash('sha256').update(canonical(receipt)).digest('hex');

function importInput(sourceId: string, rows: string[], amountMinor: string): ImportInput {
  const recipe: MappingRecipe = {
    version: 1, id: `${sourceId}-explicit-v1`, system: 'synthetic-csv', edition: 'synthetic-fixture',
    scope: { company: NAME, branches: ['main'] }, bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
      ...['currency', 'customerId', 'invoiceId', 'status', 'branch'].map(field => ({
        target: field, source: field, type: 'string' as const, nulls: 'reject' as const,
      })),
      { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
      { target: 'paymentEntityId', source: 'paymentEntityId', type: 'string', nulls: 'omit' },
    ], allowedKinds: ['invoice', 'payment', 'bank_line'], allowedStatuses: ['unpaid', 'settled', 'matched'], onUnmapped: 'reject',
  };
  return { sourceId, format: 'csv', recipe, expectedTotals: { rowCount: rows.length, amountMinor },
    content: 'id,kind,date,amount,currency,customerId,invoiceId,dueDate,status,branch,paymentEntityId\n' + rows.join('\n') };
}
const initialBooks = [
  'synthetic-invoice-one,invoice,2026-09-01,10000,INR,synthetic-customer-one,synthetic-invoice-one,2026-09-30,unpaid,main,',
  'synthetic-invoice-two,invoice,2026-09-01,12000,INR,synthetic-customer-two,synthetic-invoice-two,2026-09-30,unpaid,main,',
  'synthetic-payment-one,payment,2026-09-30,2500,INR,synthetic-customer-one,synthetic-invoice-one,,settled,main,',
];
const initialBank = [
  'synthetic-bank-one,bank_line,2026-09-30,2500,INR,synthetic-customer-one,synthetic-invoice-one,,matched,main,synthetic-payment-one',
];

async function fixture(t: TestContext, installed = true, demo = true) {
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-invoice-engine-public-'));
  // Public import timestamps are real; this labelled fixture observation time
  // is later than those imports and can advance without replacing their facts.
  let syntheticNow = Date.now() + 60_000, providerCalls = 0;
  const clock = () => syntheticNow, iso = () => new Date(clock()).toISOString();
  const policy: InvoiceHostOptions = { clock, workerId: 'synthetic-invoice-engine-worker', maxActiveJobs: 8, leaseMs: 1000,
    approvalTtlMs: 60_000, dailyCap: 5, perCustomerDailyCap: 1,
    dayKey: instant => new Date(instant).toISOString().slice(0, 10), stopWord: 'STOP',
    simulatedStepCostMinor: '1', simulatedSendCostMinor: '20' };
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    ...(installed ? { invoiceFollowUp: policy } : {}),
    durableJobs: { clock, workerId: 'synthetic-generic-engine-worker', maxActiveJobs: 8, leaseMs: 1000, networkAvailable: () => false },
    gateway: { http: async () => { providerCalls++; throw new Error('SYNTHETIC invoice acceptance must never call a model.'); } } });
  const app = createLocalServer(engine), { origin, token } = await app.listen();
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  t.after(async () => {
    await app.close(5000);
    const target = resolve(directory), child = relative(base, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && target.startsWith(join(base, 'chausar-invoice-engine-public-')));
    await rm(target, { recursive: true, force: true });
  });
  async function post(path: '/api/rpc' | '/mcp', payload: unknown, bearer = token) {
    const response = await fetch(origin + path, { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`,
    }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}, bearer = token) {
    const response = await post('/api/rpc', { method, payload }, bearer);
    if (response.body.error) throw Object.assign(new Error(response.body.error.message), { code: response.body.error.code });
    assert.equal(response.status, 200); return response.body.result;
  }
  const invoice = (method: string, payload: unknown = {}, bearer = token) => rpc(`invoiceFollowUp.${method}`, payload, bearer);
  let requestId = 0;
  async function mcp(method: string, params: unknown = {}, bearer = token) {
    return post('/mcp', { jsonrpc: '2.0', id: ++requestId, method, params }, bearer);
  }
  async function initialize(bearer = token) {
    const response = await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'SYNTHETIC joined invoice receipt reader', version: '1.0.0' } }, bearer);
    assert.equal(response.status, 200); assert.equal(response.body.error, undefined);
    assert.equal((await post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, bearer)).body, null);
  }
  async function tool(name: string, arguments_: unknown, bearer = token) {
    const response = await mcp('tools/call', { name, arguments: arguments_ }, bearer);
    assert.equal(response.status, 200, JSON.stringify(response.body)); assert.equal(response.body.error, undefined, JSON.stringify(response.body));
    assert.equal(response.body.result.isError, false, JSON.stringify(response.body));
    assert.deepEqual(JSON.parse(response.body.result.content[0].text), response.body.result.structuredContent);
    return response.body.result.structuredContent;
  }
  function config(two = false, ownerId = 'owner', patch: Record<string, unknown> = {}) {
    return { ownerId, goal: 'Review the selected SYNTHETIC invoice balances and individually approve each reminder',
      budgetMinor: '500', reserveMinor: two ? '40' : '20', sourceIds: [...SOURCE_IDS], requiresApproval: true,
      stopRule: { maxRuns: 3, deadline: new Date(clock() + 3 * DAY_MS).toISOString() },
      nextRunAt: iso(), intervalMs: DAY_MS, catchup: 'latest', graceMs: 0,
      limits: { modelUnits: 0, durationMs: 20_000, actionExposureMinor: '0' },
      allowedActions: ['simulated-invoice-reminder.send'], testedRoutes: [], background: false,
      input: { targets: two ? targets : targets.slice(0, 1),
        acceptanceTest: 'Show retained receipt proof for collected and open amounts; simulated delivery never means payment.',
        reviewAt: new Date(clock() + DAY_MS).toISOString(),
        calculation: { reserveMinor: '10', durationMs: 2000 }, preparation: { reserveMinor: '10', durationMs: 2000 } }, ...patch };
  }
  async function consent(index = 0, status = 'yes', bearer = token, suffix = status) {
    return invoice('consent.record', { requestId: `synthetic-consent-${index}-${suffix}`, customerId: targets[index].customerId,
      channel: 'simulation', destination: `synthetic-customer:${index + 1}`, status, sourceId: BOOKS,
      evidence: `SYNTHETIC explicitly recorded customer observation: ${status}.`, at: iso() }, bearer);
  }
  async function prepared(two = false, ownerId = 'owner', bearer = token) {
    await consent(0, 'yes', bearer); if (two) await consent(1, 'yes', bearer);
    const job = await invoice('create', config(two, ownerId), bearer);
    await invoice('approve', { id: job.id, digest: job.digest }, bearer);
    const delivered = await invoice('run', { id: job.id }, bearer);
    assert.equal(delivered.status, 'awaiting-acceptance', JSON.stringify(delivered.ledger));
    const view = await invoice('read', { id: job.id }, bearer);
    assert.equal(view.reminders.length, two ? 2 : 1); return { job, delivered, view };
  }
  async function reopen() { await rpc('workspace.lock'); await rpc('workspace.open', { folder: 'fixture', passphrase: PASSWORD }); }
  await rpc('workspace.create', { name: NAME, folder: 'fixture', passphrase: PASSWORD, demo, pack: 'ecommerce' });
  // Publish the exact synthetic linkage before mapping it; starter packs do not
  // silently supply this bank-match field or qualify any vendor.
  const current = (await rpc('ontology.get')).current;
  const draft = Object.fromEntries(['pack', 'label', 'currency', 'gstMode', 'fields', 'definitions'].map(key => [key, current[key]]));
  await rpc('ontology.publish', { draft: { ...draft, fields: { ...current.fields, paymentEntityId: 'string' } } });
  const books = await rpc('sources.import', importInput(BOOKS, initialBooks, '24500'));
  const bank = await rpc('sources.import', importInput(BANK, initialBank, '2500'));
  assert.equal(books.coverage.reconciled, true); assert.equal(bank.coverage.reconciled, true);
  await rpc('trust.update', { autonomy: true });
  return { engine, origin, token, post, rpc, invoice, mcp, tool, initialize, config, consent, prepared, reopen,
    clock, iso, advance: (ms: number) => { syntheticNow += ms; }, providerCalls: () => providerCalls,
    importPaid: async () => {
      const date = iso().slice(0, 10);
      await rpc('sources.import', importInput(BOOKS, [...initialBooks,
        `synthetic-payment-two,payment,${date},7500,INR,synthetic-customer-one,synthetic-invoice-one,,settled,main,`], '32000'));
      await rpc('sources.import', importInput(BANK, [...initialBank,
        `synthetic-bank-two,bank_line,${date},7500,INR,synthetic-customer-one,synthetic-invoice-one,,matched,main,synthetic-payment-two`], '10000'));
    } };
}

test('Engine invoice registration requires explicit owner, mandate approval and declared bounds before persistence', async t => {
  const f = await fixture(t), before = f.engine.vault!.read();
  const configured = f.config();
  for (const [key, code] of [['ownerId', 'JOB_OWNER_REQUIRED'], ['goal', 'INVALID_GOAL'],
    ['budgetMinor', 'INVALID_BUDGET'], ['stopRule', 'STOP_RULE_REQUIRED']] as const) {
    const request: Record<string, unknown> = { ...configured }; delete request[key];
    await assert.rejects(f.invoice('create', request), { code });
  }
  await assert.rejects(f.invoice('create', { ...configured, ownerId: 'not-the-current-owner' }), { code: 'JOB_OWNER_REQUIRED' });
  for (const requiresApproval of [false, undefined]) await assert.rejects(f.invoice('create', { ...configured, requiresApproval }),
    { code: 'INVOICE_MANDATE_APPROVAL_REQUIRED' });
  assert.equal(f.engine.vault!.read().jobs.length, before.jobs.length);
  assert.equal(f.engine.vault!.read().answers.length, before.answers.length);
  const job = await f.invoice('create', configured);
  const blocked = await f.invoice('run', { id: job.id });
  assert.equal(blocked.status, 'approval-blocked'); assert.equal(blocked.runs, 0);
  assert.equal((await f.invoice('read', { id: job.id })).reminders.length, 0);
  assert.equal(f.engine.vault!.read().receipts.length, before.receipts.length);
  await assert.rejects(f.invoice('approve', { id: job.id, digest: '0'.repeat(64) }), { code: 'PREVIEW_CHANGED' });
  assert.equal(f.providerCalls(), 0);
});

test('public Engine invoice receipts and individual approvals survive encrypted reopen and preserve one simulated effect', async t => {
  const f = await fixture(t), { job, delivered, view } = await f.prepared(true);
  const balances = delivered.deliverable.result.invoices.map((item: any) => item.balance);
  assert.deepEqual(balances.map((item: any) => [item.outstandingMinor, item.collectedMinor, item.outcome]),
    [['7500', '2500', 'open'], ['12000', '0', 'open']]);
  assert.equal(delivered.deliverable.result.businessSuccess, false);
  const [first, second] = view.reminders;
  assert.ok(view.reminders.every((item: any) => item.status === 'prepared' && item.attempts.length === 0 && item.approval === undefined));
  for (const action of view.reminders) await assert.rejects(f.invoice('reminder.execute', { id: action.id }), { code: 'APPROVAL_REQUIRED' });
  await assert.rejects(f.invoice('reminder.approve', { id: first.id, digest: second.digest }), { code: 'PREVIEW_CHANGED' });
  for (const method of ['jobs.run', 'jobs.approve', 'jobs.accept', 'jobs.cancel', 'jobs.progress']) {
    await assert.rejects(f.rpc(method, { id: job.id, digest: job.digest }), { code: 'INVOICE_CONTRACT_REQUIRED' });
  }
  for (const method of ['actions.approve', 'actions.execute', 'actions.reconcile', 'actions.revise']) {
    await assert.rejects(f.rpc(method, { id: first.id, digest: first.digest, payload: first.payload }), { code: 'INVOICE_CONTRACT_REQUIRED' });
  }
  assert.deepEqual(await f.rpc('jobs.list'), []);
  await assert.rejects(f.invoice('accept', { id: job.id }), { code: 'INVOICE_REMINDERS_UNRESOLVED' });
  const receipt = await f.rpc('receipts.get', { id: balances[0].receiptId });
  assert.equal(receipt.totalMinor, '7500'); assert.deepEqual(receipt.requestedSourceIds, [...SOURCE_IDS].sort());
  assert.ok(receipt.rows.every((row: any) => row.sourceId === BOOKS && row.customerId === targets[0].customerId));
  assert.deepEqual(receipt.rows.map((row: any) => row.entityId).sort(), ['synthetic-invoice-one', 'synthetic-payment-one']);
  const pin = { receiptId: receipt.id, receiptDigest: receiptDigest(receipt) };
  await f.initialize();
  const opened = await f.tool('open_receipt', pin), counted = await f.tool('list_counted_rows', { ...pin, offset: 0, limit: 1 });
  assert.deepEqual(opened, { receipt, receiptDigest: pin.receiptDigest }); assert.equal(counted.totalRows, 2);
  assert.deepEqual(counted.rows, receipt.rows.slice(0, 1));
  const receiptCount = f.engine.vault!.read().receipts.length;
  await f.reopen(); await f.initialize();
  assert.deepEqual((await f.invoice('read', { id: job.id })).reminders, view.reminders);
  assert.deepEqual(await f.tool('open_receipt', pin), opened);
  assert.deepEqual(await f.tool('list_counted_rows', { ...pin, offset: 0, limit: 1 }), counted);
  const approved = await f.invoice('reminder.approve', { id: first.id, digest: first.digest });
  assert.deepEqual(await f.invoice('reminder.approve', { id: first.id, digest: first.digest }), approved);
  const sent = await f.invoice('reminder.execute', { id: first.id });
  assert.equal(sent.status, 'verified'); assert.equal(sent.businessSuccess, false); assert.equal(sent.attempts.length, 1);
  assert.deepEqual(sent.readback.data, { mode: 'simulation', sent: true, paid: false, sentAt: f.iso() });
  await assert.rejects(f.invoice('reminder.execute', { id: second.id }), { code: 'APPROVAL_REQUIRED' });
  await f.reopen();
  assert.deepEqual(await f.invoice('reminder.execute', { id: first.id }), sent);
  await assert.rejects(f.invoice('reminder.reconcile', { id: first.id }), { code: 'INVALID_ACTION_STATE' });
  await f.invoice('reminder.approve', { id: second.id, digest: second.digest });
  await f.invoice('reminder.execute', { id: second.id });
  const completed = await f.invoice('read', { id: job.id });
  assert.equal(completed.outcomes.filter((item: any) => item.kind === 'invoice-simulated-delivery-v1' && item.status === 'sent').length, 2);
  assert.equal(completed.outcomes.filter((item: any) => item.kind === 'invoice-paid-v1').length, 0);
  assert.equal(completed.job.spentMinor, '44'); assert.equal(completed.job.reservedMinor, '0');
  assert.equal(f.engine.vault!.read().receipts.length, receiptCount);
  await f.invoice('accept', { id: job.id, repeat: true });
  f.advance(DAY_MS); await f.importPaid();
  // Each fresh occurrence requires an exact mandate approval again.
  assert.equal((await f.invoice('run', { id: job.id })).status, 'approval-blocked');
  const next = (await f.invoice('read', { id: job.id })).job;
  await f.invoice('approve', { id: next.id, digest: next.digest });
  const paid = await f.invoice('run', { id: job.id });
  const paidBalance = paid.deliverable.result.invoices[0].balance;
  assert.equal(paidBalance.outstandingMinor, '0'); assert.equal(paidBalance.collectedMinor, '10000'); assert.equal(paidBalance.outcome, 'paid');
  assert.equal(paid.deliverable.result.invoices[0].reminder.skipped, true);
  const paidView = await f.invoice('read', { id: job.id });
  const paidOutcome = paidView.outcomes.find((item: any) => item.kind === 'invoice-paid-v1');
  assert.equal(paidOutcome.paymentFactIds.length, 2); assert.equal(paidOutcome.bankFactIds.length, 2);
  const facts = (await f.rpc('memory.list')).facts;
  assert.ok(paidOutcome.paymentFactIds.every((id: string) => facts.find((fact: any) => fact.id === id)?.sourceId === BOOKS));
  assert.ok(paidOutcome.bankFactIds.every((id: string) => facts.find((fact: any) => fact.id === id)?.sourceId === BANK));
  assert.equal(paidView.reminders.length, 3, 'Only the still-open second customer has a fresh reminder.');
  await f.invoice('reminder.cancel', { id: paidView.reminders[2].id });
  await f.invoice('accept', { id: job.id });
  assert.equal((await f.rpc('activity.list')).modelReceipts.length, 0); assert.equal(f.providerCalls(), 0);
});

test('lost simulated delivery response reopens with exact action readback and no resend or second charge', async t => {
  const f = await fixture(t), { job, view } = await f.prepared(), action = view.reminders[0];
  await f.invoice('reminder.approve', { id: action.id, digest: action.digest });
  const vault = f.engine.vault!, update = vault.update.bind(vault); let lost = false;
  // Lose only the return after the real encrypted effect commit. This changes
  // no facts, permissions or ledger content and preserves the persisted effect.
  vault.update = async change => {
    const value = await update(change);
    if (!lost && vault.read().answers.some(item => item.kind === 'invoice-simulated-delivery-v1' && item.status === 'sent')) {
      lost = true; throw new Error('SYNTHETIC return lost after encrypted simulated delivery commit.');
    }
    return value;
  };
  const uncertain = await f.invoice('reminder.execute', { id: action.id });
  assert.equal(lost, true); assert.equal(uncertain.status, 'unknown'); assert.equal(uncertain.attempts.length, 1);
  await assert.rejects(f.invoice('accept', { id: job.id }), { code: 'INVOICE_REMINDERS_UNRESOLVED' });
  await f.reopen();
  assert.deepEqual(await f.invoice('reminder.execute', { id: action.id }), uncertain);
  const reconciled = await f.invoice('reminder.reconcile', { id: action.id });
  assert.equal(reconciled.status, 'verified'); assert.equal(reconciled.attempts.length, 1);
  assert.deepEqual(reconciled.readback.data, { mode: 'simulation', sent: true, paid: false, sentAt: f.iso() });
  assert.equal(reconciled.businessSuccess, false);
  assert.deepEqual(await f.invoice('reminder.execute', { id: action.id }), reconciled);
  const retained = await f.invoice('read', { id: job.id });
  assert.equal(retained.outcomes.filter((item: any) => item.kind === 'invoice-simulated-delivery-v1' && item.status === 'sent').length, 1);
  assert.equal(retained.outcomes.filter((item: any) => item.kind === 'invoice-paid-v1').length, 0);
  assert.equal(retained.job.spentMinor, '22'); assert.equal(retained.job.reservedMinor, '0');
  assert.equal((await f.invoice('accept', { id: job.id })).status, 'accepted');
  assert.equal(f.providerCalls(), 0);
});

test('current source revocation withholds invoice and MCP receipt evidence before any approved reminder effect', async t => {
  const f = await fixture(t), { job, view } = await f.prepared(), action = view.reminders[0];
  await f.invoice('reminder.approve', { id: action.id, digest: action.digest });
  const receipt = await f.rpc('receipts.get', { id: view.job.deliverable.result.invoices[0].balance.receiptId });
  await f.initialize();
  const pin = { receiptId: receipt.id, receiptDigest: receiptDigest(receipt) };
  await f.tool('open_receipt', pin);
  await f.rpc('trust.update', { allowedSources: [] });
  for (const [method, payload] of [['read', { id: job.id }], ['reminder.execute', { id: action.id }],
    ['reminder.reconcile', { id: action.id }]] as const) await assert.rejects(f.invoice(method, payload), { code: 'SOURCE_REVOKED' });
  for (const name of ['open_receipt', 'list_counted_rows']) {
    const denied = await f.mcp('tools/call', { name, arguments: pin });
    assert.equal(denied.body.error?.data?.code, 'SOURCE_REVOKED'); assert.equal(denied.body.result, undefined);
    assert.ok(!JSON.stringify(denied.body).includes('7500'));
  }
  await f.reopen();
  await assert.rejects(f.invoice('read', { id: job.id }), { code: 'SOURCE_REVOKED' });
  const state = f.engine.vault!.read();
  assert.equal(state.actions.find((item: any) => item.id === action.id)!.attempts.length, 0);
  assert.equal(state.answers.filter(item => item.kind === 'invoice-simulated-delivery-v1').length, 0);
  assert.equal(f.providerCalls(), 0);
});

test('a revoked pinned invoice owner loses its HTTP session and cannot release private retained work', async t => {
  const f = await fixture(t);
  const invite = await f.rpc('auth.invite', { name: 'SYNTHETIC separate invoice owner', role: 'owner', branches: ['main'] });
  const member = await f.rpc('auth.accept', { token: invite.token });
  const { job, view } = await f.prepared(false, member.member.id, member.token), action = view.reminders[0];
  await f.invoice('reminder.approve', { id: action.id, digest: action.digest }, member.token);
  await assert.rejects(f.invoice('read', { id: job.id }), { code: 'JOB_OWNER_REQUIRED' });
  await f.rpc('members.revoke', { id: member.member.id });
  await assert.rejects(f.invoice('reminder.execute', { id: action.id }, member.token), { code: 'UNAUTHENTICATED' });
  await f.reopen();
  await assert.rejects(f.invoice('read', { id: job.id }, member.token), { code: 'UNAUTHENTICATED' });
  f.engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false }); await f.engine.tick();
  const state = f.engine.vault!.read();
  assert.equal(state.actions.find((item: any) => item.id === action.id)!.attempts.length, 0);
  assert.equal(state.answers.filter(item => item.kind === 'invoice-simulated-delivery-v1').length, 0);
  assert.equal((await f.rpc('jobs.list')).some((item: any) => item.id === job.id), false);
  assert.equal(f.providerCalls(), 0);
});

test('trusted Engine lifecycle runs invoice and generic deterministic jobs through their own contracts after reopen', async t => {
  const f = await fixture(t);
  const genericConfig = () => ({ type: 'calculation-set', goal: 'SYNTHETIC calculate explicitly selected billed invoices', ownerId: 'owner',
    sourceIds: [BOOKS], budgetMinor: '10', reserveMinor: '2', requiresApproval: false,
    limits: { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' },
    stopRule: { maxRuns: 1, deadline: new Date(f.clock() + DAY_MS).toISOString() },
    nextRunAt: f.iso(), intervalMs: DAY_MS, graceMs: 0, catchup: 'latest', background: false, testedRoutes: [], allowedActions: [],
    input: { requests: [{ id: 'synthetic-billed', input: { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' } },
      reserveMinor: '1', durationMs: 2000 }] } });
  const before = await f.rpc('jobs.create', genericConfig()), invoice = await f.invoice('create', f.config());
  await f.invoice('approve', { id: invoice.id, digest: invoice.digest });
  const after = await f.rpc('jobs.create', genericConfig());
  await f.reopen();
  for (const [method, payload] of [['tick', { awake: true, windowOpen: true, backgroundEnabled: true }], ['recover', {}]] as const) {
    const refused = await f.post('/api/rpc', { method: `invoiceFollowUp.${method}`, payload });
    assert.ok(refused.body.error); assert.equal(refused.body.result, undefined);
  }
  assert.deepEqual(await f.engine.tick(), []);
  for (const lifecycle of [{ awake: false, windowOpen: true, backgroundEnabled: false },
    { awake: true, windowOpen: false, backgroundEnabled: false }]) {
    f.engine.updateJobLifecycle(lifecycle); assert.deepEqual(await f.engine.tick(), []);
  }
  f.engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  const ran = await f.engine.tick();
  assert.deepEqual(ran.map((item: any) => item.id).sort(), [before.id, invoice.id, after.id].sort());
  assert.ok(ran.every((item: any) => item.status === 'awaiting-acceptance'));
  assert.deepEqual(await f.engine.tick(), []);
  const general = await f.rpc('jobs.list'); assert.equal(general.length, 2);
  assert.ok(general.every((item: any) => item.deliverable.result.calculations[0].value.valueMinor === '22000'));
  const view = await f.invoice('read', { id: invoice.id });
  assert.equal(view.job.deliverable.result.invoices[0].balance.outstandingMinor, '7500');
  assert.equal(view.job.deliverable.result.invoices[0].reminder.reason, 'customer-opt-in-required');
  assert.deepEqual(view.reminders, []); assert.equal(f.providerCalls(), 0);
});

test('joined companion keeps invoice approval and uploads at OPEN_DESKTOP without preparing or sending effects', async t => {
  const f = await fixture(t), { view } = await f.prepared();
  const keys = generateKeyPairSync('ed25519'), deviceId = 'synthetic-invoice-phone', keyId = 'synthetic-invoice-phone-key';
  const devicePublicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  // Literal independent encoder for the documented public companion protocol.
  async function phone(method: string, payload: unknown, credential?: string) {
    const body = JSON.stringify({ protocolVersion: 1, method, payload }), timestamp = new Date().toISOString();
    const nonce = randomBytes(32).toString('base64url');
    const credentialDigest = credential === undefined ? null
      : createHash('sha256').update('chausar-phone-credential-v1\n' + credential).digest('hex');
    const bytes = Buffer.from(JSON.stringify(['chausar-phone-request-v1', 'POST', '/api/companion/rpc',
      deviceId, keyId, timestamp, nonce, credentialDigest, Buffer.byteLength(body)]) + '\n' + body);
    const response = await fetch(f.origin + '/api/companion/rpc', { method: 'POST', body, headers: {
      'Content-Type': 'application/json', 'x-chausar-device': deviceId, 'x-chausar-key': keyId,
      'x-chausar-time': timestamp, 'x-chausar-nonce': nonce,
      'x-chausar-proof': sign(null, bytes, keys.privateKey).toString('base64url'),
      ...(credential === undefined ? {} : { Authorization: `Bearer ${credential}` }),
    } });
    return { status: response.status, body: await response.json() as any };
  }
  const invite = await f.rpc('phone.invite', { memberId: 'owner', deviceId, keyId, devicePublicKey, channel: 'web',
    capabilities: ['brief.read', 'approval.simple'], inviteTtlMs: 60000, sessionTtlMs: 600000 });
  const proof = sign(null, Buffer.from(JSON.stringify(['chausar-phone-pairing-v1', invite.inviteCode,
    deviceId, 'web', keyId, devicePublicKey])), keys.privateKey).toString('base64url');
  const paired = await phone('pairing.accept', { inviteCode: invite.inviteCode, deviceId, channel: 'web', devicePublicKey, proof });
  assert.equal(paired.status, 200); assert.equal(paired.body.error, undefined);
  const grant = paired.body.result as SessionGrant;
  assert.equal((await phone('session.validate', {}, grant.credential)).body.result.status, 'current');
  for (const [method, payload] of [['approval.list', {}], ['approval.inspect', { approvalId: view.reminders[0].id }],
    ['approval.submit', { requestId: 'synthetic-invoice-phone-approval', approvalId: view.reminders[0].id,
      token: '0'.repeat(64), decision: 'approve', expectedDigest: view.reminders[0].digest,
      expectedActionRevision: 1, expectedOperationVersion: 'synthetic-v1' }], ['upload.begin', {}]] as const) {
    const refused = await phone(method, payload, grant.credential);
    assert.equal(refused.body.error?.code, 'OPEN_DESKTOP'); assert.equal(refused.body.result, undefined);
  }
  const receiptId = view.job.deliverable.result.invoices[0].balance.receiptId;
  assert.equal((await phone('receipt.read', { receiptId }, grant.credential)).body.result.id, receiptId);
  await f.reopen();
  assert.equal((await phone('approval.list', {}, grant.credential)).body.error?.code, 'OPEN_DESKTOP');
  const current = await f.invoice('read', { id: view.job.id });
  assert.equal(current.reminders[0].status, 'prepared'); assert.equal(current.reminders[0].attempts.length, 0);
  assert.deepEqual(current.outcomes, []); assert.equal(f.providerCalls(), 0);
});

test('invoice methods require explicit installed host policy and a labelled demo workspace', async t => {
  const missing = await fixture(t, false);
  const refused = await missing.post('/api/rpc', { method: 'invoiceFollowUp.create', payload: missing.config() });
  assert.ok(refused.body.error); assert.equal(refused.body.result, undefined);
  assert.equal(missing.engine.vault!.read().jobs.length, 0);
  const real = await fixture(t, true, false);
  await assert.rejects(real.invoice('create', real.config()), { code: 'INVOICE_SIMULATION_ONLY' });
  await assert.rejects(real.consent(), { code: 'INVOICE_SIMULATION_ONLY' });
  assert.equal(real.engine.vault!.read().jobs.length, 0);
  assert.equal(missing.providerCalls() + real.providerCalls(), 0);
});
