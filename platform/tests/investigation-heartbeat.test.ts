import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ActionService } from '../runtime/actions.ts';
import { CalculatorService, type CalculationReceipt } from '../runtime/calculator.ts';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { createEngineJobRunner } from '../runtime/engine-jobs.ts';
import { InvestigationService, type Investigation, type InvestigationCreate } from '../runtime/investigations.ts';
import { JobService, type Job, type JobConfig } from '../runtime/jobs.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';

// Deterministic, explicitly synthetic storage, verifier and trusted time. These
// tests exercise the installed runner and services, not native database quality,
// process durability, live providers or external effects. No sleep advances time.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const initialTime = Date.parse('2026-10-01T12:00:00.000Z');
const sourceId = 'synthetic-investigation-heartbeat-books';
const period = { from: '2026-07-01', to: '2026-07-31' };
const leaseMs = 1000;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

class VerifierGate {
  calls = 0;
  released = false;
  private pending: ReturnType<typeof deferred<void>>[] = [];
  private observers: { count: number; done: ReturnType<typeof deferred<void>> }[] = [];
  async verify(receipt: CalculationReceipt) {
    const wait = deferred<void>();
    this.pending.push(wait); this.calls++;
    for (const observer of this.observers) if (this.calls >= observer.count) observer.done.resolve();
    if (!this.released) await wait.promise;
    return { qualification: 'synthetic-controlled-verifier-only', receiptId: receipt.id };
  }
  entered(count = 1) {
    const done = deferred<void>();
    this.observers.push({ count, done });
    if (this.calls >= count) done.resolve();
    return done.promise;
  }
  release() { this.released = true; for (const wait of this.pending) wait.resolve(); }
}

class SerializedStore implements StateStore {
  state = initialState('Synthetic investigation heartbeat regression', true);
  queue: Promise<void> = Promise.resolve();
  transactionActive = false;
  commits: State[] = [];
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      assert.equal(this.transactionActive, false, 'The fixture serializes every write.');
      this.transactionActive = true;
      try {
        const draft = this.read(), value = await change(draft);
        draft.revision++; this.state = draft; this.commits.push(this.read());
        return value;
      } finally { this.transactionActive = false; }
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }
}

function plan(): InvestigationCreate {
  return { objective: 'Measure the owner-authored July collections', branch: 'main',
    asOf: '2100-01-01T00:00:00.000Z', sourceIds: [sourceId],
    steps: [{ id: 'july', label: 'Measure July collections', request: { operation: 'received', period } }],
    hypotheses: [], budget: { maxSteps: 1, maxReceiptRows: 20, maxContextBytes: 64000 } };
}
function fact(entityId = 'july-payment', amountMinor = '30000'): FactInput {
  return { entityId, validFrom: '2026-07-15', sourceId, sourceRow: 2, kind: 'payment', branch: 'main',
    fields: { amountMinor, currency: 'INR', status: 'settled', description: 'Labelled synthetic payment' } };
}
function config(investigation: Investigation): JobConfig & { type: string } {
  return { type: 'private-investigation', goal: investigation.objective,
    input: { investigationId: investigation.id, expectedRevision: investigation.revision,
      steps: [{ stepId: 'july', reserveMinor: '1', durationMs: 10000 }] },
    sourceIds: [...investigation.sourceIds], budgetMinor: '2', reserveMinor: '1',
    limits: { modelUnits: 0, durationMs: 30000, actionExposureMinor: '0' },
    stopRule: { maxRuns: 1, deadline: '2026-10-02T00:00:00.000Z' },
    nextRunAt: new Date(initialTime).toISOString(), intervalMs: 60000, graceMs: 0,
    catchup: 'latest', background: false, testedRoutes: [], allowedActions: [] };
}
const investigationIn = (state: State, id: string) => state.answers.find(answer =>
  answer.kind === 'private-investigation-v1' && answer.id === id) as Investigation;
const operationsIn = (state: State) => state.answers.filter(answer =>
  answer.kind === 'private-investigation-job-operation-v1');

