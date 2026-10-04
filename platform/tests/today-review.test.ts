import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, check, hash } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService, digest } from '../runtime/actions.ts';
import type { Connector, PreparedAction } from '../runtime/actions.ts';
import { JobService } from '../runtime/jobs.ts';
import type { Job } from '../runtime/jobs.ts';
import { createEngineLessonService } from '../runtime/engine-lessons.ts';
import { TodayReviewService, TODAY_REVIEW_SCOPE } from '../runtime/today-review.ts';
import type { LessonEvaluationAuthority, LessonTargetAuthority } from '../runtime/lesson-contracts.ts';

class Store implements StateStore {
  state = initialState('Synthetic source review boundaries', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const state = this.read(), result = await change(state); state.revision += 1; this.state = state; return structuredClone(result);
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const clock = () => Date.parse('2026-10-04T00:00:00.000Z');
function setup(guard: ((context: Context, job: Job, view?: StateStore) => boolean) | undefined = () => true) {
  const store = new Store(); let write = true, read = true, effects = 0;
  const connector: Connector = { id: 'synthetic', title: 'Synthetic local operation', operations: { preview: {
    title: 'Same visible label', description: 'Boundary fixture; never executes during these tests.', impact: 'money', idempotency: 'Exact stable key', readback: 'Saved local record',
    validate: payload => payload as Record<string, unknown>,
    authorize: (_state, _context, mode) => { check(mode === 'read' ? read : write, 'FORBIDDEN', 'Synthetic current operation grant refused.'); },
    execute: async () => { effects += 1; throw new Error('Queue reads must not execute effects.'); }, reconcile: async () => { effects += 1; throw new Error('Queue reads must not reconcile.'); },
  } } };
  const actions = new ActionService(store, [connector]), jobs = new JobService(store, { clock, ...(guard ? { deliverableGuard: guard } : {}) });
  // Empty namespace with installed synthetic authorities, not invented results.
  const targets: LessonTargetAuthority = { authorityRevision: () => 'synthetic-empty-targets-v1', resolve: () => { throw new Error('No synthetic personal targets are configured.'); }, validateChange: () => { throw new Error('No changes configured.'); } };
  const evaluations: LessonEvaluationAuthority = { authorityRevision: () => 'synthetic-empty-evaluations-v1', resolve: () => { throw new Error('No evaluation runs configured.'); }, assertSourceAccess: () => { throw new Error('No evaluation sources configured.'); } };
  const lessons = { service: createEngineLessonService(store, { targets, evaluations, evidenceResolver: () => { throw new Error('No retained lesson evidence.'); } }), targets, evaluations };
  const review = new TodayReviewService(store, { actions, jobs, lessons });
  const prepare = (id: string, sourceIds: string[] = []) => actions.prepare(owner, { connector: 'synthetic', operation: 'preview', payload: { label: id }, idempotencyKey: `synthetic-${id}`, sourceIds });
  const config = { goal: 'Same visible label', sourceIds: [], budgetMinor: '100', reserveMinor: '10', stopRule: { maxRuns: 2, deadline: '2026-10-06T00:00:00.000Z' }, intervalMs: 60000, nextRunAt: '2026-10-04T00:00:00.000Z', catchup: 'latest' as const, graceMs: 0, requiresApproval: true };
  return { store, actions, jobs, lessons, review, prepare, config, authorityRevision: () => hash({ read, write }), write: (value: boolean) => { write = value; }, read: (value: boolean) => { read = value; }, effects: () => effects };
}

test('one authorized set yields seven, first four, every continuation row and no read mutations', async () => {
  const f = setup(); for (let i = 0; i < 7; i++) await f.prepare(`queue-${i}`);
  const before = hash(f.store.read()), first = f.review.list(owner);
  assert.equal(first.scope, TODAY_REVIEW_SCOPE); assert.equal(first.completeness, 'complete'); assert.equal(first.count, 7); assert.equal(first.knownCount, 7);
  assert.equal(first.rows.length, 4); assert.ok(first.nextCursor);
  const remainder = f.review.list(owner, { cursor: first.nextCursor, limit: 2 });
  assert.equal(remainder.count, 7); assert.equal(remainder.rows.length, 2); assert.ok(remainder.nextCursor);
  const last = f.review.list(owner, { cursor: remainder.nextCursor, limit: 100 });
  assert.equal(last.rows.length, 1); assert.equal(last.nextCursor, null);
  assert.equal(new Set([...first.rows, ...remainder.rows, ...last.rows].map(row => row.reference.id)).size, 7);
  assert.equal(new Set(first.rows.map(row => row.title)).size, 1, 'Equal labels do not deduplicate distinct obligations.');
  assert.equal(hash(f.store.read()), before); assert.equal(f.effects(), 0);
  assert.throws(() => f.review.list(owner, { limit: 101 }), { code: 'INVALID_REVIEW_PAGE' });
  assert.throws(() => f.review.list(owner, [] as unknown as {}), { code: 'INVALID_REVIEW_PAGE' });
  assert.throws(() => f.review.list(owner, { cursor: 'forged-cursor' }), { code: 'REVIEW_QUEUE_CHANGED' });
});

test('every action status is classified; only prepared and unattempted is another approval', async () => {
  const f = setup(); const statuses: PreparedAction['status'][] = ['prepared', 'approved', 'executing', 'verified', 'unknown', 'rejected', 'blocked', 'cancelled'];
  for (const status of statuses) {
    const action = await f.prepare(`status-${status}`); f.store.state.actions.find(item => item.id === action.id).status = status;
  }
  const attempted = await f.prepare('prepared-attempted'); f.store.state.actions.find(item => item.id === attempted.id).attempts = [{ id: 'interrupted-attempt', startedAt: '2026-10-03T00:00:00.000Z', outcome: 'unknown' }];
  const result = f.review.list(owner, { limit: 100 }); assert.equal(result.count, 1); assert.equal(result.rows[0].kind, 'action-approval');
  assert.equal(f.store.state.actions.find(item => item.status === 'unknown').attempts.length, 0, 'An unknown state is never reconciled by a read.');
});

test('every job status is classified, exact valid approvals and nonapproval blocks are excluded', async () => {
  const f = setup();
  const states: Job['status'][] = ['scheduled', 'running', 'paused', 'revoked', 'approval-blocked', 'budget-blocked', 'runner-blocked', 'network-wait', 'outcome-unknown', 'cancelled', 'stopped', 'awaiting-acceptance', 'accepted'];
  for (const status of states) {
    const job = await f.jobs.create(owner, f.config); const saved = f.store.state.jobs.find(item => item.id === job.id); saved.status = status;
    if (status === 'awaiting-acceptance') saved.deliverable = { receipt: 'synthetic-released-output' };
  }
  const expected = ['scheduled', 'paused', 'approval-blocked', 'budget-blocked', 'runner-blocked', 'network-wait'];
  const page = f.review.list(owner, { limit: 100 }); assert.equal(page.count, 7); assert.equal(page.rows.filter(row => row.kind === 'job-acceptance').length, 1);
  assert.deepEqual(page.rows.filter(row => row.kind === 'job-approval').map(row => f.store.state.jobs.find(item => item.id === row.reference.id).status).sort(), expected.sort());
  const approved = await f.jobs.create(owner, f.config); await f.jobs.approve(owner, approved.id, approved.digest);
  f.store.state.jobs.find(item => item.id === approved.id).status = 'approval-blocked'; f.store.state.policy.autonomy = false;
  assert.equal(f.review.list(owner, { limit: 100 }).rows.some(row => row.reference.id === approved.id), false, 'Autonomy-disabled is not a second human approval.');
  const noApproval = await f.jobs.create(owner, { ...f.config, requiresApproval: false }); f.store.state.jobs.find(item => item.id === noApproval.id).status = 'approval-blocked';
  const expired = await f.jobs.create(owner, f.config); f.store.state.jobs.find(item => item.id === expired.id).stopRule.deadline = '2026-10-03T00:00:00.000Z'; f.store.state.jobs.find(item => item.id === expired.id).digest = f.jobs.identity(f.store.state.jobs.find(item => item.id === expired.id));
  const held = await f.jobs.create(owner, f.config); f.store.state.jobs.find(item => item.id === held.id).deliverable = { retained: 'rejected output' };
  const unresolved = await f.jobs.create(owner, f.config); f.store.state.jobs.find(item => item.id === unresolved.id).execution = { attempts: [{ status: 'unknown' }] };
  const rows = f.review.list(owner, { limit: 100 }).rows; assert.equal(rows.some(row => [noApproval.id, expired.id, held.id, unresolved.id].includes(row.reference.id)), false);
});

test('visibility precedes count and paging; approval role, current write grant and channels remain separate', async () => {
  const f = setup();
  f.store.state.members.push({ id: 'reader', name: 'Synthetic viewer', role: 'viewer', epoch: 1, active: true, branches: ['main'] });
  f.store.state.facts.push({ id: 'fact-visible', entityId: 'synthetic-visible', sourceId: 'visible', sourceRow: 2, kind: 'invoice', validFrom: '2026-10-01', validTo: null, learnedAt: '2026-10-02T00:00:00.000Z', supersededAt: null, branch: 'main', fields: {} });
  f.store.state.facts.push({ ...f.store.state.facts[0], id: 'fact-hidden', sourceId: 'hidden', branch: 'secret' });
  for (let i = 0; i < 7; i++) await f.prepare(`hidden-${i}`, ['hidden']);
  const visible = await f.prepare('visible-row', ['visible']); const viewer: Context = { memberId: 'reader', role: 'viewer', epoch: 1, channel: 'desktop' };
  const result = f.review.list(viewer); assert.equal(result.count, 1); assert.equal(result.nextCursor, null); assert.equal(result.rows[0].reference.id, visible.id); assert.equal(result.rows[0].canApprove, false);
  assert.equal(JSON.stringify(result).includes('hidden-'), false);
  f.write(false); assert.equal(f.review.list(owner).rows.every(row => !row.canApprove), true);
  f.write(true); assert.equal(f.review.list({ ...owner, channel: 'phone' }).rows.every(row => !row.canApprove), true);
  assert.equal(f.review.list({ ...owner, sourceTainted: true }).rows.every(row => !row.canApprove), true);
  f.read(false); assert.equal(f.review.list(owner).knownCount, 0);
});

test('private jobs keep exact owner, role and epoch even for another workspace owner', async () => {
  const f = setup(); f.store.state.members.push({ id: 'owner2', name: 'Synthetic second owner', role: 'owner', epoch: 1, active: true, branches: ['*'] });
  const second: Context = { ...owner, memberId: 'owner2' }; const job = await f.jobs.create(second, f.config);
  assert.equal(f.review.list(owner).count, 0); assert.equal(f.review.list(second).count, 1);
  f.store.state.members.find(member => member.id === 'owner2')!.epoch = 2;
  assert.throws(() => f.review.list(second), { code: 'ACCESS_REVOKED' }); assert.equal(f.review.list({ ...second, epoch: 2 }).count, 0);
  f.store.state.members.find(member => member.id === 'owner2')!.role = 'cofounder';
  assert.equal(f.review.list({ ...second, epoch: 2, role: 'cofounder' }).count, 0); assert.equal(f.store.state.jobs[0].id, job.id);
});

test('held page/reference reauthorization rejects source revocation, current revisions and channel changes', async () => {
  const f = setup(); for (let i = 0; i < 7; i++) await f.prepare(`held-${i}`, ['books']);
  const held = f.review.list(owner), reference = held.rows[0].reference;
  f.store.state.sourceRules.push({ sourceId: 'books', memberId: 'owner', read: false });
  assert.throws(() => f.review.list(owner, { cursor: held.nextCursor! }), { code: 'REVIEW_QUEUE_CHANGED' });
  assert.throws(() => f.review.resolve(owner, reference), { code: 'REVIEW_REFERENCE_UNAVAILABLE' });
  assert.equal(f.review.list(owner).count, 0);
  f.store.state.sourceRules = [];
  await f.actions.revise(owner, reference.id, { exact: 'new revision' });
  assert.throws(() => f.review.resolve(owner, reference), { code: 'REVIEW_REFERENCE_UNAVAILABLE' });
  const updated = f.review.list(owner, { limit: 100 }).rows.find(row => row.reference.id === reference.id)!;
  assert.equal(updated.reference.revision, 2); assert.notEqual(updated.reference.digest, reference.digest);
  assert.deepEqual(updated.request, { method: 'actions.approve', payload: { id: reference.id, digest: updated.reference.digest } });
  assert.equal(f.review.resolve({ ...owner, channel: 'phone' }, updated.reference).canApprove, false);
  f.store.state.members[0].role = 'viewer';
  assert.throws(() => f.review.resolve(owner, updated.reference), { code: 'ACCESS_REVOKED' });
});

test('missing producers and guarded held outputs cannot claim a zero or complete total', async () => {
  const f = setup(); const absent = new TodayReviewService(f.store).list(owner);
  assert.equal(absent.completeness, 'unavailable'); assert.equal(absent.count, null); assert.equal(absent.knownCount, 0);
  await f.prepare('known-subset'); const subset = new TodayReviewService(f.store, { actions: f.actions }).list(owner);
  assert.equal(subset.completeness, 'incomplete'); assert.equal(subset.count, null); assert.equal(subset.knownCount, 1);
  const missingCatalogue = new ActionService(f.store); const missing = new TodayReviewService(f.store, { actions: missingCatalogue, jobs: f.jobs, lessons: f.lessons }).list(owner);
  assert.equal(missing.count, null); assert.equal(missing.producers.actions.status, 'unavailable');
  const withoutGuard = setup(undefined); // Explicit construction below avoids setup's test default.
  const jobs = new JobService(withoutGuard.store, { clock });
  const result = new TodayReviewService(withoutGuard.store, { actions: withoutGuard.actions, jobs, lessons: withoutGuard.lessons }).list(owner);
  assert.equal(result.count, null); assert.equal(result.producers.jobs.status, 'incomplete');
  const held = setup(() => false); const job = await held.jobs.create(owner, held.config);
  const saved = held.store.state.jobs.find(item => item.id === job.id); saved.status = 'awaiting-acceptance'; saved.deliverable = { secret: 'held-private-value' };
  const page = held.review.list(owner); assert.equal(page.count, null); assert.equal(page.knownCount, 0); assert.equal(page.producers.jobs.reason, 'REVIEW_EVIDENCE_UNAVAILABLE');
  assert.equal(JSON.stringify(page).includes('held-private-value'), false); assert.equal(JSON.stringify(page).includes(job.id), false);
});

test('decisions due for review do not become approval obligations; permission changes during release refuse the reply', async () => {
  const f = setup(); f.store.state.decisions.push({ id: 'due-decision', reviewDate: '2026-10-04', title: 'Synthetic attention item' });
  assert.equal(f.review.list(owner).count, 0);
  const job = await f.jobs.create(owner, f.config), saved = f.store.state.jobs.find(item => item.id === job.id);
  saved.status = 'awaiting-acceptance'; saved.deliverable = { receipt: 'synthetic-held-reply' };
  const changing = new JobService(f.store, { clock, deliverableGuard: () => { f.store.state.policy.allowedSources = []; return true; } });
  const service = new TodayReviewService(f.store, { actions: f.actions, jobs: changing, lessons: f.lessons });
  assert.throws(() => service.list(owner), { code: 'REVIEW_AUTHORITY_CHANGED' });
  assert.equal(f.effects(), 0); assert.equal(digest(f.store.state.actions), digest([]));
});

test('a live operation grant changing during a later producer read cannot release held action metadata', async () => {
  const f = setup(); await f.prepare('held-operation-metadata');
  const job = await f.jobs.create(owner, f.config), saved = f.store.state.jobs.find(item => item.id === job.id);
  saved.status = 'awaiting-acceptance'; saved.deliverable = { receipt: 'synthetic-held-read' };
  const jobs = new JobService(f.store, { clock, deliverableGuard: () => { f.read(false); return true; } });
  const service = new TodayReviewService(f.store, { actions: f.actions, jobs, lessons: f.lessons });
  assert.throws(() => service.list(owner), { code: 'REVIEW_AUTHORITY_CHANGED' });
  assert.equal(service.list(owner).knownCount, 1); assert.equal(f.effects(), 0);
});

test('a host live authority token closes late renewed-pass revocation and invalidates retained continuations', async () => {
  const f = setup(); for (let i = 0; i < 7; i++) await f.prepare(`late-grant-${i}`);
  const job = await f.jobs.create(owner, f.config), saved = f.store.state.jobs.find(item => item.id === job.id);
  saved.status = 'awaiting-acceptance'; saved.deliverable = { receipt: 'synthetic-late-read' };
  let checks = 0;
  const jobs = new JobService(f.store, { clock, deliverableGuard: () => { checks++; if (checks === 2) f.read(false); return true; } });
  const service = new TodayReviewService(f.store, { actions: f.actions, jobs, lessons: f.lessons, authorityRevision: f.authorityRevision });
  assert.throws(() => service.list(owner), { code: 'REVIEW_AUTHORITY_CHANGED' });
  assert.equal(service.list(owner).knownCount, 1);
  f.read(true); const held = service.list(owner); assert.ok(held.nextCursor);
  f.write(false); assert.throws(() => service.list(owner, { cursor: held.nextCursor }), { code: 'REVIEW_QUEUE_CHANGED' });
  const unavailable = new TodayReviewService(f.store, { actions: f.actions, jobs, lessons: f.lessons, authorityRevision: () => '' });
  assert.throws(() => unavailable.list(owner), { code: 'REVIEW_AUTHORITY_UNAVAILABLE' });
});
