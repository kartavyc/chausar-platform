// The chain that carries a kit offer's stages across runs on one order (Ink v2 wave 5, package 5A1, test 4; spec 5.8).
// kit-fixture's voice-pack offer has the stages voice, calendar and drafts. Accepting the voice draft starts the
// calendar run on the same order (chainStage 2), never before; a rejection follows the step's failed edge back to the
// same stage up to maxLoops, and past it the chain stops with one Today row; a stage that waits on the client resumes,
// once answered, at the stage the step's blocked edge names; a stage waiting past its waitDays (by the business's local
// day) makes one Today row. venture.order.chain shows each stage's state and "Stage 2 of 3".
import test from 'node:test';
import assert from 'node:assert/strict';
import type { OrderRecord } from '../runtime/venture/contracts.ts';
import { findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { chainOnAnswer } from '../runtime/venture/playbooks/kit/chain.ts';
import { kitFixture } from './fixtures/venture/kit-fixture.ts';
import { KIT_IDEA, approveWaiting, deliver, draft, installKitFixture, kitBusiness, owner } from './fixtures/venture/kit-business.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const REQUEST = 'A voice sheet, a calendar and posts for Sunrise Bakery, warm and plain.';
const FIELDS = { 'brand-name': 'Sunrise Bakery', 'consent-data': true };
const VOICE = draft('Voice sheet', { 'Voice sheet': ['A warm, plain voice for Sunrise Bakery.'] });
const CALENDAR = draft('Calendar', { Calendar: ['Posts for Sunrise Bakery on the days you pick.'] });
const POSTS = draft('Posts', { Posts: ['Fresh bread at Sunrise Bakery.'] });

async function chainOrder(clock?: { now: Date }) {
  const env = await kitBusiness(clock);
  assert.deepEqual(env.offers.map(offer => offer.playbookOffer), ['voice-pack', 'audit']);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: REQUEST, intake: { fields: FIELDS } });
  const record = () => findRecord(env.store.read(), 'venture-order', order.id)! as OrderRecord;
  const runs = () => listRecords(env.store.read(), 'venture-delivery-run').filter(run => run.orderId === order.id);
  return { env, order, record, runs };
}

test('a kit business: the idea picks kit-fixture, its plan offers, and the order keeps its intake fields', async t => {
  t.after(installKitFixture());
  const { env, order, record } = await chainOrder();
  const playbook = await env.call('venture.delivery.playbook');
  assert.equal(playbook.flagship, 'kit-fixture');
  assert.deepEqual(playbook.steps.map((step: any) => step.id), ['gather', 'voice', 'calendar', 'drafts', 'approve']);
  assert.deepEqual(order.intake.fields, FIELDS);
  assert.equal(record().chainStage, undefined, 'a new order is at its first stage');
  const view = await env.call('venture.order.chain', { orderId: order.id });
  assert.equal(view.line, 'Stage 1 of 3');
  assert.deepEqual(view.stages.map((stage: any) => [stage.stepId, stage.state]), [['voice', 'now'], ['calendar', 'not-started'], ['drafts', 'not-started']]);
  await assert.rejects(env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id, request: REQUEST, intake: { fields: { 'brand-name': 'Sunrise Bakery' } } }), code('INTAKE_FIELD_REQUIRED'));
  assert.ok(KIT_IDEA.includes('kit fixture studio'));
});

test('accepting the voice draft starts the calendar run on the same order, never before', async t => {
  t.after(installKitFixture());
  const { env, order, record, runs } = await chainOrder();
  const voice = await deliver(env, order.id, VOICE);
  assert.equal(voice.status, 'ready-for-review', JSON.stringify(voice.acceptBlocked ?? voice.checks));
  assert.ok(env.models.previewed.at(-1)!.instructions.includes('Voice sheet') || JSON.stringify(env.models.previewed.at(-1)!.input).includes('Voice sheet'));
  assert.equal(record().chainStage, undefined, 'a draft waiting for review moves nothing');
  assert.equal(runs().length, 1);
  await env.call('venture.delivery.review', { runId: voice.id, verdict: 'accepted' });
  assert.equal(record().chainStage, 2);
  assert.equal(record().chainState, 'running');
  const next = runs().find(run => run.id !== voice.id)!;
  assert.ok(next, 'the calendar run started');
  assert.equal(next.chainStage, 2);
  assert.equal(next.status, 'waiting-for-you', 'it waits for the owner like every run');
  assert.ok(JSON.stringify(env.models.previewed.at(-1)!.input).includes('Calendar'), 'the calendar stage drafts its own sections');
  const view = await env.call('venture.order.chain', { orderId: order.id });
  assert.equal(view.line, 'Stage 2 of 3');
  assert.deepEqual(view.stages.map((stage: any) => stage.state), ['done', 'now', 'not-started']);

  // The calendar, then the posts: the last acceptance ends the chain.
  env.models.drafts.push(CALENDAR);
  const calendar = await env.call('venture.delivery.approve', { runId: next.id, digest: next.preview!.digest });
  await env.call('venture.delivery.review', { runId: calendar.id, verdict: 'accepted' });
  assert.equal(record().chainStage, 3);
  const last = runs().find(run => run.chainStage === 3)!;
  env.models.drafts.push(POSTS);
  const posts = await env.call('venture.delivery.approve', { runId: last.id, digest: last.preview!.digest });
  await env.call('venture.delivery.review', { runId: posts.id, verdict: 'accepted' });
  assert.equal(record().chainState, 'done');
  assert.equal(runs().length, 3, 'nothing starts after the last stage');
  assert.deepEqual((await env.call('venture.order.chain', { orderId: order.id })).stages.map((stage: any) => stage.state), ['done', 'done', 'done']);
});

