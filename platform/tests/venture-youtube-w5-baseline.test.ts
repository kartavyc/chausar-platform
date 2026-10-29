// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadYoutubeBaseline, runYoutubeBaseline, YOUTUBE_DRAFT_RULES } from '../runtime/venture/playbooks/youtube/judge.ts';
test('word-edit baseline runs real cleanup, caption and script coverage checks without lowering the rate', async () => {
  const file = await loadYoutubeBaseline();
  for (const id of ['cleanup-summary', 'caption-file', 'scripted-coverage']) assert.ok(file.cases.some(item => item.id === id));
  assert.equal(YOUTUBE_DRAFT_RULES.find(rule => rule.id === 'no-new-words')?.floor.kind, 'required-yes');
  const pass = await runYoutubeBaseline(file);
  assert.equal(pass.ok, true, JSON.stringify(pass.cases.filter(item => !item.passed)));
  assert.equal(pass.passed, file.cases.length);
  assert.ok(file.cases.length >= 12);
  const failed = await runYoutubeBaseline(file, item => item.id === 'cleanup-summary' ? 'Nothing was cut.' : item.reference);
  assert.equal(failed.ok, false);
});
