import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  admissionDigest, createAdmissionBinding, dispatchAdmissions, matchingExecution,
} from '../src/workflow-admission.ts';
import type {
  AdmissionClaim, AdmissionStore, WorkflowAdmissionPort,
} from '../src/workflow-admission.ts';

type Binding = ReturnType<typeof createAdmissionBinding>;
type Work = Parameters<typeof createAdmissionBinding>[0];
type Scope = Parameters<typeof createAdmissionBinding>[1];
type Finish = Parameters<AdmissionStore['finish']>[1];
type Execution = Extract<Awaited<ReturnType<WorkflowAdmissionPort['read']>>, { status: 'found' }>['execution'];
type Start = Parameters<WorkflowAdmissionPort['start']>[0];
type Cause = { name: string; message: string; code?: string };

const scope: Scope = {
  businessId: 'synthetic-business', businessIncarnation: 'business-incarnation-1',
  environmentIncarnation: 'temporal-deployment-1', namespace: 'synthetic-namespace',
  taskQueue: 'synthetic-investigations',
};
const work: Work = {
  tenantId: 'synthetic-tenant', investigationId: 'synthetic-investigation',
  semanticInput: {
    requestedBy: 'synthetic-owner', principalId: 'synthetic-agent', grantId: 'synthetic-grant',
    purpose: 'profitability', mandateId: 'synthetic-mandate', requestId: 'request-1',
    metricIds: ['gross_inr'], requestDigest: 'synthetic-request-digest',
    queryRegions: null, definitionRevision: null, modelInvocationId: null, inputExpiresAt: null,
  },
};

type Row = {
  work: Work; generation: string; state: 'pending' | 'conflict' | 'admitted';
  attempts: number; binding?: Binding; token?: string; leaseUntil?: number;
  startRequested: boolean; expectedRunId?: string; cause?: Finish['cause']; receipt?: Finish['receipt'];
};

/** Synthetic durable-store model. Ownership uses a trusted injected clock and
 * exact claim tokens; start intent and returned receipts survive claim expiry.
 * This fixture does not qualify PostgreSQL constraints or a native coordinator.
 */
class MemoryStore implements AdmissionStore {
  readonly rows = new Map<string, Row>();
  now = 1000;
  private sequence = 0;
  constructor(works: Work[] = [work], generation = '1') {
    for (const value of works) this.rows.set(value.investigationId, {
      work: structuredClone(value), generation, state: 'pending', attempts: 0, startRequested: false,
    });
  }
  row(id = work.investigationId): Row {
    const row = this.rows.get(id); assert.ok(row); return row;
  }
  async listPending(tenantId: string, limit: number, maxAttempts: number): Promise<string[]> {
    return [...this.rows.entries()].filter(([, row]) => row.work.tenantId === tenantId
      && row.state === 'pending' && row.attempts < maxAttempts
      && (!row.token || (row.leaseUntil ?? 0) <= this.now)).slice(0, limit).map(([id]) => id);
  }
  async claim(tenantId: string, id: string, admissionScope: Scope,
    options: { maxAttempts: number; leaseMs: number }): Promise<AdmissionClaim | undefined> {
    const row = this.rows.get(id);
    if (!row || row.work.tenantId !== tenantId || row.state !== 'pending'
      || row.attempts >= options.maxAttempts || (row.token && (row.leaseUntil ?? 0) > this.now)) return;
    row.binding ??= createAdmissionBinding(row.work, admissionScope, row.generation);
    row.token = `claim-${++this.sequence}`;
    row.leaseUntil = this.now + options.leaseMs;
    row.attempts += 1;
    return {
      binding: structuredClone(row.binding), token: row.token, attempt: row.attempts,
      startRequested: row.startRequested,
      ...(row.expectedRunId ? { expectedRunId: row.expectedRunId } : {}),
    };
  }
  private owned(claim: AdmissionClaim): Row | undefined {
    const row = this.rows.get(claim.binding.workflowId);
    if (!row || row.token !== claim.token || (row.leaseUntil ?? 0) <= this.now
      || row.state !== 'pending' || JSON.stringify(row.binding) !== JSON.stringify(claim.binding)) return;
    return row;
  }
  async markStartRequested(claim: AdmissionClaim): Promise<boolean> {
    const row = this.owned(claim); if (!row) return false;
    row.startRequested = true; return true;
  }
  async recordStartReceipt(claim: AdmissionClaim, receipt: { workflowId: string; runId: string }): Promise<boolean> {
    const row = this.owned(claim); if (!row) return false;
    if (receipt.workflowId !== claim.binding.workflowId || !receipt.runId
      || (row.expectedRunId && row.expectedRunId !== receipt.runId)) return false;
    row.expectedRunId = receipt.runId; return true;
  }
  async finish(claim: AdmissionClaim, update: Finish): Promise<Finish['state'] | false> {
    const row = this.owned(claim); if (!row) return false;
    if (update.state === 'admitted' && !update.receipt) return false;
    row.state = update.state;
    row.cause = update.cause;
    row.receipt = update.receipt;
    row.token = undefined; row.leaseUntil = undefined;
    return update.state;
  }
}