async function fixture(t: TestContext) {
  const store = new SerializedStore(), gate = new VerifierGate();
  let trustedTime = initialTime;
  const clock = () => trustedTime;
  const options = { verifier: gate.verify.bind(gate) };
  await new OntologyService(store).publish(owner, 'ecommerce');
  await new MemoryService(store).append(owner, [fact()]);
  await store.update(state => { state.policy.autonomy = true; });
  const investigations = new InvestigationService(store, { ...options, clock: () => new Date(clock()).toISOString() });
  const jobs = new JobService(store, { clock });
  const actions = new ActionService(store);
  const hosts = [0, 1].map(index => createEngineJobRunner(store, jobs, actions, options,
    { workerId: `synthetic-heartbeat-worker-${index}`, maxActiveJobs: 8, leaseMs, networkAvailable: () => false, clock }));
  const runs: Promise<Job>[] = [];
  t.after(async () => { gate.release(); await Promise.allSettled(runs); await store.queue; });
  const run = (jobId: string, index = 0) => {
    const pending = hosts[index].run(owner, jobId);
    // Attach rejection handling immediately; source revocation may intentionally
    // reject the returned public view after the uncertain attempt is recorded.
    void pending.catch(() => {}); runs.push(pending); return pending;
  };
  const waiting = async (pending: Promise<Job>, count = 1) => {
    await Promise.race([gate.entered(count), pending.then(job => {
      assert.fail(`The synthetic run ended before verifier entry: ${JSON.stringify(job.ledger)}`);
    })]);
    assert.equal(store.transactionActive, false,
      'A suspended verifier must not hold the serialized writer transaction.');
  };
  const noMeasurement = (id: string, revision: number) => {
    const state = store.read(), value = investigationIn(state, id);
    assert.equal(state.receipts.length, 0);
    assert.equal(operationsIn(state).length, 0);
    assert.equal(value.revision, revision);
    assert.deepEqual(value.steps.map(step => step.state), ['pending']);
    assert.deepEqual(value.receiptPins, []);
  };
  const atomicMeasurements = (id: string, initialRevision: number) => {
    for (const state of store.commits) {
      const value = investigationIn(state, id); if (!value) continue;
      const completed = value.steps.filter(step => step.state === 'completed');
      assert.equal(state.receipts.length, completed.length, 'No receipt may precede its completed investigation step.');
      assert.equal(operationsIn(state).length, completed.length, 'The correlated operation and measurement commit together.');
      if (completed.length) assert.equal(value.revision, initialRevision + 1);
    }
  };
  return { store, gate, clock, advanceTime: (milliseconds: number) => { trustedTime += milliseconds; },
    investigations, jobs, hosts, run, waiting, noMeasurement, atomicMeasurements,
    calculator: new CalculatorService(store), savedJob: (id: string) => jobs.find(store.read(), id) };
}

test('a suspended investigation verifier allows a real heartbeat before one atomic measurement commit', { timeout: 15000 }, async t => {
  const f = await fixture(t), investigation = await f.investigations.create(owner, plan());
  const job = await f.hosts[0].create(owner, config(investigation)), pending = f.run(job.id);
  await f.waiting(pending); f.noMeasurement(investigation.id, investigation.revision);
  const lease = structuredClone(f.savedJob(job.id).lease!);
  const originalExpiry = Date.parse(lease.expiresAt);
  f.advanceTime(700);
  const renewed = await f.jobs.heartbeat(owner, job.id, lease, leaseMs);
  assert.equal(renewed.status, 'running');
  assert.equal(Date.parse(renewed.lease!.expiresAt), f.clock() + leaseMs);
  assert.ok(Date.parse(renewed.lease!.expiresAt) > originalExpiry);
  f.noMeasurement(investigation.id, investigation.revision);
  f.advanceTime(600);
  assert.ok(f.clock() > originalExpiry, 'Completion must rely on the committed renewal, not the original lease.');
  f.gate.release();
  const completed = await pending;
  assert.equal(completed.status, 'awaiting-acceptance', JSON.stringify(completed.ledger));
  const measured = f.investigations.get(owner, investigation.id), [receipt] = f.store.read().receipts;
  assert.equal(measured.revision, investigation.revision + 1);
  assert.equal(measured.status, 'complete');
  assert.equal(measured.steps[0].receipt!.receiptId, receipt.id);
  assert.equal(f.calculator.receipt(owner, receipt.id).valueMinor, '30000');
  assert.equal(f.gate.calls, 1);
  assert.equal(f.store.read().receipts.length, 1);
  assert.equal(operationsIn(f.store.read()).length, 1);
  assert.equal(f.savedJob(job.id).execution!.attempts[0].status, 'verified');
  assert.equal(f.store.read().modelReceipts.length, 0);
  assert.equal(f.store.read().actions.length, 0);
  f.atomicMeasurements(investigation.id, investigation.revision);
});

