// Package 4E1 (Ink v2 wave 4): the lead score (catalogue C12), "How people moved" and the forecast. The owner's rules
// read fields from a fixed list, a protected trait is refused, votes carry an evidence page or the word "guess"; code
// adds the points and buckets them hot, warm or cold, and the rules that matched are the reasons shown. "How people
// moved" counts, from the cards' own histories, who reached each stage in the last 90 days and the share that moved on,
// in permille, each stage with a count receipt. The forecast weighs quotes by those shares, labelled "forecast from your
// last 90 days" with its receipt, or says there is not enough history under 10 closed cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { PipelineView, PriceReceiptRecord, SumReceiptRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { checkScoreRules, scoreCard, type ScoreFacts } from '../runtime/venture/network/score.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { code, owner, seedBlueprint, setup, type Env } from './venture-views-env.ts';
import { add, allCards, board, manyPeople, pipe, withPeople } from './venture-pipeline-env.ts';

const moneyCall = <T>(env: Env, method: string, payload: unknown) =>
  ((money as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method])(env.deps, owner, payload) as Promise<T>;
const settings = (env: Env, payload: Record<string, unknown>) => pipe(env, 'venture.pipeline.settings', payload);
const move = (env: Env, id: string, stage: string, extra: Record<string, unknown> = {}) => pipe(env, 'venture.pipeline.move', { id, stage, ...extra });
const note = (on: string) => ({ kind: 'note', on });
const rule = (field: string, operator: string, value: string, points: number) => ({ field, operator, value, points });

const ASHA: ScoreFacts = { title: 'Co-founder', company: 'Dewdrop Naturals', 'email-domain': 'dewdrop.example', band: 'know', trigger: 'import', stage: 'found', meetings: 2, client: false };

test('score rules: fields from a fixed list and fitting operators; a protected trait is refused, in English or Hindi', () => {
  assert.deepEqual(checkScoreRules([rule('title', 'contains', 'founder', 30)]), [{ field: 'title', operator: 'contains', value: 'founder', points: 30 }]);
  for (const bad of [rule('religion', 'is', 'any', 10), rule('age', 'at-least', '30', 10), rule('gender', 'is', 'female', 5),
    rule('title', 'contains', 'Muslim', 10), rule('company', 'contains', 'caste', 5), rule('title', 'contains', 'धर्म', 5), rule('title', 'contains', 'pregnant', 5)]) {
    assert.throws(() => checkScoreRules([bad]), code('NETWORK_TRAIT_PROTECTED'), JSON.stringify(bad));
  }
  for (const bad of [rule('shoe size', 'is', '9', 10), rule('title', 'at-least', '3', 10), rule('meetings', 'contains', 'x', 10), rule('band', 'at-least', 'friend', 10),
    rule('meetings', 'at-least', 'many', 10), rule('title', 'contains', 'founder', 1000), rule('title', 'contains', '', 10), rule('client', 'is', 'maybe', 5)]) {
    assert.throws(() => checkScoreRules([bad]), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bad));
  }
  assert.throws(() => checkScoreRules(Array.from({ length: 31 }, () => rule('title', 'contains', 'x', 1))), code('INVALID_VENTURE_REQUEST'));
});