test('a rejection goes back to the same stage up to maxLoops; past it the chain stops with one Today row', async t => {
  t.after(installKitFixture());
  const { env, order, record, runs } = await chainOrder();
  for (let time = 1; time <= 2; time += 1) {
    const run = await deliver(env, order.id, VOICE);
    await env.call('venture.delivery.review', { runId: run.id, verdict: 'rejected', reason: 'tone' });
    assert.equal(record().chainStage, 1, `rejection ${time} stays at the voice stage`);
    assert.equal(record().chainState, 'running');
  }
  assert.equal(runs().length, 2, 'a rejection starts nothing on its own');
  const third = await deliver(env, order.id, VOICE);
  await env.call('venture.delivery.review', { runId: third.id, verdict: 'rejected', reason: 'tone' });
  assert.equal(record().chainState, 'stopped');
  const today = await env.call('venture.queue.list');
  const rows = today.rows.filter((row: any) => row.title.includes('sent back'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'The voice sheet was sent back 3 times. Talk to your client before trying again.');
  assert.equal(rows[0].kind, 'notice');
  const view = await env.call('venture.order.chain', { orderId: order.id });
  assert.deepEqual(view.stages.map((stage: any) => stage.state), ['stopped', 'not-started', 'not-started']);
  assert.equal(view.note, 'The voice sheet was sent back 3 times. Talk to your client before trying again.');
});

test('a stopped chain resumes when the owner accepts that stage\'s draft, and its Today row goes', async t => {
  t.after(installKitFixture());
  const { env, order, record, runs } = await chainOrder();
  for (let time = 1; time <= 3; time += 1) {
    const run = await deliver(env, order.id, VOICE);
    await env.call('venture.delivery.review', { runId: run.id, verdict: 'rejected', reason: 'tone' });
  }
  assert.equal(record().chainState, 'stopped');
  const stoppedRows = async () => (await env.call('venture.queue.list')).rows.filter((row: any) => row.title.includes('sent back'));
  assert.equal((await stoppedRows()).length, 1);
  // The owner talked to the client; a fourth voice sheet is accepted.
  const fourth = await deliver(env, order.id, VOICE);
  await env.call('venture.delivery.review', { runId: fourth.id, verdict: 'accepted' });
  assert.equal(record().chainState, 'running');
  assert.equal(record().chainStage, 2);
  assert.ok(runs().some(run => run.chainStage === 2), 'the calendar run started');
  assert.deepEqual(await stoppedRows(), []);
});

/** One agent turn the harness reads: what the agent noted, its tool calls, and whether it is done. */
const turn = (note: string, calls: [string, unknown][], finished = false) => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });

