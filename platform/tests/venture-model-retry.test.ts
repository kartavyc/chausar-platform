// Ink v2 wave 1 (H15): one retry policy for calls that leave this computer. Only a 429 is asked again (after its
// Retry-After, never longer than 30 seconds), and a read after a transport error. A create or a send that fails in a way
// that may have reached the other side is outcome unknown and never asked again. One deadline per call, never reset.
// Status codes the policy does not know fail closed. The policy runs on a fake clock; the model transport on a
// loopback server, so nothing leaves this computer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { ModelPurpose } from '../runtime/venture/contracts.ts';
import { JOURNAL_ACTIONS } from '../runtime/venture/journal/journal.ts';
import {
  RETRY_AFTER_CAP_MS, RETRY_DEFAULT_WAIT_MS, RETRY_MAX_ATTEMPTS, callWithRetry, defaultModelTransport, retryAfterMs, startDeadline, statusClass,
  type AttemptResult, type CallEffect,
} from '../runtime/venture/models/transport.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const T0 = Date.parse('2026-10-23T10:00:00.000Z');

/** A fake clock: sleeping moves it on, and an attempt can say how long it took. */
function clock() {
  let now = T0;
  const waits: number[] = [];
  return { now: () => now, sleep: async (ms: number) => { waits.push(ms); now += ms; }, pass: (ms: number) => { now += ms; }, waits };
}

/** Answers from a list in order, and keeps the timeout each try was given. took: how long each try lasts on the clock. */
function scripted(time: ReturnType<typeof clock>, answers: AttemptResult<string>[], took: number[] = []) {
  const timeouts: number[] = [];
  return {
    timeouts,
    attempt: async (timeoutMs: number): Promise<AttemptResult<string>> => {
      const index = timeouts.length;
      timeouts.push(timeoutMs);
      time.pass(took[index] ?? 0);
      const answer = answers[index];
      assert.ok(answer, `try ${index + 1} was not expected`);
      return answer;
    },
  };
}
const answer = (status: number, retryAfter?: string | null): AttemptResult<string> => ({ kind: 'answer', status, retryAfter: retryAfter ?? null, value: `HTTP ${status}` });
const run = (time: ReturnType<typeof clock>, effect: CallEffect, deadlineMs: number, attempt: (timeoutMs: number) => Promise<AttemptResult<string>>) =>
  callWithRetry({ effect, deadlineMs, now: time.now, sleep: time.sleep }, attempt);

// ---------------------------------------------------------------------------
// 1. The policy
// ---------------------------------------------------------------------------

test('a 429 is asked again after its Retry-After, clamped to 30 seconds, for a read, a create or a send', async () => {
  for (const effect of ['read', 'create', 'send'] as const) {
    const time = clock();
    const calls = scripted(time, [answer(429, '2'), answer(200)]);
    assert.deepEqual(await run(time, effect, 60_000, calls.attempt), { outcome: 'done', value: 'HTTP 200', status: 200, attempts: 2 }, effect);
    assert.deepEqual(time.waits, [2000], effect);
  }
  const long = clock();
  await run(long, 'send', 120_000, scripted(long, [answer(429, '120'), answer(200)]).attempt);
  assert.deepEqual(long.waits, [RETRY_AFTER_CAP_MS]);
  assert.equal(RETRY_AFTER_CAP_MS, 30_000);

  assert.equal(retryAfterMs('0', T0), 0);
  assert.equal(retryAfterMs('7', T0), 7000);
  assert.equal(retryAfterMs('3600', T0), 30_000);
  assert.equal(retryAfterMs(new Date(T0 + 5000).toUTCString(), T0), 5000, 'an HTTP date, read against the clock');
  assert.equal(retryAfterMs(new Date(T0 + 600_000).toUTCString(), T0), 30_000);
  assert.equal(retryAfterMs(new Date(T0 - 5000).toUTCString(), T0), 0, 'a date already past');
  for (const missing of [null, undefined, '', 'soon', '-5', '1.5']) assert.equal(retryAfterMs(missing, T0), RETRY_DEFAULT_WAIT_MS, String(missing));
});

test('a 429 that never clears stops at the try limit and fails: a 429 means nothing was done, so it is never unknown', async () => {
  const time = clock();
  const busy = Array.from({ length: RETRY_MAX_ATTEMPTS }, () => answer(429, '0'));
  const calls = scripted(time, busy);
  const result = await run(time, 'send', 60_000, calls.attempt);
  assert.deepEqual(result, { outcome: 'failed', cause: 'busy', status: 429, value: 'HTTP 429', attempts: RETRY_MAX_ATTEMPTS });
  assert.equal(calls.timeouts.length, RETRY_MAX_ATTEMPTS);
});

