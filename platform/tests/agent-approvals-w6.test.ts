import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness, installKitFixture, owner } from './fixtures/venture/kit-business.ts';
import { findRecord, ventureAction } from '../runtime/venture/records.ts';
import { createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { agreeClientAiConsent, getClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { requestAgentApproval, decideAgentApproval } from '../runtime/venture/agent-runtime/approvals.ts';
import type { AgentApprovalRequest } from '../runtime/venture/agent-runtime/driver-types.ts';
import { queueListHandler } from '../runtime/venture/views/queue.ts';

async function fixture(t: { after(fn: () => void): void }) {
  t.after(installKitFixture()); const env = await kitBusiness();
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'A plain voice sheet.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  const consent = await getClientAiConsent(env.deps, owner, { clientId: env.client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: env.client.id, disclosureDigest: consent.disclosureDigest });
  const run = await ventureAction(env.deps, owner, 'prepare', 'test.run', tx => tx.put({ ...tx.base('venture-delivery-run'), orderId: order.id, playbookId: 'sample', playbookHash: 'sample', status: 'waiting-for-you', servedBy: 'model', practice: false, callId: null, preview: null, deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null }));
  const job = await createNativeJob(env.deps, owner, run.id, { agentId: 'writer', sections: ['Reply'], check: () => undefined });
  t.after(() => job.capability.close());
  const pending = () => findRecord(env.store.read(), 'venture-delivery-run', run.id)!.agentJob?.pendingApproval;
  async function ready() { for (let i = 0; i < 200; i++) { const value = pending(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('Approval was not persisted'); }
  const request: AgentApprovalRequest = { kind: 'file-change', requestId: 'request-one', threadId: 'thread-one', turnId: 'turn-one', itemId: 'item-one', name: 'Write', arguments: { file_path: 'draft.txt', content: 'Exact sample draft.' } };
  const abort = new AbortController();
  return { ...env, order, run, request, abort, pending, ready, options: { signal: abort.signal, guard: (state: Parameters<typeof job.assertState>[0]) => { job.assertState(state); } } };
}

test('native manual approval persists the full exact request, appears on Today and resolves only once after owner decision', async t => {
  const env = await fixture(t);
  const waiting = requestAgentApproval(env.deps, owner, env.run.id, env.request, env.options);
  const pending = await env.ready();
  env.request.arguments.content = 'Mutated later';
  assert.equal(pending.request.arguments.content, 'Exact sample draft.');
  const rows = (await queueListHandler(env.deps, owner, { scope: 'current' })).rows;
  assert.ok(rows.some(row => row.kind === 'question' && row.viewRef?.id === env.run.id));
  await assert.rejects(decideAgentApproval(env.deps, owner, { runId: env.run.id, digest: 'old', decision: 'approve' }), { code: 'APPROVAL_STALE' });
  await assert.rejects(decideAgentApproval(env.deps, { ...owner, channel: 'mcp' }, { runId: env.run.id, digest: pending.digest, decision: 'approve' }), { code: 'APP_APPROVAL_REQUIRED' });
  await decideAgentApproval(env.deps, owner, { runId: env.run.id, digest: pending.digest, decision: 'approve' });
  assert.equal(await waiting, true); assert.equal(env.pending(), undefined);
  await assert.rejects(decideAgentApproval(env.deps, owner, { runId: env.run.id, digest: pending.digest, decision: 'approve' }), { code: 'APPROVAL_STALE' });
  assert.ok(env.store.read().conversations.some(row => row.kind === 'venture-decision' && row.action === 'approve'));
});

test('manual approval rejects secrets, changed sources, aborts and stale requests without widening permission', async t => {
  const env = await fixture(t), secret = ['synthetic', '-private-credential'].join('');
  await assert.rejects(requestAgentApproval(env.deps, owner, env.run.id, { ...env.request, arguments: { content: secret } }, { ...env.options, secretValues: [secret] }), { code: 'SECRET_DETECTED' });
  const escapedSecret = 'synthetic"private-value';
  await assert.rejects(requestAgentApproval(env.deps, owner, env.run.id, { ...env.request, arguments: { content: escapedSecret } }, { ...env.options, secretValues: [escapedSecret], signal: AbortSignal.timeout(100) }), { code: 'SECRET_DETECTED' });
  assert.equal(env.pending(), undefined);
  const waiting = requestAgentApproval(env.deps, owner, env.run.id, env.request, env.options);
  const pending = await env.ready();
  await ventureAction(env.deps, owner, 'prepare', 'test.change', tx => tx.replace({ ...env.order, request: 'Changed client request' }));
  await assert.rejects(decideAgentApproval(env.deps, owner, { runId: env.run.id, digest: pending.digest, decision: 'approve' }), { code: 'JOB_SOURCE_CHANGED' });
  assert.equal(await Promise.race([waiting, new Promise(resolve => setTimeout(() => resolve('still waiting'), 100))]), false);
  env.abort.abort(); assert.equal(await waiting, false); assert.equal(env.pending(), undefined);
});

test('aborting a manual request removes its card, refreshes Today and cannot be approved after restart', async t => {
  const env = await fixture(t);
  const waiting = requestAgentApproval(env.deps, owner, env.run.id, env.request, env.options);
  const pending = await env.ready();
  const before = new Set(env.store.read().conversations.filter(row => row.kind === 'venture-event').map(row => row.id));
  env.abort.abort(); assert.equal(await waiting, false); assert.equal(env.pending(), undefined);
  assert.ok(env.store.read().conversations.some(row => row.kind === 'venture-event' && !before.has(row.id) && row.name === 'queue.changed'));
  await ventureAction(env.deps, owner, 'prepare', 'test.orphan', tx => {
    const run = tx.find('venture-delivery-run', env.run.id)!;
    tx.replace({ ...run, agentJob: { ...run.agentJob!, pendingApproval: pending } });
  });
  await assert.rejects(decideAgentApproval(env.deps, owner, { runId: env.run.id, digest: pending.digest, decision: 'approve' }), { code: 'APPROVAL_STALE' });
});