test('the waiting path through the harness: the stage asks the client, waits, shows on Today by local day, and the answer resumes it', async t => {
  // The calendar stage may wait one day, so the row comes while the client's question (24 hours) can still be answered.
  const base = kitFixture();
  t.after(installKitFixture(kitFixture({ steps: base.steps.map(step => (step.id === 'calendar' ? { ...step, waitDays: 1 } : step)) })));
  // 20:00 UTC on the 21st is already the 22nd in India: the business's own day decides how long a stage has waited.
  const clock = { now: new Date('2026-10-21T20:00:00.000Z') };
  const { env, order, record, runs } = await chainOrder(clock);
  await env.call('venture.files.add', { orderId: order.id, name: 'menu.csv', contentBase64: Buffer.from('Item,Kind\nBread,Loaf\n').toString('base64') });
  // The voice stage: one turn that is done, then the writing turn.
  let run = await env.call('venture.delivery.run', { orderId: order.id });
  run = await approveWaiting(env, run, turn('Nothing more to read', [], true) as never);
  run = await approveWaiting(env, run, VOICE);
  assert.equal(run.status, 'ready-for-review');
  await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  // The calendar stage asks the client which days, through the harness's own hand-off.
  const calendar = runs().find(item => item.chainStage === 2)!;
  const asked = await approveWaiting(env, { id: calendar.id, preview: calendar.preview } as never, turn('Ask which days', [['handoff.client', { question: 'Which days should the posts go out?' }]]) as never);
  assert.equal(asked.status, 'needs-answer', JSON.stringify({ calls: (asked as any).harness?.toolCalls, h: (asked as any).harness?.handoffs, phase: (asked as any).harness?.phase }));
  assert.equal(record().chainState, 'waiting');
  const waitRows = async () => (await env.call('venture.queue.list')).rows.filter((row: any) => row.title.startsWith('Waiting on your client'));
  clock.now = new Date('2026-10-22T17:00:00.000Z'); // a UTC day on, but still the 22nd in India: no local day yet
  assert.deepEqual(await waitRows(), [], "by the business's own day it has not waited a day");
  clock.now = new Date('2026-10-22T19:00:00.000Z'); // the 23rd in India
  const rows = await waitRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Waiting on your client for 1 day');
  assert.equal((await env.call('venture.order.chain', { orderId: order.id })).stages[1].state, 'waiting');
  // The client's answer: the calendar step's blocked edge names the posts stage.
  const answered = await env.call('venture.delivery.answer', { runId: calendar.id, answer: 'Mondays and Thursdays.' });
  assert.equal(answered.status, 'waiting-for-you');
  assert.equal(record().chainStage, 3);
  assert.equal(record().chainState, 'running');
  assert.deepEqual(await waitRows(), []);
});

test('chainOnAnswer moves nothing for a run of another stage, or a practice run', async t => {
  t.after(installKitFixture());
  const { env, order, record, runs } = await chainOrder();
  const voice = await deliver(env, order.id, VOICE);
  await env.call('venture.delivery.review', { runId: voice.id, verdict: 'accepted' });
  const calendar = runs().find(item => item.chainStage === 2)!;
  await ventureAction(env.deps, owner, 'prepare', 'test.wait', tx => { tx.replace({ ...tx.find('venture-order', order.id)!, chainState: 'waiting', chainSince: tx.now }); });
  await ventureAction(env.deps, owner, 'prepare', 'test.old-answer', tx => { chainOnAnswer(tx, voice as never); });
  assert.deepEqual([record().chainStage, record().chainState], [2, 'waiting'], 'an answer on the voice run moves nothing');
  await ventureAction(env.deps, owner, 'prepare', 'test.practice-answer', tx => { chainOnAnswer(tx, { ...calendar, practice: true }); });
  assert.deepEqual([record().chainStage, record().chainState], [2, 'waiting'], 'nor one on a practice run');
  await ventureAction(env.deps, owner, 'prepare', 'test.answer', tx => { chainOnAnswer(tx, calendar); });
  assert.deepEqual([record().chainStage, record().chainState], [3, 'running']);
});

test('venture.order.chain names each stage\'s manual path while its connector is planned (5A3)', async t => {
  t.after(installKitFixture());
  const { env, order } = await chainOrder();
  const view = await env.call('venture.order.chain', { orderId: order.id });
  assert.deepEqual(view.stages.map((stage: any) => stage.manualPath?.line ?? null), [null, 'Until then: import the calendar file into your scheduler.', null]);
  assert.equal(view.stages[1].manualPath.waitsOn, 'The scheduler app review.');
});

test('venture.order.chain refuses an order whose offer runs no kit stages', async t => {
  t.after(installKitFixture());
  const plain = await kitBusiness(undefined, { idea: 'Monthly bookkeeping for cafes and small shops in Pune.' });
  const order = await plain.call('venture.order.create', { clientId: plain.client.id, offerId: plain.offers[0].id, request: 'Close my books for October.' });
  await assert.rejects(plain.call('venture.order.chain', { orderId: order.id }), (error: any) => {
    assert.equal(error?.code, 'INVALID_VENTURE_REQUEST');
    assert.equal(error.message, "This order's offer runs no stages of a playbook.");
    return true;
  });
  await assert.rejects(plain.call('venture.order.chain', { orderId: 'order_missing' }), code('ORDER_NOT_FOUND'));
  await assert.rejects(plain.call('venture.order.chain', { orderId: order.id, extra: 1 }), code('INVALID_VENTURE_REQUEST'));
});
