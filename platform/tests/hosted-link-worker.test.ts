import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Router, type HostedResponse } from '../../hosted/shared/http.ts';
import { HostedError, check } from '../../hosted/shared/errors.ts';
import { FREE_ENTITLEMENTS, type Entitlements } from '../../hosted/shared/auth.ts';
import type { HostedDeps, HostedModule } from '../../hosted/shared/module.ts';
import type { Sql } from '../../hosted/db/sql.ts';
import { JobQueue, Worker } from '../../hosted/db/queue.ts';
import { createWorkerJobsModule, runWorkerProcess, indianDate, WORKER_LABEL, REMINDER_JOB } from '../../hosted/worker/index.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const PAID: Entitlements = { ...FREE_ENTITLEMENTS, plan: 'paid', worker: true };
const CONSENT = { notEndToEndEncrypted: true, recordedAt: '2026-10-14T09:59:00.000Z' };

async function setup() {
  const sql = await freshDatabase();
  let time = new Date('2026-10-14T10:00:00Z');
  const clock = () => time;
  const plans = new Map<string, Entitlements>([['acct_a', PAID], ['acct_b', PAID]]);
  const queue = new JobQueue(sql, clock);
  const deps: HostedDeps = {
    sql, clock, queue, fetch: async () => { throw new Error('no network in tests'); }, pepper: 'p'.repeat(32), linkOrigin: 'https://link.chausar.test',
    authenticate: async request => { const accountId = request.headers['x-test-account']; check(accountId, 'UNAUTHENTICATED', 'Sign in first.', 401); return { accountId, deviceId: 'dev_a', sessionId: 'ses_a' }; },
    entitlements: async accountId => plans.get(accountId) ?? FREE_ENTITLEMENTS,
  };
  const sent: string[] = [];
  const module = createWorkerJobsModule(deps, { async sendDueDateReminder(accountId) { sent.push(accountId); } });
  const router = new Router(); module.routes(router);
  const worker = new Worker(queue); module.jobs!(worker);
  const replies: HostedResponse[] = [];
  const call = async (method: string, url: string, body?: unknown, account = 'acct_a') => {
    const reply = await router.handle({ method, url, headers: { 'x-test-account': account, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)) });
    replies.push(reply); return reply;
  };
  return { sql, module, worker, plans, sent, replies, call, setTime: (at: string) => { time = new Date(at); } };
}
const code = (reply: HostedResponse) => (reply.body as any)?.error?.code;
const queued = async (sql: Sql) => (await sql.query(`SELECT account_id, payload, dedupe_key, status FROM jobs WHERE type = $1 ORDER BY created_at, dedupe_key`, [REMINDER_JOB])).rows;

test('the Indian date turns at half past six in the evening UTC', () => {
  assert.equal(indianDate(new Date('2026-10-16T18:29:59Z')), '2026-10-16');
  assert.equal(indianDate(new Date('2026-10-16T18:30:00Z')), '2026-10-17');
});

test('every worker reply, refusals included, says it is not end-to-end encrypted', { skip: pgSkip }, async () => {
  const { call, replies, plans } = await setup();
  plans.set('acct_free', FREE_ENTITLEMENTS);
  const listed = await call('GET', '/v1/worker');
  assert.deepEqual(listed.body, {
    endToEndEncrypted: false, label: WORKER_LABEL,
    jobs: [{ type: 'due-date-reminder', title: 'Due date reminders while your computer is off', enabled: false, consentAt: null, uses: 'Your due dates (date only, no amounts or names)' }],
  });
  const noConsent = await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: true, consent: null });
  assert.equal(noConsent.status, 400); assert.equal(code(noConsent), 'CONSENT_REQUIRED');
  assert.equal(code(await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: true, consent: { notEndToEndEncrypted: false, recordedAt: CONSENT.recordedAt } })), 'CONSENT_REQUIRED');
  assert.equal(code(await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: true, consent: { ...CONSENT, extra: 1 } })), 'INVALID_REQUEST');
  const free = await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: true, consent: CONSENT }, 'acct_free');
  assert.equal(free.status, 402); assert.equal(code(free), 'PLAN_REQUIRED');
  assert.equal(code(await call('PUT', '/v1/worker/due-dates', { dueDates: [] }, 'acct_free')), 'PLAN_REQUIRED');
  const early = await call('PUT', '/v1/worker/due-dates', { dueDates: [{ id: 'gst', date: '2026-10-20', remindDaysBefore: 3 }] });
  assert.equal(early.status, 409); assert.equal(code(early), 'JOB_NOT_ENABLED', 'no input is stored before consent');
  assert.equal((await call('PUT', '/v1/worker/jobs/payroll', { enabled: true, consent: CONSENT })).status, 404);
  assert.equal((await call('GET', '/v1/worker', undefined, '')).status, 401);
  const on = await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: true, consent: CONSENT });
  assert.deepEqual(on.body, { endToEndEncrypted: false, label: WORKER_LABEL, type: 'due-date-reminder', title: 'Due date reminders while your computer is off', enabled: true, consentAt: '2026-10-14T10:00:00.000Z', uses: 'Your due dates (date only, no amounts or names)' });
  assert.deepEqual((await call('PUT', '/v1/worker/due-dates', { dueDates: [{ id: 'gst', date: '2026-10-20', remindDaysBefore: 3 }] })).body, { endToEndEncrypted: false, label: WORKER_LABEL, stored: 1 });
  assert.deepEqual((await call('DELETE', '/v1/worker/data')).body, { endToEndEncrypted: false, label: WORKER_LABEL, deleted: true });
  assert.ok(replies.length >= 12);
  for (const reply of replies) { assert.equal((reply.body as any).endToEndEncrypted, false); assert.equal((reply.body as any).label, WORKER_LABEL); }
  assert.match(WORKER_LABEL, /not end-to-end encrypted/);
});

