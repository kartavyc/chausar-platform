// Chats receipts (Ink v2 wave 4, package 4C1, catalogue A1, spec 5.4 and 8 "chief quotes a figure with no receipt"):
// the chief's answer is typed parts, and code checks every one before it is stored. A figure part keeps its place only
// when a read tool of this same answer returned that receipt with that key, and its display comes from the receipt,
// never the model; a figure part naming any other receipt has nothing to show and is left out with a line saying so.
// Nothing the AI wrote in words is cut: money or any other number in prose stays whole, shown as a model estimate.
// (stripMoney still cuts amounts out of proposal text, where prices are the owner's to set: proposals.ts.)
import test from 'node:test';
import { givenWords } from '../runtime/venture/agents/estimate.ts';
import assert from 'node:assert/strict';
import { listRecords } from '../runtime/venture/records.ts';
import { checkParts, stripMoney, MONEY_LEFT_OUT } from '../runtime/venture/chief/answer.ts';
import { MONEY_SCALE_WORDS } from '../runtime/venture/core/money-words.ts';
import { statesMoney } from '../runtime/venture/delivery/harness/patches.ts';
import { episodeOrder } from './venture-agent-helpers.ts';
import { answer, chatConsent, chiefBusiness, figure, figuresOf, priceOffer, scriptChief, text, tools, type ChiefEnv } from './venture-chief-helpers.ts';

