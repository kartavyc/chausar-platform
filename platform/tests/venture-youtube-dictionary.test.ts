// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDictionaryFixes, normalisedSimilarity, undoDictionary } from '../runtime/venture/playbooks/youtube/dictionary.ts';

test('dictionary fixes need the exact indexed before and a named term at ninety percent similarity', () => {
  const words = ['Chausaar', 'brings', 'clarity'];
  const fixed = applyDictionaryFixes(words, ['Chausar'], [{ index: 0, before: 'Chausaar', after: 'Chausar' }]);
  assert.equal(fixed.applied.length, 0); // One deletion in eight letters is below .90.
  const longer = applyDictionaryFixes(['KartavyaChauhanx'], ['KartavyaChauhan'], [{ index: 0, before: 'KartavyaChauhanx', after: 'KartavyaChauhan' }]);
  assert.equal(longer.words[0], 'KartavyaChauhan');
  assert.deepEqual(undoDictionary(longer), ['KartavyaChauhanx']);
  assert.equal(applyDictionaryFixes(words, ['Chausaar'], [{ index: 1, before: 'Chausaar', after: 'Chausaar' }]).refused[0].code, 'DICTIONARY_BEFORE_CHANGED');
  assert.equal(applyDictionaryFixes(words, ['Chausar'], [{ index: 0, before: 'Chausaar', after: 'Invented' }]).refused[0].code, 'DICTIONARY_TERM_UNKNOWN');
  assert.equal(normalisedSimilarity('NAME', 'name'), 1);
});
