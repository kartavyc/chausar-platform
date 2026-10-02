import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { dispatchPending, postgresAdmissionStore } from '../src/dispatcher.ts';
import { createAdmissionBinding } from '../src/workflow-admission.ts';
import type {
  AdmissionClaim, AdmissionExecution, AdmissionFinish, WorkflowAdmissionPort,
} from '../src/workflow-admission.ts';

/** These scripts exercise actual production adapter control flow and SQL/parameter
 * ordering through an injected query port. They do not execute SQL or qualify
 * PostgreSQL syntax, constraints, locking, permissions or native transactions.
 */
type QueryResult = { rows: Record<string, unknown>[]; rowCount: number | null };
type Step = {
  sql: string; values?: unknown[] | ((values: unknown[]) => void);
  result?: Partial<QueryResult>; error?: Error;
};
type ConnectionScript = { steps: Step[]; released: boolean; label: string };
class ScriptedPool {
  readonly calls: { connection: string; sql: string; values: unknown[] }[] = [];
  readonly connections: ConnectionScript[] = [];
  private usedConnections = 0;
  private poolSteps: Step[];
  constructor(poolSteps: Step[] = [], connectionSteps: Step[][] = []) {
    this.poolSteps = [...poolSteps];
    for (const [index, steps] of connectionSteps.entries()) this.connections.push({ steps: [...steps], released: false, label: `transaction-${index + 1}` });
  }
  asPool(): Pool { return this as unknown as Pool; }
  private execute(label: string, steps: Step[], sql: string, values: unknown[] = []): QueryResult {
    this.calls.push({ connection: label, sql, values });
    const step = steps.shift(); assert.ok(step, `Unexpected query on ${label}: ${sql}`);
    assert.ok(sql.replace(/\s+/g, ' ').includes(step.sql.replace(/\s+/g, ' ')), `Expected query containing ${step.sql}; received ${sql}`);
    if (typeof step.values === 'function') step.values(values);
    else assert.deepEqual(values, step.values ?? []);
    if (step.error) throw step.error;
    return { rows: step.result?.rows ?? [], rowCount: step.result?.rowCount ?? 0 };
  }
  async query(sql: string, values?: unknown[]): Promise<QueryResult> { return this.execute('pool', this.poolSteps, sql, values); }
  async connect() {
    const connection = this.connections[this.usedConnections++]; assert.ok(connection, 'Unexpected connection');
    return {
      query: async (sql: string, values?: unknown[]) => this.execute(connection.label, connection.steps, sql, values),
      release: () => { assert.equal(connection.released, false, 'Connection released twice'); connection.released = true; },
    };
  }
  assertDone(): void {
    assert.equal(this.poolSteps.length, 0, 'Unconsumed pool queries');
    assert.equal(this.usedConnections, this.connections.length, 'Unconsumed transactions');
    for (const connection of this.connections) {
      assert.equal(connection.steps.length, 0, `Unconsumed queries on ${connection.label}`);
      assert.equal(connection.released, true, `Unreleased ${connection.label}`);
    }
  }
}
const scope = {
  businessId: 'synthetic-business', businessIncarnation: 'business-1',
  environmentIncarnation: 'coordinator-1', namespace: 'synthetic-namespace', taskQueue: 'synthetic-queue',
};
const tenantId = 'synthetic-tenant'; const investigationId = 'synthetic-storage-investigation';
const semanticInput = {
  principalId: 'synthetic-agent', grantId: 'synthetic-grant', purpose: 'profitability',
  mandateId: 'synthetic-mandate', requestedBy: 'synthetic-human', requestId: 'synthetic-request',
  requestDigest: 'synthetic-request-digest', metricIds: ['gross_inr'], queryRegions: null,
  definitionRevision: null, modelInvocationId: null, inputExpiresAt: null,
};
const binding = createAdmissionBinding({ tenantId, investigationId, semanticInput }, scope);
const claim: AdmissionClaim = { binding, token: 'synthetic-claim-token', attempt: 1, startRequested: true, expectedRunId: 'synthetic-run' };
const execution: AdmissionExecution = {
  namespace: scope.namespace, workflowId: investigationId, runId: 'synthetic-run', workflowType: 'investigate',
  taskQueue: scope.taskQueue, inputDigest: binding.inputDigest, binding,
};
const cause = { name: 'ReadbackUnavailable', message: 'Synthetic coordinator readback unavailable', code: 'READ_UNAVAILABLE' };
const claimRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  tenant_id: tenantId, investigation_id: investigationId, attempts: 0, admission_generation: '1',
  admission_binding: null, start_requested_at: null, expected_run_id: null,
  principal_id: semanticInput.principalId, grant_id: semanticInput.grantId, purpose: semanticInput.purpose,
  mandate_id: semanticInput.mandateId, requested_by: semanticInput.requestedBy, request_id: semanticInput.requestId,
  request_digest: semanticInput.requestDigest, metric_ids: semanticInput.metricIds, query_regions: null,
  definition_revision: null, model_invocation_id: null, input_expires_at: null, ...overrides,
});
const begin = (): Step[] => [{ sql: 'BEGIN' }, { sql: "SET LOCAL statement_timeout='5s'" }];
const commit: Step = { sql: 'COMMIT' }; const rollback: Step = { sql: 'ROLLBACK' };
const selectedClaim = (row: Record<string, unknown>): Step => ({
  sql: 'FOR UPDATE OF o SKIP LOCKED FOR SHARE OF i', values: [tenantId, investigationId, 3], result: { rows: [row] },
});
const selectedFinish = (rows: Record<string, unknown>[] = [{ admission_binding: binding, expected_run_id: claim.expectedRunId }]): Step => ({
  sql: 'SELECT admission_binding,expected_run_id FROM chausar_core.work_outbox',
  values: [tenantId, investigationId, claim.token], result: { rows },
});
const admissionInsert = (result: Partial<QueryResult> = {}): Step => ({
  sql: 'INSERT INTO chausar_core.workflow_admissions',
  values: [tenantId, investigationId, binding.generation, binding.namespace, binding.workflowId,
    execution.runId, JSON.stringify(binding), JSON.stringify(execution)], result,
});
const admissionRead = (rows: Record<string, unknown>[] = [{ binding, execution_receipt: execution }]): Step => ({
  sql: 'SELECT binding,execution_receipt FROM chausar_core.workflow_admissions',
  values: [tenantId, investigationId, binding.generation], result: { rows },
});
function event(state: AdmissionFinish['state'], expectedCause: AdmissionFinish['cause'], startCause?: AdmissionFinish['startCause']): Step {
  return { sql: 'INSERT INTO chausar_core.workflow_admission_events',
    values: [tenantId, investigationId, claim.attempt, state,
      expectedCause === undefined ? null : JSON.stringify(expectedCause), startCause === undefined ? null : JSON.stringify(startCause)] };
}
function acknowledge(state: AdmissionFinish['state'], expectedCause: AdmissionFinish['cause'], rowCount = 1): Step {
  return { sql: "dispatched_at=CASE WHEN $4='admitted' THEN clock_timestamp() ELSE NULL END",
    values: [tenantId, investigationId, claim.token, state, expectedCause === undefined ? null : JSON.stringify(expectedCause)], result: { rowCount } };
}

