// Chats receipts (Ink v2 wave 4, package 4C1, catalogue A1, spec 5.4 and 8 "chief quotes a figure with no receipt"):
// the chief's answer is typed parts, and code checks every one before it is stored. A figure part keeps its place only
// when a read tool of this same answer returned that receipt with that key, and its display comes from the receipt,
// never the model; any other figure part is left out with a line saying so. Money written in words is cut out and
// replaced with "(figure left out: no receipt)"; any other number in prose is shown as a model estimate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords } from '../runtime/venture/records.ts';
import { checkParts, stripMoney, MONEY_LEFT_OUT } from '../runtime/venture/chief/answer.ts';
import { MONEY_SCALE_WORDS } from '../runtime/venture/core/money-words.ts';
import { statesMoney } from '../runtime/venture/delivery/harness/patches.ts';
import { episodeOrder } from './venture-agent-helpers.ts';
import { answer, chatConsent, chiefBusiness, estimate, figure, figuresOf, priceOffer, scriptChief, text, tools, type ChiefEnv } from './venture-chief-helpers.ts';

/** An issued invoice of INR 1,18,400 for Asha Rao, so the money tool's "Clients owe you" has a receipt. */
async function owedBusiness(): Promise<ChiefEnv> {
  const env = await chiefBusiness();
  await priceOffer(env, '118400');
  const order = await episodeOrder(env);
  const draft = await env.call('venture.invoice.prepare', { orderId: order.id });
  await env.call('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  await chatConsent(env);
  return env;
}

test('receipts: a receipted figure stays, an unreceipted one is left out, money in words is cut, other numbers are estimates (spec 8)', async () => {
  const env = await owedBusiness();
  let owed: { receiptId: string; key: string; label: string; display: string } | undefined;
  const tasks = scriptChief(env, [
    tools('money'),
    (task: any) => {
      owed = figuresOf(task, 'money').find(item => item.label === 'Clients owe you');
      assert.ok(owed, 'the money tool returns what clients owe with its receipt');
      return answer([
        text('Clients owe you'), figure(owed.receiptId, owed.key), figure('sumrcpt_nowhere', 'total'),
        text('Last month Meera paid ₹31,600.'), text('The channel should reach about 18,000 views.'),
      ]);
    },
  ]);
  const sent = await env.chief('venture.chief.thread.send', { text: 'Can we hit 1.5 lakh this month?' });
  assert.equal(tasks.length, 2);
  const reply = sent.added[1];
  assert.equal(reply.from, 'chief');
  assert.deepEqual(reply.parts.map((part: any) => part.kind), ['text', 'figure', 'text', 'estimate']);
  assert.deepEqual(reply.parts[1], { kind: 'figure', receiptId: owed!.receiptId, key: owed!.key, display: 'INR 118,400.00' });
  assert.equal(reply.parts[2].text, `Last month Meera paid ${MONEY_LEFT_OUT}.`);
  assert.equal(reply.parts[3].text, 'The channel should reach about 18,000 views.');
  assert.deepEqual(reply.dropped, ['One figure was left out: it had no receipt.']);
  assert.deepEqual(reply.worked, [{ label: 'Clients owe you', value: 'INR 118,400.00', receiptId: owed!.receiptId }]);
  // The display is the receipt's own, from the vault.
  const receipt = listRecords(env.store.read(), 'venture-sum-receipt').find(item => item.id === owed!.receiptId)!;
  assert.equal(receipt.figures[0].display, 'INR 118,400.00');
  const stored = listRecords(env.store.read(), 'venture-chief-message').at(-1)!;
  assert.deepEqual(stored.receiptIds, [owed!.receiptId]);
  assert.deepEqual(stored.parts, reply.parts);
  assert.equal(stored.author, 'model');
  assert.equal(stored.callIds.length, 2);
});

test('receipts: a figure part citing a receipt no tool of this answer returned is left out, even a real one', async () => {
  const env = await owedBusiness();
  const receiptId = listRecords(env.store.read(), 'venture-invoice')[0].priceReceiptId;
  scriptChief(env, [answer([text('Your invoice comes to'), figure(receiptId, 'total')])]);
  const sent = await env.chief('venture.chief.thread.send', { text: 'What did I invoice Asha?' });
  const reply = sent.added[1];
  assert.deepEqual(reply.parts.map((part: any) => part.kind), ['text']);
  assert.deepEqual(reply.dropped, ['One figure was left out: it had no receipt.']);
  assert.deepEqual(reply.worked, []);
});

test('receipts: money in words is cut however it is written; counts and dates stay as estimates or words', () => {
  const cases: [string, string][] = [
    ['You billed ₹1,18,400 so far.', `You billed ${MONEY_LEFT_OUT} so far.`],
    ['That is Rs. 31,600 left.', `That is ${MONEY_LEFT_OUT} left.`],
    ['Rs 500 per short.', `${MONEY_LEFT_OUT} per short.`],
    ['About INR 31,600.00 came in.', `About ${MONEY_LEFT_OUT} came in.`],
    ['You need 1.5 lakh more.', `You need ${MONEY_LEFT_OUT} more.`],
    ['Two crore is far off.', `${MONEY_LEFT_OUT} is far off.`],
    ['31600 rupees came in.', `${MONEY_LEFT_OUT} came in.`],
    ['अभी 31600 रुपये बाकी हैं।', `अभी ${MONEY_LEFT_OUT} बाकी हैं।`],
    ['डेढ़ लाख का लक्ष्य है।', `${MONEY_LEFT_OUT} का लक्ष्य है।`],
    ['The total was 1,18,400 last month.', `The total was ${MONEY_LEFT_OUT} last month.`],
    ['$500 went on ads.', `${MONEY_LEFT_OUT} went on ads.`],
  ];
  for (const [words, cut] of cases) assert.equal(stripMoney(words).text, cut, words);
  for (const words of ['About 18,000 views a month.', 'Three runs wait on you.', 'The episode is due on 5 November.']) {
    assert.equal(stripMoney(words).text, words, words);
    assert.equal(stripMoney(words).cut, 0, words);
  }
});

test('receipts: the part check, figure by figure', () => {
  const figures = [{ receiptId: 'sumrcpt_a', key: 'balance', label: 'Clients owe you', display: 'INR 1,000.00' }];
  const { parts, dropped, worked } = checkParts([
    { kind: 'figure', text: '', receiptId: 'sumrcpt_a', key: 'balance' },
    { kind: 'figure', text: '', receiptId: 'sumrcpt_a', key: 'total' },
    { kind: 'figure', text: '', receiptId: 'sumrcpt_b', key: 'balance' },
    { kind: 'text', text: 'Asha owes the most.', receiptId: '', key: '' },
    { kind: 'text', text: 'A tenner is the fee.', receiptId: '', key: '' },
    { kind: 'estimate', text: 'Maybe a week.', receiptId: '', key: '' },
    { kind: 'text', text: 'You have 3 runs waiting.', receiptId: '', key: '' },
    { kind: 'text', text: '   ', receiptId: '', key: '' },
  ], figures, 'Who owes me?');
  assert.deepEqual(parts, [
    { kind: 'figure', receiptId: 'sumrcpt_a', key: 'balance', display: 'INR 1,000.00' },
    { kind: 'text', text: 'Asha owes the most.' },
    { kind: 'estimate', text: 'Maybe a week.' },
    { kind: 'estimate', text: 'You have 3 runs waiting.' },
  ]);
  assert.deepEqual(dropped, ['Three figures were left out: they had no receipt.']);
  assert.deepEqual(worked, [{ label: 'Clients owe you', value: 'INR 1,000.00', receiptId: 'sumrcpt_a' }]);
});

test('receipts: with templates only, the answer comes from the records, every figure with its receipt', async () => {
  const env = await chiefBusiness();
  await priceOffer(env, '118400');
  const order = await episodeOrder(env);
  const draft = await env.call('venture.invoice.prepare', { orderId: order.id });
  await env.call('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  env.models.main = 'template';
  env.models.fast = 'template';
  const sent = await env.chief('venture.chief.thread.send', { text: 'How is money this month?' });
  const reply = sent.added[1];
  assert.equal(listRecords(env.store.read(), 'venture-chief-message').at(-1)!.author, 'template');
  const figures = reply.parts.filter((part: any) => part.kind === 'figure');
  assert.ok(figures.length >= 1);
  const owed = figures.find((part: any) => part.display === 'INR 118,400.00');
  assert.ok(owed, 'what clients owe, from its receipt');
  assert.ok(listRecords(env.store.read(), 'venture-sum-receipt').some(item => item.id === owed.receiptId));
  assert.match(reply.parts.at(-1).text, /Connect your AI in Connections/);
  assert.ok(reply.parts.every((part: any) => part.kind !== 'estimate'));
  assert.equal(env.models.previewed.length, 0, 'nothing is sent with templates only');
});

test('receipts: money inside a part the model marked an estimate is cut too', async () => {
  const env = await owedBusiness();
  scriptChief(env, [answer([estimate('Roughly ₹20,000 more by the 30th.')])]);
  const sent = await env.chief('venture.chief.thread.send', { text: 'Will we get there?' });
  assert.deepEqual(sent.added[1].parts, [{ kind: 'estimate', text: `Roughly ${MONEY_LEFT_OUT} more by the 30th.` }]);
});

// ---------------------------------------------------------------------------
// Review fixes (S2-2)
// ---------------------------------------------------------------------------

test('receipts: number words with a money scale are cut whole, L and K shorthands too; counts stay (S2-2)', () => {
  const cases: [string, string][] = [
    ['Aim for one lakh fifty thousand this month.', `Aim for ${MONEY_LEFT_OUT} this month.`],
    ['एक लाख पचास हज़ार चाहिए।', `${MONEY_LEFT_OUT} चाहिए।`],
    ['एक लाख पचास हजार चाहिए।', `${MONEY_LEFT_OUT} चाहिए।`],
    ['Two and a half lakh is the target.', `${MONEY_LEFT_OUT} is the target.`],
    ['ढाई लाख का लक्ष्य है।', `${MONEY_LEFT_OUT} का लक्ष्य है।`],
    ['Send ₹2L by Friday.', `Send ${MONEY_LEFT_OUT} by Friday.`],
    ['We need 1.5L more.', `We need ${MONEY_LEFT_OUT} more.`],
    ['₹20K came in.', `${MONEY_LEFT_OUT} came in.`],
    ['Rs 50 thousand is due.', `${MONEY_LEFT_OUT} is due.`],
    ['पचास हज़ार रुपये बाकी हैं।', `${MONEY_LEFT_OUT} बाकी हैं।`],
    ['Fifty thousand rupees came in.', `${MONEY_LEFT_OUT} came in.`],
    ['That is 2 lakh and 3 orders.', `That is ${MONEY_LEFT_OUT} and 3 orders.`],
  ];
  for (const [words, cut] of cases) assert.equal(stripMoney(words).text, cut, words);
  for (const words of ['20k views on the trailer.', 'About fifty thousand views.', 'Two hundred subscribers joined.']) {
    assert.equal(stripMoney(words).cut, 0, words);
  }
});

test('receipts: one shared list of money scale words for 4B1 and the chief; copied tokens never let a scaled amount through (S2-2)', () => {
  assert.ok(MONEY_SCALE_WORDS.includes('lakh') && MONEY_SCALE_WORDS.includes('करोड़'));
  for (const word of MONEY_SCALE_WORDS) {
    assert.equal(statesMoney(`about 2 ${word} now`, ''), true, `statesMoney: ${word}`);
    assert.equal(stripMoney(`about 2 ${word} now`).cut, 1, `stripMoney: ${word}`);
  }
  assert.equal(statesMoney('Yes, 2L is close.', 'Can we make 2L this month?'), true, 'the owner writing 2L never lets it through');
  assert.equal(statesMoney('Yes, 1.5cr is far.', 'Is 1.5cr possible?'), true);
  assert.equal(statesMoney('Keep shorts under 60 seconds', 'keep shorts under 60 seconds'), false);
  assert.equal(statesMoney('Use the B2B voice', 'use the B2B voice'), false);
  assert.equal(statesMoney('About 18,000 views', ''), false);
});
