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
