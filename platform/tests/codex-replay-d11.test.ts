import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexDriver, codexConfig } from '../runtime/venture/agent-runtime/codex-driver.ts';
import type { CodexChild } from '../runtime/venture/agent-runtime/codex-rpc.ts';
import { AGENT_MCP_TOOL_NAMES, type AgentDriverInput } from '../runtime/venture/agent-runtime/driver-types.ts';
import { createRunRecorder } from '../runtime/venture/replay/capture.ts';
import { createRunReplay } from '../runtime/venture/replay/replay-run.ts';
import { inRun, finishRun } from '../runtime/venture/replay/scope.ts';

const input = (root: string): AgentDriverInput => ({ jobId: 'sample-job', jobRoot: root, settings: { model: 'gpt-6-luna', effort: 'high', autoReview: true, network: false, shell: false, webSearch: false },
  mcp: { name: 'chausar', command: process.execPath, args: [join(root, 'stdio-bridge.ts')], env: { CHAUSAR_AGENT_MCP_TOKEN: ['sample', 'capability'].join('-'), CHAUSAR_AGENT_MCP_SOCKET: join(root, 'sample.sock') } }, guard() {}, onEvent() {} });
test('a complete Codex driver session replays the native parser with fresh roots and no process', async () => {
  let spawned = 0;
  const driver = new CodexDriver({ executable: process.execPath, platform: 'win32', spawn: () => {
    spawned++;
    const child = Object.assign(new EventEmitter(), { stdin: new Writable(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { child.emit('exit', 0); return true; } }) as CodexChild;
    const emit = (value: unknown) => child.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
    child.stdin = new Writable({ write(bytes, _encoding, done) {
      const request = JSON.parse(String(bytes)); done(); if (!request.id) return;
      let result: any = {};
      if (request.method === 'initialize') result = { userAgent: 'chausar/0.166.0 (Windows 10; x86_64) sample' };
      if (request.method === 'mcpServerStatus/list') result = { data: [{ name: 'chausar', runtimeStatus: 'connected', tools: Object.fromEntries(AGENT_MCP_TOOL_NAMES.map(name => [name, {}])) }], nextCursor: null };
      if (request.method === 'experimentalFeature/list') result = { data: Object.entries(codexConfig(input(join(tmpdir(), 'features')), 'sample', 'win32').features).map(([name, enabled]) => ({ name, enabled: typeof enabled === 'boolean' ? enabled : false })), nextCursor: null };
      if (request.method === 'thread/start') result = { thread: { id: 'sample-thread', ephemeral: true }, model: request.params.model, cwd: request.params.cwd, runtimeWorkspaceRoots: request.params.runtimeWorkspaceRoots, activePermissionProfile: { id: request.params.permissions }, approvalsReviewer: request.params.approvalsReviewer, approvalPolicy: request.params.approvalPolicy, instructionSources: [] };
      if (request.method === 'turn/start') result = { turn: { id: 'sample-turn', status: 'inProgress', items: [] } };
      queueMicrotask(() => {
        emit({ id: request.id, result });
        if (request.method === 'turn/start') {
          emit({ method: 'item/started', params: { threadId: 'sample-thread', turnId: 'sample-turn', item: { type: 'agentMessage', id: 'sample-message' } } });
          emit({ method: 'item/agentMessage/delta', params: { threadId: 'sample-thread', turnId: 'sample-turn', itemId: 'sample-message', delta: 'Sample answer.' } });
          emit({ method: 'turn/completed', params: { threadId: 'sample-thread', turn: { id: 'sample-turn', status: 'completed' } } });
        }
      });
    } }); return child;
  } });
  const recorder = createRunRecorder({ startState: {}, capturedAt: '2026-11-06T10:00:00.000Z' }), recording = { recorder };
  await inRun(recording, async () => { const session = await driver.open(input(join(tmpdir(), 'old-codex-root'))); assert.equal((await session.run('Write the sample draft.')).text, 'Sample answer.'); await session.close(); });
  finishRun(recording); const capture = recorder.finish([]);
  assert.ok(!JSON.stringify(capture).includes('sample-capability'));
  const replay = createRunReplay(capture), replaying = { replay };
  const offline = new CodexDriver({ executable: process.execPath, platform: 'win32', spawn: () => { throw new Error('Replay spawned Codex'); } });
  await inRun(replaying, async () => { const session = await offline.open(input(join(tmpdir(), 'new-codex-root'))); assert.equal((await session.run('Write the sample draft.')).text, 'Sample answer.'); await session.close(); });
  finishRun(replaying); replay.done(); assert.equal(spawned, 1);
});