test('SQL port listing binds exact tenant, attempt cap and bounded batch', async () => {
  const pool = new ScriptedPool([{ sql: 'SELECT investigation_id FROM chausar_core.work_outbox',
    values: [tenantId, 3, 25], result: { rows: [{ investigation_id: investigationId }] } }]);
  assert.deepEqual(await postgresAdmissionStore(pool.asPool()).listPending(tenantId, 25, 3), [investigationId]);
  const sql = pool.calls[0].sql;
  assert.ok(sql.includes('tenant_id=$1')); assert.ok(sql.includes('attempts<$2'));
  assert.ok(sql.includes('lease_until<=clock_timestamp()')); assert.ok(sql.includes('LIMIT $3'));
  pool.assertDone();
});

test('SQL port pins authoritative binding and claims ownership in one short transaction before any send', async () => {
  let token = '';
  const pool = new ScriptedPool([], [[...begin(), selectedClaim(claimRow()), {
    sql: 'UPDATE chausar_core.work_outbox SET admission_binding=$3::jsonb',
    values: values => {
      assert.deepEqual(values.slice(0, 2), [tenantId, investigationId]);
      assert.deepEqual(JSON.parse(values[2] as string), binding);
      assert.match(values[3] as string, /^[0-9a-f-]{36}$/); token = values[3] as string;
      assert.equal(values[4], 5000);
    }, result: { rows: [{ attempts: 1 }] },
  }, commit]]);
  const result = await postgresAdmissionStore(pool.asPool()).claim(tenantId, investigationId, scope, { maxAttempts: 3, leaseMs: 5000 });
  assert.deepEqual(result, { binding, token, attempt: 1, startRequested: false });
  assert.equal(pool.calls.every(call => call.connection === 'transaction-1'), true);
  pool.assertDone();
});

