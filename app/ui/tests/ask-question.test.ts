import test from 'node:test';
import assert from 'node:assert/strict';
import { submittedQuestion } from '../src/app/ask-question.ts';

test('empty and whitespace-only inputs do not submit', () => {
  for (const text of ['', ' ', '\n\t ', '\u00a0\u3000']) assert.equal(submittedQuestion(text), null);
});
test('reviewed question retains original English/Hindi wording and whitespace', () => {
  for (const text of ['  Review this\nplease.  ', '\tहिन्दी में बताइए।\n', 'e\u0301']) {
    assert.equal(submittedQuestion(text), text);
  }
});
