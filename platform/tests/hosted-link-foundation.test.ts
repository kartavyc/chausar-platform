import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Router, json, fields, ok, serve } from '../../hosted/shared/http.ts';
import { check } from '../../hosted/shared/errors.ts';
import { BACKUP_MAX_BODY } from '../../hosted/backup/index.ts';
import { letterToken, isLetterToken, secretHash, sameHex } from '../../hosted/shared/crypto.ts';
import { monthKey } from '../../hosted/shared/clock.ts';
import { JobQueue, Worker, PermanentJobError } from '../../hosted/db/queue.ts';
import { migrate } from '../../hosted/db/sql.ts';
import { HEADLINES, REPLIES, LINK_PAGE, OPT_IN_TEXT, BUTTONS, MAIL_FOOTER, WHATSAPP_TEMPLATE, hasDigit } from '../../hosted/shared/templates.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();

test('letter tokens carry no digits and enough entropy', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) { const token = letterToken(); assert.ok(isLetterToken(token)); assert.equal(hasDigit(token), false); seen.add(token); }
  assert.equal(seen.size, 200);
  assert.equal(isLetterToken('abc1'.padEnd(48, 'x')), false);
  const pepper = 'p'.repeat(32);
  assert.ok(sameHex(secretHash(pepper, 'a', 'x'), secretHash(pepper, 'a', 'x')));
  assert.notEqual(secretHash(pepper, 'a', 'x'), secretHash(pepper, 'b', 'x'));
  assert.throws(() => secretHash('short', 'a', 'x'), { code: 'SERVER_MISCONFIGURED' });
});

test('the fixed catalogue holds no digit anywhere', () => {
  for (const text of [...Object.values(HEADLINES), ...Object.values(REPLIES), ...Object.values(LINK_PAGE), ...Object.values(OPT_IN_TEXT), ...Object.values(BUTTONS), MAIL_FOOTER, ...Object.values(WHATSAPP_TEMPLATE)])
    assert.equal(hasDigit(text), false, text);
  assert.equal(hasDigit('४'), true);
});

test('the month of the message budget is the Indian calendar month', () => {
  assert.equal(monthKey(new Date('2026-10-31T18:29:00Z')), '2026-10');
  assert.equal(monthKey(new Date('2026-10-31T18:31:00Z')), '2026-11');
});

test('the router matches, refuses and never leaks an internal error', async () => {
  const router = new Router()
    .add('POST', '/v1/echo/:id', request => ok({ id: request.params.id, body: fields(json(request), ['a']) }))
    .add('GET', '/boom', () => { throw new Error('secret detail'); });
  const echo = await router.handle({ method: 'POST', url: '/v1/echo/abc', headers: { 'Content-Type': 'application/json' }, body: Buffer.from('{"a":1}') });
  assert.deepEqual(echo, { status: 200, body: { id: 'abc', body: { a: 1 } } });
  assert.equal((await router.handle({ method: 'GET', url: '/v1/echo/abc' })).status, 405);
  assert.equal((await router.handle({ method: 'GET', url: '/nothing' })).status, 404);
  const extra = await router.handle({ method: 'POST', url: '/v1/echo/abc', headers: { 'content-type': 'application/json' }, body: Buffer.from('{"a":1,"b":2}') });
  assert.equal((extra.body as any).error.code, 'INVALID_REQUEST');
  const boom = await router.handle({ method: 'GET', url: '/boom' });
  assert.equal(boom.status, 500); assert.equal(JSON.stringify(boom.body).includes('secret'), false);
});

test('a route that authenticates first refuses from the headers alone, before any body is read', async () => {
  assert.equal(BACKUP_MAX_BODY, 160 * 1024 * 1024);
  let handled = 0, checked = 0;
  const router = new Router().add('PUT', '/v1/big', request => { handled++; return ok({ size: request.body.length }); }, {
    maxBody: 1024, authenticateFirst: async headers => { checked++; check(headers.authorization === 'Bearer letmein', 'UNAUTHENTICATED', 'Sign in first.', 401); },
  });
  // In process: the same preflight runs inside handle.
  const anonymous = await router.handle({ method: 'PUT', url: '/v1/big', body: Buffer.alloc(10) });
  assert.equal(anonymous.status, 401); assert.equal(handled, 0);
  const declared = await router.handle({ method: 'PUT', url: '/v1/big', headers: { authorization: 'Bearer letmein', 'Content-Length': '5000' }, body: Buffer.alloc(10) });
  assert.equal(declared.status, 413); assert.equal(handled, 0);
  assert.equal((await router.handle({ method: 'PUT', url: '/v1/big', headers: { authorization: 'Bearer letmein' }, body: Buffer.alloc(10) })).status, 200);
  // Over a socket: a request that declares a body but never sends it is answered at once, so the body was never awaited.
  const server = await serve(router, { port: 0, host: '127.0.0.1' });
  try {
    const port = (server.address() as AddressInfo).port;
    const send = (headers: Record<string, string>, body?: Buffer) => new Promise<{ status: number; body: any }>((resolve, reject) => {
      const outgoing = httpRequest({ host: '127.0.0.1', port, method: 'PUT', path: '/v1/big', headers }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      outgoing.on('error', reject);
      if (body) outgoing.end(body); else outgoing.flushHeaders();
    });
    checked = 0;
    const early = await send({ 'content-length': '900' });
    assert.equal(early.status, 401); assert.equal(early.body.error.code, 'UNAUTHENTICATED'); assert.equal(checked, 1);
    const tooLarge = await send({ authorization: 'Bearer letmein', 'content-length': String(64 * 1024 * 1024) });
    assert.equal(tooLarge.status, 413); assert.equal(tooLarge.body.error.code, 'BODY_TOO_LARGE');
    const fine = await send({ authorization: 'Bearer letmein', 'content-length': '10' }, Buffer.alloc(10));
    assert.deepEqual(fine, { status: 200, body: { size: 10 } });
    assert.equal(handled, 2);
  } finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
});

test('the job queue claims once, retries with backoff and survives a lost lease', { skip: pgSkip }, async () => {
  const sql = await freshDatabase();
  assert.deepEqual(await migrate(sql), [], 'migrations apply once');
  let time = new Date('2026-10-14T10:00:00Z');
  const queue = new JobQueue(sql, () => time);
  const id = await queue.enqueue({ type: 'test.job', payload: { n: 'one' }, dedupeKey: 'only-once' });
  assert.equal(await queue.enqueue({ type: 'test.job', dedupeKey: 'only-once' }), id);
  const [first] = await queue.claim(['test.job'], { leaseMs: 1000 });
  assert.equal(first.id, id);
  assert.deepEqual(await queue.claim(['test.job']), [], 'a leased job is not claimed twice');
  time = new Date(time.getTime() + 2000);
  const [again] = await queue.claim(['test.job']);
  assert.equal(again.id, id); assert.equal(again.attempts, 2);
  assert.equal(await queue.complete(first), false, 'the lapsed lease cannot complete it');
  assert.equal(await queue.fail(again, 'PROVIDER_DOWN'), 'queued');
  assert.deepEqual(await queue.claim(['test.job']), [], 'backoff holds it');
  time = new Date(time.getTime() + 60000);
  const worker = new Worker(queue);
  let calls = 0;
  worker.register('test.job', async () => { calls++; throw new PermanentJobError('RECIPIENT_REFUSED'); });
  assert.deepEqual(await worker.runOnce(), { done: 0, retried: 0, dead: 1 });
  assert.equal(calls, 1);
  assert.deepEqual(await queue.status(id), { status: 'dead', attempts: 3, lastError: 'RECIPIENT_REFUSED' });
});