test('SQL port empty or locked claim commits no mutation and returns no ownership', async () => {
  const select = selectedClaim(claimRow()); select.result = { rows: [] };
  const pool = new ScriptedPool([], [[...begin(), select, commit]]);
  assert.equal(await postgresAdmissionStore(pool.asPool()).claim(tenantId, investigationId, scope, { maxAttempts: 3, leaseMs: 5000 }), undefined);
  pool.assertDone();
});

test('SQL port restored claim retains immutable binding, send intent and returned run receipt', async () => {
  const pool = new ScriptedPool([], [[...begin(), selectedClaim(claimRow({
    admission_binding: binding, attempts: 1, start_requested_at: new Date('2026-01-01T00:00:00Z'), expected_run_id: execution.runId,
  })), {
    sql: 'UPDATE chausar_core.work_outbox SET admission_binding=$3::jsonb',
    values: values => {
      assert.deepEqual(values.slice(0, 3), [tenantId, investigationId, JSON.stringify(binding)]);
      assert.equal(values[4], 5000);
    }, result: { rows: [{ attempts: 2 }] },
  }, commit]]);
  const restored = await postgresAdmissionStore(pool.asPool()).claim(tenantId, investigationId, scope, { maxAttempts: 3, leaseMs: 5000 });
  assert.ok(restored); assert.deepEqual(restored.binding, binding);
  assert.equal(restored.attempt, 2); assert.equal(restored.startRequested, true); assert.equal(restored.expectedRunId, execution.runId);
  pool.assertDone();
});

test('SQL port changed deployment scope creates visible conflict without claiming or rebinding', async () => {
  const expectedCause = { name: 'AdmissionConflict', code: 'deployment_binding_conflict',
    message: 'Configured deployment or outbox identity disagrees with the immutable admission binding' };
  const pool = new ScriptedPool([], [[...begin(), selectedClaim(claimRow({ admission_binding: binding, attempts: 1 })), {
    sql: "UPDATE chausar_core.work_outbox SET admission_state='conflict',last_cause=$3::jsonb",
    values: [tenantId, investigationId, JSON.stringify(expectedCause)],
  }, {
    sql: 'INSERT INTO chausar_core.workflow_admission_events', values: [tenantId, investigationId, 1, JSON.stringify(expectedCause)],
  }, commit]]);
  assert.equal(await postgresAdmissionStore(pool.asPool()).claim(tenantId, investigationId,
    { ...scope, environmentIncarnation: 'other-coordinator' }, { maxAttempts: 3, leaseMs: 5000 }), undefined);
  assert.equal(pool.calls.some(call => call.sql.includes('SET admission_binding=')), false);
  pool.assertDone();
});

test('SQL port records start intent only under exact tenant, token, binding and live claim fence', async () => {
  const values = [tenantId, investigationId, claim.token, JSON.stringify(binding)];
  const pool = new ScriptedPool([
    { sql: 'UPDATE chausar_core.work_outbox SET start_requested_at=clock_timestamp()', values, result: { rowCount: 1 } },
    { sql: 'UPDATE chausar_core.work_outbox SET start_requested_at=clock_timestamp()', values, result: { rowCount: 0 } },
  ]);
  const store = postgresAdmissionStore(pool.asPool());
  assert.equal(await store.markStartRequested(claim), true); assert.equal(await store.markStartRequested(claim), false);
  for (const call of pool.calls) {
    assert.ok(call.sql.includes('claim_token=$3')); assert.ok(call.sql.includes('lease_until>clock_timestamp()'));
    assert.ok(call.sql.includes('start_requested_at IS NULL')); assert.ok(call.sql.includes('admission_binding=$4::jsonb'));
  }
  pool.assertDone();
});