function executionFor(binding: Binding, runId = 'synthetic-run-1'): Execution {
  return {
    namespace: binding.namespace, workflowId: binding.workflowId, runId,
    workflowType: binding.workflowType, taskQueue: binding.taskQueue,
    inputDigest: binding.inputDigest, binding: structuredClone(binding),
  };
}
function error(cause: Cause): Error {
  const failure = new Error(cause.message); failure.name = cause.name;
  if (cause.code) Object.assign(failure, { code: cause.code });
  return failure;
}

/** Adversarial injected coordinator observations, never native Temporal proof. */
class CoordinatorFixture implements WorkflowAdmissionPort {
  readonly executions = new Map<string, Execution>();
  readonly starts: Start[] = [];
  readonly reads: { binding: Binding; runId?: string }[] = [];
  acceptedStartFault?: Cause;
  unavailable?: Cause;
  missing = false;
  returnedReceipt?: { workflowId: string; runId: string };
  onAcceptedStart?: () => Promise<void> | void;
  async start(request: Start): Promise<{ workflowId: string; runId: string }> {
    assert.deepEqual(request.args, [{ investigationId: request.binding.workflowId }]);
    assert.equal(request.workflowIdReusePolicy, 'REJECT_DUPLICATE');
    this.starts.push(structuredClone(request));
    if (this.executions.has(request.binding.workflowId)) {
      throw error({ name: 'WorkflowExecutionAlreadyStartedError', message: 'Synthetic ID already exists' });
    }
    const execution = executionFor(request.binding, `synthetic-run-${this.executions.size + 1}`);
    this.executions.set(request.binding.workflowId, execution);
    await this.onAcceptedStart?.();
    if (this.acceptedStartFault) throw error(this.acceptedStartFault);
    return this.returnedReceipt ?? { workflowId: execution.workflowId, runId: execution.runId };
  }
  async read(binding: Binding, runId?: string): ReturnType<WorkflowAdmissionPort['read']> {
    this.reads.push({ binding: structuredClone(binding), ...(runId ? { runId } : {}) });
    if (this.unavailable) return { status: 'unavailable', cause: this.unavailable };
    if (this.missing) return { status: 'missing' };
    const execution = this.executions.get(binding.workflowId);
    return execution ? { status: 'found', execution: structuredClone(execution) } : { status: 'missing' };
  }
}
const options = { tenantId: work.tenantId, scope, maxAttempts: 3, batchSize: 10, leaseMs: 5000, callTimeoutMs: 1000 };

test('binding canonically pins semantic input, exact workflow arguments and large generation text', () => {
  const first = createAdmissionBinding({ ...work, semanticInput: { b: 2, a: { y: 4, x: 3 } } }, scope, '9007199254740993');
  const same = createAdmissionBinding({ ...work, semanticInput: { a: { x: 3, y: 4 }, b: 2 } }, scope, '9007199254740993');
  assert.deepEqual(first, same);
  assert.equal(first.workflowId, work.investigationId);
  assert.equal(first.workflowType, 'investigate');
  assert.equal(first.generation, '9007199254740993');
  assert.deepEqual(matchingExecution(first, executionFor(first)), []);
  const changed = createAdmissionBinding({ ...work, semanticInput: { a: { x: 3, y: 5 }, b: 2 } }, scope, first.generation);
  assert.notDeepEqual(changed, first);
  // Business semantics differ, while the admitted workflow still receives only the investigation reference.
  assert.equal(changed.inputDigest, first.inputDigest);
});

