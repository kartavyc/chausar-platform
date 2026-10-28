// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scriptCoverage } from '../runtime/venture/playbooks/youtube/coverage.ts';
const words = (text: string) => text.split(' ').map((text, index) => ({ id: `w${index + 1}`, text, startMs: index * 500, endMs: (index + 1) * 500 }));
test('script coverage measures missing passages, nearby ids, retakes and only actual extra words', () => {
  const report = scriptCoverage('Fresh coffee tastes good. Bring your cup.', words('Fresh coffee tastes good Fresh coffee tastes good today'));
  assert.equal(report.coveredPercent, 57.14);
  assert.deepEqual(report.missing[0].words, ['Bring', 'your', 'cup.']);
  assert.ok(report.missing[0].nearestWordIds.length > 0);
  assert.ok(report.retakes.some(retake => retake.wordIds.length === 3));
  assert.ok(report.extras.some(extra => extra.text === 'today'));
  assert.ok(report.extras.every(extra => ['Fresh', 'coffee', 'tastes', 'good', 'today'].includes(extra.text)));
});
test('one-letter near matches in longer words count without replacing spoken text', () => {
  assert.equal(scriptCoverage('coffee', words('coffea')).coveredPercent, 100);
  assert.equal(scriptCoverage('tea', words('sea')).coveredPercent, 0);
});


test('repeated long near-match words are normalised once per input rather than per alignment cell', () => {
  const saved = String.prototype.normalize;
  let calls = 0;
  String.prototype.normalize = function (form?: string) { calls++; return saved.call(this, form); };
  try {
    const left = 'a'.repeat(199) + 'b', right = 'a'.repeat(199) + 'c';
    const result = scriptCoverage(Array(20).fill(left).join(' '), words(Array(20).fill(right).join(' ')));
    assert.equal(result.coveredPercent, 100);
    assert.ok(calls <= 40, `normalisation ran ${calls} times for forty input words`);
  } finally { String.prototype.normalize = saved; }
});
