import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexDriver, codexConfig } from '../runtime/venture/agent-runtime/codex-driver.ts';
import type { CodexChild } from '../runtime/venture/agent-runtime/codex-rpc.ts';
import type { AgentDriverEvent, AgentDriverInput } from '../runtime/venture/agent-runtime/driver-types.ts';
import { AGENT_MCP_TOOL_NAMES } from '../runtime/venture/agent-runtime/driver-types.ts';

function fixture(change?: (method: string, response: any) => unknown) {
  const sent: any[] = [], launches: any[] = []; let child: CodexChild; let turns = 0;
  const receive = (value: unknown) => child.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  const driver = new CodexDriver({ executable: process.execPath, platform: 'win32', qualify: async () => {}, spawn: launch => {
    launches.push(launch); child = new EventEmitter() as CodexChild; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => { child.emit('exit', 0); return true; };
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const message = JSON.parse(String(chunk)); sent.push(message); done();
      if (!('id' in message) || !message.method) return;
      let result: any = {};
      if (message.method === 'initialize') result = { userAgent: 'chausar/0.166.0 (Windows 10.0.26200; x86_64) unknown (chausar; 0.1.0)' };
      if (message.method === 'thread/start') result = { thread: { id: 'thread-1', ephemeral: true }, model: message.params.model, cwd: message.params.cwd, runtimeWorkspaceRoots: message.params.runtimeWorkspaceRoots, activePermissionProfile: { id: message.params.permissions }, approvalsReviewer: message.params.approvalsReviewer, approvalPolicy: message.params.approvalPolicy, instructionSources: [] };
      if (message.method === 'mcpServerStatus/list') result = { data: [{ name: 'chausar', runtimeStatus: 'connected', tools: Object.fromEntries(AGENT_MCP_TOOL_NAMES.map(name => [name, {}])) }], nextCursor: null };
      if (message.method === 'experimentalFeature/list') result = { data: Object.entries(codexConfig(input(), 'fixture', 'win32').features).map(([name, enabled]) => ({ name, enabled: typeof enabled === 'boolean' ? enabled : false })), nextCursor: null };
      if (message.method === 'turn/start') result = { turn: { id: `turn-${++turns}`, status: 'inProgress', items: [] } };
      queueMicrotask(() => receive({ id: message.id, result: change ? change(message.method, result) : result }));
    } }); return child;
  } });
  return { driver, sent, launches, receive, exit: () => child.emit('exit', 1) };
}
function input(events: AgentDriverEvent[] = []): AgentDriverInput {
  return { jobId: 'job-1', jobRoot: join(tmpdir(), 'chausar-synthetic-codex-job'), settings: { model: 'explicit-model', effort: 'high', autoReview: true, shell: false, network: false, webSearch: false }, mcp: { name: 'chausar', command: process.execPath, args: ['synthetic-mcp'], env: { SYNTHETIC_CAPABILITY: 'fixture' } }, guard() {}, onEvent: event => events.push(event) };
}
async function starting(f: ReturnType<typeof fixture>, session: Awaited<ReturnType<CodexDriver['open']>>, prompt = 'Synthetic order') {
  const run = session.run(prompt); await new Promise(resolveDone => setImmediate(resolveDone)); return { run };
}
test('Codex starts an ephemeral explicit-model job with isolated configuration and no credentials in argv', async () => {
  const f = fixture(), i = input(); i.credentials = { apiKey: ['synthetic','credential'].join('-'), baseUrl: 'https://gateway.example/v1' };
  const session = await f.driver.open(i), start = f.sent.find(x => x.method === 'thread/start');
  assert.equal(start.params.allowProviderModelFallback, false); assert.equal(start.params.ephemeral, true);
  assert.deepEqual(start.params.runtimeWorkspaceRoots, [i.jobRoot]); assert.equal(start.params.approvalsReviewer, 'auto_review');
  assert.equal(start.params.sandbox, undefined); assert.equal(start.params.config.history.persistence, 'none');
  const config = codexConfig(i, 'unique-profile', 'win32');
  assert.equal(config.windows.sandbox, 'unelevated'); assert.equal(config.features.hooks, false); assert.equal(config.features.apps, false);
  assert.equal(JSON.stringify(f.launches[0].args).includes(i.credentials.apiKey), false); assert.equal(JSON.stringify(f.launches[0].args).includes('SYNTHETIC_CAPABILITY'), false);
  assert.equal(f.launches[0].env.CHAUSAR_AGENT_API_KEY, i.credentials.apiKey); await session.close();
});
test('Codex streams exact item identity, reports provider usage and continues on the same live thread', async () => {
  const f = fixture(), events: AgentDriverEvent[] = [], session = await f.driver.open(input(events));
  const { run } = await starting(f, session);
  await assert.rejects(session.run('overlapping'), { code: 'AGENT_TURN_BUSY' });
  f.receive({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id: 'message-1' } } });
  f.receive({ method: 'item/agentMessage/delta', params: { threadId: 'foreign', turnId: 'turn-1', itemId: 'message-1', delta: 'foreign' } });
  f.receive({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'Ready' } });
  f.receive({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { last: { inputTokens: 12, outputTokens: 4, cachedInputTokens: 2, reasoningOutputTokens: 1 } } } });
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  assert.deepEqual(await run, { status: 'completed', text: 'Ready', model: 'explicit-model', threadId: 'thread-1', turnId: 'turn-1', usage: { inputTokens: 12, outputTokens: 4, cachedInputTokens: 2, reasoningOutputTokens: 1, model: 'explicit-model', source: 'provider-reported' } });
  assert.ok(events.some(e => e.type === 'text-delta' && e.itemId === 'message-1' && e.turnId === 'turn-1'));
  const next = await starting(f, session); await session.interrupt();
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-2', status: 'interrupted' } } }); assert.equal((await next.run).status, 'interrupted');
  assert.equal(f.sent.filter(x => x.method === 'thread/start').length, 1); await session.close(); assert.ok(f.sent.some(x => x.method === 'thread/unsubscribe'));
});
test('Codex refuses a changed model, expanded roots, instruction ingestion or missing profile before sharing a prompt', async () => {
  for (const patch of [{ model: 'fallback' }, { runtimeWorkspaceRoots: [resolve('..')] }, { instructionSources: ['client/AGENTS.md'] }, { activePermissionProfile: null }]) {
    const f = fixture((method, result) => method === 'thread/start' ? { ...result, ...patch } : result);
    await assert.rejects(f.driver.open(input()), { code: 'CODEX_POLICY_UNSUPPORTED' }); assert.equal(f.sent.some(x => x.method === 'turn/start'), false);
  }
});
test('Codex refuses uncorrelated approvals and all permission expansion requests', async () => {
  const f = fixture(), i = input(); let approved = 0; i.requestApproval = async () => { approved++; return true; }; const session = await f.driver.open(i); const { run } = await starting(f, session);
  f.receive({ id: 'a', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'old-turn', itemId: 'unknown', command: 'arbitrary' } });
  f.receive({ id: 'b', method: 'item/permissions/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'unknown', permissions: { fileSystem: { read: ['/'] } } } });
  await new Promise(resolveDone => setImmediate(resolveDone)); assert.equal(approved, 0); assert.deepEqual(f.sent.find(x => x.id === 'a').result, { decision: 'decline' }); assert.deepEqual(f.sent.find(x => x.id === 'b').result, { permissions: {}, scope: 'turn' });
  await session.close(); assert.equal((await run).status, 'interrupted');
});
test('Codex rechecks consent before every response and before the next turn; process death settles active work', async () => {
  const f = fixture(), i = input(), events: AgentDriverEvent[] = []; let revoked = false; i.guard = () => { if (revoked) throw new Error('consent revoked'); }; i.onEvent = event => events.push(event);
  const session = await f.driver.open(i), { run } = await starting(f, session); revoked = true;
  f.receive({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id: 'message-1' } } });
  f.receive({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'must not escape' } });
  assert.equal((await run).status, 'failed'); assert.equal(events.some(e => e.type === 'text-delta'), false); await assert.rejects(session.run('new'));
  const g = fixture(), live = await g.driver.open(input()), active = await starting(g, live); g.exit(); assert.equal((await active.run).status, 'failed');
});
test('Codex refuses effective native tools or unqualified versions before sharing a prompt', async () => {
  for (const feature of ['shell_tool', 'view_image', 'hooks', 'multi_agent', 'plugins', 'memories']) {
    const f = fixture((method, result) => method === 'experimentalFeature/list' ? { ...result, data: result.data.map((item: any) => item.name === feature ? { ...item, enabled: true } : item) } : result);
    await assert.rejects(f.driver.open(input()), { code: 'CODEX_POLICY_UNSUPPORTED' }); assert.equal(f.sent.some(item => item.method === 'turn/start'), false);
  }
  const f = fixture((method, result) => method === 'initialize' ? { userAgent: 'codex_cli_rs/9.9.9' } : result);
  await assert.rejects(f.driver.open(input()), { code: 'CODEX_POLICY_UNSUPPORTED' });
  // A2: the bundled 0.166.0 is the one qualified protocol; the earlier 0.154.0 and a look-alike version are refused.
  for (const userAgent of ['chausar/0.154.0 (Windows 10.0.26200; x86_64) unknown (chausar; 0.1.0)', 'chausar/10.166.01 (Windows)', 'chausar/0.166.0-alpha.1 (Windows 10.0.26200; x86_64)', 'chausar/0.166.0+build (Windows)', 'chausar/0.166.00 (Windows)']) {
    const old = fixture((method, result) => method === 'initialize' ? { userAgent } : result);
    await assert.rejects(old.driver.open(input()), { code: 'CODEX_POLICY_UNSUPPORTED' }, userAgent);
  }
  for (const feature of ['daemon_auto_start', 'browser_annotation_api', 'in_app_voice', 'plugin_discovery_prefetch']) {
    const on = fixture((method, result) => method === 'experimentalFeature/list' ? { ...result, data: result.data.map((item: any) => item.name === feature ? { ...item, enabled: true } : item) } : result);
    await assert.rejects(on.driver.open(input()), { code: 'CODEX_POLICY_UNSUPPORTED' }, feature);
  }
});
test('A2 review: a job runs only the reviewed native program, never a search-path find or an npm shim', async () => {
  for (const executable of [undefined, 'C:/npm/codex.cmd', '/usr/lib/node_modules/codex.ps1']) {
    await assert.rejects(new CodexDriver({ ...(executable ? { executable } : {}), spawn: () => { throw new Error('never started'); } }).open(input()), { code: 'CODEX_NOT_INSTALLED' }, String(executable));
  }
});
test('Codex retains final message content when the provider emits a completed item without deltas', async () => {
  const f = fixture(), session = await f.driver.open(input()), { run } = await starting(f, session);
  const item = { type: 'agentMessage', id: 'final-message', text: 'A completed synthetic draft.' };
  f.receive({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item } });
  f.receive({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item } });
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  assert.equal((await run).text, item.text); await session.close();
});

