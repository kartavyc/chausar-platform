import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, ChausarError, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import { JobService } from '../runtime/jobs.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { workMethods } from '../runtime/work-books/work.ts';

// The jobs-ext lane (`claude/lane-jobs-ext`) is not installed here. Its methods are stubbed through
// `hasMethod` and the host dispatcher, and every stubbed reply copies the shape of
// `platform/runtime/jobs-ext/methods.ts` on that branch (view, budgetView, jobsx.get, resultFor, the
// Proposal of proposeEdit, setMissedRule, personStep.done, jobs.remove). Every value is synthetic.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic lane jobs shop', true); }
  read() { return this.state; }
  private tail: Promise<unknown> = Promise.resolve();
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.tail.then(async () => { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; });
    this.tail = run.catch(() => undefined); return run;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const cofounder: Context = { memberId: 'cofounder', role: 'cofounder', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'accountant', role: 'accountant', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
type Handler = (payload: any, ctx: Context) => unknown;
const AT = '2026-10-14T05:00:00.000Z';
const JOBSX = ['jobsx.get', 'jobsx.result', 'jobsx.list', 'jobsx.proposals', 'jobsx.edit', 'jobsx.setMissedRule', 'jobsx.delete', 'jobsx.personStep.done'];

function fixture(handlers: Record<string, Handler>, calculatorReceipt?: (ctx: Context, id: string) => unknown) {
  const store = new TestStore();
  store.state.members.push({ id: 'cofounder', name: 'Chitra Cofounder', role: 'cofounder', active: true, epoch: 1, branches: ['*'] }, { id: 'accountant', name: 'Asha Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  const actions = new ActionService(store, []); const jobs = new JobService(store);
  const calculator = { receipt: (ctx: Context, id: string) => { if (!calculatorReceipt) throw new ChausarError('RECEIPT_NOT_FOUND', 'No.'); return calculatorReceipt(ctx, id); }, catalog: () => [] };
  const calls: { method: string; payload: any }[] = [];
  const host = (ctx: Context): ModuleHost => ({
    store, services: { actions, jobs, calculator }, demo: true, directory: '/tmp/x', options: { hasMethod: (name: string) => Object.hasOwn(handlers, name) },
    async call(method, payload) {
      calls.push({ method, payload });
      if (Object.hasOwn(handlers, method)) return handlers[method](payload, ctx);
      if (method === 'jobs.create') return jobs.create(ctx, payload as any);
      if (method === 'jobs.cancel') return jobs.cancel(ctx, payload.id as string);
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.');
    },
  });
  const request = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = workMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host(ctx));
  };
  /** A lane job as jobs-ext makes it: a core JobService job of type `jobsx-<template>`, approved. */
  const laneJob = async (template = 'weekly-close') => {
    const job: any = await jobs.create(owner, { type: `jobsx-${template}`, goal: 'Close the week: net sales, margin and what customers owe.', budgetMinor: '2000', reserveMinor: '20',
      stopRule: { maxRuns: 12, deadline: '2027-01-07T05:00:00.000Z' }, intervalMs: 7 * 86_400_000, catchup: 'latest' } as any);
    return job.id as string;
  };
  const brief = async () => (await request(owner, 'approvals.proposeJob', { templateId: 'daily-brief' })).id.slice(4) as string;
  return { store, calls, request, laneJob, brief, jobs };
}

/** `budgetView` in jobs-ext methods.ts. */
const budgetView = (jobId: string) => ({
  jobId, budgetMinor: '2000', budget: '₹20.00', spentMinor: '1200', spent: '₹12.00', reservedMinor: '20', remainingMinor: '780', remaining: '₹7.80',
  meters: {
    model: [{ routeId: 'route-claude-cli', costMinor: '1200', cost: '₹12.00', steps: 2, minutes: 1, basis: 'estimate' }],
    clockMs: 150_000, exposureMinor: '0', exposure: 'No money exposure: this job’s actions touch no money.',
  },
});
/** `jobsx.get` in jobs-ext methods.ts: `{ ...view, facts, steps, waitingForYou, timeline (newest first), next, ... }`. */
function jobsxGet(jobId: string, o: { stepsPerDelivery?: number; missedRule?: 'skip' | 'once' | 'all'; stepDone?: boolean } = {}) {
  const person = { id: 'jobsx_person_1', jobId, title: 'Review the week and lock it in your books', assignee: 'owner', status: 'waiting', createdAt: '2026-10-12T05:00:00.000Z' };
  const question = { id: 'jobsx_question_1', jobId, caseId: 'inv-7', askedAt: '2026-10-12T05:00:00.000Z', prompt: 'Invoice INV-7 is long overdue. Remind, stop or call?', options: ['remind', 'stop', 'call'], status: 'open', sourceIds: ['src-1'] };
  return {
    id: jobId, title: 'Weekly close', template: 'weekly-close', type: 'jobsx-weekly-close', goal: 'Close the week: net sales, margin and what customers owe.', status: 'paused',
    state: 'waiting-for-you', nextRunAt: '2026-10-19T05:00:00.000Z', spentMinor: '1200', spent: '₹12.00', budgetMinor: '2000', budget: '₹20.00',
    missed: { text: '3 runs were missed while this computer slept. Ran once.', at: '2026-10-12T04:00:00.000Z' }, laneRun: true, deleted: false,
    facts: { goal: 'Close the week: net sales, margin and what customers owe.', progress: { stepsDone: 0, stepsPerDelivery: o.stepsPerDelivery ?? 1, casesOpen: 1, casesClosed: 0 },
      budget: budgetView(jobId), stops: '2027-01-07T05:00:00.000Z' },
    steps: [
      { kind: 'calculate', title: 'Net sales for the week', needsModel: false, label: 'runs without one' },
      { kind: 'lookup', title: 'Look up a missing detail with the agent, only when the rule is unsure', needsModel: true, label: 'needs an AI model' },
      { kind: 'person', title: 'Review the week and lock it in your books', needsModel: false, label: 'runs without one' },
    ],
    waitingForYou: o.stepDone ? [{ kind: 'question', ...question }] : [{ kind: 'question', ...question }, { kind: 'person-step', ...person }],
    timeline: [
      { id: 'jobsx_line_3', at: '2026-10-12T05:00:00.000Z', jobId, run: 1, kind: 'person-step', text: 'A step for a person is waiting.' },
      { id: 'jobsx_line_2', at: '2026-10-12T04:59:00.000Z', jobId, run: 1, kind: 'step', stepKind: 'lookup', needsModel: true, routeId: 'route-claude-cli', costMinor: '1200', costEstimate: true, durationMs: 60_000, text: 'The agent looked up a missing detail.', code: 'COST_ABOVE_RESERVATION' },
      { id: 'jobsx_line_1', at: '2026-10-12T04:58:00.000Z', jobId, run: 1, kind: 'step', stepKind: 'calculate', needsModel: false, durationMs: 90_000, text: 'Worked out net sales for the week.', receiptIds: ['r-week-1'] },
    ],
    next: { nextRunAt: '2026-10-19T05:00:00.000Z', upcoming: ['2026-10-19T05:00:00.000Z'] }, tainted: false, stoppedBy: null, leftUndone: [], testedRoutes: ['route-claude-cli'],
    missedRule: o.missedRule ?? 'once', background: false,
  };
}
/** `resultFor` in jobs-ext methods.ts (a `LaneResult` with the acceptance reference). */
const jobsxResult = (jobId: string) => ({
  jobId, run: 1, deliveredAt: '2026-10-13T05:00:00.000Z', digest: 'e'.repeat(64), done: ['Net sales worked out.'], open: ['Lock the week in your books.'], recommendations: [],
  figures: [{ key: 'net_sales', label: 'Net sales', minor: '450000', display: '₹4,500.00', receiptId: 'r-week-2' }], cases: [], receiptIds: ['r-week-2'], sourceIds: ['src-1'],
  status: 'awaiting-acceptance', finishedOnlyWhenAccepted: true, reference: { kind: 'job-acceptance', id: jobId, revision: 1, digest: 'f'.repeat(64), deliverableDigest: 'a'.repeat(64) },
});
/** The `Proposal` that `proposeEdit` returns: a new card for the same job, waiting for approval. */
const editProposal = (jobId: string, changes: Record<string, unknown>) => ({
  id: 'jobsx_proposal_edit_1', createdAt: AT, createdBy: 'owner', origin: 'edit', replacesJobId: jobId, template: 'weekly-close', sentence: 'Close the week: net sales, margin and what customers owe.',
  card: { template: 'weekly-close', title: 'Weekly close', budgetMinor: changes.budgetMinor ?? '2000', reserveMinor: changes.reserveMinor ?? '20', missedRule: changes.missedRule ?? 'once' },
  digest: 'c'.repeat(64), status: 'proposed', evidence: [], sourceIds: ['src-1'],
});

test('jobsx.get: person steps, template steps, questions, the measured budget, the time line and the missed-run rule map onto the sheet', async () => {
  const receipt = (id: string, asOf: string, valueMinor: string) => ({ id, operation: 'net_sales', asOf, valueMinor, figures: [{ key: 'total', label: 'Net sales', minor: valueMinor }] });
  let id = '';
  const f = fixture({ 'jobsx.get': p => jobsxGet(p.id), 'jobsx.result': p => jobsxResult(p.id), 'jobsx.personStep.done': () => ({}), 'jobsx.setMissedRule': () => ({}), 'jobsx.edit': () => ({}) },
    (_ctx, rid) => rid === 'r-week-1' ? receipt('r-week-1', '2026-10-12T04:58:00.000Z', '400000') : receipt('r-week-2', '2026-10-13T05:00:00.000Z', '450000'));
  id = await f.laneJob();
  await f.store.update(state => { state.receipts.push({ id: 'r-week-1' } as any, { id: 'r-week-2' } as any); });
  const sheet = await f.request(owner, 'approvals.job', { id });
  assert.deepEqual(f.calls.filter(c => c.method.startsWith('jobsx.')).map(c => [c.method, c.payload]), [['jobsx.get', { id }], ['jobsx.result', { id }]]);
  // WK-16: the waiting person step leads the time line; only the job's owner may mark it.
  const step = sheet.timeline[0];
  assert.deepEqual([step.kind, step.stepId, step.what, step.who.kind, step.at, step.done, step.canDone], ['person', 'jobsx_person_1', 'Review the week and lock it in your books', 'you', '2026-10-12T05:00:00.000Z', false, true]);
  // jobs-ext's own time line, oldest first, with its costs, model marks and codes.
  assert.deepEqual(sheet.timeline.slice(1).map((t: any) => [t.event, t.amount, t.needsModel, t.reason]), [
    ['Worked out net sales for the week.', null, false, null],
    ['The agent looked up a missing detail.', { minor: '1200' }, true, 'COST_ABOVE_RESERVATION'],
    ['A step for a person is waiting.', null, null, null],
  ]);
  // WK-08: jobs-ext's measured budget replaces the derived meters.
  assert.deepEqual(sheet.meters, { model: { spent: { minor: '1200' }, budget: { minor: '2000' }, route: 'route-claude-cli', estimate: true }, clock: { minutes: 3 }, exposure: { minor: '0' } });
  // The measure: the receipts its time line and its delivered result name, read as the caller.
  assert.deepEqual(sheet.measure, { name: 'Net sales', goal: { missing: 'absent' }, goalReceiptId: null, points: [
    { at: '2026-10-12T04:58:00.000Z', value: { minor: '400000' }, receiptId: 'r-week-1' }, { at: '2026-10-13T05:00:00.000Z', value: { minor: '450000' }, receiptId: 'r-week-2' }] });
  assert.deepEqual(sheet.result, { done: ['Net sales worked out.'], open: ['Lock the week in your books.'], recommends: [], receiptIds: ['r-week-2'] });
  // WK-11: the rule `once` reads as run once on wake; a job that delivers every run is offered "run every missed one".
  assert.equal(sheet.missedRun, 'run-once-on-wake');
  assert.deepEqual(sheet.missedRule, { rule: 'run-once-on-wake', choices: ['run-once-on-wake', 'skip', 'run-all'], runAll: 'offered' });
  assert.deepEqual(sheet.manage, { edit: 'jobsx', delete: 'cancel', missedRule: 'jobsx', personStep: 'jobsx', answer: 'not-built', accept: 'core' });
  assert.deepEqual(sheet.jobsx, {
    title: 'Weekly close', state: 'waiting-for-you', reason: null,
    steps: [{ kind: 'calculate', title: 'Net sales for the week', needsModel: false }, { kind: 'lookup', title: 'Look up a missing detail with the agent, only when the rule is unsure', needsModel: true },
      { kind: 'person', title: 'Review the week and lock it in your books', needsModel: false }],
    questions: [{ id: 'jobsx_question_1', prompt: 'Invoice INV-7 is long overdue. Remind, stop or call?', options: ['remind', 'stop', 'call'], askedAt: '2026-10-12T05:00:00.000Z', suggested: null }],
    missed: { text: '3 runs were missed while this computer slept. Ran once.', at: '2026-10-12T04:00:00.000Z' }, leftUndone: [], tainted: false, upcoming: ['2026-10-19T05:00:00.000Z'],
  });
  // Daily rounds: "run every missed one" is not offered (jobs-ext refuses it with MISSED_RULE_UNSUITABLE).
  const g = fixture({ 'jobsx.get': p => jobsxGet(p.id, { stepsPerDelivery: 7, missedRule: 'skip' }), 'jobsx.setMissedRule': () => ({}) });
  const rounds = await g.laneJob('receivables-week');
  const r = await g.request(owner, 'approvals.job', { id: rounds });
  assert.deepEqual([r.missedRun, r.missedRule], ['skip', { rule: 'skip', choices: ['run-once-on-wake', 'skip'], runAll: 'unsuitable' }]);
});

test('jobsx.personStep.done is sent { id } with the step id, and the reply is jobs-ext\'s step record', async () => {
  let done = false;
  const f = fixture({
    'jobsx.get': p => jobsxGet(p.id, { stepDone: done }),
    'jobsx.personStep.done': (p, ctx) => { done = true; return { id: p.id, jobId: f.store.state.jobs[0].id, title: 'Review the week and lock it in your books', assignee: 'owner', status: 'done', createdAt: '2026-10-12T05:00:00.000Z', doneAt: AT, doneBy: ctx.memberId }; },
  });
  const id = await f.laneJob();
  await assert.rejects(f.request(accountant, 'approvals.personStepDone', { jobId: id, stepId: 'jobsx_person_1' }), code('FORBIDDEN'));
  await assert.rejects(f.request(owner, 'approvals.personStepDone', { jobId: id, stepId: 'nope' }), code('NOT_FOUND'));
  assert.deepEqual(await f.request(owner, 'approvals.personStepDone', { jobId: `job:${id}`, stepId: 'jobsx_person_1' }),
    { jobId: id, stepId: 'jobsx_person_1', done: true, doneAt: AT, doneBy: f.store.state.members.find(m => m.id === 'owner')!.name }); // the member id, named
  assert.deepEqual(f.calls.filter(c => c.method === 'jobsx.personStep.done').map(c => c.payload), [{ id: 'jobsx_person_1' }]);
  // jobs-ext lists only waiting steps: once done, the step is gone from the sheet and cannot be marked again.
  const after = await f.request(owner, 'approvals.job', { id });
  assert.equal(after.timeline.some((s: any) => s.kind === 'person'), false);
  await assert.rejects(f.request(owner, 'approvals.personStepDone', { jobId: id, stepId: 'jobsx_person_1' }), code('NOT_FOUND'));
});

test('jobsx.edit is sent { id, changes } and proposes a new card that waits for approval; the most runs is not editable there', async () => {
  const f = fixture({ 'jobsx.get': p => jobsxGet(p.id), 'jobsx.edit': p => editProposal(p.id, p.changes) });
  const id = await f.laneJob();
  assert.deepEqual(await f.request(owner, 'approvals.editJob', { id, config: { budgetMinor: '3000', missedRun: 'run-all' } }),
    { id: `job:${id}`, via: 'jobsx', waitsFor: 'proposal', proposal: { id: 'jobsx_proposal_edit_1', digest: 'c'.repeat(64) }, approvalId: 'proposal:jobsx_proposal_edit_1' });
  // A budget below the reservation brings the reservation down with it (jobs-ext refuses a reservation above the budget).
  await f.request(owner, 'approvals.editJob', { id, config: { budgetMinor: '10', missedRun: 'skip' } });
  assert.deepEqual(f.calls.filter(c => c.method === 'jobsx.edit').map(c => c.payload), [
    { id, changes: { budgetMinor: '3000', missedRule: 'all' } },
    { id, changes: { budgetMinor: '10', reserveMinor: '10', missedRule: 'skip' } },
  ]);
  await assert.rejects(f.request(owner, 'approvals.editJob', { id, config: { maxRuns: 5 } }), code('JOB_EDIT_FIELD_NOT_BUILT'));
  // A reply that is not a proposed card is refused rather than reported as an edit.
  const g = fixture({ 'jobsx.edit': () => ({ ok: true }) });
  const id2 = await g.laneJob();
  await assert.rejects(g.request(owner, 'approvals.editJob', { id: id2, config: { budgetMinor: '3000' } }), code('INVALID_JOB_REPLY'));
});

test('jobsx.setMissedRule is sent { id, rule } in its own words and applies at once; MISSED_RULE_UNSUITABLE passes through', async () => {
  const f = fixture({ 'jobsx.setMissedRule': p => {
    if (p.rule === 'all') throw new ChausarError('MISSED_RULE_UNSUITABLE', 'Daily rounds cannot all be caught up on one day. Choose skip or run once.');
    return { id: p.id, missedRule: p.rule };
  } });
  const id = await f.laneJob('receivables-week');
  assert.deepEqual(await f.request(owner, 'approvals.setMissedRule', { id, rule: 'skip' }), { id: `job:${id}`, missedRun: 'skip', via: 'jobsx', waitsForApproval: false });
  assert.deepEqual(await f.request(owner, 'approvals.setMissedRule', { id, rule: 'run-once-on-wake' }), { id: `job:${id}`, missedRun: 'run-once-on-wake', via: 'jobsx', waitsForApproval: false });
  await assert.rejects(f.request(owner, 'approvals.setMissedRule', { id, rule: 'run-all' }), code('MISSED_RULE_UNSUITABLE'));
  await assert.rejects(f.request(owner, 'approvals.setMissedRule', { id, rule: 'all' }), code('INVALID_SCHEDULE'));
  assert.deepEqual(f.calls.filter(c => c.method.startsWith('jobsx.')).map(c => c.payload), [{ id, rule: 'skip' }, { id, rule: 'once' }, { id, rule: 'all' }]);
  assert.equal(f.calls.some(c => c.method === 'jobsx.edit'), false);
});

test('jobsx.delete is sent { id } for a lane job and returns the removed job', async () => {
  const f = fixture({ 'jobsx.delete': p => { const job = f.jobs.find(f.store.state, p.id); return { ...structuredClone(job), status: 'stopped' }; } });
  const id = await f.laneJob();
  assert.deepEqual(await f.request(owner, 'approvals.deleteJob', { id: `job:${id}` }), { id, state: 'deleted', note: null });
  assert.deepEqual(f.calls.filter(c => c.method === 'jobsx.delete').map(c => c.payload), [{ id }]);
  assert.equal(f.calls.some(c => c.method === 'jobs.cancel'), false);
});

test('a core job keeps the core paths with every jobsx method installed: no jobsx call is made for it', async () => {
  const handlers: Record<string, Handler> = Object.fromEntries(JOBSX.map(m => [m, () => { throw new Error(`${m} must not be called for a core job`); }]));
  handlers['jobsx.list'] = () => ({ proposals: [], jobs: [], activeJobs: 0, activeJobCap: 10, atLimit: false });
  const f = fixture(handlers);
  const id = await f.brief();
  const sheet = await f.request(owner, 'approvals.job', { id });
  assert.deepEqual(sheet.manage, { edit: 'not-built', delete: 'cancel', missedRule: 'not-built', personStep: 'not-built', answer: 'not-built', accept: 'core' });
  assert.deepEqual(sheet.missedRule, { rule: 'run-once-on-wake', choices: ['run-once-on-wake', 'skip'], runAll: 'not-built' });
  assert.equal(sheet.jobsx, null);
  await assert.rejects(f.request(owner, 'approvals.editJob', { id, config: { budgetMinor: '6000' } }), code('JOB_EDIT_NOT_BUILT'));
  await assert.rejects(f.request(owner, 'approvals.setMissedRule', { id, rule: 'skip' }), code('MISSED_RULE_NOT_BUILT'));
  assert.deepEqual(await f.request(owner, 'approvals.deleteJob', { id }), { id, state: 'cancelled', note: 'cancel-keeps-record' });
  assert.deepEqual(f.calls.filter(c => c.method.startsWith('jobsx.')).map(c => c.method), []);
});

test('approvals.jobs reads jobsx.list: lane labels in this list\'s states, and proposals (edits among them) waiting for a yes', async () => {
  let id = '';
  const f = fixture({ 'jobsx.list': () => ({
    proposals: [
      { proposalId: 'jobsx_proposal_edit_1', title: 'Weekly close', origin: 'edit', fromJobId: null, replacesJobId: id, state: 'proposed', evidence: [], digest: 'c'.repeat(64) },
      { proposalId: 'jobsx_proposal_2', title: 'Cash position', origin: 'detector', fromJobId: null, replacesJobId: null, state: 'proposed', evidence: ['You asked about money received or owed in three different weeks.'], digest: 'b'.repeat(64) },
    ],
    jobs: [{ id, title: 'Weekly close', template: 'weekly-close', type: 'jobsx-weekly-close', goal: 'x', status: 'paused', state: 'waiting-for-you', nextRunAt: AT, spentMinor: '0', spent: '₹0.00', budgetMinor: '2000', budget: '₹20.00', missed: null, laneRun: true, deleted: false }],
    activeJobs: 1, activeJobCap: 10, atLimit: false,
  }) });
  id = await f.laneJob();
  await f.jobs.pause(owner, id);
  const reply = await f.request(cofounder, 'approvals.jobs');
  assert.deepEqual(f.calls.filter(c => c.method.startsWith('jobsx.')).map(c => [c.method, c.payload]), [['jobsx.list', {}]]);
  assert.deepEqual(reply.proposals, { available: true, items: [
    { id: 'jobsx_proposal_edit_1', title: 'Weekly close', origin: 'edit', replacesJobId: id, evidence: [], digest: 'c'.repeat(64) },
    { id: 'jobsx_proposal_2', title: 'Cash position', origin: 'detector', replacesJobId: null, evidence: ['You asked about money received or owed in three different weeks.'], digest: 'b'.repeat(64) },
  ] });
  const mine = await f.request(owner, 'approvals.jobs');
  const row = mine.items.find((r: any) => r.id === id);
  assert.deepEqual([row.state, row.reason], ['waiting', 'waiting-for-you']);
  // Only jobsx.proposals installed: the Proposal records are read instead.
  const g = fixture({ 'jobsx.proposals': () => [editProposal('job_x', {})] });
  assert.deepEqual((await g.request(owner, 'approvals.jobs')).proposals.items, [{ id: 'jobsx_proposal_edit_1', title: 'Weekly close', origin: 'edit', replacesJobId: 'job_x', evidence: [], digest: 'c'.repeat(64) }]);
  // Neither installed: nothing is called.
  const h = fixture({});
  assert.deepEqual((await h.request(owner, 'approvals.jobs')).proposals, { available: false });
  assert.deepEqual(h.calls.filter(c => c.method.startsWith('jobsx.')), []);
});
