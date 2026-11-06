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

// One-shot C4 task 25 (114.x1, 114.x2): how the number was reached, and Remove.
const remove = (env: Env, payload: unknown) => (playbooks as Record<string, Handler>)['venture.goNoGo.remove'](env.deps, owner, payload);

test('C4: the card says how the number was reached, rebuilt from the steps its receipt holds', async () => {
  const env = await setup();
  const made = await card(env, { playbook: 'general', subject: 'A reels pack for gyms', inputs: { upfront: '5,000', monthly: '1,000', months: '6', limit: '50000' } });
  assert.equal(made.working, '₹5,000 to start + 6 months × ₹1,000');
  const proof = await receipt(env, made.id);
  assert.deepEqual(proof.figures.map(figure => figure.display).slice(0, 2), ['₹5,000', '₹1,000']);
  // One month reads as one month; a Hold with amounts missing has no working.
  const one = await card(env, { playbook: 'general', subject: 'One month', inputs: { upfront: '5,000', monthly: '1,000', months: '1', limit: '50000' } });
  assert.equal(one.working, '₹5,000 to start + 1 month × ₹1,000');
  const hold = await card(env, { playbook: 'general', subject: 'Not known yet', inputs: { upfront: '5,000', monthly: null, months: null, limit: null } });
  assert.equal(hold.working, null);
});

test('C4: Remove takes away only that card, says so as a decision, and refuses another business\'s card', async () => {
  const env = await setup();
  const kept = await card(env, { playbook: 'general', subject: 'Kept idea', inputs: INPUTS });
  const gone = await card(env, { playbook: 'general', subject: 'weekend photo shoot packs', inputs: INPUTS });
  const answer = await remove(env, { cardId: gone.id });
  assert.deepEqual(answer, { removed: true, line: 'You removed the card for weekend photo shoot packs.' });
  assert.deepEqual((await list(env)).cards.map(item => item.id), [kept.id]);
  const decisions = listRecords(env.store.read(), 'venture-decision');
  const said = decisions.find(item => item.subject === `go-no-go:${gone.id}`)!;
  assert.equal(said.reason, 'You removed the card for weekend photo shoot packs.');
  assert.equal(said.action, 'remove-card');
  // Its receipt no longer opens, and a second Remove finds nothing.
  await assert.rejects(receipt(env, gone.id), code('RECEIPT_NOT_FOUND'));
  await assert.rejects(remove(env, { cardId: gone.id }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(remove(env, { cardId: 'gonogo_nothing' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(remove(env, { cardId: kept.id, extra: true }), code('INVALID_VENTURE_REQUEST'));
  // A card of another business.
  const records = env.store.read().conversations.filter(item => item.kind === 'venture-go-no-go' && item.id === kept.id) as { ventureId: string }[];
  await env.store.update(state => { const row = state.conversations.find(item => item.id === kept.id) as unknown as { ventureId: string }; row.ventureId = 'venture_other'; });
  assert.equal(records.length, 1);
  await assert.rejects(remove(env, { cardId: kept.id }), code('INVALID_VENTURE_REQUEST'));
});
