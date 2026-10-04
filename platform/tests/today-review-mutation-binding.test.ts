import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService, digest } from '../runtime/actions.ts';
import type { Connector } from '../runtime/actions.ts';
import { JobService } from '../runtime/jobs.ts';
import type { Job, JobAcceptanceReference } from '../runtime/jobs.ts';
import { TodayReviewService } from '../runtime/today-review.ts';

/** Generated source fixture only. The hook commits a competing change immediately
 * before the queued mutation callback, rather than changing a producer result. */
class AtomicStore implements StateStore {
  state = initialState('Synthetic Today mutation binding fixture', true);
  private queue: Promise<unknown> = Promise.resolve();
  beforeNextMutation: ((state: State) => void) | undefined;
  read(): State { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const pending = this.queue.then(async () => {
      const competing = this.beforeNextMutation;
      this.beforeNextMutation = undefined;
      if (competing) {
        const earlier = this.read();
        competing(earlier); earlier.revision++;
        this.state = earlier;
      }
      const draft = this.read(), result = await change(draft);
      draft.revision++; this.state = draft;
      return structuredClone(result);
    });
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const invoiceConnector = 'simulated-invoice-reminder';
const invoiceType = 'invoice-follow-up';
const at = Date.parse('2026-10-04T09:00:00.000Z');
const config = {
  goal: 'Review this generated source result', sourceIds: [], budgetMinor: '100', reserveMinor: '10',
  stopRule: { maxRuns: 3, deadline: '2026-10-06T09:00:00.000Z' },
  nextRunAt: '2026-10-04T09:00:00.000Z', intervalMs: 60000, requiresApproval: false,
};
function fixture() {
  const store = new AtomicStore(); store.state.policy.autonomy = true;
  let release = true, effects = 0;
  const connector = (id: string): Connector => ({ id, title: 'Generated local catalogue', operations: { review: {
    title: 'Review a generated local preview', description: 'Never dispatched by these source tests.', impact: 'reversible',
    idempotency: 'Generated stable preview key', readback: 'No readback is performed',
    validate: value => value as Record<string, unknown>,
    execute: async () => { effects++; throw new Error('Review reads must not execute effects.'); },
    reconcile: async () => { effects++; throw new Error('Review reads must not reconcile effects.'); },
  } } });
  const actions = new ActionService(store, [connector('ordinary'), connector(invoiceConnector)]);
  const jobs = new JobService(store, { clock: () => at, deliverableGuard: () => release });
  const review = new TodayReviewService(store, { actions, jobs });
  const prepare = (label: string, connectorId = 'ordinary') => actions.prepare(owner, {
    connector: connectorId, operation: 'review', payload: { label }, sourceIds: [], idempotencyKey: `generated-preview-${label}`,
  });
  const delivered = async () => {
    const job = await jobs.create(owner, { ...config, type: 'owner-brief' });
    const running = await jobs.acquire(owner, job.id, 'synthetic-owned-worker');
    assert.ok(running.lease);
    return jobs.complete(owner, job.id, running.lease, { kind: 'generated-reviewed-output', receiptIds: [], value: 'first' }, '0');
  };
  return { store, actions, jobs, review, prepare, delivered, release: (value: boolean) => { release = value; }, effects: () => effects };
}
const reference = (job: Job): JobAcceptanceReference => ({
  kind: 'job-acceptance', id: job.id, revision: job.revision, digest: job.digest, deliverableDigest: digest(job.deliverable),
});
const counters = (state: State, id: string) => ({
  ledger: structuredClone(state.jobs.find(job => job.id === id).ledger), activity: structuredClone(state.activity),
});

test('Today job acceptance request carries the exact reviewed reference and a bound acceptance commits once', async () => {
  const f = fixture(), job = await f.delivered();
  const beforeRead = hash(f.store.read()), row = f.review.list(owner).rows.find(item => item.kind === 'job-acceptance');
  assert.ok(row);
  const pin = reference(job);
  assert.deepEqual(row.reference, pin);
  assert.deepEqual(row.request, { method: 'jobs.accept', payload: { id: job.id, reference: pin } });
  assert.equal(hash(f.store.read()), beforeRead, 'Reading a mutation binding must not accept or audit work.');
  const before = f.store.read();
  const accepted = await f.jobs.accept(owner, job.id, false, pin);
  assert.equal(accepted.status, 'accepted');
  const after = f.store.read();
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.jobs.find(item => item.id === job.id).ledger.filter((item: { event: string }) => item.event === 'accepted').length, 1);
  assert.equal(after.activity.length, before.activity.length + 1);
  assert.equal(after.activity.at(-1).event, 'job.accepted');
  assert.equal(f.effects(), 0);
});

test('queued objective revision and digest changes refuse the held full pin before any acceptance mutation', async () => {
  const f = fixture(), job = await f.delivered(), pin = reference(job), before = counters(f.store.read(), job.id);
  f.store.beforeNextMutation = state => {
    const current = f.jobs.find(state, job.id);
    current.revision++; current.goal = 'A newly reviewed generated objective'; current.digest = f.jobs.identity(current);
  };
  await assert.rejects(f.jobs.accept(owner, job.id, true, pin), { code: 'PREVIEW_CHANGED' });
  const after = f.store.read(), current = f.jobs.find(after, job.id);
  assert.equal(current.revision, pin.revision + 1, 'The earlier competing change remains committed.');
  assert.notEqual(current.digest, pin.digest);
  assert.equal(current.status, 'awaiting-acceptance');
  assert.deepEqual(current.deliverable, job.deliverable);
  assert.deepEqual(counters(after, job.id), before, 'A refused exact acceptance must not audit, consume or reschedule work.');
  assert.equal(f.effects(), 0);
});

test('queued deliverable replacement with unchanged objective pins refuses the held result digest', async () => {
  const f = fixture(), job = await f.delivered(), pin = reference(job), before = counters(f.store.read(), job.id);
  f.store.beforeNextMutation = state => {
    f.jobs.find(state, job.id).deliverable = { kind: 'generated-reviewed-output', receiptIds: [], value: 'replacement' };
  };
  await assert.rejects(f.jobs.accept(owner, job.id, false, pin), { code: 'PREVIEW_CHANGED' });
  const after = f.store.read(), current = f.jobs.find(after, job.id);
  assert.equal(current.revision, pin.revision); assert.equal(current.digest, pin.digest);
  assert.notEqual(digest(current.deliverable), pin.deliverableDigest);
  assert.equal(current.status, 'awaiting-acceptance');
  assert.deepEqual(counters(after, job.id), before);
  assert.equal(f.effects(), 0);
});

test('a full reference cannot substitute another job identity or a forged individual pin', async () => {
  const variants: ((pin: JobAcceptanceReference) => JobAcceptanceReference)[] = [
    pin => ({ ...pin, id: 'another-generated-job' }),
    pin => ({ ...pin, revision: pin.revision + 1 }),
    pin => ({ ...pin, digest: 'f'.repeat(64) }),
    pin => ({ ...pin, deliverableDigest: 'e'.repeat(64) }),
  ];
  for (const altered of variants) {
    const f = fixture(), job = await f.delivered(), before = hash(f.store.read());
    await assert.rejects(f.jobs.accept(owner, job.id, false, altered(reference(job))), { code: 'PREVIEW_CHANGED' });
    assert.equal(hash(f.store.read()), before);
    assert.equal(f.effects(), 0);
  }
});

test('a supplied malformed reference never falls back to legacy id-only acceptance', async () => {
  const malformed: unknown[] = [null, {}, { kind: 'job-approval' }, { kind: 'job-acceptance', id: 'missing-pins' }];
  for (const supplied of malformed) {
    const f = fixture(), job = await f.delivered(), before = hash(f.store.read());
    await assert.rejects(f.jobs.accept(owner, job.id, false, supplied as JobAcceptanceReference), { code: 'INVALID_JOB_ACCEPTANCE_REFERENCE' });
    assert.equal(hash(f.store.read()), before);
  }
  const f = fixture(), job = await f.delivered(), before = hash(f.store.read());
  for (const supplied of [
    { ...reference(job), digest: [reference(job).digest] },
    { ...reference(job), deliverableDigest: [reference(job).deliverableDigest] },
  ]) {
    await assert.rejects(f.jobs.accept(owner, job.id, false, supplied as unknown as JobAcceptanceReference), { code: 'INVALID_JOB_ACCEPTANCE_REFERENCE' });
    assert.equal(hash(f.store.read()), before);
  }
  const extra = { ...reference(job), ignored: 'must-not-downgrade-or-expand-the-contract' };
  await assert.rejects(f.jobs.accept(owner, job.id, false, extra), { code: 'INVALID_JOB_ACCEPTANCE_REFERENCE' });
  assert.equal(hash(f.store.read()), before);
});

test('bound acceptance still reauthorizes the current real deliverable guard inside the mutation', async () => {
  const f = fixture(), job = await f.delivered(), before = hash(f.store.read());
  const pin = reference(job); f.release(false);
  await assert.rejects(f.jobs.accept(owner, job.id, false, pin), { code: 'JOB_EVIDENCE_REVOKED' });
  assert.equal(hash(f.store.read()), before);
  assert.equal(f.effects(), 0);
});

test('the existing unbound id-only service caller retains its current acceptance behavior', async () => {
  const f = fixture(), job = await f.delivered();
  const accepted = await f.jobs.accept(owner, job.id);
  assert.equal(accepted.status, 'accepted');
  assert.equal(f.effects(), 0);
});

test('unsupported action connectors and job types are excluded before shared count, first four and continuation', async () => {
  const f = fixture(), ordinaryIds = new Set<string>();
  for (let index = 0; index < 5; index++) ordinaryIds.add((await f.prepare(`ordinary-${index}`)).id);
  const unsupportedAction = await f.prepare('invoice-preview', invoiceConnector);
  const unsupportedJob = await f.jobs.create(owner, { ...config, type: invoiceType, requiresApproval: true });
  await f.store.update(state => {
    state.actions.find(action => action.id === unsupportedAction.id).createdAt = '2026-10-01T00:00:00.000Z';
    f.jobs.find(state, unsupportedJob.id).createdAt = '2026-10-01T00:00:00.000Z';
  });
  const review = new TodayReviewService(f.store, { actions: f.actions, jobs: f.jobs,
    unsupportedMutations: { actionConnectors: [invoiceConnector], jobTypes: [invoiceType] } });
  const before = hash(f.store.read()), first = review.list(owner);
  assert.equal(first.knownCount, 5); assert.equal(first.count, null); assert.equal(first.rows.length, 4);
  assert.equal(first.completeness, 'incomplete');
  assert.deepEqual(first.producers.actions, { status: 'incomplete', reason: 'UNSUPPORTED_MUTATION_CONTRACT' });
  assert.deepEqual(first.producers.jobs, { status: 'incomplete', reason: 'UNSUPPORTED_MUTATION_CONTRACT' });
  assert.ok(first.nextCursor);
  const remainder = review.list(owner, { cursor: first.nextCursor, limit: 100 });
  assert.equal(remainder.knownCount, 5); assert.equal(remainder.rows.length, 1); assert.equal(remainder.nextCursor, null);
  const all = [...first.rows, ...remainder.rows];
  assert.deepEqual(new Set(all.map(row => row.reference.id)), ordinaryIds);
  assert.throws(() => review.resolve(owner, { kind: 'action-approval', id: unsupportedAction.id,
    revision: unsupportedAction.revision, digest: unsupportedAction.digest }), { code: 'REVIEW_REFERENCE_UNAVAILABLE' });
  assert.throws(() => review.resolve(owner, { kind: 'job-approval', id: unsupportedJob.id,
    revision: unsupportedJob.revision, digest: unsupportedJob.digest }), { code: 'REVIEW_REFERENCE_UNAVAILABLE' });
  assert.equal(hash(f.store.read()), before); assert.equal(f.effects(), 0);
});

test('the installed unsupported domain lists are copied rather than controlled by a held caller array', async () => {
  const f = fixture(); await f.prepare('invoice-copy', invoiceConnector);
  await f.jobs.create(owner, { ...config, type: invoiceType, requiresApproval: true });
  const actionConnectors = [invoiceConnector], jobTypes = [invoiceType];
  const review = new TodayReviewService(f.store, { actions: f.actions, jobs: f.jobs,
    unsupportedMutations: { actionConnectors, jobTypes } });
  actionConnectors.length = 0; jobTypes.length = 0;
  const result = review.list(owner);
  assert.equal(result.knownCount, 0);
  assert.deepEqual(result.producers.actions, { status: 'incomplete', reason: 'UNSUPPORTED_MUTATION_CONTRACT' });
  assert.deepEqual(result.producers.jobs, { status: 'incomplete', reason: 'UNSUPPORTED_MUTATION_CONTRACT' });
  assert.equal(f.effects(), 0);
});
