import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, ChausarError, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import { JobService } from '../runtime/jobs.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { workMethods } from '../runtime/work-books/work.ts';

// jobs-ext (`claude/lane-jobs-ext`) is not installed here. Its methods are stubbed through `hasMethod` and
// the host dispatcher; every stubbed reply copies a shape from that branch: `Proposal` and `JobCard`
// (jobs-ext state.ts), `jobsx.proposals`, `approveProposal` ({ proposal, job }), `dismissProposal`
// (the proposal, dismissed), `jobsx.get` (waitingForYou with a `LaneQuestion`), `jobsx.answer` (the
// question, answered), `jobsx.accept` / `jobsx.reject` / `jobsx.pause` / `jobsx.resume` (a job view).
// Every value is synthetic.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic proposals shop', true); }
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

function fixture(handlers: Record<string, Handler>) {
  const store = new TestStore();
  store.state.members.push({ id: 'cofounder', name: 'Chitra Cofounder', role: 'cofounder', active: true, epoch: 1, branches: ['*'] }, { id: 'accountant', name: 'Asha Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  const actions = new ActionService(store, []); const jobs = new JobService(store);
  const calls: { method: string; payload: any }[] = [];
  const host = (ctx: Context): ModuleHost => ({
    store, services: { actions, jobs }, demo: true, directory: '/tmp/x', options: { hasMethod: (name: string) => Object.hasOwn(handlers, name) && name.startsWith('jobsx.') },
    async call(method, payload) {
      calls.push({ method, payload });
      if (Object.hasOwn(handlers, method)) return handlers[method](payload, ctx);
      if (method === 'jobs.create') return jobs.create(ctx, payload as any);
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.');
    },
  });
  const request = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = workMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host(ctx));
  };
  const job = async (type: string) => ((await jobs.create(owner, { type, goal: 'Close the week: net sales, margin and what customers owe.', budgetMinor: '2000', reserveMinor: '20',
    stopRule: { maxRuns: 12, deadline: '2027-01-07T05:00:00.000Z' }, intervalMs: 7 * 86_400_000, catchup: 'latest' } as any)) as any).id as string;
  /** A delivered result waiting for the owner's acceptance, written as JobService would leave it. */
  const deliver = async (id: string) => store.update(state => { const j: any = state.jobs.find((x: any) => x.id === id); j.status = 'awaiting-acceptance'; j.deliverable = { done: ['Net sales worked out.'], open: [], receiptIds: [] }; j.ledger.push({ at: AT, event: 'delivered' }); });
  return { store, calls, request, job, deliver };
}
const jobsxCalls = (calls: { method: string; payload: any }[]) => calls.filter(c => c.method.startsWith('jobsx.')).map(c => [c.method, c.payload]);

/** A `Proposal` as `proposeCard` stores and `jobsx.proposals` lists it (jobs-ext proposals.ts / state.ts). */
const proposal = (o: { id?: string; ownerId?: string; createdBy?: string; origin?: string; replacesJobId?: string; missedRule?: string; status?: string } = {}) => ({
  id: o.id ?? 'jobsx_proposal_1', createdAt: AT, createdBy: o.createdBy ?? 'owner', origin: o.origin ?? 'person', ...(o.replacesJobId ? { replacesJobId: o.replacesJobId } : {}),
  template: 'receivables-week', sentence: 'Tell me every Monday who owes me money.',
  card: {
    template: 'receivables-week', title: 'Who owes you, every week', goal: 'Work out who owes you money and remind those who agreed.', finishedWhen: 'Every overdue invoice is reminded, paid or asked about, and you accept the round.',
    ownerId: o.ownerId ?? 'owner', budgetMinor: '5000', reserveMinor: '50', stopRule: { maxRuns: 12, deadline: '2027-01-06T05:00:00.000Z' }, extraStopRules: { failures: 3 },
    intervalMs: 86_400_000, nextRunAt: AT, missedRule: o.missedRule ?? 'once', stepsPerDelivery: 7, allowedActions: ['writeback.followUp'], testedRoutes: [],
    reviewDate: '2027-01-06', computer: 'this-computer', background: false,
    steps: [{ kind: 'calculate', title: 'Who owes and how late', needsModel: false }, { kind: 'action', title: 'Prepare a reminder for each who agreed', needsModel: false }],
    sourceIds: ['src-1'],
  },
  digest: 'd'.repeat(64), status: o.status ?? 'proposed', evidence: ['3 invoices are overdue.'], sourceIds: ['src-1'],
});

