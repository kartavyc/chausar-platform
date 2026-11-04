// One-shot A3 review 3 (M2): the amounts in an edit made on Today are found with the money guard's own detector
// (statesMoney, which holds assertNoMoney), so every way of writing money the guard knows is seen. Only an amount written
// exactly as a currency and a number is read for its value; anything else the guard calls money (words, lakh, 7.5k,
// "INR 7 500") is never parsed in part, and counts as the editor's own words unless the agent wrote it unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { editAmountsCheck, OWN_WORDS_AMOUNT } from '../runtime/venture/delivery/owner-edit.ts';

const none = { receipted: [] as string[], agentWords: '', clientWords: '' };
const EVERY = 'Every amount comes from a receipt.';

test('A3 review 3 M2: every way of writing money the guard knows is seen, and the editor\'s own when no receipt holds it', () => {
  const rows = [
    'The fee is five thousand rupees.',
    'The fee is AED 500.',
    'The fee is INR  5,000.',
    'The fee is 7,500 rs.',
    'The budget is 2 lakh rupees.',
    'That comes to fifteen hundred dollars.',
    'The fee is INR 7 500.',
    'The fee is Rs 7.5k.',
  ];
  for (const text of rows) {
    const own = editAmountsCheck(text, none);
    assert.deepEqual([own.passed, own.detail], [true, OWN_WORDS_AMOUNT], text);
    // The same words the agent wrote with no receipt, kept unchanged, still fail.
    const kept = editAmountsCheck(text, { ...none, agentWords: `Hello. ${text} Thanks.` });
    assert.equal(kept.passed, false, `${text} kept from the agent`);
  }
});

test('A3 review 3 M2: no partial reading: "INR 7 500" is not 7.00 and "Rs 7.5k" is not 7.50', () => {
  for (const [text, receipt] of [['The fee is INR 7 500.', 'INR 7.00'], ['The fee is Rs 7.5k.', 'INR 7.50'], ['The fee is Rs 2 lakh.', 'INR 2.00']] as const) {
    const result = editAmountsCheck(text, { ...none, receipted: [receipt] });
    assert.notEqual(result.detail, EVERY, text);
    assert.equal(result.detail, OWN_WORDS_AMOUNT, text);
  }
});

test('A3 review 3 M2: an exact amount is read for its value: a receipt\'s, the client\'s, or the agent\'s unreceipted one', () => {
  for (const written of ['INR 5,000.00', 'Rs 5,000', '₹5000', '5,000 rupees', 'INR  5,000', '5000 rs']) {
    assert.deepEqual(editAmountsCheck(`The fee is ${written}.`, { ...none, receipted: ['INR 5,000.00'] }), { check: 'no-numeric-prose', passed: true, detail: EVERY }, written);
  }
  const client = editAmountsCheck('Your budget of INR 20,000 is noted.', { ...none, agentWords: 'Your budget of INR 20,000 is noted.', clientWords: 'My budget is INR 20,000.' });
  assert.equal(client.passed, true, 'an amount from the client\'s own message is theirs to quote');
  assert.equal(editAmountsCheck('It costs INR 7,777.', { ...none, agentWords: 'It will cost Rs 7,777 in all.' }).passed, false, 'the agent\'s value, restyled, is still the agent\'s');
  assert.deepEqual(editAmountsCheck('No money here, only 3 meetings.', none), { check: 'no-numeric-prose', passed: true, detail: 'The words state no amount.' });
});

// A3 review 3 (L1): the owner's edit lifts the agent's receipts check, so the numbers in the edit's own words are
// compared with the run's receipts again: a count a receipt contradicts fails; any other number is the editor's own.
const WORK = {
  id: 'work_1', kind: 'venture-work-receipt', ventureId: 'venture_1', operation: 'work.reconcile', explanation: '', currency: 'INR',
  figures: [{ key: 'matched-count', label: 'Payments matched to bills', minor: '14', display: '14', currency: 'INR', unit: 'count' }],
  inputs: { tables: [{ id: 'table_1', name: 'bills-september.csv', digest: 'ef'.repeat(32) }], columns: {}, rowIds: [] },
  steps: [], reconciliation: null, allowedNumbers: [], digest: 'x', runRef: { kind: 'delivery', runId: 'delivery_1' },
};

test('A3 review 3 L1: a count in the edit that a receipt contradicts fails; a matching one passes; any other is the editor\'s own', async () => {
  const { editNumbersCheck, OWN_WORDS_NUMBER } = await import('../runtime/venture/delivery/owner-edit.ts');
  const input = { receipts: [WORK] as never[], ventureId: 'venture_1', clientWords: '' };
  const wrong = editNumbersCheck('We matched 12 payments to bills.', input);
  assert.equal(wrong.check, 'receipts');
  assert.equal(wrong.passed, false);
  assert.match(wrong.detail, /12/);
  assert.deepEqual(editNumbersCheck('We matched 14 payments to bills.', input), { check: 'receipts', passed: true, detail: 'Every number matches its receipt.' });
  assert.deepEqual(editNumbersCheck('We can meet 2 times next week.', input), { check: 'receipts', passed: true, detail: OWN_WORDS_NUMBER });
});