test('one deadline per call: each try gets what is left, a wait that does not fit is not taken, and nothing resets it', async () => {
  const time = clock();
  const calls = scripted(time, [answer(429, '2'), answer(429, '10')], [3000, 1000]);
  const result = await run(time, 'send', 10_000, calls.attempt);
  assert.deepEqual(calls.timeouts, [10_000, 5000], 'the second try gets 10 s less the 3 s of the first and its 2 s wait');
  assert.deepEqual(time.waits, [2000], 'a 10 s wait does not fit the 4 s left, so it is not taken');
  assert.deepEqual(result, { outcome: 'failed', cause: 'busy', status: 429, value: 'HTTP 429', attempts: 2 });

  // A read that times out has used its time: no second try.
  const slow = clock();
  const reads = scripted(slow, [{ kind: 'timed-out' }, answer(200)], [8000]);
  assert.deepEqual(await run(slow, 'read', 8000, reads.attempt), { outcome: 'failed', cause: 'timed-out', status: null, value: null, attempts: 1 });

  const budget = clock();
  const deadline = startDeadline(10_000, budget.now);
  budget.pass(1000);
  assert.equal(deadline.remaining(), 9000);
  assert.equal(deadline.fits(9000), true);
  assert.equal(deadline.fits(9001), false);
  budget.pass(20_000);
  assert.equal(deadline.remaining(), 0);
  assert.throws(() => startDeadline(0, budget.now), code('INVALID_VENTURE_REQUEST'));
});

test('a create or a send asks again after a 429 only when the wait and half the first deadline still fit; a read needs only the wait to fit', async () => {
  for (const effect of ['create', 'send'] as const) {
    const late = clock();
    const calls = scripted(late, [answer(429, '0'), answer(200)], [6000]);
    assert.deepEqual(await run(late, effect, 10_000, calls.attempt), { outcome: 'failed', cause: 'busy', status: 429, value: 'HTTP 429', attempts: 1 },
      `${effect}: 4 s left is less than the 5 s a try needs, so nothing more is sent`);
    const early = clock();
    const fine = scripted(early, [answer(429, '1'), answer(200)], [3000]);
    assert.deepEqual(await run(early, effect, 10_000, fine.attempt), { outcome: 'done', value: 'HTTP 200', status: 200, attempts: 2 }, `${effect}: 1 s + 5 s fit the 7 s left`);
    assert.deepEqual(fine.timeouts, [10_000, 6000]);
  }
  const read = clock();
  const reads = scripted(read, [answer(429, '0'), answer(200)], [6000]);
  assert.deepEqual(await run(read, 'read', 10_000, reads.attempt), { outcome: 'done', value: 'HTTP 200', status: 200, attempts: 2 });
});

test('transport errors: a read is asked again; a create or a send that may have arrived is unknown and never asked again', async () => {
  for (const failure of [{ kind: 'broken' }, { kind: 'not-connected' }, { kind: 'timed-out' }] as const) {
    const time = clock();
    const calls = scripted(time, [failure, answer(200)]);
    const result = await run(time, 'read', 60_000, calls.attempt);
    assert.deepEqual(result, { outcome: 'done', value: 'HTTP 200', status: 200, attempts: 2 }, failure.kind);
  }
  const reads = clock();
  const always = scripted(reads, Array.from({ length: RETRY_MAX_ATTEMPTS }, () => ({ kind: 'broken' as const })));
  assert.deepEqual(await run(reads, 'read', 60_000, always.attempt), { outcome: 'failed', cause: 'broken', status: null, value: null, attempts: RETRY_MAX_ATTEMPTS });

  for (const effect of ['create', 'send'] as const) {
    for (const [failure, outcome] of [['broken', 'unknown'], ['timed-out', 'unknown'], ['not-connected', 'failed']] as const) {
      const time = clock();
      const calls = scripted(time, [{ kind: failure }]);
      const result = await run(time, effect, 60_000, calls.attempt);
      assert.deepEqual(result, { outcome, cause: failure, status: null, value: null, attempts: 1 }, `${effect} ${failure}`);
      assert.deepEqual(time.waits, [], 'never asked again');
    }
  }
});

