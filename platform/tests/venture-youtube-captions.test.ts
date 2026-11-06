// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { youtubeCaptions, reviewCaptionWord } from '../runtime/venture/playbooks/youtube/captions.ts';
import { parseTranscript } from '../runtime/venture/playbooks/youtube/transcript.ts';
test('caption files group measured word times, validate and keep timings when reviewed', () => {
  const words = ['We', 'make', 'good', 'coffee'].map((text, index) => ({ text, startMs: index * 500, endMs: (index + 1) * 500 }));
  const made = youtubeCaptions({ words, profile: 'web', sourceDigest: 'a', currentDigest: 'a' });
  assert.deepEqual(made.findings, []);
  assert.equal(parseTranscript(made.srt).length, 1);
  assert.equal(parseTranscript(made.vtt).length, 1);
  const edited = reviewCaptionWord(made.cues, 'c1', 2, 'great');
  assert.deepEqual(edited.map(cue => [cue.startMs, cue.endMs]), made.cues.map(cue => [cue.startMs, cue.endMs]));
  assert.throws(() => youtubeCaptions({ words, profile: 'web', sourceDigest: 'a', currentDigest: 'b' }), { code: 'DERIVED_STALE' });
});

test('caption coverage names the visual checks that cannot run from word times alone', () => {
  const made = youtubeCaptions({ words: [{ text: 'Hello friend', startMs: 0, endMs: 2000 }], profile: 'web', sourceDigest: 'a', currentDigest: 'a' });
  assert.deepEqual(made.notRun.map(item => item.check), ['safe-area', 'face-overlap']);
});
