// A2: two guards on a native AI job. An idle-run watchdog: a job that goes quiet is asked to stop, keeps what it wrote,
// and is closed hard when the tool ignores the stop. One nudge: an AI that writes a tool request as text instead of
// making the call gets one more turn asking for the call; a second stop always ends the job as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, orderWithFiles, owner, record, setup } from './venture-run-controls-env.ts';
import { consentForOrder, SCRIPTED_AGENT_SETTINGS } from './fixtures/venture/scripted-agent.ts';
import { waitForAgentWork } from '../runtime/venture/agent-runtime/runner.ts';
import type { AgentDriverInput, AgentTurnResult } from '../runtime/venture/agent-runtime/driver-types.ts';

async function ready() {
  const env = await setup(), order = await orderWithFiles(env);
  await env.store.update(state => { state.policy.send = 'shape'; });
  await consentForOrder(env.deps, owner, order.id);
  return { env, order };
}
const never = <T,>() => new Promise<T>(() => {});

test('a job that goes quiet is stopped, keeps the notes it wrote, and says it went quiet', async () => {
  const { env, order } = await ready();
  const seen: string[] = [];
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, watchdog: { idleMs: 60, hardCloseMs: 60 }, driver: { async open(input: AgentDriverInput) {
    let finish!: (result: AgentTurnResult) => void;
    return {
      run() { input.onEvent({ type: 'text-delta', messageId: 'm1', text: 'Read the books; half done.' }); return new Promise<AgentTurnResult>(done => { finish = done; }); },
      async interrupt() { seen.push('interrupt'); finish({ status: 'interrupted', text: 'Read the books; half done.' }); },
      async close() { seen.push('close'); },
    };
  } } });
  const started = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, started.id);
  const run = record(env, started.id);
  assert.equal(run.status, 'stopped');
  assert.equal(run.agentJob!.quiet, true);
  assert.ok(run.agentJob!.messages.some(message => message.text.includes('half done')), 'the partial work is kept');
  assert.equal(seen[0], 'interrupt');
});

test('a tool that ignores the stop is closed hard, and the job still ends', async () => {
  const { env, order } = await ready();
  const seen: string[] = [];
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, watchdog: { idleMs: 60, hardCloseMs: 60 }, driver: { async open() {
    return { run: () => never<AgentTurnResult>(), async interrupt() { seen.push('interrupt'); }, close() { seen.push('close'); return never<void>(); } };
  } } });
  const started = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, started.id);
  assert.deepEqual(seen.slice(0, 2), ['interrupt', 'close']);
  assert.equal(record(env, started.id).status, 'stopped');
  assert.equal(record(env, started.id).agentJob!.quiet, true);
});

test('one nudge when the AI writes the request as text; a second stop ends the job as before', async () => {
  const { env, order } = await ready();
  const prompts: string[] = [];
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, driver: { async open() {
    return {
      async run(prompt: string) { prompts.push(prompt); return { status: 'completed' as const, text: 'Next I call propose_action({"draftId": "x"}) to send it.', usage: { inputTokens: 10, outputTokens: 5, source: 'provider-reported' as const } }; },
      async interrupt() {}, async close() {},
    };
  } } });
  const started = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, started.id);
  assert.equal(prompts.length, 2, 'exactly one nudge');
  assert.match(prompts[1]!, /call the tool/i);
  assert.equal(record(env, started.id).status, 'failed', 'no checked draft, as before');
});

test('no nudge when the AI stops in plain words', async () => {
  const { env, order } = await ready();
  const prompts: string[] = [];
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, driver: { async open() {
    return { async run(prompt: string) { prompts.push(prompt); return { status: 'completed' as const, text: 'The books are missing a page, so I cannot draft this.' }; }, async interrupt() {}, async close() {} };
  } } });
  const started = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, started.id);
  assert.equal(prompts.length, 1);
});

// A2 review (finding 1): waiting on the owner, or on a long tool, is not going quiet.
test('the watchdog waits while an approval is pending on the owner', async () => {
  const { env, order } = await ready();
  const seen: string[] = [];
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, watchdog: { idleMs: 60, hardCloseMs: 60 }, driver: { async open(input: AgentDriverInput) {
    return {
      run() {
        void input.requestApproval?.({ kind: 'file-change', requestId: 'req-1', threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', name: 'Write', arguments: { path: 'notes.md' } }).catch(() => false);
        return new Promise<AgentTurnResult>(done => { setTimeout(() => done({ status: 'completed', text: 'Waited for the owner.' }), 500); });
      },
      async interrupt() { seen.push('interrupt'); }, async close() {},
    };
  } } });
  const started = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, started.id);
  assert.deepEqual(seen, [], 'never asked to stop while the owner decides');
  assert.notEqual(record(env, started.id).agentJob!.quiet, true);
});

test('the watchdog waits while a tool step is still running', async () => {
  const { env, order } = await ready();
  const seen: string[] = [];
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, watchdog: { idleMs: 60, hardCloseMs: 60 }, driver: { async open(input: AgentDriverInput) {
    return {
      run() {
        input.onEvent({ type: 'tool-started', toolUseId: 'tool-1', name: 'read_file' });
        return new Promise<AgentTurnResult>(done => { setTimeout(() => { input.onEvent({ type: 'tool-completed', toolUseId: 'tool-1', name: 'read_file', failed: false }); done({ status: 'completed', text: 'Read it.' }); }, 500); });
      },
      async interrupt() { seen.push('interrupt'); }, async close() {},
    };
  } } });
  const started = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, started.id);
  assert.deepEqual(seen, []);
  assert.notEqual(record(env, started.id).agentJob!.quiet, true);
});
