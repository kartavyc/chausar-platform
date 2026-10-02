import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { JobService } from '../runtime/jobs.ts';

/** Synthetic writer-candidate fixture: no database or connector qualification. */
class CandidateStore implements StateStore {
  state = initialState('Synthetic brief writer boundary', true);
  beforeWork?: (candidate: State) => void;
  read() { return structuredClone(this.state); }
  async update<T>(work: (candidate: State) => T | Promise<T>): Promise<T> {
    const candidate = structuredClone(this.state);
    this.beforeWork?.(candidate);
    const result = await work(candidate);
    candidate.revision += 1;
    this.state = candidate;
    return result;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
function fixture() {
  const store = new CandidateStore(); store.state.policy.autonomy = true;
  store.state.facts.push({ id: 'fact_a', entityId: 'sale_a', sourceId: 'source_a', sourceRow: 1, kind: 'sale',
    validFrom: '2026-10-01', validTo: null, learnedAt: '2026-10-01T00:00:00.000Z',
    supersededAt: null, fields: { amountMinor: '5000' } });
  const jobs = new JobService(store, { clock: () => Date.parse('2026-10-01T00:00:00.000Z'),
    deliverableGuard: (_ctx, _job, view) => view?.read().facts[0].fields.amountMinor === '5000' });
  const config = { type: 'owner-brief', goal: 'Synthetic receipt-backed brief', budgetMinor: '1',
    reserveMinor: '1', sourceIds: ['source_a'], stopRule: { maxRuns: 2, deadline: '2026-10-02T00:00:00.000Z' },
    nextRunAt: '2026-10-01T00:00:00.000Z', intervalMs: 60000 };
  const deliverable = { kind: 'brief', result: { receiptIds: ['synthetic_receipt_a'], totalMinor: '5000' } };
  return { store, jobs, config, deliverable };
}
test('brief completion evaluates the current writer candidate and rolls back stale delivery', async () => {
  const f = fixture(), created = await f.jobs.create(owner, f.config), running = await f.jobs.acquire(owner, created.id, 'synthetic_worker');
  const before = f.store.read(); f.store.beforeWork = candidate => { candidate.facts[0].fields.amountMinor = '9000'; };
  await assert.rejects(f.jobs.complete(owner, created.id, running.lease!, f.deliverable, '0'), { code: 'JOB_EVIDENCE_REVOKED' });
  assert.deepEqual(f.store.read(), before);
});
test('brief acceptance evaluates the current writer candidate before accepting or rescheduling', async () => {
  const f = fixture(), created = await f.jobs.create(owner, f.config), running = await f.jobs.acquire(owner, created.id, 'synthetic_worker');
  const delivered = await f.jobs.complete(owner, created.id, running.lease!, f.deliverable, '0');
  assert.deepEqual(delivered.deliverable, f.deliverable);
  const before = f.store.read(); f.store.beforeWork = candidate => { candidate.facts[0].fields.amountMinor = '9000'; };
  await assert.rejects(f.jobs.accept(owner, created.id, true), { code: 'JOB_EVIDENCE_REVOKED' });
  assert.deepEqual(f.store.read(), before);
});
test('brief list uses one current detached evidence view and preserves the historical record', async () => {
  const f = fixture(), created = await f.jobs.create(owner, f.config), running = await f.jobs.acquire(owner, created.id, 'synthetic_worker');
  await f.jobs.complete(owner, created.id, running.lease!, f.deliverable, '0');
  f.store.state.facts[0].fields.amountMinor = '9000';
  const before = f.store.read();
  assert.equal(f.jobs.list(owner)[0].deliverable, undefined);
  assert.deepEqual(f.store.read(), before);
  assert.deepEqual(before.jobs[0].deliverable, f.deliverable);
});
