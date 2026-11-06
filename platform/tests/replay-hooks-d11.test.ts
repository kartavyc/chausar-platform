import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createRunRecorder } from '../runtime/venture/replay/capture.ts';
import { createRunReplay } from '../runtime/venture/replay/replay-run.ts';
import { inRun, runTransport } from '../runtime/venture/replay/scope.ts';
import { guardedFetch } from '../runtime/venture/core/net-guard.ts';
import { CodexRpc } from '../runtime/venture/agent-runtime/codex-rpc.ts';

const recorder = () => createRunRecorder({ startState: {}, capturedAt: '2026-11-06T10:00:00.000Z' });
const offline = () => { throw new Error('Unexpected real IO'); };
test('guarded fetch captures the complete answer and replay never resolves or sends', async () => {
  const saved = recorder();
  const deps = { resolve: async () => [{ address: '8.8.8.8', family: 4 as const }], send: async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('Sample page') }) };
  const answer = await inRun({ recorder: saved }, () => guardedFetch({ url: 'https://example.com/sample' }, deps));
  const replay = createRunReplay(saved.finish([]));
  const again = await inRun({ replay }, () => guardedFetch({ url: 'https://example.com/sample' }, { resolve: offline, send: offline }));
  assert.deepEqual(again, answer); replay.done();
});
test('transport hooks hold model answers, omit credentials and reject changed prompts', async () => {
  const saved = recorder();
  const request = { purpose: 'plan-suggest' as const, url: 'https://example.com/model', method: 'POST' as const, headers: { authorization: ['Bearer', 'synthetic-auth'].join(' ') }, body: 'Sample prompt', timeoutMs: 500 };
  const transport = runTransport({ replay: false, http: async () => ({ status: 200, body: 'Sample answer' }), process: offline });
  await inRun({ recorder: saved }, () => transport.http(request));
  const capture = saved.finish([]);
  assert.ok(!JSON.stringify(capture).includes('synthetic-auth'));
  const replay = createRunReplay(capture);
  assert.deepEqual(await inRun({ replay }, () => transport.http(request)), { status: 200, body: 'Sample answer' });
  replay.done();
  await assert.rejects(inRun({ replay: createRunReplay(capture) }, () => transport.http({ ...request, body: 'Changed prompt' })), { code: 'REPLAY_DIVERGED' });
});
test('Codex spawn streams replay through the same RPC parser without spawning', async () => {
  const { runCodexSpawn } = await import('../runtime/venture/replay/driver-hooks.ts');
  const saved = recorder();
  const spawn = () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { queueMicrotask(() => child.emit('exit', 0)); return true; } });
    child.stdin.on('data', chunk => { const request = JSON.parse(String(chunk)); child.stdout.write(JSON.stringify({ id: request.id, result: { version: 'sample' } }) + '\n'); });
    return child;
  };
  const capture = await inRun({ recorder: saved }, async () => { const rpc = new CodexRpc(runCodexSpawn(spawn)); assert.deepEqual(await rpc.request('initialize', { name: 'sample' }), { version: 'sample' }); await rpc.close(); return saved.finish([]); });
  const replay = createRunReplay(capture);
  await inRun({ replay }, async () => { const rpc = new CodexRpc(runCodexSpawn(offline)); assert.deepEqual(await rpc.request('initialize', { name: 'sample' }), { version: 'sample' }); await rpc.close(); });
  replay.done();
});

