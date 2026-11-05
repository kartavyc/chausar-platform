// C7 task 9 (the module half): the event relay. Chausar reads the owner's own ntfy-style topic while it is open, with
// one GET of the topic's poll form through the network guard (redirects refused, at most 256 KB), keeps only ids from
// each message (a Razorpay payment captured: the payment id; a Cal.com booking created or cancelled: the booking uid),
// and drops everything else before anything is stored. Every net here is a stand-in: no address is ever asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RELAY_PAGE_BYTES, assertRelayHost, eventKey, eventRecordOf, readRelay, relayPollUrl } from '../runtime/venture/build/event-relay.ts';

const TOPIC = 'https://ntfy.sh/chausar-owner-topic-7f3a9c';
const PUBLIC = [{ address: '104.18.2.3', family: 4 as const }];
type Sent = { url: URL; method: string; headers: Record<string, string> };

function stand(lines: unknown[], options: { status?: number; headers?: Record<string, string>; address?: string } = {}) {
  const sent: Sent[] = [];
  const body = Buffer.from(lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n');
  return {
    sent,
    net: {
      resolve: async () => options.address ? [{ address: options.address, family: 4 as const }] : PUBLIC,
      send: async (target: any) => { sent.push({ url: target.url, method: target.method, headers: target.headers }); return { status: options.status ?? 200, headers: options.headers ?? { 'content-type': 'application/x-ndjson' }, body }; },
    },
  };
}
const message = (id: string, time: number, body: unknown) => ({ id, time, event: 'message', topic: 'chausar-owner-topic-7f3a9c', message: typeof body === 'string' ? body : JSON.stringify(body) });
const razorpay = (id: string) => ({ entity: 'event', event: 'payment.captured', payload: { payment: { entity: { id, amount: 250000, currency: 'INR', email: 'payer@example.com', contact: '+919999900000', status: 'captured' } } }, created_at: 1762400000 });
const calcom = (uid: string, trigger = 'BOOKING_CREATED') => ({ triggerEvent: trigger, createdAt: '2026-11-06T08:00:00.000Z', payload: { uid, title: 'Intro call', attendees: [{ name: 'Test Person', email: 'person@example.com' }] } });

test('a page with a Razorpay and a Cal.com message keeps two events with ids only', async () => {
  const { net, sent } = stand([
    { id: 'open1', time: 1762400000, event: 'open', topic: 'x' },
    message('m1', 1762400100, razorpay('pay_Q1w2e3r4t5y6u7')),
    message('m2', 1762400200, calcom('bk_8hJ2kL9mN3')),
    message('m3', 1762400300, calcom('bk_cancel77', 'BOOKING_CANCELLED')),
  ]);
  const page = await readRelay(net, TOPIC, { since: '2026-11-06T00:00:00.000Z' });
  assert.deepEqual(page.events.map(event => [event.source, event.kind, event.ref]), [
    ['razorpay', 'payment', 'pay_Q1w2e3r4t5y6u7'], ['cal-com', 'booking', 'bk_8hJ2kL9mN3'], ['cal-com', 'booking-cancelled', 'bk_cancel77'],
  ]);
  assert.equal(page.events[0].receivedAt, new Date(1762400100 * 1000).toISOString());
  assert.equal(page.lastId, 'm3'); assert.equal(page.host, 'ntfy.sh');
  const kept = JSON.stringify(page);
  for (const secret of ['payer@example.com', '9999900000', 'person@example.com', 'Test Person', 'chausar-owner-topic-7f3a9c', 'Intro call']) assert.ok(!kept.includes(secret), secret);
  assert.equal(sent.length, 1); assert.equal(sent[0].method, 'GET');
  assert.equal(sent[0].url.href, relayPollUrl(TOPIC, '2026-11-06T00:00:00.000Z'));
  assert.ok(sent[0].url.href.endsWith(`/chausar-owner-topic-7f3a9c/json?poll=1&since=${Date.parse('2026-11-06T00:00:00.000Z') / 1000}`));
});

test('a body that is not JSON, too big or another event is skipped with a count; the same message twice is kept once', async () => {
  const { net } = stand([
    message('m1', 1762400100, 'not json at all'),
    message('m2', 1762400110, JSON.stringify({ event: 'payment.captured', padding: 'x'.repeat(70_000) })),
    message('m3', 1762400120, { event: 'order.paid', payload: {} }),
    message('m4', 1762400130, { event: 'payment.captured', payload: { payment: { entity: { id: 'not-a-payment-id' } } } }),
    message('m5', 1762400140, razorpay('pay_Q1w2e3r4t5y6u7')),
    message('m6', 1762400150, razorpay('pay_Q1w2e3r4t5y6u7')),
    '{broken line',
  ]);
  const page = await readRelay(net, TOPIC, { since: null, seen: new Set() });
  assert.equal(page.events.length, 1);
  assert.deepEqual(page.skipped, { notJson: 2, tooBig: 1, other: 2, repeated: 1 });
  const again = await readRelay(net, TOPIC, { since: null, seen: new Set([eventKey(page.events[0])]) });
  assert.equal(again.events.length, 0); assert.equal(again.skipped.repeated, 2);
});

test('a relay inside this computer or its network is refused, and so is a redirect, an error answer or an oversized page', async () => {
  const refused = (error: any) => error.code === 'EVENT_RELAY_REFUSED' && !error.message.includes('chausar-owner-topic');
  for (const address of ['https://127.0.0.1/topic', 'https://192.168.1.20/topic', 'https://localhost/topic', 'http://ntfy.sh/topic', 'https://user:pass@ntfy.sh/topic', 'not a url']) {
    const { net, sent } = stand([]);
    await assert.rejects(readRelay(net, address, { since: null }), refused, address);
    assert.equal(sent.length, 0);
  }
  await assert.rejects(readRelay(stand([], { address: '10.0.0.7' }).net, TOPIC, { since: null }), refused);
  await assert.rejects(readRelay(stand([], { status: 302, headers: { location: 'https://elsewhere.example/x' } }).net, TOPIC, { since: null }), refused);
  await assert.rejects(readRelay(stand([], { status: 500 }).net, TOPIC, { since: null }), refused);
  const big = Array.from({ length: 40 }, (_, index) => message(`b${index}`, 1762400000 + index, { pad: 'x'.repeat(7000) }));
  await assert.rejects(readRelay(stand(big).net, TOPIC, { since: null }), refused);
  assert.ok(RELAY_PAGE_BYTES === 256 * 1024);
});

test('the event record names no address, and the hosted app has no relay', () => {
  const record = eventRecordOf({ source: 'razorpay', kind: 'payment', ref: 'pay_Q1w2e3r4t5y6u7', receivedAt: '2026-11-06T08:00:00.000Z', relayId: 'm1' });
  assert.deepEqual(Object.keys(record).sort(), ['kind', 'line', 'receivedAt', 'ref', 'source', 'state']);
  assert.equal(record.state, 'new'); assert.doesNotMatch(record.line, /ntfy|https?:/);
  assert.throws(() => assertRelayHost('hosted-web'), (error: any) => error.code === 'TIER_UNAVAILABLE');
  assert.doesNotThrow(() => assertRelayHost('desktop'));
});