test('a jobs-ext proposal waits in the one queue as proposal:<id>, tier 2, with its card; approving calls jobsx.approveProposal with its digest', async () => {
  let open = true;
  const f = fixture({
    'jobsx.proposals': () => (open ? [proposal(), { ...proposal({ id: 'jobsx_proposal_bad' }), card: { title: 'no fields' } }] : []),
    'jobsx.approveProposal': () => { open = false; return { proposal: { ...proposal(), status: 'approved', jobId: 'job_new' }, job: { id: 'job_new', status: 'scheduled' } }; },
  });
  const list = await f.request(owner, 'approvals.list');
  // The malformed proposal is left out, never guessed.
  assert.deepEqual(list.items.map((r: any) => [r.id, r.source, r.kind, r.tier, r.title, r.amount, r.preparedBy]), [
    ['proposal:jobsx_proposal_1', 'proposal', 'job', 'tier-2', 'Start job: Who owes you, every week', { minor: '5000' }, { kind: 'person', name: 'Workspace owner' }]]);
  assert.equal(list.counts.tier2, 1);
  const sheet = await f.request(owner, 'approvals.get', { id: 'proposal:jobsx_proposal_1' });
  assert.deepEqual([sheet.reason, sheet.digest, sheet.can, sheet.needsSecondAsk, sheet.steps[1].state, sheet.blocked], ['job-approval', 'd'.repeat(64), ['approve', 'notNow', 'drop'], false, 'waiting-for-you', undefined]);
  assert.deepEqual([sheet.job.goal, sheet.job.doneWhen, sheet.job.budget, sheet.job.reserve, sheet.job.stopRule.maxRuns, sheet.job.actions, sheet.job.reviewOn, sheet.job.missedRun, sheet.job.untrustedInstructions],
    ['Work out who owes you money and remind those who agreed.', 'Every overdue invoice is reminded, paid or asked about, and you accept the round.', { minor: '5000' }, { minor: '50' }, 12, ['writeback.followUp'], '2027-01-06', 'run-once-on-wake', false]);
  assert.deepEqual(sheet.change.fields.map((x: any) => x.name), ['goal', 'step 1', 'step 2']);
  assert.equal(sheet.change.fields[1].after, 'Who owes and how late');
  assert.deepEqual(list.items[0].what, { kind: 'start-job', name: 'Who owes you, every week' });
  // A changed digest is refused here, before jobs-ext is asked.
  await assert.rejects(f.request(owner, 'approvals.approve', { id: 'proposal:jobsx_proposal_1', digest: 'e'.repeat(64) }), code('PREVIEW_CHANGED'));
  assert.ok(!f.calls.some(c => c.method === 'jobsx.approveProposal'));
  const done = await f.request(owner, 'approvals.approve', { id: 'proposal:jobsx_proposal_1', digest: 'd'.repeat(64) });
  assert.deepEqual(f.calls.filter(c => c.method === 'jobsx.approveProposal').map(c => c.payload), [{ id: 'jobsx_proposal_1', digest: 'd'.repeat(64) }]);
  assert.deepEqual([done.state, done.can, done.approvedJobId, done.steps[1].state], ['verified', [], 'job:job_new', 'done']);
  assert.deepEqual((await f.request(owner, 'approvals.list')).items, []);
});

test('only the card owner approves a proposal: another seat sees it blocked; an accountant sees it read only', async () => {
  const f = fixture({ 'jobsx.proposals': () => [proposal({ createdBy: 'cofounder', ownerId: 'owner' })], 'jobsx.approveProposal': () => { throw new Error('must not be called'); } });
  const theirs = await f.request(cofounder, 'approvals.get', { id: 'proposal:jobsx_proposal_1' });
  assert.deepEqual([theirs.blocked, theirs.can, theirs.preparedBy], [{ kind: 'owner-approves', code: 'JOB_OWNER_REQUIRED' }, ['notNow', 'drop'], { kind: 'person', name: 'Chitra Cofounder' }]);
  await assert.rejects(f.request(cofounder, 'approvals.approve', { id: 'proposal:jobsx_proposal_1', digest: 'd'.repeat(64) }), code('JOB_OWNER_REQUIRED'));
  const reader = await f.request(accountant, 'approvals.get', { id: 'proposal:jobsx_proposal_1' });
  assert.deepEqual([reader.readOnly, reader.can, reader.blocked], [true, [], { kind: 'owner-approves', code: 'OWNER_APPROVES' }]);
});

