import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexRpc, type CodexChild } from '../runtime/venture/agent-runtime/codex-rpc.ts';

function fixture() {
  const sent: any[] = []; const child = new EventEmitter() as CodexChild;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new Writable({ write(chunk, _encoding, done) { sent.push(JSON.parse(String(chunk))); done(); } });
  child.kill = () => { child.emit('exit', 1); return true; };
  const receive = (value: unknown) => child.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  return { child, sent, receive };
}
test('Codex RPC correlates concurrent responses while servicing requests and notifications', async () => {
  const f = fixture(), notices: string[] = [];
  const rpc = new CodexRpc(f.child, { onNotification: method => { notices.push(method); }, onRequest: async (method, params) => ({ method, params }) });
  const a = rpc.request('first', {}), b = rpc.request('second', {});
  f.receive({ id: 900, method: 'approval', params: { itemId: 'exact' } });
  f.receive({ method: 'item/started', params: {} });
  f.receive({ id: f.sent[1].id, result: 'B' }); f.receive({ id: f.sent[0].id, result: 'A' });
  assert.deepEqual(await Promise.all([a, b]), ['A', 'B']);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.sent[2], { id: 900, result: { method: 'approval', params: { itemId: 'exact' } } });
  assert.deepEqual(notices, ['item/started']); rpc.close();
});
test('Codex RPC decodes fragmented UTF-8 and refuses oversized or malformed frames', async () => {
  const f = fixture(); const rpc = new CodexRpc(f.child, { maxFrameBytes: 128 });
  const result = rpc.request('fragment', {}); const bytes = Buffer.from(JSON.stringify({ id: f.sent[0].id, result: '₹' }) + '\n');
  for (const byte of bytes) f.child.stdout.emit('data', Buffer.from([byte]));
  assert.equal(await result, '₹'); const pending = rpc.request('pending', {});
  f.child.stdout.emit('data', Buffer.alloc(129, 65)); await assert.rejects(pending, { code: 'CODEX_PROTOCOL_INVALID' });
  const g = fixture(), other = new CodexRpc(g.child); const malformed = other.request('pending', {});
  g.child.stdout.emit('data', Buffer.from('{bad}\n')); await assert.rejects(malformed, { code: 'CODEX_PROTOCOL_INVALID' });
});
test('Codex RPC child exit, EOF and deadline settle pending calls without leaking server errors', async () => {
  for (const event of ['exit', 'end']) {
    const f = fixture(), rpc = new CodexRpc(f.child); const a = rpc.request('a', {}), b = rpc.request('b', {});
    const done = Promise.allSettled([a, b]); if (event === 'exit') f.child.emit('exit', 1); else f.child.stdout.emit('end');
    assert.ok((await done).every(r => r.status === 'rejected' && r.reason.code === 'CODEX_PROCESS_EXITED'));
  }
  const f = fixture(), rpc = new CodexRpc(f.child, { requestTimeoutMs: 5 });
  await assert.rejects(rpc.request('slow', {}), { code: 'CODEX_RPC_TIMEOUT' });
  const rejected = rpc.request('no', {}); f.receive({ id: f.sent.at(-1).id, error: { code: -1, message: 'private provider detail' } });
  await assert.rejects(rejected, error => error instanceof Error && !error.message.includes('private')); rpc.close();
});

test('Codex close waits until its child exits instead of reporting cleanup while it still runs', async () => {
  const f = fixture(); f.child.kill = () => true;
  const rpc = new CodexRpc(f.child); let closed = false;
  const closing = Promise.resolve(rpc.close()).then(() => { closed = true; });
  await new Promise(done => setImmediate(done)); assert.equal(closed, false);
  f.child.emit('exit', 0); await closing; assert.equal(closed, true);
});
