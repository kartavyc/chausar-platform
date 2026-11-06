import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, seedBlueprint, seedOrder, seedRun, owner } from './venture-views-env.ts';
import { agreeClientAiConsent, getClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { canResumeAgentJob, createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { registerAgentJob } from '../runtime/venture/agent-runtime/lifecycle.ts';
import { runsStopHandler, runsResumeHandler, runsSteerHandler, runsRoundGateHandler } from '../runtime/venture/delivery/run-controls.ts';
import { findRecord, ventureAction } from '../runtime/venture/records.ts';
import { networkForget } from '../runtime/venture/network/forget.ts';

async function fixture() {
  const env = await setup(), { client, order } = await seedOrder(env, await seedBlueprint(env));
  const run = await seedRun(env, order, {});
  await ventureAction(env.deps, owner, 'prepare', 'test.stage', tx => tx.touch({ launchStage: 'approve-each' }));
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  const consent = await getClientAiConsent(env.deps, owner, { clientId: client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: client.id, disclosureDigest: consent.disclosureDigest });
  const job = await createNativeJob(env.deps, owner, run.id, { agentId: 'delivery', sections: ['Reply'], check: () => undefined });
  return { ...env, client, order, run, job };
}

test('owner Stop interrupts native work immediately and Resume cannot create a legacy preview', async t => {
  const env = await fixture(); t.after(() => env.job.capability.close());
  let stopped = 0;
  t.after(registerAgentJob(env.store, env.job.capability.scope, () => stopped++));
  await runsStopHandler(env.deps, owner, { runId: env.run.id });
  assert.equal(stopped, 1);
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.status, 'stopped');
  assert.throws(() => env.job.capability.assert(), { code: 'JOB_CLOSED' });
  await assert.rejects(runsResumeHandler(env.deps, owner, { runId: env.run.id }), { code: 'RUN_RESTART_REQUIRED' });
});

test('owner steering stops the native job and keeps instructions for source-bound continuation without a legacy preview', async t => {
  const env = await fixture(); t.after(() => env.job.capability.close());
  let stopped = 0;
  t.after(registerAgentJob(env.store, env.job.capability.scope, () => stopped++));
  await runsSteerHandler(env.deps, owner, { runId: env.run.id, text: 'Use shorter sentences' });
  const saved = findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!;
  assert.equal(stopped, 1); assert.equal(saved.status, 'stopped');
  assert.equal(saved.agentJob!.ownerNotes![0].text, 'Use shorter sentences');
  assert.equal(canResumeAgentJob(env.store.read(), saved), true);
  await assert.rejects(runsRoundGateHandler(env.deps, owner, { runId: env.run.id, on: true }), { code: 'RUN_CONTROL_UNAVAILABLE' });
  await ventureAction(env.deps, owner, 'prepare', 'test.retired', tx => {
    const { agentJob: _job, ...run } = tx.find('venture-delivery-run', env.run.id)!;
    tx.replace({ ...run, status: 'stopped', harness: null });
  });
  await assert.rejects(runsResumeHandler(env.deps, owner, { runId: env.run.id }), { code: 'RUN_RESTART_REQUIRED' });
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.preview, null);
});

test('Forget removes native consent and saved job data, interrupts only that client and preserves invoice prices', async t => {
  const env = await fixture(); t.after(() => env.job.capability.close());
  let stopped = 0, otherStopped = 0;
  t.after(registerAgentJob(env.store, env.job.capability.scope, () => stopped++));
  t.after(registerAgentJob(env.store, { runId: 'other-run', jobId: 'other-job', clientId: 'other-client' }, () => otherStopped++));
  const person = await ventureAction(env.deps, owner, 'prepare', 'test.native-data', tx => {
    const person = tx.put({ ...tx.base('venture-person'), name: env.client.name, handles: { emails: [], phones: [], linkedinUrl: null }, role: null, roles: [], facts: [], hidden: false, clientId: env.client.id, history: [] });
    const run = tx.find('venture-delivery-run', env.run.id)!;
    tx.replace({ ...run, renderedText: 'Private native draft marker', agentJob: { ...run.agentJob!, messages: [{ id: 'private-note', text: 'Private native note marker', label: 'model-estimate' }] } });
    tx.put({ ...tx.base('venture-agent-message'), agent: 'delivery', from: 'agent', text: 'Private native chat marker', parts: [{ kind: 'estimate', text: 'Private native chat marker' }], author: 'model', callId: null, runId: run.id, proposalId: null, suggestion: null, answered: null });
    tx.put({ ...tx.base('venture-work-table'), name: 'Private native table marker', columns: ['text'], rows: [], source: { kind: 'picked', uploadIds: [] }, runRef: { kind: 'delivery', runId: run.id }, digest: 'sample' });
    tx.put({ ...tx.base('venture-work-receipt'), operation: 'work.sum', runRef: { kind: 'delivery', runId: run.id }, currency: 'INR', inputs: { tables: [], columns: {}, rowIds: [] }, steps: [], figures: [], reconciliation: null, allowedNumbers: [], explanation: 'Private native receipt marker', digest: 'sample' });
    return person;
  });
  await networkForget(env.deps, owner, { id: person.id });
  assert.equal(stopped, 1); assert.equal(otherStopped, 0);
  assert.equal(findRecord(env.store.read(), 'venture-client', env.client.id)?.aiConsent, undefined);
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id), undefined);
  assert.ok(!JSON.stringify(env.store.read()).includes('Private native'));
  assert.ok(findRecord(env.store.read(), 'venture-price-receipt', env.order.priceReceiptId));
});