test('an expired lease cannot be renewed or publish a pending verified investigation result', { timeout: 15000 }, async t => {
  const f = await fixture(t), investigation = await f.investigations.create(owner, plan());
  const job = await f.hosts[0].create(owner, config(investigation)), pending = f.run(job.id);
  await f.waiting(pending);
  const lease = structuredClone(f.savedJob(job.id).lease!);
  f.advanceTime(leaseMs + 1);
  await assert.rejects(f.jobs.heartbeat(owner, job.id, lease, leaseMs), { code: 'STALE_LEASE' });
  f.noMeasurement(investigation.id, investigation.revision);
  f.gate.release();
  const blocked = await pending;
  assert.notEqual(blocked.status, 'awaiting-acceptance');
  assert.equal(blocked.deliverable, undefined);
  f.noMeasurement(investigation.id, investigation.revision);
});

for (const change of ['job-cancel', 'investigation-cancel', 'revision', 'source-access', 'source-facts'] as const) {
  test(`${change} during verifier suspension cannot commit a stale receipt, advance or operation`, { timeout: 15000 }, async t => {
    const f = await fixture(t), investigation = await f.investigations.create(owner, plan());
    const job = await f.hosts[0].create(owner, config(investigation)), pending = f.run(job.id);
    await f.waiting(pending); f.noMeasurement(investigation.id, investigation.revision);
    let retainedRevision = investigation.revision;
    if (change === 'job-cancel') await f.hosts[0].cancel(owner, job.id);
    if (change === 'investigation-cancel') {
      retainedRevision = (await f.investigations.cancel(owner, investigation.id,
        { expectedRevision: investigation.revision })).revision;
    }
    if (change === 'revision') {
      retainedRevision = (await f.investigations.revise(owner, investigation.id,
        { expectedRevision: investigation.revision, reason: 'Synthetic owner correction while verification is pending',
          objective: 'Measure July collections after explicitly reviewing the objective' })).revision;
    }
    if (change === 'source-access') await new TrustService(f.store).grantSource(owner, { sourceId, allow: false });
    if (change === 'source-facts') await new MemoryService(f.store).append(owner, [fact('late-synthetic-payment', '5000')]);
    f.noMeasurement(investigation.id, retainedRevision);
    f.gate.release();
    const [outcome] = await Promise.allSettled([pending]);
    if (outcome.status === 'fulfilled') assert.notEqual(outcome.value.status, 'awaiting-acceptance');
    assert.equal(f.savedJob(job.id).deliverable, undefined);
    f.noMeasurement(investigation.id, retainedRevision);
    if (change === 'job-cancel') assert.equal(f.savedJob(job.id).status, 'cancelled');
    if (change === 'investigation-cancel') assert.equal(investigationIn(f.store.read(), investigation.id).status, 'cancelled');
    if (change === 'revision') assert.equal(investigationIn(f.store.read(), investigation.id).objective,
      'Measure July collections after explicitly reviewing the objective');
  });
}

test('concurrent identical admitted investigations commit at most one receipt, revision and operation', { timeout: 15000 }, async t => {
  const f = await fixture(t), investigation = await f.investigations.create(owner, plan());
  const first = await f.hosts[0].create(owner, config(investigation));
  const second = await f.hosts[1].create(owner, config(investigation));
  const pendingFirst = f.run(first.id);
  await f.waiting(pendingFirst);
  const pendingSecond = f.run(second.id, 1);
  await f.waiting(pendingSecond, 2);
  f.noMeasurement(investigation.id, investigation.revision);
  f.gate.release();
  const outcomes = await Promise.allSettled([pendingFirst, pendingSecond]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled' && outcome.value.status === 'awaiting-acceptance').length, 1);
  const state = f.store.read(), measured = investigationIn(state, investigation.id);
  assert.equal(f.gate.calls, 2);
  assert.equal(measured.revision, investigation.revision + 1);
  assert.equal(measured.status, 'complete');
  assert.equal(state.receipts.length, 1);
  assert.equal(operationsIn(state).length, 1);
  assert.equal(measured.steps[0].receipt!.receiptId, state.receipts[0].id);
  assert.equal(f.calculator.receipt(owner, state.receipts[0].id).valueMinor, '30000');
  f.atomicMeasurements(investigation.id, investigation.revision);
});
