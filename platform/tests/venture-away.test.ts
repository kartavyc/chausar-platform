// Pause all and Away (Ink v2 wave 4, 4F1; catalogue O4). Pause all refuses new runs and approvals until the owner
// unpauses; Team reads Paused; routines read the skip line. Away is a code-built list for the owner's time away:
// promises falling due, what keeps running, the approvals that will wait, and an auto-reply with real response times
// for the owner to paste into their own mail app. Chausar sends nothing. While away, no new work starts on its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { AgentView, AwayView, DeliveryRunRecord, InvoiceRecord, OrderRecord, QueueList } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { pauseSkipLine } from '../runtime/venture/delivery/run-controls.ts';
import { CLIENT_NAME, START, call, code, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const agent: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
const run = (env: Env, orderId: string, ctx: Context = owner) => delivery['venture.delivery.run']!(env.deps, ctx, { orderId, useTemplate: true }) as Promise<DeliveryRunRecord>;
const PREVIEW = { callId: 'call_x', payloadText: 'x', digest: 'a'.repeat(64), presetId: 'anthropic-sonnet-5-5', model: 'stub', endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: '2026-10-15T10:30:00.000Z' } as const;

test('pause all: new runs and approvals are refused, Team reads Paused, routines skip; unpausing changes no run', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const waiting = await seedRun(env, order, { status: 'waiting-for-you', callId: 'call_x', preview: { ...PREVIEW } }, ['run.waiting']);
  await assert.rejects(call(env, 'venture.business.pause', { paused: true }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.business.pause', { paused: 'yes' }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(pauseSkipLine(env.store.read()), null);

  const paused = await call(env, 'venture.business.pause', { paused: true });
  assert.deepEqual(paused, { paused: true, stopped: 0, line: 'Paused. No new work starts until you unpause.' });
  await assert.rejects(run(env, order.id), code('BUSINESS_PAUSED'));
  await assert.rejects(delivery['venture.delivery.approve']!(env.deps, owner, { runId: waiting.id, digest: PREVIEW.digest }), code('BUSINESS_PAUSED'));
  assert.equal(pauseSkipLine(env.store.read()), 'Paused by you');
  const team = await call<{ agents: AgentView[] }>(env, 'venture.team.list', {});
  // Keeper is Chausar's own code, not an agent: its housekeeping jobs start no agent work.
  const agents = team.agents.filter(item => item.kind !== 'code');
  assert.ok(agents.length > 0 && agents.every(item => item.now === 'Paused'), JSON.stringify(team.agents.map(item => item.now)));
  assert.equal(listRecords(env.store.read(), 'venture-delivery-run').find(item => item.id === waiting.id)!.status, 'waiting-for-you', 'pausing alone stops no run');

  const unpaused = await call(env, 'venture.business.pause', { paused: false });
  assert.deepEqual(unpaused, { paused: false, stopped: 0, line: 'Unpaused. Stopped runs stay stopped until you resume them.' });
  assert.equal(pauseSkipLine(env.store.read()), null);
  const started = await run(env, order.id);
  assert.equal(started.status, 'ready-for-review');
});

async function seedInvoice(env: Env, order: OrderRecord, clientId: string, number: string, dueDate: string): Promise<InvoiceRecord> {
  return ventureAction(env.deps, owner, 'prepare', 'seed.invoice', tx => tx.put({
    ...tx.base('venture-invoice'), number, documentTitle: 'TAX INVOICE', orderId: order.id, clientId, currency: 'INR', issueDate: '2026-10-10', dueDate, dueInDays: 10,
    lines: [], subtotalMinor: '249900', discountMinor: '0', taxMinor: '44982', totalMinor: '294882', taxLabel: 'GST', taxRateBps: '1800', taxTreatment: 'cgst-sgst',
    taxLines: [], supplierTaxId: null, clientTaxId: null, placeOfSupply: null, status: 'issued', priceReceiptId: order.priceReceiptId, digest: `digest-${number}`,
  } as unknown as InvoiceRecord));
}

/** A reviewed run on an order that came in at `at`, reviewed `days` later: one measured response time. */
async function answeredOrder(env: Env, plan: Awaited<ReturnType<typeof seedBlueprint>>, at: string, days: number) {
  const { order } = await seedOrder(env, plan);
  await ventureAction(env.deps, owner, 'prepare', 'seed.at', tx => { tx.replace({ ...tx.find('venture-order', order.id)!, at }); });
  const verdictAt = new Date(Date.parse(at) + days * 86_400_000).toISOString();
  await seedRun(env, order, { status: 'accepted', verdict: { choice: 'accepted', reason: null, at: verdictAt } });
}

test('away: promises falling due, what keeps running, approvals that wait and an auto-reply with real response times; nothing is sent', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { client, order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  await seedInvoice(env, order, client.id, 'INV-0001', '2026-10-20');
  await seedInvoice(env, order, client.id, 'INV-0002', '2026-11-30');
  await ventureAction(env.deps, owner, 'prepare', 'seed.jobs', tx => {
    tx.put({ ...tx.base('venture-keeper-run'), job: 'backups', outcome: 'ok', line: 'Backed up.' });
    tx.put({ ...tx.base('venture-routine'), name: 'Weekly report', agent: null, setBy: 'owner', prompt: 'Draft the weekly report.', schedule: { kind: 'once', at: START }, on: true, removedAt: null });
  });
  await assert.rejects(call(env, 'venture.away.set', { from: '2026-10-18', to: '2026-10-24' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.away.set', { from: '2026-10-24', to: '2026-10-18' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.away.set', { from: '2026-10-01', to: '2026-10-10' }), code('INVALID_VENTURE_REQUEST'));
  const empty = await call<AwayView>(env, 'venture.away.get', {});
  assert.equal(empty.away, null);

  // Two measured response times only: no figure is claimed.
  await answeredOrder(env, plan, '2026-09-01T10:00:00.000Z', 2);
  await answeredOrder(env, plan, '2026-09-05T10:00:00.000Z', 1);
  const unmeasured = await call<AwayView>(env, 'venture.away.set', { from: '2026-10-18', to: '2026-10-24' });
  assert.equal(unmeasured.autoReply, 'Thank you for your message. I am away from 18 Oct 2026 to 24 Oct 2026 and back on 25 Oct 2026. I will reply after I am back.\n\nLedger Cafe Books');

  await answeredOrder(env, plan, '2026-09-10T10:00:00.000Z', 2);
  const away = await call<AwayView>(env, 'venture.away.set', { from: '2026-10-18', to: '2026-10-24' });
  const queue = await call<QueueList>(env, 'venture.queue.list', {});
  assert.deepEqual(away.away, { from: '2026-10-18', to: '2026-10-24' });
  assert.deepEqual(away.promises, [{ due: '2026-10-20', line: `${CLIENT_NAME}'s payment for INV-0001 is due.` }]);
  // 4J13: routines keep running while the owner is away; each run still waits for the owner's approval on Today.
  assert.deepEqual(away.keepsRunning, ['Backups of this business', 'Routine: Weekly report']);
  assert.equal(away.approvalsWaiting, queue.needsYou);
  assert.equal(away.autoReply, 'Thank you for your message. I am away from 18 Oct 2026 to 24 Oct 2026 and back on 25 Oct 2026. I usually reply within 2 days, so you can expect my answer by 27 Oct 2026.\n\nLedger Cafe Books');
  assert.equal(away.line, `Away from 18 Oct 2026 to 24 Oct 2026. ${queue.needsYou} ${queue.needsYou === 1 ? 'thing waits' : 'things wait'} for you.`);
  assert.deepEqual(await call<AwayView>(env, 'venture.away.get', {}), away);
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry').length, 0, 'Chausar sends nothing');

  // While away, no new work starts on its own; the owner in the app can still start it.
  env.advance(4 * 86_400_000);
  await assert.rejects(run(env, order.id, agent), code('BUSINESS_PAUSED'));
  const started = await run(env, order.id);
  const failed = await seedRun(env, order, { status: 'failed' }, ['run.failed']);

  // Back: "Since you left" names the rows made while away.
  env.advance(7 * 86_400_000);
  const back = await call<AwayView>(env, 'venture.away.get', {});
  const rows = (await call<QueueList>(env, 'venture.queue.list', {})).rows;
  // 18 Oct to 24 Oct in India: from 17 Oct 18:30 UTC to 24 Oct 18:30 UTC.
  const since = rows.filter(row => row.createdAt >= '2026-10-17T18:30:00.000Z' && row.createdAt < '2026-10-24T18:30:00.000Z').map(row => row.id);
  assert.ok(since.length >= 1);
  assert.ok(rows.length > since.length, 'rows from before you left are not in it');
  assert.deepEqual(back.since, { from: '2026-10-18', to: '2026-10-24', rowIds: since });
  assert.match(back.line, /^You were away from 18 Oct 2026 to 24 Oct 2026\. \d+ (thing|things) came in since you left\.$/);
  void started; void failed;
});