test('the protected-trait check holds against plurals, other spellings, Hindi, romanised Hindi and hidden characters', () => {
  const probes = [
    'Muslims', 'Hindus', 'Christians', 'Brahmins', 'dalits', 'Islam', 'woman', 'women', 'female', 'male', 'Mrs', 'widow', 'divorced', 'Sikhs', 'Jews',
    'married', 'Gay', 'lesbians', 'transgender', 'pregnancy', 'disabled', 'age', 'aged', 'elderly', 'teenagers', 'caste', 'OBC', 'religion',
    'हिंदू', 'हिन्दू', 'मुस्लिम', 'मुसलमानों', 'महिला', 'महिलाओं', 'पुरुष', 'शादी', 'विवाह', 'विवाहित', 'जाति', 'धर्म', 'उम्र', 'विधवा', 'तलाक',
    'jati', 'jaati', 'dharm', 'dharma', 'mahila', 'purush', 'shaadi', 'vivah', 'aurat', 'umar', 'musalman',
    'Mus\u200Blims', 'wo\u200Dman', 'Hin\u00ADdu', 'मु\u200Cस्लिम', 'ma\u200Bhila', '\uFF2D\uFF55\uFF53\uFF4C\uFF49\uFF4D',
  ];
  for (const word of probes) {
    assert.throws(() => checkScoreRules([rule('title', 'contains', word, 10)]), code('NETWORK_TRAIT_PROTECTED'), `value ${JSON.stringify(word)}`);
    assert.throws(() => checkScoreRules([rule(word, 'is', 'x', 10)]), code('NETWORK_TRAIT_PROTECTED'), `field ${JSON.stringify(word)}`);
    assert.throws(() => scoreCard(ASHA, [], [{ factor: `Is ${word}`, points: 10, evidence: 'guess' }]), code('NETWORK_TRAIT_PROTECTED'), `vote ${JSON.stringify(word)}`);
  }
  // Ordinary words that only look close stay allowed.
  for (const word of ['Manager', 'Agency', 'Garage', 'Marriott Hotels', 'Senior buyer', 'Brahmaputra Tea', 'Head of Growth', 'Salesman', 'Mailing list', 'Sikhana Labs']) {
    assert.doesNotThrow(() => checkScoreRules([rule('company', 'contains', word, 10)]), word);
  }
});

test('scoreCard: code adds the points of the rules that match and buckets them; the matched rules are the reasons; votes need a page or "guess"', () => {
  const rules = checkScoreRules([
    rule('title', 'contains', 'founder', 30), rule('band', 'at-least', 'know', 20), rule('company', 'is', 'Ubtan Lab', 40), rule('meetings', 'at-least', '2', 10),
  ]);
  assert.deepEqual(scoreCard(ASHA, rules, []), {
    bucket: 'hot', points: 60,
    reasons: ['Title contains "founder": +30', 'Relationship is at least Know: +20', 'Meetings at least 2: +10'],
  });
  assert.deepEqual(scoreCard({ ...ASHA, band: 'cold', meetings: 0 }, rules, []), { bucket: 'warm', points: 30, reasons: ['Title contains "founder": +30'] });
  assert.deepEqual(scoreCard({ ...ASHA, title: 'Buyer', band: null, meetings: 0 }, rules, []), { bucket: 'cold', points: 0, reasons: [] });
  assert.equal(scoreCard(ASHA, [], []), null, 'no rules and no votes: no score');
  const votes = [{ factor: 'Sells online', points: 20, evidence: 'https://dewdrop.example/shop' }, { factor: 'Has budget', points: 10, evidence: 'guess' }];
  assert.deepEqual(scoreCard({ ...ASHA, title: 'Buyer', band: null, meetings: 0 }, rules, votes), {
    bucket: 'warm', points: 30, reasons: ['Sells online: +20 (https://dewdrop.example/shop)', 'Has budget: +10 (a guess)'],
  });
  assert.throws(() => scoreCard(ASHA, rules, [{ factor: 'Big', points: 10, evidence: 'my hunch' }]), code('INVALID_VENTURE_REQUEST'));
});

test('the board shows each card\'s score from the owner\'s rules, set inside the app', async () => {
  const env = await setup();
  const { asha, rahul } = await withPeople(env);
  await add(env, asha);
  await add(env, rahul);
  assert.equal(allCards(await board(env))[0].score, null);
  await assert.rejects(settings(env, { scoreRules: [rule('religion', 'is', 'any', 10)] }), code('NETWORK_TRAIT_PROTECTED'));
  await settings(env, { scoreRules: [rule('title', 'contains', 'founder', 30), rule('company', 'contains', 'ubtan', 20)] });
  const view = allCards(await board(env));
  assert.deepEqual(view.find(card => card.name === 'Asha Rao')!.score, { bucket: 'warm', reasons: ['Title contains "founder": +30'] });
  assert.deepEqual(view.find(card => card.name === 'Rahul Mehta')!.score, { bucket: 'warm', reasons: ['Company contains "ubtan": +20'] });
});