test('due dates are validated and replaced as a whole set', { skip: pgSkip }, async () => {
  const { call, sql } = await setup();
  await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: true, consent: CONSENT });
  const bad = [
    { dueDates: Array.from({ length: 201 }, (_, i) => ({ id: `d${i}`, date: '2026-10-20', remindDaysBefore: 1 })) },
    { dueDates: [{ id: 'a b', date: '2026-10-20', remindDaysBefore: 1 }] }, { dueDates: [{ id: 'x'.repeat(65), date: '2026-10-20', remindDaysBefore: 1 }] },
    { dueDates: [{ id: 'a', date: '2026-02-30', remindDaysBefore: 1 }] }, { dueDates: [{ id: 'a', date: '20-10-2026', remindDaysBefore: 1 }] },
    { dueDates: [{ id: 'a', date: '2026-10-20', remindDaysBefore: 31 }] }, { dueDates: [{ id: 'a', date: '2026-10-20', remindDaysBefore: -1 }] },
    { dueDates: [{ id: 'a', date: '2026-10-20', remindDaysBefore: 1, amount: '1250' }] },
    { dueDates: [{ id: 'a', date: '2026-10-20', remindDaysBefore: 1 }, { id: 'a', date: '2026-10-21', remindDaysBefore: 1 }] },
    { dueDates: {} }, { dueDates: [], note: 'x' },
  ];
  for (const body of bad) assert.equal(code(await call('PUT', '/v1/worker/due-dates', body)), 'INVALID_REQUEST', JSON.stringify(body).slice(0, 80));
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `due_${i}`, date: '2026-12-01', remindDaysBefore: 30 }));
  assert.equal(((await call('PUT', '/v1/worker/due-dates', { dueDates: many })).body as any).stored, 200);
  assert.equal(((await call('PUT', '/v1/worker/due-dates', { dueDates: [{ id: 'tds', date: '2026-11-07', remindDaysBefore: 0 }] })).body as any).stored, 1);
  const { rows } = await sql.query(`SELECT id, to_char(due_on, 'YYYY-MM-DD') AS due_on, remind_days_before FROM worker_due_dates`);
  assert.deepEqual(rows, [{ id: 'tds', due_on: '2026-11-07', remind_days_before: 0 }]);
});

