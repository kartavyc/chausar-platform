import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdmissionBinding, matchingExecution } from '../src/workflow-admission.ts';
import { admissionMemoKey, assertSettledAdmissions, temporalAdmissionPort } from '../src/temporal-admission.ts';
import type { StoredAdmission, TemporalAdmissionAccess } from '../src/temporal-admission.ts';

const scope = { businessId: 'demo', businessIncarnation: 'business-1', environmentIncarnation: 'environment-1',
  namespace: 'fixture-namespace', taskQueue: 'fixture-queue' };
const binding = createAdmissionBinding({ tenantId: 'demo', investigationId: 'investigation-1',
  semanticInput: { metricIds: ['gross_inr'], grantId: 'grant-1' } }, scope, '7');
const payload = (value: unknown) => ({ decoded: structuredClone(value) });
function history(runId = 'original-run', changes: Record<string, unknown> = {}) {
  return { events: [{ eventId: '1', workflowExecutionStartedEventAttributes: {
    firstExecutionRunId: runId, originalExecutionRunId: runId,
    workflowType: { name: 'investigate' }, taskQueue: { name: scope.taskQueue },
    input: { payloads: [payload({ investigationId: binding.investigationId })] },
    memo: { fields: { [admissionMemoKey]: payload(binding) } }, ...changes,
  } }] };
}
function native(overrides: Partial<TemporalAdmissionAccess> = {}): TemporalAdmissionAccess {
  return { namespace: scope.namespace,
    start: async () => ({ workflowId: binding.workflowId, runId: 'original-run' }),
    history: async () => history(), decode: value => (value as { decoded: unknown }).decoded, ...overrides };
}

test('native start receives exact arguments, reject-duplicate policy and immutable binding memo', async () => {
  const calls: unknown[] = [];
  const port = temporalAdmissionPort(native({ start: async (...args) => {
    calls.push(args); return { workflowId: binding.workflowId, runId: 'original-run' };
  } }));
  assert.deepEqual(await port.start({ binding, args: [{ investigationId: binding.investigationId }],
    workflowIdReusePolicy: 'REJECT_DUPLICATE' }), { workflowId: binding.workflowId, runId: 'original-run' });
  assert.deepEqual(calls, [['investigate', { workflowId: binding.workflowId, taskQueue: scope.taskQueue,
    args: [{ investigationId: binding.investigationId }], workflowIdReusePolicy: 'REJECT_DUPLICATE',
    memo: { [admissionMemoKey]: binding } }]]);
  await assert.rejects(() => port.start({ binding: { ...binding, namespace: 'wrong' },
    args: [{ investigationId: binding.investigationId }], workflowIdReusePolicy: 'REJECT_DUPLICATE' }), /namespace/);
  assert.equal(calls.length, 1);
});

test('current run metadata cannot replace pinned original start history', async () => {
  const calls: unknown[] = [];
  const port = temporalAdmissionPort(native({ history: async (workflowId, runId) => {
    calls.push([workflowId, runId]);
    return runId === 'original-run' ? history() : history('original-run', {
      originalExecutionRunId: 'later-run', continuedExecutionRunId: 'previous-run',
      workflowType: { name: 'different-current-type' }, input: { payloads: [payload({ other: true })] },
      memo: { fields: { [admissionMemoKey]: payload({ ...binding, generation: '99' }) } },
    });
  }, decode: async value => (value as { decoded: unknown }).decoded }));
  const result = await port.read(binding);
  assert.equal(result.status, 'found');
  if (result.status !== 'found') throw Error('Fixture evidence must be found');
  assert.deepEqual(matchingExecution(binding, result.execution, 'original-run'), []);
  assert.deepEqual(calls, [[binding.workflowId, undefined], [binding.workflowId, 'original-run']]);
});

test('known original run receipt pins both history lookups', async () => {
  const calls: unknown[] = [];
  const result = await temporalAdmissionPort(native({ history: async (...args) => {
    calls.push(args); return history();
  } })).read(binding, 'original-run');
  assert.equal(result.status, 'found');
  assert.deepEqual(calls, [[binding.workflowId, 'original-run'], [binding.workflowId, 'original-run']]);
});

test('original type, queue, arguments and binding mismatches are observed rather than copied from the caller', async () => {
  for (const [changes, mismatch] of [
    [{ workflowType: { name: 'wrong-type' } }, 'workflowType'],
    [{ taskQueue: { name: 'wrong-queue' } }, 'taskQueue'],
    [{ input: { payloads: [payload({ investigationId: 'different-work' })] } }, 'inputDigest'],
    [{ memo: { fields: { [admissionMemoKey]: payload({ ...binding, generation: '8' }) } } }, 'binding'],
  ] as const) {
    const result = await temporalAdmissionPort(native({ history: async () => history('original-run', changes) })).read(binding);
    assert.equal(result.status, 'found');
    if (result.status === 'found') assert.ok(matchingExecution(binding, result.execution).includes(mismatch));
  }
});

test('missing, partial, chained-only and undecodable original evidence stays unavailable', async () => {
  for (const value of [undefined, { events: [] }, { events: [{ eventId: '2' }] },
    history('original-run', { memo: { fields: {} } }),
    history('original-run', { originalExecutionRunId: 'later-run' }),
    history('original-run', { continuedExecutionRunId: 'previous-run' }),
  ]) {
    assert.equal((await temporalAdmissionPort(native({ history: async () => value })).read(binding)).status, 'unavailable');
  }
  const result = await temporalAdmissionPort(native({ decode: () => { throw Error('Codec payload contains restricted content'); } })).read(binding);
  assert.equal(result.status, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('restricted content'));
});

function stored(): StoredAdmission {
  return { tenant_id: 'demo', investigation_id: binding.investigationId, admission_generation: '7',
    admission_state: 'admitted', dispatched_at: 'fixture-dispatch-time', expected_run_id: 'original-run',
    admission_binding: binding, execution_receipt: { namespace: scope.namespace, workflowId: binding.workflowId,
      runId: 'original-run', workflowType: 'investigate', taskQueue: scope.taskQueue,
      inputDigest: binding.inputDigest, binding } };
}

test('runner gate accepts only scope/generation/run-bound durable acknowledgement', () => {
  assertSettledAdmissions([stored()], 'demo', scope);
  // A lost start response can be reconciled from original history without a transport receipt.
  assertSettledAdmissions([{ ...stored(), expected_run_id: null }], 'demo', scope);
  for (const changes of [
    { admission_state: 'pending' }, { admission_state: 'conflict' }, { admission_state: 'legacy_unverified' },
    { dispatched_at: null }, { admission_binding: null }, { execution_receipt: null },
    { admission_generation: '8' }, { tenant_id: 'another-tenant' }, { expected_run_id: 'wrong-run' },
  ]) assert.throws(() => assertSettledAdmissions([{ ...stored(), ...changes }], 'demo', scope), /unresolved or conflicting/);
  assert.throws(() => assertSettledAdmissions([stored()], 'demo', { ...scope, environmentIncarnation: 'another-deployment' }), /unresolved or conflicting/);
  assert.throws(() => assertSettledAdmissions([stored(), { ...stored(), investigation_id: 'exhausted', admission_state: 'pending' }], 'demo', scope), /exhausted/);
});