test('closed canonical JSON digests use ordinal keys and preserve array order', () => {
  const independent = createHash('sha256').update('{"a":[1,2],"b":"three"}').digest('hex');
  assert.equal(admissionDigest({ b: 'three', a: [1, 2] }), independent);
  assert.notEqual(admissionDigest([1, 2]), admissionDigest([2, 1]));
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  const invalid: unknown[] = [undefined, NaN, Infinity, -0, Number.MAX_SAFE_INTEGER + 1,
    1n, new Date('2026-01-01T00:00:00Z'), cyclic, [, 1], { unset: undefined }, () => 1];
  for (const value of invalid) assert.throws(() => admissionDigest(value));
});

test('scope requires explicit nonempty incarnation and routing references without undeclared fields', () => {
  for (const field of Object.keys(scope) as (keyof Scope)[]) {
    for (const value of ['', ' padded ', 'bad\nreference']) {
      assert.throws(() => createAdmissionBinding(work, { ...scope, [field]: value }));
    }
    const missing = { ...scope }; delete (missing as Partial<Scope>)[field];
    assert.throws(() => createAdmissionBinding(work, missing));
  }
  assert.throws(() => createAdmissionBinding(work, { ...scope, undeclared: 'value' } as Scope));
});

test('admission generation accepts exact positive PostgreSQL bigint text and refuses coercion', () => {
  assert.equal(createAdmissionBinding(work, scope, '9223372036854775807').generation, '9223372036854775807');
  for (const generation of ['0', '-1', '01', '1.0', '1e1', ' 1', '9223372036854775808', '', 1, 1n, null, undefined]) {
    // Omission intentionally has a default; explicit undefined has the same JS semantics.
    if (generation === undefined) continue;
    assert.throws(() => createAdmissionBinding(work, scope, generation as unknown as string));
  }
});

test('new start requires qualified readback and saves a durable run receipt before admission', async () => {
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  const result = await dispatchAdmissions(store, coordinator, options);
  assert.equal(result.admitted, 1); assert.equal(result.pending, 0); assert.equal(result.conflicts, 0);
  assert.equal(store.row().state, 'admitted'); assert.ok(store.row().receipt);
  assert.equal(store.row().expectedRunId, 'synthetic-run-1');
  assert.equal(coordinator.starts.length, 1); assert.equal(coordinator.reads.length, 1);
  assert.equal(coordinator.reads[0].runId, 'synthetic-run-1');
  assert.equal((await dispatchAdmissions(store, coordinator, options)).examined, 0);
  assert.equal(coordinator.starts.length, 1);
});

test('compatible existing execution admits one identity rather than treating duplicate error alone as success', async () => {
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  const binding = createAdmissionBinding(work, scope);
  coordinator.executions.set(binding.workflowId, executionFor(binding, 'existing-run'));
  const result = await dispatchAdmissions(store, coordinator, options);
  assert.equal(result.admitted, 1); assert.equal(store.row().state, 'admitted');
  assert.ok(store.row().receipt); assert.equal(coordinator.executions.size, 1);
  assert.ok(coordinator.reads.length >= 1, 'Duplicate IDs must have qualified binding readback');
});