test('a due-date reminder is queued once per due date per Indian day inside the window, and only then', { skip: pgSkip }, async () => {
  const { call, module, worker, sent, sql, setTime } = await setup();
  await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: true, consent: CONSENT });
  await call('PUT', '/v1/worker/due-dates', { dueDates: [{ id: 'gst', date: '2026-10-20', remindDaysBefore: 3 }, { id: 'tds', date: '2026-10-18', remindDaysBefore: 0 }] });
  await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: true, consent: CONSENT }, 'acct_b');
  await call('PUT', '/v1/worker/due-dates', { dueDates: [{ id: 'gst', date: '2026-10-20', remindDaysBefore: 3 }] }, 'acct_b');
  await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: false, consent: null }, 'acct_b');

  await module.sweep!();
  assert.deepEqual(await queued(sql), [], 'the fourteenth is before every window');
  setTime('2026-10-16T18:29:00Z'); await module.sweep!();
  assert.deepEqual(await queued(sql), [], 'still the sixteenth in India');
  setTime('2026-10-16T18:30:00Z'); await module.sweep!(); await module.sweep!();
  assert.deepEqual(await queued(sql), [{ account_id: 'acct_a', payload: { dueDateId: 'gst' }, dedupe_key: `${REMINDER_JOB}:acct_a:gst:2026-10-17`, status: 'queued' }],
    'the first window day, once, and nothing for the account that turned the job off');
  assert.deepEqual(await worker.runOnce(), { done: 1, retried: 0, dead: 0 });
  assert.deepEqual(sent, ['acct_a']);
  setTime('2026-10-17T12:00:00Z'); await module.sweep!();
  assert.deepEqual(await worker.runOnce(), { done: 0, retried: 0, dead: 0 }, 'the same day never reminds twice');
  setTime('2026-10-17T19:00:00Z'); await module.sweep!(); await module.sweep!();
  assert.deepEqual(await worker.runOnce(), { done: 2, retried: 0, dead: 0 }, 'the eighteenth: gst again and tds on its day');
  for (const day of ['2026-10-18T19:00:00Z', '2026-10-19T19:00:00Z']) { setTime(day); await module.sweep!(); await worker.runOnce(); }
  assert.equal(sent.length, 5, 'gst on the 17th to the 20th, tds on the 18th');
  setTime('2026-10-20T19:00:00Z'); await module.sweep!();
  assert.deepEqual(await worker.runOnce(), { done: 0, retried: 0, dead: 0 }, 'nothing after the due date');
  assert.equal(sent.length, 5);
});

test('a queued reminder is dropped when the person turns the job off, deletes the data or the plan lapses', { skip: pgSkip }, async () => {
  const { call, module, worker, sent, sql, setTime, plans } = await setup();
  const prepare = async () => {
    await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: true, consent: CONSENT });
    await call('PUT', '/v1/worker/due-dates', { dueDates: [{ id: 'gst', date: '2026-10-20', remindDaysBefore: 30 }] });
  };
  await prepare(); await module.sweep!();
  assert.equal((await queued(sql)).length, 1);
  assert.deepEqual((await call('DELETE', '/v1/worker/data')).body, { endToEndEncrypted: false, label: WORKER_LABEL, deleted: true });
  assert.deepEqual(await queued(sql), [], 'the queued reminder went with the data');
  assert.equal((await sql.query('SELECT count(*)::int AS n FROM worker_due_dates')).rows[0].n, 0);
  assert.deepEqual(((await call('GET', '/v1/worker')).body as any).jobs[0].enabled, false);
  setTime('2026-10-15T10:00:00Z'); await prepare(); await module.sweep!();
  await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: false, consent: null });
  assert.equal((await sql.query('SELECT count(*)::int AS n FROM worker_due_dates')).rows[0].n, 0, 'turning off removes the inputs');
  assert.deepEqual(await worker.runOnce(), { done: 0, retried: 0, dead: 0 });
  setTime('2026-10-16T10:00:00Z'); await prepare(); await module.sweep!();
  plans.set('acct_a', FREE_ENTITLEMENTS);
  assert.deepEqual(await worker.runOnce(), { done: 1, retried: 0, dead: 0 });
  assert.deepEqual(sent, [], 'a lapsed plan sends nothing');
});

test('the worker process runs the queue and sweeps every module until stopped', async () => {
  let sweeps = 0; const errors: string[] = [];
  const modules: HostedModule[] = [
    { id: 'counting', routes() {}, async sweep() { sweeps++; } },
    { id: 'failing', routes() {}, async sweep() { throw new HostedError('BLOB_STORE_NOT_CONFIGURED', 'x', 503); } },
    { id: 'quiet', routes() {} },
  ];
  const controller = new AbortController();
  const worker = new Worker(new JobQueue(null as unknown as Sql, () => new Date()));
  const running = runWorkerProcess({ worker, modules, signal: controller.signal, sweepEveryMs: 10, idleMs: 5, onError: (id, code) => errors.push(`${id}:${code}`) });
  while (sweeps < 3) await new Promise(resolve => setTimeout(resolve, 5));
  controller.abort(); await running;
  const after = sweeps; await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(sweeps, after, 'nothing runs after the signal');
  assert.ok(errors.length >= 3); assert.equal(errors[0], 'failing:BLOB_STORE_NOT_CONFIGURED');
});