test('SQL port returned start run is fenced and immutable; stale receipt recording returns false', async () => {
  const values = [tenantId, investigationId, claim.token, execution.runId, JSON.stringify(binding)];
  const pool = new ScriptedPool([
    { sql: 'UPDATE chausar_core.work_outbox SET expected_run_id=$4', values, result: { rowCount: 1 } },
    { sql: 'UPDATE chausar_core.work_outbox SET expected_run_id=$4', values, result: { rowCount: 0 } },
  ]);
  const store = postgresAdmissionStore(pool.asPool());
  const receipt = { workflowId: investigationId, runId: execution.runId };
  assert.equal(await store.recordStartReceipt(claim, receipt), true); assert.equal(await store.recordStartReceipt(claim, receipt), false);
  assert.ok(pool.calls.every(call => call.sql.includes('expected_run_id IS NULL') && call.sql.includes('start_requested_at IS NOT NULL')));
  await assert.rejects(() => store.recordStartReceipt(claim, { workflowId: 'other-investigation', runId: execution.runId }));
  pool.assertDone();
});

for (const [name, rows] of [
  ['stale claim', []],
  ['changed immutable binding', [{ admission_binding: { ...binding, tenantId: 'other-tenant' }, expected_run_id: execution.runId }]],
] as [string, Record<string, unknown>[]][]) {
  test(`SQL port ${name} cannot acknowledge or write a receipt`, async () => {
    const pool = new ScriptedPool([], [[...begin(), selectedFinish(rows), commit]]);
    assert.equal(await postgresAdmissionStore(pool.asPool()).finish(claim, { state: 'admitted', receipt: execution }), false);
    assert.equal(pool.calls.some(call => /^\s*(INSERT|UPDATE)\b/.test(call.sql)), false);
    pool.assertDone();
  });
}

test('SQL port pending readback records exact cause but never dispatched acknowledgement', async () => {
  const pool = new ScriptedPool([], [[...begin(), selectedFinish(), event('pending', cause), acknowledge('pending', cause), commit]]);
  assert.equal(await postgresAdmissionStore(pool.asPool()).finish(claim, { state: 'pending', cause }), 'pending');
  assert.equal(pool.calls.some(call => call.sql.includes('INSERT INTO chausar_core.workflow_admissions\n')), false);
  assert.deepEqual(pool.calls.find(call => call.sql.includes('dispatched_at=CASE'))?.values[3], 'pending');
  pool.assertDone();
});

test('SQL port admission inserts and rereads immutable receipt before acknowledgement in the same transaction', async () => {
  const pool = new ScriptedPool([], [[...begin(), selectedFinish(), admissionInsert({ rowCount: 1 }), admissionRead(),
    event('admitted', undefined), acknowledge('admitted', undefined), commit]]);
  assert.equal(await postgresAdmissionStore(pool.asPool()).finish(claim, { state: 'admitted', receipt: execution }), 'admitted');
  assert.ok(pool.calls.every(call => call.connection === 'transaction-1'));
  const inserted = pool.calls.findIndex(call => call.sql.includes('INSERT INTO chausar_core.workflow_admissions\n'));
  const read = pool.calls.findIndex(call => call.sql.includes('SELECT binding,execution_receipt'));
  const ack = pool.calls.findIndex(call => call.sql.includes('dispatched_at=CASE'));
  assert.ok(inserted >= 0 && inserted < read && read < ack && ack < pool.calls.length - 1);
  pool.assertDone();
});

for (const kind of ['incompatible receipt', 'uniqueness collision'] as const) {
  test(`SQL port ${kind} downgrades admission to visible committed conflict`, async () => {
    const conflict = { name: 'AdmissionConflict', code: 'durable_receipt_conflict',
      message: 'Existing immutable admission receipt disagrees with the reconciled execution' };
    const rows = kind === 'uniqueness collision' ? [] : [{ binding, execution_receipt: { ...execution, runId: 'other-run' } }];
    const pool = new ScriptedPool([], [[...begin(), selectedFinish(), admissionInsert(), admissionRead(rows),
      event('conflict', conflict), acknowledge('conflict', conflict), commit]]);
    assert.equal(await postgresAdmissionStore(pool.asPool()).finish(claim, { state: 'admitted', receipt: execution }), 'conflict');
    pool.assertDone();
  });
}

test('SQL port changed run after durable start receipt rejects and rolls back before receipt insertion', async () => {
  const pool = new ScriptedPool([], [[...begin(), selectedFinish([{ admission_binding: binding, expected_run_id: 'other-native-run' }]), rollback]]);
  await assert.rejects(() => postgresAdmissionStore(pool.asPool()).finish(claim, { state: 'admitted', receipt: execution }), /Returned execution changed/);
  pool.assertDone();
});