const incompatible: { name: string; change: (binding: Binding, execution: Execution) => Execution }[] = [
  { name: 'tenant', change: (_binding, execution) => ({ ...execution, binding: { ...execution.binding, tenantId: 'other-tenant' } }) },
  { name: 'business ID', change: (_binding, execution) => ({ ...execution, binding: { ...execution.binding, businessId: 'other-business' } }) },
  { name: 'business incarnation', change: (_binding, execution) => ({ ...execution, binding: { ...execution.binding, businessIncarnation: 'restored-business' } }) },
  { name: 'environment incarnation', change: (_binding, execution) => ({ ...execution, binding: { ...execution.binding, environmentIncarnation: 'other-temporal-deployment' } }) },
  { name: 'namespace', change: (_binding, execution) => ({ ...execution, namespace: 'other-namespace' }) },
  { name: 'workflow ID', change: (_binding, execution) => ({ ...execution, workflowId: 'other-investigation' }) },
  { name: 'workflow type', change: (_binding, execution) => ({ ...execution, workflowType: 'other-workflow' }) },
  { name: 'task queue', change: (_binding, execution) => ({ ...execution, taskQueue: 'other-core-worker' }) },
  { name: 'actual argument digest', change: (_binding, execution) => ({ ...execution, inputDigest: '0'.repeat(64) }) },
  { name: 'semantic input digest', change: (binding, execution) => ({ ...execution,
    binding: createAdmissionBinding({ ...work, semanticInput: { changedMetricIds: ['refund_inr'] } }, scope, binding.generation) }) },
  { name: 'generation', change: (_binding, execution) => ({ ...execution, binding: { ...execution.binding, generation: '2' } }) },
  { name: 'binding workflow type', change: (_binding, execution) => ({ ...execution,
    // A native observation can be adversarial even though the trusted binding constructor fixes this type.
    binding: { ...execution.binding, workflowType: 'other-workflow' } as unknown as Binding }) },
];
for (const fixture of incompatible) {
  test(`existing ID with incompatible ${fixture.name} remains visible conflict without admission`, async () => {
    const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
    const binding = createAdmissionBinding(work, scope);
    const observed = fixture.change(binding, executionFor(binding));
    assert.ok(matchingExecution(binding, observed).length > 0);
    coordinator.executions.set(binding.workflowId, observed);
    const result = await dispatchAdmissions(store, coordinator, options);
    assert.equal(result.conflicts, 1); assert.equal(result.admitted, 0);
    assert.equal(store.row().state, 'conflict'); assert.ok(store.row().cause);
    assert.equal(store.row().receipt, undefined);
    assert.equal((await dispatchAdmissions(store, coordinator, options)).examined, 0);
  });
}

test('lost acknowledgement after accepted start reconciles to its one original run', async () => {
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  coordinator.acceptedStartFault = { name: 'TransportFailure', message: 'Synthetic acknowledgement lost', code: 'ECONNRESET' };
  const result = await dispatchAdmissions(store, coordinator, options);
  assert.equal(result.admitted, 1); assert.equal(store.row().state, 'admitted');
  assert.ok(store.row().receipt); assert.equal(coordinator.executions.size, 1);
  assert.equal(coordinator.starts.length, 1);
  assert.equal((await dispatchAdmissions(store, coordinator, options)).examined, 0);
});

for (const observation of ['missing', 'unavailable'] as const) {
  test(`${observation} readback stays owned and pending; bounded retries only reconcile the original start`, async () => {
    const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
    coordinator.acceptedStartFault = { name: 'TransportFailure', message: 'Synthetic acknowledgement lost', code: 'ECONNRESET' };
    coordinator.missing = observation === 'missing';
    if (observation === 'unavailable') coordinator.unavailable = { name: 'ReadbackFailure', message: 'Synthetic read service unavailable', code: 'READ_UNAVAILABLE' };
    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      const result = await dispatchAdmissions(store, coordinator, options);
      assert.equal(result.admitted, 0); assert.equal(result.pending, 1);
      assert.equal(store.row().state, 'pending'); assert.equal(store.row().attempts, attempt);
      assert.equal(store.row().receipt, undefined); assert.ok(store.row().cause);
      assert.equal(coordinator.starts.length, 1, 'Uncertain start must never be retransmitted by ordinary retries');
    }
    assert.equal((await dispatchAdmissions(store, coordinator, options)).examined, 0);
    assert.equal(coordinator.reads.length, options.maxAttempts);
    if (observation === 'unavailable') {
      assert.equal(store.row().cause?.message, 'Synthetic read service unavailable');
      assert.equal(store.row().cause?.code, 'READ_UNAVAILABLE');
    }
    assert.equal(coordinator.executions.size, 1);
  });
}

