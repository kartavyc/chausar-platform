import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeJudgeBusiness, readyNativeDraft } from './native-judge-business.ts';
import { owner, PLAIN_IDEA } from './venture-judge-helpers.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { eraseAgentJobs } from '../runtime/venture/agent-runtime/privacy.ts';
import { registerAgentJob } from '../runtime/venture/agent-runtime/lifecycle.ts';
import { net, personNamed } from './venture-network-env.ts';

test('Forget erases current and earlier same-job quality payloads while calls are in flight, preserving costs and other jobs', async () => {
  const env = await nativeJudgeBusiness(PLAIN_IDEA);
  await env.call('venture.judge.auto.set', { auto: false });
  const run = await readyNativeDraft(env);
  const live = listRecords(env.store.read(), 'venture-delivery-run').find(row => row.id === run.id)!;
  await ventureAction(env.deps, owner, 'prepare', 'test.private-quality-calls', tx => {
    tx.replace({ ...live, callId: 'current-preview' });
    for (const [id, status, jobId] of [
      ['current-preview', 'preview', live.agentJob!.scope.jobId],
      ['inflight', 'dispatching', live.agentJob!.scope.jobId],
      ['prior-failed', 'failed', live.agentJob!.scope.jobId],
      ['other-job', 'completed', 'another-job'],
    ] as const) tx.put({ ...tx.base('venture-model-call'), id, status, purpose: 'judge', agentId: id === 'other-job' ? undefined : live.agentJob!.scope.agentId,
      agentJobId: jobId, payloadText: 'Opaque private source', error: { code: 'MODEL_FAILED', message: 'Opaque private provider error' }, costMicros: '17' } as any);
    eraseAgentJobs(tx, new Set([env.client.id]));
  });
  const calls = listRecords(env.store.read(), 'venture-model-call');
  for (const id of ['current-preview', 'inflight', 'prior-failed']) {
    const call = calls.find(row => row.id === id)!;
    assert.equal(call.payloadText, '', id); assert.equal(call.error!.message, '', id);
    assert.ok(call.erasedAt, id); assert.equal(call.costMicros, '17', id);
  }
  assert.equal(calls.find(row => row.id === 'current-preview')!.status, 'expired');
  assert.equal(calls.find(row => row.id === 'inflight')!.status, 'dispatching', 'the possible charge stays unresolved until the provider answers');
  assert.equal(calls.find(row => row.id === 'other-job')!.payloadText, 'Opaque private source');
});

test('Forget matches private native job data without a client link and interrupts only the affected run after deletion', async () => {
  const env = await nativeJudgeBusiness(PLAIN_IDEA);
  await env.call('venture.judge.auto.set', { auto: false });
  const run = await readyNativeDraft(env), other = await readyNativeDraft(env, 'Please advise on another product.');
  await ventureAction(env.deps, owner, 'prepare', 'test.named-job-data', tx => {
    const current = tx.find('venture-delivery-run', run.id)!;
    tx.replace({ ...current, agentJob: { ...current.agentJob!, ownerNotes: [{ text: 'Private notes from Nina Sen.', at: tx.now, by: owner.memberId }] } });
    tx.put({...tx.base('venture-model-call'),id:'dispatched-chat',status:'dispatching',purpose:'agent-chat',payloadText:'Nina Sen private chat context',costMicros:'17'} as any);
  });
  let interrupted = false;
  const release = registerAgentJob(env.store, { runId: run.id, jobId: 'synthetic-active-job', clientId: env.client.id }, () => {
    assert.ok(!listRecords(env.store.read(), 'venture-delivery-run').some(row => row.id === run.id), 'deletion commits first');
    interrupted = true;
  });
  try {
    await net(env as never, 'venture.network.import', { kind: 'contacts-csv', name: 'contacts.csv', text: 'Name,E-mail 1 - Value\nNina Sen,nina@synthetic.example' });
    const person = personNamed(env as never, 'Nina Sen'); assert.equal(person.clientId, null);
    await net(env as never, 'venture.network.forget', { id: person.id });
    assert.equal(interrupted, true);
    const call=listRecords(env.store.read(),'venture-model-call').find(row=>row.id==='dispatched-chat')!;
    assert.ok(!call.payloadText.includes('Nina Sen'));assert.ok(call.erasedAt);assert.equal(call.costMicros,'17');assert.equal(call.status,'dispatching');
    assert.ok(listRecords(env.store.read(), 'venture-delivery-run').some(row => row.id === other.id));
    assert.ok(listRecords(env.store.read(), 'venture-client').find(row => row.id === env.client.id)!.aiConsent, 'unrelated client consent stays');
  } finally { release(); }
});