test('SQL port expired final commit fence rolls back receipt, event and acknowledgement attempt', async () => {
  const pool = new ScriptedPool([], [[...begin(), selectedFinish(), admissionInsert({ rowCount: 1 }), admissionRead(),
    event('admitted', undefined), acknowledge('admitted', undefined, 0), rollback]]);
  await assert.rejects(() => postgresAdmissionStore(pool.asPool()).finish(claim, { state: 'admitted', receipt: execution }), /Admission commit fence lost/);
  assert.equal(pool.calls.some(call => call.sql === 'COMMIT'), false);
  pool.assertDone();
});

test('SQL port receipt insertion error rolls back and always releases its connection', async () => {
  const failedInsert = admissionInsert(); failedInsert.error = new Error('Synthetic insert failed');
  const pool = new ScriptedPool([], [[...begin(), selectedFinish(), failedInsert, rollback]]);
  await assert.rejects(() => postgresAdmissionStore(pool.asPool()).finish(claim, { state: 'admitted', receipt: execution }), /Synthetic insert failed/);
  pool.assertDone();
});

test('SQL port claim query error rolls back and releases without binding or send eligibility', async () => {
  const failedSelect = selectedClaim(claimRow()); failedSelect.error = new Error('Synthetic authority query failed');
  const pool = new ScriptedPool([], [[...begin(), failedSelect, rollback]]);
  await assert.rejects(() => postgresAdmissionStore(pool.asPool()).claim(tenantId, investigationId, scope, { maxAttempts: 3, leaseMs: 5000 }), /Synthetic authority query failed/);
  assert.equal(pool.calls.some(call => call.sql.includes('SET admission_binding=')), false);
  pool.assertDone();
});

test('SQL port unresolved admission retains independent startup and readback causes in its event', async () => {
  const startCause = { name: 'TransportFailure', message: 'Synthetic accepted start acknowledgement lost', code: 'ECONNRESET' };
  const pool = new ScriptedPool([], [[...begin(), selectedFinish(), event('pending', cause, startCause), acknowledge('pending', cause), commit]]);
  assert.equal(await postgresAdmissionStore(pool.asPool()).finish(claim, { state: 'pending', cause, startCause }), 'pending');
  const observation = pool.calls.find(call => call.sql.includes('(tenant_id,investigation_id,attempt,state,cause,start_cause)'));
  assert.ok(observation); assert.deepEqual(JSON.parse(observation.values[4] as string), cause);
  assert.deepEqual(JSON.parse(observation.values[5] as string), startCause);
  pool.assertDone();
});

test('SQL port durable receipt conflict preserves startup cause during committed downgrade', async () => {
  const startCause = { name: 'TransportFailure', message: 'Synthetic accepted start acknowledgement lost', code: 'ECONNRESET' };
  const conflict = { name: 'AdmissionConflict', code: 'durable_receipt_conflict',
    message: 'Existing immutable admission receipt disagrees with the reconciled execution' };
  const pool = new ScriptedPool([], [[...begin(), selectedFinish(), admissionInsert(), admissionRead([]),
    event('conflict', conflict, startCause), acknowledge('conflict', conflict), commit]]);
  assert.equal(await postgresAdmissionStore(pool.asPool()).finish(claim, { state: 'admitted', receipt: execution, startCause }), 'conflict');
  pool.assertDone();
});

test('SQL port commit error attempts rollback and releases its owned connection', async () => {
  const failedCommit: Step = { sql: 'COMMIT', error: new Error('Synthetic commit acknowledgement failed') };
  const pool = new ScriptedPool([], [[...begin(), selectedFinish(), event('pending', cause), acknowledge('pending', cause), failedCommit, rollback]]);
  await assert.rejects(() => postgresAdmissionStore(pool.asPool()).finish(claim, { state: 'pending', cause }), /Synthetic commit acknowledgement failed/);
  pool.assertDone();
});

test('legacy dispatchPending without explicit scope refuses before any database query', async () => {
  const pool = new ScriptedPool();
  const port: WorkflowAdmissionPort = {
    start: async () => { throw new Error('Unexpected native start'); },
    read: async () => { throw new Error('Unexpected native read'); },
  };
  await assert.rejects(() => dispatchPending(pool.asPool(), port, scope.taskQueue, tenantId, undefined as never), /Explicit admission deployment scope/);
  assert.deepEqual(pool.calls, []); pool.assertDone();
});
