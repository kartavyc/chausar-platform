import test from 'node:test';
import assert from 'node:assert/strict';
import { checkJobDraftNumbers } from '../runtime/venture/agent-runtime/draft-provenance.ts';

const draft = (heading: string, ...text: string[]) => ({ title: 'Draft', questionsForClient: [], sections: [{ heading, parts: text.map(text => ({ kind: 'text', text, ref: '' })) }] });
const source = 'My edit notes name 5 fees and chapters at 0:00, 1:30 and 4:00. The price is INR 500.';
test('job draft preserves exact non-money source counts and source chapter times', () => {
  assert.doesNotThrow(() => checkJobDraftNumbers(draft('Summary', 'Explain the 5 fees.'), source));
  assert.doesNotThrow(() => checkJobDraftNumbers(draft('Description and chapters', '1:30 The fees to check'), source));
  for (const text of ['Explain the 6 fees.', 'Explain the 5 awards.']) assert.throws(() => checkJobDraftNumbers(draft('Summary', text), source));
  assert.throws(() => checkJobDraftNumbers(draft('Description and chapters', '1:31 A fabricated chapter'), source));
  assert.throws(() => checkJobDraftNumbers(draft('Summary', '1:30 A chapter in an unrelated field'), source));
});
test('source copying cannot authorize money or rates, while post ordinals come from their actual positions', () => {
  for (const text of ['INR 500', '500 USD', 'Price: 500', 'A 5% fee', 'Pay 500 dollars', 'Our rate is 25 percent.', 'We earned 25 million.', 'A 25 basis points rate.', 'A 25 per cent rate.']) assert.throws(() => checkJobDraftNumbers(draft('Summary', text), source + ' ' + text));
  assert.doesNotThrow(() => checkJobDraftNumbers(draft('Post plan', 'Post 1 | Value | Teach useful practice', 'Post 2 | Value | Show careful practice'), ''));
  assert.throws(() => checkJobDraftNumbers(draft('Post plan', 'Post 2 | Value | Out of order'), ''));
  assert.throws(() => checkJobDraftNumbers(draft('Post plan', 'Post 1 | Value | We won 5 awards'), ''));
});
