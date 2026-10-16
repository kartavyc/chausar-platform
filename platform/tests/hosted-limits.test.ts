// Hosted tier: rate and budget limits. Token buckets with an injected clock, a per-account concurrency gate, and a
// monthly AI ceiling summed with BigInt from costs the model port recorded. The hosted transport applies them all
// before a call leaves, and never starts a process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import { ConcurrencyGate, RateLimiter, checkMonthlyCeiling, monthOf, monthSpendMicros, type UsageEntry } from '../runtime/hosted/limits.ts';
import { hostedModelTransport, usageFromCalls } from '../runtime/hosted/models.ts';
import { formatMicros } from '../runtime/venture/records.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const entry = (callId: string, month: string, costMicros: string): UsageEntry => ({ callId, businessId: 'b_' + 'a'.repeat(24), month, costMicros, at: `${month}-01T00:00:00.000Z` });

test('a token bucket refills one token per period, per key, up to its capacity', () => {
  let now = 0;
  const limiter = new RateLimiter('test', { capacity: 2, refillEveryMs: 1000 }, () => now);
  limiter.take('a'); limiter.take('a');
  assert.throws(() => limiter.take('a'), (error: any) => error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 1);
  limiter.take('b');
  now = 999; assert.throws(() => limiter.take('a'), code('RATE_LIMITED'));
  now = 1000; limiter.take('a');
  now = 10_000; assert.equal(limiter.remaining('a'), 2, 'never more than capacity');
  assert.throws(() => new RateLimiter('bad', { capacity: 0, refillEveryMs: 1 }), code('INVALID_LIMIT'));
});

test('the concurrency gate lets a few calls run at once per key and frees the slot on failure', async () => {
  const gate = new ConcurrencyGate(1);
  let release!: () => void;
  const running = gate.run('t', () => new Promise<void>(resolve => { release = resolve; }));
  await assert.rejects(gate.run('t', async () => 'second'), code('RATE_LIMITED'));
  assert.equal(await gate.run('other', async () => 'fine'), 'fine');
  release(); await running;
  await assert.rejects(gate.run('t', async () => { throw new Error('boom'); }));
  assert.equal(gate.active('t'), 0);
});

test('the monthly ceiling is a BigInt sum of recorded costs for the month, and refuses once reached', () => {
  const entries = [entry('c1', '2026-10', '9000000'), entry('c2', '2026-10', '999999'), entry('c3', '2026-09', '50000000')];
  assert.equal(monthSpendMicros(entries, '2026-10'), 9999999n);
  checkMonthlyCeiling(entries, '2026-10', '10000000', formatMicros);
  assert.throws(() => checkMonthlyCeiling([...entries, entry('c4', '2026-10', '1')], '2026-10', '10000000', formatMicros),
    (error: any) => error.code === 'BUDGET_REACHED' && /USD 10\.0000/.test(error.message) && /first of the month/.test(error.message));
  assert.equal(monthOf('2026-10-31T23:59:59.999Z'), '2026-10');
  assert.throws(() => monthOf('yesterday'), code('INVALID_LIMIT'));
});

test('usage entries come only from finished calls with a cost, once each', () => {
  const calls = [
    { id: 'call_1', at: '2026-10-16T09:00:00.000Z', status: 'completed', costMicros: '1200' },
    { id: 'call_2', at: '2026-10-16T09:01:00.000Z', status: 'failed', costMicros: '300' },
    { id: 'call_3', at: '2026-10-16T09:02:00.000Z', status: 'dispatching', costMicros: null },
    { id: 'call_4', at: '2026-10-16T09:03:00.000Z', status: 'preview', costMicros: null },
    { id: 'call_5', at: '2026-10-16T09:04:00.000Z', status: 'completed', costMicros: '-5' },
  ];
  const fresh = usageFromCalls('b_' + 'b'.repeat(24), calls, [entry('call_1', '2026-10', '1200')]);
  assert.deepEqual(fresh.map(e => [e.callId, e.costMicros, e.month]), [['call_2', '300', '2026-10']]);
});

test('the hosted transport gates every call before it leaves and never runs a process', async () => {
  let sent = 0, dispatched = 0, now = Date.parse('2026-10-16T09:00:00.000Z');
  const usage: UsageEntry[] = [];
  const inner = { replay: true, async http() { sent++; return { status: 200, body: '{}' }; }, async process() { throw new Error('must not run'); } };
  const transport = hostedModelTransport({
    tenantId: 't_' + 'a'.repeat(24), inner, usage: () => usage, ceilingMicros: '1000',
    rate: new RateLimiter('model', { capacity: 2, refillEveryMs: 60_000 }, () => now), gate: new ConcurrencyGate(1),
    clock: () => new Date(now), dispatched: () => { dispatched++; },
  });
  assert.equal(transport.replay, true);
  const request = { url: 'https://api.anthropic.com/v1/messages', method: 'POST' as const, headers: {}, body: '{}', timeoutMs: 1000, purpose: 'interview' as const };
  await transport.http(request);
  await transport.http(request);
  await assert.rejects(transport.http(request), code('RATE_LIMITED'));
  assert.equal(sent, 2); assert.equal(dispatched, 2);
  now += 120_000;
  usage.push(entry('c1', '2026-10', '1000'));
  await assert.rejects(transport.http(request), code('BUDGET_REACHED'));
  assert.equal(sent, 2, 'nothing left the server once the ceiling was reached');
  await assert.rejects(transport.process({ command: 'claude', args: [], env: {}, stdin: '', timeoutMs: 1, purpose: 'interview' }),
    (error: any) => error instanceof ChausarError && error.code === 'PRESET_UNAVAILABLE' && /desktop app/.test(error.message));
});