/** Eleven cards moved through the stages: 3 won, 7 lost, and one open at Proposal with a quote. */
async function history(env: Env): Promise<{ open: string; quote: PriceReceiptRecord }> {
  const people = await manyPeople(env, 11);
  await seedBlueprint(env);
  const quote = await moneyCall<PriceReceiptRecord>(env, 'venture.price.quote', { offerId: 'offer_1' });
  const ids: string[] = [];
  for (const person of people) ids.push((await add(env, person)).card.id);
  for (const id of ids) await move(env, id, 'asked', { evidence: note('2026-10-15') });
  for (const id of ids.slice(0, 6)) await move(env, id, 'talking', { evidence: note('2026-10-15') });
  for (const id of ids.slice(0, 5)) await move(env, id, 'proposal', { evidence: { kind: 'quote', id: quote.id } });
  for (const id of ids.slice(0, 3)) await move(env, id, 'won');
  for (const id of ids.slice(5, 11).concat(ids[3])) await move(env, id, 'lost', { reason: 'no-reply' });
  return { open: ids[4], quote };
}

test('"How people moved": who reached each stage in the last 90 days and the share that moved on, in permille, each with a count receipt', async () => {
  const env = await setup();
  await history(env);
  const view: PipelineView = await board(env);
  assert.deepEqual(view.funnel.map(item => [item.stage, item.reached, item.movedOnPermille]), [
    ['found', 11, 1000], ['asked', 11, 545], ['talking', 6, 833], ['proposal', 5, 600], ['won', 3, null], ['lost', 7, null], ['not-now', 0, null],
  ]);
  const asked = await moneyCall<SumReceiptRecord>(env, 'venture.receipt.get', { id: view.funnel[1].receiptId });
  assert.deepEqual([asked.unit, asked.totalMinor, asked.subject], ['count', '11', { type: 'count', what: 'funnel', scope: 'asked', from: '2026-07-18', to: '2026-10-15' }]);
  assert.equal(asked.addends[0].label, 'A card reached Asked on 15 Oct 2026, then moved on to Talking', 'no names in a receipt: Forget leaves nothing behind');
  assert.equal(asked.addends[10].label, 'A card reached Asked on 15 Oct 2026, then Lost');
  assert.equal(asked.figures[0].label, 'People who reached Asked');
});

test('the forecast: quotes weighed by the share won from each stage, labelled and receipted; not enough history under 10 closed cards', async () => {
  const empty = await setup();
  const { asha } = await withPeople(empty);
  await add(empty, asha);
  assert.deepEqual((await board(empty)).forecast, { line: 'Not enough history yet: 0 cards closed in the last 90 days, and a forecast needs 10.' });

  const env = await setup();
  const { open } = await history(env);
  const view = await board(env);
  // Closed cards that reached Proposal: 4 (3 won, 1 lost), so 750 in 1,000. The open quote is INR 2,499.00 before tax.
  // 249,900 x 750 / 1,000 = 187,425 paise, INR 1,874.25.
  assert.ok(view.forecast && 'value' in view.forecast);
  assert.deepEqual([view.forecast.value, view.forecast.label], ['INR 1,874.25', 'forecast from your last 90 days']);
  const receipt = await moneyCall<SumReceiptRecord>(env, 'venture.receipt.get', { id: view.forecast.receiptId });
  assert.deepEqual([receipt.unit, receipt.totalMinor, receipt.estimate, receipt.figures[0].label], ['minor', '187425', true, 'Forecast from your last 90 days']);
  assert.ok(receipt.explanation.endsWith('Each amount is a forecast from your last 90 days, not money anyone owes.'), receipt.explanation);
  assert.ok(!receipt.explanation.includes('Calls not settled'), 'its own estimate words, not the spend ones');
  assert.deepEqual(receipt.addends.map(item => [item.recordId, item.amount, item.label]), [
    [open, '187425', 'A card at Proposal: a quote of INR 2,499.00 before tax, times 750 in 1,000 won from Proposal'],
  ]);
  await move(env, open, 'lost', { reason: 'timing' });
  const after = await moneyCall<SumReceiptRecord>(env, 'venture.receipt.get', { id: view.forecast.receiptId });
  assert.equal(after.stale, true, 'the forecast it backed is out of date');
});
