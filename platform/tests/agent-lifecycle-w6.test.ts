import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import { registerAgentJob, stopAgentJob, stopClientAgentJobs } from '../runtime/venture/agent-runtime/lifecycle.ts';
import { VentureTestStore } from './venture-test-store.ts';

test('active job interruption is scoped by store, run and client, with idempotent release', () => {
  const store = new VentureTestStore(initialState('One')), other = new VentureTestStore(initialState('Two'));
  const stopped: string[] = [];
  const release = registerAgentJob(store, { runId: 'one', clientId: 'client-one', jobId: 'job-one' }, () => stopped.push('one'));
  registerAgentJob(store, { runId: 'two', clientId: 'client-two', jobId: 'job-two' }, () => stopped.push('two'));
  registerAgentJob(other, { runId: 'one', clientId: 'client-one', jobId: 'job-one' }, () => stopped.push('other'));
  assert.equal(stopAgentJob(store, 'one'), true); assert.deepEqual(stopped, ['one']);
  assert.equal(stopAgentJob(store, 'one'), false); release(); release();
  stopClientAgentJobs(store, 'client-two'); assert.deepEqual(stopped, ['one', 'two']);
  stopClientAgentJobs(other, 'client-one'); assert.deepEqual(stopped, ['one', 'two', 'other']);
});
