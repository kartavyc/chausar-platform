import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, check, ChausarError, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import type { Connector, Operation } from '../runtime/actions.ts';
import { JobService } from '../runtime/jobs.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { workMethods } from '../runtime/work-books/work.ts';

// Round 4 for Work, with every other lane stubbed through `hasMethod` and the host dispatcher (all values synthetic):
// jobs-ext ready-made jobs, core practice, grouped steps, the own-secret second ask, reminders, deletion.reapply,
// child task results, a core person step done, per-route meters and the core review date.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic round-four shop', true); }
  read() { return this.state; }
  private tail: Promise<unknown> = Promise.resolve();
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.tail.then(async () => { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; });
    this.tail = run.catch(() => undefined); return run;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
type Handler = (payload: any, ctx: Context) => unknown;

function fixture(handlers: Record<string, Handler> = {}) {
  const store = new TestStore();
  const fake = { executions: 0 };
  const op = (impact: Operation['impact'], title: string): Operation => ({
    title, description: `${title} in the synthetic books app.`, impact, idempotency: 'The key names one record.', readback: 'Reads the record by key.',
    validate: payload => { check(payload !== null && typeof payload === 'object' && typeof (payload as any).customerId === 'string', 'INVALID_ACTION', 'Name the customer.'); return payload as Record<string, unknown>; },
    execute: async (_payload, key) => { fake.executions += 1; return { externalId: key }; },
    reconcile: async () => ({ verified: true, businessSuccess: true, absent: false }),
  });
  const connector: Connector = { id: 'books-app', title: 'Synthetic books app', operations: { note: op('reversible', 'Add a note'), pay: op('money', 'Pay a supplier'), remind: op('message', 'Send a reminder') } };
  const actions = new ActionService(store, [connector]); const jobs = new JobService(store);
  const calls: { method: string; payload: any }[] = [];
  const host = (ctx: Context): ModuleHost => ({
    store, services: { actions, jobs }, demo: true, directory: '/tmp/x', options: { hasMethod: (name: string) => Object.hasOwn(handlers, name) },
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
  const prepare = (operation: string, payload: Record<string, unknown>) => actions.prepare(owner, { connector: 'books-app', operation, payload, idempotencyKey: `key-${operation}-${Math.random()}`, sourceIds: ['sheet'] });
  return { store, calls, fake, request, prepare };
}

/** A row in jobs-ext's real `jobsx.types` shape (platform/runtime/jobs-ext/methods.ts), synthetic values. */
const laneType = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Synthetic ${id}`, goal: `Do ${id} for the synthetic shop.`, finishedWhen: 'You accept the result.', intervalMs: 86_400_000, stepsPerDelivery: 1,
  missedRule: 'once', budgetMinor: '5000', allowedActions: ['mail.smtp.send'], experimental: false, skillPath: `${id}/SKILL.md`, available: true,
  steps: [{ kind: 'calculate', title: 'Work out the figure', needsModel: false }, { kind: 'lookup', title: 'Ask the agent when unsure', needsModel: true }], ...extra,
});

test('WK-09: jobs-ext ready-made jobs are listed beside the core briefs and proposed as a card read back by its digest', async () => {
  const proposed: any[] = [];
  const f = fixture({
    'jobsx.types': () => ({ templates: [laneType('cash-position'), laneType('stock-check', { available: false, code: 'TEMPLATE_CALCULATION_MISSING' }), laneType('agent-task'), { id: 'broken' }], activeJobs: 1, activeJobCap: 10 }),
    'jobsx.propose': p => { proposed.push(p); return { id: 'jobsx_proposal_1', status: 'proposed', digest: 'd'.repeat(64), card: {} }; },
    'jobsx.card': p => ({ card: { title: 'x' }, digest: p.proposalId === 'jobsx_proposal_1' ? 'd'.repeat(64) : 'e'.repeat(64) }),
  });
  const list = await f.request(owner, 'approvals.jobTemplates');
  assert.equal(list.templates.length, 3, 'the core briefs stay');
  assert.equal(list.lane.available, true); assert.equal(list.lane.activeJobs, 1); assert.equal(list.lane.activeJobCap, 10);
  assert.deepEqual(list.lane.templates.map((t: any) => [t.id, t.available, t.code]), [['cash-position', true, null], ['stock-check', false, 'TEMPLATE_CALCULATION_MISSING']], 'the sentence job and a malformed row are left out');
  const cash = list.lane.templates[0];
  assert.deepEqual([cash.every, cash.missedRun, cash.budget, cash.needsModel, cash.doneWhen], ['day', 'run-once-on-wake', { minor: '5000' }, true, 'You accept the result.']);
  const reply = await f.request(owner, 'approvals.proposeJob', { laneTemplate: 'cash-position', budgetMinor: '6000', missedRun: 'skip' });
  assert.deepEqual(reply, { id: 'proposal:jobsx_proposal_1', proposal: { id: 'jobsx_proposal_1', digest: 'd'.repeat(64) }, laneTemplate: 'cash-position' });
  assert.deepEqual(proposed[0], { template: 'cash-position', overrides: { budgetMinor: '6000', missedRule: 'skip' } });
  assert.deepEqual(f.calls.filter(c => c.method === 'jobsx.card').map(c => c.payload), [{ proposalId: 'jobsx_proposal_1' }]);
  await assert.rejects(f.request(owner, 'approvals.proposeJob', { laneTemplate: 'cash-position', budgetMinor: '50001' }), code('INVALID_BUDGET'));
  await assert.rejects(f.request(owner, 'approvals.proposeJob', { laneTemplate: 'stock-check' }), code('TEMPLATE_CALCULATION_MISSING'));
  await assert.rejects(f.request(owner, 'approvals.proposeJob', { laneTemplate: 'agent-task' }), code('TEMPLATE_NOT_FOUND'));
  await assert.rejects(f.request(owner, 'approvals.proposeJob', { laneTemplate: 'cash-position', templateId: 'daily-brief' }), code('INVALID_JOB_PROPOSAL'));
  assert.equal(proposed.length, 1, 'nothing is proposed before the checks pass');
});

test('WK-09: a card whose digest does not match is refused; without jobs-ext the lane list is not built', async () => {
  const f = fixture({
    'jobsx.types': () => ({ templates: [laneType('cash-position')] }),
    'jobsx.propose': () => ({ id: 'jobsx_proposal_2', status: 'proposed', digest: 'd'.repeat(64) }),
    'jobsx.card': () => ({ card: {}, digest: 'e'.repeat(64) }),
  });
  await assert.rejects(f.request(owner, 'approvals.proposeJob', { laneTemplate: 'cash-position' }), code('INVALID_JOB_REPLY'));
  const none = fixture();
  assert.deepEqual((await none.request(owner, 'approvals.jobTemplates')).lane, { available: false, templates: [], activeJobs: null, activeJobCap: null });
  await assert.rejects(none.request(owner, 'approvals.proposeJob', { laneTemplate: 'cash-position' }), code('LANE_TEMPLATES_NOT_BUILT'));
});

test('WK-02: practice for a core action checks the exact request with its own validate and never runs it', async () => {
  const f = fixture();
  const pay = await f.prepare('pay', { customerId: 'supplier-b', amountMinor: '250000' });
  const practice = await f.request(owner, 'approvals.practice', { id: `action:${pay.id}` });
  assert.equal(practice.practice, true); assert.equal(practice.available, true); assert.equal(practice.mode, 'checked-not-run'); assert.equal(practice.outcome, 'checked-not-run');
  assert.deepEqual(practice.request, { customerId: 'supplier-b', amountMinor: '250000' }); assert.equal(practice.requests, 0);
  assert.deepEqual(practice.steps.map((s: any) => s.state), ['done', 'done', 'not-reached', 'not-reached', 'not-reached']);
  const remind = await f.prepare('remind', { customerId: 'customer-a', text: 'Your invoice is due.' });
  assert.equal((await f.request(owner, 'approvals.practice', { id: `action:${remind.id}` })).wouldSend, 'Your invoice is due.', 'a message shows the text exactly as it would go');
  // A request its own operation refuses is shown refused, with the code; the action stays prepared.
  await f.store.update(state => { state.actions.find((a: any) => a.id === pay.id).payload = { amountMinor: '250000' }; });
  const refused = await f.request(owner, 'approvals.practice', { id: `action:${pay.id}` });
  assert.deepEqual([refused.outcome, refused.code], ['refused', 'INVALID_ACTION']);
  assert.deepEqual(refused.steps.map((s: any) => s.state), ['done', 'stopped-by-rule', 'not-reached', 'not-reached', 'not-reached']);
  assert.equal(f.fake.executions, 0); assert.equal(f.store.read().actions.find((a: any) => a.id === pay.id).status, 'prepared');
  const unknown = await f.request(owner, 'approvals.practice', { id: 'job:nothing' }).catch((e: any) => e);
  assert.equal(unknown.code, 'NOT_FOUND');
});

test('WK-03: each grouped item carries its own five steps after the approval', async () => {
  const f = fixture();
  const a = await f.prepare('note', { customerId: 'customer-a', text: 'Prefers mail' });
  const b = await f.prepare('note', { customerId: 'customer-b', text: 'Call after 5' });
  const group = await f.request(owner, 'approvals.group', { ids: [`action:${a.id}`, `action:${b.id}`] });
  const out = await f.request(owner, 'approvals.approveGroup', { items: [{ id: `action:${a.id}`, digest: group.items[0].digest }, { id: `action:${b.id}`, digest: 'f'.repeat(64) }] });
  assert.deepEqual(out.results[0].steps.map((s: any) => s.state), ['done', 'done', 'waiting-for-you', 'not-reached', 'not-reached']);
  assert.equal(out.results[1].code, 'PREVIEW_CHANGED');
  assert.deepEqual(out.results[1].steps.map((s: any) => s.state), ['done', 'waiting-for-you', 'not-reached', 'not-reached', 'not-reached']);
});

test('second ask: a core money action asks for a secret through secondAsk.grant when core-gateway-auth serves it, else the typed amount', async () => {
  const typed = fixture();
  const pay0 = await typed.prepare('pay', { customerId: 'supplier-b', amountMinor: '250000' });
  const sheet0 = await typed.request(owner, 'approvals.get', { id: `action:${pay0.id}` });
  assert.deepEqual(sheet0.secondAsk, { by: 'typed-amount' });
  await assert.rejects(typed.request(owner, 'approvals.approve', { id: `action:${pay0.id}`, digest: sheet0.digest, secondAsk: true, reauth: 'x' }), code('INVALID_APPROVAL'));
  const grants: any[] = []; let locked = false;
  const f = fixture({
    'secondAsk.status': () => ({ expects: 'passphrase' }),
    'secondAsk.grant': p => { if (locked) throw new ChausarError('SECOND_ASK_LOCKED', 'Wait.'); grants.push(p); if (p.secret !== 'synthetic passphrase') throw new ChausarError('SECOND_ASK_WRONG', 'No.'); return { granted: true, expiresAt: '2026-10-15T10:05:00.000Z' }; },
  });
  const pay = await f.prepare('pay', { customerId: 'supplier-b', amountMinor: '250000' }); const id = `action:${pay.id}`;
  const sheet = await f.request(owner, 'approvals.get', { id });
  assert.deepEqual(sheet.secondAsk, { by: 'passphrase', whose: 'vault-passphrase' });
  await assert.rejects(f.request(owner, 'approvals.approve', { id, digest: sheet.digest, secondAsk: true }), code('REAUTH_REQUIRED'));
  await assert.rejects(f.request(owner, 'approvals.approve', { id, digest: sheet.digest, secondAsk: true, reauth: 'wrong' }), code('SECOND_ASK_WRONG'));
  locked = true;
  await assert.rejects(f.request(owner, 'approvals.approve', { id, digest: sheet.digest, secondAsk: true, reauth: 'synthetic passphrase' }), code('SECOND_ASK_LOCKED'));
  locked = false;
  assert.equal(f.store.read().actions.find((a: any) => a.id === pay.id).status, 'prepared');
  const approved = await f.request(owner, 'approvals.approve', { id, digest: sheet.digest, secondAsk: true, reauth: 'synthetic passphrase' });
  assert.equal(approved.state, 'approved');
  assert.deepEqual(grants.at(-1), { target: { kind: 'action', id: pay.id, digest: sheet.digest }, secret: 'synthetic passphrase' });
  assert.equal(JSON.stringify(f.store.read()).includes('synthetic passphrase'), false, 'the secret is never kept');
  // A co-founder's own approval secret, as secondAsk.status says.
  const member = fixture({ 'secondAsk.status': () => ({ expects: 'member-secret' }), 'secondAsk.grant': () => ({ granted: true }) });
  const pay2 = await member.prepare('pay', { customerId: 'supplier-b', amountMinor: '1' });
  assert.deepEqual((await member.request(owner, 'approvals.get', { id: `action:${pay2.id}` })).secondAsk, { by: 'passphrase', whose: 'own-secret' });
  // core-gateway-auth's final status: `expects: 'none'` means this seat has no approval secret yet: no field, set it first.
  const unset = fixture({ 'secondAsk.status': () => ({ by: 'none', expects: 'none', secretSet: false, lockedUntil: null }), 'secondAsk.grant': () => ({ granted: true }) });
  const pay3 = await unset.prepare('pay', { customerId: 'supplier-c', amountMinor: '1' });
  const unsetSheet = await unset.request(owner, 'approvals.get', { id: `action:${pay3.id}` });
  assert.equal(unsetSheet.secondAsk.setFirst, true);
  await assert.rejects(unset.request(owner, 'approvals.approve', { id: `action:${pay3.id}`, digest: unsetSheet.digest, secondAsk: true, reauth: 'anything' }), code('APPROVAL_SECRET_NOT_SET'));
  assert.equal(unset.calls.filter(c => c.method === 'secondAsk.grant').length, 0, 'no grant is asked for a secret that does not exist');
  // Locked: the sheet says until when, and approving refuses before any secret is sent.
  const until = new Date(Date.now() + 15 * 60_000).toISOString();
  const lockedF = fixture({ 'secondAsk.status': () => ({ by: 'passphrase', expects: 'passphrase', secretSet: true, lockedUntil: until }), 'secondAsk.grant': () => ({ granted: true }) });
  const pay4 = await lockedF.prepare('pay', { customerId: 'supplier-d', amountMinor: '1' });
  const lockedSheet = await lockedF.request(owner, 'approvals.get', { id: `action:${pay4.id}` });
  assert.equal(lockedSheet.secondAsk.lockedUntil, until);
  await assert.rejects(lockedF.request(owner, 'approvals.approve', { id: `action:${pay4.id}`, digest: lockedSheet.digest, secondAsk: true, reauth: 'synthetic passphrase' }), code('SECOND_ASK_LOCKED'));
  assert.equal(lockedF.calls.filter(c => c.method === 'secondAsk.grant').length, 0);
  // A lock in the past is no lock.
  const past = fixture({ 'secondAsk.status': () => ({ by: 'passphrase', expects: 'passphrase', secretSet: true, lockedUntil: '2020-01-01T00:00:00.000Z' }), 'secondAsk.grant': () => ({ granted: true }) });
  const pay5 = await past.prepare('pay', { customerId: 'supplier-e', amountMinor: '1' });
  assert.deepEqual((await past.request(owner, 'approvals.get', { id: `action:${pay5.id}` })).secondAsk, { by: 'passphrase', whose: 'vault-passphrase' });
});

test('WK-12: the reminders view lists mail and WhatsApp connections, write-back’s day in its own time zone, and the reminders', async () => {
  const none = fixture();
  assert.deepEqual(await none.request(owner, 'approvals.reminders'), { available: false });
  const f = fixture({
    'writeback.followUp.prepare': () => { throw new ChausarError('FOLLOW_UP_NO_CONSENT', 'No.'); },
    'writeback.connections': () => [{ id: 'conn-mail', system: 'mail', label: 'Office mail', environment: 'practice', write: ['smtp.send'] }, { id: 'conn-tally', system: 'tally', label: 'Tally', environment: 'live', write: [] }, { id: 'conn-old', system: 'whatsapp', label: 'Old', environment: 'live', write: [], revokedAt: '2026-10-01T00:00:00.000Z' }],
    'writeback.caps': () => ({ settings: { reminderCapPerCustomer: 1, reminderCapPerDay: 20 }, timeZone: 'Asia/Kolkata', today: '2026-10-15', now: '2026-10-15T10:00:00.000Z', counts: { preparedToday: 3, sentToday: 1, customersToday: 2 } }),
    'writeback.ledger': () => [],
  });
  const view = await f.request(owner, 'approvals.reminders');
  assert.equal(view.available, true);
  assert.deepEqual(view.connections, [{ id: 'conn-mail', label: 'Office mail', system: 'mail', environment: 'practice' }]);
  assert.deepEqual(view.caps, { timeZone: 'Asia/Kolkata', today: '2026-10-15', preparedToday: 3, sentToday: 1, perCustomer: 1, perDay: 20 });
  assert.deepEqual(view.items, []);
  const blocked = await f.request(owner, 'approvals.prepareReminder', { connectionId: 'conn-mail', customerId: 'customer-a', invoiceId: 'INV-1' });
  assert.equal(blocked.blocked.code, 'FOLLOW_UP_NO_CONSENT');
  assert.ok(!f.calls.some(c => c.method === 'writeback.followUp.prepare' && c.payload.connectionId !== 'conn-mail'), 'the reminder goes only through the chosen connection');
});

test('WK-15: deleting again what a restore brought back goes to core-data, and says not built without it', async () => {
  const none = fixture();
  assert.deepEqual((await none.request(owner, 'approvals.afterRestore')).deletions, { available: false });
  await assert.rejects(none.request(owner, 'approvals.reapplyDeletions', { confirmation: 'Synthetic shop' }), code('DELETION_REAPPLY_NOT_BUILT'));
  const sent: any[] = [];
  const f = fixture({ 'deletion.pending': () => ({ registered: 3, kinds: [{ kind: 'customer', cameBack: 2 }], total: 2 }),
    'deletion.reapply': (p: any) => { sent.push(p); return { at: '2026-10-15T15:00:00.000Z', complete: false, kinds: [{ kind: 'customer', cameBack: 2, deleted: 1, remaining: 1, state: 'pending', reason: 'One row is held by a running job.' }] }; } });
  assert.deepEqual((await f.request(owner, 'approvals.afterRestore')).deletions, { available: true, cameBack: 2 });
  await assert.rejects(f.request(owner, 'approvals.reapplyDeletions'), code('INVALID_APPROVAL'), 'the workspace name must be typed');
  const again = await f.request(owner, 'approvals.reapplyDeletions', { confirmation: 'Synthetic shop' });
  assert.deepEqual(sent, [{ confirmation: 'Synthetic shop' }]);
  assert.deepEqual([again.reapplied, again.remaining, again.complete], [1, 1, false]);
  assert.equal(again.kinds[0].reason, 'One row is held by a running job.');
  const bad = fixture({ 'deletion.reapply': () => ({ reapplied: -1 }) });
  await assert.rejects(bad.request(owner, 'approvals.reapplyDeletions', { confirmation: 'x' }), code('INVALID_DELETION_REPLY'));
  await assert.rejects(f.request(owner, 'approvals.reapplyDeletions', { confirmation: 'x', all: true }), code('INVALID_APPROVAL'));
});

test('WK-08/WK-16: child task results, a core person step done, the review date, named actions and per-route meters for a core job', async () => {
  const f = fixture({
    'jobs.children': p => ({ items: [{ id: 'child-1', title: 'Invoice INV-1', state: 'done', result: { done: ['Reminder prepared'], open: [], receiptIds: ['r-1'] } }, { id: 'child-2', title: 'Invoice INV-2', state: 'failed', result: null }, { title: 'no id' }].map(c => ({ ...c, parent: p.id })) }),
    'jobs.personStep.done': p => f.store.update(state => { state.jobs.find((j: any) => j.id === p.id).ledger.push({ at: '2026-10-15T09:00:00.000Z', event: 'person-step-done', stepId: p.stepId, by: 'owner' }); return { ok: true }; }),
  });
  const id = (await f.request(owner, 'approvals.proposeJob', { templateId: 'daily-brief' })).id.slice(4);
  const pay = await f.prepare('pay', { customerId: 'supplier-b', amountMinor: '7000' });
  await f.store.update(state => {
    const job = state.jobs.find((j: any) => j.id === id);
    job.plan = { runnerVersion: '1', steps: [{ id: 'sign', provider: 'person', input: { what: 'Sign the bank form.', memberId: 'owner' } }], children: [], obligations: [] };
    job.reviewDate = '2026-11-15'; job.actionIds = [pay.id]; job.testedRoutes = ['local-llama', 'cloud-a'];
    job.ledger.push({ at: '2026-10-15T08:00:00.000Z', event: 'run', durationMs: 150_000 });
    state.routes = [{ id: 'local-llama', kind: 'ollama' }, { id: 'cloud-a', kind: 'openai-compatible' }] as any;
  });
  const sheet = await f.request(owner, 'approvals.job', { id });
  assert.equal(sheet.reviewOn, '2026-11-15');
  assert.deepEqual(sheet.meters.exposure, { minor: '7000' }); assert.deepEqual(sheet.meters.clock, { minutes: 3 });
  assert.deepEqual(sheet.routes, [{ routeId: 'local-llama', spent: { minor: '0' }, minutes: null, basis: 'zero', tested: true }, { routeId: 'cloud-a', spent: { missing: 'not-counted' }, minutes: null, basis: 'measured', tested: true }]);
  assert.equal(sheet.untestedStop, null);
  assert.deepEqual(sheet.children, { available: true, items: [
    { id: 'child-1', title: 'Invoice INV-1', state: 'done', result: { done: ['Reminder prepared'], open: [], receiptIds: ['r-1'] } },
    { id: 'child-2', title: 'Invoice INV-2', state: 'failed', result: null }] });
  assert.equal(sheet.manage.personStep, 'core');
  const done = await f.request(owner, 'approvals.personStepDone', { jobId: id, stepId: 'sign' });
  assert.deepEqual(done, { jobId: id, stepId: 'sign', done: true, doneAt: '2026-10-15T09:00:00.000Z', doneBy: 'Workspace owner' });
  assert.deepEqual(f.calls.filter(c => c.method === 'jobs.personStep.done').map(c => c.payload), [{ id, stepId: 'sign' }]);
  await assert.rejects(f.request(owner, 'approvals.personStepDone', { jobId: id, stepId: 'sign' }), code('PERSON_STEP_ALREADY_DONE'));
  const none = fixture();
  const other = (await none.request(owner, 'approvals.proposeJob', { templateId: 'daily-brief' })).id.slice(4);
  const plain = await none.request(owner, 'approvals.job', { id: other });
  assert.deepEqual(plain.children, { available: false }); assert.equal(plain.reviewOn, null); assert.deepEqual(plain.routes, []);
});

test('WK-14: the driving lane’s real session.* shapes: an idle status with its extra fields, a computer that cannot be driven, exports kept', async () => {
  // `publicStatus` and `session.windows` in the driving lane's module (lane-driving.ts), synthetic values.
  const idle = { state: 'idle', window: null, steps: [], reason: null, sessionId: null, plan: null, startedAt: null, exports: [], stopKey: 'Ctrl+Alt+Pause' };
  const off = fixture({ 'session.status': () => idle, 'session.windows': () => ({ windows: [], available: false, code: 'DRIVER_UNAVAILABLE', reason: 'Driving works only in the installed desktop app.' }) });
  const status = await off.request(owner, 'approvals.drivingStatus');
  assert.equal(status.available, true); assert.deepEqual(status.windows, []); assert.deepEqual(status.driver, { available: false, code: 'DRIVER_UNAVAILABLE' });
  assert.deepEqual(status.status, { state: 'idle', window: null, steps: [], reason: null });
  const done = { ...idle, state: 'done', window: { id: 'w1', title: 'Tally Prime' }, sessionId: 'drive_0123456789abcdef01', plan: 'window.picture', startedAt: '2026-10-15T10:00:00.000Z',
    steps: [{ at: '2026-10-15T10:00:01.000Z', text: 'Saved a picture of the window', state: 'done' }], exports: [{ id: 'export_0123456789abcdef01', name: 'window.png', bytes: 1200 }] };
  const on = fixture({ 'session.status': () => done, 'session.windows': () => ({ windows: [{ id: 'w1', title: 'Tally Prime', app: 'tally' }], available: true, code: null, reason: null }) });
  const after = await on.request(owner, 'approvals.drivingStatus');
  assert.deepEqual(after.driver, { available: true, code: null });
  assert.deepEqual(after.status.exports, [{ id: 'export_0123456789abcdef01', name: 'window.png', bytes: 1200 }]);
  assert.equal(after.status.steps.length, 1);
});
