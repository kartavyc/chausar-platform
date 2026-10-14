import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, ChausarError, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import type { Connector, Operation } from '../runtime/actions.ts';
import { JobService } from '../runtime/jobs.ts';
import { Engine } from '../runtime/engine.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { workMethods } from '../runtime/work-books/work.ts';
import { JOB_TEMPLATES } from '../runtime/work-books/work-jobs.ts';

class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic jobs shop', true); }
  read() { return this.state; }
  private tail: Promise<unknown> = Promise.resolve();
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.tail.then(async () => { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; });
    this.tail = run.catch(() => undefined); return run;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'accountant', role: 'accountant', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };

function fixture(options: { propose?: (payload: any) => unknown } = {}) {
  const store = new TestStore();
  store.state.members.push({ id: 'viewer', name: 'Vee Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }, { id: 'accountant', name: 'Asha Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  const op: Operation = {
    title: 'Pay a supplier', description: 'Pays a supplier in the synthetic books app.', impact: 'money', idempotency: 'The key names one payment.', readback: 'Reads the payment by key.',
    validate: payload => payload as Record<string, unknown>, execute: async (_p, key) => ({ externalId: key }),
    reconcile: async () => ({ verified: false, businessSuccess: false, data: null, absent: true }),
  };
  const connector: Connector = { id: 'books-app', title: 'Synthetic books app', operations: { pay: op } };
  const actions = new ActionService(store, [connector]); const jobs = new JobService(store);
  const calls: { method: string; payload: any }[] = [];
  const host = (ctx: Context): ModuleHost => ({
    store, services: { actions, jobs }, demo: true, directory: '/tmp/x', options: {},
    async call(method, payload) {
      calls.push({ method, payload });
      if (method === 'jobs.create') return jobs.create(ctx, payload as any);
      if (method === 'jobs.approve') return jobs.approve(ctx, payload.id as string, payload.digest as string);
      if (method === 'jobsx.propose' && options.propose) return options.propose(payload);
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.');
    },
  });
  const request = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = workMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host(ctx));
  };
  return { store, actions, jobs, calls, request };
}

test('the ready-made jobs are read-only briefs with a budget, a stop rule and a missed-run rule', async () => {
  const f = fixture();
  const reply = await f.request(viewer, 'approvals.jobTemplates');
  assert.deepEqual(reply.templates.map((t: any) => [t.id, t.every, t.type, t.needsModel]), [
    ['daily-brief', 'day', 'owner-brief', false], ['weekly-brief', 'week', 'owner-brief', false], ['month-end-brief', 'month', 'owner-brief', false],
  ]);
  for (const t of reply.templates) {
    assert.match(t.budget.minor, /^[1-9]\d*$/); assert.ok(Number.isInteger(t.maxRuns) && t.maxRuns >= 1 && t.maxRuns <= 366);
    assert.ok(['skip', 'run-once-on-wake'].includes(t.missedRun)); assert.deepEqual(t.actions, []);
    assert.equal(typeof t.goal, 'string'); assert.equal(typeof t.doneWhen, 'string');
  }
  assert.deepEqual(reply.fromSentence, { available: false });
  await assert.rejects(f.request(owner, 'approvals.jobTemplates', { extra: 1 }), code('INVALID_JOB_PROPOSAL'));
  // Changing the returned copy never changes the templates.
  reply.templates[0].budget.minor = '1'; assert.equal(JOB_TEMPLATES[0].budget.minor, '5000');
});