test('pending uncertainty later admits when qualified evidence becomes available, without fresh start', async () => {
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  coordinator.acceptedStartFault = { name: 'TransportFailure', message: 'Synthetic acknowledgement lost' };
  coordinator.missing = true;
  assert.equal((await dispatchAdmissions(store, coordinator, options)).pending, 1);
  coordinator.missing = false;
  assert.equal((await dispatchAdmissions(store, coordinator, options)).admitted, 1);
  assert.equal(coordinator.starts.length, 1); assert.equal(coordinator.executions.size, 1);
});

test('concurrent dispatchers claim the same row once and admit one workflow', async () => {
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  let release!: () => void; let entered!: () => void;
  const enteredStart = new Promise<void>(resolve => { entered = resolve; });
  const heldStart = new Promise<void>(resolve => { release = resolve; });
  coordinator.onAcceptedStart = async () => { entered(); await heldStart; };
  const first = dispatchAdmissions(store, coordinator, options);
  await enteredStart;
  const second = await dispatchAdmissions(store, coordinator, options);
  release();
  const one = await first;
  assert.equal(one.admitted + second.admitted, 1);
  assert.equal(coordinator.starts.length, 1); assert.equal(coordinator.executions.size, 1);
  assert.equal(store.row().attempts, 1); assert.equal(store.row().state, 'admitted');
});

test('expired claim cannot record or acknowledge acceptance; replacement claim reconciles the same run', async () => {
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  coordinator.onAcceptedStart = () => { store.now += options.leaseMs + 1; };
  const stale = await dispatchAdmissions(store, coordinator, options);
  assert.equal(stale.admitted, 0); assert.equal(stale.lostClaims, 1);
  assert.equal(store.row().state, 'pending'); assert.equal(store.row().receipt, undefined);
  coordinator.onAcceptedStart = undefined;
  const recovered = await dispatchAdmissions(store, coordinator, options);
  assert.equal(recovered.admitted, 1); assert.equal(store.row().attempts, 2);
  assert.equal(coordinator.starts.length, 1); assert.equal(coordinator.executions.size, 1);
});

test('a failed first readback does not hide a later admissible outbox row', async () => {
  const later: Work = { ...work, investigationId: 'synthetic-investigation-2' };
  const store = new MemoryStore([work, later]); const coordinator = new CoordinatorFixture();
  const baseRead = coordinator.read.bind(coordinator);
  coordinator.read = async (binding, runId) => binding.workflowId === work.investigationId
    ? { status: 'unavailable', cause: { name: 'ReadbackFailure', message: 'Synthetic first row unreadable' } }
    : baseRead(binding, runId);
  const result = await dispatchAdmissions(store, coordinator, options);
  assert.equal(result.examined, 2); assert.equal(result.pending, 1); assert.equal(result.admitted, 1);
  assert.equal(store.row().state, 'pending'); assert.equal(store.row(later.investigationId).state, 'admitted');
  assert.equal(coordinator.executions.size, 2);
});

test('returned run receipt inconsistent with actual execution cannot acknowledge admission', async () => {
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  coordinator.returnedReceipt = { workflowId: work.investigationId, runId: 'wrong-returned-run' };
  const result = await dispatchAdmissions(store, coordinator, options);
  assert.equal(result.admitted, 0); assert.equal(result.conflicts, 1);
  assert.equal(store.row().state, 'conflict'); assert.equal(store.row().receipt, undefined);
  assert.ok(matchingExecution(createAdmissionBinding(work, scope), executionFor(createAdmissionBinding(work, scope)), 'wrong-returned-run').length > 0);
});

test('native start timeout reconciles accepted identity with a deterministic deadline', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  let entered!: () => void; let release!: () => void;
  const startEntered = new Promise<void>(resolve => { entered = resolve; });
  const heldStart = new Promise<void>(resolve => { release = resolve; });
  coordinator.onAcceptedStart = async () => { entered(); await heldStart; };
  const dispatch = dispatchAdmissions(store, coordinator, options);
  await startEntered;
  context.mock.timers.tick(options.callTimeoutMs);
  const result = await dispatch;
  release();
  assert.equal(result.admitted, 1); assert.equal(store.row().state, 'admitted');
  assert.equal(coordinator.starts.length, 1); assert.equal(coordinator.executions.size, 1);
  assert.equal(store.row().cause?.name, 'AdmissionTimeout');
});

