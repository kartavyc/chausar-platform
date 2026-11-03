import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access } from 'node:fs/promises';
import { runNativeAgent } from '../runtime/venture/agent-runtime/runner.ts';
import type { AgentDriver, AgentDriverInput } from '../runtime/venture/agent-runtime/driver-types.ts';
import { agreeClientAiConsent, getClientAiConsent, withdrawClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { setup, seedBlueprint, seedOrder, seedRun, owner } from './venture-views-env.ts';
import { findRecord, ventureAction } from '../runtime/venture/records.ts';
import { canResumeAgentJob, createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { runsSteerHandler, runsStopHandler } from '../runtime/venture/delivery/run-controls.ts';

async function fixture(allow = true) {
  const env = await setup(); const { client, order } = await seedOrder(env, await seedBlueprint(env));
  const run = await seedRun(env, order, {});
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  if (allow) {
    const view = await getClientAiConsent(env.deps, owner, { clientId: client.id });
    await agreeClientAiConsent(env.deps, owner, { clientId: client.id, disclosureDigest: view.disclosureDigest });
  }
  const options = { agentId: 'delivery', sections: ['Reply'], check: () => undefined };
  const settings = { model: 'test-model', effort: 'high' as const, autoReview: true, network: false, webSearch: false, shell: false };
  return { ...env, client, run, options, settings };
}
test('runner never opens the AI before client permission and never creates a turn preview', async () => {
  const env = await fixture(false); let opens = 0;
  const driver: AgentDriver = { async open() { opens++; throw new Error('Should not open'); } };
  await assert.rejects(runNativeAgent(env.deps, owner, env.run.id, env.options, { driver, settings: env.settings }), { code: 'CLIENT_AI_CONSENT_REQUIRED' });
  assert.equal(opens, 0);
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.preview, null);
});
test('runner records screened progress, uses one private job folder and cleans up the driver and broker', async () => {
  const env = await fixture(); let input: AgentDriverInput | undefined; let closed = 0;
  const driver: AgentDriver = { async open(value) { input = value; return {
    async run() { value.guard(); value.onEvent({ type: 'text-delta', messageId: 'reply', text: 'I am preparing the draft.' }); return { status: 'completed', text: 'Prepared.' }; },
    async interrupt() {}, async close() { closed++; },
  }; } };
  const result = await runNativeAgent(env.deps, owner, env.run.id, env.options, { driver, settings: env.settings });
  assert.equal(result.status, 'completed'); assert.equal(closed, 1);
  assert.ok(input?.jobRoot); await assert.rejects(access(input!.jobRoot));
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.preview, null);
  assert.match(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.agentJob!.messages[0].text, /preparing/);
  const chat = env.store.read().conversations.filter(row => row.kind === 'venture-agent-message' && row.runId === env.run.id);
  assert.equal(chat.length, 1);
  assert.equal(chat[0].parts[0].kind, 'estimate');
});
test('withdrawal aborts an in-flight driver and discards its late text', async () => {
  const env = await fixture(); let late = false; let closed = false;
  const driver: AgentDriver = { async open(input) { return {
    async run() {
      await withdrawClientAiConsent(env.deps, owner, { clientId: env.client.id });
      assert.equal(input.signal?.aborted, true);
      input.onEvent({ type: 'text-delta', messageId: 'late', text: 'private late answer' }); late = true;
      return { status: 'completed', text: 'private late answer' };
    }, async interrupt() {}, async close() { closed = true; },
  }; } };
  await assert.rejects(runNativeAgent(env.deps, owner, env.run.id, env.options, { driver, settings: env.settings }), { code: 'CLIENT_AI_CONSENT_REQUIRED' });
  assert.equal(late, true); assert.equal(closed, true);
  assert.ok(!JSON.stringify(env.store.read()).includes('private late answer'));
});

test('a connected AI and client grant cannot override send-nothing privacy', async () => {
  const env = await fixture(); let opened = false;
  await env.deps.services.trust.updatePolicy(owner, { send: 'nothing' });
  const driver: AgentDriver = { async open() { opened = true; throw new Error('must not open'); } };
  await assert.rejects(runNativeAgent(env.deps, owner, env.run.id, env.options, { driver, settings: env.settings }), { code: 'MODEL_SEND_BLOCKED' });
  assert.equal(opened, false);
});