test('Drop dismisses a proposal through jobsx.dismissProposal; an edit names the job it replaces and run-all is named in the change', async () => {
  let open = true;
  const f = fixture({
    'jobsx.proposals': () => (open ? [proposal({ origin: 'edit', replacesJobId: 'job_old', missedRule: 'all' })] : []),
    'jobsx.dismissProposal': p => { open = false; return { ...proposal(), id: p.id, status: 'dismissed', decidedAt: AT }; },
  });
  const sheet = await f.request(owner, 'approvals.get', { id: 'proposal:jobsx_proposal_1' });
  assert.equal(sheet.title, 'Change job: Who owes you, every week');
  assert.deepEqual(sheet.change.fields.slice(0, 3).map((x: any) => [x.name, x.after]), [['goal', 'Work out who owes you money and remind those who agreed.'], ['replaces job', 'job_old'], ['missed run', 'run every missed one']]);
  assert.deepEqual(await f.request(owner, 'approvals.drop', { id: 'proposal:jobsx_proposal_1' }), { id: 'proposal:jobsx_proposal_1', state: 'cancelled' });
  assert.deepEqual(f.calls.filter(c => c.method === 'jobsx.dismissProposal').map(c => c.payload), [{ id: 'jobsx_proposal_1' }]);
  await assert.rejects(f.request(owner, 'approvals.change', { id: 'proposal:jobsx_proposal_1', payload: {} }), code('NOT_FOUND'));
});

test('without jobsx.proposals no proposal row is listed and no jobs-ext method is called; a proposal id is not found', async () => {
  const f = fixture({});
  assert.deepEqual((await f.request(owner, 'approvals.list')).items, []);
  assert.deepEqual(jobsxCalls(f.calls), []);
  await assert.rejects(f.request(owner, 'approvals.get', { id: 'proposal:jobsx_proposal_1' }), code('NOT_FOUND'));
  // A refused read leaves the queue as the core sees it.
  const g = fixture({ 'jobsx.proposals': () => { throw new ChausarError('FORBIDDEN', 'No.'); } });
  assert.deepEqual((await g.request(owner, 'approvals.list')).items, []);
});

test('one sentence: the reply is proposal:<id>, and that id opens the proposal in the queue', async () => {
  const f = fixture({ 'jobsx.propose': p => ({ ...proposal(), sentence: p.sentence }), 'jobsx.proposals': () => [proposal()] });
  const out = await f.request(owner, 'approvals.proposeJob', { sentence: 'Tell me every Monday who owes me money.' });
  assert.deepEqual(out, { id: 'proposal:jobsx_proposal_1', proposal: { id: 'jobsx_proposal_1', digest: 'd'.repeat(64) } });
  assert.equal((await f.request(owner, 'approvals.get', { id: out.id })).source, 'proposal');
  // A reply that is not a waiting proposal is refused, never passed on.
  const g = fixture({ 'jobsx.propose': () => ({ ...proposal(), status: 'approved' }) });
  await assert.rejects(g.request(owner, 'approvals.proposeJob', { sentence: 'Tell me every Monday who owes me money.' }), code('INVALID_JOB_REPLY'));
});

/** `jobsx.get` with one open question (`LaneQuestion`, kind 'question' in waitingForYou). */
const withQuestion = (jobId: string, suggested?: { option: string; confidence: number }) => ({
  id: jobId, title: 'Who owes you, every week', state: 'waiting-for-you', status: 'scheduled', facts: { progress: { stepsPerDelivery: 7 } }, steps: [], timeline: [], missedRule: 'once', leftUndone: [],
  waitingForYou: [{ kind: 'question', id: 'jobsx_question_1', jobId, caseId: 'inv-7', askedAt: AT, prompt: 'Invoice INV-7 is long overdue. Remind, stop or call?', options: ['remind', 'stop', 'call'], ...(suggested ? { suggested } : {}), status: 'open', sourceIds: ['src-1'] }],
});