test('proposing a template creates an owner-brief job that waits in the queue, and approving it starts it', async () => {
  const f = fixture();
  const { id } = await f.request(owner, 'approvals.proposeJob', { templateId: 'weekly-brief', budgetMinor: '25050', maxRuns: 4, missedRun: 'skip' });
  assert.match(id, /^job:/);
  const create = f.calls.find(c => c.method === 'jobs.create')!.payload;
  assert.equal(create.type, 'owner-brief'); assert.equal(create.budgetMinor, '25050'); assert.equal(create.reserveMinor, '25050');
  assert.equal(create.stopRule.maxRuns, 4); assert.equal(create.intervalMs, 7 * 86_400_000); assert.equal(create.catchup, 'skip'); assert.equal(create.requiresApproval, true);
  const days = (Date.parse(create.stopRule.deadline) - Date.now()) / 86_400_000; assert.ok(days > 90 && days <= 91);

  const list = await f.request(owner, 'approvals.list');
  const row = list.items.find((i: any) => i.id === id);
  assert.ok(row); assert.equal(row.source, 'job'); assert.equal(row.kind, 'job'); assert.equal(row.tier, 'tier-2'); assert.equal(row.state, 'prepared');
  assert.deepEqual(row.amount, { minor: '25050' });
  const sheet = await f.request(owner, 'approvals.get', { id });
  assert.equal(sheet.reason, 'job-approval'); assert.ok(sheet.can.includes('approve'));
  assert.equal(sheet.job.missedRun, 'skip'); assert.deepEqual(sheet.job.stopRule.maxRuns, 4); assert.deepEqual(sheet.job.actions, []);
  const rows = await f.request(owner, 'approvals.jobs');
  assert.equal(rows.items[0].state, 'proposed'); assert.ok(rows.items[0].can.includes('approve'));

  const approved = await f.request(owner, 'approvals.approve', { id, digest: sheet.digest });
  assert.equal(approved.state, 'approved');
  assert.equal((await f.request(owner, 'approvals.list')).items.some((i: any) => i.id === id), false);
  assert.equal((await f.request(owner, 'approvals.jobs')).items[0].state, 'scheduled');
});

test('template defaults apply when only the template is named; a missed run of run-once-on-wake uses the latest catch-up', async () => {
  const f = fixture();
  await f.request(owner, 'approvals.proposeJob', { templateId: 'daily-brief' });
  const create = f.calls.find(c => c.method === 'jobs.create')!.payload;
  assert.equal(create.budgetMinor, '5000'); assert.equal(create.stopRule.maxRuns, 30); assert.equal(create.intervalMs, 86_400_000); assert.equal(create.catchup, 'latest');
});

test('proposals refuse a bad budget, bad runs, unknown fields and templates, an accountant and a viewer', async () => {
  const f = fixture();
  for (const budgetMinor of ['0', '-5', '12.50', '1e3', '050', '50001', 5000, ''])
    await assert.rejects(f.request(owner, 'approvals.proposeJob', { templateId: 'daily-brief', budgetMinor }), code('INVALID_BUDGET'), String(budgetMinor));
  await f.request(owner, 'approvals.proposeJob', { templateId: 'daily-brief', budgetMinor: '50000' }); // exactly ten times
  for (const maxRuns of [0, 367, 1.5, '3'])
    await assert.rejects(f.request(owner, 'approvals.proposeJob', { templateId: 'daily-brief', maxRuns }), code('STOP_RULE_REQUIRED'));
  await assert.rejects(f.request(owner, 'approvals.proposeJob', { templateId: 'daily-brief', missedRun: 'run-all' }), code('INVALID_SCHEDULE'));
  await assert.rejects(f.request(owner, 'approvals.proposeJob', { templateId: 'nope' }), code('TEMPLATE_NOT_FOUND'));
  await assert.rejects(f.request(owner, 'approvals.proposeJob', { templateId: 'daily-brief', goal: 'Do anything' }), code('INVALID_JOB_PROPOSAL'));
  await assert.rejects(f.request(accountant, 'approvals.proposeJob', { templateId: 'daily-brief' }), code('FORBIDDEN'));
  await assert.rejects(f.request(viewer, 'approvals.proposeJob', { templateId: 'daily-brief' }), code('FORBIDDEN'));
  assert.equal(f.calls.filter(c => c.method === 'jobs.create').length, 1);
});

