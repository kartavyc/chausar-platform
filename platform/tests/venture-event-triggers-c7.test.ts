// C7 tasks 9 and 11: the relay address is held in protected storage and never appears in a record; a confirmed payment makes
// one run whose AI input holds the filled blanks and nothing else of the event; "send the thank-you now" becomes a proposal on
// Today and nothing is sent; a refused event makes no run; a 30-hour-old event is missed; no sweep means nothing runs; the
// eleventh event in one sweep waits for the next; a client without AI permission waits on Today. Stand-ins for every network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { routineTick } from '../runtime/venture/agents/routine-runner.ts';
import { handlers as buildHandlers } from '../runtime/venture/build/index.ts';
import { MAX_RUNS_PER_TRIGGER, RELAY_CREDENTIAL } from '../runtime/venture/build/event-triggers.ts';
import { agentBusiness, consent, said } from './venture-agent-helpers.ts';
import { NOW, owner } from './venture-judge-helpers.ts';

const phone = { ...owner, channel: 'phone' as const };
const ADDRESS = 'https://ntfy.sh/owner-secret-topic';
const AGENT = 'story-editor';
const payId = (n: number) => `pay_Abcdefgh${String(n).padStart(4, '0')}`;
const LINK = 'plink_Abcdefgh0001';
const message = (id: string, body: unknown, time: number) => JSON.stringify({ id, time, event: 'message', topic: 'owner-secret-topic', message: JSON.stringify(body) });
const paid = (id: string) => ({ event: 'payment.captured', payload: { payment: { entity: { id, email: 'payer@example.com', contact: '+919999900000', amount: 250000 } } } });
const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();

async function triggered(options: { events: () => string[]; consent?: boolean; unknown?: boolean }) {
  const env = await agentBusiness();
  await consent(env, AGENT);
  const stored = new Map<string, string>();
  env.deps.credentials = { get: async (_w: string, name: string) => stored.get(name) ?? null, set: async (_w: string, name: string, value: string) => { stored.set(name, value); }, delete: async (_w: string, name: string) => { stored.delete(name); } };
  stored.set('payments:razorpay', JSON.stringify({ keyId: ['rzp', 'test', 'Ab12Cd34Ef56Gh'].join('_'), keySecret: 'a'.repeat(24) }));
  (env.deps as any).host = 'desktop';
  const client = (await env.call('venture.client.add', { name: 'Meera Iyer', email: 'meera@example.com' }));
  const clientId = client.client?.id ?? client.id;
  if (options.consent !== false) await ventureAction(env.deps, owner, 'prepare', 'test.consent', tx => { const row = tx.find('venture-client', clientId)!; tx.replace({ ...row, aiConsent: { id: 'c1', revision: 1, grantedAt: NOW, withdrawnAt: null } as any }); });
  await ventureAction(env.deps, owner, 'prepare', 'test.invoice', tx => {
    const venture = tx.venture!;
    tx.touch({ billing: { ...(venture.billing ?? {}), razorpay: { mode: 'test', keyHint: 'x', savedAt: NOW } } });
    const order = tx.put({ ...tx.base('venture-order'), clientId, status: 'open' } as any);
    tx.put({ ...tx.base('venture-invoice'), number: 'INV-0007', orderId: (order as any).id, clientId, currency: 'INR', payLink: { id: LINK, currency: 'INR', recordedPaymentIds: [] } } as any);
  });
  const sent: string[] = [];
  (env.deps as any).eventPorts = {
    net: { resolve: async () => [{ address: '93.184.216.34', family: 4 }], send: async () => ({ status: 200, headers: {}, body: Buffer.from(options.events().join('\n')) }) },
    http: async (request: { url: string }) => {
      if (request.url.includes('/payments/')) { if (options.unknown) return { status: 404, body: '{}' }; return { status: 200, body: JSON.stringify({ id: request.url.split('/').pop(), entity: 'payment', amount: 250000, currency: 'INR', status: 'captured', email: 'payer@example.com' }) }; }
      const pays = Array.from({ length: 30 }, (_, i) => ({ payment_id: payId(i), amount: 250000, created_at: 1762400000, method: 'upi', status: 'captured' }));
      return { status: 200, body: JSON.stringify({ id: LINK, short_url: 'https://rzp.io/i/abc', status: 'paid', amount: 250000, amount_paid: 250000, currency: 'INR', payments: pays }) };
    },
  };
  env.models.respond['agent-chat'] = task => { sent.push(JSON.stringify(task.input)); return { parts: [said('Drafted a thank-you for you to check.')] }; };
  const events = (method: string, payload: unknown, ctx = owner) => (buildHandlers as any)[method](env.deps, ctx, payload);
  await events('venture.events.relay.set', { address: ADDRESS });
  await ventureAction(env.deps, owner, 'prepare', 'test.check', tx => tx.put({ ...tx.base('venture-connector-check'), rows: [{ connectorId: 'model:anthropic-sonnet-5-5', outcome: 'answered', line: 'Answered.', account: null, expiresOn: null }] } as any));
  return { env, sent, stored, events, clientId };
}
const trigger = (prompt = 'Draft a thank-you to {client} for invoice {invoice}, paid {amount} at {when}.') => ({ name: 'Thank a payment', agent: AGENT, prompt, on: true, schedule: { kind: 'event', source: 'razorpay', event: 'payment' } });
const tick = (env: any) => routineTick(env.deps, owner);
const eventsOf = (env: any) => listRecords(env.store.read(), 'venture-relay-event');
const runsOf = (env: any) => listRecords(env.store.read(), 'venture-routine-run');
const now = () => Math.floor(Date.parse(NOW) / 1000);