test('Codex stops model rerouting and rejects newly enabled inherited tools before continuation', async () => {
  const f = fixture(), session = await f.driver.open(input()), { run } = await starting(f, session);
  f.receive({ method: 'model/rerouted', params: { threadId: 'thread-1', turnId: 'turn-1', fromModel: 'explicit-model', toModel: 'other-model', reason: 'highRiskCyberActivity' } });
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  assert.equal((await run).status, 'failed'); await session.close();
  let changed = false;
  const g = fixture((method, result) => method === 'mcpServerStatus/list' && changed ? { ...result, data: [...result.data, { name: 'unmanaged', runtimeStatus: 'connected', tools: { outside: {} } }] } : result);
  const next = await g.driver.open(input()); changed = true;
  const pending = await starting(g, next);
  g.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  assert.equal((await pending.run).status, 'failed'); assert.equal(g.sent.some(item => item.method === 'turn/start'), false); await next.close();
});

test('Codex usage counts all provider calls in this turn without counting earlier turns again', async () => {
  const f = fixture(), session = await f.driver.open(input());
  const usage = (turnId: string, totalInput: number, lastInput: number) => f.receive({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId, tokenUsage: { total: { inputTokens: totalInput, outputTokens: totalInput / 2 }, last: { inputTokens: lastInput, outputTokens: lastInput / 2 } } } });
  const first = await starting(f, session); usage('turn-1', 10, 10); usage('turn-1', 30, 20);
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  assert.equal((await first.run).usage?.inputTokens, 30);
  const next = await starting(f, session); usage('turn-2', 44, 14);
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-2', status: 'completed' } } });
  assert.equal((await next.run).usage?.inputTokens, 14); await session.close();
});