test('Claude queryFactory messages replay through the same stream without calling the SDK', async () => {
  const { runClaudeQuery } = await import('../runtime/venture/replay/driver-hooks.ts');
  const { finishRun } = await import('../runtime/venture/replay/scope.ts');
  const prompt = { async *[Symbol.asyncIterator]() { yield { type: 'user', message: { role: 'user', content: 'Write a sample draft' }, parent_tool_use_id: null, session_id: '', uuid: '12345678-abcd-abcd-abcd-123456789012' }; } };
  const factory = ({ prompt }: any) => ({ close() {}, interrupt: async () => {}, async *[Symbol.asyncIterator]() { for await (const request of prompt) yield { type: 'result', result: 'Sample answer', user_message_uuid: request.uuid }; } });
  const saved = recorder(), run = { recorder: saved };
  const messages: unknown[] = [];
  await inRun(run, async () => { for await (const message of runClaudeQuery(factory as any, { prompt, options: {} } as any)) messages.push(message); });
  finishRun(run);
  const replay = createRunReplay(saved.finish([])), replayRun = { replay };
  const again: unknown[] = [];
  await inRun(replayRun, async () => { for await (const message of runClaudeQuery(offline, { prompt, options: {} } as any)) again.push(message); });
  finishRun(replayRun); replay.done(); assert.deepEqual(again, messages);
});
test('an unused captured driver stream cannot pass replay', () => {
  const saved = recorder(); saved.driver('codex', '{}');
  assert.throws(() => createRunReplay(saved.finish([])).done(), { code: 'REPLAY_DIVERGED' });
});
test('a swallowed secret refusal cannot turn into a successful capture', async () => {
  const { finishRun } = await import('../runtime/venture/replay/scope.ts');
  const saved = recorder(), run = { recorder: saved };
  const key = ['sk', 'ant', 'api03', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz3'].join('-');
  const transport = runTransport({ replay: false, http: async () => ({ status: 200, body: key }), process: offline });
  await inRun(run, () => transport.http({ purpose: 'plan-suggest', url: 'https://example.com', method: 'POST', body: 'Sample', headers: {}, timeoutMs: 10 }).catch(() => {}));
  assert.throws(() => finishRun(run), { code: 'CAPTURE_REFUSED' });
  assert.throws(() => saved.finish([]), { code: 'CAPTURE_REFUSED' });
});

test('an arbitrary provider field named like the broker token is refused rather than silently removed', async () => {
  const { runCodexSpawn } = await import('../runtime/venture/replay/driver-hooks.ts');
  const { finishRun } = await import('../runtime/venture/replay/scope.ts');
  const saved = recorder(), run = { recorder: saved };
  const key = ['sk', 'ant', 'api03', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz3'].join('-');
  await inRun(run, async () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { queueMicrotask(() => child.emit('exit', 0)); return true; } });
    child.stdin.on('data', chunk => { const request = JSON.parse(String(chunk)); child.stdout.write(JSON.stringify({ id: request.id, result: { CHAUSAR_AGENT_MCP_TOKEN: key } }) + '\n'); });
    const rpc = new CodexRpc(runCodexSpawn(() => child));
    await rpc.request('sample', {}).catch(() => {}); await rpc.close();
  });
  assert.throws(() => finishRun(run), { code: 'CAPTURE_REFUSED' });
});

test('replay refuses external MCP, child processes and effectful broker tools before opening ports', async () => {
  const { connectExternalClient } = await import('../runtime/venture/agent-runtime/external-client.ts');
  const { spawnTree } = await import('../runtime/process-tree.ts');
  const { bindCaptureBroker } = await import('../runtime/venture/replay/broker-hooks.ts');
  const run = { replay: createRunReplay(recorder().finish([])) }; let calls = 0;
  await inRun(run, async () => {
    await assert.rejects(connectExternalClient({ transport: 'stdio', command: 'must-never-start', args: [] } as any, new AbortController().signal), { code: 'REPLAY_EFFECT_REFUSED' });
    assert.throws(() => spawnTree('must-never-start', [], {}), { code: 'REPLAY_EFFECT_REFUSED' });
    const broker = bindCaptureBroker({ handle: async () => { calls++; }, close() {} } as any, { assert() {}, context: {} } as any)!;
    const tool = (run as any).tools.get(0);
    await assert.rejects(tool({ method: 'tools/call', params: { name: 'send_message', arguments: { approval: 'restored-approval' } } }, 'sample'), { code: 'REPLAY_EFFECT_REFUSED' });
    assert.equal(calls, 0); broker.close();
  });
});

for (const changed of ['digest', 'argument']) test('native replay refuses a changed substantive ' + changed, async () => {
  const { runCodexSpawn } = await import('../runtime/venture/replay/driver-hooks.ts');
  const saved = recorder(), old = { jobRoot: 'sample-root', mcp: { command: process.execPath, args: ['--safe-mode'] } }, fresh = { ...old, mcp: { ...old.mcp, args: ['--unsafe-mode'] } };
  const spawn = () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { queueMicrotask(() => child.emit('exit', 0)); return true; } });
    child.stdin.on('data', chunk => { const request = JSON.parse(String(chunk)); child.stdout.write(JSON.stringify({ id: request.id, result: 'ok' }) + '\n'); }); return child;
  };
  await inRun({ recorder: saved }, async () => { const rpc = new CodexRpc(runCodexSpawn(spawn, old)); await rpc.request('sample', changed === 'digest' ? { contentDigest: 'a'.repeat(64) } : { argument: old.mcp.args[0] }); await rpc.close(); });
  const replay = createRunReplay(saved.finish([]));
  await inRun({ replay }, async () => {
    const rpc = new CodexRpc(runCodexSpawn(offline, changed === 'argument' ? fresh : old));
    try { await assert.rejects(rpc.request('sample', changed === 'digest' ? { contentDigest: 'b'.repeat(64) } : { argument: fresh.mcp.args[0] }), { code: 'REPLAY_DIVERGED' }); }
    finally { await rpc.close(); }
  });
});