/** An issued invoice of ₹1,18,400 for Asha Rao, so the money tool's "Clients owe you" has a receipt. */
async function owedBusiness(): Promise<ChiefEnv> {
  const env = await chiefBusiness();
  await priceOffer(env, '118400');
  const order = await episodeOrder(env);
  const draft = await env.call('venture.invoice.prepare', { orderId: order.id });
  await env.call('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  await chatConsent(env);
  return env;
}

test('receipts: a receipted figure stays, an unreceipted figure part is left out, and money or numbers in words stay as estimates', async () => {
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
  // The AI's words come first, a part for each paragraph; the figure it cited follows, with the receipt's own display.
  assert.deepEqual(reply.parts.map((part: any) => part.kind), ['text', 'estimate', 'estimate', 'figure']);
  assert.deepEqual(reply.parts[3], { kind: 'figure', receiptId: owed!.receiptId, key: owed!.key, display: '₹1,18,400' });
  assert.equal(reply.parts[1].text, 'Last month Meera paid ₹31,600.', 'the amount stays as the AI wrote it, labelled a model estimate');
  assert.equal(reply.parts[2].text, 'The channel should reach about 18,000 views.');
  assert.deepEqual(reply.dropped, ['One figure was left out: it had no receipt.']);
  assert.deepEqual(reply.worked, [{ label: 'Clients owe you', value: '₹1,18,400', receiptId: owed!.receiptId }]);
  // The display is the receipt's own, from the vault.
  const receipt = listRecords(env.store.read(), 'venture-sum-receipt').find(item => item.id === owed!.receiptId)!;
  assert.equal(receipt.figures[0].display, '₹1,18,400');
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
    ['About ₹31,600 came in.', `About ${MONEY_LEFT_OUT} came in.`],
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
  const figures = [{ receiptId: 'sumrcpt_a', key: 'balance', label: 'Clients owe you', display: '₹1,000' }];
  const { parts, dropped, worked } = checkParts({
    reply: 'Asha owes the most.\nA tenner is the fee.\nMaybe a week.\nYou have 3 runs waiting.\n   \n',
    figures: [{ receiptId: 'sumrcpt_a', key: 'balance' }, { receiptId: 'sumrcpt_a', key: 'total' }, { receiptId: 'sumrcpt_b', key: 'balance' }, { receiptId: 'sumrcpt_a', key: 'balance' }],
    guide: '',
  }, figures, 'Who owes me?');
  // Each paragraph is a part: only the ones that state money or a number are labelled; the cited figure follows, once.
  assert.deepEqual(parts, [
    { kind: 'text', text: 'Asha owes the most.' },
    { kind: 'estimate', text: 'A tenner is the fee.' },
    { kind: 'text', text: 'Maybe a week.' },
    { kind: 'estimate', text: 'You have 3 runs waiting.' },
    { kind: 'figure', receiptId: 'sumrcpt_a', key: 'balance', display: '₹1,000' },
  ]);
  assert.deepEqual(dropped, ['Two figures were left out: they had no receipt.']);
  assert.deepEqual(worked, [{ label: 'Clients owe you', value: '₹1,000', receiptId: 'sumrcpt_a' }]);
});

// Found live on Windows, 15 Nov 2026 (findings D-4 and P2-5): a chief answer that cited the owner's own set prices with
// their calculator receipts was also marked a model estimate, and an agent's reply that only repeated the owner's own
// "200 pieces a month" was marked one too. A paragraph is an estimate only for a number of the AI's own.
test('receipts: a paragraph is an estimate only when it holds a number that was neither given to the AI nor a receipted figure', () => {
  const figures = [
    { receiptId: 'price_a', key: 'unit', label: 'Subtitles for creators: price per project', display: '₹900' },
    { receiptId: 'price_b', key: 'unit', label: 'Video subtitles: price per project', display: '₹1,800' },
  ];
  const question = 'How much should I charge a creator for subtitling a ten minute video?';
  const kinds = (reply: string, cite: { receiptId: string; key: string }[] = [], given: string[] = []) =>
    checkParts({ reply, figures: cite, guide: '' }, figures, question, given).parts.map(part => part.kind);
  const both = [{ receiptId: 'price_a', key: 'unit' }, { receiptId: 'price_b', key: 'unit' }];
  // The owner's own set prices, cited: the receipt is the only mark. Never both marks for one figure.
  assert.deepEqual(kinds('Your set price for "Subtitles for creators" is Rs 900 per project. The other offer is Rs 1,800; the plan does not say whether either is for a ten minute video.', both), ['text', 'figure', 'figure']);
  // Seen live, 15 Nov 2026: "Your plan has two set project prices: ₹900 ... and ₹1,800 ..." was marked an estimate for
  // its "two". A count of the receipted figures the answer cites, or of a list the AI was given, is no estimate.
  assert.deepEqual(kinds('Your plan has two set project prices: ₹900 for "Subtitles for creators" and ₹1,800 for "Video subtitles." The plan gives no rate for a ten-minute video.', both), ['text', 'figure', 'figure']);
  assert.deepEqual(kinds('Two creators a week is a fair start.', both), ['estimate', 'figure', 'figure'], 'a count of anything else still is');
  assert.deepEqual(kinds('Your three offers are priced.', [], givenWords({ results: [{ offers: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }] })), ['text']);
  assert.deepEqual(kinds('Contact three cafes first.', [], givenWords({ results: [{ offers: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }] })), ['estimate']);
  // An amount of the AI's own in another paragraph: that paragraph alone is the estimate.
  assert.deepEqual(kinds('Your set price is ₹900 per project.\nAs an estimate, creators often pay around Rs 150 a minute.', both.slice(0, 1)), ['text', 'estimate', 'figure']);
  // What the AI was given: the owner's earlier words, the business's own words, the plan, a card's own count.
  const given = ['I make about 200 pieces a month in Koregaon Park.', 'Looks on OpenStreetMap, a public map, for up to 20 cafes in Pune.', 'Photograph three sample sets.', 'करीब बीस कैफ़े',
    'Should I charge Rs 500 for a mug set?', 'I can handle about six visits a day with one helper.'];
  for (const [reply, kind] of [
    ['You make about 200 pieces a month, so the 20 cafes the search can find are plenty to start with.', 'text'],
    ['Start with the three sample sets.', 'text'],
    // Given about something else is not given: the plan's "three sample sets" does not make "three cafes" a fact.
    ['Three cafes are worth a message today.', 'estimate'],
    ['Rs 500 is a fair place to start.', 'text'],
    ['At Rs 500 you would need 40 orders.', 'estimate'],
    ['With six visits a day you could take on two contracts.', 'estimate'],
    ['Six visits a day is a full day.', 'text'],
    ['I would contact 15 cafes first. That is my estimate.', 'estimate'],
    ['Contact ten to fifteen cafes.', 'estimate'],
    ['About 2 lakh a year.', 'estimate'],
    ['Expect about 10% to reply.', 'estimate'],
    ['A tenner is the fee.', 'estimate'],
    // Dates and list positions are not estimates; names with digits are names.
    ['First, approve the search on Today. Second, write to each cafe yourself.', 'text'],
    ['1. Approve the search on Today.', 'text'],
    ['Aim to send them by 20 November.', 'text'],
    ['The plan was accepted on 2026-11-15.', 'text'],
    ['B2B buyers and Web3 studios reply slowly.', 'text'],
    ['करीब बीस कैफ़े से शुरू करें।', 'text'],
    ['करीब पचास कैफ़े से शुरू करें।', 'estimate'],
  ] as const) assert.deepEqual(kinds(reply, [], given), [kind], reply);
  // A count the engine supplied is given as a count, never as an amount of money: an invented price that happens to
  // equal it keeps its mark.
  const counted = givenWords({ results: [{ daysLeft: 15 }] });
  assert.deepEqual(kinds('There are 15 days left this month.', [], counted), ['text']);
  assert.deepEqual(kinds('Charge Rs 15 a mug.', [], counted), ['estimate']);
  // With nothing given but the question, a number the owner did not write is still an estimate.
  assert.deepEqual(kinds('You make about 200 pieces a month.'), ['estimate']);
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
  const owed = figures.find((part: any) => part.display === '₹1,18,400');
  assert.ok(owed, 'what clients owe, from its receipt');
  assert.ok(listRecords(env.store.read(), 'venture-sum-receipt').some(item => item.id === owed.receiptId));
  assert.match(reply.parts.at(-1).text, /Connect your AI in Connections/);
  // C5 task 5: the no-AI tail carries its next step as a button, set by code; the stored message keeps it.
  assert.deepEqual(reply.suggestion, { kind: 'connect-ai' });
  assert.deepEqual(listRecords(env.store.read(), 'venture-chief-message').at(-1)!.suggestion, { kind: 'connect-ai' });
  assert.ok(reply.parts.every((part: any) => part.kind !== 'estimate'));
  assert.equal(env.models.previewed.length, 0, 'nothing is sent with templates only');
});

test('receipts: money the AI writes stays whole as an estimate; a cited figure with no such receipt is the only thing left out', async () => {
  const env = await owedBusiness();
  scriptChief(env, [answer([text('Roughly ₹20,000 more by the 30th.'), text('That would be a good month.'), figure('sumrcpt_nowhere', 'total')])]);
  const sent = await env.chief('venture.chief.thread.send', { text: 'Will we get there?' });
  assert.deepEqual(sent.added[1].parts, [{ kind: 'estimate', text: 'Roughly ₹20,000 more by the 30th.' }, { kind: 'text', text: 'That would be a good month.' }]);
  assert.deepEqual(sent.added[1].dropped, ['One figure was left out: it had no receipt.']);
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

// The chief's turn is the read tools it names, or its own words as one reply with the receipts it cites and, for a
// how-to question, the id of one part of the guide. No typed parts: see the agent answer shape (venture-agent-threads).
test('the chief turn shape: tools, one reply, cited figures, a guide id and proposals; the old typed parts are refused', async () => {
  const { CHIEF_TURN_SCHEMA, validateTurn } = await import('../runtime/venture/chief/answer.ts');
  assert.deepEqual((CHIEF_TURN_SCHEMA as any).required, ['tools', 'reply', 'figures', 'guide', 'proposals']);
  assert.deepEqual(validateTurn({ tools: ['money'], reply: '', figures: [], guide: '', proposals: [] }), { tools: ['money'], reply: '', figures: [], guide: '', proposals: [] });
  const long = 'A full paragraph of plain words about the month. '.repeat(100);
  assert.equal(validateTurn({ tools: [], reply: long, figures: [{ receiptId: 'sumrcpt_a', key: 'balance' }], guide: '', proposals: [] }).reply, long, 'a long reply is kept whole');
  for (const wrong of [{ tools: [], parts: [text('Old shape.')], proposals: [] }, { tools: [], reply: 'No guide.', figures: [], proposals: [] }, { tools: [], reply: 'Ok.', figures: [{ receiptId: 'r' }], guide: '', proposals: [] }, { tools: [], reply: 'Hidden​ mark.', figures: [], guide: '', proposals: [] }]) {
    assert.throws(() => validateTurn(wrong), (error: any) => error.code === 'MODEL_OUTPUT_REJECTED', JSON.stringify(wrong).slice(0, 60));
  }
});

// Conversation memory in Chats: each turn of the chief's answer is given the earlier messages of the same chat.
test('chief: a follow-up in the same chat carries its earlier messages; a new chat starts with none', async () => {
  const env = await owedBusiness();
  const first = scriptChief(env, [answer([text('Asha owes the most.')])]);
  const sent = await env.chief('venture.chief.thread.send', { text: 'Who owes me the most?' });
  assert.equal((first[0]!.input as any).history, undefined);
  const second = scriptChief(env, [answer([text('She has been late twice.')])]);
  await env.chief('venture.chief.thread.send', { threadId: sent.thread.id, text: 'Is she usually late?' });
  assert.deepEqual((second[0]!.input as any).history, [{ from: 'owner', text: 'Who owes me the most?' }, { from: 'you', text: 'Asha owes the most.' }]);
  const other = scriptChief(env, [answer([text('Nothing is due this week.')])]);
  await env.chief('venture.chief.thread.send', { text: 'What is due this week?' });
  assert.equal((other[0]!.input as any).history, undefined);
});

// Seen live on 11 Nov 2026 (Claude Code, the running app): an English question was answered in Hindi, because the rule
// only named the two languages. Both chats now say which language follows which.
test('both chats tell the AI to answer in the language of the question, English for English', async () => {
  const { CHIEF_INSTRUCTIONS } = await import('../runtime/venture/chief/answer.ts');
  const { ANSWER_INSTRUCTIONS } = await import('../runtime/venture/agents/answer.ts');
  for (const instructions of [CHIEF_INSTRUCTIONS, ANSWER_INSTRUCTIONS]) {
    assert.match(instructions, /in English when the owner wrote in English, in Hindi only when they wrote in Hindi/);
    assert.doesNotMatch(instructions, /English or Hindi\./);
  }
});

// Both chats are told what the business is in the owner's own words (the idea kept at onboarding), so an answer can
// build on what the owner already said there, not only on the records.
test('both chats carry what the business is, in the words the owner kept at onboarding', async () => {
  const env = await owedBusiness();
  const idea = listRecords(env.store.read(), 'venture-record')[0]!.idea;
  assert.ok(idea.length >= 10);
  const tasks = scriptChief(env, [answer([text('Here is where it stands.')])]);
  await env.chief('venture.chief.thread.send', { text: 'What should I focus on?' });
  assert.equal((tasks[0]!.input as any).business.about, idea);
  let seen: any = null;
  env.models.respond['agent-chat'] = task => { seen = task.input; return { reply: 'On it.', figures: [] }; };
  await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'What are we selling?' });
  assert.deepEqual(seen.business, { name: (tasks[0]!.input as any).business.name, about: idea });
});