test('one sentence is refused as not built without jobsx, and passes through when it is installed', async () => {
  const f = fixture();
  await assert.rejects(f.request(owner, 'approvals.proposeJob', { sentence: 'Tell me every Monday who owes me money.' }), code('PROPOSAL_FROM_SENTENCE_NOT_BUILT'));
  await assert.rejects(f.request(owner, 'approvals.proposeJob', { sentence: 'Tell me every Monday.', templateId: 'daily-brief' }), code('INVALID_JOB_PROPOSAL'));
  const g = fixture({ propose: payload => (payload.sentence ? { id: 'job_from_sentence' } : (() => { throw new ChausarError('INVALID_REQUEST', 'Say the job.'); })()) });
  assert.deepEqual((await g.request(owner, 'approvals.jobTemplates')).fromSentence, { available: true });
  assert.deepEqual(await g.request(owner, 'approvals.proposeJob', { sentence: '  Tell me every Monday who owes me money.  ' }), { id: 'job:job_from_sentence' });
  assert.deepEqual(g.calls.filter(c => c.method === 'jobsx.propose').at(-1)!.payload, { sentence: 'Tell me every Monday who owes me money.' });
});

test('the job sheet carries three meters: model use, clock time and effect exposure, with missing words when unknown', async () => {
  const f = fixture();
  const { id } = await f.request(owner, 'approvals.proposeJob', { templateId: 'daily-brief' });
  const raw = id.slice(4);
  const sheet = await f.request(owner, 'approvals.job', { id });
  assert.deepEqual(sheet.meters, { model: { spent: { minor: '0' }, budget: { minor: '5000' }, route: null, estimate: false }, clock: { missing: 'not-counted' }, exposure: { missing: 'not-counted' } });

  const pay = await f.actions.prepare(owner, { connector: 'books-app', operation: 'pay', payload: { supplierId: 's', amountMinor: '9007199254740993' }, idempotencyKey: 'pay-supplier-1', sourceIds: [] });
  const pay2 = await f.actions.prepare(owner, { connector: 'books-app', operation: 'pay', payload: { supplierId: 't', amountMinor: '7' }, idempotencyKey: 'pay-supplier-2', sourceIds: [] });
  await f.store.update(state => {
    const job = state.jobs.find((j: any) => j.id === raw);
    job.testedRoutes = ['codex-cli'];
    job.ledger.push({ at: new Date().toISOString(), event: 'step', durationMs: 90_000, actionId: pay.id }, { at: new Date().toISOString(), event: 'step', durationMs: 60_000, actionId: pay2.id });
  });
  const after = await f.request(owner, 'approvals.job', { id: raw });
  assert.deepEqual(after.meters.model, { spent: { minor: '0' }, budget: { minor: '5000' }, route: 'codex-cli', estimate: true });
  assert.deepEqual(after.meters.clock, { minutes: 3 });
  assert.deepEqual(after.meters.exposure, { minor: '9007199254741000' });
});

test('the real engine lists templates, proposes a job, queues it as job: and approves it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-work-books-jobs-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Jobs Shop', passphrase: 'Synthetic jobs passphrase 2026', demo: false, pack: 'ecommerce', folder: 'main' });
  const templates = await engine.request('approvals.jobTemplates', {});
  assert.deepEqual(templates.templates.map((x: any) => x.id), ['daily-brief', 'weekly-brief', 'month-end-brief']);
  assert.deepEqual(templates.fromSentence, { available: false });
  await assert.rejects(engine.request('approvals.proposeJob', { sentence: 'Tell me every Monday who owes me money.' }), code('PROPOSAL_FROM_SENTENCE_NOT_BUILT'));
  const { id } = await engine.request('approvals.proposeJob', { templateId: 'month-end-brief', budgetMinor: '15000' });
  assert.match(id, /^job:/);
  const list = await engine.request('approvals.list', {});
  const row = list.items.find((i: any) => i.id === id);
  assert.ok(row); assert.equal(row.source, 'job'); assert.deepEqual(row.amount, { minor: '15000' });
  const sheet = await engine.request('approvals.get', { id });
  assert.equal(sheet.job.missedRun, 'skip');
  const card = await engine.request('approvals.job', { id });
  assert.deepEqual(card.meters.clock, { missing: 'not-counted' }); assert.equal(card.meters.model.route, null);
  const approved = await engine.request('approvals.approve', { id, digest: sheet.digest });
  assert.equal(approved.state, 'approved');
  assert.equal((await engine.request('approvals.list', {})).items.some((i: any) => i.id === id), false);
});
