// A2: two guards on a native AI job. An idle-run watchdog: a job that goes quiet is asked to stop, keeps what it wrote,
// and is closed hard when the tool ignores the stop. One nudge: an AI that writes a tool request as text instead of
// making the call gets one more turn asking for the call; a second stop always ends the job as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, getRun, orderWithFiles, owner, record, setup } from './venture-run-controls-env.ts';
import { QUIET_LINE, TIME_LINE } from '../runtime/venture/delivery/harness/controls.ts';
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
  // A2 review: the run says it went quiet, never "Stopped by you".
  const detail = await getRun(env, started.id) as any;
  assert.equal(detail.stop?.line, QUIET_LINE);
  assert.equal(detail.result, QUIET_LINE);
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

// A2 review (finding 14): a saved draft gets no nudge; the two turns of a nudge are counted as one total.
test('a job that saved its draft gets no nudge, even if its last words name a tool', async () => {
  const { scriptedAgent } = await import('./fixtures/venture/scripted-agent.ts');
  const { env, order } = await ready();
  let headings: string[] = [];
  const draft = () => ({ title: 'Books for your review', questionsForClient: [], sections: headings.map((heading, index) => ({ heading, parts: index === headings.length - 1
    ? [{ kind: 'text', text: 'The agreed fee follows.', ref: '' }, { kind: 'figure', text: '', ref: 'order.total' }]
    : [{ kind: 'text', text: 'Please review the attached books and confirm the records are complete.', ref: '' }] })) });
  const inner = scriptedAgent(draft, undefined, (name, data) => { if (name === 'read_business') headings = (data as { sections: string[] }).sections; });
  let runs = 0;
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, driver: { async open(input: AgentDriverInput) {
    const session = await inner.open(input);
    return { ...session, async run(prompt: string) { runs += 1; const result = await session.run(prompt); return { ...result, text: 'Saved it; next propose_action({"draftId": "x"}).' }; } };
  } } });
  const started = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, started.id);
  assert.equal(runs, 1, 'no nudge after a saved draft');
  assert.ok(record(env, started.id).agentJob!.draftDigest);
});

test('the two turns of a nudge are counted as one growing total', async () => {
  const { env, order } = await ready();
  let turn = 0;
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, driver: { async open(input: AgentDriverInput) {
    return {
      async run() {
        turn += 1;
        const usage = turn === 1 ? { inputTokens: 10, outputTokens: 5, source: 'provider-reported' as const } : { inputTokens: 4, outputTokens: 2, source: 'provider-reported' as const };
        input.onEvent({ type: 'usage', usage });
        return { status: 'completed' as const, text: turn === 1 ? 'Calling draft_document({"draft": {}}) next.' : 'I cannot draft this.', usage };
      },
      async interrupt() {}, async close() {},
    };
  } } });
  const started = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, started.id);
  assert.equal(turn, 2);
  const usage = record(env, started.id).agentJob!.usage!;
  assert.deepEqual([usage.inputTokens, usage.outputTokens], [14, 7], 'the second turn adds to the first');
});

// A2 second review (M2): the paused clock has a backstop. One tool may hold it at most toolMs; each turn forgets the
// tool steps it started; and a job may run at most jobMs of its own time (time waiting on the owner does not count).
test('a tool step that never finishes holds the clock only up to its cap, then the job is stopped and keeps its work', { timeout: 10_000 }, async () => {
  const { env, order } = await ready();
  const seen: string[] = [];
  let started = 0, stopped = 0;
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, watchdog: { idleMs: 60, hardCloseMs: 60, toolMs: 300, jobMs: 60_000 }, driver: { async open(input: AgentDriverInput) {
    let finish!: (result: AgentTurnResult) => void;
    return {
      run() {
        started = Date.now();
        input.onEvent({ type: 'text-delta', messageId: 'm1', text: 'Read half the books.' });
        input.onEvent({ type: 'tool-started', toolUseId: 'tool-stuck', name: 'read_file' });
        return new Promise<AgentTurnResult>(done => { finish = done; });
      },
      async interrupt() { stopped = Date.now(); seen.push('interrupt'); finish({ status: 'interrupted', text: 'Read half the books.' }); },
      async close() {},
    };
  } } });
  const run = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, run.id);
  assert.deepEqual(seen, ['interrupt']);
  assert.ok(stopped - started >= 300, 'not before the tool cap passed');
  const kept = record(env, run.id);
  assert.equal(kept.status, 'stopped');
  assert.equal(kept.agentJob!.quiet, true);
  assert.ok(kept.agentJob!.messages.some(message => message.text.includes('half the books')), 'the partial work is kept');
});

test('a tool step left open by the first turn does not pause the nudge turn', { timeout: 10_000 }, async () => {
  const { env, order } = await ready();
  const seen: string[] = [];
  let turn = 0;
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, watchdog: { idleMs: 60, hardCloseMs: 60, toolMs: 60_000, jobMs: 60_000 }, driver: { async open(input: AgentDriverInput) {
    let finish!: (result: AgentTurnResult) => void;
    return {
      async run() {
        turn += 1;
        if (turn === 1) {
          input.onEvent({ type: 'tool-started', toolUseId: 'tool-1', name: 'read_file' });
          return { status: 'completed' as const, text: 'Next I call draft_document({"draft": {}}).' };
        }
        return new Promise<AgentTurnResult>(done => { finish = done; });
      },
      async interrupt() { seen.push('interrupt'); finish?.({ status: 'interrupted', text: '' }); },
      async close() {},
    };
  } } });
  const run = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, run.id);
  assert.equal(turn, 2, 'the nudge turn ran');
  assert.deepEqual(seen, ['interrupt'], 'the quiet nudge turn was stopped');
  assert.equal(record(env, run.id).agentJob!.quiet, true);
});

test('a job that keeps talking past its time limit is stopped, says so, and keeps its work', { timeout: 10_000 }, async () => {
  const { env, order } = await ready();
  const seen: string[] = [];
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, watchdog: { idleMs: 200, hardCloseMs: 60, toolMs: 60_000, jobMs: 300 }, driver: { async open(input: AgentDriverInput) {
    let finish!: (result: AgentTurnResult) => void, talk: ReturnType<typeof setInterval> | undefined, n = 0;
    return {
      run() {
        talk = setInterval(() => { n += 1; input.onEvent({ type: 'text-delta', messageId: 'm1', text: ` step ${n}.` }); }, 20);
        return new Promise<AgentTurnResult>(done => { finish = done; });
      },
      async interrupt() { seen.push('interrupt'); clearInterval(talk); finish({ status: 'interrupted', text: '' }); },
      async close() { clearInterval(talk); },
    };
  } } });
  const run = await call<{ id: string }>(env, 'venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, run.id);
  assert.deepEqual(seen, ['interrupt']);
  const kept = record(env, run.id);
  assert.equal(kept.status, 'stopped');
  assert.equal(kept.agentJob!.overtime, true);
  assert.ok(kept.agentJob!.messages.some(message => message.text.includes('step 1.')), 'what it wrote is kept');
  const detail = await getRun(env, run.id) as any;
  assert.equal(detail.stop?.line, TIME_LINE);
  assert.equal(detail.result, TIME_LINE);
});
