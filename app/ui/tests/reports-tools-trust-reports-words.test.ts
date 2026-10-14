import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORDS, fill } from '../src/screens/reports/words.ts';

test('the Reports catalogue has every key in English and Hindi, none empty, with the same placeholders', () => {
  const en = Object.keys(WORDS.en).sort(), hi = Object.keys(WORDS.hi).sort();
  assert.deepEqual(hi, en);
  const holes = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort();
  for (const key of en) {
    const e = WORDS.en[key as keyof typeof WORDS.en], h = WORDS.hi[key as keyof typeof WORDS.hi];
    assert.ok(e.trim().length > 0 && h.trim().length > 0, key);
    assert.deepEqual(holes(h), holes(e), key);
  }
});

test('fill puts values in as text and leaves unknown names alone', () => {
  assert.equal(fill('File made: {name}', { name: '{x} <b>' }), 'File made: {x} <b>');
  assert.equal(fill('{a} and {b}', { a: '1' }), '1 and {b}');
});