// One-shot A4 (A3 leftover): in a clause that holds an exact amount, any other number is money too ("Rs 5,000-9,000"):
// it is never left out because the guard alone would not call a bare number money.
test('A4: a bare number beside a receipted amount in one clause is the editor\'s own money words, never "from a receipt"', () => {
  const receipted = { ...none, receipted: ['INR 5,000.00'] };
  for (const text of ['The fee is Rs 5,000-9,000.', 'It is Rs 5,000 plus 4,000 more.', 'That is INR 5,000.00 x 3.']) {
    assert.deepEqual([editAmountsCheck(text, receipted).passed, editAmountsCheck(text, receipted).detail], [true, OWN_WORDS_AMOUNT], text);
    // The agent wrote the same clause with no receipt for the rest: it still fails when kept.
    assert.equal(editAmountsCheck(text, { ...receipted, agentWords: text }).passed, false, `${text} kept from the agent`);
  }
  // A date, a time or a share in the same clause is not money.
  for (const text of ['The fee is INR 5,000 by 3 Nov.', 'Pay Rs 5,000 before 10:30 on 12 December.', 'Rs 5,000 is 20% of the total.', 'Rs 5,000 on 2026-11-03.']) {
    assert.equal(editAmountsCheck(text, receipted).detail, EVERY, text);
  }
});

// One-shot A4 (A3 leftover): "$" names no one currency, so it is read as the business's own dollar; nothing defaults to INR.
test('A4: "$" reads as the business\'s own dollar currency, else USD', () => {
  assert.equal(editAmountsCheck('The fee is $5,000.', { ...none, receipted: ['SGD 5,000.00'], currency: 'SGD' }).detail, EVERY);
  assert.equal(editAmountsCheck('The fee is $5,000.', { ...none, receipted: ['USD 5,000.00'], currency: 'SGD' }).detail, OWN_WORDS_AMOUNT);
  assert.equal(editAmountsCheck('The fee is $5,000.', { ...none, receipted: ['USD 5,000.00'], currency: 'INR' }).detail, EVERY);
  assert.equal(editAmountsCheck('The fee is $5,000.', { ...none, receipted: ['USD 5,000.00'] }).detail, EVERY);
  assert.equal(editAmountsCheck('The fee is Rs 5,000.', { ...none, receipted: ['INR 5,000.00'], currency: 'SGD' }).detail, EVERY);
});

// A4 review (M1): a bare number is money only when it is joined to the amount as a range or a sum. Ids, counts, dates,
// phone numbers and PIN codes beside an amount stay words, so a sentence the agent wrote with a receipted amount, kept
// unchanged by an edit elsewhere, never fails.
test('A4 review: ids, counts, dates, phones and PIN codes beside a receipted amount are not money', () => {
  const agent = 'Hi Priya. Invoice INV-0001 for INR 5,000.00 is due on 3 Nov. The fee of INR 5,000.00 covers 2 hours of shooting. Call me on 98200 12345. Send it to Pune 411001 with INR 5,000.00.';
  const input = { receipted: ['INR 5,000.00'], agentWords: agent, clientWords: '', currency: 'INR' };
  for (const text of [agent.replace('Hi Priya.', 'Hi Priya!'), 'Hi Priya! Invoice INV-0001 for INR 5,000.00 is due on 3 Nov.', 'Hi Priya! The fee of INR 5,000.00 covers 2 hours of shooting.', 'INR 5,000.00 for 4 photos, order 1234.']) {
    assert.deepEqual([editAmountsCheck(text, input).passed, editAmountsCheck(text, input).detail], [true, EVERY], text);
  }
  // Joined to the amount, a number is money: a range, "to", "plus", "x".
  for (const text of ['The fee is Rs 5,000-9,000.', 'The fee is Rs 5,000 to 9,000.', 'It is Rs 5,000 plus 4,000 more.', 'That is INR 5,000.00 x 3.']) {
    assert.equal(editAmountsCheck(text, { ...input, agentWords: '' }).detail, OWN_WORDS_AMOUNT, text);
  }
});

// A4 review round 2: a number joined before the amount ("3 x", "between 4,000 and", "from 3,000 to"), or after it by
// "or" or "and" with an amount-sized number, is money too. Kept unchanged from the agent, each fails; written by the
// editor, each is their own money words. Ids, counts, dates and phones beside an amount still pass.
test('A4 review round 2: joins before the amount, and "or" or "and" after it, are the editor\'s own money words', () => {
  const input = { receipted: ['INR 5,000.00'], agentWords: '', clientWords: '', currency: 'INR' };
  for (const text of ['It is 3 x INR 5,000.00 in total.', 'Between 4,000 and INR 5,000.00.', 'From 3,000 to INR 5,000.00.', 'It is INR 5,000.00 or 9,000.', 'It is INR 5,000.00 and 4,000 more.']) {
    assert.deepEqual([editAmountsCheck(text, input).passed, editAmountsCheck(text, input).detail], [true, OWN_WORDS_AMOUNT], text);
    assert.equal(editAmountsCheck(text, { ...input, agentWords: text }).passed, false, `${text} kept from the agent`);
  }
  const agent = 'Invoice INV-0001 - INR 5,000.00 is due on 3 Nov. It is INR 5,000.00 and 2 hours of shooting. Order 12 and INR 5,000.00 are paid. Call 98200 12345 or INR 5,000.00 by 2 Nov.';
  for (const text of agent.split(/(?<=\.)\s+/)) {
    assert.deepEqual([editAmountsCheck(text, { ...input, agentWords: agent }).passed, editAmountsCheck(text, { ...input, agentWords: agent }).detail], [true, EVERY], text);
  }
});