test('the relay: inside this network refused; the address is in protected storage, never in a record; hosted refuses; app only', async () => {
  const { env, stored, events } = await triggered({ events: () => [] });
  assert.equal(stored.get(RELAY_CREDENTIAL), ADDRESS);
  const view = await events('venture.events.get', {});
  assert.equal(view.relay, 'ntfy.sh');
  assert.match(view.line, /^Nothing fires while Chausar is closed/);
  assert.equal(JSON.stringify(env.store.read()).includes('owner-secret-topic'), false);
  await assert.rejects(events('venture.events.relay.set', { address: 'https://192.168.1.2/topic' }), { code: 'EVENT_RELAY_REFUSED' });
  await assert.rejects(events('venture.events.relay.set', { address: ADDRESS }, phone), { code: 'APP_APPROVAL_REQUIRED' });
  (env.deps as any).host = 'hosted-web';
  await assert.rejects(events('venture.events.relay.set', { address: ADDRESS }), { code: 'TIER_UNAVAILABLE' });
});

test('saving a trigger needs the relay and its source; only its blanks; the facts it sends are shown', async () => {
  const { env } = await triggered({ events: () => [] });
  await assert.rejects(env.agents('venture.routines.set', { routine: trigger('Draft a thank-you to {client} using {secret}.') }), { code: 'INVALID_VENTURE_REQUEST' });
  await assert.rejects(env.agents('venture.routines.set', { routine: { ...trigger(), schedule: { kind: 'event', source: 'cal-com', event: 'booking' } } }), { code: 'INVALID_VENTURE_REQUEST' });
  const { routine } = await env.agents('venture.routines.set', { routine: trigger() });
  assert.deepEqual(routine.facts, ["the client's name", 'the invoice number', 'the amount paid', 'the time']);
  assert.equal(routine.when, 'When a payment comes in');
  assert.match(routine.line, /while Chausar is open/);
});

test('a confirmed payment makes one run; the AI input holds the filled blanks and nothing else of the event; nothing of the payer is stored', async () => {
  const { env, sent } = await triggered({ events: () => [message('m1', paid(payId(1)), now()), 'not json', message('m3', { event: 'other' }, now())] });
  await env.agents('venture.routines.set', { routine: trigger() });
  await tick(env);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Draft a thank-you to Meera Iyer for invoice INV-0007, paid ₹2,500/);
  assert.equal(sent[0].includes(payId(1)), false);
  assert.equal(JSON.stringify(env.store.read()).includes('payer@example.com'), false);
  assert.equal(JSON.stringify(env.store.read()).includes('9999900000'), false);
  assert.deepEqual(eventsOf(env).map(event => [event.ref, event.state]), [[payId(1), 'drafted']]);
  const run = runsOf(env).at(-1)!;
  assert.equal(run.state, 'completed');
  // The same message again is kept once, and makes no second run.
  await tick(env);
  assert.deepEqual([eventsOf(env).length, sent.length], [1, 1]);
});

test('"send the thank-you now" becomes a proposal on Today; nothing is sent', async () => {
  const { env, sent } = await triggered({ events: () => [message('m1', paid(payId(1)), now())] });
  await env.agents('venture.routines.set', { routine: trigger('Send the thank-you now to {client}.') });
  await tick(env);
  assert.equal(sent.length, 0, 'code took it as a request on the floor: no AI call');
  const proposals = listRecords(env.store.read(), 'venture-proposal');
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].status, 'raised');
});

test('a refused event makes no run and says why; a 30-hour-old event is missed; with no sweep nothing runs', async () => {
  const refused = await triggered({ events: () => [message('m1', paid(payId(1)), now())], unknown: true });
  await refused.env.agents('venture.routines.set', { routine: trigger() });
  assert.deepEqual(eventsOf(refused.env), [], 'no sweep, nothing read');
  await tick(refused.env);
  assert.deepEqual([eventsOf(refused.env)[0].state, refused.sent.length], ['refused', 0]);
  assert.match(eventsOf(refused.env)[0].line, /does not know this payment/);
  const old = await triggered({ events: () => [message('m1', paid(payId(1)), now() - 30 * 60 * 60)] });
  await old.env.agents('venture.routines.set', { routine: trigger() });
  await tick(old.env);
  assert.deepEqual([eventsOf(old.env)[0].state, old.sent.length], ['missed', 0]);
  assert.equal((await old.events('venture.events.get', {})).missed, 1);
});

test('the eleventh event in one sweep waits for the next; a client without AI permission waits on Today', async () => {
  const many = await triggered({ events: () => Array.from({ length: MAX_RUNS_PER_TRIGGER + 1 }, (_, i) => message(`m${i}`, paid(payId(i)), now())) });
  await many.env.agents('venture.routines.set', { routine: trigger() });
  await tick(many.env);
  assert.equal(many.sent.length, MAX_RUNS_PER_TRIGGER);
  assert.equal(eventsOf(many.env).filter(event => event.state === 'confirmed').length, 1);
  many.env.setNow(at(60_000));
  await tick(many.env);
  assert.equal(many.sent.length, MAX_RUNS_PER_TRIGGER + 1);
  const waiting = await triggered({ events: () => [message('m1', paid(payId(1)), now())], consent: false });
  await waiting.env.agents('venture.routines.set', { routine: trigger() });
  await tick(waiting.env);
  assert.equal(waiting.sent.length, 0);
  const run = runsOf(waiting.env).at(-1)!;
  assert.deepEqual([run.state, run.line], ['needs-input', "Needs Meera Iyer's AI permission first."]);
});