test('status codes: 2xx is done, a named refusal fails, anything else fails closed: a read fails, a create or a send is unknown', async () => {
  for (const status of [200, 201, 204, 299]) assert.equal(statusClass(status), 'ok', String(status));
  assert.equal(statusClass(429), 'busy');
  for (const status of [400, 401, 403, 404, 409, 422, 424]) assert.equal(statusClass(status), 'refused', String(status));
  const unclear = [0, 100, 199, 302, 303, 408, 418, 499, 500, 502, 503, 504, 529, 600, 200.5, Number.NaN];
  for (const status of unclear) assert.equal(statusClass(status), 'unclear', String(status));
  assert.equal(statusClass('200'), 'unclear', 'a status that is not a number fails closed');
  // A conflict or a failed dependency on a create or a send may mean part of it, or an earlier try, went through.
  for (const status of [409, 424]) {
    assert.equal(statusClass(status, 'read'), 'refused', String(status));
    for (const effect of ['create', 'send'] as const) assert.equal(statusClass(status, effect), 'unclear', `${effect} ${status}`);
  }

  for (const status of [401, 403, 422]) {
    for (const effect of ['read', 'create', 'send'] as const) {
      const time = clock();
      const result = await run(time, effect, 60_000, scripted(time, [answer(status)]).attempt);
      assert.deepEqual(result, { outcome: 'failed', cause: 'status', status, value: `HTTP ${status}`, attempts: 1 }, `${effect} ${status}`);
    }
  }
  for (const status of [409, 424]) {
    for (const effect of ['read', 'create', 'send'] as const) {
      const time = clock();
      const result = await run(time, effect, 60_000, scripted(time, [answer(status)]).attempt);
      assert.deepEqual(result, { outcome: effect === 'read' ? 'failed' : 'unknown', cause: 'status', status, value: `HTTP ${status}`, attempts: 1 }, `${effect} ${status}`);
    }
  }
  for (const status of [0, 302, 418, 500, 503, 600]) {
    for (const effect of ['read', 'create', 'send'] as const) {
      const time = clock();
      const result = await run(time, effect, 60_000, scripted(time, [answer(status)]).attempt);
      const expected = effect === 'read' ? 'failed' : 'unknown';
      assert.deepEqual(result, { outcome: expected, cause: 'status', status, value: `HTTP ${status}`, attempts: 1 }, `${effect} ${status}`);
      assert.deepEqual(time.waits, [], `${effect} ${status}: never asked again`);
    }
  }
});

test('an attempt that throws stops the call with its own error, and nothing is asked again', async () => {
  const time = clock();
  let tries = 0;
  await assert.rejects(run(time, 'read', 60_000, async () => { tries += 1; throw new TypeError('boom'); }), TypeError);
  assert.equal(tries, 1);
});

// ---------------------------------------------------------------------------
// 2. The model transport uses it: a model call is a send
// ---------------------------------------------------------------------------

async function serve(t: { after(fn: () => unknown): void }, handle: (path: string, count: number, response: import('node:http').ServerResponse, request: import('node:http').IncomingMessage) => void) {
  const counts = new Map<string, number>();
  const server: Server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      const path = request.url ?? '/';
      const count = (counts.get(path) ?? 0) + 1;
      counts.set(path, count);
      handle(path, count, response, request);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { url: (path: string) => `http://127.0.0.1:${(server.address() as any).port}${path}`, count: (path: string) => counts.get(path) ?? 0 };
}
const base = { method: 'POST' as const, headers: { 'content-type': 'application/json' }, body: '{"model":"x"}', timeoutMs: 5000, purpose: 'interview' as ModelPurpose };
const reply = (response: import('node:http').ServerResponse, status: number, headers: Record<string, string> = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify({ status }));
};

test('model transport: a 429 is asked again within the call deadline; a refusal comes back for the parser to word', async t => {
  const server = await serve(t, (path, count, response) => {
    if (path === '/busy-then-ok') return reply(response, count === 1 ? 429 : 200, count === 1 ? { 'retry-after': '0' } : {});
    if (path === '/always-busy') return reply(response, 429, { 'retry-after': '0' });
    if (path === '/refused') return reply(response, 401);
    reply(response, 404);
  });
  const transport = defaultModelTransport();
  assert.deepEqual(await transport.http({ ...base, url: server.url('/busy-then-ok') }), { status: 200, body: '{"status":200}' });
  assert.equal(server.count('/busy-then-ok'), 2);
  assert.deepEqual(await transport.http({ ...base, url: server.url('/always-busy') }), { status: 429, body: '{"status":429}' });
  assert.equal(server.count('/always-busy'), RETRY_MAX_ATTEMPTS);
  assert.deepEqual(await transport.http({ ...base, url: server.url('/refused') }), { status: 401, body: '{"status":401}' });
  assert.equal(server.count('/refused'), 1);
});