test('WK-08 a lane job\'s question carries its options and the rule\'s pick in whole percent, and is answered through jobsx.answer', async () => {
  const f = fixture({
    'jobsx.get': p => withQuestion(p.id, { option: 'call', confidence: 0.5 }),
    'jobsx.answer': p => ({ id: p.questionId, jobId: 'x', askedAt: AT, prompt: 'Invoice INV-7 is long overdue. Remind, stop or call?', options: ['remind', 'stop', 'call'], status: 'answered', answer: p.option, answeredBy: 'owner', answeredAt: AT, sourceIds: [] }),
    'jobsx.accept': () => ({}),
  });
  const id = await f.job('jobsx-receivables-week');
  const sheet = await f.request(owner, 'approvals.job', { id });
  assert.deepEqual(sheet.jobsx.questions, [{ id: 'jobsx_question_1', prompt: 'Invoice INV-7 is long overdue. Remind, stop or call?', options: ['remind', 'stop', 'call'], askedAt: AT, suggested: { option: 'call', percent: 50 } }]);
  assert.deepEqual([sheet.manage.answer, sheet.manage.accept], ['jobsx', 'jobsx']);
  await assert.rejects(f.request(owner, 'approvals.answerQuestion', { jobId: id, questionId: 'jobsx_question_1', option: 'ignore' }), code('INVALID_ANSWER'));
  await assert.rejects(f.request(owner, 'approvals.answerQuestion', { jobId: id, questionId: 'jobsx_question_9', option: 'call' }), code('NOT_FOUND'));
  assert.ok(!f.calls.some(c => c.method === 'jobsx.answer'));
  assert.deepEqual(await f.request(owner, 'approvals.answerQuestion', { jobId: id, questionId: 'jobsx_question_1', option: 'call' }), { jobId: id, questionId: 'jobsx_question_1', answer: 'call', answeredAt: AT });
  assert.deepEqual(f.calls.filter(c => c.method === 'jobsx.answer').map(c => c.payload), [{ questionId: 'jobsx_question_1', option: 'call' }]);
  // A viewer cannot answer (approve permission).
  await assert.rejects(f.request({ memberId: 'v', role: 'viewer', epoch: 1 } as Context, 'approvals.answerQuestion', { jobId: id, questionId: 'jobsx_question_1', option: 'call' }));
});

test('a question cannot be answered for a core job or without jobsx.answer: QUESTION_ANSWER_NOT_BUILT; a suggestion outside the options is dropped', async () => {
  const f = fixture({ 'jobsx.get': p => withQuestion(p.id, { option: 'wait', confidence: 1 }) });
  const lane = await f.job('jobsx-receivables-week');
  assert.equal((await f.request(owner, 'approvals.job', { id: lane })).jobsx.questions[0].suggested, null);
  await assert.rejects(f.request(owner, 'approvals.answerQuestion', { jobId: lane, questionId: 'jobsx_question_1', option: 'call' }), code('QUESTION_ANSWER_NOT_BUILT'));
  const core = await f.job('owner-brief');
  await assert.rejects(f.request(owner, 'approvals.answerQuestion', { jobId: core, questionId: 'jobsx_question_1', option: 'call' }), code('QUESTION_ANSWER_NOT_BUILT'));
  await assert.rejects(f.request(owner, 'approvals.answerQuestion', { jobId: core, questionId: 'q', option: 'call', extra: 1 }), code('INVALID_JOB_CHANGE'));
});

test('WK-10 a lane job\'s result is accepted through jobsx.accept with the exact reference, and sent back through jobsx.reject', async () => {
  const f = fixture({ 'jobsx.accept': () => ({ status: 'accepted' }), 'jobsx.reject': () => ({ status: 'paused' }) });
  const id = await f.job('jobsx-weekly-close'); await f.deliver(id);
  const sheet = await f.request(owner, 'approvals.job', { id });
  assert.equal(sheet.acceptance.id, `acceptance:${id}`);
  const item = await f.request(owner, 'approvals.get', { id: `acceptance:${id}` });
  assert.equal(sheet.acceptance.digest, item.digest);
  await f.request(owner, 'approvals.approve', { id: `acceptance:${id}`, digest: item.digest });
  const accept = f.calls.filter(c => c.method === 'jobsx.accept');
  assert.equal(accept.length, 1);
  assert.deepEqual(Object.keys(accept[0].payload), ['id', 'reference']);
  assert.deepEqual([accept[0].payload.id, accept[0].payload.reference.kind, accept[0].payload.reference.id, accept[0].payload.reference.revision], [id, 'job-acceptance', id, 1]);
  assert.match(accept[0].payload.reference.deliverableDigest, /^[a-f0-9]{64}$/);
  assert.ok(!f.calls.some(c => c.method === 'jobs.accept'));
  // Send back with a sentence of the person's own.
  assert.deepEqual(await f.request(owner, 'approvals.sendBack', { id: `job:${id}`, reason: 'The margin is missing.' }), { id, state: 'rejected', via: 'jobsx' });
  assert.deepEqual(f.calls.filter(c => c.method === 'jobsx.reject').map(c => c.payload), [{ id, reason: 'The margin is missing.' }]);
  await assert.rejects(f.request(owner, 'approvals.sendBack', { id, reason: '  ' }), code('INVALID_JOB_CHANGE'));
});