test('a quiet driver is interrupted when its order changes, before a late response can be stored', async () => {
  const env = await fixture(); let interrupted = false, beforeLate = false;
  const driver: AgentDriver = { async open(input) { return {
    async run() {
      await ventureAction(env.deps, owner, 'prepare', 'test.change', tx => {
        const order = tx.find('venture-order', env.run.orderId)!;
        tx.replace({ ...order, request: 'Changed while the tool was quiet.' });
      });
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 500);
        input.signal!.addEventListener('abort', () => { interrupted = true; clearTimeout(timeout); resolve(); }, { once: true });
      });
      beforeLate = interrupted;
      input.onEvent({ type: 'text-delta', messageId: 'late', text: 'discarded stale answer' });
      return { status: 'completed', text: 'discarded stale answer' };
    }, async interrupt() {}, async close() {},
  }; } };
  await assert.rejects(runNativeAgent(env.deps, owner, env.run.id, env.options, { driver, settings: env.settings }), { code: 'JOB_SOURCE_CHANGED' });
  assert.equal(beforeLate, true);
  assert.ok(!JSON.stringify(env.store.read()).includes('discarded stale answer'));
});

test('explicit native continuation carries only the bound checked draft and work notes into a fresh session', async () => {
  const env = await fixture();
  const previous = await createNativeJob(env.deps, owner, env.run.id, env.options); previous.capability.close();
  await ventureAction(env.deps, owner, 'prepare', 'test.checkpoint', tx => {
    const run = tx.find('venture-delivery-run', env.run.id)!;
    tx.replace({ ...run, status: 'stopped', deliverable: { title: 'Saved draft', sections: [{ heading: 'Reply', parts: [{ kind: 'text', text: 'Saved checkpoint marker.' }] }], questionsForClient: [] }, renderedText: 'Saved checkpoint marker.', agentJob: { ...run.agentJob!, draftDigest: 'checked-digest', messages: [{ id: 'note', text: 'Saved work note.', label: 'model-estimate' }] } });
  });
  const order = findRecord(env.store.read(), 'venture-order', env.run.orderId)!;
  const next = await seedRun(env, order, {}); let prompt = '';
  const driver: AgentDriver = { async open() { return { async run(text) { prompt = text; return { status: 'completed', text: 'Continued.' }; }, async interrupt() {}, async close() {} }; } };
  await runNativeAgent(env.deps, owner, next.id, { ...env.options, resumeFrom: env.run.id }, { driver, settings: env.settings });
  assert.match(prompt, /Saved checkpoint marker/); assert.match(prompt, /Saved work note/); assert.match(prompt, /untrusted/i);
  assert.equal(findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.status, 'stopped');
});

test('owner instructions saved before a draft survive an explicit new-session continuation', async () => {
  const env = await fixture();
  const previous = await createNativeJob(env.deps, owner, env.run.id, env.options); await previous.close();
  await runsSteerHandler(env.deps, owner, { runId: env.run.id, text: 'Owner instruction before draft. Card 4111 1111 1111 1111.' });
  const notes = findRecord(env.store.read(), 'venture-delivery-run', env.run.id)!.agentJob!.ownerNotes!;
  assert.ok(!notes[0].text.includes('4111'));
  const next = await seedRun(env, findRecord(env.store.read(), 'venture-order', env.run.orderId)!, {}); let prompt = '';
  const driver: AgentDriver = { async open() { return { async run(text) { prompt = text; return { status: 'completed', text: 'Continued.' }; }, async interrupt() {}, async close() {} }; } };
  await runNativeAgent(env.deps, owner, next.id, { ...env.options, resumeFrom: env.run.id }, { driver, settings: env.settings });
  assert.match(prompt, /Owner instruction before draft/); assert.match(prompt, /Previous approvals grant no permission/);
  assert.deepEqual(findRecord(env.store.read(), 'venture-delivery-run', next.id)!.agentJob!.ownerNotes, notes);
  await runsStopHandler(env.deps, owner, { runId: next.id });
  assert.equal(canResumeAgentJob(env.store.read(), findRecord(env.store.read(), 'venture-delivery-run', next.id)!), true);
  const again = await seedRun(env, findRecord(env.store.read(), 'venture-order', env.run.orderId)!, {});
  await runNativeAgent(env.deps, owner, again.id, { ...env.options, resumeFrom: next.id }, { driver, settings: env.settings });
  assert.match(prompt, /Owner instruction before draft/); assert.ok(!prompt.includes('4111'));
  const final = findRecord(env.store.read(), 'venture-delivery-run', again.id)!.agentJob!;
  assert.deepEqual(final.ownerNotes, notes); assert.equal(final.pendingApproval, undefined);
});