test('model transport: a 5xx or a connection that breaks part way is outcome unknown and never asked again', async t => {
  const server = await serve(t, (path, _count, response, request) => {
    if (path === '/error') return reply(response, 500);
    if (path === '/break') { request.socket.destroy(); return; }
    if (path === '/half') { response.writeHead(200, { 'content-length': '100' }); response.write('{"par'); setTimeout(() => request.socket.destroy(), 10); return; }
    reply(response, 200);
  });
  const transport = defaultModelTransport();
  for (const path of ['/error', '/break', '/half']) {
    await assert.rejects(transport.http({ ...base, url: server.url(path) }), code('MODEL_OUTCOME_UNKNOWN'), path);
    assert.equal(server.count(path), 1, `${path}: asked once`);
  }
  await assert.rejects(transport.http({ ...base, url: server.url('/error') }), (error: any) => /HTTP 500/.test(error.message) && /did not retry/.test(error.message));
  assert.ok(JOURNAL_ACTIONS['delivery.send'].unknownCodes.includes('MODEL_OUTCOME_UNKNOWN'), 'the journal holds such a send as outcome unknown');
});

test('model transport: once the request reached the provider, a redirect or an answer too big to read is outcome unknown, not a plain failure', async t => {
  const big = 'x'.repeat(1_048_577);
  const server = await serve(t, (path, _count, response) => {
    if (path === '/see-other') { response.writeHead(303, { location: 'http://127.0.0.1:1/elsewhere' }); response.end(); return; }
    if (path === '/error-big') { response.writeHead(500); response.end(big); return; }
    if (path === '/ok-big') { response.writeHead(200); response.end(big); return; }
    if (path === '/ok-big-declared') { response.writeHead(200, { 'content-length': String(big.length) }); response.end(big); return; }
    if (path === '/refused-big') { response.writeHead(401); response.end(big); return; }
    if (path === '/busy-big') { response.writeHead(429, { 'retry-after': '0' }); response.end(big); return; }
    reply(response, 404);
  });
  const transport = defaultModelTransport();
  for (const path of ['/see-other', '/error-big', '/ok-big', '/ok-big-declared']) {
    await assert.rejects(transport.http({ ...base, url: server.url(path) }), code('MODEL_OUTCOME_UNKNOWN'), path);
    assert.equal(server.count(path), 1, `${path}: asked once, never followed or retried`);
  }
  // A named refusal or a 429 did nothing, so a big body changes nothing: the status comes back for the parser to word.
  assert.deepEqual(await transport.http({ ...base, url: server.url('/refused-big') }), { status: 401, body: '' });
  assert.deepEqual(await transport.http({ ...base, url: server.url('/busy-big') }), { status: 429, body: '' });
  assert.equal(server.count('/busy-big'), RETRY_MAX_ATTEMPTS);
});

test('model transport: never reached is a plain failure with nothing sent; one deadline covers the retries and is never reset', async t => {
  const closed = createServer();
  await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
  const port = (closed.address() as any).port;
  await new Promise<void>(resolve => closed.close(() => resolve()));
  const transport = defaultModelTransport();
  await assert.rejects(transport.http({ ...base, url: `http://127.0.0.1:${port}/` }), (error: any) => error.code === 'MODEL_FAILED' && /Nothing was sent/.test(error.message));

  const server = await serve(t, (path, count, response) => {
    if (path === '/busy-then-hang' && count === 1) return reply(response, 429, { 'retry-after': '0' });
    if (path === '/busy-then-hang') return; // never answers
    reply(response, 200);
  });
  const started = Date.now();
  await assert.rejects(transport.http({ ...base, timeoutMs: 400, url: server.url('/busy-then-hang') }), code('MODEL_TIMEOUT'));
  const took = Date.now() - started;
  assert.equal(server.count('/busy-then-hang'), 2);
  assert.ok(took < 1500, `the whole call stayed near its 400 ms deadline (took ${took} ms)`);
});