test('Codex honors an interrupt requested while turn startup checks are still pending', async () => {
  const f = fixture(), session = await f.driver.open(input()); const run = session.run('Synthetic order'); await session.interrupt();
  await new Promise(done => setImmediate(done));
  const interrupted = f.sent.find(item => item.method === 'turn/interrupt');
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } } });
  assert.ok(interrupted); assert.equal((await run).status, 'interrupted'); await session.close();
});

test('Codex normalizes repeated completed items without duplicating their streamed suffix', async () => {
  const f = fixture(), session = await f.driver.open(input()), { run } = await starting(f, session);
  f.receive({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'message', type: 'agentMessage' } } });
  f.receive({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message', delta: 'First' } });
  for (let n = 0; n < 2; n++) f.receive({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'message', type: 'agentMessage', text: 'First second' } } });
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  assert.equal((await run).text, 'First second'); await session.close();
});

test('A2: a failed turn says why, from Codex\'s own error info, in owner words with the fix', async () => {
  const { aiFailureWords } = await import('../runtime/venture/models/ai-failure.ts');
  const f = fixture(), session = await f.driver.open(input());
  const first = await starting(f, session);
  f.receive({ method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', willRetry: false, error: { message: 'rate', codexErrorInfo: 'usageLimitExceeded', additionalDetails: null } } });
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed', error: { message: 'You hit the limit', codexErrorInfo: 'usageLimitExceeded', additionalDetails: null } } } });
  const failed = await first.run;
  assert.equal(failed.status, 'failed'); assert.equal(failed.failure, 'usage-limit'); assert.equal(failed.error, aiFailureWords('usage-limit', 'Codex'));
  const next = await starting(f, session);
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-2', status: 'failed', error: { message: 'stream disconnected before completion', codexErrorInfo: null, additionalDetails: null } } } });
  assert.equal((await next.run).failure, 'stream-cut');
  const plain = await starting(f, session);
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-3', status: 'failed', error: { message: 'odd', codexErrorInfo: 'internalServerError', additionalDetails: null } } } });
  const odd = await plain.run;
  assert.equal(odd.failure, undefined); assert.equal(odd.error, 'Codex could not complete this turn. It was not rerouted.');
  await session.close();
});
test('C7: the account rate-limit update reaches the plan meter mid-turn, even though it names no thread', async () => {
  const f = fixture(), readings: any[] = [], i = input(); i.onPlan = reading => readings.push(reading);
  const session = await f.driver.open(i), { run } = await starting(f, session);
  const reset = Math.floor(Date.parse('2026-11-06T16:30:00Z') / 1000);
  f.receive({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 62, windowDurationMins: 300, resetsAt: reset }, secondary: null } } });
  f.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await run;
  assert.equal(readings.length, 1);
  assert.equal(readings[0].cli, 'codex'); assert.equal(readings[0].windows[0].kind, 'five-hour'); assert.equal(readings[0].windows[0].usedPercent, 62);
  assert.equal(readings[0].windows[0].resetsAt, '2026-11-06T16:30:00.000Z');
  await session.close();
});