test('a core job keeps core jobs.accept / jobs.reject / jobs.pause / jobs.resume even with jobs-ext installed', async () => {
  const f = fixture({ 'jobsx.accept': () => { throw new Error('no'); }, 'jobsx.reject': () => { throw new Error('no'); }, 'jobsx.pause': () => { throw new Error('no'); }, 'jobsx.resume': () => { throw new Error('no'); },
    'jobs.accept': () => ({}), 'jobs.reject': () => ({}), 'jobs.pause': () => ({}), 'jobs.resume': () => ({}) });
  const id = await f.job('owner-brief'); await f.deliver(id);
  const item = await f.request(owner, 'approvals.get', { id: `acceptance:${id}` });
  await f.request(owner, 'approvals.approve', { id: `acceptance:${id}`, digest: item.digest });
  assert.deepEqual(f.calls.filter(c => c.method === 'jobs.accept').map(c => Object.keys(c.payload)), [['id', 'reference']]);
  assert.deepEqual((await f.request(owner, 'approvals.sendBack', { id, reason: 'Not yet.' })).via, 'core');
  assert.deepEqual(await f.request(owner, 'approvals.pauseJob', { id }), { id, via: 'core' });
  assert.deepEqual(await f.request(owner, 'approvals.resumeJob', { id }), { id, via: 'core' });
  assert.deepEqual(jobsxCalls(f.calls), []);
});

test('pause and resume of a lane job go to jobsx.pause / jobsx.resume; the acceptance field is null while nothing is delivered', async () => {
  const f = fixture({ 'jobsx.pause': () => ({}), 'jobsx.resume': () => ({}) });
  const id = await f.job('jobsx-weekly-close');
  assert.equal((await f.request(owner, 'approvals.job', { id })).acceptance, null);
  assert.deepEqual(await f.request(owner, 'approvals.pauseJob', { id }), { id, via: 'jobsx' });
  assert.deepEqual(await f.request(owner, 'approvals.resumeJob', { id: `job:${id}` }), { id, via: 'jobsx' });
  assert.deepEqual(jobsxCalls(f.calls), [['jobsx.pause', { id }], ['jobsx.resume', { id }]]);
  await assert.rejects(f.request(owner, 'approvals.pauseJob', { id: 'job_missing' }), code('NOT_FOUND'));
});

test('WK-08/WK-10: a lane job\'s taint mark, next runs and recommendations are carried; queue rows name what they are for the screen\'s words', async () => {
  const f = fixture({
    'jobsx.get': p => ({ ...withQuestion(p.id), waitingForYou: [], tainted: true, next: { nextRunAt: AT, upcoming: [AT, '2026-10-15T05:00:00.000Z', 'not a time'] } }),
    'jobsx.result': p => ({ jobId: p.id, deliveredAt: AT, done: ['Reminded 2 customers.'], open: [], recommendations: ['Record each customer’s agreement to reminders when they give it.'], figures: [], receiptIds: [] }),
  });
  const id = await f.job('jobsx-receivables-week');
  const sheet = await f.request(owner, 'approvals.job', { id });
  assert.deepEqual([sheet.jobsx.tainted, sheet.jobsx.upcoming], [true, [AT, '2026-10-15T05:00:00.000Z']]);
  assert.deepEqual(sheet.result.recommends, ['Record each customer’s agreement to reminders when they give it.']);
  const core = await f.job('owner-brief'); await f.deliver(core);
  const list = await f.request(owner, 'approvals.list');
  assert.deepEqual(list.items.map((r: any) => r.what), [{ kind: 'accept-result', name: 'Close the week: net sales, margin and what customers owe.' }]);
  assert.equal((await f.request(owner, 'approvals.get', { id: `acceptance:${core}` })).change.key, 'acceptance');
});
