// Ink v2 wave 5, package 5A2: the GO, HOLD or NO-GO card for a new offer or product (catalogue M18, from
// sealeap-ecommerce-skills' decision template, ideas only). Code decides over the owner's typed inputs: the most the
// owner could lose is worked out in BigInt paise from what it costs to start, each month and for how many months, with
// a receipt; HOLD lists every input the owner did not know; NO-GO when that loss is above the owner's own limit; every
// GO card says "GO spends nothing: each spend still asks you." Each card is stored and listed on Business.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { RowFigureReceipt } from '../runtime/venture/contracts.ts';
import type { GoNoGoCardView, GoNoGoListView } from '../runtime/venture/playbooks/kit/records-sales.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as playbooks } from '../runtime/venture/playbooks/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { code, owner, setup, type Env } from './venture-views-env.ts';

type Handler = (deps: Env['deps'], ctx: typeof owner, payload: unknown) => Promise<any>;
const card = (env: Env, payload: Record<string, unknown>) => (playbooks as Record<string, Handler>)['venture.goNoGo.card'](env.deps, owner, payload) as Promise<GoNoGoCardView>;
const list = (env: Env) => (playbooks as Record<string, Handler>)['venture.goNoGo.list'](env.deps, owner, {}) as Promise<GoNoGoListView>;
const receipt = (env: Env, id: string) => (money as Record<string, Handler>)['venture.receipt.get'](env.deps, owner, { id }) as Promise<RowFigureReceipt>;
// ₹20,000 to start, ₹5,000 a month for 3 months: the most it can lose is 20,000 + 5,000 x 3 = ₹35,000.
// The owner types rupees as they write them; the engine reads them as ownerPrice does (thousands commas, two decimals).
const INPUTS = { upfront: '20,000', monthly: '5000', months: '3', limit: '50000.00' };

test('GO: the maximum loss is inside the owner\'s limit; the card says GO spends nothing, and its figure opens a receipt', async () => {
  const env = await setup();
  const made = await card(env, { playbook: 'general', subject: 'A reels pack for gyms', inputs: INPUTS });
  assert.equal(made.verdict, 'GO');
  assert.equal(made.subject, 'A reels pack for gyms');
  assert.equal(made.line, 'GO: the most you could lose is ₹35,000, within your limit of ₹50,000.');
  assert.equal(made.spendsNothing, 'GO spends nothing: each spend still asks you.');
  assert.deepEqual(made.unknown, []);
  assert.deepEqual(made.maxLoss, { minor: '3500000', display: '₹35,000', receiptId: made.id });
  assert.deepEqual(made.limit, { minor: '5000000', display: '₹50,000' });

  const proof = await receipt(env, made.id);
  assert.equal(proof.kind, 'row-figure');
  assert.deepEqual(proof.subject, { type: 'go-no-go', recordId: made.id });
  assert.deepEqual(proof.figures.map(figure => [figure.key, figure.amount, figure.display]), [
    ['upfront', '2000000', '₹20,000'], ['monthly', '500000', '₹5,000'], ['running', '1500000', '₹15,000'],
    ['max-loss', '3500000', '₹35,000'], ['limit', '5000000', '₹50,000'],
  ]);
  assert.equal(proof.explanation, '₹20,000 to start, plus ₹5,000 a month for 3 months (₹15,000) = ₹35,000 at most. Your limit is ₹50,000.');
  assert.equal(proof.stale, false);

  // A loss exactly at the limit is still within it.
  assert.equal((await card(env, { playbook: 'general', subject: 'At the limit', inputs: { ...INPUTS, limit: '35,000' } })).verdict, 'GO');
  // Nothing to start is a cost of nothing; the card keeps the amounts as paise.
  const free = await card(env, { playbook: 'general', subject: 'No start cost', inputs: { ...INPUTS, upfront: '0' } });
  assert.equal(free.maxLoss?.display, '₹15,000');
  assert.deepEqual(listRecords(env.store.read(), 'venture-go-no-go').find(item => item.id === made.id)!.inputs, { upfront: '2000000', monthly: '500000', months: '3', limit: '5000000' });
});

test('NO-GO: the maximum loss is above the owner\'s limit, and the card says so with both figures', async () => {
  const env = await setup();
  const made = await card(env, { playbook: 'general', subject: 'A reels pack for gyms', inputs: { ...INPUTS, limit: '30000' } });
  assert.equal(made.verdict, 'NO-GO');
  assert.equal(made.line, 'NO-GO: the most you could lose, ₹35,000, is above your limit of ₹30,000.');
  assert.equal(made.spendsNothing, null);
  assert.equal(made.maxLoss?.display, '₹35,000');
});