test('native readback timeout remains pending with its exact cause and no indefinite call', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  let entered!: () => void; let release!: () => void;
  const readEntered = new Promise<void>(resolve => { entered = resolve; });
  const heldRead = new Promise<void>(resolve => { release = resolve; });
  const baseRead = coordinator.read.bind(coordinator);
  coordinator.read = async (binding, runId) => { entered(); await heldRead; return baseRead(binding, runId); };
  const dispatch = dispatchAdmissions(store, coordinator, options);
  await readEntered;
  context.mock.timers.tick(options.callTimeoutMs);
  const result = await dispatch;
  release();
  assert.equal(result.admitted, 0); assert.equal(result.pending, 1);
  assert.equal(store.row().state, 'pending'); assert.equal(store.row().receipt, undefined);
  assert.equal(store.row().cause?.name, 'AdmissionTimeout');
  assert.equal(store.row().cause?.code, 'admission_call_timeout');
});

test('late accepted native start converges through read-only retry after timeout and missing readback', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  let entered!: () => void; let release!: () => void;
  const startEntered = new Promise<void>(resolve => { entered = resolve; });
  const heldStart = new Promise<void>(resolve => { release = resolve; });
  coordinator.onAcceptedStart = async () => { entered(); await heldStart; };
  coordinator.missing = true;
  const dispatch = dispatchAdmissions(store, coordinator, options);
  await startEntered;
  context.mock.timers.tick(options.callTimeoutMs);
  const unresolved = await dispatch;
  assert.equal(unresolved.pending, 1); assert.equal(store.row().state, 'pending');
  release(); coordinator.missing = false;
  const recovered = await dispatchAdmissions(store, coordinator, options);
  assert.equal(recovered.admitted, 1); assert.equal(store.row().state, 'admitted');
  assert.equal(coordinator.starts.length, 1); assert.equal(coordinator.executions.size, 1);
});

test('receipt uniqueness conflict reports the store committed outcome rather than the requested admission', async () => {
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  const baseFinish = store.finish.bind(store);
  store.finish = (claim, update) => baseFinish(claim, update.state === 'admitted'
    ? { state: 'conflict', cause: { name: 'ReceiptConflict', message: 'Synthetic run receipt already belongs to another authoritative admission' } }
    : update);
  const result = await dispatchAdmissions(store, coordinator, options);
  assert.equal(result.admitted, 0); assert.equal(result.conflicts, 1);
  assert.equal(store.row().state, 'conflict'); assert.equal(store.row().receipt, undefined);
});

test('crash after durable send intent but before transmission requires owned recovery instead of blind start', async () => {
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  store.row().binding = createAdmissionBinding(work, scope);
  store.row().startRequested = true;
  const result = await dispatchAdmissions(store, coordinator, options);
  assert.equal(result.pending, 1); assert.equal(result.admitted, 0);
  assert.equal(coordinator.starts.length, 0); assert.equal(store.row().state, 'pending');
  assert.ok(store.row().cause); assert.equal(store.row().receipt, undefined);
});

test('unqualified coordinator or invalid bounded retry policy refuses before claiming work', async () => {
  const store = new MemoryStore(); const coordinator = new CoordinatorFixture();
  await assert.rejects(() => dispatchAdmissions(store, undefined as unknown as WorkflowAdmissionPort, options));
  for (const invalid of [
    { maxAttempts: 0 }, { maxAttempts: 11 }, { batchSize: 0 }, { batchSize: 101 },
    { leaseMs: 2 * options.callTimeoutMs }, { callTimeoutMs: 0 }, { maxAttempts: 1.5 },
  ]) await assert.rejects(() => dispatchAdmissions(store, coordinator, { ...options, ...invalid }));
  assert.equal(store.row().attempts, 0); assert.equal(coordinator.starts.length, 0);
});
