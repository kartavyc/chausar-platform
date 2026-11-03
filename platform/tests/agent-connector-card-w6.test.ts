// W6 6F5 (D34): a send through the tool's own Gmail connection is Chausar's normal exact approval card. On Today it says
// what approving does (it sends that exact message once), not the generic "outside actions still need their own
// approval", because here approving is the outside action. The card keeps the full arguments and resolves once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness, installKitFixture, owner } from './fixtures/venture/kit-business.ts';
import { findRecord, ventureAction } from '../runtime/venture/records.ts';
import { createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { agreeClientAiConsent, getClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { requestAgentApproval, decideAgentApproval } from '../runtime/venture/agent-runtime/approvals.ts';
import type { AgentApprovalRequest } from '../runtime/venture/agent-runtime/driver-types.ts';
import { queueListHandler } from '../runtime/venture/views/queue.ts';

test('6F5: a Gmail send is the exact approval card on Today, worded as the send it is, and approved once', async t => {
  t.after(installKitFixture()); const env = await kitBusiness();
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: 'A plain voice sheet.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  const consent = await getClientAiConsent(env.deps, owner, { clientId: env.client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: env.client.id, disclosureDigest: consent.disclosureDigest });
  const run = await ventureAction(env.deps, owner, 'prepare', 'test.run', tx => tx.put({ ...tx.base('venture-delivery-run'), orderId: order.id, playbookId: 'sample', playbookHash: 'sample', status: 'waiting-for-you', servedBy: 'model', practice: false, callId: null, preview: null, deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null }));
  const job = await createNativeJob(env.deps, owner, run.id, { agentId: 'writer', sections: ['Reply'], check: () => undefined });
  t.after(() => job.capability.close());
  const request: AgentApprovalRequest = { kind: 'connector-send', requestId: 'codex-elicitation:7', threadId: 'thread-one', turnId: 'turn-one', itemId: 'call-1', name: 'Gmail: send_email',
    arguments: { to: ['client@example.org'], subject: 'Your voice sheet', body: 'Hello, the sheet is attached.' }, description: 'Codex wants to send this through your own Gmail connection in ChatGPT. Approving sends exactly this, once.' };
  const waiting = requestAgentApproval(env.deps, owner, run.id, request, { signal: new AbortController().signal, guard: state => { job.assertState(state); } });
  let pending = findRecord(env.store.read(), 'venture-delivery-run', run.id)!.agentJob?.pendingApproval;
  for (let i = 0; i < 200 && !pending; i++) { await new Promise(resolve => setTimeout(resolve, 5)); pending = findRecord(env.store.read(), 'venture-delivery-run', run.id)!.agentJob?.pendingApproval; }
  assert.ok(pending);
  assert.deepEqual(pending.request.arguments, request.arguments);
  const row = (await queueListHandler(env.deps, owner, { scope: 'current' })).rows.find(item => item.viewRef?.id === run.id)!;
  assert.equal(row.title, 'Approve one send');
  assert.equal(row.line, 'Read the exact message first. Approving sends it once through your own connection.');
  assert.doesNotMatch(row.line, /still need their own approval/);
  await decideAgentApproval(env.deps, owner, { runId: run.id, digest: pending.digest, decision: 'approve' });
  assert.equal(await waiting, true);
  await assert.rejects(decideAgentApproval(env.deps, owner, { runId: run.id, digest: pending.digest, decision: 'approve' }), { code: 'APPROVAL_STALE' });
});