test('HOLD lists every input the owner did not know, by its plain name; a missing input counts as not known', async () => {
  const env = await setup();
  const made = await card(env, { playbook: 'general', subject: 'Product photos for sellers', inputs: { upfront: '20000', monthly: null, months: '3' } });
  assert.equal(made.verdict, 'HOLD');
  assert.deepEqual(made.unknown, [
    { input: 'monthly', label: 'What it costs each month' }, { input: 'limit', label: 'The most you are willing to lose' },
  ]);
  assert.equal(made.line, 'HOLD: say what it costs each month and the most you are willing to lose, then make the card again.');
  assert.equal(made.maxLoss, null);
  assert.equal(made.spendsNothing, null);
  // With only the limit unknown the loss is worked out, and still HOLD.
  const partly = await card(env, { playbook: 'general', subject: 'Product photos for sellers', inputs: { ...INPUTS, limit: null } });
  assert.equal(partly.verdict, 'HOLD');
  assert.equal(partly.maxLoss?.display, '₹35,000');
});

test('each card is stored and listed, newest first; inputs are checked before anything is stored', async () => {
  const env = await setup();
  const first = await card(env, { playbook: 'general', subject: 'First idea', inputs: INPUTS });
  env.advance(60_000);
  const second = await card(env, { playbook: 'youtube', subject: 'Second idea', inputs: { ...INPUTS, limit: '1' } });
  const stored = listRecords(env.store.read(), 'venture-go-no-go');
  assert.equal(stored.length, 2);
  assert.deepEqual(stored.map(item => item.verdict).sort(), ['GO', 'NO-GO']);
  assert.match(stored[0].digest, /^[a-f0-9]{64}$/);
  const listed = await list(env);
  assert.deepEqual(listed.cards.map(item => [item.id, item.subject, item.playbook]), [[second.id, 'Second idea', 'youtube'], [first.id, 'First idea', 'general']]);

  for (const inputs of [{ ...INPUTS, price: '100' }, { ...INPUTS, months: '0' }, { ...INPUTS, months: '37' }, { ...INPUTS, months: '2.5' }]) {
    await assert.rejects(card(env, { playbook: 'general', subject: 'Bad', inputs }), code('INVALID_VENTURE_REQUEST'), JSON.stringify(inputs));
  }
  for (const inputs of [{ ...INPUTS, upfront: '-5' }, { ...INPUTS, monthly: '12.505' }, { ...INPUTS, limit: 'ten' }, { ...INPUTS, upfront: '2000000000000' }]) {
    await assert.rejects(card(env, { playbook: 'general', subject: 'Bad', inputs }), code('INVALID_AMOUNT'), JSON.stringify(inputs));
  }
  await assert.rejects(card(env, { playbook: 'General Store', subject: 'Bad', inputs: INPUTS }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(card(env, { playbook: 'general', subject: '', inputs: INPUTS }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(card(env, { playbook: 'general', subject: 'x', inputs: INPUTS, extra: true }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(env.store.read(), 'venture-go-no-go').length, 2, 'a refused card stores nothing');
});

// C5 task 14: "What would make it a go?" On NO-GO, code works out the months that fit and the monthly cost that fits
// over the same months, each rebuilt on the receipt; when nothing fits it says so.
test('NO-GO says what would make it a go: 6 months fit, or 5,000 a month; the receipt rebuilds both', async () => {
  const env = await setup();
  const made = await card(env, { playbook: 'general', subject: 'A studio', inputs: { upfront: '20,000', monthly: '10,000', months: '12', limit: '80,000' } });
  assert.equal(made.verdict, 'NO-GO');
  assert.deepEqual(made.toGo, { line: 'It would be a go at 6 months, or at ₹5,000 a month.', months: 6, monthly: { minor: '500000', display: '₹5,000' } });
  const proof = await receipt(env, made.id);
  assert.equal(proof.stale, false);
  assert.deepEqual(proof.figures.filter(figure => figure.key.startsWith('fit-')).map(figure => [figure.key, figure.amount, figure.display]), [
    ['fit-months', '6', '6 months'], ['fit-monthly', '500000', '₹5,000'],
  ]);
  const rounded = await card(env, { playbook: 'general', subject: 'A studio', inputs: { upfront: '0', monthly: '100', months: '3', limit: '100' } });
  assert.deepEqual(rounded.toGo, { line: 'It would be a go at 1 month, or at ₹33.33 a month.', months: 1, monthly: { minor: '3333', display: '₹33.33' } });
  const tight = await card(env, { playbook: 'general', subject: 'A studio', inputs: { upfront: '10,000', monthly: '5,000', months: '4', limit: '12,000' } });
  assert.deepEqual(tight.toGo, { line: 'It would be a go at ₹500 a month.', months: null, monthly: { minor: '50000', display: '₹500' } });
  const over = await card(env, { playbook: 'general', subject: 'A studio', inputs: { upfront: '90,000', monthly: '1,000', months: '2', limit: '80,000' } });
  assert.deepEqual(over.toGo, { line: 'Even with no monthly cost, the upfront cost is over your limit.', months: null, monthly: null });
  assert.equal((await receipt(env, over.id)).figures.some(figure => figure.key.startsWith('fit-')), false);
  const go = await card(env, { playbook: 'general', subject: 'A studio', inputs: INPUTS });
  assert.equal(go.toGo, undefined);
});
